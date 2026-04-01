import { useCallback, useRef, useState } from 'react';
import { Game } from './engine';

// ── Types (exact per spec) ──

export type CellState = 0 | 1 | 2;
export type GamePhase = 'lobby' | 'playing' | 'gameover';
export type GameMode = 'ai' | 'pvp';

export interface GameState {
  board: CellState[];
  turn: 1 | 2;
  legalMoves: number[];
  blackCount: number;
  whiteCount: number;
  isGameOver: boolean;
  lastMove: number | null;
  flippedDiscs: number[];
}

export interface ReversiEngine {
  state: GameState;
  phase: GamePhase;
  mode: GameMode;
  difficulty: number;
  thinking: boolean;
  ready: boolean;
  startGame: (mode: GameMode, difficulty: number) => void;
  playMove: (pos: number) => void;
  newGame: () => void;
}

// ── Helpers ──

function readGameState(g: Game, lastMove: number | null, flippedDiscs: number[]): GameState {
  return {
    board: g.get_board() as CellState[],
    turn: g.current_turn() as 1 | 2,
    legalMoves: g.get_legal_moves(),
    blackCount: g.black_count(),
    whiteCount: g.white_count(),
    isGameOver: g.is_game_over(),
    lastMove,
    flippedDiscs,
  };
}

// ── Hook ──

export function useReversiEngine(): ReversiEngine {
  const gameRef = useRef<Game>(new Game());
  const [state, setState] = useState<GameState>(() => readGameState(gameRef.current, null, []));
  const [phase, setPhase] = useState<GamePhase>('lobby');
  const [mode, setMode] = useState<GameMode>('ai');
  const [difficulty, setDifficulty] = useState(5);

  // Refs to prevent stale closures
  const modeRef = useRef(mode);
  const difficultyRef = useRef(difficulty);
  const phaseRef = useRef(phase);
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derived thinking flag — cannot get stuck
  const thinking = phase === 'playing' && mode === 'ai' && state.turn === 2 && !state.isGameOver;

  const doAiMove = useCallback(() => {
    const g = gameRef.current;
    if (!g || g.is_game_over() || g.current_turn() !== 2) return;
    if (phaseRef.current !== 'playing' || modeRef.current !== 'ai') return;

    const d = difficultyRef.current;
    const depth = d <= 3 ? 1 : d <= 6 ? 2 : d <= 8 ? 3 : 4;

    const boardBefore = g.get_board();
    const move = g.ai_move(depth);

    let flipped: number[] = [];
    if (move >= 0 && move < 64) {
      const boardAfter = g.get_board();
      for (let i = 0; i < 64; i++) {
        if (i !== move && boardBefore[i] !== boardAfter[i]) flipped.push(i);
      }
    }

    const s = readGameState(g, move >= 0 ? move : null, flipped);
    setState(s);

    if (s.isGameOver) { setPhase('gameover'); phaseRef.current = 'gameover'; return; }

    // If turn is STILL 2 (human must pass), chain another AI move
    if (g.current_turn() === 2) {
      aiTimerRef.current = setTimeout(doAiMove, 400);
    }
  }, []);

  const playMove = useCallback((pos: number) => {
    const g = gameRef.current;
    if (!g || g.is_game_over()) return;
    if (modeRef.current === 'ai' && g.current_turn() !== 1) return;

    const flips = g.get_flips(pos);
    const ok = g.make_move(pos);
    if (!ok) return;

    const s = readGameState(g, pos, flips);
    setState(s);

    if (s.isGameOver) { setPhase('gameover'); phaseRef.current = 'gameover'; return; }

    // Explicitly trigger AI if it's now White's turn
    if (modeRef.current === 'ai' && g.current_turn() === 2) {
      aiTimerRef.current = setTimeout(doAiMove, 400);
    }
  }, [doAiMove]);

  const startGame = useCallback((newMode: GameMode, newDifficulty: number) => {
    if (aiTimerRef.current) { clearTimeout(aiTimerRef.current); aiTimerRef.current = null; }
    gameRef.current.reset();
    setMode(newMode);
    setDifficulty(newDifficulty);
    modeRef.current = newMode;
    difficultyRef.current = newDifficulty;
    setPhase('playing');
    phaseRef.current = 'playing';
    setState(readGameState(gameRef.current, null, []));
  }, []);

  const newGame = useCallback(() => {
    if (aiTimerRef.current) { clearTimeout(aiTimerRef.current); aiTimerRef.current = null; }
    gameRef.current.reset();
    setState(readGameState(gameRef.current, null, []));
    setPhase('lobby');
    phaseRef.current = 'lobby';
  }, []);

  return {
    state,
    phase,
    mode,
    difficulty,
    thinking,
    ready: true,
    startGame,
    playMove,
    newGame,
  };
}
