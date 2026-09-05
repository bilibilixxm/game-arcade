/* ==========================================================
   PWA 图标生成器 — 纯 Node 实现,零依赖(node tools/gen-icons.js)
   设计:蓝紫渐变背景 + 马赛克瓷砖拼贴的游戏手柄
        (白色机身、深色十字键与功能键、红蓝黄绿四色按钮)
   产物:icons/icon-180.png(apple-touch-icon)/ 192 / 512
   ========================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- PNG 编码 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgb /* Uint8Array, 3 bytes/px */) {
  // 每行行首加 1 字节过滤类型 0(None)
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0;
    rgb.subarray(y * width * 3, (y + 1) * width * 3).forEach((v, i) => {
      raw[y * (1 + width * 3) + 1 + i] = v;
    });
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- 绘制:马赛克游戏手柄 ---------- */
const lerp = (a, b, t) => a + (b - a) * t;

// 点是否在圆角矩形内(x,y 为像素中心坐标系)
function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.max(x + r, Math.min(px, x + w - r));
  const cy = Math.max(y + r, Math.min(py, y + h - r));
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

/* 像素画定义:22×13 网格,横向手柄
   机身每行的 [起列, 止列](圆角胶囊轮廓) */
const GRID_COLS = 22;
const BODY_ROWS = [
  [6, 15],
  [3, 18],
  [2, 19],
  [1, 20], [1, 20], [1, 20], [1, 20], [1, 20], [1, 20], [1, 20],
  [2, 19],
  [3, 18],
  [6, 15],
];

/* 叠加瓷砖("列,行": 字符)
   D 十字键 · S 开始/选择键 · R/B/Y/G 四色按钮(上红 左蓝 右黄 下绿) */
const OVERLAYS = {
  '6,4': 'D', '6,5': 'D', '6,6': 'D', '6,7': 'D', '6,8': 'D',
  '4,6': 'D', '5,6': 'D', '7,6': 'D', '8,6': 'D',
  '10,6': 'S', '11,6': 'S',
  '16,4': 'R', '15,5': 'B', '17,5': 'Y', '16,6': 'G',
};

const TILE_COLORS = {
  W: [255, 255, 255], // 机身
  D: [42, 50, 71], // 十字键/功能键
  S: [42, 50, 71],
  R: [229, 72, 77],
  B: [65, 199, 240],
  Y: [255, 176, 32],
  G: [62, 207, 142],
};

function drawIcon(S) {
  const img = new Uint8Array(S * S * 3);
  // 渐变端色:靛蓝 → 紫(与合集 UI 主题一致)
  const c1 = [79, 110, 247];
  const c2 = [139, 92, 246];
  // 马赛克参数:手柄主体占宽 86%,瓷砖间留缝露背景
  const cell = (S * 0.86) / GRID_COLS;
  const gap = cell * 0.11;
  const tileR = (cell - gap) * 0.18; // 瓷砖微圆角
  const bx = (S - GRID_COLS * cell) / 2;
  const by = (S - BODY_ROWS.length * cell) / 2;
  const SS = 3; // 3×3 超采样抗锯齿

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let R = 0, G = 0, B = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          let col = null;
          // 只检查采样点所在行的瓷砖(按行分桶,避免 O(S²×全部瓷砖))
          const row = Math.floor((py - by) / cell);
          if (row >= 0 && row < BODY_ROWS.length) {
            const [a, b] = BODY_ROWS[row];
            for (let tx = a; tx <= b; tx++) {
              const rx = bx + tx * cell;
              const ry = by + row * cell;
              if (inRoundRect(px, py, rx + gap / 2, ry + gap / 2, cell - gap, cell - gap, tileR)) {
                col = TILE_COLORS[OVERLAYS[`${tx},${row}`] || 'W'];
                break;
              }
            }
          }
          if (!col) {
            const t = (px + py) / (2 * S); // 对角渐变
            col = [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
          }
          R += col[0]; G += col[1]; B += col[2];
        }
      }
      const n = SS * SS;
      const i = (y * S + x) * 3;
      img[i] = Math.round(R / n);
      img[i + 1] = Math.round(G / n);
      img[i + 2] = Math.round(B / n);
    }
  }
  return encodePNG(S, S, img);
}

/* ---------- 输出 ---------- */
const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [180, 192, 512]) {
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, drawIcon(size));
  console.log(`✓ ${file} (${fs.statSync(file).size} bytes)`);
}
