/* ==========================================================
   俄罗斯方块 — 小程序版
   游戏逻辑:libs/tetris-engine.js(与 Web 版共用同一算法)
   渲染:canvas type="2d";输入:触控按钮;音效:InnerAudioContext
   ========================================================== */
'use strict';

const TetrisEngine = require('../../libs/tetris-engine.js');

const KEY_RECORDS = 'tetris.records';
const KEY_BEST = 'tetris.best';
const KEY_SETTINGS = 'tetris.settings'; // 本游戏设置(sound)
const KEY_APP_SETTINGS = 'arcade.settings'; // 应用级设置(theme,合集共用)
const MAX_RECORDS = 50;

const DAS = 170; // 左右按钮首次重复延迟 ms
const ARR = 40; // 左右按钮重复间隔 ms
const SOFT_ARR = 40; // 软降重复间隔 ms

const COLORS = {
  I: '#41c7f0',
  J: '#4f6ef7',
  L: '#f2913d',
  O: '#f2c94c',
  S: '#3ecf8e',
  T: '#a06df5',
  Z: '#e5484d',
};

const THEME_ICONS = { auto: '🌓', light: '☀️', dark: '🌙' };
const THEMES = ['auto', 'light', 'dark'];

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

function fmtScore(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtDur(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

Page({
  data: {
    displayScore: '0',
    lines: 0,
    level: 1,
    bestText: '--',
    overlayVisible: true,
    pauseVisible: false,
    pressed: { left: false, down: false, right: false },
    startLevel: 1,
    darkClass: '',
    themeIcon: '🌓',
    pauseIcon: '⏸',
    // 结果浮层
    resultVisible: false,
    resultTitle: '游戏结束',
    resultEmoji: '🎮',
    isNewRecord: false,
    resultScore: '0',
    resultLines: 0,
    resultLevel: 1,
    resultDuration: '0:00',
    resultBest: '0',
    // 历史抽屉
    drawerVisible: false,
    drawerBestScore: '--',
    drawerBestLines: '--',
    drawerBestLevel: '--',
    records: [],
  },

  /* ---------- 生命周期 ---------- */
  onLoad() {
    // 应用级主题(与 home/schulte 页共用 arcade.settings)
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

    // 本游戏设置与成绩
    this.settings = Object.assign({ sound: true, startLevel: 1 }, storageGet(KEY_SETTINGS, {}));
    this.setData({ startLevel: this.settings.startLevel });
    this.records = storageGet(KEY_RECORDS, []);
    this.best = storageGet(KEY_BEST, null);

    // 引擎与流程状态
    this.engine = TetrisEngine.createTetris({ rows: 20, cols: 10 });
    this.phase = 'idle'; // idle | running | paused | over
    this.startTs = 0;
    this.pausedAcc = 0;
    this.pauseTs = 0;
    this.held = { dir: 0, nextRepeat: 0, soft: false, softNext: 0 };
    this.watch = { cur: null, lines: 0, level: 1 };
    this.hudCache = '';
    this.prevSig = '';
    this.beginWatch();

    // 音效(短音频用 useWebAudioImplement 降低延迟)
    const make = (file) => {
      const ctx = wx.createInnerAudioContext({ useWebAudioImplement: true });
      ctx.src = `/assets/sounds/tetris/${file}`;
      ctx.volume = 0.7;
      return ctx;
    };
    this.sounds = {
      move: make('move.wav'),
      rotate: make('rotate.wav'),
      lock: make('lock.wav'),
      clear: make('clear.wav'),
      levelup: make('levelup.wav'),
      gameover: make('gameover.wav'),
    };

    this.updateHUD(true);
  },

  onReady() {
    // 初始化三块 canvas(type="2d")
    const query = wx.createSelectorQuery().in(this);
    query.select('#board').fields({ node: true, size: true });
    query.select('#cv-hold').fields({ node: true, size: true });
    query.select('#cv-next').fields({ node: true, size: true });
    query.exec((res) => {
      let dpr = 2;
      try {
        dpr = wx.getWindowInfo().pixelRatio || 2;
      } catch {
        /* 保底 2 */
      }
      const setup = (item) => {
        if (!item) return null;
        const canvas = item.node;
        canvas.width = Math.round(item.width * dpr);
        canvas.height = Math.round(item.height * dpr);
        return { canvas, ctx: canvas.getContext('2d'), w: canvas.width, h: canvas.height };
      };
      this.boardCv = setup(res[0]);
      this.holdCv = setup(res[1]);
      this.nextCv = setup(res[2]);
      this.draw();
      const loop = (now) => {
        this.loop(typeof now === 'number' ? now : Date.now());
        if (this.boardCv) this.boardCv.canvas.requestAnimationFrame(loop);
      };
      if (this.boardCv) this.boardCv.canvas.requestAnimationFrame(loop);
    });
  },

  onUnload() {
    Object.values(this.sounds).forEach((s) => s.destroy());
    if (this.onThemeChangeHandler) wx.offThemeChange(this.onThemeChangeHandler);
  },

  onHide() {
    // 切后台自动暂停
    if (this.phase === 'running') this.togglePause();
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

  /* ---------- 音效 ---------- */
  play(name) {
    if (!this.settings.sound) return;
    const s = this.sounds[name];
    if (!s) return;
    s.stop();
    s.play();
  },

  /* ---------- 锁定/消行/升级监测 ---------- */
  beginWatch() {
    const s = this.engine.state;
    this.watch.cur = s.current;
    this.watch.lines = s.lines;
    this.watch.level = s.level;
  },

  endWatch(sounds = true) {
    const s = this.engine.state;
    const locked = s.current !== this.watch.cur;
    if (sounds && locked) {
      this.play('lock');
      if (s.lines > this.watch.lines) this.play('clear');
      if (s.level > this.watch.level) this.play('levelup');
    }
    this.beginWatch();
    return locked;
  },

  /* ---------- 动作 ---------- */
  act(kind) {
    if (this.phase !== 'running') return;
    const e = this.engine;
    let moved = false;
    this.beginWatch();
    switch (kind) {
      case 'left':
        moved = e.moveLeft();
        break;
      case 'right':
        moved = e.moveRight();
        break;
      case 'rotate':
        moved = e.rotate(1);
        break;
      case 'soft':
        e.softDrop();
        break;
      case 'hard':
        e.hardDrop();
        break;
      case 'hold':
        e.hold();
        this.endWatch(false); // hold 换块不算锁定
        return;
    }
    const locked = this.endWatch();
    if (!locked && moved && (kind === 'left' || kind === 'right' || kind === 'rotate')) {
      this.play(kind === 'rotate' ? 'rotate' : 'move');
    }
    this.updateHUD();
    if (e.state.over) this.gameOver();
  },

  /* ---------- 主循环 ---------- */
  pressDir(dir) {
    this.held.dir = dir;
    this.held.nextRepeat = Date.now() + DAS;
    this.act(dir < 0 ? 'left' : 'right');
  },

  releaseDir(dir) {
    if (this.held.dir === dir) this.held.dir = 0;
  },

  loop(now) {
    if (this.phase === 'running') {
      const held = this.held;
      if (held.dir !== 0 && now >= held.nextRepeat) {
        this.act(held.dir < 0 ? 'left' : 'right');
        held.nextRepeat = now + ARR;
      }
      if (held.soft && now >= held.softNext) {
        this.act('soft');
        held.softNext = now + SOFT_ARR;
      }
      this.engine.tick(now);
      if (this.endWatch() && this.engine.state.over) this.gameOver();
    }
    this.draw();
  },

  /* ---------- 渲染 ---------- */
  drawCell(ctx, px, py, size, color, alpha = 1) {
    const inset = Math.max(1, size * 0.06);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    const r = size * 0.18;
    const x = px + inset;
    const y = py + inset;
    const w = size - inset * 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + w, r);
    ctx.arcTo(x + w, y + w, x, y + w, r);
    ctx.arcTo(x, y + w, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  },

  draw() {
    const b = this.boardCv;
    if (!b) return;
    const s = this.engine.state;
    const ctx = b.ctx;
    const cell = b.w / this.engine.COLS;
    ctx.clearRect(0, 0, b.w, b.h);

    // 网格线
    ctx.strokeStyle = 'rgba(128, 138, 160, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < this.engine.COLS; x++) {
      ctx.moveTo(x * cell, 0);
      ctx.lineTo(x * cell, b.h);
    }
    for (let y = 1; y < this.engine.ROWS; y++) {
      ctx.moveTo(0, y * cell);
      ctx.lineTo(b.w, y * cell);
    }
    ctx.stroke();

    // 已落定的方块
    for (let y = 0; y < this.engine.ROWS; y++) {
      for (let x = 0; x < this.engine.COLS; x++) {
        const t = s.board[y][x];
        if (t) this.drawCell(ctx, x * cell, y * cell, cell, COLORS[t]);
      }
    }

    // 幽灵投影与当前方块(pieceCells 返回绝对坐标,幽灵再加相对偏移 gy-current.y)
    // 结束后不画当前块,避免主动结束时残块浮在终局画面上
    if (s.current && !s.over && (this.phase === 'running' || this.phase === 'paused')) {
      const gy = this.engine.ghostY();
      const cells = this.engine.pieceCells();
      if (gy !== s.current.y) {
        for (const [cx, cy] of cells) {
          this.drawCell(ctx, cx * cell, (gy + cy - s.current.y) * cell, cell, COLORS[s.current.type], 0.16);
        }
      }
      for (const [cx, cy] of cells) {
        if (cy >= 0) {
          this.drawCell(ctx, cx * cell, cy * cell, cell, COLORS[s.current.type]);
        }
      }
    }

    this.drawPreviews();
  },

  // 在画布指定区域内居中画一个方块
  drawPieceAt(ctx, type, cx0, cy0, areaW, areaH) {
    const cells = this.engine.cellsFor(type, 0);
    const xs = cells.map((c) => c[0]);
    const ys = cells.map((c) => c[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const bw = Math.max(...xs) - minX + 1;
    const bh = Math.max(...ys) - minY + 1;
    const cell = Math.min(areaW / (bw + 0.8), areaH / (bh + 0.8));
    const ox = cx0 + (areaW - bw * cell) / 2 - minX * cell;
    const oy = cy0 + (areaH - bh * cell) / 2 - minY * cell;
    for (const [cx, cy] of cells) this.drawCell(ctx, ox + cx * cell, oy + cy * cell, cell, COLORS[type]);
  },

  drawPreviews() {
    const s = this.engine.state;
    const sig = [s.hold, s.next[0], s.next[1], s.next[2]].join(',');
    if (sig === this.prevSig) return;
    this.prevSig = sig;
    if (this.holdCv) {
      const c = this.holdCv;
      c.ctx.clearRect(0, 0, c.w, c.h);
      if (s.hold) this.drawPieceAt(c.ctx, s.hold, 0, 0, c.w, c.h);
    }
    if (this.nextCv) {
      const c = this.nextCv;
      c.ctx.clearRect(0, 0, c.w, c.h);
      const slot = c.h / 3;
      for (let i = 0; i < 3; i++) {
        if (s.next[i]) this.drawPieceAt(c.ctx, s.next[i], 0, i * slot, c.w, slot);
      }
    }
  },

  /* ---------- HUD ---------- */
  updateHUD(force) {
    const s = this.engine.state;
    const key = `${s.score}|${s.lines}|${s.level}`;
    if (!force && key === this.hudCache) return;
    this.hudCache = key;
    this.setData({
      displayScore: fmtScore(s.score),
      lines: s.lines,
      level: s.level,
      bestText: this.best ? fmtScore(this.best.score) : '--',
    });
  },

  /* ---------- 起始难度(1~10):决定初始下落速度与计分倍率 ---------- */
  onLvDown() {
    this.changeLevel(-1);
  },

  onLvUp() {
    this.changeLevel(1);
  },

  changeLevel(d) {
    this.settings.startLevel = Math.min(10, Math.max(1, this.settings.startLevel + d));
    storageSet(KEY_SETTINGS, this.settings);
    this.setData({ startLevel: this.settings.startLevel });
  },

  /* ---------- 游戏流程 ---------- */
  startGame() {
    this.engine.reset({ level: this.settings.startLevel });
    this.beginWatch();
    this.phase = 'running';
    this.startTs = Date.now();
    this.pausedAcc = 0;
    this.held = { dir: 0, nextRepeat: 0, soft: false, softNext: 0 };
    this.prevSig = '';
    this.hudCache = '';
    this.setData({ overlayVisible: false, pauseVisible: false, resultVisible: false, pauseIcon: '⏸' });
    this.updateHUD(true);
  },

  togglePause() {
    if (this.phase === 'running') {
      this.engine.state.paused = true;
      this.phase = 'paused';
      this.pauseTs = Date.now();
      this.setData({ pauseVisible: true, pauseIcon: '▶' });
    } else if (this.phase === 'paused') {
      this.engine.onResume();
      this.engine.state.paused = false;
      this.phase = 'running';
      this.pausedAcc += Date.now() - this.pauseTs;
      this.setData({ pauseVisible: false, pauseIcon: '⏸' });
    }
  },

  /* endedBy:'over' 堆到顶自动结束 | 'quit' 暂停界面主动结束 */
  gameOver(endedBy = 'over') {
    this.phase = 'over';
    const s = this.engine.state;
    const duration = Math.round((Date.now() - this.startTs - this.pausedAcc) / 1000);
    const date = new Date().toISOString();

    this.records.unshift({ score: s.score, lines: s.lines, level: s.level, duration, date, end: endedBy });
    this.records = this.records.slice(0, MAX_RECORDS);
    storageSet(KEY_RECORDS, this.records);

    const isNewRecord = !this.best || s.score > this.best.score;
    if (isNewRecord) {
      this.best = { score: s.score, lines: s.lines, level: s.level, date };
      storageSet(KEY_BEST, this.best);
    }

    this.play('gameover');
    this.hudCache = '';
    this.updateHUD();
    this.setData({
      resultVisible: true,
      resultTitle: endedBy === 'quit' ? '本局已结束' : '游戏结束',
      resultEmoji: isNewRecord ? '🏆' : endedBy === 'quit' ? '🏁' : s.lines >= 20 ? '🎉' : '🎮',
      isNewRecord,
      resultScore: fmtScore(s.score),
      resultLines: s.lines,
      resultLevel: s.level,
      resultDuration: fmtDur(duration),
      resultBest: this.best ? fmtScore(this.best.score) : '0',
      pauseIcon: '⏸',
      pauseVisible: false,
    });
  },

  /* 主动结束本局(进行中或已暂停均可) */
  onFinishTap() {
    if (this.phase !== 'running' && this.phase !== 'paused') return;
    this.gameOver('quit');
  },

  /* ---------- 事件:顶栏 ---------- */
  onStartTap() {
    this.startGame();
  },

  onResumeTap() {
    this.togglePause();
  },

  onPauseTap() {
    if (this.phase === 'idle') this.startGame();
    else this.togglePause();
  },

  /* ---------- 事件:触控按钮 ---------- */
  onBtnDown(e) {
    const act = e.currentTarget.dataset.act;
    if (act === 'left' || act === 'right') {
      this.setData({ [`pressed.${act}`]: true });
      this.pressDir(act === 'left' ? -1 : 1);
    } else if (act === 'down') {
      this.setData({ 'pressed.down': true });
      this.held.soft = true;
      this.held.softNext = 0;
    } else if (act === 'rotate') {
      this.act('rotate');
    } else if (act === 'hard') {
      this.act('hard');
    } else if (act === 'hold') {
      this.act('hold');
    }
  },

  onBtnUp(e) {
    const act = e.currentTarget.dataset.act;
    if (act === 'left' || act === 'right') {
      this.setData({ [`pressed.${act}`]: false });
      this.releaseDir(act === 'left' ? -1 : 1);
    } else if (act === 'down') {
      this.setData({ 'pressed.down': false });
      this.held.soft = false;
    }
  },

  /* ---------- 事件:结果浮层与历史 ---------- */
  onRetryTap() {
    this.startGame();
  },

  onHistoryTap() {
    this.setData({
      drawerVisible: true,
      resultVisible: false,
      drawerBestScore: this.best ? fmtScore(this.best.score) : '--',
      drawerBestLines: this.best ? this.best.lines : '--',
      drawerBestLevel: this.best ? this.best.level : '--',
      records: this.records.slice(0, 50).map((r, i) => ({
        key: i,
        scoreText: fmtScore(r.score),
        metaText: `${r.lines} 行 · Lv${r.level} · ${fmtDur(r.duration)}${r.end === 'quit' ? ' · 主动结束' : ''} · ${fmtDate(r.date)}`,
      })),
    });
  },

  onCloseDrawer() {
    this.setData({ drawerVisible: false });
    // 从结果浮层跳转来看历史,关闭后恢复浮层
    if (this.phase === 'over') this.setData({ resultVisible: true });
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
        this.hudCache = '';
        this.updateHUD();
        this.setData({
          records: [],
          drawerBestScore: '--',
          drawerBestLines: '--',
          drawerBestLevel: '--',
        });
      },
    });
  },

  /* ---------- 占位(catchtouchmove 防滚动穿透) ---------- */
  noop() {},

  /* ---------- 分享 ---------- */
  onShareAppMessage() {
    return {
      title: '俄罗斯方块 — 现代标准规则,来战!',
      path: '/pages/tetris/tetris',
    };
  },
});
