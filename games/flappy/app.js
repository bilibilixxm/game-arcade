/* ==========================================================
   像素小鸟 — 网页版(canvas 像素渲染 / 键盘+触控 / 存储 / 音效)
   纯游戏逻辑在 engine.js(UMD),像素数据在 sprites.js(UMD),
   与小程序共用同一份算法与素材
   ========================================================== */
'use strict';

/* ---------- 常量与存储 ---------- */
const KEY_RECORDS = 'flappy.records';
const KEY_BEST = 'flappy.best';
const KEY_SETTINGS = 'flappy.settings';
const MAX_RECORDS = 50;

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

let records = loadJSON(KEY_RECORDS, []); // [{ score, date, end: 'over' }]
let best = loadJSON(KEY_BEST, null); // { score, date }
let settings = Object.assign({ sound: true, theme: 'auto' }, loadJSON(KEY_SETTINGS, {}));

/* ---------- 引擎与状态 ---------- */
const engine = FlappyEngine.createFlappy();
const SPR = FlappySprites;
const SPEED = engine.SPEEDS;
const RULE = engine.RULES;

let stage = 'idle'; // idle(开始遮罩)| ready | playing | over(含 dying,结果浮层已出)
let groundX = 0; // 地面滚动偏移(渲染层维护)
let rotDeg = 0; // 鸟旋转角(渲染层)
let flashT = 0; // 撞击白闪剩余秒
let deathTs = 0; // 死亡时刻(延迟弹结果浮层)
let resultShown = false;
let rafId = 0;
let lastNow = -1;

/* 每局随机外观:白天/黑夜 + 鸟羽色 */
let look = { night: false, bird: 'yellow' };

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const canvas = $('board');
const ctx = canvas.getContext('2d');
const tapHint = $('tap-hint');
const startOverlay = $('start-overlay');
const resultModal = $('result-modal');
const drawer = $('drawer');
const drawerMask = $('drawer-mask');

/* ---------- 工具 ---------- */
function fmtDate(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function medalFor(score) {
  const [bronze, silver, gold, platinum] = RULE.medalAt;
  if (score >= platinum) return { icon: '💠', name: '白金牌' };
  if (score >= gold) return { icon: '🥇', name: '金牌' };
  if (score >= silver) return { icon: '🥈', name: '银牌' };
  if (score >= bronze) return { icon: '🥉', name: '铜牌' };
  return null;
}

/* ---------- 画布尺寸(逻辑 288×512,物理随 DPR) ---------- */
let viewK = 1;

function setupCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  viewK = canvas.width / engine.W;
  ctx.imageSmoothingEnabled = false;
}

window.addEventListener('resize', setupCanvas);

/* ---------- 精灵物化(离屏 canvas 缓存) ---------- */
function makeCanvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return cv;
}

function pixelsToCanvas(sp, scale) {
  const cv = makeCanvas(sp.w * scale, sp.h * scale);
  const c = cv.getContext('2d');
  for (let y = 0; y < sp.h; y++) {
    for (let x = 0; x < sp.w; x++) {
      const col = sp.px[y][x];
      if (!col) continue;
      c.fillStyle = col;
      c.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return cv;
}

/* 鸟三帧(按当前羽色物化) */
let birdFrames = [];

function materializeBird(color) {
  birdFrames = SPR.BIRD_FRAMES.map((f) => pixelsToCanvas(SPR.makeSprite(f, color), 2)); // 34×24
}

/* 大号记分数字(白字 + 2px 细描边,5×7 ×4 = 20×28) */
let digitImgs = [];

function materializeDigits() {
  digitImgs = [];
  for (let d = 0; d <= 9; d++) {
    const rows = SPR.DIGITS[d];
    const cv = makeCanvas(28, 36); // 字形 4..24 / 4..32,四周留 2px 描边余量
    const c = cv.getContext('2d');
    c.fillStyle = '#533846';
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 5; x++) {
        if (rows[y][x] === '#') c.fillRect(x * 4 + 2, y * 4 + 2, 8, 8); // 外扩 2px
      }
    }
    c.fillStyle = '#ffffff';
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 5; x++) {
        if (rows[y][x] === '#') c.fillRect(x * 4 + 4, y * 4 + 4, 4, 4);
      }
    }
    digitImgs.push(cv);
  }
}

