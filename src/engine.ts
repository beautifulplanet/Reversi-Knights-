// ── Constants ──

const DR = [-1, -1, -1, 0, 0, 1, 1, 1];
const DC = [-1, 0, 1, -1, 1, -1, 0, 1];

const POS_WEIGHTS = [
  100, -20,  10,   5,   5,  10, -20, 100,
  -20, -50,  -2,  -2,  -2,  -2, -50, -20,
   10,  -2,   1,   0,   0,   1,  -2,  10,
    5,  -2,   0,   0,   0,   0,  -2,   5,
    5,  -2,   0,   0,   0,   0,  -2,   5,
   10,  -2,   1,   0,   0,   1,  -2,  10,
  -20, -50,  -2,  -2,  -2,  -2, -50, -20,
  100, -20,  10,   5,   5,  10, -20, 100,
];

const CORNERS = [0, 7, 56, 63];
const X_SQ = [9, 14, 49, 54];
const X_CORNER = [0, 7, 56, 63];
const C_SQ = [1, 8, 6, 15, 48, 57, 55, 62];
const C_CORNER = [0, 0, 7, 7, 56, 56, 63, 63];

// ── Pre-allocated Buffers (module scope, zero allocation in AI hot path) ──

const _moveBufs: Int8Array[] = [];
const _moveCounts: number[] = [];
for (let d = 0; d < 20; d++) {
  _moveBufs.push(new Int8Array(64));
  _moveCounts.push(0);
}

const _boardStack: number[][] = [];
for (let d = 0; d < 20; d++) _boardStack.push(new Array(64).fill(0));

let _nodeCount = 0;
const MAX_NODES = 50000;

// ── Move ordering arrays (for fillMoves corner/edge/interior sorting) ──

const _corners = [0, 7, 56, 63];
const _edges: number[] = [];
const _interior: number[] = [];
for (let i = 0; i < 64; i++) {
  if (_corners.includes(i)) continue;
  const r = Math.floor(i / 8), c = i % 8;
  if (r === 0 || r === 7 || c === 0 || c === 7) _edges.push(i);
  else _interior.push(i);
}
const _moveOrder = [..._corners, ..._edges, ..._interior];

// ── Helpers ──

function initialBoard(): number[] {
  const b = new Array(64).fill(0);
  b[27] = 2; b[28] = 1; b[35] = 1; b[36] = 2;
  return b;
}

function countDiscs(board: number[], color: number): number {
  let c = 0;
  for (let i = 0; i < 64; i++) if (board[i] === color) c++;
  return c;
}

// ── Zero-allocation core (used in AI hot path) ──

function hasFlips(board: number[], pos: number, color: number): boolean {
  if (board[pos] !== 0) return false;
  const opp = 3 - color;
  const r0 = Math.floor(pos / 8), c0 = pos % 8;
  for (let d = 0; d < 8; d++) {
    let r = r0 + DR[d], c = c0 + DC[d];
    let found = false;
    while (r >= 0 && r < 8 && c >= 0 && c < 8) {
      const idx = r * 8 + c;
      if (board[idx] === opp) { found = true; }
      else if (board[idx] === color) { if (found) return true; break; }
      else break;
      r += DR[d]; c += DC[d];
    }
  }
  return false;
}

function applyMoveInPlace(board: number[], pos: number, color: number): void {
  board[pos] = color;
  const opp = 3 - color;
  const r0 = Math.floor(pos / 8), c0 = pos % 8;
  for (let d = 0; d < 8; d++) {
    let r = r0 + DR[d], c = c0 + DC[d];
    let count = 0;
    while (r >= 0 && r < 8 && c >= 0 && c < 8) {
      const idx = r * 8 + c;
      if (board[idx] === opp) { count++; }
      else if (board[idx] === color) {
        // Flip all opponent discs in this direction
        let fr = r0 + DR[d], fc = c0 + DC[d];
        for (let k = 0; k < count; k++) {
          board[fr * 8 + fc] = color;
          fr += DR[d]; fc += DC[d];
        }
        break;
      }
      else break;
      r += DR[d]; c += DC[d];
    }
  }
}

