/* ==========================================================
   坦克大战 — 网页版(canvas 像素渲染 / 双人键盘+触控 / 存储 / 音效)
   纯游戏逻辑在 engine.js(UMD),像素数据在 sprites.js(UMD),
   关卡数据在 levels.js(UMD),与小程序共用同一份算法与素材
   ========================================================== */
'use strict';

/* ---------- 常量与存储 ---------- */
const KEY_RECORDS = 'battle-city.records';
const KEY_BEST = 'battle-city.best';
const KEY_SETTINGS = 'battle-city.settings';
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

let records = loadJSON(KEY_RECORDS, []); // [{ score, level, date, end, player }]
let best = loadJSON(KEY_BEST, null); // { score, level, date }
let settings = Object.assign(
  { sound: true, theme: 'auto', players: 1, startStage: 1, wholeBrick: false },
  loadJSON(KEY_SETTINGS, {})
);

/* ---------- 引擎与状态 ---------- */
const engine = BattleCityEngine.createBattleCity({ levels: BattleCityLevels });
const SPR = BattleCitySprites;

let phase = 'idle'; // idle | running | paused | over
let mode = settings.players === 2 ? 2 : 1; // 1 | 2(开始界面选择)
let startStage = Math.max(1, Math.min(35, settings.startStage || 1)); // 起始关卡(开始界面可选)
let startTs = 0;
let pausedAcc = 0;
let pauseTs = 0;
let rafId = 0;

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const boardCanvas = $('board');
const bctx = boardCanvas.getContext('2d');
const enemyCanvas = $('cv-enemy');
const ectx = enemyCanvas.getContext('2d');
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

/* ---------- 精灵物化(离屏 canvas 缓存,渲染只剩 drawImage) ---------- */
const spriteCache = new Map();

function makeSprite(grid, pal) {
  const h = grid.length;
  const w = grid[0].length;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
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
}

function cachedSprite(kind, variant, grid, pal) {
  const key = `${kind}:${variant}`;
  let cv = spriteCache.get(key);
  if (!cv) {
    cv = makeSprite(grid, pal);
    spriteCache.set(key, cv);
  }
  return cv;
}

/* 坦克:variant = 调色板键,dir 0-3 */
function tankSprite(palKey, dir) {
  return cachedSprite('tank', `${palKey}:${dir}`, SPR.TANK_DIRS[dir], SPR.TANK_PALETTES[palKey]);
}

function armorPalKey(hp) {
  return hp >= 4 ? 'armor4' : hp === 3 ? 'armor3' : hp === 2 ? 'armor2' : 'armor1';
}

/* 地形子格字母码 → 精灵表键 */
const TILE_KEYS = { B: 'brick', S: 'steel', W: 'water', T: 'trees', I: 'ice' };

function tileSprite(code, frame) {
  const tile = SPR.TILES[TILE_KEYS[code]];
  return cachedSprite(`tile:${code}`, frame, tile.frames[frame % tile.frames.length], tile.pal);
}

function spriteGrid(obj, frame) {
  return cachedSprite(obj._key, frame, obj.frames[frame % obj.frames.length], obj.pal);
}
SPR.EXPLODE_SMALL._key = 'exs';
SPR.EXPLODE_BIG._key = 'exb';
SPR.SPAWN_STAR._key = 'star';
SPR.SHIELD._key = 'shield';

const bulletSprite = cachedSprite('bullet', '0', SPR.BULLET.grid, SPR.BULLET.pal);
const baseAlive = cachedSprite('base', 'alive', SPR.BASE.frames[0], SPR.BASE.pal);
const baseDead = cachedSprite('base', 'dead', SPR.BASE.frames[1], SPR.BASE.pal);
const powerupSprites = {};
for (const type of Object.keys(SPR.POWERUP.icons)) {
  powerupSprites[type] = cachedSprite('pw', type, SPR.POWERUP.icons[type], SPR.POWERUP.pal);
}

