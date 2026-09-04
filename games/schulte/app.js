/* ==========================================================
   舒尔特方块 — 纯前端注意力训练游戏
   状态机: idle → (点击数字 1) → running → (点完所有数字) → finished
   ========================================================== */
'use strict';

/* ---------- 常量与存储 ---------- */
const MODES = [2, 3, 4, 5, 6, 7, 8]; // 方阵边长
const KEY_RECORDS = 'schulte.records';
const KEY_BEST = 'schulte.best';
const KEY_SETTINGS = 'schulte.settings';
const MAX_RECORDS = 100;

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式等场景下静默失败 */
  }
}

let records = loadJSON(KEY_RECORDS, []); // [{ mode, time, date, errors }]
let best = loadJSON(KEY_BEST, {}); // { [size]: { time, date } }
let settings = Object.assign(
  { sound: true, hint: true, theme: 'auto' },
  loadJSON(KEY_SETTINGS, {})
);

/* ---------- 游戏状态 ---------- */
const state = {
  size: 5,
  phase: 'idle', // idle | running | finished
  next: 1, // 下一个要点的数字
  errors: 0,
  startTime: 0,
  rafId: 0,
};

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const board = $('board');
const modeBar = $('mode-bar');
const startOverlay = $('start-overlay');
const statTime = $('stat-time');
const statProgress = $('stat-progress');
const statTotal = $('stat-total');
const statNext = $('stat-next');
const statBest = $('stat-best');
const startTotal = $('start-total');
const resultModal = $('result-modal');
const drawer = $('drawer');
const drawerMask = $('drawer-mask');

/* ---------- 工具 ---------- */
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

function bestOf(size) {
  return best[size] || null;
}

/* ---------- 音效(Web Audio 合成) ---------- */
let audioCtx = null;

function ensureAudio() {
  if (!settings.sound) return null;
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function tone(freq, when, dur, type = 'sine', gain = 0.12) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(gain, ctx.currentTime + when);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + when + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(ctx.currentTime + when);
  osc.stop(ctx.currentTime + when + dur + 0.05);
}

const sfx = {
  hit() {
    tone(880, 0, 0.07, 'triangle');
  },
  wrong() {
    tone(170, 0, 0.16, 'sawtooth', 0.1);
  },
  finish() {
    tone(523.25, 0, 0.12, 'triangle');
    tone(659.25, 0.12, 0.12, 'triangle');
    tone(783.99, 0.24, 0.25, 'triangle');
  },
};

/* ---------- 计时 ---------- */
function tick() {
  statTime.textContent = fmtTime((performance.now() - state.startTime) / 1000);
  state.rafId = requestAnimationFrame(tick);
}

function startTimer() {
  state.startTime = performance.now();
  state.rafId = requestAnimationFrame(tick);
}

function stopTimer() {
  cancelAnimationFrame(state.rafId);
  return (performance.now() - state.startTime) / 1000;
}

/* ---------- 渲染 ---------- */
function renderModeBar() {
  modeBar.innerHTML = '';
  for (const size of MODES) {
    const btn = document.createElement('button');
    btn.className = 'mode-btn' + (size === state.size ? ' active' : '');
    const b = bestOf(size);
    btn.innerHTML = `<span class="mode-name">${size}×${size}</span>
      <span class="mode-best">${b ? fmtTime(b.time) + 's' : '--'}</span>`;
    btn.addEventListener('click', () => {
      if (state.size !== size) {
        state.size = size;
        renderModeBar();
        newGame(true);
      }
    });
    modeBar.appendChild(btn);
  }
}

function renderBoard() {
  board.innerHTML = '';
  board.style.gridTemplateColumns = `repeat(${state.size}, 1fr)`;
  const nums = shuffle(Array.from({ length: state.size * state.size }, (_, i) => i + 1));
  for (const n of nums) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.textContent = n;
    cell.dataset.value = n;
    cell.addEventListener('click', onCellClick);
    board.appendChild(cell);
  }
}

function cellByValue(v) {
  return board.querySelector(`.cell[data-value="${v}"]`);
}

