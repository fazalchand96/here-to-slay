# Here To Slay — Multiplayer Web Game — Product Specification

> Format: Product Requirements Document (PRD) for automated test generation (TestSprite).
> Scope reflects the **implemented** behavior of this codebase, not the boxed board game.

---

## 1. Product Overview

**Here To Slay (Mobile/Web)** is a real-time, multiplayer online card game. 2–6 players join a
shared lobby, each picks a Party Leader, then take turns playing Hero/Item/Magic cards, using
Hero skills, and attacking Monsters. The first player to **slay 3 Monsters** or **assemble a party
of 6 different classes** wins.

- **Architecture:** Authoritative Node.js server holds **all** game state; browsers are thin
  clients that send *intent* and render server-broadcast snapshots. The client is never trusted.
- **Frontend:** Vanilla-JS Progressive Web App (no framework, no build step), landscape-only,
  installable.
- **Transport:** Socket.IO (WebSocket) for all gameplay; Express serves static assets.

### Primary user value
A friends-group party game playable in the browser with no install, with full enforcement of the
rules on the server so clients cannot cheat.

---

## 2. Tech Stack & Run Instructions

| Aspect | Detail |
| --- | --- |
| Server runtime | Node.js (CommonJS) |
| Server framework | Express 5 + Socket.IO 4 |
| Client | Static HTML/CSS/JS in `public/`, Socket.IO client served at `/socket.io/socket.io.js` |
| Default URL | `http://localhost:3000` (override with `PORT` env var) |
| Start server | `npm start` (runs `node server.js`) |
| Unit tests | `npm test` (`node --test "test/**/*.test.js"`) |
| Headless bot | `npm run bot` / `node bot.js <name> <serverUrl>` |
| Full simulation | `npm run test:simulation` (server + 2 auto-playing bots) |

**Preconditions for testing the UI:** the server must be running and reachable at
`http://localhost:3000`. If it is not, the browser shows `ERR_CONNECTION_REFUSED`. The page
requires the Socket.IO client script to load before `app.js`, otherwise the app throws
`ReferenceError: io is not defined`.

---

## 3. User Roles

| Role | Description |
| --- | --- |
| **Host** | The first player to join the lobby (`playerOrder[0]`). Only the host can start the match. |
| **Player** | Any of the 2–6 connected participants. The player whose turn it is is the **Active Player**. |
| **Active Player** | The player matching `gameState.activePlayerSocketId`; the only one who may spend Action Points on their turn. |
| **Opponent** | Any non-active player. Opponents may participate in the Challenge and Modifier phases. |

There is no authentication; identity is the Socket.IO `socket.id`. Observers are not fully
supported (a 7th+ connection during a game receives "Game is full or already in progress").

---

## 4. Game State Machine

`gameState.state` is a finite state machine. Test transitions between these states:

| State | Meaning |
| --- | --- |
| `LOBBY` | Players joining, naming, and selecting Party Leaders. |
| `PLAYING` | Active player's main turn; spending Action Points. |
| `WAITING_FOR_CHALLENGES` | A Hero/Item/Magic card was played; opponents may play a Challenge card. |
| `WAITING_TO_ROLL_CHALLENGE` | A challenge was issued; both sides roll 2d6. |
| `WAITING_TO_ROLL` | A skill/attack roll is pending. |
| `WAITING_FOR_MODIFIERS` | 15-second window where any player may play Modifier cards on a roll. |
| `WAITING_FOR_SKILL_TARGET` | A Hero skill needs a target (player/hero/card) chosen. |
| `WAITING_FOR_SACRIFICE` | A player must sacrifice a Hero (monster penalty / skill). |
| `WAITING_FOR_DISCARD_PENALTY` | A player must discard cards (monster penalty / skill). |
| `WAITING_FOR_IMMEDIATE_PLAY` | A drawn Hero may be played immediately. |
| `WAITING_FOR_HAND_SELECTION` | Player chooses a card from their hand to play immediately. |
| `WAITING_FOR_GLOBAL_ACTION` / `WAITING_FOR_MULTIPLE_DISCARDS` / `WAITING_FOR_VARIABLE_DISCARD` | Multi-player async sub-actions (e.g., everyone discards/sacrifices). |
| `GAMEOVER` | A win condition was met; auto-resets to `LOBBY` after 5 seconds. |

---

## 5. Core Rules (Constants)

- **Players:** min **2**, max **6**.
- **Starting hand:** **5** cards dealt per player at game start.
- **Action Points (AP):** active player starts each turn with **3 AP** (4 if they have slain the
  Mega Slime monster).
