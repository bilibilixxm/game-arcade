/* ==========================================================
   俄罗斯方块引擎 — 纯逻辑,零依赖(UMD)
   规则:7-bag 随机、SRS 墙踢、Hold 一次限制、
        重力 max(60, 800-(level-1)×70) ms、每 10 行升级、
        计分 1/2/3/4 消 = 100/300/500/800 × 等级(软降 +1/格、硬降 +2/格)
   规范源:games/tetris/engine.js(改动后需同步本副本,
   并重跑 node tools/tetris-engine.test.js,测试文件可直接改 require 路径验证)
   ========================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TetrisEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TYPES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
  const LINE_SCORES = [0, 100, 300, 500, 800];
  const LOCK_DELAY = 500; // 落地后锁定延迟 ms
  const MAX_LOCK_RESETS = 15; // 移动/旋转重置锁定延迟的最大次数

  /* 生成态形状(包围盒内格子,y 向下);四个旋转态由此推导 */
  const BASE = {
    I: { size: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
    J: { size: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
    L: { size: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
    O: { size: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    S: { size: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
    T: { size: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
    Z: { size: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  };

  /* SHAPES[type][rot] = [[x,y],...] */
  const SHAPES = {};
  for (const t of TYPES) {
    let cur = BASE[t].cells.map((c) => [c[0], c[1]]);
    SHAPES[t] = [];
    for (let r = 0; r < 4; r++) {
      SHAPES[t].push(cur.map((c) => [c[0], c[1]]));
      cur = cur.map(([x, y]) => [BASE[t].size - 1 - y, x]); // 顺时针(y 向下坐标系)
    }
  }

  /* SRS 踢墙表(标准文档坐标,y 向上;应用时 dy = -ky) */
  const KICKS_JLSTZ = {
    '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  };
  const KICKS_I = {
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  };

  function createTetris(opts) {
    const ROWS = (opts && opts.rows) || 20;
    const COLS = (opts && opts.cols) || 10;

    let s; // 对外状态(经 state getter 暴露)
    let bag = [];
    let startLevel = 1; // 起始难度(reset({level}) 设置;升级不会低于它)
    let lastDrop = -1; // 上次重力下落的时间戳(-1 表示待初始化)
    let grounded = false;
    let lockTimer = null;
    let lockResets = 0;

    function emptyBoard() {
      return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    }

    /* ---------- 7-bag ---------- */
    function refillBag() {
      const t = TYPES.slice();
      for (let i = t.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [t[i], t[j]] = [t[j], t[i]];
      }
      bag.push(...t);
    }

    function takeNext() {
      while (bag.length < 8) refillBag();
      return bag.shift();
    }

    /* ---------- 形状与碰撞 ---------- */
    function pieceCells(cur) {
      return SHAPES[cur.type][cur.rot].map(([cx, cy]) => [cur.x + cx, cur.y + cy]);
    }

    function collides(cur) {
      for (const [x, y] of pieceCells(cur)) {
        if (x < 0 || x >= COLS || y >= ROWS) return true;
        if (y >= 0 && s.board[y][x]) return true;
      }
      return false;
    }

    function spawn(type) {
      const cur = { type, x: type === 'O' ? 4 : 3, y: 0, rot: 0 };
      s.current = cur;
      if (collides(cur)) {
        s.over = true; // 出生点被占:游戏结束
      }
    }

    /* ---------- 生命周期 ---------- */
    function reset(opts) {
      startLevel = Math.min(10, Math.max(1, (opts && opts.level) || 1));
      s = {
        board: emptyBoard(),
        current: null,
        hold: null,
        canHold: true,
        next: [], // 预览队列(维持 ≥5)
        score: 0,
        lines: 0,
        level: startLevel,
        over: false,
        paused: false,
      };
      bag = [];
      lastDrop = -1;
      grounded = false;
      lockTimer = null;
      lockResets = 0;
      for (let i = 0; i < 6; i++) s.next.push(takeNext());
      spawn(s.next.shift()); // 取队首为当前块,next 维持 5 个供预览
    }

    function gravityInterval() {
      return Math.max(60, 800 - (s.level - 1) * 70);
    }

    /* 落地状态下成功平移/旋转 → 重置锁定延迟(有次数上限) */
    function onSuccessfulShift() {
      if (grounded && lockTimer !== null && lockResets < MAX_LOCK_RESETS) {
        lockTimer = null;
        lockResets++;
      }
    }

    /* ---------- 主循环:由渲染层每帧调用 ---------- */
    function tick(now) {
      if (s.over || s.paused || !s.current) return;
      if (lastDrop < 0) lastDrop = now;
      if (!collides({ type: s.current.type, rot: s.current.rot, x: s.current.x, y: s.current.y + 1 })) {
        grounded = false;
        lockTimer = null;
        if (now - lastDrop >= gravityInterval()) {
          s.current.y++;
          lastDrop = now;
        }
      } else {
        grounded = true;
        if (lockTimer === null) lockTimer = now;
        else if (now - lockTimer >= LOCK_DELAY) lockPiece();
      }
    }

    /* ---------- 操作 ---------- */
    function tryMove(dx) {
      if (s.over || s.paused || !s.current) return false;
      const moved = { type: s.current.type, rot: s.current.rot, x: s.current.x + dx, y: s.current.y };
      if (collides(moved)) return false;
      s.current = moved;
      onSuccessfulShift();
      return true;
    }

    function moveLeft() {
      return tryMove(-1);
    }

    function moveRight() {
      return tryMove(1);
    }

    function rotate(dir) {
      if (s.over || s.paused || !s.current) return false;
      const cur = s.current;
      if (cur.type === 'O') return false; // O 旋转无变化
      const to = (cur.rot + (dir > 0 ? 1 : 3)) % 4;
      const table = cur.type === 'I' ? KICKS_I : KICKS_JLSTZ;
      for (const [kx, ky] of table[cur.rot + '>' + to]) {
        // SRS 表 y 向上,屏幕坐标 y 向下,故取反
        const cand = { type: cur.type, rot: to, x: cur.x + kx, y: cur.y - ky };
        if (!collides(cand)) {
          s.current = cand;
          onSuccessfulShift();
          return true;
        }
      }
      return false;
    }

    function softDrop() {
      if (s.over || s.paused || !s.current) return false;
      if (collides({ type: s.current.type, rot: s.current.rot, x: s.current.x, y: s.current.y + 1 })) return false;
      s.current.y++;
      s.score += 1;
      lastDrop = -1; // 重置重力计时,避免软降后紧接着又自动掉一格
      return true;
    }

    function hardDrop() {
      if (s.over || s.paused || !s.current) return 0;
      let dist = 0;
      while (!collides({ type: s.current.type, rot: s.current.rot, x: s.current.x, y: s.current.y + 1 })) {
        s.current.y++;
        dist++;
      }
      s.score += dist * 2;
      lockPiece();
      return dist;
    }

    function hold() {
      if (s.over || s.paused || !s.current || !s.canHold) return false;
      const curType = s.current.type;
      if (s.hold === null) {
        s.hold = curType;
        spawn(s.next.shift());
        while (s.next.length < 5) s.next.push(takeNext());
      } else {
        const swap = s.hold;
        s.hold = curType;
        spawn(swap);
      }
      s.canHold = false;
      grounded = false;
      lockTimer = null;
      lockResets = 0;
      lastDrop = -1;
      return true;
    }

    /* ---------- 锁定与消行 ---------- */
    function lockPiece() {
      const cur = s.current;
      for (const [x, y] of pieceCells(cur)) {
        if (y >= 0) s.board[y][x] = cur.type;
      }
      // 消行(自上而下逐行移除再补空行,行序无关)
      let cleared = 0;
      for (let y = 0; y < ROWS; y++) {
        if (s.board[y].every((c) => c)) {
          s.board.splice(y, 1);
          s.board.unshift(Array(COLS).fill(null));
          cleared++;
        }
      }
      if (cleared) {
        s.score += LINE_SCORES[cleared] * s.level;
        s.lines += cleared;
        s.level = Math.max(startLevel, Math.floor(s.lines / 10) + 1);
      }
      grounded = false;
      lockTimer = null;
      lockResets = 0;
      lastDrop = -1;
      s.canHold = true;
      spawn(s.next.shift());
      while (s.next.length < 5) s.next.push(takeNext());
      return cleared;
    }

    /* ---------- 渲染辅助 ---------- */
    function onResume() {
      lastDrop = -1; // 暂停恢复后重新计重力,避免瞬间跳格
    }

    function ghostY() {
      if (!s.current) return 0;
      let y = s.current.y;
      while (!collides({ type: s.current.type, rot: s.current.rot, x: s.current.x, y: y + 1 })) y++;
      return y;
    }

    reset();

    return {
      ROWS,
      COLS,
      reset,
      tick,
      moveLeft,
      moveRight,
      rotate,
      softDrop,
      hardDrop,
      hold,
      lockPiece,
      onResume,
      ghostY,
      pieceCells: () => (s.current ? pieceCells(s.current) : []),
      cellsFor: (type, rot) => SHAPES[type][rot].map((c) => [c[0], c[1]]),
      _takeNext: takeNext, // 测试钩子
      get state() {
        return s;
      },
    };
  }

  return { createTetris, TYPES, SHAPES };
});
