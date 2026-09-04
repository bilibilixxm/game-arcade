/* ==========================================================
   舒尔特方块 — 小程序版游戏逻辑
   状态机: idle → (点击数字 1) → running → (点完所有数字) → finished
   与网页版 app.js 功能 1:1,DOM 操作替换为 setData
   ========================================================== */
'use strict';

const MODES = [2, 3, 4, 5, 6, 7, 8]; // 方阵边长
const KEY_RECORDS = 'schulte.records';
const KEY_BEST = 'schulte.best';
const KEY_SETTINGS = 'schulte.settings'; // 本游戏设置(sound/hint)
const KEY_APP_SETTINGS = 'arcade.settings'; // 应用级设置(theme,合集共用)
const MAX_RECORDS = 100;
const BOARD = 686; // 棋盘宽 rpx(750 - 2×32 页边距)

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

function fmtTime(sec) {
  return sec.toFixed(2);
}

function fmtDate(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

Page({
  data: {
    modes: [], // [{ size, bestText }]
    size: 5,
    total: 25,
    cellFont: 60, // 方块数字字号 rpx
    boardGap: 12,
    cells: [], // [{ value, done, wrong, hint }]
    phase: 'idle',
    progress: 0,
    nextDisplay: '1',
    displayTime: '0.00',
    bestText: '--',
    overlayVisible: true,
    resultVisible: false,
    drawerVisible: false,
    soundOn: true,
    hintOn: true,
    darkClass: '',
    themeIcon: '🌓',
    records: [], // 抽屉展示用的已格式化列表
    // 结果浮层
    resultEmoji: '🎉',
    resultTitle: '训练完成',
    isNewRecord: false,
    resultTime: '',
    resultErrors: 0,
    resultBest: '',
  },

  /* ---------- 生命周期 ---------- */
  onLoad() {
    // 应用级主题设置(合集共用;老版本主题偏好存在 schulte.settings 里,做一次迁移)
    this.appSettings = Object.assign({ theme: 'auto' }, storageGet(KEY_APP_SETTINGS, {}));
    const legacy = storageGet(KEY_SETTINGS, {});
    if (!storageGet(KEY_APP_SETTINGS, null) && legacy.theme) {
      this.appSettings.theme = legacy.theme;
      storageSet(KEY_APP_SETTINGS, this.appSettings);
    }
    // 本游戏设置
    this.settings = Object.assign({ sound: true, hint: true }, legacy);
    // 系统主题(darkmode:true 时 getAppBaseInfo 返回 theme)
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

    // 音效(短音频用 useWebAudioImplement 降低延迟)
    const make = (file) => {
      const ctx = wx.createInnerAudioContext({ useWebAudioImplement: true });
      ctx.src = `/assets/sounds/schulte/${file}`;
      ctx.volume = 0.8;
      return ctx;
    };
    this.sounds = { hit: make('hit.wav'), wrong: make('wrong.wav'), finish: make('finish.wav') };

    this.records = storageGet(KEY_RECORDS, []);
    this.best = storageGet(KEY_BEST, {});
    this.next = 1;
    this.errors = 0;
    this.phase = 'idle';
    this.hintIdx = -1;
    this.timer = null;
    this.wrongTimers = {};

    this.setData({
      soundOn: this.settings.sound,
      hintOn: this.settings.hint,
    });
    this.applyTheme();
    this.renderModes();
    this.newGame(true);
  },

  onUnload() {
    this.clearTimer();
    Object.values(this.wrongTimers).forEach(clearTimeout);
    Object.values(this.sounds).forEach((s) => s.destroy());
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

  /* ---------- 音效 ---------- */
  play(name) {
    if (!this.settings.sound) return;
    const s = this.sounds[name];
    if (!s) return;
    s.stop();
    s.play();
  },

  /* ---------- 存储 ---------- */
  bestOf(size) {
    return this.best[size] || null;
  },

  /* ---------- 渲染辅助 ---------- */
  renderModes() {
    this.setData({
      modes: MODES.map((size) => ({
        size,
        bestText: this.bestOf(size) ? fmtTime(this.bestOf(size).time) + 's' : '--',
      })),
    });
  },

  // 按模式计算方块间隙与数字字号(方块边长由 grid 1fr 自动均分)
  layoutBoard(size) {
    const gap = size >= 8 ? 8 : 12;
    const cellSize = Math.floor((BOARD - (size - 1) * gap) / size);
    return { boardGap: gap, cellFont: Math.round(cellSize * 0.48) };
  },

  updateHint() {
    const patch = {};
    if (this.hintIdx >= 0) patch[`cells[${this.hintIdx}].hint`] = false;
    this.hintIdx = -1;
    if (this.settings.hint && this.phase !== 'finished' && this.next <= this.data.total) {
      const idx = this.data.cells.findIndex((c) => c.value === this.next && !c.done);
      if (idx >= 0) {
        patch[`cells[${idx}].hint`] = true;
        this.hintIdx = idx;
      }
    }
    if (Object.keys(patch).length) this.setData(patch);
  },

  updateStats() {
    const b = this.bestOf(this.data.size);
    this.setData({
      bestText: b ? fmtTime(b.time) + 's' : '--',
      nextDisplay: this.phase === 'finished' ? '✓' : String(this.next),
      progress: this.next - 1,
    });
  },

  /* ---------- 游戏流程 ---------- */
  newGame(showOverlay) {
    this.clearTimer();
    this.phase = 'idle';
    this.next = 1;
    this.errors = 0;
    this.hintIdx = -1;
    const size = this.data.size;
    const total = size * size;
    const nums = shuffle(Array.from({ length: total }, (_, i) => i + 1));
    const cells = nums.map((v) => ({
      value: v,
      done: false,
      wrong: false,
      hint: this.settings.hint && v === 1,
    }));
    if (cells.some((c) => c.hint)) this.hintIdx = cells.findIndex((c) => c.hint);
    this.setData({
      cells,
      total,
      overlayVisible: showOverlay,
      displayTime: '0.00',
      ...this.layoutBoard(size),
    });
    this.updateStats();
  },

  onCellTap(e) {
    const index = e.currentTarget.dataset.index;
    const value = e.currentTarget.dataset.value;
    const cell = this.data.cells[index];
    if (!cell || cell.done || this.phase === 'finished') return;

    if (value === this.next) {
      // ---- 正确 ----
      if (this.phase === 'idle') {
        this.phase = 'running';
        this.setData({ overlayVisible: false });
        this.startTimer(); // 点击第一个方块才开始计时
      }
      const patch = { [`cells[${index}].done`]: true };
      if (this.hintIdx === index) {
        patch[`cells[${index}].hint`] = false;
        this.hintIdx = -1;
      }
      this.setData(patch);
      this.play('hit');
      this.next++;
      this.updateStats();
      this.updateHint();
      if (this.next > this.data.total) this.finish();
    } else {
      // ---- 错误(仅在计时开始后计入错误次数) ----
      if (this.phase === 'running') this.errors++;
      this.triggerWrong(index);
      this.play('wrong');
      wx.vibrateShort({ type: 'light' });
    }
  },

  triggerWrong(index) {
    const timers = this.wrongTimers;
    if (timers[index]) clearTimeout(timers[index]);
    if (!this.data.cells[index].wrong) {
      this.setData({ [`cells[${index}].wrong`]: true });
    }
    timers[index] = setTimeout(() => {
      this.setData({ [`cells[${index}].wrong`]: false });
      delete timers[index];
    }, 350);
  },

  /* ---------- 计时 ---------- */
  startTimer() {
    this.startTime = Date.now();
    this.timer = setInterval(() => {
      this.setData({ displayTime: fmtTime((Date.now() - this.startTime) / 1000) });
    }, 33);
  },

  clearTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  stopTimer() {
    this.clearTimer();
    return (Date.now() - this.startTime) / 1000;
  },

  /* ---------- 完成 ---------- */
  finish() {
    this.phase = 'finished';
    const elapsed = Math.round(this.stopTimer() * 100) / 100;
    this.setData({ displayTime: fmtTime(elapsed) });
    this.updateStats();

    // 写入训练记录
    const date = new Date().toISOString();
    this.records.unshift({ mode: this.data.size, time: elapsed, date, errors: this.errors });
    this.records = this.records.slice(0, MAX_RECORDS);
    storageSet(KEY_RECORDS, this.records);

    // 破纪录判定
    const prev = this.bestOf(this.data.size);
    const isNewRecord = !prev || elapsed < prev.time;
    if (isNewRecord) {
      this.best[this.data.size] = { time: elapsed, date };
      storageSet(KEY_BEST, this.best);
      this.renderModes();
      this.updateStats(); // 状态栏的最佳成绩同步刷新
    }

    this.play('finish');
    this.setData({
      resultVisible: true,
      resultEmoji: isNewRecord ? '🏆' : this.errors === 0 ? '🎉' : '💪',
      resultTitle: isNewRecord ? '打破纪录!' : '训练完成',
      isNewRecord,
      resultTime: fmtTime(elapsed) + ' 秒',
      resultErrors: this.errors,
      resultBest: fmtTime(this.best[this.data.size].time) + ' 秒',
    });
  },

  /* ---------- 事件:顶部与模式 ---------- */
  onModeTap(e) {
    const size = Number(e.currentTarget.dataset.size);
    if (size === this.data.size) return;
    this.setData({ size });
    this.renderModes();
    this.newGame(true);
  },

  onRestartTap() {
    this.setData({ resultVisible: false });
    this.newGame(false);
  },

  onStartTap() {
    this.setData({ overlayVisible: false });
  },

  /* ---------- 事件:设置开关 ---------- */
  onSoundChange(e) {
    this.settings.sound = e.detail.value;
    storageSet(KEY_SETTINGS, this.settings);
  },

  onHintChange(e) {
    this.settings.hint = e.detail.value;
    storageSet(KEY_SETTINGS, this.settings);
    this.updateHint();
  },

  /* ---------- 事件:结果浮层 ---------- */
  onRetryTap() {
    this.setData({ resultVisible: false });
    this.newGame(false);
  },

  /* ---------- 事件:历史抽屉 ---------- */
  onHistoryTap() {
    this.setData({
      drawerVisible: true,
      resultVisible: false,
      records: this.records.slice(0, 50).map((r, i) => ({
        key: i,
        modeText: `${r.mode}×${r.mode}`,
        timeText: fmtTime(r.time) + 's',
        metaText: fmtDate(r.date) + (r.errors > 0 ? ` · 错${r.errors}` : ''),
      })),
    });
  },

  onCloseDrawer() {
    this.setData({ drawerVisible: false });
    // 从结果浮层跳转来看历史,关闭后恢复浮层
    if (this.phase === 'finished') this.setData({ resultVisible: true });
  },

  onClearTap() {
    wx.showModal({
      title: '清空记录',
      content: '确定清空全部训练记录吗?此操作不可恢复。',
      confirmText: '清空',
      confirmColor: '#e5484d',
      success: (res) => {
        if (!res.confirm) return;
        this.records = [];
        this.best = {};
        storageSet(KEY_RECORDS, this.records);
        storageSet(KEY_BEST, this.best);
        this.renderModes();
        this.updateStats();
        this.setData({ records: [] });
      },
    });
  },

  /* ---------- 分享 ---------- */
  onShareAppMessage() {
    return {
      title: '舒尔特方块 — 来挑战你的注意力极限!',
      path: '/pages/schulte/schulte',
    };
  },
});
