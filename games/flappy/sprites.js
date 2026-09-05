/* ==========================================================
   Flappy Bird 像素资产 — 纯数据,零依赖(UMD)
   Web 版 <script> 与小程序 require 共用同一份像素图。
   规范源:games/flappy/sprites.js
   小程序副本:miniprogram/libs/flappy-sprites.js(改动后手动同步)
   字符像素图:'.' 透明;小鸟 17×12 三帧(翅上/中/下),
   三色羽装经 PALETTES 调色板替换(零额外像素图);
   DIGITS 为 5×7 记分数字(渲染层放大 + 描边)
   ========================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlappySprites = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 小鸟 17×12,三帧仅翅位不同 ---------- */
  const BIRD_FRAMES = [
    /* 翅上 */
    [
      '......kkkkkk.....',
      '....kkyyywwwwk...',
      '...kyyyywwwwkwk..',
      '..kkcccywwwwkwk..',
      '.kcccccyywwwkwk..',
      '.kccccccyykkkkkk.',
      '.kkcccckyyoooooK.',
      '.kkyyyyyykrrrrrk.',
      '..kkyyyyykooooK..',
      '...kkdddddkkkkk..',
      '....kkdddddddk...',
      '......kkkkkkk....',
    ],
    /* 翅中 */
    [
      '......kkkkkk.....',
      '....kkyyywwwwk...',
      '...kyyyywwwwkwk..',
      '..kyyyyywwwwkwk..',
      '.kkccckyywwwkwk..',
      '.kccccckyykkkkkk.',
      '.kcccccckyyoooooK',
      '.kkcccccckrrrrrk.',
      '..kkccccckooooK..',
      '...kkdddddkkkkk..',
      '....kkdddddddk...',
      '......kkkkkkk....',
    ],
    /* 翅下 */
    [
      '......kkkkkk.....',
      '....kkyyywwwwk...',
      '...kyyyywwwwkwk..',
      '..kyyyyywwwwkwk..',
      '.kkyyyyyywwwkwk..',
      '.kkcccckyykkkkkk.',
      '.kcccccckyyoooooK',
      '.kkcccccckrrrrrk.',
      '..kkccccckooooK..',
      '...kkcccdkkkkkk..',
      '....kkdddddddk...',
      '......kkkkkkk....',
    ],
  ];

  /* ---------- 三色羽装调色板(k 描边共用) ---------- */
  const PALETTES = {
    yellow: { y: '#f8d34c', d: '#de9b26', c: '#f6ecc9', w: '#ffffff', o: '#f87858', r: '#d9452f' },
    red: { y: '#f8564d', d: '#c93a34', c: '#f8d8c0', w: '#ffffff', o: '#f8b050', r: '#d9452f' },
    blue: { y: '#4fc0e8', d: '#3878b8', c: '#c8ecf4', w: '#ffffff', o: '#f8b050', r: '#d9452f' },
  };
  /* 描边色(三色共用,原版深棕黑) */
  const OUTLINE = '#533846';

  /* ---------- 记分数字 5×7('#' 为笔画) ---------- */
  const DIGITS = {
    0: ['#####', '#...#', '#...#', '#...#', '#...#', '#...#', '#####'],
    1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '#####'],
    2: ['#####', '....#', '....#', '#####', '#....', '#....', '#####'],
    3: ['#####', '....#', '....#', '#####', '....#', '....#', '#####'],
    4: ['#...#', '#...#', '#...#', '#####', '....#', '....#', '....#'],
    5: ['#####', '#....', '#....', '#####', '....#', '....#', '#####'],
    6: ['#####', '#....', '#....', '#####', '#...#', '#...#', '#####'],
    7: ['#####', '....#', '...#.', '..#..', '..#..', '..#..', '..#..'],
    8: ['#####', '#...#', '#...#', '#####', '#...#', '#...#', '#####'],
    9: ['#####', '#...#', '#...#', '#####', '....#', '....#', '#####'],
  };

  /* ---------- 物化:字符图 → 像素矩阵(渲染层再上屏) ----------
     makeSprite(frame, paletteName) → { w, h, px: [[r,g,b,a],...] } */
  function makeSprite(frame, paletteName) {
    const pal = PALETTES[paletteName] || PALETTES.yellow;
    const h = frame.length;
    const w = frame[0].length;
    const px = [];
    for (let y = 0; y < h; y++) {
      const row = [];
      for (let x = 0; x < w; x++) {
        const ch = frame[y][x];
        if (ch === '.') row.push(null);
        else if (ch === 'k' || ch === 'K') row.push(OUTLINE);
        else row.push(pal[ch] || null);
      }
      px.push(row);
    }
    return { w, h, px };
  }

  return { BIRD_FRAMES, PALETTES, OUTLINE, DIGITS, makeSprite };
});
