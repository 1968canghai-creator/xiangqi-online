// app.js — 对弈页面：人机对弈流程、难度选择、悔棋、着法列表
import { Position, RED, BLACK, colorOf, sqFromName, sqName } from './xiangqi.js';
import { BoardView } from './board.js';
import { Engine, LEVELS } from './engine.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'xq.settings.v1';

const settings = Object.assign(
  { level: 3, side: 'red', threads: Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1)), autoLevel: 3 },
  JSON.parse(localStorage.getItem(STORE_KEY) || '{}'),
);
const saveSettings = () => localStorage.setItem(STORE_KEY, JSON.stringify(settings));

const state = {
  pos: new Position(),
  humanColor: RED,
  selected: -1,
  targets: [],
  thinking: false,
  over: null,
  gen: 0,          // 搜索代号：悔棋/新局后丢弃旧结果
  lastEval: null,
};

const engine = new Engine({ enginePath: 'engine/', threads: settings.threads, workerUrl: 'js/engine-worker.js' });
const board = new BoardView($('board'), { onSquareClick });

// ---------- UI 初始化 ----------
function initControls() {
  const lv = $('level');
  lv.innerHTML = '<option value="0">自动（按战绩）</option>' + LEVELS.slice(1).map((l) => `<option value="${l.level}">${l.level} 级 · ${l.name}</option>`).join('');
  lv.value = String(settings.level);
  $('side').value = settings.side;
  const th = $('threads');
  const hw = navigator.hardwareConcurrency || 2;
  th.innerHTML = '';
  for (let i = 1; i <= Math.max(1, Math.min(8, hw - 1)); i++) th.append(new Option(`${i} 线程`, i));
  th.value = String(Math.min(settings.threads, Math.max(1, hw - 1)));

  lv.onchange = () => { settings.level = Number(lv.value); saveSettings(); updateStatus(); };
  $('side').onchange = () => { settings.side = $('side').value; saveSettings(); };
  th.onchange = async () => { settings.threads = Number(th.value); saveSettings(); await engine.setThreads(settings.threads); };
  $('btnNew').onclick = newGame;
  $('btnUndo').onclick = undo;
  $('btnFlip').onclick = () => { board.setFlipped(!board.flipped); render(); };
  $('btnResign').onclick = () => { if (!state.over && state.pos.history.length) finish({ result: state.humanColor === RED ? 'black' : 'red', reason: 'resign' }); };
}

function effectiveLevel() {
  return settings.level > 0 ? settings.level : settings.autoLevel;
}

// ---------- 对局流程 ----------
async function newGame() {
  state.gen++;
  engine.stop();
  state.pos = new Position();
  state.selected = -1; state.targets = []; state.over = null; state.lastEval = null; state.thinking = false;
  const side = settings.side === 'random' ? (Math.random() < 0.5 ? 'red' : 'black') : settings.side;
  state.humanColor = side === 'black' ? BLACK : RED;
  board.setFlipped(state.humanColor === BLACK);
  await engine.newGame().catch(() => {});
  render();
  if (state.pos.turn !== state.humanColor) engineMove();
}

function onSquareClick(s) {
  if (state.over || state.thinking || !engine.ready) return;
  const pos = state.pos;
  if (pos.turn !== state.humanColor) return;
  const p = pos.board[s];
  if (state.selected >= 0 && state.targets.includes(s)) {
    humanMove(state.selected, s);
    return;
  }
  if (p && colorOf(p) === state.humanColor) {
    state.selected = s;
    state.targets = pos.legalMovesFrom(s);
  } else {
    state.selected = -1; state.targets = [];
  }
  render();
}

function humanMove(from, to) {
  const pos = state.pos;
  if (!pos.isLegal(from, to)) return;
  pos.move(from, to);
  state.selected = -1; state.targets = [];
  render();
  if (checkEnd()) return;
  engineMove();
}

async function engineMove() {
  const gen = ++state.gen;
  state.thinking = true;
  updateStatus();
  const level = effectiveLevel();
  const t0 = performance.now();
  let r;
  try {
    r = await engine.bestMove({
      moves: state.pos.uciMoves(), level,
      onInfo: (info) => { if (gen === state.gen) showThinking(info); },
    });
  } catch (e) {
    if (gen !== state.gen) return;
    state.thinking = false;
    setStatus('引擎出错：' + e.message, 'warn');
    return;
  }
  if (gen !== state.gen) return; // 已悔棋/新局
  // 低难度也至少“想”一会儿，避免秒回
  const minThink = 400 + level * 60;
  const elapsed = performance.now() - t0;
  if (elapsed < minThink) await new Promise((res) => setTimeout(res, minThink - elapsed));
  if (gen !== state.gen) return;
  state.thinking = false;
  if (!r.move) { checkEnd(); return; }
  state.lastEval = r;
  try {
    state.pos.moveUci(r.move);
  } catch (e) {
    setStatus('引擎给出了不合法着法 ' + r.move + '（已忽略）', 'warn');
    return;
  }
  render();
  checkEnd();
}