/* ---------- 静态地形层(离屏;树单独一层置顶) ---------- */
const FIELD = engine.FIELD;
const terrainCv = document.createElement('canvas');
terrainCv.width = FIELD;
terrainCv.height = FIELD;
const tctx = terrainCv.getContext('2d');
const treesCv = document.createElement('canvas');
treesCv.width = FIELD;
treesCv.height = FIELD;
const trctx = treesCv.getContext('2d');

let terrainKey = '';

function rebuildTerrain(waterFrame) {
  const s = engine.state;
  tctx.clearRect(0, 0, FIELD, FIELD);
  trctx.clearRect(0, 0, FIELD, FIELD);
  for (let sy = 0; sy < 26; sy++) {
    for (let sx = 0; sx < 26; sx++) {
      const code = s.terrain[sy][sx];
      if (!code || code === 'F') continue; // 基地单独画
      const target = code === 'T' ? trctx : tctx;
      target.drawImage(tileSprite(code, waterFrame), sx * 8, sy * 8);
    }
  }
}

/* ---------- 音效(Web Audio 合成) ---------- */
let audioCtx = null;
let noiseBuf = null;

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
  const ctx = ensureAudio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + when);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + when + dur);
  g.gain.setValueAtTime(gain, ctx.currentTime + when);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + when + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(ctx.currentTime + when);
  osc.stop(ctx.currentTime + when + dur + 0.05);
}

function noise(when, dur, gain = 0.15) {
  const ctx = ensureAudio();
  if (!ctx) return;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  src.buffer = noiseBuf;
  g.gain.setValueAtTime(gain, ctx.currentTime + when);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + when + dur);
  src.connect(g).connect(ctx.destination);
  src.start(ctx.currentTime + when);
  src.stop(ctx.currentTime + when + dur + 0.05);
}

const sfx = {
  shoot() {
    tone(900, 0, 0.07, 'square', 0.05, 240);
  },
  brick() {
    noise(0, 0.06, 0.12);
  },
  steel() {
    tone(1250, 0, 0.05, 'square', 0.05);
  },
  cancel() {
    tone(320, 0, 0.05, 'square', 0.05);
    noise(0, 0.04, 0.07);
  },
  explodeSmall() {
    noise(0, 0.18, 0.16);
  },
  explodeBig() {
    noise(0, 0.45, 0.22);
    tone(90, 0, 0.35, 'triangle', 0.18, 45);
  },
  powerupGet() {
    tone(660, 0, 0.08, 'triangle', 0.1);
    tone(880, 0.08, 0.08, 'triangle', 0.1);
    tone(1100, 0.16, 0.16, 'triangle', 0.11);
  },
  powerupSpawn() {
    tone(520, 0, 0.1, 'triangle', 0.09);
    tone(780, 0.12, 0.14, 'triangle', 0.09);
  },
  extraLife() {
    tone(523.25, 0, 0.09, 'triangle', 0.1);
    tone(659.25, 0.1, 0.09, 'triangle', 0.1);
    tone(783.99, 0.2, 0.09, 'triangle', 0.1);
    tone(1046.5, 0.3, 0.24, 'triangle', 0.11);
  },
  stageClear() {
    tone(392, 0, 0.12, 'triangle', 0.1);
    tone(523.25, 0.13, 0.12, 'triangle', 0.1);
    tone(659.25, 0.26, 0.12, 'triangle', 0.1);
    tone(783.99, 0.39, 0.3, 'triangle', 0.11);
  },
  gameOver() {
    tone(523.25, 0, 0.18, 'triangle', 0.1);
    tone(392, 0.18, 0.18, 'triangle', 0.1);
    tone(261.63, 0.36, 0.4, 'triangle', 0.11);
  },
  freeze() {
    tone(200, 0, 0.12, 'sine', 0.09, 400);
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
  setupCanvas(enemyCanvas);
  terrainKey = '';
  hudCache = '';
  drawEnemyIcons();
  draw();
}

/* ---------- 特效列表(事件驱动,UI 侧动画) ---------- */
const fx = []; // { kind:'small'|'big', x, y, t0 }

function addFx(kind, x, y) {
  fx.push({ kind, x, y, t0: performance.now() });
}

function drawFx(now) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    const t = now - f.t0;
    const life = f.kind === 'big' ? 500 : 200;
    if (t > life) {
      fx.splice(i, 1);
      continue;
    }
    const seq = f.kind === 'big' ? SPR.EXPLODE_BIG : SPR.EXPLODE_SMALL;
    const fIdx = f.kind === 'big'
      ? (t < 166 ? 0 : t < 333 ? 1 : 2)
      : (t < 100 ? 0 : 1);
    const size = f.kind === 'big' ? 32 : 16;
    bctx.drawImage(spriteGrid(seq, fIdx), f.x + 8 - size / 2, f.y + 8 - size / 2);
  }
}