- **AP costs:** play a card = **1 AP**; draw a card = **1 AP**; use a Hero skill = **1 AP**;
  attack a Monster = **2 AP**.
- **Active Monsters:** the board always tries to keep **3** face-up Monsters available.
- **Rolls:** standard skill/attack rolls are **2d6** plus passive bonuses; challenge roll-offs are
  2d6 vs 2d6.
- **Win conditions (checked after every resolving action):**
  1. **Slay 3 Monsters**, OR
  2. **Assemble 6 different classes** across Party Leader + Party Heroes.
- **Card database:** ~115 unique cards in `cards.json` — Party Leaders, Heroes, Items, Cursed
  Items, Magic, Modifiers, Challenges, Monsters.

---

## 6. Functional Requirements & Features

### F1. Lobby & Connection
- **F1.1** On connect during `LOBBY` with < 6 players, the player is added to `players` and
  `playerOrder`; the server emits `lobby_data_update` and `lobby_data`.
- **F1.2** A player may set their display name (`set_player_name`). Empty name defaults to "Player".
- **F1.3** Connecting when the game is full or in progress yields a "Game is full or already in
  progress." message and no seat.
- **F1.4** On any disconnect, the server currently **resets the entire game back to `LOBBY`**.

### F2. Party Leader Selection
- **F2.1** A player rolls a random leader from the shared depleting `availableLeaders` pool
  (`roll_leader`). This sets `hasSelectedLeader = true` and assigns `player.leader`.
- **F2.2** A player may **reroll once** (`reroll_leader`); the old leader returns to the pool and a
  new random one is drawn. `hasRerolledLeader` then blocks further rerolls.
- **F2.3** A player may lock in their current leader (`lock_in_leader`).
- **F2.4** The leader pool is shared and depletes; two players cannot hold the same leader.

### F3. Starting the Game
- **F3.1** The **START** button is shown **only** when: requester is host AND `playerOrder.length >= 2`
  AND **every** player has `hasSelectedLeader === true`.
- **F3.2** `start_game` is rejected (no-op) unless: `state === 'LOBBY'`, requester is
  `playerOrder[0]` (host), and all players have selected a leader.
- **F3.3** On valid start: `loadCards()` rebuilds/shuffles decks, each player is dealt 5 cards, 3
  Monsters spawn, `state → PLAYING`, the first player becomes active with 3 AP.
- **F3.4** `start_game_debug` is a developer bypass that starts the game with no guard checks.

### F4. Turn & Action Points
- **F4.1** Only the player matching `activePlayerSocketId` may take turn actions; every handler
  re-validates this server-side.
- **F4.2** Each AP-spending action decrements AP; actions are rejected when AP is insufficient.
- **F4.3** `end_turn` passes the turn to the next player in `playerOrder` and resets their AP
  (and clears per-turn flags such as `cannotBeChallenged`, `rollBonus`).

### F5. Playing Cards & Challenge Phase
- **F5.1** Playing a Hero, Item, or Magic card first enters `WAITING_FOR_CHALLENGES`
  (`challenge_pending` emitted); opponents may `play_challenge` or `pass_challenge`.
- **F5.2** A Challenge triggers a dual 2d6 roll-off (`WAITING_TO_ROLL_CHALLENGE`); the loser's
  card/challenge is discarded. Resolution emits `challenge_resolved` / `challenge_accepted`.
- **F5.3** If the active player has `cannotBeChallenged` (Iron Resolve), the challenge phase is
  skipped for the rest of their turn.
- **F5.4** Items equip onto a Hero; Cursed Items attach negative effects; Magic resolves an effect
  via the magic engine.

### F6. Roll + Modifier Phase
- **F6.1** Skill and attack rolls open a **15-second Modifier window** (`WAITING_FOR_MODIFIERS`,
  `startModifierTimer`), during which any player may `submit_modifier_action` to play Modifier
  cards (e.g., `+4`, `-4`, `+2/-2`).
- **F6.2** When the window closes (or all pass), `resolvePendingRoll()` computes the final total via
  `calculateRollDetails` (2d6 + passives + modifiers + temporary bonuses) and settles the outcome.
- **F6.3** Roll results are broadcast via `rollResult` / `dice_roll_pending`.

### F7. Hero Skills
- **F7.1** Using a Hero's skill costs 1 AP and routes through `executeSkill(...)` in
  `skill_engine.js`. A hero may use its skill once per turn (`usedSkillThisTurn`).