function undo() {
  if (!state.pos.history.length) return;
  state.gen++;
  engine.stop();
  state.thinking = false;
  state.over = null;
  // 退回到轮到人类走子为止（通常两步）
  state.pos.undo();
  while (state.pos.history.length && state.pos.turn !== state.humanColor) state.pos.undo();
  state.selected = -1; state.targets = [];
  render();
}

function checkEnd() {
  const r = state.pos.gameOver();
  if (r) { finish(r); return true; }
  return false;
}

function finish(r) {
  state.over = r;
  state.thinking = false;
  const humanWon = (r.result === 'red') === (state.humanColor === RED) && r.result !== 'draw';
  if (settings.level === 0 && r.result !== 'draw') {
    settings.autoLevel = Math.max(1, Math.min(10, settings.autoLevel + (humanWon ? 1 : -1)));
    saveSettings();
  }
  render();
}

// ---------- 渲染 ----------
const REASONS = { checkmate: '将死', stalemate: '困毙', 'perpetual-check': '长将判负', repetition: '重复局面', 'sixty-move': '六十回合无吃子', resign: '认输' };

function render() {
  const pos = state.pos;
  const last = pos.history[pos.history.length - 1];
  const checkSq = pos.inCheck() ? pos.kingSquare(pos.turn) : -1;
  board.render(pos, { selected: state.selected, targets: state.targets, lastMove: last ? { from: last.from, to: last.to } : null, checkSq });
  renderMoves();
  updateStatus();
  $('btnUndo').disabled = !pos.history.length;
}

function renderMoves() {
  const h = state.pos.history;
  const rows = [];
  for (let i = 0; i < h.length; i += 2) {
    const n = i / 2 + 1;
    rows.push(`<tr><td class="n">${n}.</td><td>${h[i].notation}${h[i].check ? '<sup>将</sup>' : ''}</td><td>${h[i + 1] ? h[i + 1].notation + (h[i + 1].check ? '<sup>将</sup>' : '') : ''}</td></tr>`);
  }
  const el = $('moves');
  el.innerHTML = rows.join('') || '<tr><td class="empty">尚未开始</td></tr>';
  el.parentElement.scrollTop = el.parentElement.scrollHeight;
}

function setStatus(text, cls = '') { const s = $('status'); s.textContent = text; s.className = 'status ' + cls; }

function showThinking(info) {
  const sc = info.mate != null ? `杀 ${Math.abs(info.mate)}` : (info.score / 100).toFixed(2);
  $('think').textContent = `深度 ${info.depth} · 评估 ${sc}`;
}

function updateStatus() {
  const pos = state.pos;
  const lvl = effectiveLevel();
  $('levelTag').textContent = `${lvl} 级 · ${LEVELS[lvl].name}${settings.level === 0 ? '（自动）' : ''}`;
  if (!engine.ready) return; // 加载阶段由进度条负责
  if (state.over) {
    const r = state.over;
    const who = r.result === 'draw' ? '和棋' : (r.result === 'red' ? '红方胜' : '黑方胜');
    const you = r.result === 'draw' ? '' : ((r.result === 'red') === (state.humanColor === RED) ? '，你赢了 🎉' : '，你输了');
    setStatus(`${who}（${REASONS[r.reason] || r.reason}）${you}`, r.result === 'draw' ? '' : 'over');
    $('think').textContent = '';
    return;
  }
  if (state.thinking) { setStatus('引擎思考中…', 'thinking'); return; }
  $('think').textContent = state.lastEval ? `上一步引擎评估 ${(state.lastEval.score / 100).toFixed(2)}（引擎视角）· 深度 ${state.lastEval.depth}` : '';
  const chk = pos.inCheck() ? '，将军！' : '';
  setStatus(pos.turn === state.humanColor ? `轮到你走（${state.humanColor === RED ? '红' : '黑'}方）${chk}` : '引擎走子…');
}

// ---------- 引擎加载 ----------
function fmtMB(n) { return (n / 1048576).toFixed(1) + ' MB'; }

async function boot() {
  initControls();
  board.setFlipped(settings.side === 'black');
  render();
  const bar = $('progress'), txt = $('progressText');
  if (!Engine.supported) {
    setStatus('此浏览器或部署环境不支持多线程 WebAssembly（缺少 SharedArrayBuffer / COOP·COEP 响应头），无法启动引擎。', 'warn');
    $('loader').classList.add('error');
    return;
  }
  engine.onProgress = ({ phase, loaded, total }) => {
    if (phase === 'wasm') { txt.textContent = loaded ? '引擎已就绪，加载神经网络权重…' : '加载引擎…'; bar.value = 2; }
    else { bar.value = 2 + 98 * (loaded / total); txt.textContent = `加载神经网络权重 ${fmtMB(loaded)} / ${fmtMB(total)}（仅首次需要下载，之后走缓存）`; }
  };
  engine.onError = (e) => console.error(e);
  try {
    await engine.init();
  } catch (e) {
    txt.textContent = '引擎加载失败：' + e.message;
    $('loader').classList.add('error');
    return;
  }
  $('loader').classList.add('done');
  document.body.dataset.engine = 'ready';
  newGame();
}

boot();

// 调试入口
window.xq = { state, engine, board, Position, sqFromName, sqName };
