// Runs Pikafish (wasm) inside a dedicated Web Worker so the page stays responsive.
// Protocol with the page:
//   page -> worker: { type: 'init', dist: '<url of dist/>', nnue: '<url of pikafish.nnue>' }
//                   { type: 'uci', cmd: 'go depth 12' }
//   worker -> page: { type: 'line', line } | { type: 'status', text } | { type: 'ready' } | { type: 'error', text }
'use strict';

let engine = null;

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      const distUrl = new URL(msg.dist, self.location.href).href;
      self.importScripts(distUrl + 'pikafish.js');
      post('status', 'instantiating wasm…');
      engine = await self.Pikafish({
        locateFile: (file) => distUrl + file,       // pikafish.wasm / pikafish.worker.js live next to pikafish.js
        mainScriptUrlOrBlob: distUrl + 'pikafish.js', // pthread workers re-import the main script
        listen: (line) => post('line', line),
        onError: (text) => post('error', text),
      });
      post('status', 'downloading network…');
      const t0 = performance.now();
      const resp = await fetch(new URL(msg.nnue, self.location.href).href);
      if (!resp.ok) throw new Error(`nnue fetch failed: HTTP ${resp.status}`);
      const bytes = new Uint8Array(await resp.arrayBuffer());
      post('status', `network ${(bytes.length / 1048576).toFixed(1)} MB fetched in ${Math.round(performance.now() - t0)} ms, loading…`);
      engine.setNnueBuffer(bytes);
      engine.uci('uci');
      engine.uci(`setoption name Threads value ${msg.threads || 1}`);
      engine.uci('isready');
      post('ready');
    } else if (msg.type === 'uci') {
      if (!engine) throw new Error('engine not initialised');
      engine.uci(msg.cmd);
    }
  } catch (e) {
    post('error', String(e && e.stack || e));
  }
};

function post(type, payload) {
  self.postMessage(type === 'line' ? { type, line: payload } : type === 'ready' ? { type } : { type, text: payload });
}
