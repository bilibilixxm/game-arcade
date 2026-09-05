/* ==========================================================
   像素小鸟 — 小程序版
   游戏逻辑:libs/flappy-engine.js(与 Web 版共用同一算法)
   渲染:canvas type="2d",像素精灵经 wx.createOffscreenCanvas 物化,
        每帧只 drawImage(杜绝逐像素 fillRect 进主循环)
   输入:全屏点按扇翅;音效:InnerAudioContext(wav 由 gen-sounds.js 生成)
   ========================================================== */
'use strict';

const FlappyEngine = require('../../libs/flappy-engine.js');
const Sprites = require('../../libs/flappy-sprites.js');

const KEY_RECORDS = 'flappy.records';
const KEY_BEST = 'flappy.best';
const KEY_SETTINGS = 'flappy.settings'; // 本游戏设置(sound)
const KEY_APP_SETTINGS = 'arcade.settings'; // 应用级设置(theme,合集共用)
const MAX_RECORDS = 50;

const THEME_ICONS = { auto: '🌓', light: '☀️', dark: '🌙' };
const THEMES = ['auto', 'light', 'dark'];
const MEDALS = [
  { at: 40, icon: '💠', name: '白金牌' },
  { at: 30, icon: '🥇', name: '金牌' },
  { at: 20, icon: '🥈', name: '银牌' },
  { at: 10, icon: '🥉', name: '铜牌' },
];

/* ---------- 工具 ---------- */
function storageGet(key, fallback) {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v === null || v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch {
    /* 静默失败 */
  }
}