function fillMoves(board: number[], color: number, depth: number): number {
  const buf = _moveBufs[depth];
  let count = 0;
  for (let i = 0; i < _moveOrder.length; i++) {
    const pos = _moveOrder[i];
    if (hasFlips(board, pos, color)) {
      buf[count++] = pos;
    }
  }
  return count;
}

function hasMoves(board: number[], color: number): boolean {
  for (let i = 0; i < 64; i++) {
    if (hasFlips(board, i, color)) return true;
  }
  return false;
}

function evaluate(board: number[], aiColor: number): number {
  const opp = 3 - aiColor;
  let aiDiscs = 0, oppDiscs = 0;
  let posScore = 0;

  for (let i = 0; i < 64; i++) {
    if (board[i] === aiColor) {
      aiDiscs++;
      posScore += POS_WEIGHTS[i];
    } else if (board[i] === opp) {
      oppDiscs++;
      posScore -= POS_WEIGHTS[i];
    }
  }

  const total = aiDiscs + oppDiscs;

  // Terminal position: pure disc count
  if (total === 64 || (!hasMoves(board, aiColor) && !hasMoves(board, opp))) {
    return (aiDiscs - oppDiscs) * 1000;
  }

  // Phase: early (< 20 discs), mid (20-50), late (> 50)
  let score = 0;

  if (total < 20) {
    // Early game: position weight dominant, minimize own discs
    score = posScore * 3 + (oppDiscs - aiDiscs) * 2;
  } else if (total < 50) {
    // Mid game: position + corners
    score = posScore * 2;
  } else {
    // Late game: disc count dominant
    score = (aiDiscs - oppDiscs) * 5 + posScore;
  }

  // Corner bonus
  for (let ci = 0; ci < 4; ci++) {
    const corner = CORNERS[ci];
    if (board[corner] === aiColor) score += 50;
    else if (board[corner] === opp) score -= 50;
  }

  // X-square penalty (only if corner is empty)
  for (let xi = 0; xi < 4; xi++) {
    if (board[X_CORNER[xi]] === 0) {
      if (board[X_SQ[xi]] === aiColor) score -= 30;
      else if (board[X_SQ[xi]] === opp) score += 30;
    }
  }

  // C-square penalty (only if corner is empty)
  for (let ci = 0; ci < 8; ci++) {
    if (board[C_CORNER[ci]] === 0) {
      if (board[C_SQ[ci]] === aiColor) score -= 15;
      else if (board[C_SQ[ci]] === opp) score += 15;
    }
  }

  return score;
}

// ── Allocating functions (UI only, NEVER called in minimax) ──