/* ---------- 事件 → 音效/特效 ---------- */
function onEvents(events, now) {
  for (const ev of events) {
    switch (ev.type) {
      case 'shoot': sfx.shoot(); break;
      case 'brick': sfx.brick(); addFx('small', ev.x, ev.y); break;
      case 'steel': sfx.steel(); addFx('small', ev.x, ev.y); break;
      case 'bullet-cancel': sfx.cancel(); break;
      case 'explode':
        sfx[ev.big ? 'explodeBig' : 'explodeSmall']();
        if (ev.big) addFx('big', ev.x, ev.y);
        break;
      case 'powerup-spawn': sfx.powerupSpawn(); break;
      case 'powerup-get': sfx.powerupGet(); break;
      case 'extra-life': sfx.extraLife(); break;
      case 'stage-clear': sfx.stageClear(); break;
      case 'game-over': sfx.gameOver(); break;
      case 'friendly-freeze': sfx.freeze(); break;
    }
  }
}

/* ---------- 渲染 ---------- */
function draw() {
  const s = engine.state;
  const now = performance.now();
  const ctx = bctx;
  ctx.imageSmoothingEnabled = false;
  const scale = boardCanvas.width / FIELD;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, FIELD, FIELD);

  /* 地形层(砖/钢/河/冰 + 树层);水帧翻转时重建 */
  const waterFrame = Math.floor(now / 400) % 2;
  let sig = '';
  for (let y = 0; y < 26; y++) sig += s.terrain[y].join('');
  const key = `${sig}|${waterFrame}`;
  if (key !== terrainKey) {
    terrainKey = key;
    rebuildTerrain(waterFrame);
  }
  ctx.drawImage(terrainCv, 0, 0);

  /* 基地 */
  ctx.drawImage(s.base.alive ? baseAlive : baseDead, s.base.x, s.base.y);

  /* 道具(闪烁) */
  if (s.powerup && Math.floor(now / 160) % 3 !== 2) {
    ctx.drawImage(powerupSprites[s.powerup.type], s.powerup.x, s.powerup.y);
  }

  /* 子弹 */
  for (const b of s.bullets) ctx.drawImage(bulletSprite, b.x, b.y);

  /* 敌人 */
  const flash = Math.floor(now / 120) % 2 === 0;
  for (const e of s.enemies) {
    if (e.spawnMs > 0) {
      ctx.drawImage(spriteGrid(SPR.SPAWN_STAR, Math.floor(now / 100) % 3), e.x, e.y);
      continue;
    }
    let palKey = e.type === 'armor' ? armorPalKey(e.hp) : e.type;
    if (e.bonus && flash) palKey = 'bonus';
    ctx.drawImage(tankSprite(palKey, e.dir), e.x, e.y);
  }

  /* 玩家 */
  for (const p of s.players) {
    if (p.dead || p.pendingSpawn) continue;
    ctx.drawImage(tankSprite(p.id === 0 ? 'p1' : 'p2', p.dir), p.x, p.y);
    if (p.shieldMs > 0) {
      ctx.drawImage(spriteGrid(SPR.SHIELD, Math.floor(now / 100) % 2), p.x, p.y);
    }
  }

  /* 爆炸特效 */
  drawFx(now);

  /* 铁锹到期前 3s 钢墙闪烁(钢↔砖) */
  if (s.shovelMs > 0 && s.shovelMs < 3000 && Math.floor(now / 250) % 2 === 0) {
    for (const [cx, cy] of engine.BASE_WALL_TILES) {
      ctx.drawImage(tileSprite('B', 0), cx * 16, cy * 16);
    }
  }

  /* 树层置顶(遮挡坦克) */
  ctx.drawImage(treesCv, 0, 0);

  /* 幕布:开局 STAGE N / 过关 */
  if (phase === 'running' || phase === 'paused') {
    if (s.phase === 'intro') {
      curtain(ctx, `STAGE ${s.stage}`);
    } else if (s.phase === 'stage-clear') {
      curtain(ctx, `STAGE ${s.stage} CLEAR!`);
    }
  }

  updateHUD();
}

