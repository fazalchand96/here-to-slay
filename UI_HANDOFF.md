# UI Handoff — Here to Slay (mobile PWA)

Factual snapshot of the visual layer as it exists in this repo, for a UI overhaul. Everything below was read from the code on 2026-06-19. Where something is uncertain or absent, it is flagged explicitly. **Nothing here is aspirational — it describes the current state.**

> TL;DR: There is **no UI framework**. The client is a single hand-written `public/app.js` (3045 lines) that builds the DOM with template-literal strings and `innerHTML`, styled by one `public/style.css` (2688 lines) plus pervasive inline styles. State is **100% server-authoritative** over Socket.IO; the client only renders snapshots and emits intent. A visual overhaul = rewriting `index.html` structure, the `renderCard`/`renderBoard` string builders, and `style.css` — **without** changing the socket event contract or any server file.

---

## 1. Stack & tooling

- **Framework:** None. Plain vanilla JavaScript (browser ES, **not** TypeScript — files are `.js`, no JSX, no `.ts`/`.tsx` anywhere). **Not** React / React Native / Expo. It is a **web** app (runs in a mobile browser, installable as a PWA). There is no native build.
- **Client entry:** `public/index.html` → loads `public/app.js` directly via `<script src="app.js">`. Also pulls `/socket.io/socket.io.js` (served by the server) and `canvas-confetti` from a CDN.
- **Build/bundler:** **None.** No webpack/vite/rollup/babel, no transpile, no minify. "Build" = edit the file and reload. (`package.json` has no build script; `CLAUDE.md` states "no build step".)
- **Server:** Node + Express + Socket.IO (`server.js`). Express serves the client statically: `app.use(express.static(path.join(__dirname, 'public')))`. Run with `npm start` (`node server.js`, port `process.env.PORT || 3000`).
- **Styling approach:** A single plain **CSS file** (`public/style.css`) using **CSS custom properties** (`:root` variables) for a handful of theme colors, **plus heavy inline `style="..."`** in `index.html` and inside JS template strings. No Tailwind, no CSS modules, no styled-components, no CSS-in-JS library.
  - Real example (from `style.css`):
    ```css
    .glass-panel {
        background: var(--glass-bg);
        border: 1px solid var(--glass-border);
        backdrop-filter: blur(15px) !important;
        border-radius: 12px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.8), 0 0 10px rgba(217, 119, 6, 0.1) !important;
        padding: 40px;
        text-align: center;
        animation: fadeIn 0.5s ease-out;
    }
    ```
  - Inline-style example (from `index.html`): `<button ... style="background: #ef4444; margin-top: 15px; width: 200px; align-self: center;">Close</button>`
- **State management:** No library and no reactive system (no Redux/Zustand/Context — there is no framework to host them). Client state is a few **module-scoped globals** in `app.js`, mirrored onto `window`:
  - `let myId` (your socket id), `let latestGameState` / `window.latestGameState` (last server snapshot), `let previousGameState`.
  - Transient UI/targeting flags: `isTargetMode`, `myTargetMode`, `isSkillTargeting`, `isMultiTargeting`, `isLocalTargeting`, `isSelfItemTargeting`, `currentPendingAction`, `pendingHeroSkillCard`, `multiTargetSelected`.
  - The UI re-renders by **manually calling `renderBoard(data)`** on each `gameStateUpdate` (and after local UI actions). There is no diffing — it replaces `innerHTML` wholesale.

---

## 2. Existing design tokens

- **Location:** `public/style.css`, `:root` block at the very top (lines 1–15). This is the only token block. Actual values:
  ```css
  :root {
      --primary: #fbbf24;          /* Amber/Gold */
      --accent: #d97706;           /* Darker Amber/Copper */
      --background-dark: #0f172a;
      --glass-bg: rgba(15, 10, 5, 0.7) !important;
      --glass-border: rgba(217, 119, 6, 0.25) !important;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --danger: #ef4444;
      --success: #10b981;
      --warning: #f59e0b;
      --info: #38bdf8;
  }
  ```
