/* ==========================================================
   俄罗斯方块 — 网页版(canvas 渲染 / 键盘+触控输入 / 存储 / 音效)
   纯游戏逻辑在 engine.js(UMD,与小程序共用同一份算法)
   ========================================================== */
'use strict';

/* ---------- 常量与存储 ---------- */
const KEY_RECORDS = 'tetris.records';
const KEY_BEST = 'tetris.best';
const KEY_SETTINGS = 'tetris.settings';
const MAX_RECORDS = 50;

const DAS = 170; // 左右键首次重复延迟 ms
const ARR = 40; // 左右键重复间隔 ms
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

let records = loadJSON(KEY_RECORDS, []); // [{ score, lines, level, duration, date }]
let best = loadJSON(KEY_BEST, null); // { score, lines, level, date }
let settings = Object.assign({ sound: true, theme: 'auto', startLevel: 1 }, loadJSON(KEY_SETTINGS, {}));

/* ---------- 引擎与状态 ---------- */
const engine = TetrisEngine.createTetris({ rows: 20, cols: 10 });

let phase = 'idle'; // idle | running | paused | over
let startTs = 0;
let pausedAcc = 0;
let pauseTs = 0;
let rafId = 0;

/* 锁定/消行/升级监测:动作前后对比引擎状态 */
const watch = { cur: null, lines: 0, level: 1 };
function beginWatch() {
  const s = engine.state;
  watch.cur = s.current;
  watch.lines = s.lines;
  watch.level = s.level;
}

function endWatch(sounds = true) {
  const s = engine.state;
  const locked = s.current !== watch.cur;
  if (sounds && locked) {
    sfx.lock();
    if (s.lines > watch.lines) sfx.clear();
    if (s.level > watch.level) sfx.levelup();
  }
  beginWatch();
  return locked;
}

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const boardCanvas = $('board');
const bctx = boardCanvas.getContext('2d');
const holdCanvas = $('cv-hold');
const nextCanvases = [$('cv-next0'), $('cv-next1'), $('cv-next2')];
const startOverlay = $('start-overlay');
const pauseOverlay = $('pause-overlay');
const resultModal = $('result-modal');
const drawer = $('drawer');
const drawerMask = $('drawer-mask');

/* ---------- 工具 ---------- */
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

function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, w, h);
  }
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

function tone(freq, when, dur, type = 'sine', gain = 0.1) {
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
  move() {
    tone(320, 0, 0.04, 'triangle', 0.045);
  },
  rotate() {
    tone(520, 0, 0.05, 'triangle', 0.055);
  },
  lock() {
    tone(150, 0, 0.08, 'sawtooth', 0.07);
  },
  clear() {
    tone(660, 0, 0.09, 'triangle', 0.11);
    tone(880, 0.09, 0.14, 'triangle', 0.11);
  },
  levelup() {
    tone(523.25, 0, 0.1, 'triangle', 0.1);
    tone(659.25, 0.1, 0.1, 'triangle', 0.1);
    tone(783.99, 0.2, 0.22, 'triangle', 0.11);
  },
  gameover() {
    tone(523.25, 0, 0.18, 'triangle', 0.1);
    tone(392, 0.18, 0.18, 'triangle', 0.1);
    tone(261.63, 0.36, 0.35, 'triangle', 0.11);
  },
};

/* ---------- 画布尺寸 ---------- */
let dpr = 1;

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
}

function resize() {
  dpr = window.devicePixelRatio || 1;
  setupCanvas(boardCanvas);
  setupCanvas(holdCanvas);
  for (const c of nextCanvases) setupCanvas(c);
  hudCache = '';
  prevSig = '';
  draw();
}

/* ---------- 渲染 ---------- */
function drawCell(ctx, px, py, size, color, alpha = 1) {
  const inset = Math.max(1, size * 0.06);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  roundRect(ctx, px + inset, py + inset, size - inset * 2, size - inset * 2, size * 0.18);
  ctx.globalAlpha = 1;
}

