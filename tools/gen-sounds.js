/* ==========================================================
   小程序音效生成器 — 纯 Node 实现,零依赖(node tools/gen-sounds.js)
   16bit PCM 单声道 44.1kHz WAV,写入 miniprogram/assets/sounds/
   ========================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const SR = 44100; // 采样率

/* ---------- WAV 编码 ---------- */
function encodeWAV(samples /* Float32Array, -1..1 */) {
  const dataLen = samples.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // fmt chunk 长度
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // 单声道
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28); // 字节率
  buf.writeUInt16LE(2, 32); // 块对齐
  buf.writeUInt16LE(16, 34); // 位深
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

/* ---------- 波形合成 ---------- */
function triangle(phase) {
  return 4 * Math.abs(phase - Math.floor(phase + 0.5)) - 1;
}

function sawtooth(phase) {
  return 2 * (phase - Math.floor(phase + 0.5));
}

// 单个音符:freq Hz,dur 秒,从 t0 秒开始;attack 5ms + 指数衰减,消除爆音
function addNote(out, freq, t0, dur, wave, gain = 0.5) {
  const start = Math.floor(t0 * SR);
  const len = Math.floor(dur * SR);
  const attack = Math.floor(0.005 * SR);
  for (let i = 0; i < len; i++) {
    const env =
      i < attack ? i / attack : Math.pow(0.0008, (i - attack) / (len - attack));
    const phase = (freq * i) / SR;
    out[start + i] += wave(phase) * env * gain;
  }
}

function mix(notes, totalSec) {
  const out = new Float32Array(Math.ceil(totalSec * SR));
  for (const n of notes) addNote(out, n.freq, n.t0, n.dur, n.wave, n.gain);
  return out;
}

/* ---------- 音效定义(按游戏分组) ---------- */
const GROUPS = {
  // 舒尔特方块
  schulte: {
    // 正确:短促高音
    'hit.wav': mix([{ freq: 880, t0: 0, dur: 0.07, wave: triangle, gain: 0.45 }], 0.1),
    // 错误:低沉锯齿波
    'wrong.wav': mix([{ freq: 170, t0: 0, dur: 0.16, wave: sawtooth, gain: 0.4 }], 0.2),
    // 完成:C5-E5-G5 上行琶音
    'finish.wav': mix(
      [
        { freq: 523.25, t0: 0, dur: 0.12, wave: triangle, gain: 0.42 },
        { freq: 659.25, t0: 0.12, dur: 0.12, wave: triangle, gain: 0.42 },
        { freq: 783.99, t0: 0.24, dur: 0.25, wave: triangle, gain: 0.45 },
      ],
      0.55
    ),
  },
  // 俄罗斯方块
  tetris: {
    // 移动:极短哒声
    'move.wav': mix([{ freq: 320, t0: 0, dur: 0.04, wave: triangle, gain: 0.3 }], 0.06),
    // 旋转:稍高嗒声
    'rotate.wav': mix([{ freq: 520, t0: 0, dur: 0.05, wave: triangle, gain: 0.32 }], 0.08),
    // 落定:低闷响
    'lock.wav': mix([{ freq: 150, t0: 0, dur: 0.08, wave: sawtooth, gain: 0.3 }], 0.12),
    // 消行:上行双音
    'clear.wav': mix(
      [
        { freq: 660, t0: 0, dur: 0.09, wave: triangle, gain: 0.42 },
        { freq: 880, t0: 0.09, dur: 0.14, wave: triangle, gain: 0.45 },
      ],
      0.28
    ),
    // 升级:C5-E5-G5 琶音
    'levelup.wav': mix(
      [
        { freq: 523.25, t0: 0, dur: 0.1, wave: triangle, gain: 0.4 },
        { freq: 659.25, t0: 0.1, dur: 0.1, wave: triangle, gain: 0.4 },
        { freq: 783.99, t0: 0.2, dur: 0.22, wave: triangle, gain: 0.45 },
      ],
      0.5
    ),
    // 游戏结束:下行三音
    'gameover.wav': mix(
      [
        { freq: 523.25, t0: 0, dur: 0.18, wave: triangle, gain: 0.4 },
        { freq: 392, t0: 0.18, dur: 0.18, wave: triangle, gain: 0.4 },
        { freq: 261.63, t0: 0.36, dur: 0.35, wave: triangle, gain: 0.45 },
      ],
      0.8
    ),
  },
};

/* ---------- 输出 ---------- */
const baseDir = path.join(__dirname, '..', 'miniprogram', 'assets', 'sounds');
for (const [group, sounds] of Object.entries(GROUPS)) {
  const outDir = path.join(baseDir, group);
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, samples] of Object.entries(sounds)) {
    const file = path.join(outDir, name);
    fs.writeFileSync(file, encodeWAV(samples));
    console.log(`✓ ${file} (${fs.statSync(file).size} bytes)`);
  }
}
