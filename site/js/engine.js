// engine.js — 页面侧的引擎控制层：Worker 封装、UCI 请求/应答、难度分级选着。
//
//   const engine = new Engine({ enginePath: 'engine/', threads: 2 });
//   engine.onProgress = ({ phase, loaded, total }) => ...;
//   await engine.init();
//   const r = await engine.bestMove({ moves: ['h2e2', 'h9g7'], level: 5 });
//   // r = { move: 'h0g2', score: 23, depth: 12, candidates: [{ move, score, depth, pv }], chosenIndex }
//
// Pikafish 没有 Skill Level / UCI_Elo，难度由三件事组成：
//   nodes   —— 搜索节点数上限（与设备快慢无关，强度可复现）
//   multipv —— 候选着法个数
//   tempCp / maxLossCp —— 在候选中按 softmax(-(best-score)/tempCp) 随机选，且不选比最佳差 maxLossCp 以上的着法

export const LEVELS = [
  null,
  { level: 1,  name: '入门',  nodes: 300,     multipv: 8, tempCp: 150, maxLossCp: 600 },
  { level: 2,  name: '初学',  nodes: 800,     multipv: 6, tempCp: 110, maxLossCp: 400 },
  { level: 3,  name: '新手',  nodes: 2000,    multipv: 5, tempCp: 80,  maxLossCp: 300 },
  { level: 4,  name: '业余',  nodes: 5000,    multipv: 4, tempCp: 60,  maxLossCp: 200 },
  { level: 5,  name: '进阶',  nodes: 15000,   multipv: 3, tempCp: 45,  maxLossCp: 150 },
  { level: 6,  name: '熟练',  nodes: 50000,   multipv: 3, tempCp: 35,  maxLossCp: 100 },
  { level: 7,  name: '高手',  nodes: 150000,  multipv: 2, tempCp: 25,  maxLossCp: 60 },
  { level: 8,  name: '大师',  nodes: 400000,  multipv: 1, tempCp: 0,   maxLossCp: 0 },
  { level: 9,  name: '特级',  nodes: 1200000, multipv: 1, tempCp: 0,   maxLossCp: 0 },
  { level: 10, name: '满级',  nodes: 3000000, multipv: 1, tempCp: 0,   maxLossCp: 0 },
];

export class Engine {
  constructor({ enginePath = 'engine/', threads = 1, workerUrl = 'js/engine-worker.js' } = {}) {
    // 统一解析为相对页面的绝对 URL（Worker 内的相对路径是相对 worker 脚本的）
    this.enginePath = new URL(enginePath, document.baseURI).href;
    this.threads = threads;
    this.workerUrl = workerUrl;
    this.worker = null;
    this.ready = false;
    this.lineListeners = new Set();
    this.onProgress = null;
    this.onError = null;
    this._searching = null; // 当前搜索的 resolve 回调
  }

  static get supported() {
    return typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated === true && typeof WebAssembly !== 'undefined';
  }

