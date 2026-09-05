/* ==========================================================
   坦克大战 — 小程序版(单人)
   游戏逻辑:libs/battle-city-engine.js(与 Web 版共用同一算法)
   素材:libs/battle-city-sprites.js(字符像素图 → 离屏 canvas 缓存)
   渲染:canvas type="2d";输入:方向盘 + FIRE;音效:InnerAudioContext
   ========================================================== */
'use strict';

const BattleCityEngine = require('../../libs/battle-city-engine.js');
const BattleCityLevels = require('../../libs/battle-city-levels.js');
const BattleCitySprites = require('../../libs/battle-city-sprites.js');

const KEY_RECORDS = 'battle-city.records';
const KEY_BEST = 'battle-city.best';
const KEY_SETTINGS = 'battle-city.settings'; // 本游戏设置(sound/startStage/wholeBrick)
const KEY_APP_SETTINGS = 'arcade.settings'; // 应用级设置(theme,合集共用)
const MAX_RECORDS = 50;

const FIELD = 208; // 战场逻辑尺寸(26×26 个 8px 子格)
const SPR = BattleCitySprites;

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
    stageNum: 1,
    enemyCount: 20,
    bestText: '--',
    livesText: '❤×3',
    powerText: '★1',
    baseAlive: true,
    overlayVisible: true,
    pauseVisible: false,
    pressed: { fire: false },
    startStage: 1,
    brickWhole: false,
    stickX: 0,
    stickY: 0,
    darkClass: '',
    themeIcon: '🌓',
    pauseIcon: '⏸',
    // 结果浮层
    resultVisible: false,
    resultTitle: '游戏结束',
    resultEmoji: '🎮',
    isNewRecord: false,
    resultScore: '0',
    resultStage: 1,
    resultDuration: '0:00',
    resultBest: '0',
    // 历史抽屉
    drawerVisible: false,
    drawerBestScore: '--',
    drawerBestLevel: '--',
    records: [],
  },

  /* ---------- 生命周期 ---------- */
  onLoad() {
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

    this.settings = Object.assign({ sound: true, startStage: 1, wholeBrick: false }, storageGet(KEY_SETTINGS, {}));
    this.setData({
      startStage: Math.max(1, Math.min(35, this.settings.startStage || 1)),
      brickWhole: !!this.settings.wholeBrick,
    });
    this.records = storageGet(KEY_RECORDS, []);
    this.best = storageGet(KEY_BEST, null);

    this.engine = BattleCityEngine.createBattleCity({ levels: BattleCityLevels });
    this.initSpriteKeys();
    this.engine.RULES.wholeBrick = !!this.settings.wholeBrick;
    this.phase = 'idle'; // idle | running | paused | over
    this.startTs = 0;
    this.pausedAcc = 0;
    this.pauseTs = 0;
    this.input = { dirs: [], fire: false }; // 按下方向栈(最后按下优先)+ 开火
    this.hudCache = '';
    this.terrainKey = '';
    this.enemySig = '';
    this.fx = []; // 爆炸特效 { kind, x, y, t0 }

    /* 音效(短音频用 useWebAudioImplement 降低延迟) */
    const make = (file) => {
      const ctx = wx.createInnerAudioContext({ useWebAudioImplement: true });
      ctx.src = `/assets/sounds/battle-city/${file}`;
      ctx.volume = 0.7;
      return ctx;
    };
    this.sounds = {
      shoot: make('shoot.wav'),
      brick: make('brick.wav'),
      steel: make('steel.wav'),
      cancel: make('cancel.wav'),
      explode: make('explode.wav'),
      'explode-big': make('explode-big.wav'),
      pickup: make('pickup.wav'),
      powerup: make('powerup.wav'),
      'extra-life': make('extra-life.wav'),
      'stage-clear': make('stage-clear.wav'),
      gameover: make('gameover.wav'),
    };

    this.updateHUD(true);
  },

  onReady() {
    const query = wx.createSelectorQuery().in(this);
    query.select('#board').fields({ node: true, size: true });
    query.select('#cv-enemy').fields({ node: true, size: true });
    query.select('.joy').boundingClientRect();
    query.exec((res) => {
      this.joyRect = res[2]; // 摇杆基座几何(触点坐标基准)
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
      this.enemyCv = setup(res[1]);
      this.draw();
      const loop = (now) => {
        this.loop(typeof now === 'number' ? now : Date.now());
        if (this.boardCv) this.boardCv.canvas.requestAnimationFrame(loop);
      };
      if (this.boardCv) this.boardCv.canvas.requestAnimationFrame(loop);
    });
  },

  onUnload() {
    this.boardCv = null; // 停掉 rAF 循环
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

  /* ---------- 精灵物化(离屏 canvas 缓存,渲染只剩 drawImage) ---------- */
  makeSprite(grid, pal) {
    const h = grid.length;
    const w = grid[0].length;
    const cv = wx.createOffscreenCanvas({ type: '2d', width: w, height: h });
    const c = cv.getContext('2d');
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = grid[y][x];
        if (ch === '.' || !pal[ch]) continue;
        c.fillStyle = pal[ch];
        c.fillRect(x, y, 1, 1);
      }
    }
    return cv;
  },

  cachedSprite(kind, variant, grid, pal) {
    const key = `${kind}:${variant}`;
    let cv = this.spriteCache && this.spriteCache.get(key);
    if (!cv) {
      if (!this.spriteCache) this.spriteCache = new Map();
      cv = this.makeSprite(grid, pal);
      this.spriteCache.set(key, cv);
    }
    return cv;
  },

  /* 坦克:variant = 调色板键,dir 0-3 */
  tankSprite(palKey, dir) {
    return this.cachedSprite('tank', `${palKey}:${dir}`, SPR.TANK_DIRS[dir], SPR.TANK_PALETTES[palKey]);
  },

  armorPalKey(hp) {
    return hp >= 4 ? 'armor4' : hp === 3 ? 'armor3' : hp === 2 ? 'armor2' : 'armor1';
  },

  tileSprite(code, frame) {
    const TILE_KEYS = { B: 'brick', S: 'steel', W: 'water', T: 'trees', I: 'ice' };
    const tile = SPR.TILES[TILE_KEYS[code]];
    return this.cachedSprite(`tile:${code}`, frame, tile.frames[frame % tile.frames.length], tile.pal);
  },

  spriteGrid(obj, frame) {
    return this.cachedSprite(obj._key, frame, obj.frames[frame % obj.frames.length], obj.pal);
  },

  initSpriteKeys() {
    SPR.EXPLODE_SMALL._key = 'exs';
    SPR.EXPLODE_BIG._key = 'exb';
    SPR.SPAWN_STAR._key = 'star';
    SPR.SHIELD._key = 'shield';
  },

  /* ---------- 静态地形层(离屏;树单独一层置顶) ---------- */
  ensureTerrainBuffers() {
    if (this.terrainCv) return;
    this.terrainCv = wx.createOffscreenCanvas({ type: '2d', width: FIELD, height: FIELD });
    this.tctx = this.terrainCv.getContext('2d');
    this.treesCv = wx.createOffscreenCanvas({ type: '2d', width: FIELD, height: FIELD });
    this.trctx = this.treesCv.getContext('2d');
  },

  rebuildTerrain(waterFrame) {
    this.ensureTerrainBuffers();
    const s = this.engine.state;
    this.tctx.clearRect(0, 0, FIELD, FIELD);
    this.trctx.clearRect(0, 0, FIELD, FIELD);
    for (let sy = 0; sy < 26; sy++) {
      for (let sx = 0; sx < 26; sx++) {
        const code = s.terrain[sy][sx];
        if (!code || code === 'F') continue; // 基地单独画
        const target = code === 'T' ? this.trctx : this.tctx;
        target.drawImage(this.tileSprite(code, waterFrame), sx * 8, sy * 8);
      }
    }
  },

  /* ---------- 特效 ---------- */
  addFx(kind, x, y) {
    this.fx.push({ kind, x, y, t0: Date.now() });
  },

  drawFx(ctx, now) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      const t = now - f.t0;
      const life = f.kind === 'big' ? 500 : 200;
      if (t > life) {
        this.fx.splice(i, 1);
        continue;
      }
      const seq = f.kind === 'big' ? SPR.EXPLODE_BIG : SPR.EXPLODE_SMALL;
      const fIdx = f.kind === 'big' ? (t < 166 ? 0 : t < 333 ? 1 : 2) : t < 100 ? 0 : 1;
      const size = f.kind === 'big' ? 32 : 16;
      ctx.drawImage(this.spriteGrid(seq, fIdx), f.x + 8 - size / 2, f.y + 8 - size / 2);
    }
  },

  /* ---------- 事件 → 音效/特效 ---------- */
  onEvents(events, now) {
    for (const ev of events) {
      switch (ev.type) {
        case 'shoot': this.play('shoot'); break;
        case 'brick': this.play('brick'); this.addFx('small', ev.x, ev.y); break;
        case 'steel': this.play('steel'); this.addFx('small', ev.x, ev.y); break;
        case 'bullet-cancel': this.play('cancel'); break;
        case 'explode':
          this.play(ev.big ? 'explode-big' : 'explode');
          if (ev.big) this.addFx('big', ev.x, ev.y);
          break;
        case 'powerup-spawn': this.play('powerup'); break;
        case 'powerup-get': this.play('pickup'); break;
        case 'extra-life': this.play('extra-life'); break;
        case 'stage-clear': this.play('stage-clear'); break;
        case 'game-over': this.play('gameover'); break;
        case 'friendly-freeze': this.play('cancel'); break;
      }
    }
  },

  /* ---------- 主循环 ---------- */
  pressDir(dir) {
    const stack = this.input.dirs;
    const i = stack.indexOf(dir);
    if (i >= 0) stack.splice(i, 1);
    stack.push(dir);
  },

  releaseDir(dir) {
    const stack = this.input.dirs;
    const i = stack.indexOf(dir);
    if (i >= 0) stack.splice(i, 1);
  },

  loop(now) {
    if (this.phase === 'running') {
      const s = this.engine.state;
      this.engine.setInput(0, {
        dir: this.input.dirs[this.input.dirs.length - 1] || null,
        fire: this.input.fire,
      });
      this.engine.tick(now);
      this.onEvents(this.engine.drainEvents(), now);
      if (s.over) this.gameOver('over', s.overReason);
    }
    this.draw();
  },

  /* ---------- 渲染 ---------- */
  draw() {
    const b = this.boardCv;
    if (!b) return;
    const s = this.engine.state;
    const now = Date.now();
    const ctx = b.ctx;
    ctx.imageSmoothingEnabled = false;
    const scale = b.w / FIELD;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, FIELD, FIELD);

    /* 地形层(砖/钢/河/冰 + 树层);水帧翻转时重建 */
    const waterFrame = Math.floor(now / 400) % 2;
    let sig = '';
    for (let y = 0; y < 26; y++) sig += s.terrain[y].join('');
    const key = `${sig}|${waterFrame}`;
    if (key !== this.terrainKey) {
      this.terrainKey = key;
      this.rebuildTerrain(waterFrame);
    }
    ctx.drawImage(this.terrainCv, 0, 0);

    /* 基地 */
    ctx.drawImage(
      this.cachedSprite('base', s.base.alive ? 'alive' : 'dead', SPR.BASE.frames[s.base.alive ? 0 : 1], SPR.BASE.pal),
      s.base.x, s.base.y
    );

    /* 道具(闪烁) */
    if (s.powerup && Math.floor(now / 160) % 3 !== 2) {
      const icon = SPR.POWERUP.icons[s.powerup.type];
      ctx.drawImage(this.cachedSprite('pw', s.powerup.type, icon, SPR.POWERUP.pal), s.powerup.x, s.powerup.y);
    }

    /* 子弹 */
    const bullet = this.cachedSprite('bullet', '0', SPR.BULLET.grid, SPR.BULLET.pal);
    for (const bl of s.bullets) ctx.drawImage(bullet, bl.x, bl.y);

    /* 敌人 */
    const flash = Math.floor(now / 120) % 2 === 0;
    for (const e of s.enemies) {
      if (e.spawnMs > 0) {
        ctx.drawImage(this.spriteGrid(SPR.SPAWN_STAR, Math.floor(now / 100) % 3), e.x, e.y);
        continue;
      }
      let palKey = e.type === 'armor' ? this.armorPalKey(e.hp) : e.type;
      if (e.bonus && flash) palKey = 'bonus';
      ctx.drawImage(this.tankSprite(palKey, e.dir), e.x, e.y);
    }

    /* 玩家 */
    for (const p of s.players) {
      if (p.dead || p.pendingSpawn) continue;
      ctx.drawImage(this.tankSprite(p.id === 0 ? 'p1' : 'p2', p.dir), p.x, p.y);
      if (p.shieldMs > 0) {
        ctx.drawImage(this.spriteGrid(SPR.SHIELD, Math.floor(now / 100) % 2), p.x, p.y);
      }
    }

    /* 爆炸特效 */
    this.drawFx(ctx, now);

    /* 铁锹到期前 3s 钢墙闪烁(钢↔砖) */
    if (s.shovelMs > 0 && s.shovelMs < 3000 && Math.floor(now / 250) % 2 === 0) {
      for (const [cx, cy] of this.engine.BASE_WALL_TILES) {
        ctx.drawImage(this.tileSprite('B', 0), cx * 16, cy * 16);
      }
    }

    /* 树层置顶(遮挡坦克) */
    ctx.drawImage(this.treesCv, 0, 0);

    /* 幕布:开局 STAGE N / 过关 */
    if (this.phase === 'running' || this.phase === 'paused') {
      if (s.phase === 'intro') {
        this.curtain(ctx, `STAGE ${s.stage}`);
      } else if (s.phase === 'stage-clear') {
        this.curtain(ctx, `STAGE ${s.stage} CLEAR!`);
      }
    }

    this.drawEnemyIcons();
    this.updateHUD();
  },

  curtain(ctx, text) {
    ctx.fillStyle = 'rgba(8, 10, 16, 0.78)';
    ctx.fillRect(0, 0, FIELD, FIELD);
    ctx.fillStyle = '#e8e8e8';
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, FIELD / 2, FIELD / 2);
  },

  /* 剩余敌军图标(5×4 格) */
  drawEnemyIcons() {
    const c = this.enemyCv;
    if (!c) return;
    const s = this.engine.state;
    const remaining = s.spawnQueue.length - s.spawnedCount + s.enemies.length;
    if (String(remaining) === this.enemySig) return;
    this.enemySig = String(remaining);
    const ctx = c.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.w, c.h);
    const cell = c.w / 5;
    const icon = this.tankSprite('basic', 2);
    for (let i = 0; i < remaining && i < 20; i++) {
      ctx.drawImage(icon, (i % 5) * cell + cell * 0.1, Math.floor(i / 5) * cell + cell * 0.1, cell * 0.8, cell * 0.8);
    }
  },

  /* ---------- HUD ---------- */
  updateHUD(force) {
    const s = this.engine.state;
    const remaining = s.spawnQueue.length - s.spawnedCount + s.enemies.length;
    const key = `${s.players[0].score}|${s.stage}|${remaining}|${s.base.alive}|${s.players[0].lives}|${s.players[0].power}`;
    if (!force && key === this.hudCache) return;
    this.hudCache = key;
    this.setData({
      displayScore: fmtScore(s.players[0].score),
      stageNum: s.stage,
      enemyCount: remaining,
      bestText: this.best ? fmtScore(this.best.score) : '--',
      livesText: `❤×${Math.max(0, s.players[0].lives)}`,
      powerText: `★${s.players[0].power}`,
      baseAlive: s.base.alive,
    });
  },

  /* ---------- 游戏流程 ---------- */
  startGame() {
    this.engine.reset({ stage: this.settings.startStage || 1, players: 1 });
    this.input = { dirs: [], fire: false };
    this.fx = [];
    this.phase = 'running';
    this.startTs = Date.now();
    this.pausedAcc = 0;
    this.terrainKey = '';
    this.enemySig = '';
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
      this.engine.state.paused = false;
      this.phase = 'running';
      this.pausedAcc += Date.now() - this.pauseTs;
      this.setData({ pauseVisible: false, pauseIcon: '⏸' });
    }
  },

  /* endedBy:'over'(基地被毁/命尽) | 'quit' 暂停界面主动结束 */
  gameOver(endedBy, reason) {
    this.phase = 'over';
    const s = this.engine.state;
    const duration = Math.round((Date.now() - this.startTs - this.pausedAcc) / 1000);
    const date = new Date().toISOString();
    const score = s.players[0].score;

    this.records.unshift({ score, level: s.stage, date, end: endedBy, player: '1P' });
    this.records = this.records.slice(0, MAX_RECORDS);
    storageSet(KEY_RECORDS, this.records);

    const isNewRecord = !this.best || score > this.best.score;
    if (isNewRecord) {
      this.best = { score, level: s.stage, date };
      storageSet(KEY_BEST, this.best);
    }

    this.hudCache = '';
    this.updateHUD();
    this.setData({
      resultVisible: true,
      resultTitle: endedBy === 'quit' ? '本局已结束' : reason === 'base' ? '基地被毁' : '全军覆没',
      resultEmoji: endedBy === 'quit' ? '🏁' : isNewRecord ? '🏆' : reason === 'base' ? '💥' : '💀',
      isNewRecord,
      resultScore: fmtScore(score),
      resultStage: s.stage,
      resultDuration: fmtDur(duration),
      resultBest: this.best ? fmtScore(this.best.score) : '0',
      pauseIcon: '⏸',
      pauseVisible: false,
    });
  },

  /* 主动结束本局(进行中或已暂停均可) */
  onFinishTap() {
    if (this.phase !== 'running' && this.phase !== 'paused') return;
    this.engine.state.over = true;
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

  /* ---------- 事件:起始关卡与砖块模式 ---------- */
  onStageDown() {
    this.changeStage(-1);
  },

  onStageUp() {
    this.changeStage(1);
  },

  changeStage(d) {
    const cur = this.settings.startStage || 1;
    const next = Math.max(1, Math.min(35, cur + d));
    if (next === cur) return;
    this.settings.startStage = next;
    storageSet(KEY_SETTINGS, this.settings);
    this.setData({ startStage: next });
  },

  onBrickTap() {
    this.settings.wholeBrick = !this.settings.wholeBrick;
    storageSet(KEY_SETTINGS, this.settings);
    this.engine.RULES.wholeBrick = !!this.settings.wholeBrick;
    this.setData({ brickWhole: !!this.settings.wholeBrick });
  },

  /* ---------- 事件:触控摇杆 + FIRE ---------- */
  /* 摇杆:按住拖动即转向,不抬手也能顺滑切换方向(死区 25% 半径,主轴取分量大者) */
  onJoyStart(e) {
    const t = e.touches && e.touches[0];
    if (!t) return;
    this.joyActive = true;
    this.joyUpdate(t.clientX, t.clientY);
  },

  onJoyMove(e) {
    if (!this.joyActive) return;
    const t = e.touches && e.touches[0];
    if (t) this.joyUpdate(t.clientX, t.clientY);
  },

  onJoyEnd() {
    if (!this.joyActive) return;
    this.joyActive = false;
    if (this.joyDir) {
      this.releaseDir(this.joyDir);
      this.joyDir = null;
    }
    this.setData({ stickX: 0, stickY: 0 });
  },

  joyUpdate(x, y) {
    const r = this.joyRect;
    if (!r) return;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const radius = r.width / 2;
    const dx = x - cx;
    const dy = y - cy;
    const mag = Math.hypot(dx, dy);
    /* 旋钮视觉偏移:限制在 55% 半径内;变化 ≥1px 才 setData */
    const k = mag ? Math.min(mag, radius * 0.55) / mag : 0;
    const kx = Math.round(dx * k);
    const ky = Math.round(dy * k);
    if (kx !== this.data.stickX || ky !== this.data.stickY) {
      this.setData({ stickX: kx, stickY: ky });
    }
    let dir = null;
    if (mag > radius * 0.25) {
      dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    }
    if (dir !== this.joyDir) {
      if (this.joyDir) this.releaseDir(this.joyDir);
      if (dir) this.pressDir(dir);
      this.joyDir = dir;
    }
  },

  onFireDown() {
    this.setData({ 'pressed.fire': true });
    this.input.fire = true;
  },

  onFireUp() {
    this.setData({ 'pressed.fire': false });
    this.input.fire = false;
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
      drawerBestLevel: this.best ? this.best.level : '--',
      records: this.records.slice(0, 50).map((r, i) => ({
        key: i,
        scoreText: fmtScore(r.score),
        metaText: `${r.player} · 第 ${r.level} 关 · ${r.end === 'quit' ? '主动结束' : '战败'} · ${fmtDate(r.date)}`,
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
      title: '坦克大战 — 红白机经典复刻,保卫基地!',
      path: '/pages/battle-city/battle-city',
    };
  },
});
