// ── Constants ──

const DR = [-1, -1, -1, 0, 0, 1, 1, 1];
const DC = [-1, 0, 1, -1, 1, -1, 0, 1];

// Knight L-shape offsets (chess knight moves)
const KNIGHT_DR = [-2, -2, -1, -1, 1, 1, 2, 2];
const KNIGHT_DC = [-1, 1, -2, 2, -2, 2, -1, 1];

const MAX_CELLS = 256; // 16x16 max
const MAX_DEPTH = 20;
const MAX_NODES = 50000;
const NEG_INF = -999999;
const POS_INF = 999999;
const TERMINAL_MULTIPLIER = 1000;
const CORNER_BONUS = 50;
const X_SQUARE_PENALTY = 30;
const C_SQUARE_PENALTY = 15;
const EARLY_PHASE_RATIO = 0.3;
const LATE_PHASE_RATIO = 0.75;
const MAX_AI_DEPTH = 6;

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

  // X-squares (diagonally adjacent to corners) — xCorner maps to which corner each X-square belongs to
  const xSq = [size + 1, size + S - 1, (S - 1) * size + 1, (S - 1) * size + S - 1];
  const xCorner = corners;

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
for (let d = 0; d < MAX_DEPTH; d++) {
  _moveBufs.push(new Int16Array(MAX_CELLS));
}

const _boardStack: number[][] = [];
for (let d = 0; d < MAX_DEPTH; d++) _boardStack.push(new Array(MAX_CELLS).fill(0));

let _nodeCount = 0;

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
  const knightVal = color + 2;
  let c = 0;
  for (let i = 0; i < cells; i++) if (board[i] === color || board[i] === knightVal) c++;
  return c;
}

// ── Zero-allocation core (used in AI hot path) ──

function hasFlips(board: number[], pos: number, color: number, size: number): boolean {
  if (board[pos] !== 0) return false;
  const opp = 3 - color;
  const friendly2 = color + 2; // knight cell value
  const r0 = Math.floor(pos / size), c0 = pos % size;
  for (let d = 0; d < 8; d++) {
    let r = r0 + DR[d], c = c0 + DC[d];
    let found = false;
    while (r >= 0 && r < size && c >= 0 && c < size) {
      const idx = r * size + c;
      if (board[idx] === opp) { found = true; }
      else if (board[idx] === color || board[idx] === friendly2) { if (found) return true; break; }
      else break;
      r += DR[d]; c += DC[d];
    }
  }
  return false;
}

