/* ==========================================================
   坦克大战像素精灵 — 纯数据 + 数据变换(UMD,零依赖)
   规范源:games/battle-city/sprites.js
   小程序副本:miniprogram/libs/battle-city-sprites.js(改动后手动同步)
   约定:字符像素图,'.' 透明;坦克只存上向基准图,
   其余方向用 rotateCW 数据旋转(平台侧只需 drawImage)。
   armor 变色 / bonus 闪红用调色板替换(零额外像素图)。
   平台侧把 grid+palette 物化为离屏图(每帧杜绝逐像素 fillRect)。
   ========================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BattleCitySprites = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 坦克(上向基准 16×16) ----------
     A 暗部描边 / B 主体 / C 高光,颜色由调色板给出 */
  const TANK_UP = [
    '.......AA.......',
    '.......AA.......',
    '.......AA.......',
    'ABA...BBBB...ABA',
    'BCB...BBBB...BCB',
    'ABA..BBBBBB..ABA',
    'BCB..BBBBBB..BCB',
    'ABA.BBBBBBBB.ABA',
    'BCB.BBBBBBBB.BCB',
    'ABA.BBBCCBBB.ABA',
    'BCB.BBBCCBBB.BCB',
    'ABA.BBBBBBBB.ABA',
    'BCB.BBBBBBBB.BCB',
    'ABA.BBBBBBBB.ABA',
    'BCB..BBBBBB..BCB',
    'ABA..BBBBBB..ABA',
  ];

  /* 顺时针旋转 90°(字符串像素图,方向 n = 旋转次数) */
  function rotateCW(grid) {
    const h = grid.length, w = grid[0].length;
    const out = [];
    for (let x = 0; x < w; x++) {
      let row = '';
      for (let y = h - 1; y >= 0; y--) row += grid[y][x];
      out.push(row);
    }
    return out;
  }

  function rotateN(grid, n) {
    let g = grid;
    for (let i = 0; i < n; i++) g = rotateCW(g);
    return g;
  }

  /* 方向 0 上 1 右 2 下 3 左(与引擎 DIRS 下标一致) */
  const TANK_DIRS = [0, 1, 2, 3].map((n) => rotateN(TANK_UP, n));

  /* 坦克调色板:玩家 2 色 + 敌 4 型 + armor 血量变色 + bonus 红闪 */
  const TANK_PALETTES = {
    p1: { A: '#7a4a00', B: '#e8a000', C: '#ffe14d' },   // 1P 黄
    p2: { A: '#0f4a1e', B: '#2fa045', C: '#7fe05a' },   // 2P 绿
    basic: { A: '#3a3a3a', B: '#9c9c9c', C: '#d4d4d4' }, // 灰
    fast: { A: '#0e4446', B: '#1f9e9e', C: '#7fe3d8' },  // 青
    power: { A: '#4a4a5a', B: '#d0d0e0', C: '#ffffff' }, // 白
    armor4: { A: '#0f3d2e', B: '#2e9e5b', C: '#8fe08a' },// 绿(满血)
    armor3: { A: '#6b4a00', B: '#c98f10', C: '#ffd94d' },// 黄
    armor2: { A: '#2e3d4a', B: '#7a96a8', C: '#c8dbe8' },// 青灰
    armor1: { A: '#333333', B: '#8a8a8a', C: '#c0c0c0' },// 灰(残血)
    bonus: { A: '#5a0a0a', B: '#e03030', C: '#ff9a6a' }, // 道具坦红闪
  };

  /* ---------- 地形块(8×8) ---------- */
  const TILES = {
    brick: {
      pal: { b: '#bc4a20', m: '#401408' },
      frames: [[
        'bbbmbbbm',
        'bbbmbbbm',
        'bbbmbbbm',
        'mmmmmmmm',
        'bmbbbmbb',
        'bmbbbmbb',
        'bmbbbmbb',
        'mmmmmmmm',
      ]],
    },
    steel: {
      pal: { w: '#d8dce0', g: '#9aa0a8', d: '#4a4e55' },
      frames: [[
        'wwwwwwww',
        'wggggggd',
        'wgddgggd',
        'wgddddgd',
        'wgddddgd',
        'wgddgggd',
        'wggggggd',
        'dddddddd',
      ]],
    },
    water: {
      pal: { d: '#2050c8', l: '#5a8af0' },
      frames: [
        [
          'lddddddd',
          'dddddddd',
          'dddddldd',
          'dddddddd',
          'dddldddd',
          'dddddddd',
          'lddddddd',
          'dddddddd',
        ],
        [
          'dddldddd',
          'dddddddd',
          'lddddddd',
          'dddddddd',
          'dddddldd',
          'dddddddd',
          'dddldddd',
          'dddddddd',
        ],
      ],
    },
    trees: {
      pal: { g: '#1e7a1e', G: '#0f4a0f' },
      frames: [[
        'gGgggGgg',
        'gggGgggG',
        'GgggGggg',
        'ggGgggGg',
        'ggggGggg',
        'gGgggggG',
        'gggGgGgg',
        'GgggGggg',
      ]],
    },
    ice: {
      pal: { i: '#c8d8e4', I: '#ffffff', c: '#9ac0dc' },
      frames: [[
        'iIiiIiIi',
        'IiiIiIii',
        'iiIiiIiI',
        'iIiiIiiI',
        'IiIiiIii',
        'iiIiIiIi',
        'iIiiIiiI',
        'IiiIiIii',
      ]],
    },
  };

  /* ---------- 基地(16×16,鹰 / 摧毁) ---------- */
  const BASE = {
    pal: { w: '#e8e8e8', d: '#5a5a5a', r: '#8a2020', l: '#a8a8a8' },
    frames: [
      [ // alive:鹰
        '................',
        '.......ww.......',
        '......wwww......',
        '..w..wwwwww..w..',
        '.www.wwwwww.www.',
        '.wwwwwwwwwwwwww.',
        'wwwwwwwwwwwwwwww',
        '.wwwwwwwwwwwwww.',
        '..wwwwwwwwwwww..',
        '....wwwwwwww....',
        '...dddddddddd...',
        '...d........d...',
        '...dddddddddd...',
        '....dddddddd....',
        '................',
        '................',
      ],
      [ // dead:残骸
        '................',
        '................',
        '................',
        '................',
        '.....r......r...',
        '..r.....dr......',
        '.....dr.....r...',
        '..r.....r.dr....',
        '....dr.r....r...',
        '..r....r.dr.....',
        '...dr.r....r....',
        '.r....dr........',
        '..dr....r.dr....',
        '.r..dr.r........',
        '................',
        '................',
      ],
    ],
  };

  /* ---------- 子弹(4×4,菱形,旋转不变 → 全方向同图) ---------- */
  const BULLET = {
    pal: { w: '#e8e8e8', d: '#4a4e55' },
    grid: [
      '.ww.',
      'wddw',
      'wddw',
      '.ww.',
    ],
  };

  /* ---------- 程序化帧:爆炸 / 出生星 / 护盾(两平台一致) ---------- */
  function burst(size, spec) {
    const c = (size - 1) / 2;
    const rows = [];
    for (let y = 0; y < size; y++) {
      let row = '';
      for (let x = 0; x < size; x++) {
        const dx = x - c, dy = y - c;
        const m = Math.abs(dx) + Math.abs(dy);
        let lit = false;
        if (spec.solid && m <= spec.solid) lit = true;
        if (m >= (spec.ring0 || 0) && m <= (spec.ring1 || 0)) lit = true;
        if (spec.rays && (Math.abs(dx) < 0.6 || Math.abs(dy) < 0.6) && m <= spec.rays) lit = true;
        if (lit && spec.sparse && (x + y) % 2 === 1) lit = false;
        row += lit ? (spec.solid && m <= spec.solid ? 'h' : 'x') : '.';
      }
      rows.push(row);
    }
    return rows;
  }

  function diamond(size, r) {
    const c = (size - 1) / 2;
    const rows = [];
    for (let y = 0; y < size; y++) {
      let row = '';
      for (let x = 0; x < size; x++) {
        row += Math.abs(x - c) + Math.abs(y - c) <= r ? 'x' : '.';
      }
      rows.push(row);
    }
    return rows;
  }

  function shieldGrid(size, r, phase) {
    const c = (size - 1) / 2;
    const rows = [];
    for (let y = 0; y < size; y++) {
      let row = '';
      for (let x = 0; x < size; x++) {
        const dx = x - c, dy = y - c;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (Math.abs(dist - r) < 0.55) {
          const seg = Math.floor((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 4) + phase);
          row += seg % 2 === 0 ? 'x' : '.';
        } else row += '.';
      }
      rows.push(row);
    }
    return rows;
  }

  const EXPLODE_SMALL = {
    pal: { h: '#ffe8a0', x: '#ff8a2a' },
    frames: [burst(16, { solid: 2 }), burst(16, { ring0: 2, ring1: 5, rays: 6 })],
  };
  const EXPLODE_BIG = {
    pal: { h: '#ffe8a0', x: '#ff8a2a' },
    frames: [
      burst(32, { solid: 4 }),
      burst(32, { solid: 1, ring0: 4, ring1: 8, rays: 10 }),
      burst(32, { ring0: 5, ring1: 10, rays: 15, sparse: true }),
    ],
  };
  const SPAWN_STAR = {
    pal: { x: '#ffffff' },
    frames: [diamond(16, 2), diamond(16, 3.6), diamond(16, 5)],
  };
  const SHIELD = {
    pal: { x: '#8ad8ff' },
    frames: [shieldGrid(16, 7.2, 0), shieldGrid(16, 7.2, 1)],
  };

  /* ---------- 道具图标(16×16) ---------- */
  const POWERUP = {
    pal: { w: '#e8e8e8', d: '#4a4e55', y: '#ffd83d', l: '#a8a8a8', r: '#e03030' },
    icons: {
      helmet: [
        '................',
        '................',
        '................',
        '....wwwwwww.....',
        '...wwwwwwwww....',
        '..wwwwwwwwwww...',
        '..wwwwwwwwwww...',
        '..wwwwwwwwwww...',
        '..lwwwwwwwwwl...',
        '...lllllllll....',
        '................',
        '................',
        '................',
        '................',
        '................',
        '................',
      ],
      clock: [
        '................',
        '................',
        '.....wwwwww.....',
        '....ww....ww....',
        '...ww...w..ww...',
        '...ww...w..ww...',
        '..ww....w...ww..',
        '..ww....www..ww.',
        '..ww........ww..',
        '...ww......ww...',
        '...ww......ww...',
        '....ww....ww....',
        '.....wwwwww.....',
        '................',
        '................',
        '................',
      ],
      shovel: [
        '................',
        '................',
        '.........ddd....',
        '........ddd.....',
        '.......ddd......',
        '......ddd.......',
        '.....ddd........',
        '....ddd.........',
        '...lll..........',
        '..lllll.........',
        '..lllll.........',
        '...lll..........',
        '................',
        '................',
        '................',
        '................',
      ],
      star: [
        '................',
        '.......yy.......',
        '.......yy.......',
        '......yyyy......',
        '..yyyyyyyyyyyy..',
        '...yyyyyyyyyy...',
        '....yyyyyyyy....',
        '.....yyyyyy.....',
        '....yyyyyyyy....',
        '....yyy..yyy....',
        '...yy......yy...',
        '..yy........yy..',
        '................',
        '................',
        '................',
        '................',
      ],
      grenade: [
        '................',
        '................',
        '........dd......',
        '.......ddd......',
        '.....dddd.......',
        '....dddddd......',
        '...ddlddddd.....',
        '...ddlddddd.....',
        '...dddddddd.....',
        '...dddddddd.....',
        '....dddddd......',
        '.....dddd.......',
        '................',
        '................',
        '................',
        '................',
      ],
      // tank 图标直接复用坦克上向基准图
    },
  };
  POWERUP.icons.tank = TANK_UP;

  return {
    TANK_UP, TANK_DIRS, TANK_PALETTES, rotateCW, rotateN,
    TILES, BASE, BULLET, POWERUP,
    EXPLODE_SMALL, EXPLODE_BIG, SPAWN_STAR, SHIELD,
  };
});