function updateHint() {
  board.querySelectorAll('.cell.hint').forEach((c) => c.classList.remove('hint'));
  if (settings.hint && state.phase !== 'finished' && state.next <= state.size * state.size) {
    const cell = cellByValue(state.next);
    if (cell && !cell.classList.contains('done')) cell.classList.add('hint');
  }
}

function updateStats() {
  const total = state.size * state.size;
  statTotal.textContent = total;
  startTotal.textContent = total;
  statProgress.textContent = state.next - 1;
  statNext.textContent = state.phase === 'finished' ? '✓' : state.next;
  const b = bestOf(state.size);
  statBest.textContent = b ? fmtTime(b.time) + 's' : '--';
}

/* ---------- 游戏流程 ---------- */
function newGame(showOverlay) {
  stopTimer();
  state.phase = 'idle';
  state.next = 1;
  state.errors = 0;
  statTime.textContent = '0.00';
  renderBoard();
  updateStats();
  startOverlay.hidden = !showOverlay;
}

function onCellClick(e) {
  const cell = e.currentTarget;
  const value = Number(cell.dataset.value);
  if (cell.classList.contains('done')) return; // 已点过,无反应
  const total = state.size * state.size;

  if (state.phase === 'finished') return;

  if (value === state.next) {
    // ---- 正确 ----
    if (state.phase === 'idle') {
      state.phase = 'running';
      startOverlay.hidden = true;
      startTimer(); // 点击第一个方块才开始计时
    }
    cell.classList.add('done');
    sfx.hit();
    state.next++;
    updateStats();
    updateHint();
    if (state.next > total) finish();
  } else {
    // ---- 错误(仅在计时开始后计入错误次数) ----
    if (state.phase === 'running') state.errors++;
    cell.classList.remove('wrong');
    void cell.offsetWidth; // 重置动画
    cell.classList.add('wrong');
    sfx.wrong();
  }
}

function finish() {
  state.phase = 'finished';
  const elapsed = Math.round(stopTimer() * 100) / 100;
  statTime.textContent = fmtTime(elapsed);
  updateStats();
  updateHint();

  // 写入训练记录
  const date = new Date().toISOString();
  records.unshift({ mode: state.size, time: elapsed, date, errors: state.errors });
  records = records.slice(0, MAX_RECORDS);
  saveJSON(KEY_RECORDS, records);

  // 破纪录判定
  const prev = bestOf(state.size);
  const isNewRecord = !prev || elapsed < prev.time;
  if (isNewRecord) {
    best[state.size] = { time: elapsed, date };
    saveJSON(KEY_BEST, best);
    renderModeBar();
    updateStats(); // 状态栏的最佳成绩同步刷新
  }

  // 结果浮层
  sfx.finish();
  $('result-emoji').textContent = isNewRecord ? '🏆' : state.errors === 0 ? '🎉' : '💪';
  $('result-title').textContent = isNewRecord ? '打破纪录!' : '训练完成';
  $('result-record').hidden = !isNewRecord;
  $('result-time').textContent = fmtTime(elapsed) + ' 秒';
  $('result-errors').textContent = state.errors;
  $('result-best').textContent = fmtTime(best[state.size].time) + ' 秒';
  resultModal.hidden = false;
}

/* ---------- 主题 ---------- */
const THEMES = ['auto', 'light', 'dark'];
const THEME_META = {
  auto: { icon: '🌓', label: '主题:跟随系统' },
  light: { icon: '☀️', label: '主题:浅色' },
  dark: { icon: '🌙', label: '主题:深色' },
};

function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
  const meta = THEME_META[settings.theme] || THEME_META.auto;
  const btn = $('btn-theme');
  btn.textContent = meta.icon;
  btn.title = meta.label;
}