/* ---------- 场景物化:背景(白天/黑夜)/ 管道 / 地面 ---------- */
let bgCanvas = null;

function materializeBg(night) {
  const W = engine.W;
  const H = engine.H - engine.GROUND_H; // 飞行区背景
  const cv = makeCanvas(W, H);
  const c = cv.getContext('2d');
  const sky = night ? '#0e3040' : '#4ec0ca';
  c.fillStyle = sky;
  c.fillRect(0, 0, W, H);

  /* 星星(黑夜) */
  if (night) {
    c.fillStyle = '#cfeef5';
    const stars = [[18, 40], [52, 96], [120, 30], [170, 70], [230, 44], [262, 110], [90, 130], [205, 128]];
    for (const [x, y] of stars) {
      c.fillRect(x, y, 2, 2);
      c.fillRect(x - 2, y, 1, 1); // 微弱十字
      c.fillRect(x + 2, y, 1, 1);
    }
    /* 月亮 */
    c.fillStyle = '#f4f0d8';
    c.fillRect(226, 34, 18, 18);
    c.fillRect(230, 30, 10, 26);
    c.fillRect(222, 38, 26, 10);
    c.fillStyle = sky;
    c.fillRect(220, 30, 12, 12); // 月牙缺口
  } else {
    /* 太阳 */
    c.fillStyle = '#fdf6b4';
    c.fillRect(222, 30, 26, 26);
    c.fillRect(218, 34, 34, 18);
    c.fillRect(226, 26, 18, 34);
  }

  /* 云带(圆齿) */
  c.fillStyle = night ? '#1b4a5c' : '#eefafb';
  for (let x = -6; x < W + 12; x += 28) {
    const y = 96 + ((x * 7919) % 3) * 6;
    c.fillRect(x, y, 24, 8);
    c.fillRect(x + 4, y - 5, 14, 6);
    c.fillRect(x + 10, y + 8, 18, 6);
  }

  /* 城市剪影 */
  c.fillStyle = night ? '#12455a' : '#8ee0c0';
  const blocks = [[0, 34, 26], [30, 26, 20], [54, 40, 30], [88, 24, 22], [114, 36, 26],
    [144, 28, 34], [182, 40, 24], [210, 30, 28], [242, 38, 22], [268, 30, 20]];
  for (const [x, w, h] of blocks) {
    c.fillRect(x, 160 - h, w, h);
    /* 楼顶垛口 */
    c.fillRect(x + 3, 160 - h - 4, 4, 4);
    c.fillRect(x + w - 7, 160 - h - 4, 4, 4);
  }

  /* 树丛(圆齿) */
  c.fillStyle = night ? '#0f3d33' : '#5ec768';
  for (let x = -4; x < W + 16; x += 22) {
    c.fillRect(x, 152, 20, 10);
    c.fillRect(x + 4, 144, 12, 9);
  }
  c.fillRect(0, 158, W, 6);

  bgCanvas = cv;
}

/* 管道模板:52×PLAY_H,帽(上端 26px)+ 管身;上管绘制时垂直翻转 */
let pipeCanvas = null;

function materializePipe() {
  const W = RULE.pipeWidth;
  const H = engine.H - engine.GROUND_H;
  const cv = makeCanvas(W, H);
  const c = cv.getContext('2d');
  const CAP_H = 26;
  const body = '#73bf2e';
  const light = '#a8e05b';
  const dark = '#4e8a1e';
  const edge = '#38571c';
  /* 管身(x 2..W-2) */
  c.fillStyle = edge;
  c.fillRect(0, CAP_H, W, H - CAP_H);
  c.fillStyle = body;
  c.fillRect(2, CAP_H, W - 4, H - CAP_H);
  c.fillStyle = light;
  c.fillRect(4, CAP_H, 8, H - CAP_H);
  c.fillStyle = dark;
  c.fillRect(W - 12, CAP_H, 8, H - CAP_H);
  /* 管口帽(带描边,比管身宽 2px) */
  c.fillStyle = edge;
  c.fillRect(0, 0, W, CAP_H);
  c.fillStyle = body;
  c.fillRect(2, 2, W - 4, CAP_H - 4);
  c.fillStyle = light;
  c.fillRect(4, 4, 9, CAP_H - 8);
  c.fillStyle = dark;
  c.fillRect(W - 13, 4, 9, CAP_H - 8);
  pipeCanvas = cv;
}

