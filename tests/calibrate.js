// 难度标定：让两个级别用同一个 wasm 引擎互弈，统计胜负（与网页使用完全相同的选着逻辑）。
//   node tests/calibrate.js <nnue 路径> <级别A> <级别B> [局数=10]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Position, sqName } from '../site/js/xiangqi.js';
import { levelConfig, parseInfoLine, selectMove, collectCandidates } from '../site/js/levels.js';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [nnuePath, la, lb, games = '10'] = process.argv.slice(2);
if (!nnuePath || !la || !lb) { console.error('usage: node tests/calibrate.js <pikafish.nnue> <levelA> <levelB> [games]'); process.exit(2); }

const Pikafish = require(path.join(root, 'pikafish-web/dist/pikafish.js'));
const lines = []; let waiters = [];
const listen = (line) => { lines.push(line); waiters = waiters.filter((w) => !w(line)); };
const waitFor = (pred, ms = 120000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout')), ms);
  waiters.push((l) => { if (pred(l)) { clearTimeout(t); res(l); return true; } return false; });
});
const engine = await Pikafish({ listen, onError: (m) => console.error('! ' + m), wasmBinary: fs.readFileSync(path.join(root, 'pikafish-web/dist/pikafish.wasm')) });
const send = (cmd, pred) => { const p = pred ? waitFor(pred) : null; engine.uci(cmd); return p; };
await send('uci', (l) => l === 'uciok');
const buf = fs.readFileSync(nnuePath);
engine.setNnueBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
await send('isready', (l) => l === 'readyok');

async function pick(pos, level) {
  const cfg = levelConfig(level);
  await send(`setoption name MultiPV value ${cfg.multipv}`);
  engine.uci(`position startpos${pos.history.length ? ' moves ' + pos.uciMoves().join(' ') : ''}`);
  const infos = new Map();
  const start = lines.length;
  const bm = await send(`go nodes ${cfg.nodes}`, (l) => l.startsWith('bestmove'));
  for (const l of lines.slice(start)) { const i = parseInfoLine(l); if (i) infos.set(i.multipv, i); }
  lines.length = 0;
  const engineBest = bm.split(' ')[1];
  if (!engineBest || engineBest === '(none)') return null;
  const legal = pos.legalMoves().map(([a, b]) => sqName(a) + sqName(b));
  const { chosen } = selectMove({ candidates: collectCandidates(infos, engineBest), cfg, engineBest, legalMoves: legal });
  return chosen.move;
}

async function play(redLevel, blackLevel, maxPlies = 300) {
  const pos = new Position();
  await send('ucinewgame'); await send('isready', (l) => l === 'readyok');
  for (let ply = 0; ply < maxPlies; ply++) {
    const over = pos.gameOver();
    if (over) return over;
    const mv = await pick(pos, pos.turn === 'w' ? redLevel : blackLevel);
    if (!mv) return { result: pos.turn === 'w' ? 'black' : 'red', reason: 'no-move' };
    pos.moveUci(mv);
  }
  return { result: 'draw', reason: 'max-plies' };
}

const A = Number(la), B = Number(lb), N = Number(games);
let aWins = 0, bWins = 0, draws = 0;
const t0 = Date.now();
for (let g = 0; g < N; g++) {
  const aIsRed = g % 2 === 0;
  const r = await play(aIsRed ? A : B, aIsRed ? B : A);
  const aWon = (r.result === 'red') === aIsRed && r.result !== 'draw';
  if (r.result === 'draw') draws++; else if (aWon) aWins++; else bWins++;
  console.log(`game ${g + 1}: A=${A}${aIsRed ? '(红)' : '(黑)'} vs B=${B} -> ${r.result} (${r.reason})`);
}
const score = (aWins + draws / 2) / N;
const elo = score <= 0 ? -Infinity : score >= 1 ? Infinity : Math.round(-400 * Math.log10(1 / score - 1));
console.log(`\nL${A} vs L${B}: +${aWins} =${draws} -${bWins}  得分率 ${(score * 100).toFixed(0)}%  ≈ Elo 差 ${elo}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
engine.uci('quit');
setTimeout(() => process.exit(0), 500);
