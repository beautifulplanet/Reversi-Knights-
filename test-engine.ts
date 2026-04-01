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
    const maxAllowedMoves = cells * 3;
    let moves = 0;
    let stuck = 0;

    // Verify initial state
    const initBoard = game.get_board();
    if (initBoard.length !== cells) {
      console.error(`Size ${size} Game ${g}: board length ${initBoard.length} !== ${cells}`);
      failures++;
      continue;
    }

    // Verify knights at corners
    if (initBoard[0] !== 3 || initBoard[cells - 1] !== 4) {
      console.error(`Size ${size} Game ${g}: knights not at corners`);
      failures++;
      continue;
    }

    while (!game.is_game_over()) {
      const phase = game.turn_phase();
      const legal = game.get_legal_moves();
      const turn = game.current_turn();

      if (legal.length === 0) {
        stuck++;
        if (stuck > 4) {
          console.error(`Size ${size} Game ${g}: stuck — turn=${turn}, phase=${phase}, no legal moves, not game over`);
          failures++;
          break;
        }
        // Let AI handle pass/skip logic
        game.ai_move(1);
        moves++;
        continue;
      }

      stuck = 0;

      if (moves % 2 === 0) {
        // Random move
        const pos = legal[Math.floor(Math.random() * legal.length)];
        let ok: boolean;
        if (phase === 'knight') {
          ok = game.make_knight_move(pos);
        } else {
          ok = game.make_move(pos);
        }
        if (!ok) {
          console.error(`Size ${size} Game ${g}: move(${pos}) returned false for legal move, phase=${phase}`);
          failures++;
          break;
        }
      } else {
        // AI move
        const t0 = performance.now();
        game.ai_move(size > 8 ? 2 : 3);
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