function draw() {
  const s = engine.state;
  const W = boardCanvas.width;
  const H = boardCanvas.height;
  const cell = W / engine.COLS;
  bctx.clearRect(0, 0, W, H);

  // 网格线
  bctx.strokeStyle = 'rgba(128, 138, 160, 0.14)';
  bctx.lineWidth = 1;
  bctx.beginPath();
  for (let x = 1; x < engine.COLS; x++) {
    bctx.moveTo(x * cell, 0);
    bctx.lineTo(x * cell, H);
  }
  for (let y = 1; y < engine.ROWS; y++) {
    bctx.moveTo(0, y * cell);
    bctx.lineTo(W, y * cell);
  }
  bctx.stroke();

  // 已落定的方块
  for (let y = 0; y < engine.ROWS; y++) {
    for (let x = 0; x < engine.COLS; x++) {
      const t = s.board[y][x];
      if (t) drawCell(bctx, x * cell, y * cell, cell, COLORS[t]);
    }
  }

  // 幽灵投影与当前方块(pieceCells 返回绝对坐标,幽灵再加相对偏移 gy-current.y)
  if (s.current && !s.over && phase !== 'idle') {
    const gy = engine.ghostY();
    const cells = engine.pieceCells();
    if (gy !== s.current.y) {
      for (const [cx, cy] of cells) {
        drawCell(bctx, cx * cell, (gy + cy - s.current.y) * cell, cell, COLORS[s.current.type], 0.16);
      }
    }
    for (const [cx, cy] of cells) {
      if (cy >= 0) drawCell(bctx, cx * cell, cy * cell, cell, COLORS[s.current.type]);
    }
  }

  drawPreviews();
  updateHUD();
}