function curtain(ctx, text) {
  ctx.fillStyle = 'rgba(8, 10, 16, 0.78)';
  ctx.fillRect(0, 0, FIELD, FIELD);
  ctx.fillStyle = '#e8e8e8';
  ctx.font = 'bold 20px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, FIELD / 2, FIELD / 2);
}

/* 剩余敌军图标(5×4 格,画到侧栏小画布) */
let enemySig = '';
function drawEnemyIcons() {
  const s = engine.state;
  const remaining = s.spawnQueue.length - s.spawnedCount + s.enemies.length;
  const sig = String(remaining);
  if (sig === enemySig) return;
  enemySig = sig;
  const w = enemyCanvas.width;
  const h = enemyCanvas.height;
  ectx.imageSmoothingEnabled = false;
  ectx.clearRect(0, 0, w, h);
  const cell = w / 5;
  const icon = tankSprite('basic', 2);
  for (let i = 0; i < remaining && i < 20; i++) {
    const cx = (i % 5) * cell;
    const cy = Math.floor(i / 5) * cell;
    ectx.drawImage(icon, cx + cell * 0.1, cy + cell * 0.1, cell * 0.8, cell * 0.8);
  }
}

/* ---------- HUD ---------- */
let hudCache = '';
function updateHUD() {
  const s = engine.state;
  const remaining = s.spawnQueue.length - s.spawnedCount + s.enemies.length;
  const key = `${s.players[0].score}|${s.stage}|${remaining}|${s.base.alive}|` +
    s.players.map((p) => `${p.lives},${p.power}`).join('|');
  if (key === hudCache) return;
  hudCache = key;
  $('stat-score').textContent = fmtScore(s.players[0].score);
  $('stat-stage').textContent = s.stage;
  $('stat-enemy').textContent = remaining;
  $('stat-best').textContent = best ? fmtScore(best.score) : '--';
  $('p1-lives').textContent = `❤×${Math.max(0, s.players[0].lives)}`;
  $('p1-power').textContent = `★${s.players[0].power}`;
  drawEnemyIcons();
  const baseEl = $('base-state');
  baseEl.textContent = s.base.alive ? '🦅' : '💥';
  baseEl.classList.toggle('destroyed', !s.base.alive);
  if (s.players.length > 1) {
    $('p2-lives').textContent = `❤×${Math.max(0, s.players[1].lives)}`;
    $('p2-power').textContent = `★${s.players[1].power}`;
  }
}

/* ---------- 输入:按下方向栈(最后按下优先) ---------- */
const input = [
  { dirs: [], fire: false },
  { dirs: [], fire: false },
];

function pressDir(pi, dir) {
  const stack = input[pi].dirs;
  const i = stack.indexOf(dir);
  if (i >= 0) stack.splice(i, 1);
  stack.push(dir);
}

function releaseDir(pi, dir) {
  const stack = input[pi].dirs;
  const i = stack.indexOf(dir);
  if (i >= 0) stack.splice(i, 1);
}

function setInputAll() {
  engine.setInput(0, { dir: input[0].dirs[input[0].dirs.length - 1] || null, fire: input[0].fire });
  if (engine.state.players.length > 1) {
    engine.setInput(1, { dir: input[1].dirs[input[1].dirs.length - 1] || null, fire: input[1].fire });
  }
}

/* ---------- 主循环 ---------- */
function loop(now) {
  if (phase === 'running') {
    setInputAll();
    engine.tick(now);
    onEvents(engine.drainEvents(), now);
    if (engine.state.over) gameOver('over', engine.state.overReason);
  }
  draw();
  rafId = requestAnimationFrame(loop);
}

