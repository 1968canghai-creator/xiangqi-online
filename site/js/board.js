// board.js — SVG 棋盘渲染与点击交互（无依赖）
import { sq, fileOf, rankOf, PIECE_NAMES, colorOf, RED } from './xiangqi.js';

const NS = 'http://www.w3.org/2000/svg';
const CELL = 100, ORIGIN = 100; // viewBox 0 0 1000 1100

export class BoardView {
  constructor(svg, { onSquareClick } = {}) {
    this.svg = svg;
    this.flipped = false;
    this.onSquareClick = onSquareClick;
    svg.setAttribute('viewBox', '0 0 1000 1100');
    svg.innerHTML = '';
    this.gBoard = this._g('board');
    this.gMarks = this._g('marks');
    this.gPieces = this._g('pieces');
    this.gHits = this._g('hits');
    this._drawBoard();
    this._drawHitAreas();
  }

  _g(cls) { const g = document.createElementNS(NS, 'g'); g.setAttribute('class', cls); this.svg.appendChild(g); return g; }
  _el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    (parent || this.svg).appendChild(e);
    return e;
  }

  /** 棋盘坐标 -> 像素中心 */
  xy(s) {
    const f = fileOf(s), r = rankOf(s);
    const x = ORIGIN + (this.flipped ? 8 - f : f) * CELL;
    const y = ORIGIN + (this.flipped ? r : 9 - r) * CELL;
    return [x, y];
  }

  _drawBoard() {
    const g = this.gBoard;
    const line = (x1, y1, x2, y2, w = 3) => this._el('line', { x1, y1, x2, y2, class: 'grid', 'stroke-width': w }, g);
    this._el('rect', { x: 0, y: 0, width: 1000, height: 1100, class: 'bg' }, g);
    this._el('rect', { x: ORIGIN - 12, y: ORIGIN - 12, width: 8 * CELL + 24, height: 9 * CELL + 24, class: 'frame' }, g);
    // 横线
    for (let i = 0; i < 10; i++) line(ORIGIN, ORIGIN + i * CELL, ORIGIN + 8 * CELL, ORIGIN + i * CELL, i === 0 || i === 9 ? 5 : 3);
    // 竖线（中间断开为河）
    for (let i = 0; i < 9; i++) {
      if (i === 0 || i === 8) line(ORIGIN + i * CELL, ORIGIN, ORIGIN + i * CELL, ORIGIN + 9 * CELL, 5);
      else {
        line(ORIGIN + i * CELL, ORIGIN, ORIGIN + i * CELL, ORIGIN + 4 * CELL);
        line(ORIGIN + i * CELL, ORIGIN + 5 * CELL, ORIGIN + i * CELL, ORIGIN + 9 * CELL);
      }
    }
    // 九宫
    for (const top of [0, 7]) {
      line(ORIGIN + 3 * CELL, ORIGIN + top * CELL, ORIGIN + 5 * CELL, ORIGIN + (top + 2) * CELL);
      line(ORIGIN + 5 * CELL, ORIGIN + top * CELL, ORIGIN + 3 * CELL, ORIGIN + (top + 2) * CELL);
    }
    // 炮位 / 兵位 标记
    const marks = ['b2', 'h2', 'b7', 'h7', 'a3', 'c3', 'e3', 'g3', 'i3', 'a6', 'c6', 'e6', 'g6', 'i6'];
    for (const name of marks) {
      const f = 'abcdefghi'.indexOf(name[0]), r = Number(name[1]);
      const x = ORIGIN + f * CELL, y = ORIGIN + (9 - r) * CELL;
      const d = 8, l = 22;
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        if ((f === 0 && sx < 0) || (f === 8 && sx > 0)) continue;
        this._el('path', { d: `M${x + sx * d} ${y + sy * (d + l)} V${y + sy * d} H${x + sx * (d + l)}`, class: 'mark' }, g);
      }
    }
    // 河界文字
    const t1 = this._el('text', { x: ORIGIN + 2 * CELL, y: ORIGIN + 4.5 * CELL, class: 'river' }, g); t1.textContent = '楚 河';
    const t2 = this._el('text', { x: ORIGIN + 6 * CELL, y: ORIGIN + 4.5 * CELL, class: 'river' }, g); t2.textContent = '漢 界';
    // 坐标（红方视角：下方 一..九，上方 1..9）
    this.coordTop = []; this.coordBottom = [];
    const cn = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
    for (let i = 0; i < 9; i++) {
      const b = this._el('text', { x: ORIGIN + i * CELL, y: ORIGIN + 9 * CELL + 60, class: 'coord' }, g);
      const t = this._el('text', { x: ORIGIN + i * CELL, y: ORIGIN - 40, class: 'coord' }, g);
      this.coordBottom.push(b); this.coordTop.push(t);
    }
    this._updateCoords(cn);
  }

  _updateCoords() {
    const cn = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
    for (let i = 0; i < 9; i++) {
      // 底边是靠近观者的一方：红在下时底边为红方纵线号（右到左 一..九），顶边为黑方 1..9（左到右）
      this.coordBottom[i].textContent = this.flipped ? String(9 - i) : cn[8 - i];
      this.coordTop[i].textContent = this.flipped ? cn[i] : String(i + 1);
    }
  }

  _drawHitAreas() {
    this.hits = [];
    for (let s = 0; s < 90; s++) {
      const c = this._el('circle', { r: 48, class: 'hit', 'data-sq': s }, this.gHits);
      c.addEventListener('click', (e) => { e.preventDefault(); this.onSquareClick && this.onSquareClick(s); });
      this.hits.push(c);
    }
    this._placeHits();
  }
  _placeHits() {
    for (let s = 0; s < 90; s++) { const [x, y] = this.xy(s); this.hits[s].setAttribute('cx', x); this.hits[s].setAttribute('cy', y); }
  }

  setFlipped(flag) {
    this.flipped = !!flag;
    this._updateCoords();
    this._placeHits();
  }

  /**
   * @param {Position} pos
   * @param {object} o { selected, targets: number[], lastMove: {from,to}, checkSq, animate: {from,to} }
   */
  render(pos, { selected = -1, targets = [], lastMove = null, checkSq = -1 } = {}) {
    const gm = this.gMarks, gp = this.gPieces;
    gm.innerHTML = ''; gp.innerHTML = '';
    if (lastMove) {
      for (const s of [lastMove.from, lastMove.to]) {
        const [x, y] = this.xy(s);
        this._el('rect', { x: x - 46, y: y - 46, width: 92, height: 92, rx: 10, class: 'last' }, gm);
      }
    }
    if (selected >= 0) {
      const [x, y] = this.xy(selected);
      this._el('rect', { x: x - 48, y: y - 48, width: 96, height: 96, rx: 12, class: 'selected' }, gm);
    }
    const tset = new Set(targets);
    for (let s = 0; s < 90; s++) {
      const p = pos.board[s];
      const [x, y] = this.xy(s);
      if (p) {
        const g = this._el('g', { class: `piece ${colorOf(p) === RED ? 'red' : 'black'}${s === checkSq ? ' check' : ''}`, transform: `translate(${x} ${y})` }, gp);
        this._el('circle', { r: 44, class: 'disc' }, g);
        this._el('circle', { r: 37, class: 'ring' }, g);
        const t = this._el('text', { x: 0, y: 0, class: 'glyph' }, g);
        t.textContent = PIECE_NAMES[p];
        if (tset.has(s)) this._el('circle', { r: 50, class: 'target capture' }, g);
      } else if (tset.has(s)) {
        this._el('circle', { cx: x, cy: y, r: 14, class: 'target' }, gm);
      }
    }
  }
}

export default BoardView;