- **Theme system:** Only **partial.** These ~11 color variables exist, but:
  - **Many colors are hardcoded** throughout `style.css` and inline (`#ef4444`, `#10b981`, `#ffd700`, `#f59e0b`, `#d97706`, `#1e1b4b`, etc.), frequently duplicating the variable values rather than referencing them.
  - **There are NO tokens for spacing, radii, or typography scales.** Radii (`12px`, `8px`), gaps, and padding are hardcoded per-rule and inline. Spacing is ad-hoc px values.
  - PWA theme colors live in `index.html` (`<meta name="theme-color" content="#1e1b4b">`) and `manifest.json` (`background_color: #0f172a`, `theme_color: #1e1b4b`).
- **Fonts — FLAG (discrepancy):** `index.html` imports **Outfit, Cinzel, EB Garamond** from Google Fonts. But `style.css` sets `body { font-family: 'Montserrat', sans-serif; }` (line 40) and one rule uses `'Inter'` (line 487) — **neither Montserrat nor Inter is imported**, so they fall back to the system sans-serif. `Outfit` (e.g. lines 1768, 1949), `Cinzel` (139, 2888), and `EB Garamond` (168) are imported and do apply. A redesign should decide the real type system; today the base body font is effectively system sans-serif, not Montserrat.

---

## 3. Component inventory (UI layer)

There is **no component system.** "Components" are either (a) static `<div>` elements in `index.html` with fixed IDs that get populated via `innerHTML`, or (b) HTML produced by string-builder functions in `app.js`. Editing a card/modal's visuals means editing a template literal and/or CSS class — there is no isolated component to swap.

**The one card renderer (all card types):**
- `renderCard(card, isMine, inHand, isMonster, isMyTurn, inlineStyle)` — `app.js:627`. Produces the `.card` markup for **every** card type (Hero, Party Leader, Monster, Item/Cursed Item, Magic, Modifier, Challenge) and the face-down `.card-back` for hidden/opponent cards. Output structure:
  ```html
  <div class="card {glowClasses}" id="{id}" data-id="{id}">
    <div class="card-img" style="background-image:url(...)"></div>
    {equippedBadge}                       <!-- .equipped-item-thumb for heroes with an item -->
    <div class="card-info">
      <div class="card-name">…</div>
      <div class="card-type">…</div>
      <div class="card-class">…</div>      <!-- heroes/leaders only -->
      <div class="card-req">…</div>        <!-- "8+" or "Slay: X+ | Fail: Y-" -->
    </div>
  </div>
  ```
  Dynamic CSS classes it adds: `valid-target`, `valid-target-steal`, `valid-target-equip`, `active-skill-glow`, `attackable-monster`. These drive targeting highlights — see §6.
- `renderBoard(data)` — `app.js:1457`. The master render: rebuilds the opponents bar, your party, your hand, monsters, deck/discard, and toggles the in-board panels. Runs on every state update.

**Board/card open + helper renderers (`app.js`):** `openOpponentModal` (798), `closeOpponentModal` (924), `openDiscardViewer` (942), `openDiscardSearch` (4088), `inspectCard` (4661), `openPoolSelection` (4162), `showNotification` (3707), `logEvent` (3728), `oppModalSignature` (906, dedupe guard).