function drawPreview(canvas, type) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!type) return;
  const cells = engine.cellsFor(type, 0);
  const xs = cells.map((c) => c[0]);
  const ys = cells.map((c) => c[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const cell = Math.min(W / (bw + 0.8), H / (bh + 0.8));
  const ox = (W - bw * cell) / 2 - minX * cell;
  const oy = (H - bh * cell) / 2 - minY * cell;
  for (const [cx, cy] of cells) drawCell(ctx, ox + cx * cell, oy + cy * cell, cell, COLORS[type]);
}

let prevSig = '';
function drawPreviews() {
  const s = engine.state;
  const sig = [s.hold, s.next[0], s.next[1], s.next[2]].join(',');
  if (sig === prevSig) return;
  prevSig = sig;
  drawPreview(holdCanvas, s.hold);
  for (let i = 0; i < 3; i++) drawPreview(nextCanvases[i], s.next[i]);
}

let hudCache = '';
function updateHUD() {
  const s = engine.state;
  const key = `${s.score}|${s.lines}|${s.level}`;
  if (key === hudCache) return;
  hudCache = key;
  $('stat-score').textContent = fmtScore(s.score);
  $('stat-lines').textContent = s.lines;
  $('stat-level').textContent = s.level;
  $('stat-best').textContent = best ? fmtScore(best.score) : '--';
}

/* ---------- 动作 ---------- */
function act(kind) {
  if (phase !== 'running') return;
  let moved = false;
  beginWatch();
  switch (kind) {
    case 'left':
      moved = engine.moveLeft();
      break;
    case 'right':
      moved = engine.moveRight();
      break;
    case 'rotate':
      moved = engine.rotate(1);
      break;
    case 'rotateCCW':
      moved = engine.rotate(-1);
      break;
    case 'soft':
      engine.softDrop();
      break;
    case 'hard':
      engine.hardDrop();
      break;
    case 'hold':
      engine.hold();
      endWatch(false); // hold 换块不算锁定,不出锁定音
      return;
  }
  const locked = endWatch(); // 锁定发生(tick/hardDrop)时出锁定/消行/升级音
  if (!locked && moved && (kind === 'left' || kind === 'right' || kind === 'rotate' || kind === 'rotateCCW')) {
    sfx[kind === 'rotate' || kind === 'rotateCCW' ? 'rotate' : 'move']();
  }
  if (engine.state.over) gameOver();
}

/* ---------- 主循环 ---------- */
const held = { dir: 0, nextRepeat: 0, soft: false, softNext: 0 };

function pressDir(dir) {
  held.dir = dir;
  held.nextRepeat = performance.now() + DAS;
  act(dir < 0 ? 'left' : 'right');
}

function releaseDir(dir) {
  if (held.dir === dir) held.dir = 0;
}

function pressSoft() {
  held.soft = true;
  held.softNext = 0;
}

function releaseSoft() {
  held.soft = false;
}

function loop(now) {
  if (phase === 'running') {
    // 键盘/触控按住的重复移动(DAS/ARR)
    if (held.dir !== 0 && now >= held.nextRepeat) {
      act(held.dir < 0 ? 'left' : 'right');
      held.nextRepeat = now + ARR;
    }
    if (held.soft && now >= held.softNext) {
      act('soft');
      held.softNext = now + SOFT_ARR;
    }
    engine.tick(now);
    if (endWatch() && engine.state.over) gameOver(); // 重力锁定
  }
  draw();
  rafId = requestAnimationFrame(loop);
}

/* ---------- 游戏流程 ---------- */
function startGame() {
  engine.reset({ level: settings.startLevel });
  beginWatch();
  phase = 'running';
  startTs = performance.now();
  pausedAcc = 0;
  held.dir = 0;
  held.soft = false;
  prevSig = '';
  hudCache = '';
  startOverlay.hidden = true;
  pauseOverlay.hidden = true;
  resultModal.hidden = true;
  $('btn-pause').textContent = '⏸';
  ensureAudio();
}

function togglePause() {
  if (phase === 'running') {
    engine.state.paused = true;
    phase = 'paused';
    pauseTs = performance.now();
    pauseOverlay.hidden = false;
    $('btn-pause').textContent = '▶';
  } else if (phase === 'paused') {
    engine.onResume();
    engine.state.paused = false;
    phase = 'running';
    pausedAcc += performance.now() - pauseTs;
    pauseOverlay.hidden = true;
    $('btn-pause').textContent = '⏸';
  }
}

function gameOver() {
  phase = 'over';
  const s = engine.state;
  const duration = Math.round((performance.now() - startTs - pausedAcc) / 1000);
  const date = new Date().toISOString();

  records.unshift({ score: s.score, lines: s.lines, level: s.level, duration, date });
  records = records.slice(0, MAX_RECORDS);
  saveJSON(KEY_RECORDS, records);

  const isNewRecord = !best || s.score > best.score;
  if (isNewRecord) {
    best = { score: s.score, lines: s.lines, level: s.level, date };
    saveJSON(KEY_BEST, best);
  }

  sfx.gameover();
  $('result-emoji').textContent = isNewRecord ? '🏆' : s.lines >= 20 ? '🎉' : '🎮';
  $('result-record').hidden = !isNewRecord;
  $('result-score').textContent = fmtScore(s.score);
  $('result-lines').textContent = s.lines;
  $('result-level').textContent = s.level;
  $('result-duration').textContent = fmtDur(duration);
  $('result-best').textContent = best ? fmtScore(best.score) : '0';
  resultModal.hidden = false;
  $('btn-pause').textContent = '⏸';
}

/* ---------- 历史抽屉 ---------- */
function renderDrawer() {
  $('drawer-best-score').textContent = best ? fmtScore(best.score) : '--';
  $('drawer-best-lines').textContent = best ? best.lines : '--';
  $('drawer-best-level').textContent = best ? best.level : '--';

  const list = $('record-list');
  list.innerHTML = '';
  if (records.length === 0) {
    list.innerHTML = '<li class="record-empty">暂无对局记录,快开始第一局吧!</li>';
    return;
  }
  for (const r of records.slice(0, 50)) {
    const li = document.createElement('li');
    li.className = 'record-item';
    li.innerHTML = `<span class="rec-score">${fmtScore(r.score)} 分</span>
      <span class="rec-meta">${r.lines} 行 · Lv${r.level} · ${fmtDur(r.duration)}<br>${fmtDate(r.date)}</span>`;
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
  if (phase === 'over' && resultModal.hidden) resultModal.hidden = false;
}

function clearRecords() {
  if (!confirm('确定清空全部对局记录吗?此操作不可恢复。')) return;
  records = [];
  best = null;
  saveJSON(KEY_RECORDS, records);
  saveJSON(KEY_BEST, best);
  hudCache = '';
  renderDrawer();
  updateHUD();
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

/* ---------- 事件:键盘 ---------- */
document.addEventListener('keydown', (e) => {
  if (e.repeat) return; // 重复由 DAS/ARR 自己控制
  switch (e.code) {
    case 'ArrowLeft':
      e.preventDefault();
      pressDir(-1);
      break;
    case 'ArrowRight':
      e.preventDefault();
      pressDir(1);
      break;
    case 'ArrowDown':
      e.preventDefault();
      pressSoft();
      break;
    case 'ArrowUp':
    case 'KeyX':
      e.preventDefault();
      act('rotate');
      break;
    case 'KeyZ':
      e.preventDefault();
      act('rotateCCW');
      break;
    case 'Space':
      e.preventDefault();
      act('hard');
      break;
    case 'KeyC':
    case 'ShiftLeft':
    case 'ShiftRight':
      e.preventDefault();
      act('hold');
      break;
    case 'KeyP':
    case 'Escape':
      if (phase === 'running' || phase === 'paused') togglePause();
      break;
    case 'Enter':
      if (phase === 'idle') startGame();
      else if (phase === 'over' && !resultModal.hidden) startGame();
      break;
  }
});

document.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'ArrowLeft':
      releaseDir(-1);
      break;
    case 'ArrowRight':
      releaseDir(1);
      break;
    case 'ArrowDown':
      releaseSoft();
      break;
  }
});

