// ── Constants ──

const DR = [-1, -1, -1, 0, 0, 1, 1, 1];
const DC = [-1, 0, 1, -1, 1, -1, 0, 1];

// Knight L-shape offsets (chess knight moves)
const KNIGHT_DR = [-2, -2, -1, -1, 1, 1, 2, 2];
const KNIGHT_DC = [-1, 1, -2, 2, -2, 2, -1, 1];

const MAX_CELLS = 256; // 16x16 max

// ── Per-size caches (generated once per size) ──

interface SizeData {
  size: number;
  cells: number;
  posWeights: number[];
  corners: number[];
  xSq: number[];
  xCorner: number[];
  cSq: number[];
  cCorner: number[];
  moveOrder: number[];
}

const _sizeCache = new Map<number, SizeData>();

function getSizeData(size: number): SizeData {
  let d = _sizeCache.get(size);
  if (d) return d;

  const cells = size * size;
  const S = size - 1;

  // Corners
  const corners = [0, S, S * size, S * size + S];

  // X-squares (diagonally adjacent to corners)
  const xSq = [size + 1, size + S - 1, (S - 1) * size + 1, (S - 1) * size + S - 1];
  const xCorner = [corners[0], corners[1], corners[2], corners[3]];

  // C-squares (orthogonally adjacent to corners)
  const cSq = [1, size, S - 1, size + S, (S - 1) * size, S * size + 1, S * size + S - 1, (S - 1) * size + S];
  const cCorner = [corners[0], corners[0], corners[1], corners[1], corners[2], corners[2], corners[3], corners[3]];

  // Position weights — mirror-symmetric, corners high, X-squares low
  const posWeights = new Array(cells).fill(0);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const mr = Math.min(r, S - r);
      const mc = Math.min(c, S - c);
      let w = 0;
      if (mr === 0 && mc === 0) w = 100;        // corner
      else if (mr <= 1 && mc <= 1) w = mr === 1 && mc === 1 ? -50 : -20; // X/C squares
      else if (mr === 0 || mc === 0) w = 10;      // edge
      else if (mr === 1 || mc === 1) w = -2;      // near edge
      else w = 0;
      posWeights[r * size + c] = w;
    }
  }

  // Move ordering: corners, edges, interior
  const edgeSet: number[] = [];
  const interiorSet: number[] = [];
  for (let i = 0; i < cells; i++) {
    if (corners.includes(i)) continue;
    const r = Math.floor(i / size), c = i % size;
    if (r === 0 || r === S || c === 0 || c === S) edgeSet.push(i);
    else interiorSet.push(i);
  }
  const moveOrder = [...corners, ...edgeSet, ...interiorSet];

  d = { size, cells, posWeights, corners, xSq, xCorner, cSq, cCorner, moveOrder };
  _sizeCache.set(size, d);
  return d;
}

// ── Pre-allocated Buffers (module scope, zero allocation in AI hot path) ──

const _moveBufs: Int16Array[] = [];
const _moveCounts: number[] = [];
for (let d = 0; d < 20; d++) {
  _moveBufs.push(new Int16Array(MAX_CELLS));
  _moveCounts.push(0);
}

const _boardStack: number[][] = [];
for (let d = 0; d < 20; d++) _boardStack.push(new Array(MAX_CELLS).fill(0));

let _nodeCount = 0;
const MAX_NODES = 50000;

// ── Helpers ──

function initialBoard(size: number): number[] {
  const cells = size * size;
  const b = new Array(cells).fill(0);
  const mid = size / 2;
  b[(mid - 1) * size + (mid - 1)] = 2;
  b[(mid - 1) * size + mid] = 1;
  b[mid * size + (mid - 1)] = 1;
  b[mid * size + mid] = 2;
  return b;
}

function countDiscs(board: number[], color: number, cells: number): number {
  let c = 0;
  for (let i = 0; i < cells; i++) if (board[i] === color) c++;
  return c;
}

// ── Zero-allocation core (used in AI hot path) ──

function hasFlips(board: number[], pos: number, color: number, size: number): boolean {
  if (board[pos] !== 0) return false;
  const opp = 3 - color;
  const r0 = Math.floor(pos / size), c0 = pos % size;
  for (let d = 0; d < 8; d++) {
    let r = r0 + DR[d], c = c0 + DC[d];
    let found = false;
    while (r >= 0 && r < size && c >= 0 && c < size) {
      const idx = r * size + c;
      if (board[idx] === opp) { found = true; }
      else if (board[idx] === color) { if (found) return true; break; }
      else break;
      r += DR[d]; c += DC[d];
    }
  }
  return false;
}