**Modal / panel elements (defined in `index.html`, populated by JS):**
| Element id | Purpose |
|---|---|
| `lobby-modal` | Lobby screen (name entry, leader selection grid, start button) |
| `rotation-lock-overlay` | "Landscape only" portrait blocker |
| `app-container` / `game-board` | The in-game screen wrapper |
| `opponents-bar` | Top row of opponent summary chips |
| `player-controls` (`.action-bar`) | BOARD / DRAW / RELOAD / END buttons + AP display |
| `player-zone` → `player-party`, `player-hand` | Your party cards and hand cards |
| `event-console` | Right-side panel hosting the panels below + chat |
| `skill-prompt-modal` | "Use Skill?" (YES/NO) prompt |
| `modifier-modal` | Play-a-Modifier prompt |
| `challenge-modal` | Play-a-Challenge prompt (`challenge-play-btn`, `challenge-pass-btn`) |
| `dice-overlay` | Dice roll UI (`die1`, `die2`, `manual-roll-btn`, `dice-pass-btn`) |
| `event-console-empty` / `event-log` / `chat-panel` | Game chat / event log |
| `inspector-modal` | Card detail + dynamic action buttons (`inspector-modal-actions`) |
| `opponent-modal` | Full view of an opponent's party/leader |
| `board-modal` | Monsters, main deck, discard pile (opened via BOARD button) |
| `discard-search-modal`, `discard-viewer-modal`, `deck-peek-modal` | Discard search / read-only discard / deck-peek |
| `mandatory-discard-modal`, `global-resolution-modal`, `immediate-play-modal` | Forced discard / pool-pick / play-immediately prompts |
| `victory-modal`, `gameover-screen`, `target-banner`, `notification-area` | Win screen, game-over, targeting banner, toasts |

> Note: monsters, main deck, and discard pile are **not** persistently on the board — they live inside `board-modal`, opened via the "BOARD" button. A redesign may want them always-visible; that's a layout change, not a data change.

---

## 4. Layout & screens

- **Two top-level screens**, toggled by the `.hidden` class:
  1. `#lobby-modal` — name input, shared depleting **leader-selection grid** (`#leader-selection-container`), player list (`#lobby-players`), start button (`#start-game-btn`).
  2. `#app-container` → `#game-board` — the play screen.
- **Game board structure** (`index.html` ~157–374), top→bottom:
  - `#opponents-bar` (opponent chips)
  - `.action-bar #player-controls` (BOARD / DRAW(-1 AP) / RELOAD(-3 AP) / END buttons, AP display, turn indicator, waiting overlay)
  - `#player-zone`, split into:
    - `#player-assets` → `#party-zone`(`#player-party`) + `#hand-zone`(`#player-hand`)
    - `#event-console` → the dice/modifier/challenge/skill panels + chat log
- **Orientation: landscape-only.**
  - `manifest.json` → `"orientation": "landscape"`.
  - Handled in **JS + CSS classes, not separate components**: `checkOrientationAndLayout()` (`app.js:136`) runs on `resize` and `orientationchange` (and once at load). If `innerWidth <= innerHeight` it shows `#rotation-lock-overlay` and removes the `.landscape` class from `body`/`#game-board`; otherwise it hides the overlay and adds `.landscape`.
  - `applyMobileStacking()` (`app.js:98`) sets negative `margin-left` on hand cards so the hand fan-overlaps; party/opponent cards get `0`.
- No router; "navigation" is showing/hiding overlays and the two screens.

---

## 5. Data model

**Cards** live in `cards.json` (~115 cards). Common fields on every card: `name`, `type`, `id` (`card_NNN`), `imageUrl`. Type-specific fields (real samples):

```jsonc
// Hero Card
{ "name":"Bad Axe", "type":"Hero Card", "requirement":"8+", "effect":"DESTROY a Hero card.",
  "imageUrl":"https://.../200px-...png", "class":"Fighter", "roll_requirement":8,
  "skill_id":"DESTROY_HERO", "id":"card_016" }

// Party Leader
{ "name":"The Charismatic Song", "type":"Party Leader", "class":"Bard",
  "effect":"Each time you roll to use a Hero card's effect, +1 to your roll.",
  "imageUrl":"https://.../200px-...png", "id":"card_132", "effect_id":"LEADER_BARD" }

// Monster Card
{ "name":"Abyss Queen", "type":"Monster Card", "requirement":"2 Heroes", "effect":"…",
  "imageUrl":"…", "slayRoll":8, "penaltyRoll":5, "id":"card_001",
  "effect_id":"MONSTER_ABYSS_QUEEN", "penaltyAction":"SACRIFICE_HERO",
  "rewardAction":"NONE", "rollType":"HIGH_ROLL" }
```
Other types: **Item Card / Cursed Item Card** carry `effect_id` (`ITEM_*` / `CURSE_*`); **Magic Card** carries `effect_id` (`MAGIC_*`); **Modifier Card** encodes its value in `name` (e.g. `"+2/-1"`); **Challenge Card** is minimal. **Runtime-only props** added to cards once in play: `equippedItem` (a nested card object on a Hero) and `usedSkillThisTurn` (bool). Opponent hand cards are masked to `{ "type": "Hidden" }`.

