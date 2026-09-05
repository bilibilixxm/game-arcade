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

function sine(phase) {
  return Math.sin(2 * Math.PI * phase);
}

/* 白噪声(每次生成样本不同,听感一致;爆炸/碎砖用) */
function noiseWave() {
  return Math.random() * 2 - 1;
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

/* 滑音音符:freq 线性滑向 freqEnd(坦克大战炮弹/低频爆炸用) */
function addNoteSlide(out, freq, freqEnd, t0, dur, wave, gain = 0.5) {
  const start = Math.floor(t0 * SR);
  const len = Math.floor(dur * SR);
  const attack = Math.floor(0.005 * SR);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const env =
      i < attack ? i / attack : Math.pow(0.0008, (i - attack) / (len - attack));
    phase += (freq + (freqEnd - freq) * (i / len)) / SR;
    out[start + i] += wave(phase) * env * gain;
  }
}

function mix(notes, totalSec) {
  const out = new Float32Array(Math.ceil(totalSec * SR));
  for (const n of notes) {
    if (n.freqEnd) addNoteSlide(out, n.freq, n.freqEnd, n.t0, n.dur, n.wave, n.gain);
    else addNote(out, n.freq, n.t0, n.dur, n.wave, n.gain);
  }
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
  // 坦克大战
  'battle-city': {
    // 开炮:方波 900→240 快速下滑
    'shoot.wav': mix([{ freq: 900, freqEnd: 240, t0: 0, dur: 0.07, wave: sawtooth, gain: 0.3 }], 0.1),
    // 碎砖:短噪声
    'brick.wav': mix([{ freq: 0, t0: 0, dur: 0.06, wave: noiseWave, gain: 0.35 }], 0.09),
    // 打钢:金属高音
    'steel.wav': mix([{ freq: 1250, t0: 0, dur: 0.05, wave: sawtooth, gain: 0.28 }], 0.08),
    // 弹弹互消:低音 + 噪声
    'cancel.wav': mix(
      [
        { freq: 320, t0: 0, dur: 0.05, wave: sawtooth, gain: 0.3 },
        { freq: 0, t0: 0, dur: 0.04, wave: noiseWave, gain: 0.2 },
      ],
      0.08
    ),
    // 小爆炸(子弹命中):中噪声
    'explode.wav': mix([{ freq: 0, t0: 0, dur: 0.18, wave: noiseWave, gain: 0.45 }], 0.22),
    // 大爆炸(坦克/基地):长噪声 + 低频三角波下滑
    'explode-big.wav': mix(
      [
        { freq: 0, t0: 0, dur: 0.45, wave: noiseWave, gain: 0.5 },
        { freq: 90, freqEnd: 45, t0: 0, dur: 0.35, wave: triangle, gain: 0.5 },
      ],
      0.5
    ),
    // 拾取道具:上行三音
    'pickup.wav': mix(
      [
        { freq: 660, t0: 0, dur: 0.08, wave: triangle, gain: 0.42 },
        { freq: 880, t0: 0.08, dur: 0.08, wave: triangle, gain: 0.42 },
        { freq: 1100, t0: 0.16, dur: 0.16, wave: triangle, gain: 0.45 },
      ],
      0.36
    ),
    // 道具出现:双音
    'powerup.wav': mix(
      [
        { freq: 520, t0: 0, dur: 0.1, wave: triangle, gain: 0.4 },
        { freq: 780, t0: 0.12, dur: 0.14, wave: triangle, gain: 0.4 },
      ],
      0.3
    ),
    // 奖命:C5-E5-G5-C6 上行
    'extra-life.wav': mix(
      [
        { freq: 523.25, t0: 0, dur: 0.09, wave: triangle, gain: 0.4 },
        { freq: 659.25, t0: 0.1, dur: 0.09, wave: triangle, gain: 0.4 },
        { freq: 783.99, t0: 0.2, dur: 0.09, wave: triangle, gain: 0.4 },
        { freq: 1046.5, t0: 0.3, dur: 0.24, wave: triangle, gain: 0.45 },
      ],
      0.6
    ),
    // 过关:G4-C5-E5-G5 号角式上行
    'stage-clear.wav': mix(
      [
        { freq: 392, t0: 0, dur: 0.12, wave: triangle, gain: 0.42 },
        { freq: 523.25, t0: 0.13, dur: 0.12, wave: triangle, gain: 0.42 },
        { freq: 659.25, t0: 0.26, dur: 0.12, wave: triangle, gain: 0.42 },
        { freq: 783.99, t0: 0.39, dur: 0.3, wave: triangle, gain: 0.45 },
      ],
      0.75
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
  // 像素小鸟(与 Web 版 Web Audio 合成参数对应)
  flappy: {
    // 扇翅:三角波 340→620 短促上滑
    'wing.wav': mix([{ freq: 340, freqEnd: 620, t0: 0, dur: 0.08, wave: triangle, gain: 0.42 }], 0.12),
    // 过管:920 + 1380 双音
    'point.wav': mix(
      [
        { freq: 920, t0: 0, dur: 0.06, wave: sawtooth, gain: 0.28 },
        { freq: 1380, t0: 0.06, dur: 0.1, wave: sawtooth, gain: 0.28 },
      ],
      0.2
    ),
    // 撞击:锯齿 180→55 下滑
    'hit.wav': mix([{ freq: 180, freqEnd: 55, t0: 0, dur: 0.14, wave: sawtooth, gain: 0.45 }], 0.18),
    // 坠落:三角波 620→130 长下滑
    'die.wav': mix([{ freq: 620, freqEnd: 130, t0: 0, dur: 0.4, wave: triangle, gain: 0.4 }], 0.45),
    // 浮层弹出:240→480 扫音
    'swoosh.wav': mix([{ freq: 240, freqEnd: 480, t0: 0, dur: 0.18, wave: triangle, gain: 0.3 }], 0.22),
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