function applyMoveInPlace(board: number[], pos: number, color: number, size: number): void {
  board[pos] = color;
  const opp = 3 - color;
  const r0 = Math.floor(pos / size), c0 = pos % size;
  for (let d = 0; d < 8; d++) {
    let r = r0 + DR[d], c = c0 + DC[d];
    let count = 0;
    while (r >= 0 && r < size && c >= 0 && c < size) {
      const idx = r * size + c;
      if (board[idx] === opp) { count++; }
      else if (board[idx] === color) {
        let fr = r0 + DR[d], fc = c0 + DC[d];
        for (let k = 0; k < count; k++) {
          board[fr * size + fc] = color;
          fr += DR[d]; fc += DC[d];
        }
        break;
      }
      else break;
      r += DR[d]; c += DC[d];
    }
  }
}

function fillMoves(board: number[], color: number, depth: number, sd: SizeData): number {
  const buf = _moveBufs[depth];
  let count = 0;
  for (let i = 0; i < sd.moveOrder.length; i++) {
    const pos = sd.moveOrder[i];
    if (hasFlips(board, pos, color, sd.size)) {
      buf[count++] = pos;
    }
  }
  return count;
}

function hasMoves(board: number[], color: number, size: number): boolean {
  const cells = size * size;
  for (let i = 0; i < cells; i++) {
    if (hasFlips(board, i, color, size)) return true;
  }
  return false;
}

function evaluate(board: number[], aiColor: number, sd: SizeData): number {
  const opp = 3 - aiColor;
  const { size, cells } = sd;
  let aiDiscs = 0, oppDiscs = 0;
  let posScore = 0;

  for (let i = 0; i < cells; i++) {
    if (board[i] === aiColor) {
      aiDiscs++;
      posScore += sd.posWeights[i];
    } else if (board[i] === opp) {
      oppDiscs++;
      posScore -= sd.posWeights[i];
    }
  }

  const total = aiDiscs + oppDiscs;

  // Terminal position: pure disc count
  if (total === cells || (!hasMoves(board, aiColor, size) && !hasMoves(board, opp, size))) {
    return (aiDiscs - oppDiscs) * 1000;
  }

  // Phase thresholds scaled by board size
  const earlyThresh = Math.floor(cells * 0.3);
  const lateThresh = Math.floor(cells * 0.75);

  let score = 0;
  if (total < earlyThresh) {
    score = posScore * 3 + (oppDiscs - aiDiscs) * 2;
  } else if (total < lateThresh) {
    score = posScore * 2;
  } else {
    score = (aiDiscs - oppDiscs) * 5 + posScore;
  }

  // Corner bonus
  for (let ci = 0; ci < 4; ci++) {
    const corner = sd.corners[ci];
    if (board[corner] === aiColor) score += 50;
    else if (board[corner] === opp) score -= 50;
  }

  // X-square penalty (only if corner is empty)
  for (let xi = 0; xi < 4; xi++) {
    if (board[sd.xCorner[xi]] === 0) {
      if (board[sd.xSq[xi]] === aiColor) score -= 30;
      else if (board[sd.xSq[xi]] === opp) score += 30;
    }
  }

  // C-square penalty (only if corner is empty)
  for (let ci = 0; ci < 8; ci++) {
    if (board[sd.cCorner[ci]] === 0) {
      if (board[sd.cSq[ci]] === aiColor) score -= 15;
      else if (board[sd.cSq[ci]] === opp) score += 15;
    }
  }

  return score;
}

// ── Allocating functions (UI only, NEVER called in minimax) ──

function getFlips(board: number[], pos: number, color: number, size: number): number[] {
  const flips: number[] = [];
  if (board[pos] !== 0) return flips;
  const opp = 3 - color;
  const r0 = Math.floor(pos / size), c0 = pos % size;
  for (let d = 0; d < 8; d++) {
    const dirFlips: number[] = [];
    let r = r0 + DR[d], c = c0 + DC[d];
    while (r >= 0 && r < size && c >= 0 && c < size) {
      const idx = r * size + c;
      if (board[idx] === opp) { dirFlips.push(idx); }
      else if (board[idx] === color) {
        for (const f of dirFlips) flips.push(f);
        break;
      }
      else break;
      r += DR[d]; c += DC[d];
    }
  }
  return flips;
}

function getLegalMoves(board: number[], color: number, size: number): number[] {
  const moves: number[] = [];
  const cells = size * size;
  for (let i = 0; i < cells; i++) {
    if (hasFlips(board, i, color, size)) moves.push(i);
  }
  return moves;
}

