// 实测各难度级别在真实局面上的搜索量：到达深度、节点数、耗时、哪个限制先到。
//   node tests/measure-levels.js <pikafish.nnue> [局面数=24]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Position } from '../site/js/xiangqi.js';
import { LEVELS, parseInfoLine, selectMove, collectCandidates } from '../site/js/levels.js';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [nnuePath, nposArg = '24'] = process.argv.slice(2);
const NPOS = Number(nposArg);

const Pikafish = require(path.join(root, 'pikafish-web/dist/pikafish.js'));
const lines = []; let waiters = [];
const listen = (l) => { lines.push(l); waiters = waiters.filter((w) => !w(l)); };
const waitFor = (pred) => new Promise((res) => waiters.push((l) => pred(l) ? (res(l), true) : false));
const engine = await Pikafish({ listen, onError: (m) => console.error('! ' + m), wasmBinary: fs.readFileSync(path.join(root, 'pikafish-web/dist/pikafish.wasm')) });
const send = (cmd, pred) => { const p = pred ? waitFor(pred) : null; engine.uci(cmd); return p; };
await send('uci', (l) => l === 'uciok');
const buf = fs.readFileSync(nnuePath);
engine.setNnueBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
await send('isready', (l) => l === 'readyok');

async function search(pos, limits, multipv = 1) {
  await send(`setoption name MultiPV value ${multipv}`);
  engine.uci(`position startpos${pos.history.length ? ' moves ' + pos.uciMoves().join(' ') : ''}`);
  const start = lines.length;
  const go = 'go ' + Object.entries(limits).map(([k, v]) => `${k} ${v}`).join(' ');
  const t0 = performance.now();
  const bm = await send(go, (l) => l.startsWith('bestmove'));
  const elapsed = performance.now() - t0;
  const infos = new Map();
  let last = null;
  for (const l of lines.slice(start)) { const i = parseInfoLine(l); if (i) { infos.set(i.multipv, i); if (i.multipv === 1) last = { ...i, nodes: Number((/nodes (\d+)/.exec(l) || [])[1] || 0), time: Number((/time (\d+)/.exec(l) || [])[1] || 0) }; } }
  lines.length = 0;
  return { bestmove: bm.split(' ')[1], last, elapsed, infos };
}

// 1) 用 6 层搜索自对弈，生成一组覆盖开局/中局/残局的真实局面
const positions = [];
const sampleEvery = 8;
while (positions.length < NPOS) {
  const pos = new Position();
  await send('ucinewgame'); await send('isready', (l) => l === 'readyok');
  for (let ply = 0; ply < 160 && positions.length < NPOS; ply++) {
    if (pos.gameOver()) break;
    if (ply > 0 && ply % sampleEvery === 0) positions.push({ fen: pos.fen(), moves: pos.uciMoves(), ply });
    const r = await search(pos, { depth: 6 }, 3);
    const { chosen } = selectMove({ candidates: collectCandidates(r.infos, r.bestmove), cfg: { noiseCp: 40 } });
    pos.moveUci(chosen.move);
  }
}
console.log(`采样 ${positions.length} 个局面（第 ${positions[0].ply}–${positions[positions.length - 1].ply} 半回合）\n`);

// 2) 每级在每个局面上实测
const nps = [];
console.log('级别 | 设定(层/毫秒) | 实际到达深度(均值/最小/最大) | 节点数(中位) | 耗时 ms(中位/最大) | 被哪个限制截停');
console.log('---|---|---|---|---|---');
for (const cfg of LEVELS.slice(1)) {
  const depths = [], nodes = [], times = []; let byDepth = 0, byTime = 0;
  for (const p of positions) {
    const pos = new Position(); for (const m of p.moves) pos.moveUci(m);
    const r = await search(pos, cfg.limits, cfg.multipv);
    const d = r.last ? r.last.depth : 0;
    depths.push(d); nodes.push(r.last ? r.last.nodes : 0); times.push(r.elapsed);
    if (d >= cfg.limits.depth) byDepth++; else byTime++;
    if (r.last && r.last.time > 50) nps.push(r.last.nodes / r.last.time * 1000);
  }
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(`L${cfg.level} ${cfg.name} | ${cfg.limits.depth} / ${cfg.limits.movetime} | ${avg(depths).toFixed(1)} / ${Math.min(...depths)} / ${Math.max(...depths)} | ${med(nodes)} | ${med(times).toFixed(0)} / ${Math.max(...times).toFixed(0)} | 层数 ${byDepth} 次，时间 ${byTime} 次`);
}
if (nps.length) console.log(`\n本机单线程速度约 ${Math.round(nps.reduce((a, b) => a + b, 0) / nps.length / 1000)}k 节点/秒（浏览器与桌面 CPU 通常为此 1.5–4 倍）`);
engine.uci('quit');
setTimeout(() => process.exit(0), 300);
