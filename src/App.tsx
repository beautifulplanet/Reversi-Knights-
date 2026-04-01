import { useState } from 'react';
import { useReversiEngine, type GameMode, type ReversiEngine } from './useReversiEngine';
import ReversiBoard from './ReversiBoard';

function Lobby({ onStart }: { onStart: (mode: GameMode, difficulty: number, boardSize?: number) => void }) {
  const [mode, setMode] = useState<GameMode>('ai');
  const [difficulty, setDifficulty] = useState(5);
  const [boardSize, setBoardSize] = useState(8);

  return (
    <div className="lobby">
      <h1 className="lobby-title">Reversi Knights</h1>
      <div className="lobby-card">
        <div className="lobby-section">
          <label className="lobby-label">Game Mode</label>
          <div className="lobby-buttons">
            <button className={`lobby-btn ${mode === 'ai' ? 'active' : ''}`} onClick={() => setMode('ai')}>vs AI</button>
            <button className={`lobby-btn ${mode === 'pvp' ? 'active' : ''}`} onClick={() => setMode('pvp')}>vs Player</button>
          </div>
        </div>
        {mode === 'ai' && (
          <div className="lobby-section">
            <label className="lobby-label">Difficulty: {difficulty}</label>
            <input type="range" min={1} max={10} value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))} className="lobby-slider" />
          </div>
        )}
        <div className="lobby-section">
          <label className="lobby-label">Board Size</label>
          <div className="lobby-buttons">
            {[8, 10, 12, 16].map(s => (
              <button key={s} className={`lobby-btn ${boardSize === s ? 'active' : ''}`} onClick={() => setBoardSize(s)}>{s}x{s}</button>
            ))}
          </div>
        </div>
        <button className="start-btn" onClick={() => onStart(mode, difficulty, boardSize)}>Start Game</button>
      </div>
    </div>
  );
}

function GameView({ engine }: { engine: ReversiEngine }) {
  const { state, phase, mode, difficulty, boardSize, thinking, canUndo, playMove, undo, newGame } = engine;
  const isPlayerTurn = mode === 'pvp' || state.turn === 1;
  const isKnightPhase = state.turnPhase === 'knight';

  return (
    <div className="game-view">
      <div className="score-bar">
        <div className={`score-player ${state.turn === 1 ? 'active-turn' : ''}`}>
          <span className="disc-icon black-disc" />
          <span className="score-count">{state.blackCount}</span>
        </div>
        <div className="game-status">
          {phase === 'gameover'
            ? state.blackCount > state.whiteCount ? 'Black Wins!'
              : state.whiteCount > state.blackCount ? 'White Wins!'
              : 'Draw!'
            : thinking ? 'AI thinking...'
            : isPlayerTurn
              ? `${state.turn === 1 ? 'Black' : 'White'} - ${isKnightPhase ? 'Move Knight' : 'Place Disc'}`
              : "AI's turn"}
        </div>
        <div className={`score-player ${state.turn === 2 ? 'active-turn' : ''}`}>
          <span className="disc-icon white-disc" />
          <span className="score-count">{state.whiteCount}</span>
        </div>
      </div>

      <ReversiBoard
        board={state.board}
        legalMoves={isPlayerTurn && !thinking ? state.legalMoves : []}
        lastMove={state.lastMove}
        flippedDiscs={state.flippedDiscs}
        turn={state.turn}
        boardSize={boardSize}
        isKnightPhase={isKnightPhase && isPlayerTurn && !thinking}
        disabled={!isPlayerTurn || thinking || phase === 'gameover'}
        onCellClick={playMove}
      />

      <div className="game-controls">
        {mode === 'ai' && <span className="difficulty-label">Difficulty: {difficulty}</span>}
        {isPlayerTurn && isKnightPhase && <span className="phase-label">Move your Knight (L-shape)</span>}
        <button className="undo-btn" onClick={undo} disabled={!canUndo || thinking}>Undo</button>
        <button className="new-game-btn" onClick={newGame}>New Game</button>
      </div>
    </div>
  );
}

export default function App() {
  const engine = useReversiEngine();
  if (engine.phase === 'lobby') return <Lobby onStart={engine.startGame} />;
  return <GameView engine={engine} />;
}