/* ---------- 游戏流程 ---------- */
function startGame() {
  engine.reset({ stage: startStage, players: mode });
  input[0].dirs = [];
  input[1].dirs = [];
  input[0].fire = false;
  input[1].fire = false;
  fx.length = 0;
  phase = 'running';
  startTs = performance.now();
  pausedAcc = 0;
  hudCache = '';
  enemySig = '';
  startOverlay.hidden = true;
  pauseOverlay.hidden = true;
  resultModal.hidden = true;
  $('p2-box').hidden = mode < 2;
  $('result-p2-stat').hidden = mode < 2;
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
    engine.state.paused = false;
    phase = 'running';
    pausedAcc += performance.now() - pauseTs;
    pauseOverlay.hidden = true;
    $('btn-pause').textContent = '⏸';
  }
}

/* endedBy:'over'(基地被毁/命尽) | 'quit' 暂停界面主动结束
   reason:'base' 基地被毁 | 'lives' 全军覆没 */
function gameOver(endedBy, reason) {
  phase = 'over';
  const s = engine.state;
  const duration = Math.round((performance.now() - startTs - pausedAcc) / 1000);
  const date = new Date().toISOString();
  const is2P = s.players.length > 1;

  for (const p of s.players) {
    records.unshift({
      score: p.score, level: s.stage, date, end: endedBy,
      player: is2P ? `${p.id + 1}P` : '1P',
    });
  }
  records = records.slice(0, MAX_RECORDS);
  saveJSON(KEY_RECORDS, records);

  const topScore = Math.max(...s.players.map((p) => p.score));
  const isNewRecord = !best || topScore > best.score;
  if (isNewRecord) {
    best = { score: topScore, level: s.stage, date };
    saveJSON(KEY_BEST, best);
  }

  $('result-emoji').textContent = endedBy === 'quit' ? '🏁' : isNewRecord ? '🏆' : reason === 'base' ? '💥' : '💀';
  $('result-title').textContent = endedBy === 'quit' ? '本局已结束' : reason === 'base' ? '基地被毁' : '全军覆没';
  $('result-record').hidden = !isNewRecord;
  $('result-p1').textContent = fmtScore(s.players[0].score);
  $('result-p2').textContent = is2P ? fmtScore(s.players[1].score) : '--';
  $('result-stage').textContent = s.stage;
  $('result-duration').textContent = fmtDur(duration);
  $('result-best').textContent = best ? fmtScore(best.score) : '0';
  resultModal.hidden = false;
  pauseOverlay.hidden = true;
  $('btn-pause').textContent = '⏸';
}

/* 主动结束本局(进行中或已暂停均可) */
function finishGame() {
  if (phase !== 'running' && phase !== 'paused') return;
  engine.state.over = true;
  gameOver('quit');
}