**Player object** (created in `server.js:864`):
```js
{ id, name, hand: [], party: [], slainMonsters: [], leader: null /* or a card */,
  ap, hasSelectedLeader, hasRerolledLeader }
```
Engine adds transient flags during play: `cannotBeStolen`, `cannotBeDestroyed`, `cannotBeChallenged`, `rollBonus`, `rollBonusSources`, `magicRollBonus`.

**Top-level `gameState`** (`server.js:24`): `state` (FSM string), `players` (socketId→player map), `playerOrder`, `availableLeaders`, `activePlayerSocketId`, `pendingAction`, `pendingRoll`, `pendingChallenge`, `mainDeck`, `monsterDeck`, `discardPile`, `activeMonsters`, `winner`, `pendingGlobalAction`, `modifierResponses`.

**Where state comes from:** **Entirely the server.** `server.js` holds the single authoritative `gameState`. The client receives a **per-socket masked snapshot** on the `gameStateUpdate` event (`app.js:1056`): the payload includes `data.me` (your socket id), your own hand is visible, and **every other player's hand is replaced with `{type:'Hidden'}`**. The client never computes authoritative game state — it renders snapshots and emits intent.

---

## 6. What must NOT be touched (keep purely functional)

These are game logic / networking / state and must stay behavior-identical through a UI overhaul:

- **`server.js`** — all game logic, the FSM, turn/roll/challenge flow, win checks, the 15s modifier timer, deck loading. **`skill_engine.js`** and **`card_effects.js`** — per-card effects. **`cards.json`** — card data & `id`s (UI may read fields; must not rename/restructure or change ids).
- **The Socket.IO contract.** Do not rename or change payloads of the client→server intent events, or the server will silently ignore them. `app.js` emits **30 distinct events**:
  `attackMonster`, `decline_hero_skill`, `discard_and_draw_five_action`, `draw_card_action`, `end_turn`, `execute_roll`, `pass_challenge`, `play_challenge`, `play_from_hand`, `play_item_action`, `playCard`, `request_game_reset`, `request_lobby_data`, `reroll_leader`, `resolve_global_action`, `resolve_immediate_play`, `roll_leader`, `select_leader`, `select_peek_card`, `set_player_name`, `skip_optional_action`, `start_game`, `submit_global_action`, `submit_modifier_action`, `submit_penalty_discard`, `submit_penalty_sacrifice`, `submit_skill_target`, `target_selected`, `use_hero_skill`, `use_leader_skill`.
  Rendering is driven by server→client events incl. `gameStateUpdate`, `lobby_data`/`lobby_data_update`, `dice_roll_pending`, `challenge_pending`, `challenge_resolved`, `challenge_individual_roll`, `modifier_played`, `rollResult`, `heroPlayedPrompt`, `peek_cards`, `global_action_requested`, `global_action_resolution`, `game_over`, `game_reset_complete`, `message`. (Keep listening to these.)
- **`const socket = io()`** (`app.js:21`) and the state globals/broadcast contract: `myId`, `latestGameState`, their `window.*` mirrors, and the `data.me` + masked-hand convention.
- **Targeting/ownership logic that mirrors the server — keep behavior identical:** `meetsMonsterRequirements()` (`app.js:302`) and `effectiveHeroClass()` (`app.js:291`) reimplement server rules; `renderCard`'s `valid-target` class logic + the inspector "SELECT TARGET" button's emit routing decide whether a tap fires `target_selected` vs `submit_skill_target` vs `use_hero_skill`. This routing is **fragile and was recently bug-fixed** (a stale `isSkillTargeting` flag once hijacked a destroy into a no-op `use_hero_skill`). Touch with care; re-test steal/destroy/exchange flows.
- **`debug_*` socket events** (used only by the e2e tests, e.g. `debug_inject_card`, `debug_inject_to_party`, `debug_equip_item`, `debug_force_next_roll`) — leave them in.

