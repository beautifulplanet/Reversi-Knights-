import { Game } from './src/engine';

const SIZES = [8, 10];
const GAMES_PER_SIZE = 100;
let failures = 0;
let maxMoves = 0;
let maxAiTime = 0;

for (const size of SIZES) {
  for (let g = 0; g < GAMES_PER_SIZE; g++) {
    const game = new Game(size);
    const cells = size * size;
    const maxAllowedMoves = cells;
    let moves = 0;
    let stuck = 0;

    // Verify initial state
    const initBoard = game.get_board();
    if (initBoard.length !== cells) {
      console.error(`Size ${size} Game ${g}: board length ${initBoard.length} !== ${cells}`);
      failures++;
      continue;
    }

    while (!game.is_game_over()) {
      const legal = game.get_legal_moves();
      const turn = game.current_turn();

      if (legal.length === 0) {
        stuck++;
        if (stuck > 2) {
          console.error(`Size ${size} Game ${g}: stuck — turn=${turn}, no legal moves, not game over`);
          failures++;
          break;
        }
        game.ai_move(1);
        moves++;
        continue;
      }

      stuck = 0;

      if (moves % 2 === 0) {
        const pos = legal[Math.floor(Math.random() * legal.length)];
        const ok = game.make_move(pos);
        if (!ok) {
          console.error(`Size ${size} Game ${g}: make_move(${pos}) returned false for legal move`);
          failures++;
          break;
        }
      } else {
        const t0 = performance.now();
        game.ai_move(size > 8 ? 2 : 4);
        const elapsed = performance.now() - t0;
        if (elapsed > maxAiTime) maxAiTime = elapsed;
      }

      moves++;
      if (moves > maxAllowedMoves) {
        console.error(`Size ${size} Game ${g}: exceeded ${maxAllowedMoves} moves`);
        failures++;
        break;
      }
    }

    if (moves > maxMoves) maxMoves = moves;

    // Verify make_move rejects out-of-bounds
    const badMove = game.make_move(cells + 10);
    if (badMove) {
      console.error(`Size ${size} Game ${g}: make_move(${cells + 10}) should return false`);
      failures++;
    }
  }
  console.log(`  Size ${size}: ${GAMES_PER_SIZE} games complete`);
}

const totalGames = SIZES.length * GAMES_PER_SIZE;
console.log(`\n=== Engine Test Results ===`);
console.log(`Games: ${totalGames} (sizes: ${SIZES.join(', ')})`);
console.log(`Failures: ${failures}`);
console.log(`Max moves in a game: ${maxMoves}`);
console.log(`Max AI time: ${maxAiTime.toFixed(1)}ms`);

if (failures > 0) {
  console.error(`\nFAILED: ${failures} failures`);
  process.exit(1);
}

console.log(`\nPASSED: ${totalGames}/${totalGames} games complete, 0 failures`);
process.exit(0);
