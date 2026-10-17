// engine-worker.js — 在 Web Worker 中运行 Pikafish(WASM)，向页面转发 UCI 输出。
// 页面 -> worker:
//   { type: 'init', enginePath: 'engine/', threads: 1 }
//   { type: 'uci', cmd: 'go nodes 20000' }
// worker -> 页面:
//   { type: 'progress', phase: 'wasm'|'net', loaded, total }   加载进度
//   { type: 'ready', info: { nps?: number } }                   引擎可用
//   { type: 'line', line }                                       引擎输出的一行
//   { type: 'error', text }
'use strict';

const CACHE_NAME = 'pikafish-net-v1';
let engine = null;

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') await init(msg);
    else if (msg.type === 'uci') { if (!engine) throw new Error('engine not ready'); engine.uci(msg.cmd); }
  } catch (e) {
    self.postMessage({ type: 'error', text: String((e && e.stack) || e) });
  }
};

async function init({ enginePath, threads }) {
  const base = new URL(enginePath, self.location.href).href;
  self.importScripts(base + 'pikafish.js');
  self.postMessage({ type: 'progress', phase: 'wasm', loaded: 0, total: 1 });
  engine = await self.Pikafish({
    locateFile: (f) => base + f,
    mainScriptUrlOrBlob: base + 'pikafish.js',
    listen: (line) => self.postMessage({ type: 'line', line }),
    onError: (text) => self.postMessage({ type: 'error', text }),
  });
  self.postMessage({ type: 'progress', phase: 'wasm', loaded: 1, total: 1 });

  const net = await loadNetwork(base);
  engine.setNnueBuffer(net);
  engine.uci('uci');
  engine.uci(`setoption name Threads value ${Math.max(1, threads | 0)}`);
  engine.uci('setoption name Hash value 32');
  engine.uci('isready');
  self.postMessage({ type: 'ready' });
}

/** 按 manifest 并行下载权重分块（Cache API 持久缓存），拼成一个 Uint8Array。 */
async function loadNetwork(base) {
  const manifest = await (await fetch(base + 'nnue-manifest.json', { cache: 'no-cache' })).json();
  const total = manifest.size;
  let loaded = 0;
  const report = () => self.postMessage({ type: 'progress', phase: 'net', loaded, total });
  report();

  let cache = null;
  try { cache = await caches.open(CACHE_NAME); } catch (_) { /* 无 Cache API（隐私模式等）时直接下载 */ }

  const parts = await Promise.all(manifest.chunks.map(async (name) => {
    const url = base + name;
    let resp = cache ? await cache.match(url) : null;
    if (!resp) {
      resp = await fetch(url);
      if (!resp.ok) throw new Error(`下载 ${name} 失败：HTTP ${resp.status}`);
      if (cache) { try { await cache.put(url, resp.clone()); } catch (_) { /* 配额不足则忽略 */ } }
    }
    // 流式读取以报告进度
    const reader = resp.body && resp.body.getReader ? resp.body.getReader() : null;
    if (!reader) { const buf = new Uint8Array(await resp.arrayBuffer()); loaded += buf.length; report(); return buf; }
    const chunks = []; let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); n += value.length; loaded += value.length; report();
    }
    const out = new Uint8Array(n); let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }));

  const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let off = 0;
  for (const p of parts) { all.set(p, off); off += p.length; }
  if (all.length !== total) throw new Error(`权重大小不符：${all.length} != ${total}`);
  // 清理旧版本缓存
  if (cache) {
    try {
      const keep = new Set(manifest.chunks.map((n) => base + n));
      for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
    } catch (_) { /* ignore */ }
  }
  return all;
}