/* 地面条:288+52 宽可循环平铺(草沿 + 斜纹 + 土) */
let groundCanvas = null;
const GROUND_TILE = 24; // 草沿斜纹周期

function materializeGround(night) {
  const W = engine.W + 52;
  const H = engine.GROUND_H;
  const cv = makeCanvas(W, H);
  const c = cv.getContext('2d');
  /* 土 */
  c.fillStyle = night ? '#8a7f52' : '#ded895';
  c.fillRect(0, 0, W, H);
  /* 土内浅砖纹 */
  c.fillStyle = night ? '#786e46' : '#d0c878';
  for (let y = 30; y < H - 8; y += 16) {
    for (let x = ((y / 16) % 2) * 24; x < W; x += 48) {
      c.fillRect(x, y, 22, 12);
    }
  }
  /* 草沿亮条 */
  c.fillStyle = night ? '#4f9c46' : '#9be64f';
  c.fillRect(0, 0, W, 10);
  /* 斜纹(暗绿) */
  c.fillStyle = night ? '#3a7a34' : '#73bf2e';
  for (let x = -GROUND_TILE; x < W + GROUND_TILE; x += GROUND_TILE * 2) {
    for (let i = 0; i < GROUND_TILE; i++) {
      c.fillRect(x + i, i, 4, 1);
      c.fillRect(x + i, GROUND_TILE - 1 - i, 4, 1);
    }
  }
  /* 草沿底边 */
  c.fillStyle = night ? '#2c5c28' : '#558022';
  c.fillRect(0, 10, W, 3);
  /* 顶部细阴影线 */
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.fillRect(0, 0, W, 1);
  groundCanvas = cv;
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

function tone(freq, when, dur, type = 'square', gain = 0.08, slideTo = 0) {
  const ctxA = ensureAudio();
  if (!ctxA) return;
  const osc = ctxA.createOscillator();
  const g = ctxA.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctxA.currentTime + when);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctxA.currentTime + when + dur);
  g.gain.setValueAtTime(gain, ctxA.currentTime + when);
  g.gain.exponentialRampToValueAtTime(0.0001, ctxA.currentTime + when + dur);
  osc.connect(g).connect(ctxA.destination);
  osc.start(ctxA.currentTime + when);
  osc.stop(ctxA.currentTime + when + dur + 0.05);
}

const sfx = {
  wing() { tone(340, 0, 0.08, 'triangle', 0.14, 620); },
  point() { tone(920, 0, 0.06, 'square', 0.1); tone(1380, 0.06, 0.1, 'square', 0.1); },
  hit() { tone(180, 0, 0.14, 'sawtooth', 0.16, 55); },
  die() { tone(620, 0, 0.4, 'triangle', 0.12, 130); },
  swoosh() { tone(240, 0, 0.18, 'triangle', 0.08, 480); },
};

function playEvents() {
  for (const ev of engine.drainEvents()) {
    switch (ev.type) {
      case 'flap': sfx.wing(); break;
      case 'point': sfx.point(); break;
      case 'hit': sfx.hit(); flashT = 0.12; break;
      case 'die': sfx.die(); break;
      case 'gameover': onGameOver(ev.score); break;
      default: break;
    }
  }
}

