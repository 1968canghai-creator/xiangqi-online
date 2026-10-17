// levels.js — 难度分级表与选着逻辑（纯函数，浏览器 / Node 通用，供 engine.js 与离线标定脚本共用）
//
// Pikafish 没有 Skill Level / UCI_Elo，难度由四件事组成：
//   nodes      —— 搜索节点数上限（与设备快慢无关，强度可复现）
//   multipv    —— 候选着法个数
//   tempCp / maxLossCp —— 在候选中按 softmax(-(best-score)/tempCp) 随机选，且不选比最佳差 maxLossCp 以上的着法
//   randomProb —— 以此概率直接走一步随机合法着法（模拟初学者的“漏看”），低级别才有
// 注意：NNUE 引擎哪怕只搜几百个节点也不会白送子，所以低级别的“弱”主要靠 randomProb 与大温度制造失误。

export const LEVELS = [
  null,
  { level: 1,  name: '入门',  nodes: 100,    multipv: 10, tempCp: 500, maxLossCp: 2000, randomProb: 0.35 },
  { level: 2,  name: '初学',  nodes: 150,    multipv: 8,  tempCp: 300, maxLossCp: 1200, randomProb: 0.25 },
  { level: 3,  name: '新手',  nodes: 250,    multipv: 7,  tempCp: 220, maxLossCp: 900,  randomProb: 0.18 },
  { level: 4,  name: '业余',  nodes: 350,    multipv: 6,  tempCp: 180, maxLossCp: 700,  randomProb: 0.14 },
  { level: 5,  name: '进阶',  nodes: 700,    multipv: 5,  tempCp: 120, maxLossCp: 450,  randomProb: 0.07 },
  { level: 6,  name: '熟练',  nodes: 1500,   multipv: 4,  tempCp: 90,  maxLossCp: 300,  randomProb: 0.035 },
  { level: 7,  name: '高手',  nodes: 3000,   multipv: 3,  tempCp: 70,  maxLossCp: 220,  randomProb: 0.02 },
  { level: 8,  name: '大师',  nodes: 10000,  multipv: 3,  tempCp: 45,  maxLossCp: 150,  randomProb: 0.005 },
  { level: 9,  name: '特级',  nodes: 80000,  multipv: 2,  tempCp: 25,  maxLossCp: 60,   randomProb: 0 },
  { level: 10, name: '满级',  nodes: 600000, multipv: 1,  tempCp: 0,   maxLossCp: 0,    randomProb: 0 },
];

export const levelConfig = (level) => LEVELS[Math.min(10, Math.max(1, level | 0))];

/** 解析一行 `info ... multipv k ... score cp|mate x ... pv ...`，非 PV 行返回 null。 */
export function parseInfoLine(line) {
  if (!line.startsWith('info ') || !line.includes(' pv ')) return null;
  const sc = /score (cp|mate) (-?\d+)/.exec(line);
  if (!sc) return null;
  const m = /multipv (\d+)/.exec(line);
  const d = /depth (\d+)/.exec(line);
  const pv = line.split(' pv ')[1].trim().split(' ');
  const n = Number(sc[2]);
  const score = sc[1] === 'cp' ? n : (n > 0 ? 100000 - n : -100000 - n);
  return { move: pv[0], score, mate: sc[1] === 'mate' ? n : null, depth: d ? Number(d[1]) : 0, pv, multipv: m ? Number(m[1]) : 1 };
}

/**
 * 从候选中按难度选一步。
 * @param {object} o { candidates: 已按分数降序的候选, cfg: LEVELS[i], engineBest: 引擎 bestmove, legalMoves?: string[], rng?: () => number }
 * @returns {{ chosen, chosenIndex, random: boolean }}
 */
export function selectMove({ candidates, cfg, engineBest, legalMoves, rng = Math.random }) {
  let chosenIndex = 0;
  if (cfg.tempCp > 0 && candidates.length > 1) {
    const best = candidates[0].score;
    const pool = candidates.filter((c, i) => i === 0 || (best - c.score <= cfg.maxLossCp && Math.abs(c.score) < 90000));
    const weights = pool.map((c) => Math.exp(-(best - c.score) / cfg.tempCp));
    let r = rng() * weights.reduce((s, w) => s + w, 0);
    for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) { chosenIndex = candidates.indexOf(pool[i]); break; } }
  }
  let chosen = candidates[chosenIndex];
  let random = false;
  // 低级别：按概率走一步“漏看”的随机合法着法（排除引擎首选，保证确实偏离）
  if (cfg.randomProb > 0 && legalMoves && legalMoves.length > 1 && rng() < cfg.randomProb) {
    const pool = legalMoves.filter((m) => m !== engineBest);
    const m = pool[Math.floor(rng() * pool.length)];
    chosen = candidates.find((c) => c.move === m) || { move: m, score: null, mate: null, depth: 0, pv: [m], multipv: 0 };
    chosenIndex = candidates.indexOf(chosen);
    random = true;
  }
  return { chosen, chosenIndex, random };
}

/** 把搜索期间收集到的 info 行整理成候选列表：只保留最深一轮附近的，按分数降序，保证引擎 bestmove 在内。 */
export function collectCandidates(infos, engineBest) {
  const list = [...infos.values()];
  const maxDepth = list.length ? Math.max(...list.map((c) => c.depth)) : 0;
  let candidates = list.filter((c) => c.depth >= maxDepth - 1).sort((a, b) => b.score - a.score);
  if (!candidates.some((c) => c.move === engineBest)) {
    candidates = [{ move: engineBest, score: list[0]?.score ?? 0, depth: maxDepth, pv: [engineBest], multipv: 1 }, ...candidates];
  }
  return candidates;
}