- **F7.2** Skills that need a target set a `WAITING_FOR_*` state and a `pendingAction`; the client
  responds with `submit_skill_target` / `target_selected`.
- **F7.3** Categories include: self-buffs (Vibrant Glow +5, Wise Shield +3), draws (Peanut +2,
  Wily Red to 7), destroy (Bad Axe), steal (Kit Napper), hand-pull, discard-pile retrieval, and
  multi-player effects (Spooky forces all opponents to sacrifice a Hero).
- **F7.4** Protection/override edge cases the engine must honor:
  - **Terratuga** (slain monster) → the owner's Heroes cannot be destroyed.
  - **Mighty Blade** (`cannotBeDestroyed`) → destroy is blocked.
  - **Calming Voice** (`cannotBeStolen`) → steal is blocked.
  - **Corrupted Sabretooth** → converts the initiator's *destroy* into a *steal*.
  - **Dracos** → when the owner's Hero is destroyed, they draw a card.
- **F7.5** An unrecognized skill id must surface an "Unrecognized skill" message and not corrupt
  state.

### F8. Monster Attacks
- **F8.1** Attacking a Monster (`attackMonster`) costs **2 AP** and requires the player to meet the
  Monster's party requirement (e.g., "2 Heroes").
- **F8.2** The attack is a 2d6 (+passives/modifiers) roll: meeting the **slayRoll** slays the
  Monster (added to `slainMonsters`, grants its passive); a low roll at/under **penaltyRoll**
  triggers the Monster's penalty (e.g., sacrifice a Hero, discard cards).
- **F8.3** Slaying a Monster spawns a replacement so up to 3 remain.

### F9. Magic Cards
- **F9.1** Magic resolves via `executeMagic(...)`. Examples: Enchanted Spell (+2 to rolls),
  Critical Boost (draw 3, discard 1), Forceful Winds (return all equipped Items to hands),
  Call to the Fallen (retrieve a card from the discard pile), Entangling Trap (discard then steal).

### F10. Win, Game Over & Reset
- **F10.1** After every resolving action the server runs `checkWinCondition()`.
- **F10.2** On a win, `state → GAMEOVER` and `game_over { winnerName, reason }` is emitted.
- **F10.3** After **5 seconds**, the match auto-resets to `LOBBY`, preserving connections and
  player order but clearing hands/parties/leaders (`game_reset_complete`).
- **F10.4** `request_game_reset` is only honored when `state === 'GAMEOVER'`.

### F11. State Broadcasting & Privacy
- **F11.1** `broadcastState()` sends a per-socket snapshot: **each player sees their own hand;
  every other hand is masked** to `{ type: 'Hidden' }`. The server must never leak opponents' hand
  contents.

---

## 7. Socket API (Contract for Backend Tests)

### Client → Server events
`request_lobby_data`, `set_player_name`, `roll_leader`, `reroll_leader`, `lock_in_leader`,
`start_game`, `start_game_debug`, `request_game_reset`, `play_item_action`, `playCard`,
`decline_hero_skill`, `use_hero_skill`, `submit_skill_target`, `select_peek_card`,
`submit_global_action`, `resolve_global_action`, `attackMonster`, `execute_roll`,
`submit_modifier_action`, `play_from_hand`, `resolve_immediate_play`, `submit_penalty_sacrifice`,
`submit_penalty_discard`, `play_challenge`, `pass_challenge`, `target_selected`,
`draw_card_action`, `discard_and_draw_five_action`, `use_leader_skill`, `end_turn`, `disconnect`.

### Server → Client events
`gameStateUpdate` (per-socket masked snapshot), `lobby_data`, `lobby_data_update`, `message`,
`rollResult`, `dice_roll_pending`, `challenge_pending`, `challenge_resolved`, `challenge_accepted`,
`heroPlayedPrompt`, `global_action_requested`, `global_action_resolution`, `peek_cards`,
`game_over`, `game_reset_complete`, `error`.

---

## 8. Key User Flows (End-to-End Test Scenarios)

### Flow A — Happy path: lobby to game start
1. Two browsers open `http://localhost:3000`.
2. Each player sets a name.
3. Each player clicks **ROLL FOR LEADER** (`hasSelectedLeader` becomes true).
4. Host's **START** button appears; host clicks it.
5. **Expected:** `state` becomes `PLAYING`, each player holds 5 cards, 3 Monsters are visible, the
   first player has 3 AP.

