import { useCallback, useRef, useState } from 'react';
import { Game, type TurnPhase } from './engine';

// -- Types --

export type CellState = 0 | 1 | 2 | 3 | 4;
export type GamePhase = 'lobby' | 'playing' | 'gameover';
export type GameMode = 'ai' | 'pvp';

export interface GameState {
  board: CellState[];
  turn: 1 | 2;
  turnPhase: TurnPhase;
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
  boardSize: number;
  thinking: boolean;
  ready: boolean;
  canUndo: boolean;
  startGame: (mode: GameMode, difficulty: number, boardSize?: number) => void;
  playMove: (pos: number) => void;
  undo: () => void;
  newGame: () => void;
}

// -- Helpers --

function readGameState(g: Game, lastMove: number | null, flippedDiscs: number[]): GameState {
  return {
    board: g.get_board() as CellState[],
    turn: g.current_turn() as 1 | 2,
    turnPhase: g.turn_phase(),
    legalMoves: g.get_legal_moves(),
    blackCount: g.black_count(),
    whiteCount: g.white_count(),
    isGameOver: g.is_game_over(),
    lastMove,
    flippedDiscs,
  };
}

// -- Hook --

export function useReversiEngine(): ReversiEngine {
  const gameRef = useRef<Game>(new Game());
  const [state, setState] = useState<GameState>(() => readGameState(gameRef.current, null, []));
  const [phase, setPhase] = useState<GamePhase>('lobby');
  const [mode, setMode] = useState<GameMode>('ai');
  const [difficulty, setDifficulty] = useState(5);
  const [boardSize, setBoardSize] = useState(8);
  const [canUndo, setCanUndo] = useState(false);

  const modeRef = useRef(mode);
  const difficultyRef = useRef(difficulty);
  const phaseRef = useRef(phase);
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const thinking = phase === 'playing' && mode === 'ai' && state.turn === 2 && !state.isGameOver;

  const doAiMove = useCallback(() => {
    const g = gameRef.current;
    if (!g || g.is_game_over() || g.current_turn() !== 2) return;
    if (phaseRef.current !== 'playing' || modeRef.current !== 'ai') return;

    const d = difficultyRef.current;
    const depth = d <= 3 ? 1 : d <= 6 ? 2 : d <= 8 ? 3 : 4;
    const cells = g.size * g.size;
    const boardBefore = g.get_board();

    const move = g.ai_move(depth);

    const boardAfter = g.get_board();
    let flipped: number[] = [];
    if (move >= 0 && move < cells) {
      for (let i = 0; i < cells; i++) {
        if (i !== move && boardBefore[i] !== boardAfter[i]) flipped.push(i);
      }
    }

    const s = readGameState(g, move >= 0 ? move : null, flipped);
    setState(s);
    setCanUndo(g.can_undo());

    if (s.isGameOver) { setPhase('gameover'); phaseRef.current = 'gameover'; return; }

    // If still AI turn (knight phase or pass), chain
    if (g.current_turn() === 2) {
      aiTimerRef.current = setTimeout(doAiMove, 300);
    }
  }, []);

  const playMove = useCallback((pos: number) => {
    const g = gameRef.current;
    if (!g || g.is_game_over()) return;
    if (modeRef.current === 'ai' && g.current_turn() !== 1) return;

    const currentPhase = g.turn_phase();
    let ok: boolean;
    let flips: number[];

    if (currentPhase === 'knight') {
      flips = g.get_knight_landing_flips(pos);
      ok = g.make_knight_move(pos);
    } else {
      flips = g.get_flips(pos);
      ok = g.make_move(pos);
    }
    if (!ok) return;

    const s = readGameState(g, pos, flips);
    setState(s);
    setCanUndo(g.can_undo());

    if (s.isGameOver) { setPhase('gameover'); phaseRef.current = 'gameover'; return; }

    // Still player turn (knight phase after disc move) - let them act
    if (g.current_turn() === 1) return;

    // Trigger AI
    if (modeRef.current === 'ai' && g.current_turn() === 2) {
      aiTimerRef.current = setTimeout(doAiMove, 400);
    }
  }, [doAiMove]);

  const startGame = useCallback((newMode: GameMode, newDifficulty: number, newSize: number = 8) => {
    if (aiTimerRef.current) { clearTimeout(aiTimerRef.current); aiTimerRef.current = null; }
    gameRef.current = new Game(newSize);
    setMode(newMode);
    setDifficulty(newDifficulty);
    setBoardSize(newSize);
    modeRef.current = newMode;
    difficultyRef.current = newDifficulty;
    setPhase('playing');
    phaseRef.current = 'playing';
    setState(readGameState(gameRef.current, null, []));
    setCanUndo(false);
  }, []);

  const newGame = useCallback(() => {
    if (aiTimerRef.current) { clearTimeout(aiTimerRef.current); aiTimerRef.current = null; }
    gameRef.current = new Game();
    setBoardSize(8);
    setState(readGameState(gameRef.current, null, []));
    setCanUndo(false);
    setPhase('lobby');
    phaseRef.current = 'lobby';
  }, []);

  const undo = useCallback(() => {
    const g = gameRef.current;
    if (aiTimerRef.current) { clearTimeout(aiTimerRef.current); aiTimerRef.current = null; }
    if (modeRef.current === 'ai') {
      let safety = 10;
      while (g.can_undo() && safety-- > 0) {
        g.undo();
        if (g.current_turn() === 1 && g.turn_phase() === 'disc') break;
      }
    } else {
      g.undo();
    }
    setState(readGameState(g, null, []));
    setCanUndo(g.can_undo());
    if (g.is_game_over()) {
      setPhase('gameover'); phaseRef.current = 'gameover';
    } else {
      setPhase('playing'); phaseRef.current = 'playing';
    }
  }, []);

  return {
    state, phase, mode, difficulty, boardSize, thinking, ready: true, canUndo,
    startGame, playMove, undo, newGame,
  };
}