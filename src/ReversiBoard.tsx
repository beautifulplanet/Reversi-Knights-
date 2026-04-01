import { useRef, useEffect, useCallback } from 'react';
import type { CellState } from './useReversiEngine';

interface ReversiBoardProps {
  board: CellState[];
  legalMoves: number[];
  lastMove: number | null;
  flippedDiscs: number[];
  turn: 1 | 2;
  boardSize: number;
  isKnightPhase: boolean;
  disabled: boolean;
  onCellClick: (pos: number) => void;
}

const PADDING = 2;
const BOARD_BG = '#2d8a4e';
const GRID_LINES = '#1a6b35';
const BOARD_BORDER = '#1a4830';
const VALID_MOVE_DOT = 'rgba(255, 255, 255, 0.25)';
const KNIGHT_MOVE_DOT = 'rgba(124, 106, 247, 0.5)';
const LAST_MOVE_HIGHLIGHT = 'rgba(255, 200, 0, 0.4)';
const DISC_SHADOW = 'rgba(0,0,0,0.3)';

interface AnimState {
  flipProgress: Map<number, number>;
  flipOrigColor: Map<number, number>;
  dropProgress: number | null;
  dropPos: number | null;
  running: boolean;
}

export default function ReversiBoard({
  board, legalMoves, lastMove, flippedDiscs, turn: _turn, boardSize, isKnightPhase, disabled, onCellClick
}: ReversiBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<AnimState>({ flipProgress: new Map(), flipOrigColor: new Map(), dropProgress: null, dropPos: null, running: false });
  const rafRef = useRef<number>(0);
  const boardRef = useRef(board);
  const legalRef = useRef(legalMoves);
  const lastMoveRef = useRef(lastMove);
  const knightPhaseRef = useRef(isKnightPhase);
  boardRef.current = board;
  legalRef.current = legalMoves;
  lastMoveRef.current = lastMove;
  knightPhaseRef.current = isKnightPhase;

  const getCellSize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return 60;
    const displaySize = parseInt(canvas.style.width) || 560;
    return (displaySize - PADDING * 2) / boardSize;
  }, [boardSize]);

  const drawBoard = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const displaySize = Math.min(560, window.innerWidth - 40);
    const needsResize = canvas.width !== displaySize * dpr || canvas.height !== displaySize * dpr;
    if (needsResize) {
      canvas.width = displaySize * dpr;
      canvas.height = displaySize * dpr;
      canvas.style.width = displaySize + 'px';
      canvas.style.height = displaySize + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cellSize = (displaySize - PADDING * 2) / boardSize;
    const b = boardRef.current;
    const legal = legalRef.current;
    const anim = animRef.current;
    const cells = boardSize * boardSize;

    // Board
    ctx.fillStyle = BOARD_BORDER;
    ctx.fillRect(0, 0, displaySize, displaySize);
    ctx.fillStyle = BOARD_BG;
    ctx.fillRect(PADDING, PADDING, displaySize - PADDING * 2, displaySize - PADDING * 2);

    // Grid
    ctx.strokeStyle = GRID_LINES;
    ctx.lineWidth = 1;
    for (let i = 0; i <= boardSize; i++) {
      const p = PADDING + i * cellSize;
      ctx.beginPath(); ctx.moveTo(p, PADDING); ctx.lineTo(p, displaySize - PADDING); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PADDING, p); ctx.lineTo(displaySize - PADDING, p); ctx.stroke();
    }

    // Last move highlight
    if (lastMoveRef.current !== null) {
      const row = Math.floor(lastMoveRef.current / boardSize);
      const col = lastMoveRef.current % boardSize;
      ctx.fillStyle = LAST_MOVE_HIGHLIGHT;
      ctx.fillRect(PADDING + col * cellSize, PADDING + row * cellSize, cellSize, cellSize);
    }

    // Pieces
    for (let i = 0; i < cells; i++) {
      const cellColor = b[i];
      if (cellColor === 0) continue;

      const isKnight = cellColor === 3 || cellColor === 4;
      const owner = isKnight ? cellColor - 2 : cellColor;

      const row = Math.floor(i / boardSize);
      const col = i % boardSize;
      const cx = PADDING + col * cellSize + cellSize / 2;
      const cy = PADDING + row * cellSize + cellSize / 2;
      const radius = cellSize * 0.38;

      let scaleX = 1, scaleY = 1;
      let drawColor: number = owner;

      if (anim.flipProgress.has(i)) {
        const prog = anim.flipProgress.get(i)!;
        const origColor = anim.flipOrigColor.get(i)!;
        if (prog < 0.5) { scaleX = 1 - prog * 2; drawColor = origColor; }
        else { scaleX = (prog - 0.5) * 2; drawColor = owner; }
      }

      if (anim.dropPos === i && anim.dropProgress !== null) {
        scaleX = anim.dropProgress; scaleY = anim.dropProgress;
      }

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scaleX, scaleY);

      // Shadow
      ctx.beginPath(); ctx.arc(1.5, 1.5, radius, 0, Math.PI * 2);
      ctx.fillStyle = DISC_SHADOW; ctx.fill();

      // Disc
      const grad = ctx.createRadialGradient(-radius * 0.3, -radius * 0.3, radius * 0.1, 0, 0, radius);
      if (drawColor === 1) { grad.addColorStop(0, '#4a4a4a'); grad.addColorStop(1, '#1a1a1a'); }
      else { grad.addColorStop(0, '#fffbe8'); grad.addColorStop(1, '#f0ead6'); }
      ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fillStyle = grad; ctx.fill();

      // Knight symbol
      if (isKnight) {
        ctx.font = `bold ${Math.round(cellSize * 0.5)}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = drawColor === 1 ? '#e0e0e0' : '#2a2a2a';
        ctx.fillText('\u265E', 0, 2);
      }
      ctx.restore();
    }

    // Legal move dots
    const dotColor = knightPhaseRef.current ? KNIGHT_MOVE_DOT : VALID_MOVE_DOT;
    for (const pos of legal) {
      const row = Math.floor(pos / boardSize);
      const col = pos % boardSize;
      const cx = PADDING + col * cellSize + cellSize / 2;
      const cy = PADDING + row * cellSize + cellSize / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, cellSize * 0.12, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();
    }
  }, [boardSize]);

  // Animations
  useEffect(() => {
    const anim = animRef.current;
    anim.flipProgress.clear();
    anim.flipOrigColor.clear();
    anim.dropProgress = null;
    anim.dropPos = null;

    if (flippedDiscs.length > 0) {
      const newColor = board[flippedDiscs[0]];
      const origColor = newColor === 1 ? 2 : 1;
      for (let idx = 0; idx < flippedDiscs.length; idx++) {
        anim.flipProgress.set(flippedDiscs[idx], -idx * 0.15);
        anim.flipOrigColor.set(flippedDiscs[idx], origColor);
      }
    }

    if (lastMove !== null && lastMove >= 0) {
      anim.dropPos = lastMove;
      anim.dropProgress = 0;
    }

    if (flippedDiscs.length > 0 || (lastMove !== null && lastMove >= 0)) {
      if (!anim.running) {
        anim.running = true;
        const tick = () => {
          let allDone = true;
          for (const [pos, prog] of anim.flipProgress) {
            const next = prog + 0.06;
            if (next >= 1) { anim.flipProgress.delete(pos); anim.flipOrigColor.delete(pos); }
            else { anim.flipProgress.set(pos, next); allDone = false; }
          }
          if (anim.dropProgress !== null) {
            anim.dropProgress += 0.08;
            if (anim.dropProgress >= 1) { anim.dropProgress = null; anim.dropPos = null; }
            else allDone = false;
          }
          drawBoard();
          if (allDone) anim.running = false;
          else rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      }
    } else {
      drawBoard();
    }
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [board, flippedDiscs, lastMove, drawBoard]);

  useEffect(() => {
    if (!animRef.current.running) drawBoard();
  }, [legalMoves, isKnightPhase, drawBoard]);

  useEffect(() => {
    const onResize = () => drawBoard();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [drawBoard]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cellSize = getCellSize();
    const x = e.clientX - rect.left - PADDING;
    const y = e.clientY - rect.top - PADDING;
    const col = Math.floor(x / cellSize);
    const row = Math.floor(y / cellSize);
    if (col < 0 || col >= boardSize || row < 0 || row >= boardSize) return;
    onCellClick(row * boardSize + col);
  }, [disabled, boardSize, getCellSize, onCellClick]);

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      style={{ cursor: disabled ? 'default' : 'pointer', borderRadius: '8px', display: 'block', margin: '0 auto' }}
    />
  );
}