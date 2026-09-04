/* ==========================================================
   游戏合集大厅 — 小程序版
   游戏卡片列表 + 应用级主题(auto/light/dark,存 arcade.settings)
   ========================================================== */
'use strict';

const KEY_APP_SETTINGS = 'arcade.settings'; // 应用级设置(theme,合集共用)
const KEY_SCHULTE_BEST = 'schulte.best'; // { size: { time, date } }
const KEY_TETRIS_BEST = 'tetris.best'; // { score, lines, level, date }

const THEME_ICONS = { auto: '🌓', light: '☀️', dark: '🌙' };
const THEMES = ['auto', 'light', 'dark'];

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

Page({
  data: {
    games: [
      {
        id: 'schulte',
        icon: '🔢',
        name: '舒尔特方块',
        desc: '按顺序点击数字,经典的注意力训练',
        bestLabel: '最快',
        bestText: '--',
        comingSoon: false,
      },
      {
        id: 'tetris',
        icon: '🧱',
        name: '俄罗斯方块',
        desc: '现代标准规则:Hold、幽灵投影、硬降与等级加速',
        bestLabel: '',
        bestText: '--',
        comingSoon: true,
      },
    ],
    darkClass: '',
    themeIcon: '🌓',
  },

  /* ---------- 生命周期 ---------- */
  onLoad() {
    // 应用级主题设置(与 schulte 页共用 arcade.settings)
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
  },

  onShow() {
    this.refreshBest();
  },

  onUnload() {
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

  /* ---------- 最高成绩 ---------- */
  refreshBest() {
    // 舒尔特:全模式里最快的一次
    let schulteText = '--';
    const best = storageGet(KEY_SCHULTE_BEST, {});
    let fastest = null;
    for (const size in best) {
      if (!fastest || best[size].time < fastest.time) fastest = best[size];
    }
    if (fastest) schulteText = fastest.time.toFixed(2) + 's';

    // 俄罗斯方块:最高分(上线后生效)
    let tetrisText = '--';
    const tBest = storageGet(KEY_TETRIS_BEST, null);
    if (tBest && tBest.score) tetrisText = fmtScore(tBest.score);

    this.setData({
      'games[0].bestText': schulteText,
      'games[1].bestText': tetrisText,
    });
  },

  /* ---------- 事件 ---------- */
  onGameTap(e) {
    const id = e.currentTarget.dataset.id;
    if (id === 'schulte') {
      wx.navigateTo({ url: '/pages/schulte/schulte' });
      return;
    }
    wx.showToast({ title: '即将上线,敬请期待', icon: 'none' });
  },
});
