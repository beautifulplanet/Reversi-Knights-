import { Game } from './src/engine';

const GAMES = 200;
let failures = 0;
let maxMoves = 0;
let maxAiTime = 0;

for (let g = 0; g < GAMES; g++) {
  const game = new Game();
  let moves = 0;
  let stuck = 0;

  while (!game.is_game_over()) {
    const legal = game.get_legal_moves();
    const turn = game.current_turn();

    if (legal.length === 0) {
      // No legal moves — should have been handled by advanceTurn
      // If we're here with no moves and game isn't over, something is wrong
      stuck++;
      if (stuck > 2) {
        console.error(`Game ${g}: stuck — turn=${turn}, no legal moves, not game over`);
        failures++;
        break;
      }
      // Try AI move to trigger pass handling
      game.ai_move(1);
      moves++;
      continue;
    }

    stuck = 0;

    if (moves % 2 === 0) {
      // Human move: random legal move
      const pos = legal[Math.floor(Math.random() * legal.length)];
      const ok = game.make_move(pos);
      if (!ok) {
        console.error(`Game ${g}: make_move(${pos}) returned false for legal move`);
        failures++;
        break;
      }
    } else {
      // AI move with timing
      const t0 = performance.now();
      game.ai_move(4);
      const elapsed = performance.now() - t0;
      if (elapsed > maxAiTime) maxAiTime = elapsed;
    }

    moves++;
    if (moves > 60) {
      console.error(`Game ${g}: exceeded 60 real moves (${moves})`);
      failures++;
      break;
    }
  }

  if (moves > maxMoves) maxMoves = moves;

  // Verify make_move rejects illegal positions
  const badMove = game.make_move(99);
  if (badMove) {
    console.error(`Game ${g}: make_move(99) should return false`);
    failures++;
  }
}

console.log(`\n=== Engine Test Results ===`);
console.log(`Games: ${GAMES}`);
console.log(`Failures: ${failures}`);
console.log(`Max moves in a game: ${maxMoves}`);
console.log(`Max AI time (depth 4): ${maxAiTime.toFixed(1)}ms`);

if (failures > 0) {
  console.error(`\nFAILED: ${failures} failures`);
  process.exit(1);
}

if (maxAiTime > 50) {
  console.error(`\nWARNING: Max AI time ${maxAiTime.toFixed(1)}ms exceeds 50ms target`);
}

console.log(`\nPASSED: ${GAMES}/${GAMES} games complete, 0 failures`);
process.exit(0);
