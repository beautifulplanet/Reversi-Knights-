import { Game } from './src/engine';

const GAMES = 2000;
let failures = 0;
let stuckGames = 0;
let passChains = 0;
let maxCalls = 0;

for (let g = 0; g < GAMES; g++) {
  const game = new Game();
  let calls = 0;
  let gameStuck = false;

  while (!game.is_game_over()) {
    calls++;
    if (calls > 200) {
      console.error(`Game ${g}: exceeded 200 calls — stuck`);
      stuckGames++;
      gameStuck = true;
      break;
    }

    const turn = game.current_turn();

    if (turn === 1) {
      // Human move: pick random legal move (simulates playMove)
      const legal = game.get_legal_moves();
      if (legal.length === 0) {
        // Human has no moves — should not happen since advanceTurn handles passes
        console.error(`Game ${g}: turn=1 but no legal moves and not game over`);
        stuckGames++;
        gameStuck = true;
        break;
      }
      const pos = legal[Math.floor(Math.random() * legal.length)];
      const flips = game.get_flips(pos); // called BEFORE make_move per spec
      const ok = game.make_move(pos);
      if (!ok) {
        console.error(`Game ${g}: make_move(${pos}) failed for legal move`);
        failures++;
        gameStuck = true;
        break;
      }

      // After human move, if turn is now 2 (AI), trigger doAiMove
      if (!game.is_game_over() && game.current_turn() === 2) {
        // doAiMove simulation
        let chainCount = 0;
        while (game.current_turn() === 2 && !game.is_game_over()) {
          const boardBefore = game.get_board();
          const depth = 2; // mid difficulty
          const move = game.ai_move(depth);

          let flipped: number[] = [];
          if (move >= 0 && move < 64) {
            const boardAfter = game.get_board();
            for (let i = 0; i < 64; i++) {
              if (i !== move && boardBefore[i] !== boardAfter[i]) flipped.push(i);
            }
          }

          calls++;
          if (calls > 200) {
            console.error(`Game ${g}: exceeded 200 calls in AI chain`);
            stuckGames++;
            gameStuck = true;
            break;
          }

          // If turn is STILL 2, this is a pass-chain
          if (!game.is_game_over() && game.current_turn() === 2) {
            chainCount++;
            passChains++;
            if (chainCount > 30) {
              console.error(`Game ${g}: pass-chain exceeded 30`);
              stuckGames++;
              gameStuck = true;
              break;
            }
          }
        }
        if (gameStuck) break;
      }
    } else {
      // turn === 2 at start of loop — shouldn't happen in normal flow
      // because AI moves are chained after human. But handle gracefully.
      const boardBefore = game.get_board();
      const move = game.ai_move(2);
      let flipped: number[] = [];
      if (move >= 0 && move < 64) {
        const boardAfter = game.get_board();
        for (let i = 0; i < 64; i++) {
          if (i !== move && boardBefore[i] !== boardAfter[i]) flipped.push(i);
        }
      }
    }
  }

  if (!gameStuck && calls > maxCalls) maxCalls = calls;
}

console.log(`\n=== UI Flow Test Results ===`);
console.log(`Games: ${GAMES}`);
console.log(`Stuck games: ${stuckGames}`);
console.log(`Failures: ${failures}`);
console.log(`Pass-chain events: ${passChains}`);
console.log(`Max calls in a game: ${maxCalls}`);

if (stuckGames > 0 || failures > 0) {
  console.error(`\nFAILED: ${stuckGames} stuck states, ${failures} failures`);
  process.exit(1);
}

console.log(`\nPASSED: ${GAMES}/${GAMES} games complete, 0 stuck states`);
process.exit(0);
