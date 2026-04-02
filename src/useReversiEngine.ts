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
  lastPassed: number;
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
  hasSave: boolean;
  startGame: (mode: GameMode, difficulty: number, boardSize?: number) => void;
  playMove: (pos: number) => void;
  undo: () => void;
  newGame: () => void;
  saveGame: () => void;
  loadGame: () => void;
}

// -- Helpers --

function readGameState(g: Game, lastMove: number | null, flippedDiscs: number[]): GameState {
  return {
    board: g.getBoard() as CellState[],
    turn: g.currentTurn() as 1 | 2,
    turnPhase: g.turnPhase(),
    legalMoves: g.getLegalMoves(),
    blackCount: g.blackCount(),
    whiteCount: g.whiteCount(),
    isGameOver: g.isGameOver(),
    lastPassed: g.lastPassed(),
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
  const [hasSave, setHasSave] = useState(() => localStorage.getItem('reversi-knights-save') !== null);

  const modeRef = useRef(mode);
  const difficultyRef = useRef(difficulty);
  const phaseRef = useRef(phase);
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiChainRef = useRef(0);
  const AI_CHAIN_LIMIT = 20;

  const thinking = phase === 'playing' && mode === 'ai' && state.turn === 2 && !state.isGameOver;

  const doAiMove = useCallback(() => {
    const g = gameRef.current;
    if (!g || g.isGameOver() || g.currentTurn() !== 2) return;
    if (phaseRef.current !== 'playing' || modeRef.current !== 'ai') return;
    if (aiChainRef.current >= AI_CHAIN_LIMIT) { console.error('AI chain limit reached'); return; }

    const d = difficultyRef.current;
    // 10 slider positions → 6 distinct depths (no duplicates above 2)
    const depthMap = [1, 1, 2, 2, 3, 3, 4, 4, 5, 6];
    const depth = depthMap[Math.min(d, 10) - 1] ?? 3;
    const cells = g.size * g.size;
    const boardBefore = g.getBoard();

    const move = g.aiMove(depth);

    const boardAfter = g.getBoard();
    let flipped: number[] = [];
    if (move >= 0 && move < cells) {
      for (let i = 0; i < cells; i++) {
        if (i !== move && boardBefore[i] !== boardAfter[i]) flipped.push(i);
      }
    }

    const s = readGameState(g, move >= 0 ? move : null, flipped);
    setState(s);
    setCanUndo(g.canUndo());

    if (s.isGameOver) { setPhase('gameover'); phaseRef.current = 'gameover'; return; }

    // If still AI turn (knight phase or pass), chain
    if (g.currentTurn() === 2) {
      aiChainRef.current++;
      aiTimerRef.current = setTimeout(doAiMove, 300);
    } else {
      aiChainRef.current = 0;
    }
  }, []);

  const playMove = useCallback((pos: number) => {
    const g = gameRef.current;
    if (!g || g.isGameOver()) return;
    if (modeRef.current === 'ai' && g.currentTurn() !== 1) return;

    const currentPhase = g.turnPhase();
    let ok: boolean;
    let flips: number[];

    if (currentPhase === 'knight') {
      flips = g.getKnightLandingFlips(pos);
      ok = g.makeKnightMove(pos);
    } else {
      flips = g.getFlips(pos);
      ok = g.makeMove(pos);
    }
    if (!ok) return;

    const s = readGameState(g, pos, flips);
    setState(s);
    setCanUndo(g.canUndo());

    if (s.isGameOver) { setPhase('gameover'); phaseRef.current = 'gameover'; return; }

    // Still player turn (knight phase after disc move) - let them act
    if (g.currentTurn() === 1) return;

    // Trigger AI
    if (modeRef.current === 'ai' && g.currentTurn() === 2) {
      aiChainRef.current = 0;
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
    const size = boardSize;
    gameRef.current = new Game(size);
    setState(readGameState(gameRef.current, null, []));
    setCanUndo(false);
    setPhase('lobby');
    phaseRef.current = 'lobby';
  }, [boardSize]);

  const undo = useCallback(() => {
    const g = gameRef.current;
    if (aiTimerRef.current) { clearTimeout(aiTimerRef.current); aiTimerRef.current = null; }
    if (modeRef.current === 'ai') {
      let safety = 10;
      while (g.canUndo() && safety-- > 0) {
        g.undo();
        if (g.currentTurn() === 1 && g.turnPhase() === 'disc') break;
      }
    } else {
      g.undo();
    }
    setState(readGameState(g, null, []));
    setCanUndo(g.canUndo());
    if (g.isGameOver()) {
      setPhase('gameover'); phaseRef.current = 'gameover';
    } else {
      setPhase('playing'); phaseRef.current = 'playing';
    }
  }, []);

  const saveGame = useCallback(() => {
    try {
      const data = gameRef.current.serialize();
      const meta = JSON.stringify({ mode: modeRef.current, difficulty: difficultyRef.current });
      localStorage.setItem('reversi-knights-save', data);
      localStorage.setItem('reversi-knights-meta', meta);
      setHasSave(true);
    } catch { /* silently fail */ }
  }, []);

  const loadGame = useCallback(() => {
    try {
      const data = localStorage.getItem('reversi-knights-save');
      const meta = localStorage.getItem('reversi-knights-meta');
      if (!data) return;
      const g = Game.deserialize(data);
      gameRef.current = g;
      if (meta) {
        const m = JSON.parse(meta);
        setMode(m.mode ?? 'ai');
        setDifficulty(m.difficulty ?? 5);
        modeRef.current = m.mode ?? 'ai';
        difficultyRef.current = m.difficulty ?? 5;
      }
      setBoardSize(g.size);
      setState(readGameState(g, null, []));
      setCanUndo(g.canUndo());
      setPhase(g.isGameOver() ? 'gameover' : 'playing');
      phaseRef.current = g.isGameOver() ? 'gameover' : 'playing';
    } catch { /* corrupted save — ignore */ }
  }, []);

  return {
    state, phase, mode, difficulty, boardSize, thinking, ready: true, canUndo, hasSave,
    startGame, playMove, undo, newGame, saveGame, loadGame,
  };
}