function getFlips(board: number[], pos: number, color: number): number[] {
  const flips: number[] = [];
  if (board[pos] !== 0) return flips;
  const opp = 3 - color;
  const r0 = Math.floor(pos / 8), c0 = pos % 8;
  for (let d = 0; d < 8; d++) {
    const dirFlips: number[] = [];
    let r = r0 + DR[d], c = c0 + DC[d];
    while (r >= 0 && r < 8 && c >= 0 && c < 8) {
      const idx = r * 8 + c;
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

function getLegalMoves(board: number[], color: number): number[] {
  const moves: number[] = [];
  for (let i = 0; i < 64; i++) {
    if (hasFlips(board, i, color)) moves.push(i);
  }
  return moves;
}

// ── Minimax (exact per spec) ──

function minimax(
  board: number[], depth: number, alpha: number, beta: number,
  maximizing: boolean, aiColor: number, ply: number
): number {
  _nodeCount++;
  if (_nodeCount > MAX_NODES || depth === 0) return evaluate(board, aiColor);

  const current = maximizing ? aiColor : 3 - aiColor;
  const moveCount = fillMoves(board, current, ply);

  if (moveCount === 0) {
    if (!hasMoves(board, 3 - current)) {
      return evaluate(board, aiColor);
    }
    return minimax(board, depth - 1, alpha, beta, !maximizing, aiColor, ply);
  }

  const buf = _moveBufs[ply];
  const child = _boardStack[ply];

  if (maximizing) {
    let best = -999999;
    for (let i = 0; i < moveCount; i++) {
      if (_nodeCount > MAX_NODES) break;
      for (let j = 0; j < 64; j++) child[j] = board[j];
      applyMoveInPlace(child, buf[i], current);
      const val = minimax(child, depth - 1, alpha, beta, false, aiColor, ply + 1);
      if (val > best) best = val;
      if (val > alpha) alpha = val;
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = 999999;
    for (let i = 0; i < moveCount; i++) {
      if (_nodeCount > MAX_NODES) break;
      for (let j = 0; j < 64; j++) child[j] = board[j];
      applyMoveInPlace(child, buf[i], current);
      const val = minimax(child, depth - 1, alpha, beta, true, aiColor, ply + 1);
      if (val < best) best = val;
      if (val < beta) beta = val;
      if (beta <= alpha) break;
    }
    return best;
  }
}

// ── bestMove (root search with alpha narrowing) ──

function bestMove(board: number[], color: number, depthLimit: number): number {
  const moves = getLegalMoves(board, color);
  if (moves.length === 0) return -1;
  if (moves.length === 1) return moves[0];

  moves.sort((a, b) => POS_WEIGHTS[b] - POS_WEIGHTS[a]);

  let best = moves[0];
  let bestScore = -999999;
  let alpha = -999999;
  _nodeCount = 0;

  for (const pos of moves) {
    if (_nodeCount > MAX_NODES) break;
    const next = board.slice();
    applyMoveInPlace(next, pos, color);
    const score = minimax(next, depthLimit - 1, alpha, 999999, false, color, 1);
    if (score > bestScore) { bestScore = score; best = pos; }
    if (score > alpha) alpha = score;
  }
  return best;
}

// ── Game Class (exact API per spec) ──

export class Game {
  private board: number[];
  private turn: number;   // 1 = Black, 2 = White
  private over: boolean;

  constructor() {
    this.board = initialBoard();
    this.turn = 1;
    this.over = false;
  }

  get_board(): number[]     { return this.board.slice(); }
  get_legal_moves(): number[] { return getLegalMoves(this.board, this.turn); }
  current_turn(): number    { return this.turn; }
  is_game_over(): boolean   { return this.over; }
  black_count(): number     { return countDiscs(this.board, 1); }
  white_count(): number     { return countDiscs(this.board, 2); }

  make_move(pos: number): boolean {
    if (this.over || pos < 0 || pos >= 64) return false;
    if (!hasFlips(this.board, pos, this.turn)) return false;
    applyMoveInPlace(this.board, pos, this.turn);
    this.advanceTurn();
    return true;
  }

  get_flips(pos: number): number[] {
    return getFlips(this.board, pos, this.turn);
  }

  ai_move(depth: number): number {
    if (this.over) return -1;
    depth = Math.min(6, Math.max(1, depth));
    const pos = bestMove(this.board, this.turn, depth);
    if (pos < 0) {
      this.advanceTurn();
      return -1;
    }
    applyMoveInPlace(this.board, pos, this.turn);
    this.advanceTurn();
    return pos;
  }

  reset(): void {
    this.board = initialBoard();
    this.turn = 1;
    this.over = false;
  }

  private advanceTurn(): void {
    const next = 3 - this.turn;
    if (hasMoves(this.board, next)) {
      this.turn = next;
    } else if (hasMoves(this.board, this.turn)) {
      // opponent has no moves — current player goes again (pass)
    } else {
      this.over = true;
    }
  }
}
