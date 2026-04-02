# Reversi Knights ♞

**Reversi with a twist — each player commands a chess knight that moves every turn, flipping opponent discs on landing. Pure TypeScript. Zero dependencies beyond React. Variable board sizes from 4×4 to 16×16.**

### 🎮 [Play it live → beautifulplanet.github.io/Reversi-Knights-](https://beautifulplanet.github.io/Reversi-Knights-/)

### Impact

- **Playable right now** — [live on GitHub Pages](https://beautifulplanet.github.io/Reversi-Knights-/) or `npm run dev` locally. No install, no account, no loading screen.
- **Custom AI engine in pure TypeScript** — minimax with alpha-beta pruning, positional weight tables, 50K node budget. AI responds in <10ms on 8×8.
- **Novel game mechanic** — persistent chess knights add a second layer of strategy to classic Reversi. Each turn: place a disc, then move your knight in an L-shape. Landing flips via Reversi sandwich rules (line-tracing, not adjacent). Knights can capture each other chess-style.
- **2,200+ automated test games, zero failures** — 200-game engine test + 2,000-game UI flow simulation + knight capture regression tests. Every commit is verified.

**Stack:** TypeScript · React · HTML5 Canvas · Vite

### Evidence

| Claim | Proof |
|---|---|
| 200 AI games, 0 failures, AI <10ms | `npx tsx test-engine.ts` |
| 2,000 UI flow games, 0 stuck states | `npx tsx test-ui-flow.ts` |
| Zero type errors | `tsc --noEmit` |
| Production build succeeds | `npm run build` |
| CI pipeline | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |
| Knight capture tests | `npx tsx test-knight-captures.ts` |
| Deployed | [beautifulplanet.github.io/Reversi-Knights-](https://beautifulplanet.github.io/Reversi-Knights-/) |
| 32 issues tracked (20 closed, 12 open) | [Issues →](https://github.com/beautifulplanet/Reversi-Knights-/issues?q=is:issue) |

### Quality Bar

- **200-game engine stress test** — random + AI games across board sizes (8×8, 10×10), validates move legality, flip correctness, game termination, and AI speed (<50ms budget)
- **2,000-game UI flow simulation** — exercises the exact React hook call sequence (startGame → playMove → AI chain → pass handling → game over), catches stuck states and stale closures
- **TypeScript strict mode clean** — `tsc --noEmit` with zero errors on every commit
- **GitHub Actions CI** — all 4 gates run on every push and PR to `main` (tsc, engine, UI flow, knight captures)

### Ownership & Quality

Scaffolded with AI assistance (GitHub Copilot in VS Code). Every change reviewed, tested, and verified against automated gates before pushing.

- **Role:** Solo builder — design, implementation, testing
- **Standard:** No change lands without all 3 test gates passing
- **AI policy:** AI-assisted code is allowed. I verify every change with automated tests. I can explain and extend every component.

---

## How to Read This README

### If you're evaluating the candidate

| What you want | Where to find it | Time |
|---|---|---|
| See it running | `npm run dev` → `http://localhost:5173` | 30 sec |
| Stack + resume bullets | [Impact ↑](#impact) | 30 sec |
| Proof (tests, CI) | [Evidence ↑](#evidence) | 1 min |
| Architecture | [Architecture ↓](#architecture) | 1 min |
| Technical FAQ | [FAQ ↓](#technical-faq) | 2 min |

### If you want to run it

| What you want | Where to find it | Time |
|---|---|---|
| Clone + play | [Quick Start ↓](#quick-start) | 2 min |
| Run all tests | [Testing ↓](#testing) | 1 min |
| Understand the engine | [Engine Internals ↓](#engine-internals) | 5 min |

---

## Quick Start

### Prerequisites

- **Node.js 18+**
- **npm 9+**

### Play the game

```bash
git clone https://github.com/beautifulplanet/Reversi-Knights-.git
cd Reversi-Knights-
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). That's it.

### Run tests

```bash
npm test                          # Both test suites
npx tsx test-engine.ts            # 200 AI games
npx tsx test-ui-flow.ts           # 2,000 UI flow simulations
```

### Build for production

```bash
npm run build                     # TypeScript check + Vite → dist/
```

---

## Game Rules

### Classic Reversi

- Place a disc to bracket and flip opponent pieces in any of 8 directions
- A move must flip at least one opponent piece
- If you have no legal moves, your turn is passed
- Game ends when neither player can move
- Most discs wins

### The Knight Twist

- Both players have a **persistent chess knight** on the board
- Black's knight starts at top-left corner; White's at bottom-right
- Each turn has **two phases**: place a disc, then move your knight
- Knights move in **L-shapes** (chess knight movement: 2+1 squares)
- When a knight lands, it **flips opponent discs using Reversi sandwich rules** — traces lines in 8 directions, flipping all bracketed opponent pieces
- Knights can **capture the opponent's knight** by landing on its cell (chess-style take)
- Knights cannot be flipped by normal disc moves and block disc placement on their cell
- If a knight is surrounded on all 4 orthogonal sides by opponent discs, it is **captured and removed**

### Board Sizes

Choose 8×8, 10×10, 12×12, or 16×16 from the lobby. AI adapts its positional evaluation to any board size.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                     Browser                      │
│                                                  │
│  ┌──────────┐   ┌─────────────────┐              │
│  │  App.tsx  │   │  ReversiBoard   │              │
│  │  (Lobby)  │──▶│  (Canvas)       │              │
│  └─────┬────┘   └────────┬────────┘              │
│        │                 │                        │
│        ▼                 │ click events            │
│  ┌─────────────────┐     │                        │
│  │ useReversiEngine │◀───┘                        │
│  │   (React Hook)   │                             │
│  └────────┬─────────┘                             │
│           │                                       │
│           ▼                                       │
│  ┌─────────────────┐                              │
│  │   engine.ts     │                              │
│  │  (Game + AI)    │                              │
│  └─────────────────┘                              │
└──────────────────────────────────────────────────┘
```

### 6 Source Files

| File | Lines | Responsibility |
|---|---|---|
| `engine.ts` | 834 | Game state, move validation, flip logic, minimax AI, chess-hybrid knight AI, knight captures |
| `ReversiBoard.tsx` | 250 | Canvas renderer — board, discs, knight pieces (♞ overlay), flip/drop animations, click handling |
| `useReversiEngine.ts` | 192 | React hook — state management, AI scheduling with chain guard, two-phase turn flow, undo |
| `App.tsx` | 95 | Lobby (mode, difficulty, board size), game chrome (scores, status, phase indicator, undo button) |
| `global.css` | 252 | Responsive layout, dark theme, lobby styling, phase labels |
| `main.tsx` | 4 | React root mount |

### 2 Test Files

| File | Lines | What it tests |
|---|---|---|
| `test-engine.ts` | 99 | 200 random+AI games across board sizes — move legality, flip correctness, termination, AI speed |
| `test-ui-flow.ts` | 98 | 2,000 games exercising the exact hook call sequence — pass chains, stuck states, game completion |
| `test-knight-captures.ts` | 117 | Knight regression tests — sandwich flips, friendly anchor recognition, score counting, disc-through-knight flips |

---

## Engine Internals

### Board Representation

Flat `number[]` array indexed by `row * size + col`. Values: `0` = empty, `1` = black disc, `2` = white disc, `3` = black knight, `4` = white knight. All engine functions recognize `color + 2` as a friendly piece for sandwich anchoring.

Position weights are mirror-symmetric per board size, generated once and cached:
- Corners: +100
- X-squares (diagonal to corner): -50
- C-squares (adjacent to corner): -20
- Edges: +10
- Near edges: -2

### Move Validation

`hasFlips(board, pos, player, size)` — scans all 8 directions from the target cell. Requires at least one opponent piece bracketed by a friendly piece. O(8 × size) worst case.

### AI Search

Minimax with alpha-beta pruning:
- **Depth:** 1–6 (maps to difficulty setting)
- **Node budget:** 50,000 (hard cap prevents runaway on large boards)
- **Move ordering:** corners first, then by positional weight (descending)
- **Evaluation:** positional weights + corner control + X/C-square penalty + disc difference (phase-dependent blending)

### Knight AI

Two-phase AI per turn:
1. **Disc phase:** standard minimax selects best disc move
2. **Knight phase:** chess-hybrid evaluation — scores each L-shape destination using minimax lookahead (depth 2), flip count, positional weight, capture bonus (+300), capture risk penalty, and anti-oscillation tracking

### Key Design Decisions

| Decision | Rationale |
|---|---|
| Pure TypeScript, no WASM | Simplicity. <10ms AI on 8×8 makes WASM unnecessary for this scale. Previous WASM attempt caused 5 rewrite cycles from bridge bugs. |
| Canvas, not DOM | 60fps flip animations. DPR-aware rendering. Single draw call per frame. |
| Refs for stale closure prevention | React hooks close over stale state. Every callback reads from refs, not state. |
| No `useEffect` for AI | AI is triggered by explicit `setTimeout` after state updates, not by effect dependencies. Prevents double-fire in StrictMode. |
| Pre-allocated move buffers | `_moveBufs` array of `Int16Array` indexed by depth. Zero allocation during search. |
| Phase-dependent evaluation | Early game: positional weight dominant. Late game: disc count dominant. Crossover at 30%–75% board fill. |

---

## Testing

### Engine Test (200 games)

Runs 200 games: 100 random-vs-random + 100 AI-vs-AI at depths 1–4, alternating between 8×8 and 10×10 boards. Validates:
- Every move flips at least one piece
- Game terminates (no infinite loops)
- AI responds in <50ms
- Board state is consistent after every move

```
PASSED: 200/200 games complete, 0 failures
Max AI time: 3.5ms
```

### UI Flow Test (2,000 games)

Simulates 2,000 games using the exact function call sequence that the React hook produces. Exercises:
- `startGame()` → `playMove()` → AI auto-chain → pass handling → `is_game_over()`
- Two-phase turns (disc + knight) in correct order
- Pass-chain resolution (opponent has no moves → current player goes again)
- Game completion (no stuck states)

```
PASSED: 2000/2000 games, 0 stuck states
Pass-chain events: 46,674
```

### CI Pipeline

GitHub Actions runs on every push and PR to `main`:

| Step | Gate |
|---|---|
| `tsc --noEmit` | Zero type errors |
| `npx tsx test-engine.ts` | 200/200 games pass |
| `npx tsx test-ui-flow.ts` | 2000/2000 games pass |
| `npx tsx test-knight-captures.ts` | Knight regression suite passes |
| `npm run build` | Production build succeeds |

---

## Development History

### Issues Resolved (20 closed)

| # | Type | Title |
|---|---|---|
| 1 | Feature | Variable board sizes (8/10/12/16) |
| 2 | Feature | Undo button with history stack |
| 3 | Feature | Knight disruptor piece — persistent, chess-like movement |
| 4 | Bug | Missing `vite-env.d.ts` — CSS imports failed |
| 5 | Bug | `drawColor` type annotation and unused parameter |
| 6 | Bug | Hook called non-existent engine methods |
| 7 | Bug | Knight cooldown prevented every-turn movement |
| 8 | Bug | Knight mode showed dots on ALL empty cells |
| 9 | Bug | Manual knight toggle conflicted with automatic phase system |
| 10 | Bug | Games stuck in infinite pass-chains with knight moves |
| 11 | Bug | Knights rendered as regular discs (invisible) |
| 12 | Feature | CI pipeline (GitHub Actions) |
| 13 | Enhancement | Dead code: `_moveCounts` removed |
| 14 | Enhancement | Redundant `xCorner` simplified |
| 21 | Feature | Deploy to GitHub Pages |
| 22 | Bug | Knight used 1-adjacent flip instead of Reversi sandwich rules |
| 23 | Bug | `countDiscs` excluded knight cells from score display |
| 24 | Bug | `hasFlips`/`applyMoveInPlace` treated knights as walls |
| 25 | Bug | `evaluate()` was blind to knight positions |
| 26 | Bug | `getFlips` (UI) didn't recognize knights as sandwich anchors |

### Open Issues (12 remaining)

| # | Priority | Title |
|---|---|---|
| 15 | P3-LOW | Magic numbers in evaluation |
| 16 | P3-LOW | AI chain recursion guard |
| 17 | P2-MED | `getCellSize` mobile viewport |
| 18 | P3-LOW | snake_case vs camelCase API |
| 19 | P2-MED | AI knight evaluation depth |
| 20 | P2-MED | Animation interruption glitch |
| 27 | P3-LOW | Dead `_moveCounts` duplicate issue |
| 28 | P2-MED | `newGame()` resets to 8×8 |
| 29 | P1-HIGH | AI knight strategic mission |
| 30 | P2-MED | Save game system |
| 31 | P1-HIGH | AI chess-hybrid knight algorithm |
| 32 | P1-HIGH | Active knight capture (chess-style takes) |

Full issue history: [github.com/beautifulplanet/Reversi-Knights-/issues](https://github.com/beautifulplanet/Reversi-Knights-/issues?q=is:issue)

---

## Technical FAQ

| Question | Short Answer |
|---|---|
| Why pure TypeScript instead of WASM? | <10ms AI makes WASM unnecessary. Previous WASM attempt caused 5 rewrite cycles from bridge bugs (GC, StrictMode, alloc churn). |
| How does the AI work? | Minimax with alpha-beta pruning, depth 1–6, 50K node cap. Move ordering by positional weights. Phase-dependent evaluation blends position vs disc count. |
| How do you prevent stale closures in React? | Every callback reads from refs (`gameRef`, `modeRef`, `difficultyRef`), not from state captured at render time. |
| Why canvas instead of DOM? | 60fps flip animations. Single draw call per frame. DPR-aware. DOM would require 64–256 elements with individual transforms. |
| How does the knight mechanic work? | Persistent piece, L-shape movement every turn. Landing flips via Reversi sandwich rules (same line-tracing as disc moves). Can capture opponent's knight by landing on it. Two-phase turns: disc → knight. |
| How do you handle variable board sizes? | `getSizeData(size)` generates and caches positional weights, corner/edge indices, and move ordering for any even size 4–16. Flat `Int8Array` board, same engine code for all sizes. |
| What would you do differently? | Web Worker for AI on 16×16. Deeper knight evaluation (full integrated minimax). E2E tests with Playwright. Save/load games with tamper-resistant serialization. |
| How do you test a game? | 200-game engine stress test + 2,000-game UI flow simulation. Both are deterministic replay of the exact function call sequence. CI runs on every push. |

---

## Key Numbers

| Metric | Value |
|---|---|
| Source files | 6 (+ 2 test files) |
| Total source lines | ~1,628 |
| Engine lines | 834 |
| Test games (engine) | 200, 0 failures |
| Test games (UI flow) | 2,000, 0 stuck states |
| Max AI response (8×8) | 3.5ms |
| Board sizes | 4×4, 6×6, 8×8, 10×10, 12×12, 14×14, 16×16 |
| AI depth range | 1–6 |
| Node budget | 50,000 |
| GitHub issues | 32 (20 closed, 12 open) |

---

## License

[MIT](LICENSE)

---

*Built with TypeScript and React. 2,200 automated test games. Zero WASM. One `<canvas>`. Two chess knights.*