/* ---------- 历史抽屉 ---------- */
function renderDrawer() {
  $('drawer-best-score').textContent = best ? fmtScore(best.score) : '--';
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
      <span class="rec-meta">${r.player} · 第 ${r.level} 关 · ${r.end === 'quit' ? '主动结束' : '战败'}<br>${fmtDate(r.date)}</span>`;
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

/* ---------- 事件:键盘(1P WASD+空格 / 2P 方向键+回车) ---------- */
const P1_DIRS = { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
const P2_DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const d1 = P1_DIRS[e.code];
  const d2 = P2_DIRS[e.code];
  if (d1) {
    e.preventDefault();
    pressDir(0, d1);
  } else if (d2) {
    e.preventDefault();
    pressDir(1, d2);
  } else if (e.code === 'Space') {
    e.preventDefault();
    input[0].fire = true;
  } else if (e.code === 'Enter') {
    if (phase === 'running' || phase === 'paused') {
      e.preventDefault();
      input[1].fire = true;
    } else if (phase === 'idle') {
      startGame();
    } else if (phase === 'over' && !resultModal.hidden) {
      startGame();
    }
  } else if (e.code === 'KeyP' || e.code === 'Escape') {
    if (phase === 'running' || phase === 'paused') togglePause();
  }
});

document.addEventListener('keyup', (e) => {
  if (P1_DIRS[e.code]) releaseDir(0, P1_DIRS[e.code]);
  else if (P2_DIRS[e.code]) releaseDir(1, P2_DIRS[e.code]);
  else if (e.code === 'Space') input[0].fire = false;
  else if (e.code === 'Enter') input[1].fire = false;
});

/* ---------- 事件:触控摇杆 + FIRE(操控 1P) ---------- */
/* 摇杆:按住拖动即转向,不抬手也能顺滑切换方向(死区 25% 半径,主轴取分量大者) */
const joy = $('joy');
const knob = $('joy-knob');
let joyActive = false;
let joyDir = null;

function joyUpdate(clientX, clientY) {
  const rect = joy.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const radius = rect.width / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  const mag = Math.hypot(dx, dy);
  /* 旋钮视觉偏移:限制在 55% 半径内 */
  const k = mag ? Math.min(mag, radius * 0.55) / mag : 0;
  knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  let dir = null;
  if (mag > radius * 0.25) {
    dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  }
  if (dir !== joyDir) {
    if (joyDir) releaseDir(0, joyDir);
    if (dir) pressDir(0, dir);
    joyDir = dir;
  }
}

joy.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  joyActive = true;
  try { joy.setPointerCapture(e.pointerId); } catch { /* 合成事件可能无活动指针 */ }
  joyUpdate(e.clientX, e.clientY);
});
joy.addEventListener('pointermove', (e) => {
  if (joyActive) joyUpdate(e.clientX, e.clientY);
});
function joyEnd() {
  if (!joyActive) return;
  joyActive = false;
  if (joyDir) {
    releaseDir(0, joyDir);
    joyDir = null;
  }
  knob.style.transform = '';
}
joy.addEventListener('pointerup', joyEnd);
joy.addEventListener('pointercancel', joyEnd);
joy.addEventListener('contextmenu', (e) => e.preventDefault());

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
  el.addEventListener('pointerleave', up);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

bindHold('tc-fire', () => { input[0].fire = true; }, () => { input[0].fire = false; });

/* ---------- 事件:顶栏与浮层 ---------- */
function applyModeUI() {
  $('btn-mode-1p').classList.toggle('active', mode === 1);
  $('btn-mode-2p').classList.toggle('active', mode === 2);
  $('p2-box').hidden = mode < 2;
}

$('btn-mode-1p').addEventListener('click', () => {
  mode = 1;
  settings.players = 1;
  saveJSON(KEY_SETTINGS, settings);
  applyModeUI();
});

$('btn-mode-2p').addEventListener('click', () => {
  mode = 2;
  settings.players = 2;
  saveJSON(KEY_SETTINGS, settings);
  applyModeUI();
});

/* 起始关卡选择(1-35,记忆) */
function applyStageUI() {
  $('stage-num').textContent = startStage;
}

$('btn-stage-down').addEventListener('click', () => {
  startStage = Math.max(1, startStage - 1);
  settings.startStage = startStage;
  saveJSON(KEY_SETTINGS, settings);
  applyStageUI();
});

$('btn-stage-up').addEventListener('click', () => {
  startStage = Math.min(35, startStage + 1);
  settings.startStage = startStage;
  saveJSON(KEY_SETTINGS, settings);
  applyStageUI();
});

/* 砖块破坏方式:经典咬痕(16×8,留掩体)/ 一击整块(16×16,更爽快) */
function applyBrickUI() {
  engine.RULES.wholeBrick = !!settings.wholeBrick;
  $('btn-brick').textContent = settings.wholeBrick ? '砖块:一击整块' : '砖块:经典咬痕';
}

$('btn-brick').addEventListener('click', () => {
  settings.wholeBrick = !settings.wholeBrick;
  saveJSON(KEY_SETTINGS, settings);
  applyBrickUI();
});

$('btn-start').addEventListener('click', startGame);
$('btn-retry').addEventListener('click', startGame);
$('btn-resume').addEventListener('click', togglePause);
$('btn-finish').addEventListener('click', finishGame);
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
applyModeUI();
applyStageUI();
applyBrickUI();
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
