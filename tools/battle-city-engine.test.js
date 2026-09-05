/* ==========================================================
   坦克大战引擎单元测试 — node tools/battle-city-engine.test.js
   直接 require 引擎,白盒访问 state 构造确定性场景
   随机数用 () => 0 或脚本队列注入,保证完全可复现
   ========================================================== */
'use strict';

const { createBattleCity, expandQueue, snapTo8, SUB } = require('../games/battle-city/engine.js');
const { STAGES } = require('../games/battle-city/levels.js');

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}${ok || !detail ? '' : ' — ' + detail}`);
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function fresh(opts = {}) {
  return createBattleCity(Object.assign({ levels: { STAGES }, rng: () => 0 }, opts));
}

/* 固定步长时钟:16ms/帧 */
function mkClock() {
  let t = 0;
  return { step: (ms = 16) => { t += ms; return t; }, now: () => t };
}

/* 推进 ms(自动跨过 intro/stage-clear 幕布) */
function play(e, clk, ms) {
  const end = clk.now() + ms;
  while (clk.now() < end) e.tick(clk.step(16));
}

/* 清空全部地形(含基地),测试自行摆放 */
function wipe(e) {
  for (let y = 0; y < SUB; y++) e.state.terrain[y].fill(null);
}

const P = (e, i = 0) => e.state.players[i];

/* ---------- 1. 几何常量与出生点 ---------- */
{
  const e = fresh();
  const s = e.state;
  check('场地 26×26 子格', s.terrain.length === 26 && s.terrain.every((r) => r.length === 26));
  check('基地占子格 (12..13, 24..25) 为 F',
    [[12, 24], [13, 24], [12, 25], [13, 25]].every(([x, y]) => s.terrain[y][x] === 'F'));
  const wallCells = [];
  for (const [cx, cy] of [[5, 11], [6, 11], [7, 11], [5, 12], [7, 12]])
    for (let oy = 0; oy < 2; oy++) for (let ox = 0; ox < 2; ox++) wallCells.push([cx * 2 + ox, cy * 2 + oy]);
  check('护墙 5 大格共 20 子格均为 B', wallCells.every(([x, y]) => s.terrain[y][x] === 'B'));
  check('1P/2P 出生点 (64,192)/(128,192)',
    P(e).x === 64 && P(e).y === 192 && s.players[1] === undefined);
  check('生成队列 20 辆', s.spawnQueue.length === 20);
  check('生成队列轮转交错(18 basic + 2 fast → b,f,b,f,b,b…)',
    s.spawnQueue[0] === 'basic' && s.spawnQueue[1] === 'fast' && s.spawnQueue[2] === 'basic'
    && s.spawnQueue[3] === 'fast' && s.spawnQueue[4] === 'basic' && s.spawnQueue[19] === 'basic');
}

/* ---------- 2. 直线移动位移 = speed×dt ---------- */
{
  const e = fresh(); const clk = mkClock();
  play(e, clk, 1200); // 跨过 intro
  wipe(e);
  e.setInput(0, { dir: 'right', fire: false });
  const x0 = P(e).x;
  play(e, clk, 100);
  check('45px/s × ~100ms → +4.5px,不取整(16ms 步长粒度 ±0.72)', Math.abs((P(e).x - x0) - 4.5) < 0.72, `Δ=${P(e).x - x0}`);
}

/* ---------- 3-6. 转向 8px 吸附 ---------- */
{
  check('snapTo8 就近:x=10 → 8', snapTo8(10, 1) === 8 && snapTo8(14, 1) === 16);
  check('snapTo8 平局偏向原方向:12 右行 → 16,左行 → 8', snapTo8(12, 1) === 16 && snapTo8(12, -1) === 8);
}
{
  const e = fresh(); const clk = mkClock();
  play(e, clk, 1200); wipe(e);
  P(e).dir = 1; P(e).x = 10; P(e).y = 100; // 右行
  e.setInput(0, { dir: 'up', fire: false });
  play(e, clk, 16);
  check('转向吸附-就近:x=10 右行转上 → x=8', P(e).x === 8 && P(e).dir === 0);
}
{
  const e = fresh(); const clk = mkClock();
  play(e, clk, 1200); wipe(e);
  P(e).dir = 1; P(e).x = 12; P(e).y = 100;
  e.setInput(0, { dir: 'up', fire: false });
  play(e, clk, 16);
  check('转向吸附-平局偏向原方向:x=12 → 16', P(e).x === 16);
}
{
  const e = fresh(); const clk = mkClock();
  play(e, clk, 1200); wipe(e);
  P(e).dir = 0; P(e).x = 11; P(e).y = 100; // 上行
  e.setInput(0, { dir: 'down', fire: false });
  play(e, clk, 16);
  check('同轴反向(上→下)不吸附:x 不变、朝向反转', P(e).x === 11 && P(e).dir === 2);
}
{
  const e = fresh(); const clk = mkClock();
  play(e, clk, 1200); wipe(e);
  /* 大格 (1,6) 放砖:子格 x 16..31(平局吸附位 x=16 会撞上) */
  for (let sy = 12; sy <= 13; sy++) for (let sx = 2; sx <= 3; sx++) e.state.terrain[sy][sx] = 'B';
  P(e).dir = 1; P(e).x = 12; P(e).y = 100; // 平局会吸到 x=16 → 撞墙
  e.setInput(0, { dir: 'up', fire: false });
  play(e, clk, 16);
  check('吸附撞墙回退:仅改朝向,坐标不变且未入墙', P(e).x === 12 && P(e).dir === 0);
}

/* ---------- 7. 边界 ---------- */
{
  const e = fresh(); const clk = mkClock();
  play(e, clk, 1200); wipe(e);
  P(e).x = 0; P(e).dir = 3;
  e.setInput(0, { dir: 'left', fire: false });
  play(e, clk, 100);
  check('左边界阻挡:x=0 不动', P(e).x === 0 && !P(e).moving);
}

/* ---------- 8. 地形阻挡矩阵 ---------- */
{
  const e = fresh(); const clk = mkClock();
  play(e, clk, 1200); wipe(e);
  const codeBlocks = (code, x, y) => {
    for (let oy = 0; oy < 2; oy++) for (let ox = 0; ox < 2; ox++) e.state.terrain[y * 2 + oy][x * 2 + ox] = code;
  };
  const tryDown = () => {
    e.setInput(0, { dir: 'down', fire: false });
    play(e, clk, 60);
    e.setInput(0, { dir: null, fire: false });
  };
  P(e).x = 64; P(e).y = 0;
  codeBlocks('B', 4, 1); tryDown();
  check('砖阻挡坦克', P(e).y === 0);
  for (let y = 0; y < SUB; y++) e.state.terrain[y].fill(null);
  P(e).x = 64; P(e).y = 0;
  codeBlocks('S', 4, 1); tryDown();
  check('钢阻挡坦克', P(e).y === 0);
  for (let y = 0; y < SUB; y++) e.state.terrain[y].fill(null);
  P(e).x = 64; P(e).y = 0;
  codeBlocks('W', 4, 1); tryDown();
  check('河阻挡坦克', P(e).y === 0);
  for (let y = 0; y < SUB; y++) e.state.terrain[y].fill(null);
  P(e).x = 64; P(e).y = 0;
  codeBlocks('T', 4, 1); tryDown();
  check('树不阻挡坦克', P(e).y > 0);
  for (let y = 0; y < SUB; y++) e.state.terrain[y].fill(null);
  P(e).x = 64; P(e).y = 0;
  codeBlocks('I', 4, 1); tryDown();
  check('冰不阻挡坦克', P(e).y > 0);
}

/* ---------- 9-11. 砖/钢破坏粒度 ---------- */
{
  const e = fresh(); const clk = mkClock();
  play(e, clk, 1200); wipe(e);
  /* 砖块 2×2 大格:子格 x 8..11, y 8..11 */
  for (let sy = 8; sy <= 11; sy++) for (let sx = 8; sx <= 11; sx++) e.state.terrain[sy][sx] = 'B';
  P(e).x = 64; P(e).y = 112; P(e).dir = 0; // 中心 (72,120),弹带 [72,80) → 子格列 9
  e.setInput(0, { dir: null, fire: true });
  play(e, clk, 400);
  e.setInput(0, { dir: null, fire: false });
  const chewed = [10, 11].every((sy) => e.subAt(9, sy) === null);
  const intact = [8, 9, 10, 11].every((sy) => [8, 10, 11].every((sx) => e.subAt(sx, sy) === 'B'))
    && e.subAt(9, 8) === 'B' && e.subAt(9, 9) === 'B';
  check('普通弹咬砖:命中列咬掉 16×8 带(子格 (9,10)(9,11)),其余完整', chewed && intact,
    JSON.stringify(e.state.terrain.slice(8, 12).map((r) => r.slice(8, 12).join(''))));
}
{
  const e = fresh(); const clk = mkClock();
  play(e, clk, 1200); wipe(e);
  for (let sy = 8; sy <= 11; sy++) for (let sx = 8; sx <= 11; sx++) e.state.terrain[sy][sx] = 'B';
  P(e).x = 64; P(e).y = 112; P(e).dir = 0; P(e).power = 4;
  e.setInput(0, { dir: null, fire: true });
  play(e, clk, 400);
  const bottomHalf = [10, 11].every((sy) => [8, 9].every((sx) => e.subAt(sx, sy) === null));
  const topHalf = [8, 9].every((sy) => [8, 9, 10, 11].every((sx) => e.subAt(sx, sy) === 'B'));
  check('满级(power=4)弹一次咬 16×16 整格(两排砖)', bottomHalf && topHalf);
}
{
  const e = fresh(); const clk = mkClock();
  play(e, clk, 1200); wipe(e);
  for (let oy = 0; oy < 2; oy++) for (let ox = 0; ox < 2; ox++) e.state.terrain[10 + oy][8 + ox] = 'S';
  P(e).x = 64; P(e).y = 112; P(e).dir = 0;
  e.setInput(0, { dir: null, fire: true });
  play(e, clk, 400);
  check('低火力弹打钢:无效但弹消失',
    e.subAt(8, 10) === 'S' && e.subAt(9, 11) === 'S' && e.state.bullets.length === 0);
  e.setInput(0, { dir: null, fire: false }); play(e, clk, 16); // 复位上升沿
  P(e).power = 4;
  e.setInput(0, { dir: null, fire: true });
  play(e, clk, 400);
  e.setInput(0, { dir: null, fire: false });
  check('满级弹打钢:首发裂(HP 2→1)仍为 S',
    e.subAt(8, 10) === 'S' && e.subAt(9, 11) === 'S');
  e.setInput(0, { dir: null, fire: false }); play(e, clk, 16); // 复位上升沿
  e.setInput(0, { dir: null, fire: true });
  play(e, clk, 400);
  check('满级弹打钢:第二发碎(steelHp=2;满级横向咬痕 16px,列 8、9 两发后同碎)',
    [8, 9].every((sx) => [10, 11].every((sy) => e.subAt(sx, sy) === null)));
}

/* ---------- 12. 河上子弹穿过 ---------- */
{
  const e = fresh(); const clk = mkClock();
  play(e, clk, 1200); wipe(e);
  for (let oy = 0; oy < 2; oy++) for (let ox = 0; ox < 2; ox++) e.state.terrain[10 + oy][8 + ox] = 'W';
  P(e).x = 64; P(e).y = 112; P(e).dir = 0;
  e.setInput(0, { dir: null, fire: true });
  play(e, clk, 400);
  check('子弹穿过河(不消失、河保留)', e.subAt(8, 10) === 'W' && e.state.bullets.length === 1);
}

/* ---------- 13-14. 弹量上限与弹速分档 ---------- */
{
  const e = fresh(); const clk = mkClock();
  play(e, clk, 1200); wipe(e);
  P(e).power = 1;
  e.setInput(0, { dir: null, fire: true }); play(e, clk, 16);
  e.setInput(0, { dir: null, fire: false }); play(e, clk, 16);
  e.setInput(0, { dir: null, fire: true }); play(e, clk, 16);
  check('power=1 弹量上限 1(第二发被拒)', e.state.bullets.length === 1);
  check('power=1 弹速 120', e.state.bullets[0].speed === 120);
}
{
  const e = fresh(); const clk = mkClock();
  play(e, clk, 1200); wipe(e);
  P(e).power = 3;
  e.setInput(0, { dir: null, fire: true }); play(e, clk, 16);
  e.setInput(0, { dir: null, fire: false }); play(e, clk, 16);
  e.setInput(0, { dir: null, fire: true }); play(e, clk, 16);
  e.setInput(0, { dir: null, fire: false }); play(e, clk, 16);
  e.setInput(0, { dir: null, fire: true }); play(e, clk, 16);
  check('power=3 同屏 2 弹(第三发被拒)', e.state.bullets.length === 2);
  check('power≥2 弹速 240', e.state.bullets.every((b) => b.speed === 240));
}

/* ---------- 15. 子弹互消 ---------- */
{
  const e = fresh(); const clk = mkClock();
  play(e, clk, 1200); wipe(e);
  e.state.bullets.push(
    { owner: 'p0', from: 'player', power: 1, dir: 2, x: 100, y: 100, speed: 120, dead: false },
    { owner: 'e1', from: 'enemy', power: 1, dir: 0, x: 100, y: 103, speed: 120, dead: false },
  );
  play(e, clk, 32);
  const ev = e.drainEvents().some((v) => v.type === 'bullet-cancel');
  check('任意两弹重叠 → 双双消失并 bullet-cancel', e.state.bullets.length === 0 && ev);
}

/* ---------- 16. 子步推进防穿透 ---------- */
{
  const e = fresh(); const clk = mkClock();
  play(e, clk, 1200); wipe(e);
  e.state.terrain[2][9] = 'B'; // 单个 8px 砖子格 (9,2)
  e.state.bullets.push(
    { owner: 'p0', from: 'player', power: 1, dir: 0, x: 70, y: 32, speed: 400, dead: false });
  /* dt=50ms × 400px/s = 20px 位移,> 8px 子格;无子步会穿透 */
  e.tick(clk.step(50));
  check('子步推进:单帧 20px 仍命中 8px 砖格',
    e.subAt(9, 2) === null && e.state.bullets.length === 0);
}

/* ---------- 17. 敌弹杀玩家 / 护盾免疫 ---------- */
{
  const e = fresh(); const clk = mkClock();
  play(e, clk, 1200); wipe(e);
  const p = P(e);
  p.shieldMs = 0; // 清掉出生护盾
  e.state.bullets.push(
    { owner: 'e1', from: 'enemy', power: 1, dir: 0, x: p.x + 6, y: p.y + 6, speed: 120, dead: false });
  play(e, clk, 32);
  check('敌弹命中 → 命-1、power 归 1、进入重生',
    p.lives === 2 && p.power === 1 && p.pendingSpawn && p.respawnMs > 0);
  check('玩家死亡事件', e.drainEvents().some((v) => v.type === 'player-dead'));
}
{
  const e = fresh(); const clk = mkClock();
  play(e, clk, 1200); wipe(e);
  const p = P(e);
  p.shieldMs = 5000;
  e.state.bullets.push(
    { owner: 'e1', from: 'enemy', power: 1, dir: 0, x: p.x + 6, y: p.y + 6, speed: 120, dead: false });
  play(e, clk, 32);
  check('护盾免疫敌弹', p.lives === 3 && !p.pendingSpawn);
}

/* ---------- 18-20. 刷新节奏 ---------- */
{
  const q = expandQueue([18, 2, 0, 0]);
  check('expandQueue 长度 20', q.length === 20);
  const q2 = expandQueue([2, 2, 2, 2]);
  check('expandQueue [2,2,2,2] → b,f,p,a 轮转 ×2',
    q2.join(',') === 'basic,fast,power,armor,basic,fast,power,armor');
  const q3 = expandQueue([5, 0, 0, 0]);
  check('expandQueue [5,0,0,0] → 全 basic', q3.every((t) => t === 'basic'));
}
{
  /* 用非退化 rng(rng=0 会让敌人永远朝上堵死全部出生点) */
  let seed = 42;
  const lcg = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const e = fresh({ rng: lcg }); const clk = mkClock();
  play(e, clk, 1200);
  play(e, clk, 17000);
  check('同屏上限 4(17s 内只刷 4 辆)', e.state.enemies.length === 4 && e.state.spawnedCount === 4,
    `场上 ${e.state.enemies.length} 已刷 ${e.state.spawnedCount}`);
}
{
  const e = fresh(); const clk = mkClock();
  play(e, clk, 1200);
  const spawned = [];
  while (e.state.spawnedCount < 20) {
    const before = e.state.spawnedCount;
    e.tick(clk.step(50));
    if (e.state.spawnedCount > before) {
      const en = e.state.enemies[e.state.enemies.length - 1];
      spawned.push({ type: en.type, bonus: en.bonus });
      e.state.enemies.length = 0; // 白盒清场,加速刷完 20 辆
    }
    if (clk.now() > 200000) break;
  }
  check('20 辆全部刷出', spawned.length === 20);
  check('第 4/11/18 辆为 bonus 道具坦克',
    [3, 10, 17].every((i) => spawned[i] && spawned[i].bonus)
    && spawned.every((t, i) => [3, 10, 17].includes(i) ? t.bonus : !t.bonus),
    JSON.stringify(spawned.map((t) => t.bonus ? 1 : 0)));
}

/* ---------- 21. 击杀 bonus 坦克掉道具 ---------- */
{
  const e = fresh(); const clk = mkClock();
  play(e, clk, 1200); wipe(e);
  play(e, clk, 3200); // 刷出第一辆
  const en = e.state.enemies[0];
  en.bonus = true; en.hp = 1; en.spawnMs = 0; en.x = 64; en.y = 64; en.dir = 2;
  P(e).x = 64; P(e).y = 96; P(e).dir = 0; // 正对敌坦
  e.setInput(0, { dir: null, fire: true });
  play(e, clk, 400);
  const pu = e.state.powerup;
  check('击杀 bonus 坦克 → 掉道具', pu !== null && e.drainEvents().some((v) => v.type === 'powerup-spawn'));
  check('道具落在场内且不在基地区', pu !== null
    && pu.x >= 0 && pu.y >= 0 && pu.x + 16 <= 208 && pu.y + 16 <= 208
    && !(pu.y >= 176 && pu.x >= 64 && pu.x < 128));
}

/* ---------- 22. 道具效果 ---------- */
{
  /* helmet */
  const e = fresh(); const clk = mkClock();
  play(e, clk, 1200); wipe(e);
  const p = P(e);
  e.state.powerup = { type: 'helmet', x: p.x, y: p.y };
  play(e, clk, 32);
  check('头盔 → 护盾 10s', p.shieldMs > 9900 && p.shieldMs <= 10000);
  check('拾取道具 +500 分', p.score === 500);
  /* clock */
  e.state.powerup = { type: 'clock', x: p.x, y: p.y };
  play(e, clk, 32);
  play(e, clk, 3200); // 刷一辆敌坦
  const en = e.state.enemies[0];
  if (en) { en.spawnMs = 0; en.x = 32; en.y = 32; }
  const ex = en ? en.x : -1;
  play(e, clk, 500);
  check('时钟 → 冻结 8s,敌人静止', e.state.freezeMs > 0 && (en ? en.x === ex : false));
  /* star / tank */
  e.state.powerup = { type: 'star', x: p.x, y: p.y };
  play(e, clk, 32);
  e.state.powerup = { type: 'tank', x: p.x, y: p.y };
  play(e, clk, 32);
  check('星星 → power+1;坦克 → +1 命', p.power === 2 && p.lives === 4);
  /* grenade:不清生成中的敌人、不计分 */
  e.state.enemies.push({ id: 99, type: 'basic', bonus: false, x: 0, y: 0, dir: 2, moving: false, hp: 1, spawnMs: 500, aiDecideMs: 0, fireMs: 0 });
  e.state.enemies.push({ id: 98, type: 'basic', bonus: false, x: 32, y: 32, dir: 2, moving: false, hp: 1, spawnMs: 0, aiDecideMs: 0, fireMs: 0 });
  const scoreBefore = p.score;
  e.state.powerup = { type: 'grenade', x: p.x, y: p.y };
  play(e, clk, 32);
  check('手雷 → 清场上敌人(生成中的除外);被炸敌坦不计分,拾取本身 +500',
    e.state.enemies.length === 1 && e.state.enemies[0].spawnMs > 0 && p.score === scoreBefore + 500);
  /* shovel:钢墙到期还原完整砖 */
  e.state.terrain[22][10] = null; e.state.terrain[23][12] = null; // 先咬掉护墙两格
  e.state.powerup = { type: 'shovel', x: p.x, y: p.y };
  play(e, clk, 32);
  const wallAllSteel = [[5, 11], [6, 11], [7, 11], [5, 12], [7, 12]].every(([cx, cy]) =>
    [0, 1].every((oy) => [0, 1].every((ox) => e.subAt(cx * 2 + ox, cy * 2 + oy) === 'S')));
  check('铁锹 → 护墙全变钢(含修复被咬处)', wallAllSteel && e.state.shovelMs > 0);
  play(e, clk, 16000);
  const wallAllBrick = [[5, 11], [6, 11], [7, 11], [5, 12], [7, 12]].every(([cx, cy]) =>
    [0, 1].every((oy) => [0, 1].every((ox) => e.subAt(cx * 2 + ox, cy * 2 + oy) === 'B')));
  check('铁锹 15s 后还原为完整砖', wallAllBrick);
}

/* ---------- 23. 计分与 20000 加命 ---------- */
{
  const e = fresh(); const clk = mkClock();
  play(e, clk, 1200); wipe(e);
  const p = P(e);
  /* 直接调白盒:击杀各型敌坦加分 */
  e.state.enemies.push({ id: 1, type: 'armor', bonus: false, x: 64, y: 64, dir: 2, moving: false, hp: 1, spawnMs: 0, aiDecideMs: 0, fireMs: 0 });
  P(e).x = 64; P(e).y = 96; P(e).dir = 0;
  e.setInput(0, { dir: null, fire: true });
  play(e, clk, 300);
  check('击杀 armor +400', p.score === 400);
  /* 20000 分加命:19900 + 击杀 basic 100 → 触发 */
  p.score = 19900;
  e.state.enemies.push({ id: 2, type: 'basic', bonus: false, x: 64, y: 64, dir: 2, moving: false, hp: 1, spawnMs: 0, aiDecideMs: 0, fireMs: 0 });
  e.setInput(0, { dir: null, fire: false }); play(e, clk, 16);
  e.setInput(0, { dir: null, fire: true });
  play(e, clk, 300);
  check('跨过 20000 分 → extra-life 事件并 +1 命',
    p.score === 20000 && p.lives === 4 && e.drainEvents().some((v) => v.type === 'extra-life'));
}

/* ---------- 24. 结束条件与过关 ---------- */
{
  const e = fresh(); const clk = mkClock();
  play(e, clk, 1200);
  /* 玩家自己的子弹打基地 → game over(base 上方护墙白盒清开) */
  e.state.terrain[23][12] = null; e.state.terrain[23][13] = null;
  e.state.bullets.push(
    { owner: 'p0', from: 'player', power: 1, dir: 2, x: 102, y: 186, speed: 120, dead: false });
  play(e, clk, 32);
  check('玩家子弹毁基地 → game over(reason=base)',
    e.state.over && e.state.overReason === 'base');
}
{
  const e = fresh(); const clk = mkClock();
  play(e, clk, 1200); wipe(e);
  const p = P(e);
  p.score = 5000; p.power = 3; p.lives = 2;
  e.state.spawnedCount = e.state.spawnQueue.length; // 队列耗尽
  e.state.enemies.length = 0;
  play(e, clk, 100);
  check('敌军清空 → stage-clear', e.state.phase === 'stage-clear');
  play(e, clk, 2500); // 幕布 2s
  check('过关进入下一关并保留 分数/火力/生命',
    e.state.stage === 2 && e.state.phase === 'intro'
    && P(e).score === 5000 && P(e).power === 3 && P(e).lives === 2);
}
{
  const e = fresh({ players: 2 }); const clk = mkClock();
  play(e, clk, 1200); wipe(e);
  check('双人模式:2P 出生 (128,192) 绿方独立命', P(e, 1).x === 128 && P(e, 1).y === 192 && P(e, 1).lives === 3);
  /* 玩家弹打队友 → 冻结而非死亡 */
  P(e, 1).x = 64; P(e, 1).y = 160; P(e, 1).dir = 0;
  P(e).x = 64; P(e).y = 192; P(e).dir = 0;
  e.setInput(0, { dir: null, fire: true });
  play(e, clk, 400);
  check('友伤 → 队友冻结 1.5s、不死', P(e, 1).frozenMs > 0 && P(e, 1).lives === 3);
  /* 双玩家皆亡 → game over */
  P(e).dead = true; P(e, 1).dead = true;
  play(e, clk, 32);
  check('双人皆亡 → game over(reason=lives)', e.state.over && e.state.overReason === 'lives');
}

/* ---------- 25. levels.js 数据格式守卫 ---------- */
{
  const okMaps = STAGES.length === 35
    && STAGES.every((st) => st.map.length === 13 && st.map.every((r) => r.length === 13));
  check('35 关 × 13 行 × 13 列', okMaps, `共 ${STAGES.length} 关`);
  const legal = STAGES.every((st) => st.map.every((r) => [...r].every((c) => '.BSWTI'.includes(c))));
  check('字符集合法(仅 . B S W T I)', legal);
  const sums = STAGES.every((st) => st.enemies.reduce((a, b) => a + b, 0) === 20 && st.enemies.length === 4);
  check('每关敌型构成合计 20', sums);
  /* 出生点/基地区必须留空:敌刷新 (0,0)(6,0)(12,0),玩家 (4,12)(8,12),基地区 rows11-12 cols5-7 */
  const clearCells = (st) => {
    for (const [cx, cy] of [[0, 0], [6, 0], [12, 0], [4, 12], [8, 12], [6, 12]])
      if (st.map[cy][cx] !== '.') return false;
    for (const cx of [5, 6, 7]) {
      if (st.map[11][cx] !== '.') return false;
      if (st.map[12][cx] !== '.') return false;
    }
    return true;
  };
  check('出生点与基地区在地图中留空(由代码放置)', STAGES.every(clearCells));
}

/* ---------- 26. AI 确定性(同 rng 序列两次运行结果一致) ---------- */
{
  const run = () => {
    const seq = [];
    let i = 0;
    const e = fresh({ rng: () => { i += 1; return (i * 7919 % 1000) / 1000; } });
    const clk = mkClock();
    play(e, clk, 6000);
    e.state.enemies.forEach((en) => seq.push(Math.round(en.x), Math.round(en.y), en.dir));
    return seq.join(',');
  };
  check('同 rng 序列两次运行状态完全一致(确定性)', run() === run());
}

console.log(`\n========== ${pass}/${pass + fail} 项通过 ==========`);
process.exit(fail ? 1 : 0);
