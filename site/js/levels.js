// levels.js — 难度分级表与选着逻辑（纯函数，浏览器 / Node 通用，供 engine.js 与离线标定脚本共用）
//
// Pikafish 没有 Skill Level / UCI_Elo。每一级由两个指标限制搜索，先到者为准（UCI: go depth N movetime M）：
//   depth    —— 搜索层数上限：决定它能看多远。浅层看不到两三步以外的战术（抽将、捉双、闪击），
//               但静态搜索仍会算清直接吃子，所以不会无缘无故白送子——像一个棋力有限的人。
//   movetime —— 思考时间上限（毫秒）：慢设备上的保底，也决定高级别的实际强度。
// 另有两个只影响“风格”的参数：
//   multipv  —— 候选着法个数；
//   noiseCp  —— 给候选分数加的高斯噪声（厘兵），用于让同一局面不总走同一步。数值远小于一个子的价值，
//               不会造成送子；9、10 级为 0，完全确定性。
// 不使用“随机合法着法”——那会让引擎像喝醉一样送子。

export const LEVELS = [
  null,
  { level: 1,  name: '入门',  limits: { depth: 1,  movetime: 100 },  multipv: 6, noiseCp: 120 },
  { level: 2,  name: '初学',  limits: { depth: 2,  movetime: 200 },  multipv: 5, noiseCp: 90 },
  { level: 3,  name: '新手',  limits: { depth: 3,  movetime: 300 },  multipv: 4, noiseCp: 70 },
  { level: 4,  name: '业余',  limits: { depth: 4,  movetime: 400 },  multipv: 4, noiseCp: 50 },
  { level: 5,  name: '进阶',  limits: { depth: 6,  movetime: 600 },  multipv: 3, noiseCp: 35 },
  { level: 6,  name: '熟练',  limits: { depth: 8,  movetime: 800 },  multipv: 3, noiseCp: 25 },
  { level: 7,  name: '高手',  limits: { depth: 10, movetime: 1000 }, multipv: 2, noiseCp: 15 },
  { level: 8,  name: '大师',  limits: { depth: 13, movetime: 1500 }, multipv: 2, noiseCp: 10 },
  { level: 9,  name: '特级',  limits: { depth: 16, movetime: 2500 }, multipv: 1, noiseCp: 0 },
  { level: 10, name: '满级',  limits: { depth: 30, movetime: 5000 }, multipv: 1, noiseCp: 0 },
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

/** 标准正态随机数（Box-Muller） */
export function gaussian(rng = Math.random) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * 从候选中按难度选一步：每个候选分数加 N(0, noiseCp²) 噪声后取最高。
 * 杀棋分（|score| ≥ 90000）不加噪声，保证能将死就将死、能逃杀就逃杀。
 * @param {object} o { candidates: 已按分数降序的候选, cfg: LEVELS[i], engineBest, rng?: () => number }
 * @returns {{ chosen, chosenIndex, random: boolean }}
 */
export function selectMove({ candidates, cfg, rng = Math.random }) {
  let chosenIndex = 0;
  if (cfg.noiseCp > 0 && candidates.length > 1) {
    let best = -Infinity;
    candidates.forEach((c, i) => {
      const noisy = Math.abs(c.score) >= 90000 ? c.score : c.score + gaussian(rng) * cfg.noiseCp;
      if (noisy > best) { best = noisy; chosenIndex = i; }
    });
  }
  return { chosen: candidates[chosenIndex], chosenIndex, random: chosenIndex !== 0 };
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
