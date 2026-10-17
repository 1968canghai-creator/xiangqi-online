// Smoke test for the Pikafish WebAssembly build under Node.
//   node test/node-test.js [path/to/pikafish.nnue] [threads]
'use strict';
const fs = require('fs');
const path = require('path');

const nnuePath = process.argv[2] || path.join(__dirname, '..', '..', 'nnue', 'pikafish.nnue');
const threads = Number(process.argv[3] || 1);
const Pikafish = require(path.join(__dirname, '..', 'dist', 'pikafish.js'));

function main() {
  const lines = [];
  let waiters = [];
  const listen = (line) => {
    lines.push(line);
    if (process.env.VERBOSE) console.log('<', line);
    waiters = waiters.filter((w) => !w(line));
  };
  const waitFor = (pred, ms = 60000) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting; last lines:\n' + lines.slice(-5).join('\n'))), ms);
      waiters.push((line) => {
        if (pred(line)) {
          clearTimeout(t);
          resolve(line);
          return true;
        }
        return false;
      });
    });

  // Node >= 18 has a global fetch() that cannot read file paths; hand the wasm bytes over directly.
  const wasmBinary = fs.readFileSync(path.join(__dirname, '..', 'dist', 'pikafish.wasm'));
  return Pikafish({ listen, onError: (m) => console.error('! ' + m), wasmBinary }).then(async (engine) => {
    const t0 = Date.now();
    engine.uci('uci');
    await waitFor((l) => l === 'uciok');
    console.log('✓ uciok', lines.find((l) => l.startsWith('id name')), `(${Date.now() - t0} ms)`);
    console.log('  options:', lines.filter((l) => l.startsWith('option name')).map((l) => l.split(' ')[2]).join(', '));
    console.log('  recommended net:', engine.getRecommendedNnue());

    const t1 = Date.now();
    const buf = fs.readFileSync(nnuePath);
    engine.setNnueBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    engine.uci(`setoption name Threads value ${threads}`);
    engine.uci('setoption name Hash value 32');
    engine.uci('isready');
    await waitFor((l) => l === 'readyok', 120000);
    console.log(`✓ NNUE loaded (${(buf.length / 1048576).toFixed(1)} MB compressed) + ${threads} thread(s) ready (${Date.now() - t1} ms)`);

    // 1) fixed-depth search from the start position
    engine.uci('ucinewgame');
    engine.uci('position startpos');
    const t2 = Date.now();
    engine.uci('go depth 14');
    const bm = await waitFor((l) => l.startsWith('bestmove'), 120000);
    const last = [...lines].reverse().find((l) => l.startsWith('info depth') && l.includes(' pv '));
    console.log(`✓ startpos depth 14 -> ${bm} (${Date.now() - t2} ms)`);
    console.log('  ' + last.replace(/ pv .*/, '').replace(/.*(nodes \d+ nps \d+).*/, '$1') + ' | ' + last.split(' score ')[1].split(' nodes')[0]);
    console.log('  NNUE:', lines.find((l) => l.includes('NNUE evaluation using')) || '(no verify line)');

    // 2) time-limited search in a middlegame position, MultiPV 3 (what the difficulty layer will use)
    engine.uci('setoption name MultiPV value 3');
    engine.uci('position fen rnbakab1r/9/1c4nc1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C1N2/9/RNBAKAB1R w - - 2 2');
    const t3 = Date.now();
    engine.uci('go movetime 1500');
    const bm2 = await waitFor((l) => l.startsWith('bestmove'), 30000);
    const pvs = {};
    for (const l of lines) {
      const m = l.match(/multipv (\d) score (\w+ -?\d+).* pv (\S+)/);
      if (m) pvs[m[1]] = `${m[3]} (${m[2]})`;
    }
    console.log(`✓ movetime 1500 MultiPV 3 -> ${bm2} (${Date.now() - t3} ms)`);
    console.log('  candidates:', Object.entries(pvs).map(([k, v]) => `#${k} ${v}`).join('  '));

    // 3) stop works while searching
    engine.uci('setoption name MultiPV value 1');
    engine.uci('position startpos moves h2e2');
    engine.uci('go infinite');
    await new Promise((r) => setTimeout(r, 700));
    engine.uci('stop');
    const bm3 = await waitFor((l) => l.startsWith('bestmove'), 10000);
    console.log(`✓ go infinite + stop -> ${bm3}`);

    console.log('ALL OK');
    engine.uci('quit'); // the runtime exits the process once the engine loop returns
    await new Promise((r) => setTimeout(r, 1000));
    process.exit(0);
  });
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
