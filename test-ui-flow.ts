import { Game } from './src/engine';

const SIZES = [8, 10];
const GAMES_PER_SIZE = 1000;
let failures = 0;
let stuckGames = 0;
let passChains = 0;
let maxCalls = 0;

for (const size of SIZES) {
  const cells = size * size;
  for (let g = 0; g < GAMES_PER_SIZE; g++) {
    const game = new Game(size);
    let calls = 0;
    let gameStuck = false;

    while (!game.is_game_over()) {
      calls++;
      if (calls > 400) {
        console.error(`Size ${size} Game ${g}: exceeded 400 calls — stuck`);
        stuckGames++;
        gameStuck = true;
        break;
      }

      const turn = game.current_turn();

      if (turn === 1) {
        const legal = game.get_legal_moves();
        if (legal.length === 0) {
          console.error(`Size ${size} Game ${g}: turn=1 but no legal moves and not game over`);
          stuckGames++;
          gameStuck = true;
          break;
        }
        const pos = legal[Math.floor(Math.random() * legal.length)];
        const _flips = game.get_flips(pos);
        const ok = game.make_move(pos);
        if (!ok) {
          console.error(`Size ${size} Game ${g}: make_move(${pos}) failed for legal move`);
          failures++;
          gameStuck = true;
          break;
        }

        if (!game.is_game_over() && game.current_turn() === 2) {
          let chainCount = 0;
          while (game.current_turn() === 2 && !game.is_game_over()) {
            const boardBefore = game.get_board();
            const move = game.ai_move(2);

            let flipped: number[] = [];
            if (move >= 0 && move < cells) {
              const boardAfter = game.get_board();
              for (let i = 0; i < cells; i++) {
                if (i !== move && boardBefore[i] !== boardAfter[i]) flipped.push(i);
              }
            }

            calls++;
            if (calls > 400) {
              console.error(`Size ${size} Game ${g}: exceeded 400 calls in AI chain`);
              stuckGames++;
              gameStuck = true;
              break;
            }

            if (!game.is_game_over() && game.current_turn() === 2) {
              chainCount++;
              passChains++;
              if (chainCount > 30) {
                console.error(`Size ${size} Game ${g}: pass-chain exceeded 30`);
                stuckGames++;
                gameStuck = true;
                break;
              }
            }
          }
          if (gameStuck) break;
        }
      } else {
        const boardBefore = game.get_board();
        const move = game.ai_move(2);
        let flipped: number[] = [];
        if (move >= 0 && move < cells) {
          const boardAfter = game.get_board();
          for (let i = 0; i < cells; i++) {
            if (i !== move && boardBefore[i] !== boardAfter[i]) flipped.push(i);
          }
        }
      }
    }

    if (!gameStuck && calls > maxCalls) maxCalls = calls;
  }
  console.log(`  Size ${size}: ${GAMES_PER_SIZE} games complete`);
}

const totalGames = SIZES.length * GAMES_PER_SIZE;
console.log(`\n=== UI Flow Test Results ===`);
console.log(`Games: ${totalGames} (sizes: ${SIZES.join(', ')})`);
console.log(`Stuck games: ${stuckGames}`);
console.log(`Failures: ${failures}`);
console.log(`Pass-chain events: ${passChains}`);
console.log(`Max calls in a game: ${maxCalls}`);

if (stuckGames > 0 || failures > 0) {
  console.error(`\nFAILED: ${stuckGames} stuck states, ${failures} failures`);
  process.exit(1);
}

console.log(`\nPASSED: ${totalGames}/${totalGames} games complete, 0 stuck states`);
process.exit(0);
