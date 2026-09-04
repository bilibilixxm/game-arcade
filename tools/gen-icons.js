/* ==========================================================
   PWA 图标生成器 — 纯 Node 实现,零依赖(node tools/gen-icons.js)
   设计:蓝紫渐变背景 + 3×3 白色圆角方块,中心一块琥珀色
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

/* ---------- 绘制 ---------- */
const lerp = (a, b, t) => a + (b - a) * t;

// 点是否在圆角矩形内(x,y 为像素中心坐标系)
function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.max(x + r, Math.min(px, x + w - r));
  const cy = Math.max(y + r, Math.min(py, y + h - r));
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

function drawIcon(S) {
  const img = new Uint8Array(S * S * 3);
  // 渐变端色:靛蓝 → 紫
  const c1 = [79, 110, 247];
  const c2 = [139, 92, 246];
  // 棋盘参数(相对尺寸)
  const board = S * 0.64; // 3×3 棋盘总宽
  const gap = S * 0.035;
  const cell = (board - 2 * gap) / 3;
  const cellR = cell * 0.22;
  const bx = (S - board) / 2;
  const by = (S - board) / 2;
  const SS = 3; // 3×3 超采样抗锯齿
  const white = [255, 255, 255];
  const amber = [255, 176, 32];

  // 预生成 9 个圆角矩形
  const rects = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      rects.push({
        x: bx + c * (cell + gap),
        y: by + r * (cell + gap),
        color: r === 1 && c === 1 ? amber : white,
      });
    }
  }

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let R = 0, G = 0, B = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          let col = null;
          for (const rc of rects) {
            if (inRoundRect(px, py, rc.x, rc.y, cell, cell, cellR)) {
              col = rc.color;
              break;
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