/* ---------- 事件:触控按钮 ---------- */
function bindHold(id, onDown, onUp) {
  const el = $(id);
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.classList.add('pressing');
    onDown();
  });
  const up = () => {
    el.classList.remove('pressing');
    if (onUp) onUp();
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

bindHold('tc-left', () => pressDir(-1), () => releaseDir(-1));
bindHold('tc-right', () => pressDir(1), () => releaseDir(1));
bindHold('tc-down', pressSoft, releaseSoft);
bindHold('tc-rotate', () => act('rotate'));
bindHold('tc-drop', () => act('hard'));
bindHold('tc-hold', () => act('hold'));

/* ---------- 事件:顶栏与浮层 ---------- */
/* 起始难度(1~10):决定初始下落速度与计分倍率,升级不会低于它 */
function applyLevelUI() {
  $('lv-num').textContent = settings.startLevel;
}

function changeLevel(d) {
  settings.startLevel = Math.min(10, Math.max(1, settings.startLevel + d));
  saveJSON(KEY_SETTINGS, settings);
  applyLevelUI();
}

$('lv-down').addEventListener('click', () => changeLevel(-1));
$('lv-up').addEventListener('click', () => changeLevel(1));

$('btn-start').addEventListener('click', startGame);
$('btn-retry').addEventListener('click', startGame);
$('btn-resume').addEventListener('click', togglePause);
$('btn-pause').addEventListener('click', () => {
  if (phase === 'idle') startGame();
  else togglePause();
});
$('btn-history').addEventListener('click', openDrawer);
$('btn-close-drawer').addEventListener('click', closeDrawer);
drawerMask.addEventListener('click', closeDrawer);
$('btn-clear').addEventListener('click', clearRecords);

$('btn-theme').addEventListener('click', () => {
  const idx = THEMES.indexOf(settings.theme);
  settings.theme = THEMES[(idx + 1) % THEMES.length] || 'auto';
  saveJSON(KEY_SETTINGS, settings);
  applyTheme();
});

function applySoundIcon() {
  $('btn-sound').textContent = settings.sound ? '🔊' : '🔇';
  $('btn-sound').title = settings.sound ? '音效:开' : '音效:关';
}

$('btn-sound').addEventListener('click', () => {
  settings.sound = !settings.sound;
  saveJSON(KEY_SETTINGS, settings);
  applySoundIcon();
  if (settings.sound) ensureAudio();
});

/* 切后台自动暂停 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden && phase === 'running') togglePause();
});

/* ---------- 初始化 ---------- */
applyTheme();
applySoundIcon();
applyLevelUI();
beginWatch();
resize();
window.addEventListener('resize', resize);
rafId = requestAnimationFrame(loop);

/* ---------- PWA:Service Worker 注册 ----------
   仅在 https 或 localhost(secure context)下注册;
   双击 index.html(file://)打开时自动跳过,功能不受影响 */
if (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname)) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('../../sw.js').catch(() => {});
  }
}