function applyMoveInPlace(board: number[], pos: number, color: number, size: number): void {
  board[pos] = color;
  const opp = 3 - color;
  const friendly2 = color + 2; // knight cell value
  const r0 = Math.floor(pos / size), c0 = pos % size;
  for (let d = 0; d < 8; d++) {
    let r = r0 + DR[d], c = c0 + DC[d];
    let count = 0;
    while (r >= 0 && r < size && c >= 0 && c < size) {
      const idx = r * size + c;
      if (board[idx] === opp) { count++; }
      else if (board[idx] === color || board[idx] === friendly2) {
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

  const aiKnight = aiColor + 2;
  const oppKnight = opp + 2;
  for (let i = 0; i < cells; i++) {
    const v = board[i];
    if (v === aiColor || v === aiKnight) {
      aiDiscs++;
      posScore += sd.posWeights[i];
    } else if (v === opp || v === oppKnight) {
      oppDiscs++;
      posScore -= sd.posWeights[i];
    }
  }

  const total = aiDiscs + oppDiscs;

  // Terminal position: pure disc count
  if (total === cells || (!hasMoves(board, aiColor, size) && !hasMoves(board, opp, size))) {
    return (aiDiscs - oppDiscs) * TERMINAL_MULTIPLIER;
  }

  // Phase thresholds scaled by board size
  const earlyThresh = Math.floor(cells * EARLY_PHASE_RATIO);
  const lateThresh = Math.floor(cells * LATE_PHASE_RATIO);

  let score = 0;
  if (total < earlyThresh) {
    score = posScore * 3 + (oppDiscs - aiDiscs) * 2;
  } else if (total < lateThresh) {
    score = posScore * 2;
  } else {
    score = (aiDiscs - oppDiscs) * 5 + posScore;
  }

  // Corner bonus (check discs AND knights)
  for (let ci = 0; ci < 4; ci++) {
    const corner = sd.corners[ci];
    const cv = board[corner];
    if (cv === aiColor || cv === aiKnight) score += CORNER_BONUS;
    else if (cv === opp || cv === oppKnight) score -= CORNER_BONUS;
  }

  // X-square penalty (only if corner is empty — no disc OR knight)
  for (let xi = 0; xi < 4; xi++) {
    const cv = board[sd.xCorner[xi]];
    if (cv === 0) {
      const xv = board[sd.xSq[xi]];
      if (xv === aiColor || xv === aiKnight) score -= X_SQUARE_PENALTY;
      else if (xv === opp || xv === oppKnight) score += X_SQUARE_PENALTY;
    }
  }

  // C-square penalty (only if corner is empty — no disc OR knight)
  for (let ci = 0; ci < 8; ci++) {
    const cv = board[sd.cCorner[ci]];
    if (cv === 0) {
      const csq = board[sd.cSq[ci]];
      if (csq === aiColor || csq === aiKnight) score -= C_SQUARE_PENALTY;
      else if (csq === opp || csq === oppKnight) score += C_SQUARE_PENALTY;
    }
  }

  // Knight evaluation (chess-style: centralization + mobility)
  const aiKnightVal = aiColor + 2;
  const oppKnightVal = opp + 2;
  for (let i = 0; i < cells; i++) {
    if (board[i] === aiKnightVal) {
      // Centralization bonus: knight is stronger near the center
      const kr = Math.floor(i / size), kc = i % size;
      const centerDist = Math.abs(kr - size / 2 + 0.5) + Math.abs(kc - size / 2 + 0.5);
      score += Math.max(0, size - centerDist) * 2;
    } else if (board[i] === oppKnightVal) {
      const kr = Math.floor(i / size), kc = i % size;
      const centerDist = Math.abs(kr - size / 2 + 0.5) + Math.abs(kc - size / 2 + 0.5);
      score -= Math.max(0, size - centerDist) * 2;
    }
  }

  return score;
}

// ── Allocating functions (UI only, NEVER called in minimax) ──

function getFlips(board: number[], pos: number, color: number, size: number): number[] {
  const flips: number[] = [];
  if (board[pos] !== 0) return flips;
  const opp = 3 - color;
  const friendly2 = color + 2; // knight cell value
  const r0 = Math.floor(pos / size), c0 = pos % size;
  for (let d = 0; d < 8; d++) {
    const dirFlips: number[] = [];
    let r = r0 + DR[d], c = c0 + DC[d];
    while (r >= 0 && r < size && c >= 0 && c < size) {
      const idx = r * size + c;
      if (board[idx] === opp) { dirFlips.push(idx); }
      else if (board[idx] === color || board[idx] === friendly2) {
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
    let best = NEG_INF;
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
    let best = POS_INF;
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

// ── bestMove (root search with knight-integrated evaluation) ──
// Chess-hybrid: each disc move candidate is paired with its best knight
// follow-up before minimax evaluation, so the AI considers the FULL turn
// (disc + knight) as a unit — like a chess engine evaluating piece positions.

function bestMove(
  board: number[], color: number, depthLimit: number, sd: SizeData,
  knightPos?: [number, number]
): number {
  const moves = getLegalMoves(board, color, sd.size);
  if (moves.length === 0) return -1;
  if (moves.length === 1) return moves[0];

  moves.sort((a, b) => sd.posWeights[b] - sd.posWeights[a]);

  let best = moves[0];
  let bestScore = NEG_INF;
  let alpha = NEG_INF;
  _nodeCount = 0;

  const kp = knightPos ?? [-1, -1];
  const myKp = kp[color - 1];

  for (const pos of moves) {
    if (_nodeCount > MAX_NODES) break;
    const next = board.slice(0, sd.cells);
    applyMoveInPlace(next, pos, color, sd.size);

    // If we have a knight, simulate the best follow-up knight move on this board
    if (myKp >= 0) {
      const dests = getKnightDestinations(myKp, sd.size, next, color);
      if (dests.length > 0) {
        let bestKnightBoard: number[] | null = null;
        let bestKnightEval = NEG_INF;
        for (const kDest of dests) {
          const kBoard = next.slice();
          kBoard[myKp] = 0; // clear old knight position
          applyKnightLanding(kBoard, kDest, color, sd.size);
          const kEval = evaluate(kBoard, color, sd);
          if (kEval > bestKnightEval) {
            bestKnightEval = kEval;
            bestKnightBoard = kBoard;
          }
        }
        // Evaluate the combined (disc + knight) position
        if (bestKnightBoard) {
          const score = minimax(bestKnightBoard, depthLimit - 1, alpha, POS_INF, false, color, 1, sd);
          if (score > bestScore) { bestScore = score; best = pos; }
          if (score > alpha) alpha = score;
          continue;
        }
      }
    }

    // No knight available — evaluate disc move alone
    const score = minimax(next, depthLimit - 1, alpha, POS_INF, false, color, 1, sd);
    if (score > bestScore) { bestScore = score; best = pos; }
    if (score > alpha) alpha = score;
  }
  return best;
}

// ── Knight helpers ──
// Cell values: 0=empty, 1=black disc, 2=white disc, 3=black knight, 4=white knight

function knightCellValue(player: number): number { return player + 2; }

function getKnightDestinations(fromPos: number, size: number, board: number[], player?: number): number[] {
  const dests: number[] = [];
  const r0 = Math.floor(fromPos / size), c0 = fromPos % size;
  const oppKnight = player ? (3 - player) + 2 : -1; // opponent's knight value
  for (let k = 0; k < 8; k++) {
    const r = r0 + KNIGHT_DR[k], c = c0 + KNIGHT_DC[k];
    if (r >= 0 && r < size && c >= 0 && c < size) {
      const idx = r * size + c;
      // Can land on empty OR opponent's knight (capture)
      if (board[idx] === 0 || board[idx] === oppKnight) dests.push(idx);
    }
  }
  return dests;
}

function getKnightLandingFlips(board: number[], pos: number, color: number, size: number): number[] {
  // Same Reversi sandwich-flip logic as getFlips — trace lines in 8 directions
  const flips: number[] = [];
  if (board[pos] !== 0 && board[pos] !== 3 && board[pos] !== 4) return flips;
  const opp = 3 - color;
  const r0 = Math.floor(pos / size), c0 = pos % size;
  for (let d = 0; d < 8; d++) {
    const dirFlips: number[] = [];
    let r = r0 + DR[d], c = c0 + DC[d];
    while (r >= 0 && r < size && c >= 0 && c < size) {
      const idx = r * size + c;
      if (board[idx] === opp) { dirFlips.push(idx); }
      else if (board[idx] === color || board[idx] === color + 2) {
        for (const f of dirFlips) flips.push(f);
        break;
      }
      else break;
      r += DR[d]; c += DC[d];
    }
  }
  return flips;
}

function applyKnightLanding(board: number[], pos: number, color: number, size: number): void {
  // Place knight marker, then apply standard Reversi sandwich-flip in all 8 directions
  board[pos] = knightCellValue(color);
  const opp = 3 - color;
  const r0 = Math.floor(pos / size), c0 = pos % size;
  for (let d = 0; d < 8; d++) {
    let r = r0 + DR[d], c = c0 + DC[d];
    let count = 0;
    while (r >= 0 && r < size && c >= 0 && c < size) {
      const idx = r * size + c;
      if (board[idx] === opp) { count++; }
      else if (board[idx] === color || board[idx] === color + 2) {
        // Flip all opponent discs in this direction
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

const ORTH_DR = [-1, 0, 1, 0];
const ORTH_DC = [0, 1, 0, -1];

function isKnightCaptured(board: number[], kPos: number, size: number): boolean {
  if (kPos < 0) return false;
  const kVal = board[kPos];
  if (kVal !== 3 && kVal !== 4) return false;
  const owner = kVal - 2;
  const opp = 3 - owner;
  const r0 = Math.floor(kPos / size), c0 = kPos % size;
  for (let d = 0; d < 4; d++) {
    const r = r0 + ORTH_DR[d], c = c0 + ORTH_DC[d];
    if (r < 0 || r >= size || c < 0 || c >= size) return false;
    if (board[r * size + c] !== opp) return false;
  }
  return true;
}

// ── Game Class ──
// Two-phase turns: each turn has a DISC phase then a KNIGHT phase.
// Both players have a persistent knight that starts at a corner and
// moves every turn in an L-shape (chess knight). Landing flips all
// adjacent opponent discs.

export type TurnPhase = 'disc' | 'knight';

interface HistoryEntry {
  board: number[];
  turn: number;
  over: boolean;
  turnPhase: TurnPhase;
  knightPos: [number, number];
  knightHistory: [number[], number[]];
}

export class Game {
  private board: number[];
  private turn: number;   // 1 = Black, 2 = White
  private over: boolean;
  private sd: SizeData;
  private history: HistoryEntry[];
  private _turnPhase: TurnPhase;
  // Knight positions: >=0 = cell index, -2 = captured
  private knightPos: [number, number];
  // Anti-oscillation: track last 4 positions per player to prevent cycling
  private _knightHistory: [number[], number[]];
  // Turn pass tracking: 0 = no pass, 1 = Black passed, 2 = White passed
  private _lastPassed: number;
  readonly size: number;

  constructor(size: number = 8) {
    if (size < 4 || size % 2 !== 0 || size > 16) throw new Error('Size must be even, 4-16');
    this.size = size;
    this.sd = getSizeData(size);
    this.board = initialBoard(size);
    this.turn = 1;
    this.over = false;
    this.history = [];
    this._turnPhase = 'disc';
    this._lastPassed = 0;

    // Place knights at opposite corners
    const cells = size * size;
    this.knightPos = [0, cells - 1];
    this._knightHistory = [[], []];
    this._lastPassed = 0;
    this.board[0] = 3;            // black knight top-left
    this.board[cells - 1] = 4;    // white knight bottom-right
  }

  private snapshot(): void {
    this.history.push({
      board: this.board.slice(0, this.sd.cells),
      turn: this.turn,
      over: this.over,
      turnPhase: this._turnPhase,
      knightPos: [this.knightPos[0], this.knightPos[1]],
      knightHistory: [this._knightHistory[0].slice(), this._knightHistory[1].slice()],
    });
  }

  // ── Public getters ──

  getBoard(): number[]       { return this.board.slice(0, this.sd.cells); }
  currentTurn(): number      { return this.turn; }
  isGameOver(): boolean     { return this.over; }
  turnPhase(): TurnPhase     { return this._turnPhase; }
  lastPassed(): number        { return this._lastPassed; }
  blackCount(): number       { return countDiscs(this.board, 1, this.sd.cells); }
  whiteCount(): number       { return countDiscs(this.board, 2, this.sd.cells); }

  getKnightPos(player?: number): number {
    const p = player ?? this.turn;
    return this.knightPos[p - 1];
  }

  // Phase-aware legal moves:
  //   disc phase  → valid disc placements
  //   knight phase → valid L-shape destinations
  getLegalMoves(): number[] {
    if (this._turnPhase === 'knight') {
      return this.getKnightTargets();
    }
    return getLegalMoves(this.board, this.turn, this.size);
  }

  getFlips(pos: number): number[] {
    return getFlips(this.board, pos, this.turn, this.size);
  }

  getKnightLandingFlips(pos: number): number[] {
    return getKnightLandingFlips(this.board, pos, this.turn, this.size);
  }

  // ── Disc move (disc phase only) ──

  makeMove(pos: number): boolean {
    if (this.over || this._turnPhase !== 'disc') return false;
    if (pos < 0 || pos >= this.sd.cells) return false;
    if (!hasFlips(this.board, pos, this.turn, this.size)) return false;
    this.snapshot();
    applyMoveInPlace(this.board, pos, this.turn, this.size);
    this.enterKnightPhase();
    return true;
  }

  // ── Knight move (knight phase only) ──

  makeKnightMove(pos: number): boolean {
    if (this.over || this._turnPhase !== 'knight') return false;
    const targets = this.getKnightTargets();
    if (!targets.includes(pos)) return false;
    this.snapshot();
    this.moveKnight(pos);
    this._turnPhase = 'disc';
    this.advanceTurn();
    return true;
  }

  // ── AI ──

  aiMove(depth: number): number {
    if (this.over) return -1;
    depth = Math.min(MAX_AI_DEPTH, Math.max(1, depth));

    if (this._turnPhase === 'disc') {
      const discMoves = getLegalMoves(this.board, this.turn, this.size);
      if (discMoves.length === 0) {
        // No disc moves — skip to knight phase
        this.snapshot();
        this.enterKnightPhase();
        return -1;
      }
      const pos = bestMove(this.board, this.turn, depth, this.sd, this.knightPos);
      if (pos < 0) {
        this.snapshot();
        this.enterKnightPhase();
        return -1;
      }
      this.snapshot();
      applyMoveInPlace(this.board, pos, this.turn, this.size);
      this.enterKnightPhase();
      return pos;
    } else {
      // Knight phase — pick best destination by 1-ply evaluation
      return this.aiBestKnightMove();
    }
  }

  // ── Undo / Reset ──

  canUndo(): boolean {
    return this.history.length > 0;
  }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.board = prev.board;
    this.turn = prev.turn;
    this.over = prev.over;
    this._turnPhase = prev.turnPhase;
    this.knightPos = prev.knightPos;
    this._knightHistory = prev.knightHistory;
    return true;
  }

  reset(): void {
    const cells = this.size * this.size;
    this.board = initialBoard(this.size);
    this.board[0] = 3;
    this.board[cells - 1] = 4;
    this.knightPos = [0, cells - 1];
    this._knightHistory = [[], []];
    this.turn = 1;
    this.over = false;
    this._turnPhase = 'disc';
    this._lastPassed = 0;
    this.history = [];
  }

  // ── Save / Load (tamper-resistant) ──

  serialize(): string {
    const payload = {
      v: 1,
      size: this.size,
      board: this.board.slice(0, this.sd.cells),
      turn: this.turn,
      over: this.over,
      phase: this._turnPhase,
      kp: this.knightPos,
      kh: this._knightHistory,
      lp: this._lastPassed,
      hist: this.history,
    };
    const json = JSON.stringify(payload);
    // Simple checksum: sum of all char codes mod 65521 (largest 16-bit prime)
    let ck = 0;
    for (let i = 0; i < json.length; i++) ck = (ck + json.charCodeAt(i)) % 65521;
    const withCheck = JSON.stringify({ d: json, c: ck });
    return btoa(withCheck);
  }

  static deserialize(encoded: string): Game {
    let outer: { d: string; c: number };
    try { outer = JSON.parse(atob(encoded)); }
    catch { throw new Error('Invalid save data'); }
    // Verify checksum
    let ck = 0;
    for (let i = 0; i < outer.d.length; i++) ck = (ck + outer.d.charCodeAt(i)) % 65521;
    if (ck !== outer.c) throw new Error('Save data corrupted or tampered');
    const p = JSON.parse(outer.d);
    if (p.v !== 1) throw new Error('Unsupported save version');
    const g = new Game(p.size);
    g.board = p.board;
    g.turn = p.turn;
    g.over = p.over;
    g._turnPhase = p.phase;
    g.knightPos = p.kp;
    g._knightHistory = p.kh;
    g._lastPassed = p.lp;
    g.history = p.hist;
    return g;
  }

  // ── Knight methods ──

  knightCanAct(): boolean {
    const kp = this.knightPos[this.turn - 1];
    if (kp < 0) return false;
    return getKnightDestinations(kp, this.size, this.board, this.turn).length > 0;
  }

  getKnightTargetsPublic(): number[] {
    return this.getKnightTargets();
  }

  // ── Knight internals ──

  private getKnightTargets(): number[] {
    const kp = this.knightPos[this.turn - 1];
    if (kp < 0) return []; // captured
    return getKnightDestinations(kp, this.size, this.board, this.turn);
  }

  private moveKnight(targetPos: number): void {
    const p = this.turn;
    const oldKp = this.knightPos[p - 1];
    // Track position history for anti-oscillation (keep last 4)
    const hist = this._knightHistory[p - 1];
    if (oldKp >= 0) hist.push(oldKp);
    if (hist.length > 4) hist.shift();

    if (oldKp >= 0) this.board[oldKp] = 0; // clear old position

    // Check for active capture — landing on opponent's knight
    const oppIdx = (3 - p) - 1;
    if (this.knightPos[oppIdx] === targetPos) {
      this.board[targetPos] = 0; // remove opponent knight first
      this.knightPos[oppIdx] = -2; // mark as captured
    }

    applyKnightLanding(this.board, targetPos, p, this.size);
    this.knightPos[p - 1] = targetPos;
  }

  private enterKnightPhase(): void {
    this.checkKnightCaptures();
    const targets = this.getKnightTargets();
    if (targets.length > 0) {
      this._turnPhase = 'knight';
    } else {
      // No knight moves available — skip knight phase, end turn
      this._turnPhase = 'disc';
      this.advanceTurn();
    }
  }

  private aiBestKnightMove(): number {
    const targets = this.getKnightTargets();
    if (targets.length === 0) {
      this._turnPhase = 'disc';
      this.advanceTurn();
      return -1;
    }
    if (targets.length === 1) {
      this.snapshot();
      this.moveKnight(targets[0]);
      this._turnPhase = 'disc';
      this.advanceTurn();
      return targets[0];
    }

    // ── Chess-hybrid knight evaluation ──
    // A chess knight's value comes from: placement, threats, safety, and purpose.
    // "A knight on the rim is dim." — penalize edge/corner positions
    // "Knights need outposts." — reward squares that threaten enemy clusters
    // "Capture hanging pieces." — always take opponent knight if possible
    //
    // Evaluation = tactical + future_threat + safety + minimax(depth 3)

    let bestTarget = targets[0];
    let bestScore = NEG_INF;
    const p = this.turn;
    const opp = 3 - p;
    const oppKnightIdx = opp - 1;
    const history = this._knightHistory[p - 1];
    const { size } = this;

    for (const t of targets) {
      const testBoard = this.board.slice(0, this.sd.cells);
      const oldKp = this.knightPos[p - 1];
      if (oldKp >= 0) testBoard[oldKp] = 0;

      let score = 0;

      // ── 1. Anti-oscillation: penalize ANY recently visited position ──
      // More recent = heavier penalty (chess: don't repeat positions)
      for (let h = history.length - 1, penalty = 250; h >= 0 && penalty > 0; h--, penalty -= 50) {
        if (t === history[h]) { score -= penalty; break; }
      }

      // ── 2. Capture: taking opponent knight = massive material gain ──
      if (this.knightPos[oppKnightIdx] === t) score += 500;

      // ── 3. Direct material: count flips from landing ──
      const flips = getKnightLandingFlips(testBoard, t, p, size);
      score += flips.length * 20;

      // Apply knight landing to get resulting position
      applyKnightLanding(testBoard, t, p, size);

      // ── 4. Future threat: count opponent discs at L-jump from NEW position ──
      // This is the "knight fork" concept — how dangerous is the knight NEXT turn?
      const futureTargets = getKnightDestinations(t, size, testBoard, p);
      let futureFlipPotential = 0;
      for (const ft of futureTargets) {
        // Count how many opponent discs would flip if we landed there next turn
        const futFlips = getKnightLandingFlips(testBoard, ft, p, size);
        futureFlipPotential += futFlips.length;
      }
      score += futureFlipPotential * 5; // future threat value

      // ── 5. Safety: capture risk assessment ──
      const tr = Math.floor(t / size), tc = t % size;
      let oppOrthCount = 0;
      for (let d = 0; d < 4; d++) {
        const nr = tr + ORTH_DR[d], nc = tc + ORTH_DC[d];
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        if (testBoard[nr * size + nc] === opp) oppOrthCount++;
      }
      if (oppOrthCount >= 4) score -= 300;  // certain capture
      else if (oppOrthCount >= 3) score -= 100; // danger zone

      // ── 6. Mobility: more future destinations = harder to trap ──
      score += futureTargets.length * 4;

      // ── 7. Knight centralization (chess principle) ──
      // "A knight on the rim is dim" — penalize edge positions
      const centerDist = Math.abs(tr - size / 2 + 0.5) + Math.abs(tc - size / 2 + 0.5);
      const edgePenalty = (tr === 0 || tr === size - 1 || tc === 0 || tc === size - 1) ? -8 : 0;
      score += Math.max(0, size - centerDist) * 2 + edgePenalty;

      // ── 8. Opponent knight threat: can they capture us next? ──
      const oppKp = this.knightPos[oppKnightIdx];
      if (oppKp >= 0) {
        const oppDests = getKnightDestinations(oppKp, size, testBoard, opp);
        if (oppDests.includes(t)) score -= 60; // opponent could take us
        // Bonus for threatening their knight (keeps them defensive)
        if (futureTargets.includes(oppKp)) score += 40;
      }

      // ── 9. Positional evaluation via minimax (depth 3) ──
      // Deep search to see opponent's response — chess-style look-ahead
      _nodeCount = 0;
      const posScore = minimax(testBoard, 3, NEG_INF, POS_INF, false, p, 1, this.sd);
      score += posScore;

      if (score > bestScore) { bestScore = score; bestTarget = t; }
    }

    this.snapshot();
    this.moveKnight(bestTarget);
    this._turnPhase = 'disc';
    this.advanceTurn();
    return bestTarget;
  }

  private checkKnightCaptures(): void {
    for (let p = 0; p < 2; p++) {
      const kp = this.knightPos[p];
      if (kp >= 0 && isKnightCaptured(this.board, kp, this.size)) {
        this.board[kp] = 0;
        this.knightPos[p] = -2;
      }
    }
  }

  private advanceTurn(): void {
    this.checkKnightCaptures();
    const next = 3 - this.turn;
    const nextHasDisc = hasMoves(this.board, next, this.size);
    const currHasDisc = hasMoves(this.board, this.turn, this.size);

    // Game ends when neither player has disc moves
    if (!nextHasDisc && !currHasDisc) {
      this.over = true;
      return;
    }

    this._lastPassed = 0;
    if (nextHasDisc) {
      this.turn = next;
    } else {
      // Next player has no disc moves — give them knight-only turn if possible
      const nextKnight = this.knightPos[next - 1];
      if (nextKnight >= 0 && getKnightDestinations(nextKnight, this.size, this.board, next).length > 0) {
        this.turn = next;
        this._turnPhase = 'knight'; // skip disc phase
        this._lastPassed = next; // notify UI that disc phase was skipped
        return;
      }
      // Next player can't do anything — current player goes again
      this._lastPassed = next;
    }
  }
}