### Flow B — Start guards
1. Only one player in the lobby.
2. **Expected:** START button is hidden; lobby shows "Waiting for more players… (Need at least 2)".
3. Two players present but one has not rolled a leader.
4. **Expected:** START hidden; "Waiting for all players to select a leader…".
5. A non-host attempts `start_game`.
6. **Expected:** no-op; game stays in `LOBBY`.

### Flow C — Play a card through the challenge phase
1. Active player plays a Hero card.
2. **Expected:** `state` → `WAITING_FOR_CHALLENGES`, `challenge_pending` emitted.
3. An opponent passes; the Hero resolves into the party. (Or challenges → 2d6 roll-off resolves.)

### Flow D — Skill with protection override
1. Active player uses **Bad Axe** (destroy) targeting an opponent Hero protected by Mighty Blade.
2. **Expected:** Hero is NOT destroyed; a "protected by Mighty Blade" message is emitted.
3. Repeat with the initiator holding Corrupted Sabretooth.
4. **Expected:** the destroy becomes a **steal** (Hero moves to initiator's party).

### Flow E — Attack a Monster
1. Active player with a qualifying party attacks a Monster (2 AP).
2. Modifier window opens; players may add Modifiers.
3. **Expected:** on a slay roll the Monster moves to `slainMonsters` and a new Monster spawns; on a
   penalty roll the Monster's penalty applies.

### Flow F — Win and auto-reset
1. A player reaches 3 slain Monsters or 6 classes.
2. **Expected:** `game_over` emitted with the winner and reason; after 5 seconds the game returns to
   `LOBBY` with connections preserved.

### Flow G — Hand privacy
1. Two players in a game.
2. Inspect the `gameStateUpdate` each receives.
3. **Expected:** each player sees their own hand cards; the other player's cards are `{ type: 'Hidden' }`.

### Flow H — Disconnect handling
1. During a game, one player disconnects.
2. **Expected:** the game resets to `LOBBY` (current behavior).

---

## 9. Validation / Security Rules (Negative Tests)

The server is authoritative; every one of these MUST be rejected server-side:

- N1. A non-active player attempting any turn action (play card, attack, skill, draw, end turn).
- N2. Any action that would spend more AP than the active player has.
- N3. `start_game` from a non-host, or with < 2 players, or before all leaders are selected.
- N4. `roll_leader` / `reroll_leader` outside `LOBBY`, or a second `reroll_leader`.
- N5. Targeting a non-existent player/hero/card id in a skill.
- N6. `attackMonster` without meeting the Monster's party requirement.
- N7. `request_game_reset` when not in `GAMEOVER`.
- N8. Any path that would reveal an opponent's hidden hand contents in a broadcast.
- N9. A 7th player joining a 6-player lobby, or any player joining a game already in progress.

---

## 10. Non-Functional Requirements

- **NFR1 (PWA):** Installable; service worker (`sw.js`) precaches the app shell. App-shell code
  (JS/CSS) is served **network-first** so fresh code wins online; heavy assets (images/sounds/fonts)
  are cache-first. Bump `CACHE_VERSION` when the shell changes.
- **NFR2 (Orientation):** Mobile UI is **landscape-only**; a rotation-lock overlay prompts portrait
  users to rotate.
- **NFR3 (Real-time):** All gameplay updates propagate over WebSocket; no page reload required.
- **NFR4 (Resilience):** A full simulation (server + 2 bots) plays multiple complete matches —
  challenge duels, skills, magic, monster attacks, game-over, and reset — without crashes or logic
  lockups.
- **NFR5 (No build step):** The client is plain HTML/CSS/JS; there is no bundler or transpiler.

---

## 11. Acceptance Criteria Summary

1. A 2-player lobby can reach `PLAYING` via the happy-path flow.
2. All start guards (host-only, ≥2 players, all leaders selected) are enforced.
3. AP accounting is correct for play/draw/skill (1) and attack (2), and over-spend is rejected.
4. Challenge and Modifier phases open and resolve correctly with their roll-offs/windows.
5. Hero skills apply, including the Terratuga / Mighty Blade / Calming Voice / Sabretooth / Dracos
   overrides, and unrecognized skills fail safely.
6. Monster attacks slay/penalize per slayRoll/penaltyRoll and keep 3 monsters active.
7. Either win condition ends the game, emits `game_over`, and auto-resets after 5s.
8. Opponent hand contents are never leaked in any broadcast.
9. The app loads at `http://localhost:3000` with no `io is not defined` error when the server is up.