// ── Minimax ──

function minimax(
  board: number[], depth: number, alpha: number, beta: number,
  maximizing: boolean, aiColor: number, ply: number, sd: SizeData
): number {
  _nodeCount++;
  if (_nodeCount > MAX_NODES || depth === 0) return evaluate(board, aiColor, sd);

  const current = maximizing ? aiColor : 3 - aiColor;
  const moveCount = fillMoves(board, current, ply, sd);

  if (moveCount === 0) {
    if (!hasMoves(board, 3 - current, sd.size)) {
      return evaluate(board, aiColor, sd);
    }
    return minimax(board, depth - 1, alpha, beta, !maximizing, aiColor, ply, sd);
  }

  const buf = _moveBufs[ply];
  const child = _boardStack[ply];

  if (maximizing) {
    let best = -999999;
    for (let i = 0; i < moveCount; i++) {
      if (_nodeCount > MAX_NODES) break;
      for (let j = 0; j < sd.cells; j++) child[j] = board[j];
      applyMoveInPlace(child, buf[i], current, sd.size);
      const val = minimax(child, depth - 1, alpha, beta, false, aiColor, ply + 1, sd);
      if (val > best) best = val;
      if (val > alpha) alpha = val;
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = 999999;
    for (let i = 0; i < moveCount; i++) {
      if (_nodeCount > MAX_NODES) break;
      for (let j = 0; j < sd.cells; j++) child[j] = board[j];
      applyMoveInPlace(child, buf[i], current, sd.size);
      const val = minimax(child, depth - 1, alpha, beta, true, aiColor, ply + 1, sd);
      if (val < best) best = val;
      if (val < beta) beta = val;
      if (beta <= alpha) break;
    }
    return best;
  }
}

// ── bestMove (root search with alpha narrowing) ──

function bestMove(board: number[], color: number, depthLimit: number, sd: SizeData): number {
  const moves = getLegalMoves(board, color, sd.size);
  if (moves.length === 0) return -1;
  if (moves.length === 1) return moves[0];

  moves.sort((a, b) => sd.posWeights[b] - sd.posWeights[a]);

  let best = moves[0];
  let bestScore = -999999;
  let alpha = -999999;
  _nodeCount = 0;

  for (const pos of moves) {
    if (_nodeCount > MAX_NODES) break;
    const next = board.slice(0, sd.cells);
    applyMoveInPlace(next, pos, color, sd.size);
    const score = minimax(next, depthLimit - 1, alpha, 999999, false, color, 1, sd);
    if (score > bestScore) { bestScore = score; best = pos; }
    if (score > alpha) alpha = score;
  }
  return best;
}

// ── Knight functions ──

function getKnightFlips(board: number[], pos: number, color: number, size: number): number[] {
  const flips: number[] = [];
  if (board[pos] !== 0) return flips;
  const opp = 3 - color;
  const r0 = Math.floor(pos / size), c0 = pos % size;
  for (let k = 0; k < 8; k++) {
    const r = r0 + KNIGHT_DR[k], c = c0 + KNIGHT_DC[k];
    if (r >= 0 && r < size && c >= 0 && c < size) {
      const idx = r * size + c;
      if (board[idx] === opp) flips.push(idx);
    }
  }
  return flips;
}

function applyKnightInPlace(board: number[], pos: number, color: number, size: number): void {
  board[pos] = color;
  const opp = 3 - color;
  const r0 = Math.floor(pos / size), c0 = pos % size;
  for (let k = 0; k < 8; k++) {
    const r = r0 + KNIGHT_DR[k], c = c0 + KNIGHT_DC[k];
    if (r >= 0 && r < size && c >= 0 && c < size) {
      const idx = r * size + c;
      if (board[idx] === opp) board[idx] = color;
    }
  }
}

// ── Game Class ──

export class Game {
  private board: number[];
  private turn: number;   // 1 = Black, 2 = White
  private over: boolean;
  private sd: SizeData;
  private history: { board: number[]; turn: number; over: boolean; knightUsed: [boolean, boolean] }[];
  private knightUsed: [boolean, boolean]; // [black, white]
  readonly size: number;

  constructor(size: number = 8) {
    if (size < 4 || size % 2 !== 0 || size > 16) throw new Error('Size must be even, 4-16');
    this.size = size;
    this.sd = getSizeData(size);
    this.board = initialBoard(size);
    this.turn = 1;
    this.over = false;
    this.history = [];
    this.knightUsed = [false, false];
  }

  private snapshot(): void {
    this.history.push({
      board: this.board.slice(0, this.sd.cells),
      turn: this.turn,
      over: this.over,
      knightUsed: [this.knightUsed[0], this.knightUsed[1]],
    });
  }

  get_board(): number[]     { return this.board.slice(0, this.sd.cells); }
  get_legal_moves(): number[] { return getLegalMoves(this.board, this.turn, this.size); }
  current_turn(): number    { return this.turn; }
  is_game_over(): boolean   { return this.over; }
  black_count(): number     { return countDiscs(this.board, 1, this.sd.cells); }
  white_count(): number     { return countDiscs(this.board, 2, this.sd.cells); }

  make_move(pos: number): boolean {
    if (this.over || pos < 0 || pos >= this.sd.cells) return false;
    if (!hasFlips(this.board, pos, this.turn, this.size)) return false;
    this.snapshot();
    applyMoveInPlace(this.board, pos, this.turn, this.size);
    this.advanceTurn();
    return true;
  }

  get_flips(pos: number): number[] {
    return getFlips(this.board, pos, this.turn, this.size);
  }

  ai_move(depth: number): number {
    if (this.over) return -1;
    depth = Math.min(6, Math.max(1, depth));

    // Normal move search
    const pos = bestMove(this.board, this.turn, depth, this.sd);

    // Consider knight if available
    let knightPos = -1;
    let knightScore = -999999;
    if (!this.knightUsed[this.turn - 1]) {
      const cells = this.sd.cells;
      for (let i = 0; i < cells; i++) {
        if (this.board[i] !== 0) continue;
        const flips = getKnightFlips(this.board, i, this.turn, this.size);
        if (flips.length >= 3) { // Only consider if flipping 3+ pieces
          const testBoard = this.board.slice(0, cells);
          applyKnightInPlace(testBoard, i, this.turn, this.size);
          const score = evaluate(testBoard, this.turn, this.sd);
          if (score > knightScore) { knightScore = score; knightPos = i; }
        }
      }
    }

    // Compare knight vs normal move
    if (knightPos >= 0 && pos >= 0) {
      const normalBoard = this.board.slice(0, this.sd.cells);
      applyMoveInPlace(normalBoard, pos, this.turn, this.size);
      const normalScore = evaluate(normalBoard, this.turn, this.sd);
      if (knightScore > normalScore + 20) { // Knight must be significantly better
        this.snapshot();
        applyKnightInPlace(this.board, knightPos, this.turn, this.size);
        this.knightUsed[this.turn - 1] = true;
        this.advanceTurn();
        return knightPos;
      }
    } else if (knightPos >= 0 && pos < 0) {
      // No normal moves but knight available
      this.snapshot();
      applyKnightInPlace(this.board, knightPos, this.turn, this.size);
      this.knightUsed[this.turn - 1] = true;
      this.advanceTurn();
      return knightPos;
    }

    if (pos < 0) {
      this.snapshot();
      this.advanceTurn();
      return -1;
    }
    this.snapshot();
    applyMoveInPlace(this.board, pos, this.turn, this.size);
    this.advanceTurn();
    return pos;
  }

  reset(): void {
    this.board = initialBoard(this.size);
    this.turn = 1;
    this.over = false;
    this.history = [];
    this.knightUsed = [false, false];
  }

  can_undo(): boolean {
    return this.history.length > 0;
  }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.board = prev.board;
    this.turn = prev.turn;
    this.over = prev.over;
    this.knightUsed = prev.knightUsed;
    return true;
  }

  // ── Knight methods ──

  knight_available(player?: number): boolean {
    const p = player ?? this.turn;
    return !this.knightUsed[p - 1];
  }

  get_knight_flips(pos: number): number[] {
    return getKnightFlips(this.board, pos, this.turn, this.size);
  }

  make_knight_move(pos: number): boolean {
    if (this.over || pos < 0 || pos >= this.sd.cells) return false;
    if (this.board[pos] !== 0) return false;
    if (this.knightUsed[this.turn - 1]) return false;
    this.snapshot();
    applyKnightInPlace(this.board, pos, this.turn, this.size);
    this.knightUsed[this.turn - 1] = true;
    this.advanceTurn();
    return true;
  }

  private advanceTurn(): void {
    const next = 3 - this.turn;
    if (hasMoves(this.board, next, this.size)) {
      this.turn = next;
    } else if (hasMoves(this.board, this.turn, this.size)) {
      // opponent has no moves — current player goes again (pass)
    } else {
      this.over = true;
    }
  }
}
