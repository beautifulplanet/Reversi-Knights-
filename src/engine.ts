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

// ── Knight helpers ──
// Cell values: 0=empty, 1=black disc, 2=white disc, 3=black knight, 4=white knight

function knightCellValue(player: number): number { return player + 2; }

function getKnightDestinations(fromPos: number, size: number, board: number[]): number[] {
  const dests: number[] = [];
  const r0 = Math.floor(fromPos / size), c0 = fromPos % size;
  for (let k = 0; k < 8; k++) {
    const r = r0 + KNIGHT_DR[k], c = c0 + KNIGHT_DC[k];
    if (r >= 0 && r < size && c >= 0 && c < size) {
      const idx = r * size + c;
      if (board[idx] === 0) dests.push(idx);
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

    // Place knights at opposite corners
    const cells = size * size;
    this.knightPos = [0, cells - 1];
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
    });
  }

  // ── Public getters ──

  get_board(): number[]       { return this.board.slice(0, this.sd.cells); }
  current_turn(): number      { return this.turn; }
  is_game_over(): boolean     { return this.over; }
  turn_phase(): TurnPhase     { return this._turnPhase; }
  black_count(): number       { return countDiscs(this.board, 1, this.sd.cells); }
  white_count(): number       { return countDiscs(this.board, 2, this.sd.cells); }

  get_knight_pos(player?: number): number {
    const p = player ?? this.turn;
    return this.knightPos[p - 1];
  }

  // Phase-aware legal moves:
  //   disc phase  → valid disc placements
  //   knight phase → valid L-shape destinations
  get_legal_moves(): number[] {
    if (this._turnPhase === 'knight') {
      return this.getKnightTargets();
    }
    return getLegalMoves(this.board, this.turn, this.size);
  }

  get_flips(pos: number): number[] {
    return getFlips(this.board, pos, this.turn, this.size);
  }

  get_knight_landing_flips(pos: number): number[] {
    return getKnightLandingFlips(this.board, pos, this.turn, this.size);
  }

  // ── Disc move (disc phase only) ──

  make_move(pos: number): boolean {
    if (this.over || this._turnPhase !== 'disc') return false;
    if (pos < 0 || pos >= this.sd.cells) return false;
    if (!hasFlips(this.board, pos, this.turn, this.size)) return false;
    this.snapshot();
    applyMoveInPlace(this.board, pos, this.turn, this.size);
    this.enterKnightPhase();
    return true;
  }

  // ── Knight move (knight phase only) ──

  make_knight_move(pos: number): boolean {
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

  ai_move(depth: number): number {
    if (this.over) return -1;
    depth = Math.min(6, Math.max(1, depth));

    if (this._turnPhase === 'disc') {
      const discMoves = getLegalMoves(this.board, this.turn, this.size);
      if (discMoves.length === 0) {
        // No disc moves — skip to knight phase
        this.snapshot();
        this.enterKnightPhase();
        return -1;
      }
      const pos = bestMove(this.board, this.turn, depth, this.sd);
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

  can_undo(): boolean {
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
    return true;
  }

  reset(): void {
    const cells = this.size * this.size;
    this.board = initialBoard(this.size);
    this.board[0] = 3;
    this.board[cells - 1] = 4;
    this.knightPos = [0, cells - 1];
    this.turn = 1;
    this.over = false;
    this._turnPhase = 'disc';
    this.history = [];
  }

  // ── Knight methods ──

  knight_can_act(): boolean {
    const kp = this.knightPos[this.turn - 1];
    if (kp < 0) return false;
    return getKnightDestinations(kp, this.size, this.board).length > 0;
  }

  get_knight_targets(): number[] {
    return this.getKnightTargets();
  }

  // ── Knight internals ──

  private getKnightTargets(): number[] {
    const kp = this.knightPos[this.turn - 1];
    if (kp < 0) return []; // captured
    return getKnightDestinations(kp, this.size, this.board);
  }

  private moveKnight(targetPos: number): void {
    const p = this.turn;
    const oldKp = this.knightPos[p - 1];
    if (oldKp >= 0) this.board[oldKp] = 0; // clear old position
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
    // Pick best target by evaluation
    let bestTarget = targets[0];
    let bestScore = -999999;
    for (const t of targets) {
      const testBoard = this.board.slice(0, this.sd.cells);
      const oldKp = this.knightPos[this.turn - 1];
      if (oldKp >= 0) testBoard[oldKp] = 0;
      applyKnightLanding(testBoard, t, this.turn, this.size);
      const score = evaluate(testBoard, this.turn, this.sd);
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

    if (nextHasDisc) {
      this.turn = next;
    } else {
      // Next player has no disc moves — give them knight-only turn if possible
      const nextKnight = this.knightPos[next - 1];
      if (nextKnight >= 0 && getKnightDestinations(nextKnight, this.size, this.board).length > 0) {
        this.turn = next;
        this._turnPhase = 'knight'; // skip disc phase
        return;
      }
      // Next player can't do anything — current player goes again
    }
  }
}