/* ---------- 主循环 ---------- */
function loop(now) {
  rafId = requestAnimationFrame(loop);
  if (lastNow === -1) { lastNow = now; return; }
  let dt = (now - lastNow) / 1000;
  lastNow = now;
  if (dt < 0) dt = 0;
  if (dt > 0.05) dt = 0.05;

  engine.tick(now);
  playEvents();

  const st = engine.state;
  if (st.phase === 'playing') groundX = (groundX + SPEED.scroll * dt) % GROUND_TILE;

  /* 鸟旋转 */
  if (st.phase === 'playing') {
    const target = st.bird.vel < 0 ? -25
      : Math.min(90, -25 + (st.bird.vel / SPEED.maxFall) * 150);
    rotDeg += (target - rotDeg) * Math.min(1, dt * 14);
  } else if (st.phase === 'dying') {
    rotDeg = Math.min(90, rotDeg + 480 * dt);
  } else if (st.phase === 'ready') {
    rotDeg = 0;
  }
  if (flashT > 0) flashT -= dt;

  draw();
}

/* ---------- 渲染 ---------- */
function draw() {
  const st = engine.state;
  const W = engine.W;
  const H = engine.H;
  ctx.setTransform(viewK, 0, 0, viewK, 0, 0);
  ctx.imageSmoothingEnabled = false;

  /* 背景(静止一层) */
  ctx.drawImage(bgCanvas, 0, 0);

  /* 管道 */
  for (const p of st.pipes) {
    const topH = p.gapY - RULE.gap / 2;
    const botY = p.gapY + RULE.gap / 2;
    ctx.save();
    ctx.translate(p.x + RULE.pipeWidth / 2, topH);
    ctx.scale(1, -1);
    ctx.drawImage(pipeCanvas, -RULE.pipeWidth / 2, 0);
    ctx.restore();
    ctx.drawImage(pipeCanvas, p.x, botY);
  }

  /* 地面 */
  ctx.drawImage(groundCanvas, -groundX, engine.H - engine.GROUND_H);

  /* 鸟(ready 态加浮动) */
  const bobY = st.phase === 'ready' ? Math.sin(st.time * Math.PI * 2 * 1.4) * 5 : 0;
  const frame = st.phase === 'dying' || st.phase === 'over'
    ? 1
    : [0, 1, 2, 1][Math.floor(st.time * 6) % 4];
  const img = birdFrames[frame] || birdFrames[0];
  const cx = st.bird.x + RULE.birdW / 2;
  const cy = st.bird.y + bobY + RULE.birdH / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((rotDeg * Math.PI) / 180);
  ctx.drawImage(img, -RULE.birdW / 2, -RULE.birdH / 2);
  ctx.restore();

  /* 记分大数字(playing / dying) */
  if (st.phase !== 'ready') {
    const s = String(st.score);
    const dw = 26; // 数字画布 28 宽,重叠 2px 让字距紧凑
    let x = Math.round(W / 2 - (s.length * dw - 2) / 2);
    for (const ch of s) {
      ctx.drawImage(digitImgs[Number(ch)], x, 28);
      x += dw;
    }
  }

  /* 撞击白闪 */
  if (flashT > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(1, flashT / 0.12) * 0.85})`;
    ctx.fillRect(0, 0, W, H);
  }
}

/* ---------- 输入 ---------- */
function flapAction() {
  ensureAudio(); // iOS:AudioContext 需在用户手势内创建/恢复
  if (stage === 'idle' || stage === 'over') return;
  if (engine.state.phase === 'ready') {
    tapHint.hidden = true;
    stage = 'playing';
  }
  engine.flap();
}

document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    flapAction();
  }
});

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  flapAction();
});

/* ---------- 流程 ---------- */
function newLook() {
  look = {
    night: Math.random() < 0.4,
    bird: ['yellow', 'red', 'blue'][Math.floor(Math.random() * 3)],
  };
  materializeBird(look.bird);
  materializeBg(look.night);
  materializeGround(look.night);
}

function toReady() {
  engine.reset();
  newLook();
  groundX = 0;
  rotDeg = 0;
  flashT = 0;
  resultShown = false;
  stage = 'ready';
  startOverlay.hidden = true;
  resultModal.hidden = true;
  tapHint.hidden = false;
  updateHUD();
}

function onGameOver(score) {
  const date = new Date().toISOString();
  records.unshift({ score, date, end: 'over' });
  if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
  saveJSON(KEY_RECORDS, records);
  const isNew = !best || score > best.score;
  if (isNew) {
    best = { score, date };
    saveJSON(KEY_BEST, best);
  }
  stage = 'over';
  deathTs = performance.now();
  setTimeout(() => showResult(score, isNew), 900);
}

function showResult(score, isNew) {
  if (resultShown || stage !== 'over') return;
  resultShown = true;
  sfx.swoosh();
  const medal = medalFor(score);
  $('result-emoji').textContent = isNew ? '🏆' : '💀';
  $('result-title').textContent = isNew ? '新纪录!' : '游戏结束';
  const medalEl = $('result-medal');
  if (medal) {
    medalEl.hidden = false;
    $('medal-icon').textContent = medal.icon;
    $('medal-name').textContent = medal.name;
  } else {
    medalEl.hidden = true;
  }
  $('result-record').hidden = !isNew;
  $('result-score').textContent = String(score);
  $('result-best').textContent = best ? String(best.score) : '0';
  resultModal.hidden = false;
  updateHUD();
}

/* ---------- HUD 与抽屉 ---------- */
function updateHUD() {
  $('stat-best').textContent = best ? String(best.score) : '--';
  $('stat-last').textContent = records.length ? String(records[0].score) : '--';
  $('stat-games').textContent = String(records.length);
}

function renderDrawer() {
  $('drawer-best-score').textContent = best ? String(best.score) : '--';
  $('drawer-games').textContent = String(records.length);
  const list = $('record-list');
  list.innerHTML = '';
  if (!records.length) {
    const li = document.createElement('li');
    li.className = 'record-empty';
    li.textContent = '暂无对局记录,快飞第一局吧!';
    list.appendChild(li);
    return;
  }
  for (const r of records.slice(0, 20)) {
    const li = document.createElement('li');
    li.className = 'record-item';
    const medal = medalFor(r.score);
    li.innerHTML = `<span class="rec-score"></span><span class="rec-meta"></span>`;
    li.querySelector('.rec-score').textContent = `${r.score} 分${medal ? ' ' + medal.icon : ''}`;
    li.querySelector('.rec-meta').textContent = fmtDate(r.date);
    list.appendChild(li);
  }
}

/* ---------- 主题与音效 ---------- */
const THEMES = ['auto', 'light', 'dark'];
const THEME_META = {
  auto: { icon: '🌓', label: '主题:跟随系统' },
  light: { icon: '☀️', label: '主题:浅色' },
  dark: { icon: '🌙', label: '主题:深色' },
};

function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
  const meta = THEME_META[settings.theme] || THEME_META.auto;
  $('btn-theme').textContent = meta.icon;
  $('btn-theme').title = meta.label;
}

function applySound() {
  $('btn-sound').textContent = settings.sound ? '🔊' : '🔇';
}

/* ---------- 事件绑定 ---------- */
$('btn-start').addEventListener('click', toReady);
$('btn-retry').addEventListener('click', toReady);

$('btn-theme').addEventListener('click', () => {
  settings.theme = THEMES[(THEMES.indexOf(settings.theme) + 1) % THEMES.length] || 'auto';
  saveJSON(KEY_SETTINGS, settings);
  applyTheme();
});

$('btn-sound').addEventListener('click', () => {
  settings.sound = !settings.sound;
  saveJSON(KEY_SETTINGS, settings);
  applySound();
});

function openDrawer() {
  renderDrawer();
  drawer.hidden = false;
  drawerMask.hidden = false;
}

function closeDrawer() {
  drawer.hidden = true;
  drawerMask.hidden = true;
}

$('btn-history').addEventListener('click', openDrawer);
$('btn-history2').addEventListener('click', openDrawer);
$('btn-close-drawer').addEventListener('click', closeDrawer);
drawerMask.addEventListener('click', closeDrawer);

$('btn-clear').addEventListener('click', () => {
  if (!records.length || !confirm('确定清空全部记录?')) return;
  records = [];
  best = null;
  saveJSON(KEY_RECORDS, records);
  saveJSON(KEY_BEST, best);
  renderDrawer();
  updateHUD();
});

/* ---------- 启动 ---------- */
applyTheme();
applySound();
materializeDigits();
materializePipe();
setupCanvas();
newLook();
updateHUD();
rafId = requestAnimationFrame(loop);
