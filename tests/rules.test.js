// 规则库校验：perft 对比公认标准值 + 若干规则点
import { Position, START_FEN, sqFromName } from '../site/js/xiangqi.js';

const t0 = Date.now();
const p = new Position(START_FEN);
const expected = { 1: 44, 2: 1920, 3: 79666, 4: 3290240 };
const maxDepth = Number(process.argv[2] || 3);
let ok = true;
for (let d = 1; d <= maxDepth; d++) {
  const s = Date.now();
  const n = p.perft(d);
  const pass = n === expected[d];
  ok &&= pass;
  console.log(`${pass ? '✓' : '✗'} perft(${d}) = ${n} (expect ${expected[d]}) ${Date.now() - s} ms`);
}

// 规则点
const check = (name, cond) => { console.log(`${cond ? '✓' : '✗'} ${name}`); ok &&= cond; };
const q = new Position(START_FEN);
check('开局不被将军', !q.inCheck());
check('中炮 h2e2 合法', q.isLegal(sqFromName('h2'), sqFromName('e2')));
check('记谱 炮二平五', q.notation(sqFromName('h2'), sqFromName('e2')) === '炮二平五');
check('记谱 马八进七', q.notation(sqFromName('b0'), sqFromName('c2')) === '马八进七');
q.moveUci('h2e2'); q.moveUci('h9g7');
check('黑方记谱 马８进７ -> 马8进7', q.history[1].notation === '马8进7');
const ele = new Position('4k4/9/9/9/9/2B6/9/9/9/4K4 w - - 0 1'); // 相在 c4（河沿）
check('相不能过河', !ele.isLegal(sqFromName('c4'), sqFromName('e6')) && ele.isLegal(sqFromName('c4'), sqFromName('e2')));
const eye = new Position('3k5/9/9/9/9/9/9/9/3P5/2B1K4 w - - 0 1'); // 相眼 d1 被塞
check('塞相眼', !eye.isLegal(sqFromName('c0'), sqFromName('e2')) && eye.isLegal(sqFromName('c0'), sqFromName('a2')));
check('王不见王：将帅照面不合法', !new Position('4k4/9/9/9/9/9/9/9/9/3K5 w - - 0 1').isLegal(sqFromName('d0'), sqFromName('e0')));
check('炮隔子吃子', new Position('4k4/9/4c4/9/4p4/9/9/9/9/4K4 b - - 0 1').isLegal(sqFromName('e7'), sqFromName('e0')));
const leg = new Position('3k5/9/9/9/9/9/9/9/3P5/3NK4 w - - 0 1'); // 马腿 d1 被塞
check('马蹩腿', !leg.isLegal(sqFromName('d0'), sqFromName('e2')) && !leg.isLegal(sqFromName('d0'), sqFromName('c2')) && leg.isLegal(sqFromName('d0'), sqFromName('b1')));
check('将军判定', new Position('4k4/9/9/9/9/9/9/9/9/4R4 b - - 0 1').inCheck());
check('长将判负', (() => { const g = new Position('3k5/9/9/9/9/9/9/9/9/R3K4 w - - 0 1');
  const seq = ['a0a9', 'd9d8', 'a9a8', 'd8d9', 'a8a9', 'd9d8', 'a9a8', 'd8d9', 'a8a9'];
  for (const m of seq) { if (g.gameOver()) break; g.moveUci(m); }
  const r = g.gameOver(); return r && r.reason === 'perpetual-check' && r.result === 'black'; })());
console.log(ok ? `ALL OK (${Date.now() - t0} ms)` : 'FAILED');
process.exit(ok ? 0 : 1);