  init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = new Promise((resolve, reject) => {
      if (!Engine.supported) {
        reject(new Error('当前环境不支持多线程 WebAssembly（需要 SharedArrayBuffer 与 cross-origin isolation）'));
        return;
      }
      this.worker = new Worker(this.workerUrl);
      this.worker.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === 'line') this._onLine(m.line);
        else if (m.type === 'progress') this.onProgress && this.onProgress(m);
        else if (m.type === 'ready') { this.ready = true; this.send('isready', (l) => l === 'readyok').then(resolve, reject); }
        else if (m.type === 'error') { const e = new Error(m.text); if (!this.ready) reject(e); this.onError && this.onError(e); }
      };
      this.worker.onerror = (e) => { const err = new Error(e.message || 'worker error'); if (!this.ready) reject(err); this.onError && this.onError(err); };
      this.worker.postMessage({ type: 'init', enginePath: this.enginePath, threads: this.threads });
    });
    return this._initPromise;
  }

  onLine(fn) { this.lineListeners.add(fn); return () => this.lineListeners.delete(fn); }

  _onLine(line) {
    for (const fn of this.lineListeners) fn(line);
  }

  uci(cmd) { this.worker.postMessage({ type: 'uci', cmd }); }

  /** 发送命令并等待满足 pred 的一行。 */
  send(cmd, pred, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error(`engine timeout: ${cmd}`)); }, timeoutMs);
      const off = this.onLine((line) => { if (pred(line)) { clearTimeout(timer); off(); resolve(line); } });
      this.uci(cmd);
    });
  }

  async setThreads(n) {
    this.threads = n;
    if (this.ready) await this.send(`setoption name Threads value ${n}`, (l) => l === 'readyok').catch(() => {});
  }

  async newGame() {
    await this.send('ucinewgame', () => true, 1000).catch(() => {});
    await this.send('isready', (l) => l === 'readyok');
  }

  stop() { if (this.ready) this.uci('stop'); }

  /**
   * 让引擎在给定局面上按难度选一步。
   * @param {object} o  { fen?, moves?: string[], level?: 1..10, limits?: {nodes|depth|movetime}, multipv?, onInfo? }
   */
  async bestMove({ fen, moves = [], level = 5, limits, multipv, onInfo } = {}) {
    const cfg = LEVELS[Math.min(10, Math.max(1, level | 0))];
    const mpv = multipv || cfg.multipv;
    const lim = limits || { nodes: cfg.nodes };
    const pos = `position ${fen ? 'fen ' + fen : 'startpos'}${moves.length ? ' moves ' + moves.join(' ') : ''}`;

    await this.send(`setoption name MultiPV value ${mpv}`, () => true, 500).catch(() => {});
    this.uci(pos);

    const cands = new Map(); // multipv index -> {move, score, depth, pv}
    const off = this.onLine((line) => {
      if (!line.startsWith('info ') || !line.includes(' pv ')) return;
      const m = /multipv (\d+)/.exec(line);
      const idx = m ? Number(m[1]) : 1;
      const d = /depth (\d+)/.exec(line);
      const sc = /score (cp|mate) (-?\d+)/.exec(line);
      const pv = line.split(' pv ')[1].trim().split(' ');
      if (!sc) return;
      const score = sc[1] === 'cp' ? Number(sc[2]) : (Number(sc[2]) > 0 ? 100000 - Number(sc[2]) : -100000 - Number(sc[2]));
      const info = { move: pv[0], score, mate: sc[1] === 'mate' ? Number(sc[2]) : null, depth: d ? Number(d[1]) : 0, pv, multipv: idx };
      cands.set(idx, info);
      onInfo && idx === 1 && onInfo(info);
    });

    const goCmd = 'go ' + Object.entries(lim).map(([k, v]) => `${k} ${v}`).join(' ');
    const bm = await this.send(goCmd, (l) => l.startsWith('bestmove'), 600000);
    off();
    const engineBest = bm.split(' ')[1];
    if (engineBest === '(none)') return { move: null, candidates: [] };

    // 只保留最深一轮里出现过的候选（避免浅层残留），按分数降序
    const list = [...cands.values()];
    const maxDepth = Math.max(...list.map((c) => c.depth));
    let candidates = list.filter((c) => c.depth >= maxDepth - 1).sort((a, b) => b.score - a.score);
    if (!candidates.length || !candidates.some((c) => c.move === engineBest)) {
      candidates = [{ move: engineBest, score: list[0]?.score ?? 0, depth: maxDepth, pv: [engineBest], multipv: 1 }, ...candidates];
    }

    let chosenIndex = 0;
    if (cfg.tempCp > 0 && candidates.length > 1) {
      const best = candidates[0].score;
      const pool = candidates.filter((c) => best - c.score <= cfg.maxLossCp && Math.abs(c.score) < 90000 || c === candidates[0]);
      const weights = pool.map((c) => Math.exp(-(best - c.score) / cfg.tempCp));
      let r = Math.random() * weights.reduce((s, w) => s + w, 0);
      for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) { chosenIndex = candidates.indexOf(pool[i]); break; } }
    }
    const chosen = candidates[chosenIndex];
    return { move: chosen.move, score: chosen.score, mate: chosen.mate, depth: chosen.depth, pv: chosen.pv, candidates, chosenIndex, engineBest, level: cfg.level };
  }

  /** 静态/快速评估当前局面（用于复盘与评级），返回主变与分数（行棋方视角，厘兵）。 */
  async evaluate({ fen, moves = [], nodes = 200000 } = {}) {
    const r = await this.bestMove({ fen, moves, level: 10, limits: { nodes }, multipv: 1 });
    return r;
  }

  terminate() { if (this.worker) { this.worker.terminate(); this.worker = null; this.ready = false; this._initPromise = null; } }
}

export default Engine;
