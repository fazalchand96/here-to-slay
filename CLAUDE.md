# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A real-time multiplayer implementation of the **"Here to Slay"** card game. An authoritative Node.js/Socket.IO server holds all game state; browsers connect as thin clients. The frontend is a vanilla-JS PWA (no framework, no build step).

## Commands

```powershell
npm start              # run the server (node server.js) on PORT or 3000
npm test               # unit tests — node --test "test/**/*.test.js"
npm run bot            # connect one headless AI bot to localhost:3000
npm run test:simulation # start server + 2 bots that auto-play full games
node bot.js <name> <serverUrl>   # bot against a specific server
```

Run a single test file: `node --test test/skill_engine.test.js`

**Test-runner gotcha:** always keep the `test/**/*.test.js` glob. The repo root contains ad-hoc scripts named `test.js`, `test2.js`…`test6.js`, `test-client.js`, `test_render.js` that are NOT unit tests — some open a socket to a running server and will hang `node --test`. Bare `node --test` (or `node --test test/` with a trailing slash) matches root `test.js` instead of the real suite. Real unit tests live in `test/`.

There is no linter or build step configured.

## Architecture

**Server is authoritative.** All game logic and the full `gameState` live in `server.js`. Clients only send intent (socket events) and render whatever state the server broadcasts. Never trust the client; every handler re-validates `socket.id === gameState.activePlayerSocketId`, AP cost, card ownership, etc.

### Core files

- **`server.js`** (~2000 lines) — the whole backend: the single global `gameState` object, all `socket.on(...)` event handlers, the turn/roll/challenge state machine, deck/card loading, win-condition checks, and the modifier timer. This is where almost all game-flow changes go.
- **`skill_engine.js`** — `executeSkill(gameState, io, skillId, rollerId, heroId, targetData)` and `executeMagic(...)`. A large `switch` on `skill_id` / `effect_id` that applies each Hero skill and Magic card's effect (mutating `gameState`, emitting via `io`). This is the primary place to add/fix individual card behaviors. It's written to be testable in isolation: handlers take a mock `io` that records `emit` calls plus a hand-built `gameState`.
- **`card_effects.js`** — `resolveSkill` / `resolveMagic`. An older, partial effect resolver (hardcoded proof-of-concept cases like Peanut/Heavy Bear/Forceful Winds). Still `require`d by `server.js` but largely superseded by `skill_engine.js`. Prefer adding new effects to `skill_engine.js`.
- **`cards.json`** — the entire card database (~115 unique cards): Party Leaders, Heroes, Items/Cursed Items, Magic, Modifiers, Challenges, Monsters. `loadCards()` reads this at startup and on each new match, splits cards into `availableLeaders` / `monsterDeck` / `mainDeck`, and shuffles. Each card has a stable `id` (e.g. `card_001`) and an `effect_id` / `skill_id` that the engines switch on.
- **`bot.js`** — a headless `socket.io-client` AI used for simulation/coverage testing. It mirrors `meetsMonsterRequirements` from the server and auto-plays. The server tracks `trackedCardsPlayed` against a target of 115 unique cards and logs simulation progress on each game over.
- **`public/`** — the client: `app.js` (~2600 lines, single `const socket = io()`), `index.html`, `style.css`, `sw.js` (service worker), `manifest.json` (installable PWA, landscape-only mobile UI).

### Game-state model

`gameState` is one mutable object with a `state` field acting as a finite state machine. Key states: `LOBBY`, `PLAYING`, `WAITING_TO_ROLL`, `WAITING_FOR_MODIFIERS`, `WAITING_FOR_CHALLENGES`, `WAITING_TO_ROLL_CHALLENGE`, `WAITING_FOR_SKILL_TARGET`, `WAITING_FOR_SACRIFICE`, `WAITING_FOR_DISCARD_PENALTY`, `WAITING_FOR_IMMEDIATE_PLAY`, `WAITING_FOR_HAND_SELECTION`, `GAMEOVER`. Multi-step skills queue work via `pendingAction` / `pendingRoll` / `pendingChallenge` / `pendingGlobalAction` and a `nextAction` chain.

`broadcastState()` sends a per-socket customized snapshot — **each player's own hand is visible, every other player's hand is masked** to `{ type: 'Hidden' }`. Use it (not raw `io.emit('gameStateUpdate', gameState)`) whenever hand contents could change, or you'll leak hands.

### Typical play flow

1. **Lobby:** players join (max 6), set name, roll/reroll/lock-in a Party Leader from the shared depleting `availableLeaders` pool. Host (first in `playerOrder`) starts once all have a leader.
2. **Turn:** active player gets AP (default 3, 4 with Mega Slime). Playing a card / drawing / using a Hero skill costs 1 AP; attacking a monster costs 2.
3. **Challenge phase:** Heroes, Items, and Magic enter `WAITING_FOR_CHALLENGES` first — any opponent may play a Challenge card, triggering a dual d6+d6 roll-off (`WAITING_TO_ROLL_CHALLENGE`) before the card resolves.
4. **Roll + modifier phase:** skill/attack rolls are 2d6 plus passives (`calculateRollDetails`). The roll opens a 15s window (`startModifierTimer`) where any player may play Modifier cards (`WAITING_FOR_MODIFIERS`) before `resolvePendingRoll()` settles the outcome.
5. **Win check** after every resolving action: **slay 3 monsters** or **assemble 6 different classes** (leader + party).

### Effect-id conventions

Passive and active behaviors are keyed by string IDs on cards, switched on throughout `server.js` and `skill_engine.js`: `LEADER_*` (party-leader passives, e.g. `LEADER_WIZARD`), `MONSTER_*` (slain-monster passives, e.g. `MONSTER_REX_MAJOR`), `ITEM_*` / `CURSE_*` (equipped item effects), `SKILL_*` (Hero skills), `MAGIC_*` (Magic cards). When adding a card, give it a unique `effect_id`/`skill_id` in `cards.json` and a matching `case` in the relevant engine; also register it in the appropriate targeting list at the top of `server.js` (`TARGETING_SKILLS`, `PLAYER_TARGETING_SKILLS`, `DISCARD_TARGETING_SKILLS`, etc.) if it needs the client to pick a target.

## Notes

- `server.js` contains many `console.log('[DEBUG]…')` lines and verbose logging — these are intentional simulation/debugging aids, not dead code.
- The repo root holds numerous throwaway maintenance scripts (`patch_*.js`, `refactor_*.js`, `fix_*.js`, `audit_cards.js`, `scrape_items.js`, `build_accurate_deck.js`) used to bulk-edit `cards.json` and the client files. They are one-off tooling, not part of the runtime.
- On player disconnect the server currently resets the entire game back to `LOBBY` (observers are not fully supported).
