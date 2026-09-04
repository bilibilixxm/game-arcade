/* ==========================================================
   俄罗斯方块引擎单元测试 — node tools/tetris-engine.test.js
   直接 require 引擎,白盒访问 state 构造确定性场景
   ========================================================== */
'use strict';

const { createTetris, TYPES } = require('../games/tetris/engine.js');

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}${ok || !detail ? '' : ' — ' + detail}`);
};

function fresh() {
  return createTetris({ rows: 20, cols: 10 });
}

/* ---------- 1. 初始状态 ---------- */
{
  const e = fresh();
  const s = e.state;
  check('初始棋盘 20×10 全空', s.board.length === 20 && s.board.every((r) => r.length === 10 && r.every((c) => c === null)));
  check('初始 next 队列 5 个', s.next.length === 5 && s.next.every((t) => TYPES.includes(t)));
  check('初始当前方块有效', TYPES.includes(s.current.type) && !s.over && s.score === 0 && s.lines === 0 && s.level === 1);
  check('生成位置正确', s.current.y === 0 && (s.current.type === 'O' ? s.current.x === 4 : s.current.x === 3));
}

/* ---------- 2. 7-bag 分布 ---------- */
{
  const e = fresh(); // reset 已消耗首个 bag 的前 6 个,先抽 1 个补齐对齐
  const draws = [];
  for (let i = 0; i < 29; i++) draws.push(e._takeNext());
  const aligned = draws.slice(1);
  let ok = true;
  for (let k = 0; k < 4; k++) {
    const window = aligned.slice(k * 7, k * 7 + 7).sort();
    if (window.join(',') !== TYPES.slice().sort().join(',')) ok = false;
  }
  check('7-bag:每 7 个连续抽取恰好包含 7 种方块各一次', ok);
}

/* ---------- 3. 移动与边界 ---------- */
{
  const e = fresh();
  for (let i = 0; i < 20; i++) e.moveRight();
  const cells = e.pieceCells();
  check('右移不越界且贴墙', cells.every(([x]) => x >= 0 && x < 10) && cells.some(([x]) => x === 9));
  for (let i = 0; i < 20; i++) e.moveLeft();
  const cells2 = e.pieceCells();
  check('左移不越界且贴墙', cells2.every(([x]) => x >= 0 && x < 10) && cells2.some(([x]) => x === 0));
}

/* ---------- 4. 旋转与 SRS 踢墙 ---------- */
{
  const e = fresh();
  e.state.current = { type: 'T', x: 3, y: 0, rot: 0 }; // 固定 T,避开随机的 O
  check('空场旋转成功', e.rotate(1) === true && e.state.current.rot === 1);
  check('O 旋转视为无效', (() => {
    const e2 = fresh();
    e2.state.current = { type: 'O', x: 4, y: 0, rot: 0 };
    return e2.rotate(1) === false;
  })());
}
{
  // 经典 I 型踢墙:竖直 I 贴左壁(row2/col3 有障碍),1→2 旋转必须用到 (2,-1) 踢
  const e = fresh();
  e.state.current = { type: 'I', x: 0, y: 0, rot: 1 };
  e.state.board[2][3] = 'J';
  const ok = e.rotate(1);
  const c = e.state.current;
  check('SRS 踢墙:I 型 1→2 经 (2,-1) 成功', ok === true && c.rot === 2 && c.x === 2 && c.y === 1, JSON.stringify(c));
}
{
  // JLSTZ 落地旋转:T 平放底部(rot0 落地),0→1 旋转经 (0,0) 即成功
  const e = fresh();
  e.state.current = { type: 'T', x: 3, y: 17, rot: 0 };
  check('SRS:T 落地旋转成功', e.rotate(1) === true && e.state.current.rot === 1);
}

/* ---------- 5. 幽灵投影 ---------- */
{
  const e = fresh();
  check('空场 ghostY = 18(贴底)', e.ghostY() === 18, '实际 ' + e.ghostY());
  const e2 = fresh();
  for (let x = 0; x < 10; x++) e2.state.board[19][x] = 'J';
  check('底部一行被占时 ghostY = 17', e2.ghostY() === 17, '实际 ' + e2.ghostY());
}

/* ---------- 6. 软降 / 硬降计分 ---------- */
{
  const e = fresh();
  const y0 = e.state.current.y;
  check('软降下移一格 +1 分', e.softDrop() === true && e.state.current.y === y0 + 1 && e.state.score === 1);
}
{
  const e = fresh();
  const dist = e.hardDrop();
  check('硬降落底 +2/格(空场 18 格 = 36 分)', dist === 18 && e.state.score === 36, `dist=${dist} score=${e.state.score}`);
  check('硬降后立即锁定并生成新块', TYPES.includes(e.state.current.type) && e.state.next.length === 5);
}

/* ---------- 7. 消行与计分 ---------- */
{
  // 1 行:底部填满,硬降锁定后消 1 行
  const e = fresh();
  for (let x = 0; x < 10; x++) e.state.board[19][x] = 'J';
  const before = e.state.score;
  e.hardDrop(); // dist=17 → +34,消 1 行 → +100
  check('消 1 行 = 100×1', e.state.lines === 1 && e.state.score === before + 34 + 100, `score=${e.state.score}`);
  // 消行后场上应只剩锁定方块的 4 个格子(预填充的 10 格随行被消)
  const filled = e.state.board.flat().filter(Boolean).length;
  check('消行后预填充行已被移除', filled === 4, `filled=${filled}`);
}
{
  // 4 行:rows 16-19 填满,硬降(dist=14 → +28)+ 消 4 行 800
  const e = fresh();
  for (let y = 16; y < 20; y++) for (let x = 0; x < 10; x++) e.state.board[y][x] = 'J';
  e.hardDrop();
  check('消 4 行 = 800×1(Tetris)', e.state.lines === 4 && e.state.score === 28 + 800, `score=${e.state.score}`);
}
{
  // 升级:lines=9 时再消 1 行 → level 2;计分用消行前的等级
  const e = fresh();
  e.state.lines = 9;
  for (let x = 0; x < 10; x++) e.state.board[19][x] = 'J';
  e.hardDrop();
  check('每 10 行升级', e.state.lines === 10 && e.state.level === 2);
  check('消行计分按消行前等级(100×1)', e.state.score === 34 + 100, `score=${e.state.score}`);
}

/* ---------- 8. Hold 一次限制 ---------- */
{
  const e = fresh();
  const first = e.state.current.type;
  check('首次 Hold 成功并交换', e.hold() === true && e.state.hold === first && e.state.canHold === false);
  check('未锁定前二次 Hold 被拒', e.hold() === false);
  e.hardDrop();
  check('锁定后 Hold 次数恢复', e.state.canHold === true);
}

/* ---------- 9. 重力与 tick ---------- */
{
  const e = fresh();
  const y0 = e.state.current.y;
  e.tick(1);
  e.tick(800); // 距 lastDrop(1) 仅 799ms,不到 800
  check('重力:间隔不足不下落', e.state.current.y === y0);
  e.tick(801);
  check('重力:到时下落一格', e.state.current.y === y0 + 1);
}
{
  // 锁定延迟:落地后 500ms 内不锁,超过即锁
  const e = fresh();
  for (let y = 16; y < 20; y++) for (let x = 0; x < 10; x++) e.state.board[y][x] = 'J';
  while (e.softDrop()); // 软降到堆顶(不锁定)
  const cur = e.state.current;
  e.tick(1000); // 首次 tick,记录落地
  check('落地后立即 tick 不锁定', e.state.current === cur);
  e.tick(1400);
  check('落地 400ms 仍不锁定', e.state.current === cur);
  e.tick(1501);
  check('落地 500ms 后锁定并换块', e.state.current !== cur);
}

/* ---------- 10. 暂停 ---------- */
{
  const e = fresh();
  e.state.paused = true;
  const y0 = e.state.current.y;
  const x0 = e.state.current.x;
  check('暂停时操作无效', e.moveLeft() === false && e.softDrop() === false && e.rotate(1) === false && e.hold() === false);
  e.tick(99999);
  check('暂停时不因重力下落', e.state.current.y === y0 && e.state.current.x === x0);
}

/* ---------- 11. 游戏结束(出生点被占) ---------- */
{
  const e = fresh();
  for (let x = 0; x < 10; x++) {
    e.state.board[0][x] = 'J';
    e.state.board[1][x] = 'J';
  }
  e.hold(); // 触发重新出生 → 出生点碰撞 → over
  check('出生点被占判定游戏结束', e.state.over === true);
}

/* ---------- 12. reset ---------- */
{
  const e = fresh();
  e.hardDrop();
  e.hold();
  e.reset();
  const s = e.state;
  check('reset 恢复初始状态', s.score === 0 && s.lines === 0 && s.level === 1 && !s.over && s.hold === null && s.next.length === 5 && s.board.every((r) => r.every((c) => c === null)));
}

console.log(`\n========== ${pass}/${pass + fail} 项通过 ==========`);
process.exit(fail ? 1 : 0);
