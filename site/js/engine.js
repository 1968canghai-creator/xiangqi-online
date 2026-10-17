// engine.js — 页面侧的引擎控制层：Worker 封装、UCI 请求/应答、难度分级选着。
//
//   const engine = new Engine({ enginePath: 'engine/', threads: 2 });
//   engine.onProgress = ({ phase, loaded, total }) => ...;
//   await engine.init();
//   const r = await engine.bestMove({ moves: ['h2e2', 'h9g7'], level: 5 });
//   // r = { move: 'h0g2', score: 23, depth: 12, candidates: [{ move, score, depth, pv }], chosenIndex }
//
import { LEVELS, levelConfig, parseInfoLine, selectMove, collectCandidates } from './levels.js';
export { LEVELS };

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
    const cfg = levelConfig(level);
    const mpv = multipv || cfg.multipv;
    const lim = limits || cfg.limits;
    const pos = `position ${fen ? 'fen ' + fen : 'startpos'}${moves.length ? ' moves ' + moves.join(' ') : ''}`;

    await this.send(`setoption name MultiPV value ${mpv}`, () => true, 500).catch(() => {});
    this.uci(pos);

    const infos = new Map(); // multipv index -> 最新一行
    const off = this.onLine((line) => {
      const info = parseInfoLine(line);
      if (!info) return;
      infos.set(info.multipv, info);
      if (onInfo && info.multipv === 1) onInfo(info);
    });

    const goCmd = 'go ' + Object.entries(lim).map(([k, v]) => `${k} ${v}`).join(' ');
    const bm = await this.send(goCmd, (l) => l.startsWith('bestmove'), 600000);
    off();
    const engineBest = bm.split(' ')[1];
    if (!engineBest || engineBest === '(none)') return { move: null, candidates: [] };

    const candidates = collectCandidates(infos, engineBest);
    const { chosen, chosenIndex, random } = selectMove({ candidates, cfg });
    return { move: chosen.move, score: chosen.score, mate: chosen.mate, depth: chosen.depth, pv: chosen.pv, candidates, chosenIndex, engineBest, level: cfg.level, random };
  }

  /** 静态/快速评估当前局面（用于复盘与评级），返回主变与分数（行棋方视角，厘兵）。 */
  async evaluate({ fen, moves = [], nodes = 200000 } = {}) {
    const r = await this.bestMove({ fen, moves, level: 10, limits: { nodes }, multipv: 1 });
    return r;
  }

  terminate() { if (this.worker) { this.worker.terminate(); this.worker = null; this.ready = false; this._initPromise = null; } }
}

export default Engine;
