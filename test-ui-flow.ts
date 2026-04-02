import { Game } from './src/engine';

// Simulates the exact React hook call sequence for 2000 games.
// Two-phase turns: disc phase -> knight phase per turn.

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

    while (!game.isGameOver()) {
      calls++;
      if (calls > 1200) {
        console.error(`Size ${size} Game ${g}: exceeded 1200 calls`);
        stuckGames++;
        gameStuck = true;
        break;
      }

      const turn = game.currentTurn();
      const phase = game.turnPhase();
      const legal = game.getLegalMoves();

      if (turn === 1) {
        // Player turn - act based on phase
        if (legal.length === 0) {
          // Pass - let AI handle
          game.aiMove(1);
          continue;
        }

        if (phase === 'knight') {
          const ok = game.makeKnightMove(legal[Math.floor(Math.random() * legal.length)]);
          if (!ok) {
            console.error(`Size ${size} Game ${g}: knight move failed on legal target`);
            failures++;
            gameStuck = true;
            break;
          }
        } else {
          const pos = legal[Math.floor(Math.random() * legal.length)];
          game.getFlips(pos);
          const ok = game.makeMove(pos);
          if (!ok) {
            console.error(`Size ${size} Game ${g}: disc move(${pos}) failed for legal move`);
            failures++;
            gameStuck = true;
            break;
          }
        }
      } else {
        // AI turn - chain until turn passes to player or game ends
        let chainCount = 0;
        while (game.currentTurn() === 2 && !game.isGameOver()) {
          game.aiMove(2);
          calls++;
          chainCount++;
          if (chainCount > 200) {
            console.error(`Size ${size} Game ${g}: AI chain exceeded 200`);
            stuckGames++;
            gameStuck = true;
            break;
          }
        }
        if (chainCount > 1) passChains++;
        if (gameStuck) break;
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
  console.error(`\nFAILED: ${stuckGames} stuck, ${failures} failures`);
  process.exit(1);
}

console.log(`\nPASSED: ${totalGames}/${totalGames} games, 0 stuck states`);
process.exit(0);