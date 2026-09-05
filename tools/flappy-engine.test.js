/* ==========================================================
   Flappy Bird 引擎单元测试 — node tools/flappy-engine.test.js
   直接 require 引擎,白盒访问 state 构造确定性场景
   随机数用 () => 0 或种子序列注入,保证完全可复现
   ========================================================== */
'use strict';

const { createFlappy, W, H, GROUND_H, SPEEDS, RULES, SPAWN_X } = require('../games/flappy/engine.js');

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}${ok || !detail ? '' : ' — ' + detail}`);
};

/* mulberry32 种子随机(确定性验证用) */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fresh(opts = {}) {
  return createFlappy(Object.assign({ rng: () => 0 }, opts));
}

/* 固定步长时钟 */
function mkClock() {
  let t = 0;
  return { step: (ms = 16) => { t += ms; return t; }, now: () => t };
}

const near = (a, b, eps = 0.51) => Math.abs(a - b) <= eps;

/* ---------- 1. 常量与初始态 ---------- */
{
  const g = fresh();
  check('几何常量', W === 288 && H === 512 && GROUND_H === 112 && SPAWN_X === 318);
  check('物理常量', SPEEDS.gravity === 900 && SPEEDS.flapVel === -276
    && SPEEDS.maxFall === 630 && SPEEDS.scroll === 120);
  check('规则常量', RULES.gap === 100 && RULES.pipeWidth === 52
    && RULES.pipeSpacing === 172 && RULES.birdX === 57);
  const s = g.state;
  check('初始 ready 态', s.phase === 'ready' && s.score === 0 && s.pipes.length === 0);
  check('初始鸟位于中线', s.bird.x === 57 && near(s.bird.y, 188) && s.bird.vel === 0);
}

/* ---------- 2. dt 首帧哨兵与钳制 ---------- */
{
  const g = fresh();
  const c = mkClock();
  g.tick(c.step());
  check('首帧哨兵不计 dt', g.state.time === 0);
  g.tick(c.step(1000)); // 1s 大步长
  check('dt 钳制 50ms', near(g.state.time, 0.05));
}

/* ---------- 3. ready 态静止 ---------- */
{
  const g = fresh();
  const c = mkClock();
  for (let i = 0; i < 30; i++) g.tick(c.step());
  const s = g.state;
  check('ready 不坠落不出管', s.bird.y === 188 && s.bird.vel === 0 && s.pipes.length === 0);
  check('ready 计时仍在走(浮动动画用)', g.state.time > 0.4);
}

/* ---------- 4. flap:开局与冲量 ---------- */
{
  const g = fresh();
  g.flap();
  const s = g.state;
  check('首次 flap 切 playing', s.phase === 'playing');
  check('flap 冲量', s.bird.vel === SPEEDS.flapVel);
  check('开局即生成首管(出屏外)', s.pipes.length === 1 && s.pipes[0].x === SPAWN_X && SPAWN_X > W);
  check('flap 事件', g.drainEvents().length === 1 && g.drainEvents().length === 0);

  const g2 = fresh();
  g2.flap();
  const c = mkClock();
  for (let i = 0; i < 30; i++) g2.tick(c.step()); // 下落获得正速度
  check('下落后 flap 重置为上升', g2.flap() === undefined
    && g2.state.bird.vel === SPEEDS.flapVel);
}

/* ---------- 5. 重力积分与终端速度 ---------- */
{
  const g = fresh();
  const c = mkClock();
  g.tick(c.step()); // 烧掉首帧哨兵
  g.flap();
  g.tick(c.step()); // 16ms
  check('重力积分 vel += g·dt', near(g.state.bird.vel, SPEEDS.flapVel + 900 * 0.016));
  let capped = true;
  for (let i = 0; i < 300; i++) {
    g.state.bird.y = 50; // 悬空,规避触地/撞管
    g.state.pipes = [];
    g.tick(c.step(50));
    if (g.state.bird.vel < SPEEDS.maxFall - 0.01 && i > 60) capped = false;
  }
  check('下落终端速度钳制', capped && g.state.bird.vel === SPEEDS.maxFall);
}

/* ---------- 6. 触顶只钳位不死 ---------- */
{
  const g = fresh();
  const c = mkClock();
  g.tick(c.step());
  g.flap();
  g.state.bird.y = 4;
  g.tick(c.step());
  check('触顶钳位 y=0 vel=0 仍存活', g.state.bird.y === 0 && g.state.bird.vel === 0
    && g.state.phase === 'playing');
}

/* ---------- 7. 管道推进与间距生成(鸟钉在缺口内保持存活) ---------- */
{
  const g = fresh();
  const c = mkClock();
  g.tick(c.step());
  g.flap();
  const puppet = () => { g.state.bird.y = 80; g.state.bird.vel = 0; }; // gapY=90 缺口 40..140 内
  puppet();
  const x0 = g.state.pipes[0].x;
  g.tick(c.step(50)); // 0.05s → 6px
  check('管道随世界滚动', near(x0 - g.state.pipes[0].x, 6));

  for (let i = 0; i < 200 && g.state.pipes.length < 2; i++) { puppet(); g.tick(c.step()); }
  check('按 172px 间距生成第二根管', g.state.pipes.length === 2
    && Math.abs(SPAWN_X - g.state.pipes[0].x - RULES.pipeSpacing) <= 2.5,
  String(SPAWN_X - g.state.pipes[0].x));

  /* 缺口范围(rng=0 → gapMin)与出屏回收 */
  check('缺口中心落在 [90,310]', g.state.pipes.every((p) => p.gapY >= RULES.gapMin && p.gapY <= RULES.gapMax));
  for (let i = 0; i < 2000; i++) { puppet(); g.tick(c.step()); }
  check('长时间滚动场内 ≤4 根(出屏回收)', g.state.pipes.length <= 4);
}

/* ---------- 8. rng 注入:缺口确定性 ---------- */
{
  const run = () => {
    const g = fresh({ rng: mulberry32(42) });
    const c = mkClock();
    g.tick(c.step());
    g.flap();
    const seen = new Set(); // 收集所有出现过的管(出屏回收后场内只剩新管)
    for (let i = 0; i < 2000; i++) {
      /* 自适应 puppet:瞬移到最近管道缺口中心,保证一路穿管 */
      const next = g.state.pipes.find((p) => p.x + RULES.pipeWidth > g.state.bird.x);
      g.state.bird.y = next ? next.gapY - 12 : 188;
      g.state.bird.vel = 0;
      g.tick(c.step());
      for (const p of g.state.pipes) seen.add(p);
      if (g.state.score >= 4) break; // puppet 穿管计分,同屏最多 ~3 根不能当计数
    }
    return [...seen].map((p) => p.gapY);
  };
  const gaps = run();
  const gaps2 = run();
  check('同种子缺口序列一致', JSON.stringify(gaps) === JSON.stringify(gaps2)
    && gaps.length >= 4, JSON.stringify(gaps));
  check('种子随机覆盖多缺口值', new Set(gaps).size > 1, JSON.stringify(gaps));
}

/* ---------- 9. 过管计分(恰好一次) ---------- */
{
  const g = fresh();
  const c = mkClock();
  g.tick(c.step());
  g.flap();
  const puppet = () => { g.state.bird.y = 80; g.state.bird.vel = 0; }; // 缺口内,不撞管
  puppet();
  const p = g.state.pipes[0];
  p.x = 67; // 管道中心 93 > 鸟中心 74 → 未过
  g.tick(c.step());
  check('未越管不计分', g.state.score === 0);
  p.x = 40; // 中心 66 < 74 → 过
  puppet();
  g.tick(c.step());
  check('越过管道中心 +1', g.state.score === 1 && p.passed === true);
  puppet();
  g.tick(c.step());
  puppet();
  g.tick(c.step());
  check('同一管道只计一次', g.state.score === 1);
  const evs = g.drainEvents();
  check('point 事件恰好一条', evs.filter((e) => e.type === 'point').length === 1);
}

/* ---------- 10. 碰撞:上管 / 下管 / dying 态 ---------- */
function hitSetup() {
  const g = fresh();
  const c = mkClock();
  g.tick(c.step()); // 烧哨兵
  g.flap();
  g.state.pipes[0].x = 60; // 鸟命中盒 x 62..86 与管 60..112 重叠
  return g;
}
{
  const g = hitSetup();
  g.state.pipes[0].gapY = 200; // 上管 0..150,下管 250..400
  g.state.bird.y = 120; // 命中盒 124..140 → 撞上管
  g.state.bird.vel = 0;
  const c = mkClock();
  g.tick(c.step());
  const evs = g.drainEvents();
  check('撞上管进入 dying', g.state.phase === 'dying');
  check('撞管事件 hit+die', evs.some((e) => e.type === 'hit') && evs.some((e) => e.type === 'die'));

  const x0 = g.state.pipes[0].x;
  const y0 = g.state.bird.y;
  for (let i = 0; i < 5; i++) g.tick(c.step(50));
  check('dying 世界停止滚动', g.state.pipes[0].x === x0);
  check('dying 不再计分', g.state.score === 0);
  check('dying 继续坠落', g.state.bird.y > y0);

  for (let i = 0; i < 300 && g.state.phase !== 'over'; i++) g.tick(c.step(50));
  check('dying 触地转 over', g.state.phase === 'over' && g.state.bird.y === 376);
  check('over 事件带分数', g.drainEvents().some((e) => e.type === 'gameover' && e.score === 0));

  const ev2 = (() => { const n = g.state.events.length; g.flap(); return g.state.events.length - n; })();
  check('over 后 flap 被忽略', ev2 === 0 && g.state.phase === 'over');
}
{
  const g = hitSetup();
  g.state.pipes[0].gapY = 200;
  g.state.bird.y = 250; // 命中盒 254..270 与下管 250..400 重叠
  g.state.bird.vel = 0;
  const c = mkClock();
  g.tick(c.step());
  check('撞下管进入 dying', g.state.phase === 'dying');
}

/* ---------- 11. 触地直接结束(playing) ---------- */
{
  const g = fresh();
  const c = mkClock();
  g.tick(c.step());
  g.flap();
  g.state.bird.y = 380; // 底缘 404 已越地面
  g.state.bird.vel = 0;
  g.tick(c.step());
  const evs = g.drainEvents();
  check('playing 触地直接 over', g.state.phase === 'over' && g.state.bird.y === 376);
  check('触地事件 hit+gameover(无 die)', evs.some((e) => e.type === 'hit')
    && evs.some((e) => e.type === 'gameover') && !evs.some((e) => e.type === 'die'));
}

/* ---------- 12. reset 与 drainEvents ---------- */
{
  const g = fresh();
  g.flap();
  g.state.bird.y = 380;
  const c = mkClock();
  g.tick(c.step());
  g.reset();
  const s = g.state;
  check('reset 恢复初始态', s.phase === 'ready' && s.score === 0 && s.pipes.length === 0
    && s.bird.y === 188 && s.bird.vel === 0 && s.events.length === 0);
  g.flap();
  check('reset 后可重新开局', g.state.phase === 'playing');
}

/* ---------- 13. overrides 调参 ---------- */
{
  const g = fresh({ overrides: { RULES: { gap: 200 }, SPEEDS: { scroll: 60 } } });
  check('overrides 覆盖常量', g.RULES.gap === 200 && g.SPEEDS.scroll === 60);
  check('未覆盖常量保留默认', g.RULES.pipeWidth === 52 && g.SPEEDS.gravity === 900);
}

/* ---------- 14. 完整可玩性:脚本化飞一段并得分 ---------- */
{
  const g = fresh({ rng: mulberry32(7) });
  const c = mkClock();
  g.flap();
  let gameOver = false;
  for (let i = 0; i < 60 * 30 && !gameOver; i++) {
    /* 朴素自动驾驶:鸟低于缺口中心就扇翅 */
    const s = g.state;
    const next = s.pipes.find((p) => p.x + RULES.pipeWidth > s.bird.x);
    if (s.phase === 'playing' && next && s.bird.y + 12 > next.gapY) g.flap();
    g.tick(c.step(16));
    if (s.phase === 'over') gameOver = true;
  }
  check('自动驾驶至少飞过 1 根管(可玩性冒烟)', g.state.score >= 1, `score=${g.state.score}`);
}

console.log(`\n========== flappy 引擎 ${pass}/${pass + fail} 项通过 ==========`);
process.exit(fail ? 1 : 0);