---

## 7. Constraints & pain points

- **`public/app.js` is one ~3045-line file**, and large stretches are **double-line-spaced** (a blank line between nearly every source line), which inflates length and makes navigation awkward. No ES modules/imports — everything is global functions in one scope. A refactor into modules is possible but out of scope for a pure visual pass and risky given the socket-flag coupling.
- **Styling is spread across three places.** Changing one element's look often means editing (1) a CSS class in `style.css`, (2) an inline `style="..."` in `index.html`, and (3) an inline style inside a JS template literal. `style.css` is 2688 lines, heavy on `!important` and hardcoded hex values (only partially tokenized — see §2).
- **Re-render churn is the main performance concern.** `renderBoard(data)` runs on **every** `gameStateUpdate` and replaces large `innerHTML` blocks (hand, party, opponents bar, monsters). This drops DOM state/focus and re-creates nodes each broadcast. The opponent modal specifically used to rebuild on every broadcast and **dropped taps in multiplayer**; it's now gated by `oppModalSignature()` (`app.js:906`) so it only rebuilds when the opponent's cards actually change — **preserve that guard** (or an equivalent) in any rewrite. The hand uses negative-margin overlap (`applyMobileStacking`) and a horizontally scrollable party row so the hand stays on screen.
- **Inline `onclick="globalFn()"`** handlers are everywhere — both in `index.html` and in JS-generated markup — and depend on those functions being on `window`. A refactor that renames/moves them will break clicks silently (no errors). Examples: `closeOpponentModal()`, `resolveImmediatePlay()`, `requestGameReset()`, `executeManualRoll()`, `toggleChat()`.
- **Load-bearing selectors for the e2e suite.** `test/e2e/**` (Playwright) drives the real UI by id/class/attribute. Changing these **breaks tests** — update the specs in lockstep or keep the hooks. Notably: `data-id="card_NNN"` on every card, `#player-hand`, `#player-party`, `#opponents-bar .opponent-chip`, `#opponent-modal`, `.valid-target`, `#inspector-modal` + `#inspector-modal-actions button` (filtered by "Play"/"Cast"/"Use Skill"/"SELECT TARGET" text), `#manual-roll-btn`, `#skill-prompt-modal` + `#skill-prompt-yes`, `#dice-overlay` + `#dice-pass-btn`, `#challenge-modal`, `#start-game-btn`, `#player-name-input`, `#app-container`. (Helpers live in `test/e2e/helpers/gameSetup.js`.)
- **Service-worker cache must be bumped on any shell change.** `public/sw.js` precaches the app shell under `CACHE_VERSION` (currently `'hts-v4'`). After changing any HTML/CSS/JS, **increment `CACHE_VERSION`** or returning users (and installed PWAs) will be served stale assets.
- **Landscape-only by design** — portrait is blocked by `#rotation-lock-overlay`. A redesign that wants portrait support must replace the orientation lock logic (`checkOrientationAndLayout`) and the landscape-only layout assumptions, and update `manifest.json`.
- **Disconnect resets the match to the lobby** (server behavior) — not a UI bug, but relevant for any reconnect/observer UX work.

---

### Uncertainties / not verified
- I did **not** enumerate every server→client event payload field — only the event names and the few render paths read here. If the overhaul changes how a panel is populated, confirm the exact payload in `server.js`'s `io.emit(...)` / `broadcastState()`.
- "No TypeScript / no build" is based on the absence of any `.ts`/config/bundler files and `CLAUDE.md`; if a build is later added it would invalidate §1.
- Font behavior (§2) is inferred from imports-vs-references; verify in a browser if exact typography matters.