function fmtDate(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function medalFor(score) {
  return MEDALS.find((m) => score >= m.at) || null;
}

Page({
  data: {
    statBest: '--',
    statLast: '--',
    statGames: '0',
    overlayVisible: true,
    tapHintVisible: false,
    darkClass: '',
    themeIcon: '🌓',
    soundIcon: '🔊',
    // 结果浮层
    resultVisible: false,
    resultEmoji: '💀',
    resultTitle: '游戏结束',
    isNewRecord: false,
    medalIcon: '',
    medalName: '',
    resultScore: '0',
    resultBest: '0',
    // 历史抽屉
    drawerVisible: false,
    drawerBestScore: '--',
    drawerGames: '0',
    records: [],
  },

  /* ---------- 生命周期 ---------- */
  onLoad() {
    // 应用级主题(与 home/schulte 等页共用 arcade.settings)
    this.appSettings = Object.assign({ theme: 'auto' }, storageGet(KEY_APP_SETTINGS, {}));
    try {
      this.sysTheme = wx.getAppBaseInfo().theme || 'light';
    } catch {
      this.sysTheme = 'light';
    }
    this.onThemeChangeHandler = (res) => {
      this.sysTheme = res.theme;
      if (this.appSettings.theme === 'auto') this.applyTheme();
    };
    wx.onThemeChange(this.onThemeChangeHandler);
    this.applyTheme();

    this.settings = Object.assign({ sound: true }, storageGet(KEY_SETTINGS, {}));
    this.setData({ soundIcon: this.settings.sound ? '🔊' : '🔇' });

    this.records = storageGet(KEY_RECORDS, []);
    this.best = storageGet(KEY_BEST, null);

    // 引擎与流程状态(idle:开始遮罩 | ready | playing | over:含 dying)
    this.engine = FlappyEngine.createFlappy();
    this.stage = 'idle';
    this.groundX = 0;
    this.rotDeg = 0;
    this.flashT = 0;
    this.resultTimer = null;
    this.look = { night: false, bird: 'yellow' };

    // 音效
    const make = (file) => {
      const ctx = wx.createInnerAudioContext({ useWebAudioImplement: true });
      ctx.src = `/assets/sounds/flappy/${file}`;
      ctx.volume = 0.7;
      return ctx;
    };
    this.sounds = {
      wing: make('wing.wav'),
      point: make('point.wav'),
      hit: make('hit.wav'),
      die: make('die.wav'),
      swoosh: make('swoosh.wav'),
    };

    this.updateHUD(true);
  },

  onReady() {
    const query = wx.createSelectorQuery().in(this);
    query.select('#board').fields({ node: true, size: true });
    query.exec((res) => {
      let dpr = 2;
      try {
        dpr = wx.getWindowInfo().pixelRatio || 2;
      } catch {
        /* 保底 2 */
      }
      const item = res[0];
      const canvas = item.node;
      canvas.width = Math.round(item.width * dpr);
      canvas.height = Math.round(item.height * dpr);
      this.cv = { canvas, ctx: canvas.getContext('2d') };
      this.k = canvas.width / this.engine.W; // 逻辑 288 宽 → 物理像素比
      this.materializeAll();
      const loop = (now) => {
        this.loop(typeof now === 'number' ? now : Date.now());
        if (this.cv) this.cv.canvas.requestAnimationFrame(loop);
      };
      this.cv.canvas.requestAnimationFrame(loop);
    });
  },

  onUnload() {
    Object.values(this.sounds).forEach((s) => s.destroy());
    if (this.resultTimer) clearTimeout(this.resultTimer);
    if (this.onThemeChangeHandler) wx.offThemeChange(this.onThemeChangeHandler);
  },

  /* ---------- 主题 ---------- */
  applyTheme() {
    const t = this.appSettings.theme;
    const dark = t === 'dark' || (t === 'auto' && this.sysTheme === 'dark');
    this.setData({ darkClass: dark ? 'dark' : '', themeIcon: THEME_ICONS[t] || '🌓' });
  },

  onThemeTap() {
    const idx = THEMES.indexOf(this.appSettings.theme);
    this.appSettings.theme = THEMES[(idx + 1) % THEMES.length] || 'auto';
    storageSet(KEY_APP_SETTINGS, this.appSettings);
    this.applyTheme();
  },

  onSoundTap() {
    this.settings.sound = !this.settings.sound;
    storageSet(KEY_SETTINGS, this.settings);
    this.setData({ soundIcon: this.settings.sound ? '🔊' : '🔇' });
  },

  /* ---------- 音效 ---------- */
  play(name) {
    if (!this.settings.sound) return;
    const s = this.sounds[name];
    if (!s) return;
    s.stop();
    s.play();
  },

  /* ---------- 精灵物化(每局外观变化时重建) ---------- */
  makeOff(w, h) {
    return wx.createOffscreenCanvas({ type: '2d', width: w, height: h });
  },

  // 字符像素图 → 离屏 canvas(pixScale:每字符像素边长)
  pixelsToOff(frame, paletteName, pixScale) {
    const sp = Sprites.makeSprite(frame, paletteName);
    const cv = this.makeOff(sp.w * pixScale, sp.h * pixScale);
    const c = cv.getContext('2d');
    for (let y = 0; y < sp.h; y++) {
      for (let x = 0; x < sp.w; x++) {
        const col = sp.px[y][x];
        if (!col) continue;
        c.fillStyle = col;
        c.fillRect(x * pixScale, y * pixScale, pixScale, pixScale);
      }
    }
    return cv;
  },

  materializeAll() {
    // 鸟三帧(当前羽色)34×24
    this.birdImgs = Sprites.BIRD_FRAMES.map((f) => this.pixelsToOff(f, this.look.bird, 2));
    // 记分数字 28×36(白字 + 2px 描边,与 Web 版一致)
    this.digitImgs = [];
    for (let d = 0; d <= 9; d++) {
      const rows = Sprites.DIGITS[d];
      const cv = this.makeOff(28, 36);
      const c = cv.getContext('2d');
      c.fillStyle = '#533846';
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 5; x++) {
          if (rows[y][x] === '#') c.fillRect(x * 4 + 2, y * 4 + 2, 8, 8);
        }
      }
      c.fillStyle = '#ffffff';
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 5; x++) {
          if (rows[y][x] === '#') c.fillRect(x * 4 + 4, y * 4 + 4, 4, 4);
        }
      }
      this.digitImgs.push(cv);
    }
    this.materializePipe();
    this.materializeBg();
    this.materializeGround();
  },

  materializePipe() {
    const R = this.engine.RULES;
    const H = this.engine.H - this.engine.GROUND_H;
    const cv = this.makeOff(R.pipeWidth, H);
    const c = cv.getContext('2d');
    const W = R.pipeWidth;
    const CAP_H = 26;
    c.fillStyle = '#38571c';
    c.fillRect(0, CAP_H, W, H - CAP_H);
    c.fillStyle = '#73bf2e';
    c.fillRect(2, CAP_H, W - 4, H - CAP_H);
    c.fillStyle = '#a8e05b';
    c.fillRect(4, CAP_H, 8, H - CAP_H);
    c.fillStyle = '#4e8a1e';
    c.fillRect(W - 12, CAP_H, 8, H - CAP_H);
    c.fillStyle = '#38571c';
    c.fillRect(0, 0, W, CAP_H);
    c.fillStyle = '#73bf2e';
    c.fillRect(2, 2, W - 4, CAP_H - 4);
    c.fillStyle = '#a8e05b';
    c.fillRect(4, 4, 9, CAP_H - 8);
    c.fillStyle = '#4e8a1e';
    c.fillRect(W - 13, 4, 9, CAP_H - 8);
    this.pipeImg = cv;
  },

  materializeBg() {
    const e = this.engine;
    const W = e.W;
    const H = e.H - e.GROUND_H;
    const night = this.look.night;
    const cv = this.makeOff(W, H);
    const c = cv.getContext('2d');
    const sky = night ? '#0e3040' : '#4ec0ca';
    c.fillStyle = sky;
    c.fillRect(0, 0, W, H);
    if (night) {
      c.fillStyle = '#cfeef5';
      const stars = [[18, 40], [52, 96], [120, 30], [170, 70], [230, 44], [262, 110], [90, 130], [205, 128]];
      for (const [x, y] of stars) {
        c.fillRect(x, y, 2, 2);
        c.fillRect(x - 2, y, 1, 1);
        c.fillRect(x + 2, y, 1, 1);
      }
      c.fillStyle = '#f4f0d8';
      c.fillRect(226, 34, 18, 18);
      c.fillRect(230, 30, 10, 26);
      c.fillRect(222, 38, 26, 10);
      c.fillStyle = sky;
      c.fillRect(220, 30, 12, 12);
    } else {
      c.fillStyle = '#fdf6b4';
      c.fillRect(222, 30, 26, 26);
      c.fillRect(218, 34, 34, 18);
      c.fillRect(226, 26, 18, 34);
    }
    c.fillStyle = night ? '#1b4a5c' : '#eefafb';
    for (let x = -6; x < W + 12; x += 28) {
      const y = 96 + ((x * 7919) % 3) * 6;
      c.fillRect(x, y, 24, 8);
      c.fillRect(x + 4, y - 5, 14, 6);
      c.fillRect(x + 10, y + 8, 18, 6);
    }
    c.fillStyle = night ? '#12455a' : '#8ee0c0';
    const blocks = [[0, 34, 26], [30, 26, 20], [54, 40, 30], [88, 24, 22], [114, 36, 26],
      [144, 28, 34], [182, 40, 24], [210, 30, 28], [242, 38, 22], [268, 30, 20]];
    for (const [x, w, h] of blocks) {
      c.fillRect(x, 160 - h, w, h);
      c.fillRect(x + 3, 160 - h - 4, 4, 4);
      c.fillRect(x + w - 7, 160 - h - 4, 4, 4);
    }
    c.fillStyle = night ? '#0f3d33' : '#5ec768';
    for (let x = -4; x < W + 16; x += 22) {
      c.fillRect(x, 152, 20, 10);
      c.fillRect(x + 4, 144, 12, 9);
    }
    c.fillRect(0, 158, W, 6);
    this.bgImg = cv;
  },

  materializeGround() {
    const e = this.engine;
    const W = e.W + 52;
    const H = e.GROUND_H;
    const night = this.look.night;
    const cv = this.makeOff(W, H);
    const c = cv.getContext('2d');
    c.fillStyle = night ? '#8a7f52' : '#ded895';
    c.fillRect(0, 0, W, H);
    c.fillStyle = night ? '#786e46' : '#d0c878';
    for (let y = 30; y < H - 8; y += 16) {
      for (let x = ((y / 16) % 2) * 24; x < W; x += 48) {
        c.fillRect(x, y, 22, 12);
      }
    }
    c.fillStyle = night ? '#4f9c46' : '#9be64f';
    c.fillRect(0, 0, W, 10);
    c.fillStyle = night ? '#3a7a34' : '#73bf2e';
    for (let x = -24; x < W + 24; x += 48) {
      for (let i = 0; i < 24; i++) {
        c.fillRect(x + i, i, 4, 1);
        c.fillRect(x + i, 23 - i, 4, 1);
      }
    }
    c.fillStyle = night ? '#2c5c28' : '#558022';
    c.fillRect(0, 10, W, 3);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(0, 0, W, 1);
    this.groundImg = cv;
  },

  /* ---------- 输入:全屏点按扇翅 ---------- */
  onTap() {
    if (this.stage === 'idle' || this.stage === 'over') return;
    if (this.engine.state.phase === 'ready') {
      this.setData({ tapHintVisible: false });
      this.stage = 'playing';
    }
    this.engine.flap();
  },

  /* ---------- 主循环 ---------- */
  loop(now) {
    const e = this.engine;
    e.tick(now);
    this.playEvents();

    const st = e.state;
    let dt = 0;
    if (this.lastNow !== -1) {
      dt = Math.min(0.05, Math.max(0, (now - this.lastNow) / 1000));
    }
    this.lastNow = now;
    if (st.phase === 'playing') this.groundX = (this.groundX + e.SPEEDS.scroll * dt) % 24;

    // 鸟旋转(渲染层职责)
    if (st.phase === 'playing') {
      const target = st.bird.vel < 0
        ? -25
        : Math.min(90, -25 + (st.bird.vel / e.SPEEDS.maxFall) * 150);
      this.rotDeg += (target - this.rotDeg) * Math.min(1, dt * 14);
    } else if (st.phase === 'dying') {
      this.rotDeg = Math.min(90, this.rotDeg + 480 * dt);
    } else if (st.phase === 'ready') {
      this.rotDeg = 0;
    }
    if (this.flashT > 0) this.flashT -= dt;

    this.draw();
  },

  playEvents() {
    for (const ev of this.engine.drainEvents()) {
      switch (ev.type) {
        case 'flap': this.play('wing'); break;
        case 'point': this.play('point'); break;
        case 'hit': this.play('hit'); this.flashT = 0.12; break;
        case 'die': this.play('die'); break;
        case 'gameover': this.onGameOver(ev.score); break;
        default: break;
      }
    }
  },

  /* ---------- 渲染 ---------- */
  draw() {
    const cv = this.cv;
    if (!cv || !this.bgImg) return;
    const e = this.engine;
    const st = e.state;
    const R = e.RULES;
    const ctx = cv.ctx;
    const k = this.k;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // 背景
    ctx.drawImage(this.bgImg, 0, 0, e.W, e.H - e.GROUND_H, 0, 0, e.W * k, (e.H - e.GROUND_H) * k);

    // 管道(上管垂直翻转)
    const pw = R.pipeWidth * k;
    const ph = (e.H - e.GROUND_H) * k;
    for (const p of st.pipes) {
      const topH = (p.gapY - R.gap / 2) * k;
      const botY = (p.gapY + R.gap / 2) * k;
      ctx.save();
      ctx.translate(p.x * k + pw / 2, topH);
      ctx.scale(1, -1);
      ctx.drawImage(this.pipeImg, 0, 0, R.pipeWidth, e.H - e.GROUND_H, -pw / 2, 0, pw, ph);
      ctx.restore();
      ctx.drawImage(this.pipeImg, 0, 0, R.pipeWidth, e.H - e.GROUND_H, p.x * k, botY, pw, ph);
    }

    // 地面(340 宽条左移滚动,右缘 52px 余量保证盖满 288)
    ctx.drawImage(
      this.groundImg, 0, 0, e.W + 52, e.GROUND_H,
      -this.groundX * k, (e.H - e.GROUND_H) * k, (e.W + 52) * k, e.GROUND_H * k
    );

    // 鸟(ready 态浮动,over/dying 定格翅中)
    const bobY = st.phase === 'ready' ? Math.sin(st.time * Math.PI * 2 * 1.4) * 5 : 0;
    const frame = st.phase === 'dying' || st.phase === 'over'
      ? 1
      : [0, 1, 2, 1][Math.floor(st.time * 6) % 4];
    const img = this.birdImgs[frame] || this.birdImgs[0];
    const cx = (st.bird.x + R.birdW / 2) * k;
    const cy = (st.bird.y + bobY + R.birdH / 2) * k;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((this.rotDeg * Math.PI) / 180);
    ctx.drawImage(img, (-R.birdW / 2) * k, (-R.birdH / 2) * k, R.birdW * k, R.birdH * k);
    ctx.restore();

    // 记分大数字
    if (st.phase !== 'ready') {
      const str = String(st.score);
      const dw = 26 * k;
      let x = e.W * k / 2 - (str.length * dw - 2 * k) / 2;
      for (const ch of str) {
        ctx.drawImage(this.digitImgs[Number(ch)], x, 28 * k, 28 * k, 36 * k);
        x += dw;
      }
    }

    // 撞击白闪
    if (this.flashT > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, this.flashT / 0.12) * 0.85})`;
      ctx.fillRect(0, 0, e.W * k, e.H * k);
    }
  },

  /* ---------- HUD 与流程 ---------- */
  updateHUD(force) {
    if (!force && this.stage !== 'idle' && this.stage !== 'over') return;
    this.setData({
      statBest: this.best ? String(this.best.score) : '--',
      statLast: this.records.length ? String(this.records[0].score) : '--',
      statGames: String(this.records.length),
    });
  },

  toReady() {
    this.engine.reset();
    // 每局随机白天/黑夜与鸟色
    this.look = {
      night: Math.random() < 0.4,
      bird: ['yellow', 'red', 'blue'][Math.floor(Math.random() * 3)],
    };
    this.materializeAll();
    this.groundX = 0;
    this.rotDeg = 0;
    this.flashT = 0;
    this.lastNow = -1;
    this.stage = 'ready';
    if (this.resultTimer) clearTimeout(this.resultTimer);
    this.setData({
      overlayVisible: false,
      resultVisible: false,
      tapHintVisible: true,
    });
    this.updateHUD(true);
  },

  onStartTap() {
    this.toReady();
  },

  onRetryTap() {
    this.toReady();
  },

  onGameOver(score) {
    const date = new Date().toISOString();
    this.records.unshift({ score, date, end: 'over' });
    this.records = this.records.slice(0, MAX_RECORDS);
    storageSet(KEY_RECORDS, this.records);
    const isNew = !this.best || score > this.best.score;
    if (isNew) {
      this.best = { score, date };
      storageSet(KEY_BEST, this.best);
    }
    this.stage = 'over';
    this.updateHUD(true);
    // 坠落动画播完再弹结算(与 Web 版一致 900ms)
    if (this.resultTimer) clearTimeout(this.resultTimer);
    this.resultTimer = setTimeout(() => this.showResult(score, isNew), 900);
  },

  showResult(score, isNew) {
    if (this.stage !== 'over') return;
    this.play('swoosh');
    const medal = medalFor(score);
    this.setData({
      resultVisible: true,
      resultEmoji: isNew ? '🏆' : '💀',
      resultTitle: isNew ? '新纪录!' : '游戏结束',
      isNewRecord: isNew,
      medalIcon: medal ? medal.icon : '',
      medalName: medal ? medal.name : '',
      resultScore: String(score),
      resultBest: this.best ? String(this.best.score) : '0',
    });
  },

  /* ---------- 历史抽屉 ---------- */
  onHistoryTap() {
    this.setData({
      drawerVisible: true,
      resultVisible: false,
      drawerBestScore: this.best ? String(this.best.score) : '--',
      drawerGames: String(this.records.length),
      records: this.records.slice(0, 50).map((r, i) => ({
        key: i,
        scoreText: `${r.score} 分${medalFor(r.score) ? ' ' + medalFor(r.score).icon : ''}`,
        metaText: fmtDate(r.date),
      })),
    });
  },

  onCloseDrawer() {
    this.setData({ drawerVisible: false });
    if (this.stage === 'over') this.setData({ resultVisible: true });
  },

  onClearTap() {
    wx.showModal({
      title: '清空记录',
      content: '确定清空全部对局记录吗?此操作不可恢复。',
      confirmText: '清空',
      confirmColor: '#e5484d',
      success: (res) => {
        if (!res.confirm) return;
        this.records = [];
        this.best = null;
        storageSet(KEY_RECORDS, this.records);
        storageSet(KEY_BEST, this.best);
        this.updateHUD(true);
        this.setData({
          records: [],
          drawerBestScore: '--',
          drawerGames: '0',
        });
      },
    });
  },

  /* ---------- 占位(catchtouchmove 防滚动穿透) ---------- */
  noop() {},

  /* ---------- 分享 ---------- */
  onShareAppMessage() {
    return {
      title: '像素小鸟 — 点按扇翅,看你能飞多远!',
      path: '/pages/flappy/flappy',
    };
  },
});
