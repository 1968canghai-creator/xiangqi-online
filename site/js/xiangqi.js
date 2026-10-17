// xiangqi.js — 中国象棋规则库（纯函数式，浏览器 / Node 通用，无依赖）
//
// 坐标：sq = rank * 9 + file，file 0..8 = a..i（从红方视角左到右），rank 0..9 = 红方底线到黑方底线。
// 与 UCI / Pikafish 一致：a0 是红方左下角，红方（大写）先行。
// FEN：rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1
//
// 导出：Position 类（走法生成、合法性、将军、胜负判定、记谱）、常量与工具函数。

export const FILES = 9;
export const RANKS = 10;
export const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

export const RED = 'w';
export const BLACK = 'b';

export const sq = (file, rank) => rank * 9 + file;
export const fileOf = (s) => s % 9;
export const rankOf = (s) => (s / 9) | 0;
export const sqName = (s) => 'abcdefghi'[fileOf(s)] + rankOf(s);
export const sqFromName = (n) => sq('abcdefghi'.indexOf(n[0]), Number(n[1]));
export const colorOf = (p) => (p === p.toUpperCase() ? RED : BLACK);
export const opposite = (c) => (c === RED ? BLACK : RED);

const inBoard = (f, r) => f >= 0 && f < 9 && r >= 0 && r < 10;
const inPalace = (f, r, color) => f >= 3 && f <= 5 && (color === RED ? r >= 0 && r <= 2 : r >= 7 && r <= 9);
const ownSide = (r, color) => (color === RED ? r <= 4 : r >= 5);

const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
// 马：[落点偏移, 马腿偏移]
const HORSE = [
  [[1, 2], [0, 1]], [[-1, 2], [0, 1]], [[1, -2], [0, -1]], [[-1, -2], [0, -1]],
  [[2, 1], [1, 0]], [[2, -1], [1, 0]], [[-2, 1], [-1, 0]], [[-2, -1], [-1, 0]],
];

export const PIECE_NAMES = {
  K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵',
  k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒',
};
const CN_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

export class Position {
  constructor(fen = START_FEN) {
    this.board = new Array(90).fill(null);
    this.turn = RED;
    this.halfmove = 0; // 无吃子半回合数（用于 60 回合自然限着）
    this.fullmove = 1;
    this.history = []; // 走过的着法（含撤销信息）
    this.setFen(fen);
  }