/* ---------- 历史抽屉 ---------- */
function renderDrawer() {
  // 各模式最快成绩
  const bestGrid = $('best-grid');
  bestGrid.innerHTML = '';
  for (const size of MODES) {
    const b = bestOf(size);
    const item = document.createElement('div');
    item.className = 'best-item';
    item.innerHTML = `<span class="best-mode">${size}×${size}</span>
      <span class="best-time">${b ? fmtTime(b.time) + 's' : '--'}</span>`;
    if (b) item.title = '达成于 ' + fmtDate(b.date);
    bestGrid.appendChild(item);
  }

  // 最近训练明细
  const list = $('record-list');
  list.innerHTML = '';
  if (records.length === 0) {
    list.innerHTML = '<li class="record-empty">暂无训练记录,快开始第一次训练吧!</li>';
    return;
  }
  for (const r of records.slice(0, 50)) {
    const li = document.createElement('li');
    li.className = 'record-item';
    li.innerHTML = `<span class="rec-mode">${r.mode}×${r.mode}</span>
      <span class="rec-time">${fmtTime(r.time)}s</span>
      <span class="rec-meta">${fmtDate(r.date)}${r.errors > 0 ? ` · 错${r.errors}` : ''}</span>`;
    list.appendChild(li);
  }
}

function openDrawer() {
  renderDrawer();
  drawer.hidden = false;
  drawerMask.hidden = false;
}

function closeDrawer() {
  drawer.hidden = true;
  drawerMask.hidden = true;
  // 从结果浮层跳转来看历史,关闭后恢复浮层
  if (state.phase === 'finished' && resultModal.hidden) resultModal.hidden = false;
}

function clearRecords() {
  if (!confirm('确定清空全部训练记录吗?此操作不可恢复。')) return;
  records = [];
  best = {};
  saveJSON(KEY_RECORDS, records);
  saveJSON(KEY_BEST, best);
  renderModeBar();
  renderDrawer();
  updateStats();
}

/* ---------- 事件绑定 ---------- */
$('btn-start').addEventListener('click', () => {
  startOverlay.hidden = true;
  ensureAudio();
});

$('btn-retry').addEventListener('click', () => {
  resultModal.hidden = true;
  newGame(false);
});

$('btn-history2').addEventListener('click', () => {
  resultModal.hidden = true;
  openDrawer();
});

$('btn-history').addEventListener('click', openDrawer);
$('btn-close-drawer').addEventListener('click', closeDrawer);
drawerMask.addEventListener('click', closeDrawer);
$('btn-clear').addEventListener('click', clearRecords);

$('btn-restart').addEventListener('click', () => {
  resultModal.hidden = true;
  newGame(false);
});

$('btn-theme').addEventListener('click', () => {
  const idx = THEMES.indexOf(settings.theme);
  settings.theme = THEMES[(idx + 1) % THEMES.length] || 'auto';
  saveJSON(KEY_SETTINGS, settings);
  applyTheme();
});

$('switch-sound').addEventListener('change', (e) => {
  settings.sound = e.target.checked;
  saveJSON(KEY_SETTINGS, settings);
  if (settings.sound) ensureAudio();
});

$('switch-hint').addEventListener('change', (e) => {
  settings.hint = e.target.checked;
  saveJSON(KEY_SETTINGS, settings);
  updateHint();
});

/* ---------- 初始化 ---------- */
$('switch-sound').checked = settings.sound;
$('switch-hint').checked = settings.hint;
applyTheme();
renderModeBar();
newGame(true);

/* ---------- PWA:Service Worker 注册 ----------
   仅在 https 或 localhost(secure context)下注册;
   双击 index.html(file://)打开时自动跳过,功能不受影响 */
if (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname)) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('../../sw.js').catch(() => {});
  }
}

/* ---------- PWA:iOS「添加到主屏幕」提示 ----------
   Safari 内打开且非主屏模式时显示一次,关闭后不再提示 */
(function initInstallTip() {
  const tip = $('install-tip');
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.navigator.standalone === true; // iOS 主屏模式标志
  if (!isIOS || standalone || loadJSON('schulte.tip-dismissed', null)) return;
  tip.hidden = false;
  $('install-close').addEventListener('click', () => {
    tip.hidden = true;
    saveJSON('schulte.tip-dismissed', 1);
  });
})();
