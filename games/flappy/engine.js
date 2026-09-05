/* ==========================================================
   Flappy Bird 引擎 — 纯逻辑,零依赖(UMD)
   Web 版 <script> 与小程序 require 共用同一份算法。
   规范源:games/flappy/engine.js
   小程序副本:miniprogram/libs/flappy-engine.js(改动后手动同步)
   规则:竖屏 288×512、地面条 112、飞行区 400;
        重力/扇翅/终端速度/滚动全部 dt 制(px/s,原版 60fps 值×60);
        管道宽 52、缺口 100、间距 172;触顶只钳位,撞管→坠落,
        触地→结束;过管 +1,奖牌 10/20/30/40
   随机数经 opts.rng 注入(仅缺口位置),全程可确定性复现
   ========================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlappyEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 几何常量 ---------- */
  const W = 288, H = 512;
  const GROUND_H = 112;
  const PLAY_H = H - GROUND_H; // 400 飞行区高

  /* ---------- 物理(px/s,手感定标;可用 overrides 调) ---------- */
  const SPEEDS = {
    gravity: 900,  // 0.25 px/帧² × 3600
    flapVel: -276, // -4.6 px/帧 × 60
    maxFall: 630,  // 下落终端速度
    scroll: 120,   // 世界滚动速度(管道/地面)
  };

  /* ---------- 规则常量 ---------- */
  const RULES = {
    gap: 100,          // 缺口高
    pipeWidth: 52,
    pipeSpacing: 172,  // 相邻管道 x 间距
    gapMin: 90,        // 缺口中心范围(缺口完整落在飞行区内,边距 40)
    gapMax: 310,
    birdX: 57,         // 鸟固定 x(左上角)
    birdW: 34, birdH: 24, // 显示尺寸(17×12 精灵 ×2)
    hitW: 24, hitH: 16,   // 命中盒(比显示尺寸宽容)
    medalAt: [10, 20, 30, 40], // 铜/银/金/白金
  };

  /* 管道生成 x(略出右屏,避免凭空出现) */
  const SPAWN_X = W + 30;

  function createFlappy(opts) {
    opts = opts || {};
    const rng = opts.rng || Math.random;
    const RULE = Object.assign({}, RULES, (opts.overrides && opts.overrides.RULES) || {});
    const SPEED = Object.assign({}, SPEEDS, (opts.overrides && opts.overrides.SPEEDS) || {});

    let s = null;

    function reset() {
      s = {
        phase: 'ready', // ready | playing | dying | over
        bird: { x: RULE.birdX, y: PLAY_H / 2 - RULE.birdH / 2, vel: 0 },
        pipes: [], // { x, gapY, passed } gapY 为缺口中心 y
        score: 0,
        time: 0,   // 累计秒(渲染层浮动/扑翼动画用)
        lastNow: -1,
        events: [],
      };
    }

    function spawnPipe(x) {
      const gapY = RULE.gapMin + Math.floor(rng() * (RULE.gapMax - RULE.gapMin + 1));
      s.pipes.push({ x, gapY, passed: false });
    }

    /* 扇翅:ready 态首次扇翅即开局;playing 态重置上升速度;其余忽略 */
    function flap() {
      if (!s) return;
      if (s.phase === 'ready') {
        s.phase = 'playing';
        spawnPipe(SPAWN_X);
        s.bird.vel = SPEED.flapVel;
        s.events.push({ type: 'flap' });
        return;
      }
      if (s.phase !== 'playing') return;
      s.bird.vel = SPEED.flapVel;
      s.events.push({ type: 'flap' });
    }

    /* 命中盒(中心对齐,比显示尺寸小一圈) */
    function birdRect() {
      const b = s.bird;
      return {
        x: b.x + (RULE.birdW - RULE.hitW) / 2,
        y: b.y + (RULE.birdH - RULE.hitH) / 2,
        w: RULE.hitW, h: RULE.hitH,
      };
    }

    function overlap(r, x, y, w, h) {
      return r.x < x + w && r.x + r.w > x && r.y < y + h && r.y + r.h > y;
    }

    function land() {
      s.bird.y = PLAY_H - RULE.birdH;
      s.bird.vel = 0;
      s.phase = 'over';
      s.events.push({ type: 'gameover', score: s.score });
    }

    function tick(now) {
      if (!s) return;
      if (s.lastNow === -1 || now === -1) { s.lastNow = now; return; } // 首帧哨兵不算 dt
      let dt = (now - s.lastNow) / 1000;
      s.lastNow = now;
      if (dt < 0) dt = 0;
      if (dt > 0.05) dt = 0.05; // 后台切回等大步长钳制
      s.time += dt;

      if (s.phase === 'ready' || s.phase === 'over') return;

      const b = s.bird;

      /* 重力积分(playing 与 dying 都坠落) */
      b.vel = Math.min(b.vel + SPEED.gravity * dt, SPEED.maxFall);
      b.y += b.vel * dt;

      /* 触顶只钳位不死(原版行为) */
      if (b.y < 0) { b.y = 0; if (b.vel < 0) b.vel = 0; }

      if (s.phase === 'dying') {
        /* 坠落中:世界静止,仅等触地 */
        if (b.y + RULE.birdH >= PLAY_H) land();
        return;
      }

      /* ---- playing:滚动 / 出管 / 计分 / 碰撞 ---- */
      const dx = SPEED.scroll * dt;
      for (const p of s.pipes) p.x -= dx;
      while (s.pipes.length && s.pipes[0].x + RULE.pipeWidth < 0) s.pipes.shift();
      const last = s.pipes[s.pipes.length - 1];
      if (!last || SPAWN_X - last.x >= RULE.pipeSpacing) spawnPipe(SPAWN_X);

      /* 碰撞:管道(上半 + 下半)与地面 —— 先于计分,同帧撞击不给分 */
      const r = birdRect();
      for (const p of s.pipes) {
        if (r.x + r.w < p.x || r.x > p.x + RULE.pipeWidth) continue;
        const topH = p.gapY - RULE.gap / 2;
        const botY = p.gapY + RULE.gap / 2;
        if (overlap(r, p.x, 0, RULE.pipeWidth, topH)
          || overlap(r, p.x, botY, RULE.pipeWidth, PLAY_H - botY)) {
          s.phase = 'dying';
          s.events.push({ type: 'hit' });
          s.events.push({ type: 'die' });
          return;
        }
      }
      if (b.y + RULE.birdH >= PLAY_H) {
        s.events.push({ type: 'hit' });
        land();
        return;
      }

      /* 过管计分:鸟中心越过管道中心,恰好一次 */
      const birdCx = b.x + RULE.birdW / 2;
      for (const p of s.pipes) {
        if (!p.passed && p.x + RULE.pipeWidth / 2 < birdCx) {
          p.passed = true;
          s.score += 1;
          s.events.push({ type: 'point', score: s.score });
        }
      }
    }

    reset();

    return {
      reset,
      flap,
      tick,
      drainEvents() {
        const ev = s ? s.events : [];
        s.events = [];
        return ev;
      },
      get state() { return s; },
      W, H, GROUND_H, SPEEDS: SPEED, RULES: RULE, SPAWN_X,
    };
  }

  return { createFlappy, W, H, GROUND_H, SPEEDS, RULES, SPAWN_X };
});