  // ---------- FEN ----------
  setFen(fen) {
    const [placement, turn = 'w', , , half = '0', full = '1'] = fen.trim().split(/\s+/);
    this.board.fill(null);
    const rows = placement.split('/');
    if (rows.length !== 10) throw new Error('bad FEN: need 10 ranks');
    rows.forEach((row, i) => {
      const rank = 9 - i;
      let file = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) file += Number(ch);
        else {
          if (file > 8 || !PIECE_NAMES[ch]) throw new Error('bad FEN rank: ' + row);
          this.board[sq(file, rank)] = ch;
          file++;
        }
      }
    });
    this.turn = turn === 'b' ? BLACK : RED;
    this.halfmove = Number(half) || 0;
    this.fullmove = Number(full) || 1;
    this.history = [];
    this.keys = [this.key()];
    return this;
  }

  fen() {
    const rows = [];
    for (let rank = 9; rank >= 0; rank--) {
      let row = '', empty = 0;
      for (let file = 0; file < 9; file++) {
        const p = this.board[sq(file, rank)];
        if (p) { if (empty) { row += empty; empty = 0; } row += p; } else empty++;
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return `${rows.join('/')} ${this.turn} - - ${this.halfmove} ${this.fullmove}`;
  }

  // 局面键（用于重复局面判断）：棋子布局 + 行棋方
  key() { return this.fen().split(' ').slice(0, 2).join(' '); }

  clone() {
    const p = new Position();
    p.board = this.board.slice();
    p.turn = this.turn; p.halfmove = this.halfmove; p.fullmove = this.fullmove;
    p.history = this.history.slice(); p.keys = this.keys.slice();
    return p;
  }

  kingSquare(color) {
    const k = color === RED ? 'K' : 'k';
    return this.board.indexOf(k);
  }

  // ---------- 攻击判定 ----------
  /** color 方是否攻击到 target 格（含“王不见王”：对方将帅在同一列无遮挡视为攻击） */
  attacked(target, color) {
    const b = this.board;
    const tf = fileOf(target), tr = rankOf(target);
    const own = (p) => p && colorOf(p) === color;
    // 车 / 炮 / 将帅（直线）
    for (const [df, dr] of ORTHO) {
      let f = tf + df, r = tr + dr, screen = 0;
      while (inBoard(f, r)) {
        const p = b[sq(f, r)];
        if (p) {
          const u = p.toUpperCase();
          if (screen === 0) {
            if (own(p) && (u === 'R' || u === 'K')) return true; // 车直接攻击；将帅照面
          } else if (screen === 1) {
            if (own(p) && u === 'C') return true;
          }
          if (++screen > 1) break;
        }
        f += df; r += dr;
      }
    }
    // 马：攻击者在 L 位，马腿在攻击者与目标之间（靠攻击者那一侧的直角邻格）
    for (const [[df, dr]] of HORSE) {
      const f = tf + df, r = tr + dr;
      if (!inBoard(f, r)) continue;
      const p = b[sq(f, r)];
      if (!own(p) || p.toUpperCase() !== 'N') continue;
      // 马腿：从马的位置朝目标方向走一步的直线邻格
      const lf = f + (Math.abs(df) === 2 ? -Math.sign(df) : 0);
      const lr = r + (Math.abs(dr) === 2 ? -Math.sign(dr) : 0);
      if (!b[sq(lf, lr)]) return true;
    }
    // 兵卒：从兵的视角向前一步到达目标；过河后可横向
    const pawn = color === RED ? 'P' : 'p';
    const back = color === RED ? -1 : 1; // 兵在目标“后方”一格
    if (inBoard(tf, tr + back) && b[sq(tf, tr + back)] === pawn) return true;
    for (const df of [-1, 1]) {
      const f = tf + df;
      if (inBoard(f, tr) && b[sq(f, tr)] === pawn && !ownSide(tr, color)) return true;
    }
    return false;
  }

  inCheck(color = this.turn) {
    const k = this.kingSquare(color);
    return k < 0 ? false : this.attacked(k, opposite(color));
  }

  // ---------- 走法生成 ----------
  /** 伪合法走法：[from, to] 列表 */
  pseudoMoves(color = this.turn) {
    const b = this.board, moves = [];
    const push = (from, to) => {
      const t = b[to];
      if (!t || colorOf(t) !== color) moves.push([from, to]);
    };
    for (let s = 0; s < 90; s++) {
      const p = b[s];
      if (!p || colorOf(p) !== color) continue;
      const f = fileOf(s), r = rankOf(s), u = p.toUpperCase();
      switch (u) {
        case 'K':
          for (const [df, dr] of ORTHO) if (inPalace(f + df, r + dr, color)) push(s, sq(f + df, r + dr));
          break;
        case 'A':
          for (const [df, dr] of DIAG) if (inPalace(f + df, r + dr, color)) push(s, sq(f + df, r + dr));
          break;
        case 'B':
          for (const [df, dr] of DIAG) {
            const nf = f + 2 * df, nr = r + 2 * dr;
            if (inBoard(nf, nr) && ownSide(nr, color) && !b[sq(f + df, r + dr)]) push(s, sq(nf, nr));
          }
          break;
        case 'N':
          for (const [[df, dr], [lf, lr]] of HORSE) {
            const nf = f + df, nr = r + dr;
            if (inBoard(nf, nr) && !b[sq(f + lf, r + lr)]) push(s, sq(nf, nr));
          }
          break;
        case 'R':
          for (const [df, dr] of ORTHO) {
            let nf = f + df, nr = r + dr;
            while (inBoard(nf, nr)) {
              const t = b[sq(nf, nr)];
              if (!t) moves.push([s, sq(nf, nr)]);
              else { if (colorOf(t) !== color) moves.push([s, sq(nf, nr)]); break; }
              nf += df; nr += dr;
            }
          }
          break;
        case 'C':
          for (const [df, dr] of ORTHO) {
            let nf = f + df, nr = r + dr, jumped = false;
            while (inBoard(nf, nr)) {
              const t = b[sq(nf, nr)];
              if (!jumped) {
                if (!t) moves.push([s, sq(nf, nr)]);
                else jumped = true;
              } else if (t) { if (colorOf(t) !== color) moves.push([s, sq(nf, nr)]); break; }
              nf += df; nr += dr;
            }
          }
          break;
        case 'P': {
          const fwd = color === RED ? 1 : -1;
          if (inBoard(f, r + fwd)) push(s, sq(f, r + fwd));
          if (!ownSide(r, color)) for (const df of [-1, 1]) if (inBoard(f + df, r)) push(s, sq(f + df, r));
          break;
        }
      }
    }
    return moves;
  }

  /** 合法走法（走后己方不被将军、将帅不照面） */
  legalMoves(color = this.turn) {
    const out = [];
    for (const m of this.pseudoMoves(color)) {
      const undo = this.makeRaw(m[0], m[1]);
      const ok = !this.inCheck(color);
      this.unmakeRaw(undo);
      if (ok) out.push(m);
    }
    return out;
  }

  legalMovesFrom(from) {
    return this.legalMoves().filter((m) => m[0] === from).map((m) => m[1]);
  }

  isLegal(from, to) {
    return this.legalMoves().some((m) => m[0] === from && m[1] === to);
  }

  // 底层落子 / 撤销（不改变 turn 与计数，供合法性检测使用）
  makeRaw(from, to) {
    const undo = { from, to, piece: this.board[from], captured: this.board[to] };
    this.board[to] = this.board[from];
    this.board[from] = null;
    return undo;
  }
  unmakeRaw(u) {
    this.board[u.from] = u.piece;
    this.board[u.to] = u.captured;
  }

  // ---------- 正式走子 ----------
  /** 走一步（不检查合法性，调用方应先用 isLegal）。返回着法记录。 */
  move(from, to) {
    const piece = this.board[from];
    const captured = this.board[to];
    const notation = this.notation(from, to);
    const uci = sqName(from) + sqName(to);
    this.makeRaw(from, to);
    const rec = {
      from, to, piece, captured, uci, notation,
      prevHalfmove: this.halfmove, color: this.turn,
    };
    this.halfmove = captured || piece.toUpperCase() === 'P' ? 0 : this.halfmove + 1;
    if (this.turn === BLACK) this.fullmove++;
    this.turn = opposite(this.turn);
    rec.check = this.inCheck(this.turn);
    this.history.push(rec);
    this.keys.push(this.key());
    return rec;
  }

  moveUci(uci) {
    const from = sqFromName(uci.slice(0, 2)), to = sqFromName(uci.slice(2, 4));
    if (!this.isLegal(from, to)) throw new Error('illegal move ' + uci);
    return this.move(from, to);
  }

  undo() {
    const rec = this.history.pop();
    if (!rec) return null;
    this.keys.pop();
    this.unmakeRaw(rec);
    this.turn = rec.color;
    this.halfmove = rec.prevHalfmove;
    if (this.turn === BLACK) this.fullmove--;
    return rec;
  }

  uciMoves() { return this.history.map((h) => h.uci); }

  // ---------- 终局判定 ----------
  /**
   * 返回 null（未结束）或 { result: 'red'|'black'|'draw', reason }。
   * 规则：无合法着法者负（含困毙）；长将判负（同一局面第三次出现且期间一方每步都在将军）；
   * 其他三次重复判和；120 个半回合无吃子/无进兵判和（60 回合自然限着）。
   */
  gameOver() {
    const mover = this.turn;
    if (this.legalMoves(mover).length === 0) {
      return { result: mover === RED ? 'black' : 'red', reason: this.inCheck(mover) ? 'checkmate' : 'stalemate' };
    }
    if (this.halfmove >= 120) return { result: 'draw', reason: 'sixty-move' };
    // 重复局面
    const k = this.keys[this.keys.length - 1];
    let count = 0, firstIdx = -1;
    for (let i = this.keys.length - 1; i >= 0; i--) {
      if (this.keys[i] === k) { count++; if (count === 3) { firstIdx = i; break; } }
    }
    if (count >= 3) {
      // keys[i] 对应 history[i-1] 走后的局面；检查自第一次出现以来各方是否每步都在将军
      const recs = this.history.slice(firstIdx);
      const allCheck = (c) => recs.filter((r) => r.color === c).every((r) => r.check);
      const redPerp = allCheck(RED), blackPerp = allCheck(BLACK);
      if (redPerp && !blackPerp) return { result: 'black', reason: 'perpetual-check' };
      if (blackPerp && !redPerp) return { result: 'red', reason: 'perpetual-check' };
      return { result: 'draw', reason: 'repetition' };
    }
    return null;
  }

  // ---------- 中文记谱 ----------
  notation(from, to) {
    const b = this.board, p = b[from];
    if (!p) return '';
    const color = colorOf(p), u = p.toUpperCase();
    const ff = fileOf(from), fr = rankOf(from), tf = fileOf(to), tr = rankOf(to);
    const name = PIECE_NAMES[p];
    // 红方纵线从右到左 一..九；黑方从左到右 1..9（各自视角均为从右到左）
    const fileNum = (f) => (color === RED ? CN_NUM[9 - f] : String(f + 1));
    const stepNum = (n) => (color === RED ? CN_NUM[n] : String(n));
    const forward = color === RED ? tr > fr : tr < fr;

    // 前/后 消歧：同一纵线上有同名同色棋子
    let prefix = '';
    const same = [];
    for (let r = 0; r < 10; r++) if (b[sq(ff, r)] === p) same.push(r);
    if (same.length >= 2 && u !== 'K') {
      // 按“前”为靠近对方一侧排序
      const ordered = color === RED ? same.slice().sort((a, c) => c - a) : same.slice().sort((a, c) => a - c);
      const idx = ordered.indexOf(fr);
      if (ordered.length === 2) prefix = idx === 0 ? '前' : '后';
      else if (ordered.length === 3) prefix = ['前', '中', '后'][idx];
      else prefix = CN_NUM[idx + 1] || String(idx + 1);
    }
    const head = prefix ? prefix + name : name + fileNum(ff);

    let tail;
    if (tr === fr) tail = '平' + fileNum(tf);
    else if (u === 'A' || u === 'B' || u === 'N') tail = (forward ? '进' : '退') + fileNum(tf);
    else tail = (forward ? '进' : '退') + stepNum(Math.abs(tr - fr));
    return head + tail;
  }

  // ---------- 调试 ----------
  perft(depth) {
    if (depth === 0) return 1;
    let n = 0;
    for (const [from, to] of this.legalMoves()) {
      if (depth === 1) { n++; continue; }
      const piece = this.board[from], captured = this.board[to];
      this.board[to] = piece; this.board[from] = null; this.turn = opposite(this.turn);
      n += this.perft(depth - 1);
      this.turn = opposite(this.turn); this.board[from] = piece; this.board[to] = captured;
    }
    return n;
  }

  ascii() {
    let s = '';
    for (let r = 9; r >= 0; r--) {
      s += r + ' ';
      for (let f = 0; f < 9; f++) s += (this.board[sq(f, r)] || '.') + ' ';
      s += '\n';
    }
    return s + '  a b c d e f g h i';
  }
}

export default Position;
