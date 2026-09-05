/* ==========================================================
   坦克大战引擎 — 纯逻辑,零依赖(UMD)
   规则:场地 208×208(26×26 个 8px 子格)、坦克 16×16、
        每关 20 敌(同屏 ≤4,第 4/11/18 辆为道具坦克)、
        火力 1-4 档、6 道具、转向 8px 吸附、友伤=冻结
   规范源:games/battle-city/engine.js(改动后需同步本副本,
   并重跑 node tools/battle-city-engine.test.js,测试文件可直接改 require 路径验证)
   ========================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BattleCityEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 几何常量 ---------- */
  const TILE = 16;   // 坦克/大格 16px
  const SUBTILE = 8; // 地形子格 8px(砖块破坏粒度)
  const COLS = 13, ROWS = 13, SUB = 26, FIELD = 208;

  /* 方向:0 上 1 右 2 下 3 左(即精灵顺时针旋转次数) */
  const DIRS = [
    { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 },
  ];
  const DIR_NAMES = { up: 0, right: 1, down: 2, left: 3 };

  /* ---------- 速度(px/s,手感定标;可用 overrides 调) ---------- */
  const SPEEDS = {
    slow: 30, normal: 45, fast: 90,
    bulletSlow: 120, bulletNormal: 180, bulletFast: 240,
  };

  /* ---------- 时序(ms) ---------- */
  const TIMINGS = {
    spawnShieldMs: 3000,  // 出生护盾
    helmetMs: 10000,      // 头盔护盾
    freezeMs: 8000,       // 时钟冻结
    shovelMs: 15000,      // 铁锹钢墙
    spawnCdMs: 3000,      // 敌人刷新间隔
    spawnFlashMs: 800,    // 出生闪烁(不动不可伤)
    respawnMs: 1000,      // 玩家重生延迟
    spawnRetryMs: 200,    // 出生点被占重试间隔
    friendlyFreezeMs: 1500, // 友伤冻结
    slideMs: 350,         // 冰面滑行时长
    stageClearMs: 2000,   // 过关幕布
    introMs: 1000,        // 开局 STAGE N 幕布
  };

  /* ---------- 规则常量 ---------- */
  const RULES = {
    maxEnemies: 4,
    totalEnemies: 20,
    bonusSlots: [3, 10, 17], // 0 基下标 = 第 4/11/18 辆
    steelHp: 2,              // 钢块可被打次数(满级火力;可调 1)
    extraLifeEvery: 20000,
    startLives: 3,
    maxPlayerPower: 4,
    pushAllowed: true,       // 坦克贴推开关
    wholeBrick: false,       // 一击整块:命中即毁整块 16×16 砖(默认关=经典 16×8 咬痕)
  };

  /* ---------- 敌型参数 ---------- */
  const ENEMY_TYPES = {
    basic: { speed: 'slow',   bullet: 'bulletSlow',   hp: 1, score: 100 },
    fast:  { speed: 'fast',   bullet: 'bulletNormal', hp: 1, score: 200 },
    power: { speed: 'normal', bullet: 'bulletFast',   hp: 1, score: 300 },
    armor: { speed: 'normal', bullet: 'bulletNormal', hp: 4, score: 400 },
  };
  const POWERUP_TYPES = ['helmet', 'clock', 'shovel', 'star', 'grenade', 'tank'];
  const ENEMY_SCORES = { basic: 100, fast: 200, power: 300, armor: 400 };

  /* 基地与护墙固定布局(13×13 大格坐标):基地 (6,12),护墙 U 形包围 */
  const BASE_TILE = { cx: 6, cy: 12 };
  const BASE_WALL_TILES = [
    [5, 11], [5, 12], [6, 11], [7, 11], [7, 12],
  ];
  const ENEMY_SPAWNS = [{ x: 0, y: 0 }, { x: 96, y: 0 }, { x: 192, y: 0 }];
  const PLAYER_SPAWNS = [{ x: 64, y: 192 }, { x: 128, y: 192 }];

  /* ---------- 工具 ---------- */
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const isHorizontal = (d) => d === 1 || d === 3;
  const aabb = (ax, ay, bx, by, size) =>
    ax < bx + size && bx < ax + size && ay < by + size && by < ay + size;

  /* 计数轮转发牌:[18,2,0,0] → b f b f b b b …(每轮从仍有余量的类型按序各取 1) */
  function expandQueue(counts) {
    const order = ['basic', 'fast', 'power', 'armor'];
    const left = counts.slice();
    const total = counts.reduce((a, b) => a + b, 0);
    const out = [];
    let progressed = true;
    while (out.length < total && progressed) {
      progressed = false;
      for (let i = 0; i < order.length; i++) {
        if (left[i] > 0) { out.push(order[i]); left[i]--; progressed = true; }
      }
    }
    return out;
  }

  /* 转向吸附:垂直轴坐标吸到最近 8px,平局偏向原运动方向 */
  function snapTo8(perp, prevSign) {
    const lo = Math.floor(perp / SUBTILE) * SUBTILE;
    const hi = lo + SUBTILE;
    const dLo = perp - lo, dHi = hi - perp;
    if (dHi < dLo) return hi;
    if (dLo < dHi) return lo;
    return prevSign > 0 ? hi : lo;
  }

  function createBattleCity(opts) {
    opts = opts || {};
    const SPEED = Object.assign({}, SPEEDS, (opts.overrides && opts.overrides.SPEEDS) || {});
    const TIME = Object.assign({}, TIMINGS, (opts.overrides && opts.overrides.TIMINGS) || {});
    const RULE = Object.assign({}, RULES, (opts.overrides && opts.overrides.RULES) || {});
    const levels = opts.levels;
    const rng = opts.rng || Math.random;

    /* ---------- 内部状态 ---------- */
    let s = null;

    function stageData(n) {
      const stages = levels && levels.STAGES;
      if (!stages || !stages.length) throw new Error('BattleCity: levels.STAGES 未注入');
      const idx = ((n - 1) % stages.length + stages.length) % stages.length;
      return stages[idx];
    }

    function emptyTerrain() {
      const t = [];
      for (let y = 0; y < SUB; y++) t.push(new Array(SUB).fill(null));
      return t;
    }

    /* 大格坐标 → 2×2 子格写入 */
    function setBig(t, cx, cy, code) {
      for (let oy = 0; oy < 2; oy++)
        for (let ox = 0; ox < 2; ox++) t[cy * 2 + oy][cx * 2 + ox] = code;
    }

    function buildTerrain(stageNum) {
      const t = emptyTerrain();
      const map = stageData(stageNum).map;
      for (let cy = 0; cy < ROWS; cy++) {
        const row = map[cy] || '';
        for (let cx = 0; cx < COLS; cx++) {
          const ch = row[cx] || '.';
          if (ch === 'B' || ch === 'S' || ch === 'W' || ch === 'T' || ch === 'I') setBig(t, cx, cy, ch);
        }
      }
      /* 基地与护墙由代码固定放置(防手抄错位;shovel 需程序化重建) */
      setBig(t, BASE_TILE.cx, BASE_TILE.cy, 'F');
      for (const [cx, cy] of BASE_WALL_TILES) setBig(t, cx, cy, 'B');
      return t;
    }

    /* ---------- 碰撞 ---------- */
    /* 坦克 AABB 覆盖的子格是否存在阻挡地形(砖/钢/河/基地) */
    function terrainBlocked(x, y) {
      if (x < 0 || y < 0 || x + TILE > FIELD || y + TILE > FIELD) return true;
      const sx0 = Math.floor(x / SUBTILE), sx1 = Math.floor((x + TILE - 0.01) / SUBTILE);
      const sy0 = Math.floor(y / SUBTILE), sy1 = Math.floor((y + TILE - 0.01) / SUBTILE);
      for (let sy = sy0; sy <= sy1; sy++)
        for (let sx = sx0; sx <= sx1; sx++) {
          const c = s.terrain[sy][sx];
          if (c === 'B' || c === 'S' || c === 'W' || c === 'F') return true;
        }
      return false;
    }

    function allTanks() {
      return s.players.filter((p) => !p.dead && !p.pendingSpawn).concat(s.enemies);
    }

    /* 与其他坦克重叠检测(可选忽略某个) */
    function tankBlocked(x, y, self) {
      for (const t of allTanks()) {
        if (t === self) continue;
        if (aabb(x, y, t.x, t.y, TILE)) return t;
      }
      return null;
    }

    /* 单轴位移尝试;被坦克挡住时按 RULE.pushAllowed 贴推 */
    function tryMove(tank, dir, dist) {
      const d = DIRS[dir];
      let nx = tank.x + d.dx * dist;
      let ny = tank.y + d.dy * dist;
      if (terrainBlocked(nx, ny)) return false;
      const other = tankBlocked(nx, ny, tank);
      if (other) {
        if (!RULE.pushAllowed) return false;
        /* 被推者沿同方向畅通才推 */
        if (terrainBlocked(other.x + d.dx * dist, other.y + d.dy * dist)) return false;
        if (tankBlocked(other.x + d.dx * dist, other.y + d.dy * dist, other)) return false;
        other.x += d.dx * dist;
        other.y += d.dy * dist;
      }
      tank.x = nx; tank.y = ny;
      return true;
    }

    /* 转向(玩家/敌人共用):吸附可能位移 ±4px,失败则只改朝向;
       同轴反向(上↔下、左↔右)无垂直轴变化,不吸附 */
    function turn(tank, newDir) {
      if (newDir === tank.dir) return;
      if (isHorizontal(newDir) !== isHorizontal(tank.dir)) {
        const perpAxis = isHorizontal(newDir) ? 'y' : 'x'; // 新方向垂直轴 = 原运动轴
        const perp = tank[perpAxis];
        const sign = DIRS[tank.dir][perpAxis === 'x' ? 'dx' : 'dy'];
        const cand = snapTo8(perp, sign);
        if (cand !== perp) {
          const old = tank[perpAxis];
          tank[perpAxis] = cand;
          if (terrainBlocked(tank.x, tank.y) || tankBlocked(tank.x, tank.y, tank)) {
            tank[perpAxis] = old; // 吸附会进墙/叠坦克 → 回退
          }
        }
      }
      tank.dir = newDir;
    }

    /* ---------- 子弹 ---------- */
    function liveBulletsOf(owner) {
      return s.bullets.filter((b) => b.owner === owner);
    }

    function fire(tank, from, power) {
      const owner = from === 'player' ? 'p' + tank.id : 'e' + tank.id;
      const maxBullets = from === 'player' ? (power >= 3 ? 2 : 1) : 1;
      if (liveBulletsOf(owner).length >= maxBullets) return false;
      const speedKey = from === 'player'
        ? (power >= 2 ? 'bulletFast' : 'bulletSlow')
        : ENEMY_TYPES[tank.type].bullet;
      s.bullets.push({
        owner, from, power: from === 'player' ? power : 1,
        dir: tank.dir,
        x: tank.x + TILE / 2 - 2, y: tank.y + TILE / 2 - 2, // 4×4,炮口=坦克中心
        speed: SPEED[speedKey],
      });
      s.events.push({ type: 'shoot', owner, from });
      return true;
    }

    /* 弹命中点(x,y 为弹中心)对砖/钢咬一口 */
    function chewTerrain(bullet) {
      const vertical = bullet.dir === 0 || bullet.dir === 2; // 纵向飞
      const across = (bullet.power >= 4 || RULE.wholeBrick) ? TILE : SUBTILE; // 横向 8px,满级/整块模式 16px
      /* 命中检测以弹中心所在子格为准 → 咬痕从该子格向墙体内延伸 16px(恰 2 个子格) */
      const hitCol = Math.floor((bullet.x + 2) / SUBTILE);
      const hitRow = Math.floor((bullet.y + 2) / SUBTILE);
      /* 横向带:满级 = 中心 ±8(整 16px);整块模式 = 吸附到弹着点所在 16px 大格;经典 = 弹中心所在 8px 半格 */
      const pc = vertical ? bullet.x + 2 : bullet.y + 2;
      const bandStart = bullet.power >= 4 ? pc - SUBTILE
        : RULE.wholeBrick ? Math.floor(pc / TILE) * TILE
        : Math.floor(pc / SUBTILE) * SUBTILE;
      const x0 = vertical ? bandStart
        : bullet.dir === 1 ? hitCol * SUBTILE : hitCol * SUBTILE - SUBTILE;
      const x1 = x0 + (vertical ? across : TILE);
      const y0 = vertical ? (bullet.dir === 2 ? hitRow * SUBTILE : hitRow * SUBTILE - SUBTILE)
        : bandStart;
      const y1 = y0 + (vertical ? TILE : across);

      let hitBrick = false, hitSteel = false, brokeSteel = false;
      const sx0 = Math.max(0, Math.floor(x0 / SUBTILE)), sx1 = Math.min(SUB - 1, Math.floor((x1 - 0.01) / SUBTILE));
      const sy0 = Math.max(0, Math.floor(y0 / SUBTILE)), sy1 = Math.min(SUB - 1, Math.floor((y1 - 0.01) / SUBTILE));
      for (let sy = sy0; sy <= sy1; sy++) {
        for (let sx = sx0; sx <= sx1; sx++) {
          const c = s.terrain[sy][sx];
          if (c === 'B') { s.terrain[sy][sx] = null; hitBrick = true; }
          else if (c === 'S') {
            hitSteel = true;
            if (bullet.power >= 4) {
              s.steelHpMap[sy][sx] -= 1;
              if (s.steelHpMap[sy][sx] <= 0) { s.terrain[sy][sx] = null; brokeSteel = true; }
            }
          }
        }
      }
      if (hitSteel) s.events.push({ type: 'steel', broke: brokeSteel, x: bullet.x, y: bullet.y });
      else if (hitBrick) s.events.push({ type: 'brick', x: bullet.x, y: bullet.y });
    }

    /* 弹中心所在子格地形(基地判定用) */
    function subCodeAt(px, py) {
      const sx = Math.floor(px / SUBTILE), sy = Math.floor(py / SUBTILE);
      if (sx < 0 || sy < 0 || sx >= SUB || sy >= SUB) return null;
      return s.terrain[sy][sx];
    }

    /* 单个子步的弹碰撞(返回 false 表示弹已消) */
    function bulletStep(b) {
      const d = DIRS[b.dir];
      b.x += d.dx * 4; b.y += d.dy * 4;
      const cx = b.x + 2, cy = b.y + 2; // 弹中心

      /* 边界 */
      if (cx < 0 || cy < 0 || cx > FIELD || cy > FIELD) { killBullet(b); return false; }

      /* 基地(任何来源) */
      const code = subCodeAt(cx, cy);
      if (code === 'F') {
        killBullet(b);
        s.base.alive = false;
        s.events.push({ type: 'base-hit', x: b.x, y: b.y });
        endGame('base');
        return false;
      }

      /* 地形:砖可咬,钢看火力,河/树/冰穿过 */
      const sx = Math.floor(cx / SUBTILE), sy = Math.floor(cy / SUBTILE);
      const sub = s.terrain[sy] ? s.terrain[sy][sx] : null;
      if (sub === 'B' || sub === 'S') {
        chewTerrain(b);
        killBullet(b);
        return false;
      }

      /* 弹 × 弹(任意两弹互消) */
      for (const o of s.bullets) {
        if (o === b || o.dead) continue;
        if (aabb(b.x, b.y, o.x, o.y, 4)) {
          killBullet(b); killBullet(o);
          s.events.push({ type: 'bullet-cancel', x: b.x, y: b.y });
          return false;
        }
      }

      /* 弹 × 坦克 */
      if (b.from === 'enemy') {
        for (const p of s.players) {
          if (p.dead || p.pendingSpawn) continue;
          if (aabb(b.x, b.y, p.x, p.y, TILE)) {
            killBullet(b);
            if (p.shieldMs > 0) return false; // 护盾:弹毁无伤
            killPlayer(p);
            return false;
          }
        }
      } else {
        /* 玩家弹 → 敌人 */
        for (const e of s.enemies) {
          if (aabb(b.x, b.y, e.x, e.y, TILE)) {
            killBullet(b);
            if (e.spawnMs > 0) return false; // 出生闪烁中不可伤
            e.hp -= 1;
            if (e.hp > 0) {
              s.events.push({ type: 'tank-hit', x: e.x, y: e.y, hp: e.hp });
            } else {
              killEnemy(e, b.owner);
            }
            return false;
          }
        }
        /* 玩家弹 → 队友:冻结而非死亡(原版友伤) */
        for (const p of s.players) {
          if (p.dead || p.pendingSpawn) continue;
          const myId = Number(b.owner.slice(1));
          if (p.id === myId) continue;
          if (aabb(b.x, b.y, p.x, p.y, TILE)) {
            killBullet(b);
            p.frozenMs = TIME.friendlyFreezeMs;
            s.events.push({ type: 'friendly-freeze', id: p.id });
            return false;
          }
        }
      }
      return true;
    }

    function killBullet(b) { b.dead = true; }

    function killEnemy(e, owner) {
      const i = s.enemies.indexOf(e);
      if (i >= 0) s.enemies.splice(i, 1);
      s.killedCount++;
      s.explodeBig.push({ x: e.x, y: e.y, t: 0 });
      s.events.push({ type: 'explode', x: e.x, y: e.y, big: true });
      if (owner && owner[0] === 'p') {
        const p = s.players[Number(owner.slice(1))];
        if (p) addScore(p, ENEMY_SCORES[e.type]);
      }
      if (e.bonus) spawnPowerup();
      if (s.spawnQueue.length === 0 && s.enemies.length === 0 && s.phase === 'playing') {
        s.phase = 'stage-clear';
        s.clearMs = TIME.stageClearMs;
        s.events.push({ type: 'stage-clear' });
      }
    }

    function killPlayer(p) {
      s.events.push({ type: 'explode', x: p.x, y: p.y, big: true });
      s.events.push({ type: 'player-dead', id: p.id });
      p.power = 1;
      p.lives -= 1;
      if (p.lives > 0) {
        p.pendingSpawn = true;
        p.respawnMs = TIME.respawnMs;
      } else {
        p.dead = true;
      }
      /* 坦克本体从场上移除(pendingSpawn/dead 后不再参与碰撞) */
      if (p.lives <= 0) {
        const alive = s.players.filter((q) => !q.dead);
        if (alive.length === 0) endGame('lives');
      }
    }

    function addScore(p, n) {
      const before = Math.floor(p.score / RULE.extraLifeEvery);
      p.score += n;
      const after = Math.floor(p.score / RULE.extraLifeEvery);
      if (after > before && !p.dead) {
        p.lives += 1;
        s.events.push({ type: 'extra-life', id: p.id, lives: p.lives });
      }
    }

    function endGame(reason) {
      if (s.phase === 'game-over') return;
      s.phase = 'game-over';
      s.over = true;
      s.overReason = reason;
      s.events.push({ type: 'game-over', reason });
    }

    /* ---------- 道具 ---------- */
    function spawnPowerup() {
      /* 16 个候选大格位(避开基地区/护墙/出生点带),rng 选一空地 */
      const candidates = [];
      for (let cy = 1; cy < 11; cy++) {
        for (let cx = 1; cx < 12; cx++) {
          const px = cx * TILE, py = cy * TILE;
          if (px === 0 || px === 96 || px === 192) continue; // 避开敌人刷新列
          candidates.push({ x: px, y: py });
        }
      }
      const spot = candidates[Math.floor(rng() * candidates.length)] || { x: 32, y: 64 };
      const type = POWERUP_TYPES[Math.floor(rng() * POWERUP_TYPES.length)];
      s.powerup = { type, x: spot.x, y: spot.y };
      s.events.push({ type: 'powerup-spawn', x: spot.x, y: spot.y, powerup: type });
    }

    function applyPowerup(p, type) {
      s.events.push({ type: 'powerup-get', id: p.id, powerup: type });
      addScore(p, 500);
      switch (type) {
        case 'helmet': p.shieldMs = TIME.helmetMs; break;
        case 'clock': s.freezeMs = TIME.freezeMs; break;
        case 'star': p.power = Math.min(RULE.maxPlayerPower, p.power + 1); break;
        case 'tank': p.lives += 1; break;
        case 'grenade': {
          /* 全灭场上敌人(出生闪烁中的除外;不记分) */
          for (const e of s.enemies.slice()) {
            if (e.spawnMs > 0) continue;
            s.enemies.splice(s.enemies.indexOf(e), 1);
            s.killedCount++;
            s.explodeBig.push({ x: e.x, y: e.y, t: 0 });
            s.events.push({ type: 'explode', x: e.x, y: e.y, big: true });
          }
          if (s.spawnQueue.length === 0 && s.enemies.length === 0 && s.phase === 'playing') {
            s.phase = 'stage-clear';
            s.clearMs = TIME.stageClearMs;
            s.events.push({ type: 'stage-clear' });
          }
          break;
        }
        case 'shovel': buildBaseWall('S'); s.shovelMs = TIME.shovelMs; break;
      }
    }

    /* 重建基地护墙:code 'B' 完整砖 / 'S' 钢(并清 steelHpMap) */
    function buildBaseWall(code) {
      for (const [cx, cy] of BASE_WALL_TILES) {
        setBig(s.terrain, cx, cy, code);
        if (code === 'S') {
          for (let oy = 0; oy < 2; oy++)
            for (let ox = 0; ox < 2; ox++)
              s.steelHpMap[cy * 2 + oy][cx * 2 + ox] = RULE.steelHp;
        }
      }
    }

    /* ---------- 敌人 AI ---------- */
    function pickDir() {
      /* 权重 up1/right2/down4/left2(偏向下 = 朝基地方向) */
      const r = rng() * 9;
      return r < 1 ? 0 : r < 3 ? 1 : r < 7 ? 2 : 3;
    }

    function enemyAI(e, dt) {
      if (e.spawnMs > 0) { e.spawnMs -= dt; return; }
      if (s.freezeMs > 0) return;
      e.aiDecideMs -= dt;
      if (e.aiDecideMs <= 0) {
        e.aiDecideMs = 800 + rng() * 1600;
        if (rng() < 0.4) e.dir = pickDir();
      }
      const dist = SPEED[ENEMY_TYPES[e.type].speed] * dt / 1000;
      if (!tryMove(e, e.dir, dist)) {
        e.dir = pickDir(); // 被挡立即换向
        tryMove(e, e.dir, dist);
      }
      e.fireMs -= dt;
      if (e.fireMs <= 0) {
        e.fireMs = 600 + rng() * 1800;
        fire(e, 'enemy', 1);
      }
    }

    /* ---------- 出生 ---------- */
    function spawnPointFree(pt) {
      return !tankBlocked(pt.x, pt.y, null);
    }

    function trySpawnEnemy() {
      for (let i = 0; i < 3; i++) {
        const idx = (s.spawnPointIdx + i) % 3;
        const pt = ENEMY_SPAWNS[idx];
        if (!spawnPointFree(pt)) continue;
        s.spawnPointIdx = (idx + 1) % 3;
        const type = s.spawnQueue[s.spawnedCount];
        s.spawnedCount++;
        s.enemies.push({
          id: s.nextEnemyId++, type,
          bonus: RULE.bonusSlots.includes(s.spawnedCount - 1),
          x: pt.x, y: pt.y, dir: 2, moving: false,
          hp: ENEMY_TYPES[type].hp,
          spawnMs: TIME.spawnFlashMs,
          aiDecideMs: 0, fireMs: 600 + rng() * 1800,
        });
        s.events.push({ type: 'spawn' });
        return true;
      }
      return false; // 三点全占,等待重试
    }

    function respawnPlayer(p) {
      const pt = PLAYER_SPAWNS[p.id];
      if (!spawnPointFree(pt)) { p.respawnMs = TIME.spawnRetryMs; return false; }
      p.x = pt.x; p.y = pt.y;
      p.dir = 0; p.moving = false; p.sliding = false;
      p.shieldMs = TIME.spawnShieldMs;
      p.frozenMs = 0;
      p.pendingSpawn = false;
      return true;
    }

    /* ---------- 玩家 tick ---------- */
    function playerTick(p, dt) {
      if (p.dead || p.pendingSpawn) {
        if (p.pendingSpawn) {
          p.respawnMs -= dt;
          if (p.respawnMs <= 0) respawnPlayer(p); // 出生点被占则下一帧重试
        }
        return;
      }
      if (p.shieldMs > 0) p.shieldMs -= dt;
      if (p.frozenMs > 0) {
        p.frozenMs -= dt;
        /* 被队友冻住:不能移动,仍可开火(原版友伤规则) */
        if (p.input.fire && !p.lastFire) fire(p, 'player', p.power);
        p.lastFire = !!p.input.fire;
        return;
      }

      const inp = p.input;
      if (inp.dir !== null && inp.dir !== undefined) {
        if (inp.dir !== p.dir) turn(p, inp.dir);
        const dist = SPEED.normal * dt / 1000;
        p.moving = tryMove(p, p.dir, dist);
        p.sliding = false;
        p.wasMoving = true;
      } else {
        p.moving = false;
        /* 冰面滑行:刚松开方向且中心在冰上 → 沿原方向惯性 */
        const cx = p.x + TILE / 2, cy = p.y + TILE / 2;
        if (p.wasMoving && !p.sliding && subCodeAt(cx, cy) === 'I') {
          p.sliding = true; p.slideLeft = TIME.slideMs;
        }
        p.wasMoving = false;
        if (p.sliding) {
          const dist = SPEED.normal * dt / 1000;
          if (!tryMove(p, p.dir, dist)) p.sliding = false;
          else {
            p.slideLeft -= dt;
            if (p.slideLeft <= 0 || subCodeAt(p.x + TILE / 2, p.y + TILE / 2) !== 'I') p.sliding = false;
          }
        }
      }

      /* 开火:上升沿 */
      if (inp.fire && !p.lastFire) fire(p, 'player', p.power);
      p.lastFire = !!inp.fire;
    }

    /* ---------- 拾取 ---------- */
    function pickupTick() {
      if (!s.powerup) return;
      for (const p of s.players) {
        if (p.dead || p.pendingSpawn) continue;
        if (aabb(p.x, p.y, s.powerup.x, s.powerup.y, TILE)) {
          const type = s.powerup.type;
          s.powerup = null;
          applyPowerup(p, type);
          break;
        }
      }
    }

    /* ---------- reset / nextStage ---------- */
    function reset(o) {
      o = o || {};
      const stageNum = o.stage || (s ? s.stage : opts.stage || 1);
      const playersMode = o.players !== undefined ? o.players : (s ? s.playersMode : opts.players || 1);
      const keep = !!o.keepProgress && s;
      const oldPlayers = keep ? s.players : null;

      s = {
        stage: stageNum,
        playersMode: playersMode,
        phase: 'intro', introMs: TIME.introMs, clearMs: 0,
        over: false, overReason: null, paused: false,
        terrain: buildTerrain(stageNum),
        steelHpMap: [],
        base: { x: BASE_TILE.cx * TILE, y: BASE_TILE.cy * TILE, alive: true },
        players: [], enemies: [], bullets: [],
        powerup: null, // 道具不跨关保留
        spawnQueue: expandQueue(stageData(stageNum).enemies),
        spawnedCount: 0, killedCount: 0,
        spawnCdMs: TIME.spawnCdMs, spawnPointIdx: 0,
        nextEnemyId: 1,
        freezeMs: 0, shovelMs: 0,
        explodeBig: [],
        lastNow: -1,
        events: [],
      };
      for (let y = 0; y < SUB; y++) s.steelHpMap.push(new Array(SUB).fill(RULE.steelHp));

      for (let i = 0; i < playersMode; i++) {
        const prev = keep && oldPlayers && oldPlayers[i];
        s.players.push({
          id: i,
          x: PLAYER_SPAWNS[i].x, y: PLAYER_SPAWNS[i].y, dir: 0,
          moving: false, sliding: false, slideLeft: 0,
          score: prev ? prev.score : 0,
          power: prev ? prev.power : 1,
          lives: prev ? prev.lives : RULE.startLives,
          shieldMs: TIME.spawnShieldMs, frozenMs: 0,
          respawnMs: 0, dead: false, pendingSpawn: false,
          input: { dir: null, fire: false }, lastFire: false,
        });
      }
      return s;
    }

    function nextStage() {
      reset({ stage: s.stage + 1, keepProgress: true });
    }

    /* ---------- 主循环 ---------- */
    function tick(now) {
      if (!s || s.over || s.paused) return;
      if (s.lastNow < 0) { s.lastNow = now; return; }
      const dt = Math.min(now - s.lastNow, 50);
      s.lastNow = now;

      /* 开局/过关幕布:只走计时 */
      if (s.phase === 'intro') {
        s.introMs -= dt;
        if (s.introMs <= 0) s.phase = 'playing';
        return;
      }
      if (s.phase === 'stage-clear') {
        s.clearMs -= dt;
        if (s.clearMs <= 0) nextStage();
        return;
      }
      if (s.phase !== 'playing') return;

      /* 1. 全局计时器 */
      if (s.freezeMs > 0) s.freezeMs -= dt;
      if (s.shovelMs > 0) {
        s.shovelMs -= dt;
        if (s.shovelMs <= 0) buildBaseWall('B'); // 到期完整还原为砖
      }

      /* 2. 敌人刷新 */
      if (s.spawnQueue.length > s.spawnedCount && s.enemies.length < RULE.maxEnemies) {
        s.spawnCdMs -= dt;
        if (s.spawnCdMs <= 0) {
          if (trySpawnEnemy()) s.spawnCdMs = TIME.spawnCdMs;
          else s.spawnCdMs = TIME.spawnRetryMs; // 三点全占,稍后重试
        }
      }

      /* 3. 玩家 */
      for (const p of s.players) playerTick(p, dt);

      /* 4. 敌人 */
      for (const e of s.enemies.slice()) enemyAI(e, dt);

      /* 5. 子弹(子步 ≤4px 防穿透) */
      for (const b of s.bullets) {
        let steps = Math.ceil((b.speed * dt / 1000) / 4);
        steps = clamp(steps, 1, 12);
        for (let i = 0; i < steps; i++) if (!bulletStep(b)) break;
      }
      s.bullets = s.bullets.filter((b) => !b.dead);

      /* 6. 拾取 */
      pickupTick();

      /* 7. 爆炸动画计时(UI 也自行处理;这里推进供无动画场景复用) */
      for (const ex of s.explodeBig) ex.t += dt;
      s.explodeBig = s.explodeBig.filter((ex) => ex.t < 500);

      /* 7.5 敌军清空且队列耗尽 → 过关 */
      if (!s.over && s.spawnedCount >= s.spawnQueue.length && s.enemies.length === 0) {
        s.phase = 'stage-clear';
        s.clearMs = TIME.stageClearMs;
        s.events.push({ type: 'stage-clear' });
      }

      /* 8. 胜负(双玩家皆亡) */
      if (!s.over && s.players.length > 1 && s.players.every((p) => p.dead)) endGame('lives');
    }

    /* ---------- 初始化 ---------- */
    reset();

    /* ---------- 对外 API ---------- */
    return {
      TILE, SUBTILE, COLS, ROWS, SUB, FIELD, DIRS,
      SPEEDS: SPEED, TIMINGS: TIME, RULES: RULE,
      ENEMY_TYPES, PLAYER_SPAWNS, ENEMY_SPAWNS, BASE_WALL_TILES, BASE_TILE,
      reset,
      nextStage,
      tick,
      setInput(idx, input) {
        const p = s && s.players[idx];
        if (!p) return;
        if (input && 'dir' in input) {
          p.input.dir = input.dir == null ? null
            : typeof input.dir === 'number' ? input.dir : DIR_NAMES[input.dir];
        }
        if (input && 'fire' in input) p.input.fire = !!input.fire;
      },
      drainEvents() {
        const ev = s ? s.events : [];
        s.events = [];
        return ev;
      },
      get state() { return s; },
      tileAt(px, py) {
        return subCodeAt(Math.floor(px / SUBTILE) * SUBTILE + 1, Math.floor(py / SUBTILE) * SUBTILE + 1);
      },
      subAt(sx, sy) {
        return s && s.terrain[sy] ? s.terrain[sy][sx] : undefined;
      },
      expandQueue,
    };
  }

  return { createBattleCity, expandQueue, snapTo8,
    TILE, SUBTILE, COLS, ROWS, SUB, FIELD, DIRS, SPEEDS, TIMINGS, RULES,
    ENEMY_TYPES, POWERUP_TYPES, ENEMY_SCORES };
});
