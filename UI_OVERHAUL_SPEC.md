# UI Overhaul Spec — Here to Slay

This translates the two visual mockups (`here-to-slay-board.jsx` = portrait, `here-to-slay-landscape.jsx` = landscape) into a change plan for the **real** codebase described in `UI_HANDOFF.md`.

**Read this first:** the mockups are React/JSX with inline styles. The real app is **vanilla JS building DOM via `innerHTML` template strings + one `style.css`**, and state is **server-authoritative over Socket.IO**. So nothing in the `.jsx` files is copy-pasteable. They are a **visual target only**. Every change below is expressed in terms of `style.css`, the `renderCard`/`renderBoard` string builders, and `index.html` — and is bounded by a hard "do not touch" list so the socket contract and Playwright suite keep working.

**Scope decision (locked):** this is a **dual-orientation overhaul**. Both mockups ship as first-class modes — `here-to-slay.jsx` (portrait) **and** `here-to-slay-landscape.jsx` (landscape). The current landscape-only lock is **removed** (see §0). Implementation uses **Option B: two render branches** — `renderBoard` builds different markup per orientation so each mode matches its mockup exactly. This is more work than a reskin and accepted as such.

The mockup palette (indigo→peach "Twilight Forest") is a **suggestion**; the real `:root` is amber/gold on dark slate. Pick one consciously — don't end up with both. This spec assumes you keep your existing hues but adopt the mockup's *structure, depth, and component styling*. Swap the hex values if you want the twilight look.

---

## 0. Dual orientation — the architecture change (do this design before styling)

This supersedes the old "landscape-only" assumption. The game must run in **both** portrait and landscape, switching live on rotation, each matching its mockup.

### 0.1 Remove the orientation lock
- `manifest.json`: change `"orientation":"landscape"` → `"any"` (or remove the key).
- `checkOrientationAndLayout()` (`app.js:136`): today it shows `#rotation-lock-overlay` and strips `.landscape` when `innerWidth <= innerHeight`. **Rewrite it to never block** — instead it sets a mode class on `#game-board`: add `.portrait` when `innerWidth <= innerHeight`, `.landscape` otherwise (keep the existing `.landscape` toggle, add the `.portrait` counterpart). Keep it firing on `resize`, `orientationchange`, and once at load.
- `#rotation-lock-overlay`: keep the element (e2e/markup stability) but it is never shown now; or repurpose to a brief "rotating…" flash. Don't delete its id blindly if a test references it — grep `test/e2e/**` first.

### 0.2 Two render branches (Option B)
`renderBoard(data)` (`app.js:1457`) currently builds one fixed structure. Refactor so the **layout-shell markup** is chosen by orientation, while the **card/hand/party/opponent inner renderers stay shared**:

```js
function renderBoard(data){
  const portrait = window.innerWidth <= window.innerHeight;
  // shared sub-renders (UNCHANGED contract): renderCard(...), party html, hand html,
  // opponents html, monsters html — build these strings ONCE here.
  const parts = buildBoardParts(data);          // returns {handHtml, partyHtml, oppHtml, monstersHtml, leaderHtml, controlsHtml}
  document.getElementById('game-board').innerHTML =
      portrait ? portraitShell(parts) : landscapeShell(parts);
  applyMobileStacking();                          // keep
  // re-bind anything that needs it
}
```

- **`buildBoardParts` produces the shared fragments** (cards, hand, party, opponents, monsters, leader, controls). These contain all the load-bearing ids/classes/`data-id`s. Build them once; both shells consume the same strings.
- **`portraitShell(parts)`** arranges per `here-to-slay.jsx`: win-track + menu top → opponents → monsters → party (2 rows) → wooden tray with **leader raised center**, deck/discard + AP + redraw **on the tray**, hand below, action buttons at the bottom.
- **`landscapeShell(parts)`** arranges per `here-to-slay-landscape.jsx`: opponent strip + win-track top → monsters top-center → **left rail deck/discard**, center party, **right rail AP + redraw** → bottom wooden tray with **leader raised left**, hand center, Play/View/End stacked right.
- **Critical for e2e:** every load-bearing id/selector (`#player-hand`, `#player-party`, `#opponents-bar`, `.opponent-chip`, `data-id="card_NNN"`, `#player-controls` buttons, etc.) must exist **in both shells**. The shared-fragment approach gives you this for free *if* each shell actually drops the same fragments in. Don't let one shell omit an element the tests expect. Run the full Playwright suite **in both orientations** (set viewport portrait and landscape) — see §7.

### 0.3 Re-render on rotation
On `orientationchange`/`resize`, after the mode class flips, **call `renderBoard(latestGameState)`** so the correct shell is built. Today `checkOrientationAndLayout` only toggles classes; now it must also trigger a re-render when the orientation *category* changes (guard so it doesn't re-render on every resize pixel — only when portrait↔landscape actually flips). Cheap dedupe: store last mode, compare, re-render only on change.

### 0.4 Persistent monsters/deck/discard
Both mockups show monsters always on-board (and deck/discard on tray/rail), not behind the BOARD button. Since you're already rewriting both shells, **fold these in now** rather than as a later phase — both shells render `parts.monstersHtml` and the deck/discard piles directly. The BOARD button (`board-modal`) can stay as a secondary detail view, but the board no longer *depends* on it for visibility. **Check `test/e2e/**` for specs that open `board-modal` to see monsters** — they may need to read the on-board monsters instead; update in lockstep.

### 0.5 Don't copy the mockup's fixed stage
The landscape mockup uses `aspectRatio:16/9` and the portrait one a `maxWidth:420` column — both are presentation framing. The real shells must **fill the viewport fluidly** in each orientation, not lock to a fixed box.

---

## 1. Phase 0 — Tokens (do this first, it unblocks everything)

The mockups encode a consistent visual system. Port it into `:root` in `style.css` **before** touching any element, then reference the tokens everywhere instead of hardcoding. Today only ~11 color vars exist and many are duplicated as raw hex; there are **no spacing/radii/type tokens** — add them.

Add to `:root`:

```css
:root {
  /* existing colors stay; optionally retint to the mockup palette */
  --primary:#fbbf24; --accent:#d97706; --background-dark:#0f172a;
  --danger:#ef4444; --success:#10b981; --warning:#f59e0b; --info:#38bdf8;

  /* NEW — surfaces & frame (the wooden/brass look from the mockups) */
  --wood-lite:#8a6440; --wood:#6b4a2e; --wood-dark:#3e2a18;
  --card-face:#fdf6e8; --card-ink:#3a2a1e;
  --roll-blue:#4a90d9; --roll-blue-deep:#2a5a9a;   /* roll badges */
  --leader-pink:#e8607a;                            /* party-leader frame */

  /* NEW — radii */
  --r-card:8px; --r-panel:14px; --r-pill:16px; --r-badge:50%;

  /* NEW — spacing scale (replace ad-hoc px) */
  --s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-6:24px;

  /* NEW — elevation */
  --shadow-card:0 2px 4px rgba(0,0,0,.4);
  --shadow-panel:0 20px 50px rgba(0,0,0,.7);

  /* NEW — type (resolve the font discrepancy, see §6) */
  --font-display:'Cinzel',serif;       /* card names, headers */
  --font-body:'Outfit',system-ui,sans-serif;
}
```

Then, as you touch each rule, replace duplicated raw hex (`#ef4444`, `#10b981`, `#ffd700`, `#d97706`…) with the matching var. Don't do a blind find-replace across 2688 lines — retokenize per element as you restyle it, so you can eyeball each change.

**Font fix:** `body` currently asks for `'Montserrat'` (never imported → system fallback) and one rule uses `'Inter'` (also not imported). Either import them or, better, set `body{font-family:var(--font-body)}` using **Outfit**, which *is* already imported. Make card names/headers use `var(--font-display)` (Cinzel, already imported).

---

## 2. The card — restyle `renderCard` + `.card` CSS

`renderCard(card, isMine, inHand, isMonster, isMyTurn, inlineStyle)` (`app.js:627`) is the single renderer for **all** card types. This is the highest-leverage change: restyle it once and every card improves.

Target look (from mockups — see `PartyCard`, `HandCard`, `MonsterCard`, `LeaderCard`):

- **Wooden outer frame.** Wrap the card face in a 2–3px border using `linear-gradient(180deg,var(--wood-lite),var(--wood-dark))` (do this as a CSS class on `.card`, e.g. a `padding` + gradient background with the face as an inner element — or simulate with `border-image`). Inner face = `var(--card-face)` with a **class-colored** inner border.
- **Class color drives the inner border + header tint.** Map the six classes to colors (Fighter `#e05a4a`, Bard `#e89a3a`, Guardian `#e8c84a`, Ranger `#5ab85a`, Thief `#4a90d9`, Wizard `#9a5ad9`). The mockup keeps a per-class icon (🔨🎵🛡🏹🗡✦) in the corner — replicate using the existing `card-class` field.
- **Type ribbon.** Thin uppercase colored bar at the top of the face showing `card.type` (Hero/Item/Magic/Modifier/Challenge), tinted per type. Maps to the existing `.card-type` div.
- **Roll badge.** Heroes and roll-requiring cards show a **blue circular badge, top-right, overlapping the frame** with the `roll_requirement` number. Today this is `.card-req` ("8+"); restyle it into the badge (see mockup `RollBadge`). For monsters, the badge shows `slayRoll`; keep the "Slay: X+ | Fail: Y-" detail inside the face or in the inspector.
- **Equipped item.** `.equipped-item-thumb` already exists for heroes with `equippedItem`; in the mockup it's a small gold pill under the name (`🗡 {item}`). Restyle, keep the data wiring.
- **Party Leader** gets a distinct frame: gold outer + `var(--leader-pink)` inner border + a 👑 corner, and it renders **larger** (see below). Branch on `card.type === 'Party Leader'`.
- **Monster** face uses the dark purple treatment (`#2e2440` face, pink border) with the requirement text — distinct from hero cards.

Keep the exact output **contract** intact while restyling:
- Keep the root `<div class="card …" id="{id}" data-id="{id}">` — **`data-id="card_NNN"` is load-bearing for e2e.**
- Keep `.card-img`, `.card-info`, `.card-name`, `.card-type`, `.card-class`, `.card-req`, `.equipped-item-thumb`, `.card-back` as the class names (restyle them; don't rename them).
- Keep all dynamic classes the targeting system adds: `valid-target`, `valid-target-steal`, `valid-target-equip`, `active-skill-glow`, `attackable-monster`. **Restyle their highlight, don't remove them.** In the mockups, "selectable/targetable" = a glow + lift; map each of these classes to a glow color (steal=blue, equip=gold, attackable=pink/red, active-skill=amber).

---

## 3. Board layout — `renderBoard` + `index.html` regions + `style.css`

Match the **landscape mockup** arrangement. The handoff's current top→bottom board is: `#opponents-bar` → `.action-bar #player-controls` → `#player-zone`(`#player-party` + `#player-hand`) → `#event-console`. Re-skin into this spatial layout (keep the same element ids):

Both shells consume the **same shared fragments** from `buildBoardParts` (§0.2); only the arrangement differs.

**LANDSCAPE shell** (`here-to-slay-landscape.jsx`):
```
┌─────────────────────────────────────────────────────────────┐
│ [opponent chips ······]                 [Slain ✦✦○]  [☰]      │  ← #opponents-bar (left) + win-track/menu (right)
│              MONSTERS (top-center)                             │  ← always-visible (§0.4)
│   ┌──────┐                                  ┌──────────────┐   │
│   │ DECK │            YOUR PARTY            │  AP ● ● ●     │   │  ← left rail = deck/discard, center = party,
│   │ DISC │     [hero][hero][hero][+][+]     │  [Redraw 3]  │   │     right rail = AP + redraw
│   └──────┘                                  └──────────────┘   │
│ ┌──────────────────────────── wooden tray ──────────────────┐ │
│ │ [LEADER]   YOUR HAND [c][c][c][c][c]      [Play][View][End] │ │  ← leader raised LEFT, buttons stacked right
│ └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**PORTRAIT shell** (`here-to-slay.jsx`):
```
┌──────────────────────────┐
│ [Slain ✦✦○]          [☰] │  ← win-track + menu
│ [opp][opp][opp]          │  ← opponents row
│   MONSTERS (centered)     │  ← always-visible
│   [mon][mon][mon]         │
│ ─────────────────────────│  ← gold battlefield divider
│   YOUR PARTY (2 rows)     │
│  [hero][hero][hero][+]    │
│  [hero][+][+]             │
│ ╔═══════ wooden tray ════╗│
│ ║      [ LEADER ]        ║│  ← leader raised CENTER
│ ║ [Deck][Disc] ●●● [Redr]║│  ← deck/discard + AP + redraw ON the tray
│ ║ YOUR HAND [c][c][c][c] ║│
│ ║ [Play card][View][End] ║│
│ ╚═══════════════════════╝│
└──────────────────────────┘
```

Concrete changes (shared fragments unless noted — apply in **both** shells):
- **Opponents bar** (`#opponents-bar .opponent-chip`): restyle chips to the mockup pill — round avatar with the opponent's leader emoji badge, name, and `👥party ✦slain 🂠hand` line. **Keep `.opponent-chip` class** (e2e selector). Landscape = left strip; portrait = full-width row.
- **Win-track + menu**: "Slain to Win ✦✦○" indicator + `☰` button. Slain count = `player.slainMonsters.length` (cap 3). New element; wire to existing state. Present in both shells (top-right landscape, top bar portrait).
- **Controls** (`#player-controls`, `.action-bar`): BOARD/DRAW/RELOAD/END global fns stay; only their **placement** differs per shell (side rails in landscape; on the tray in portrait). **Keep the buttons' existing `onclick` handlers and ids.** AP display → 3 glowing amber "gems" (column in landscape right rail, row on portrait tray).
- **Party** (`#player-party`): 6 slots, empty = dashed placeholders. Landscape = single row; portrait = wraps to 2 rows. Keep horizontal scroll/overlap (`applyMobileStacking`).
- **Hand** (`#player-hand`): on the wooden tray, fanned via the existing negative-margin overlap. Selected card lifts. Keep `#player-hand` in both shells.
- **Party Leader**: larger and raised, overlapping the tray's top edge. From `player.leader`. **Landscape = raised left; portrait = raised center.** Distinct frame (§2).
- **Wooden tray**: the tray container gets the wood `linear-gradient` + gold top border + top corner radius — the defining "table edge." In landscape it holds leader+hand+buttons in a row; in portrait it also absorbs deck/discard/AP/redraw.
- **Monsters** (`parts.monstersHtml`): always rendered on-board in both shells (§0.4), top-center.

**Performance guard — keep it.** `renderBoard` replaces `innerHTML` wholesale on every `gameStateUpdate`; the two-shell split must **not** make it heavier — build fragments once, pick a shell, one `innerHTML` write. Preserve `oppModalSignature()` (`app.js:906`) dedupe so the opponent modal doesn't rebuild and drop taps in multiplayer. Now that monsters are always on-board, **gate their rebuild** the same way (only rebuild when `activeMonsters` actually changed) or they churn every broadcast. And per §0.3, only re-render on rotation when the portrait↔landscape category actually flips, not on every resize pixel.

---

## 4. Modals — restyle the shell, map mockup modals to existing ids

The mockups have a single **modal shell** (wood frame + parchment body + colored header) reused by every popup. Build that shell as CSS classes and apply to the existing modal elements — **do not create new modal elements or rename ids** (most are e2e selectors).

Make a reusable pair of classes, e.g. `.modal-frame` (wood gradient border + `--shadow-panel`) and `.modal-body` (parchment `linear-gradient(#fffaf0,#f3e6cc)`), plus `.modal-head` (colored gradient bar). Apply to:

| Mockup modal | Existing element(s) to restyle | Notes |
|---|---|---|
| Leader pick | `#lobby-modal` → `#leader-selection-container` | Shared depleting grid already exists; restyle cards to mockup leader rows. Keep `#start-game-btn`, `#player-name-input`. |
| Hero roll / dice | `#dice-overlay` (`die1`, `die2`, `#manual-roll-btn`, `#dice-pass-btn`) | Restyle dice + result text. **Keep these ids + the manual-roll button text routing.** |
| Monster attack | `#board-modal` attack flow + `#dice-overlay` | Show requirement/reward/penalty (`requirement`, `rewardAction`, `penaltyRoll`/`penaltyAction`) like the mockup. |
| Challenge | `#challenge-modal` (`challenge-play-btn`/`#challenge-play-btn`, `challenge-pass-btn`) + `challenge_individual_roll` | Mockup shows YOU vs OPP dice. Keep ids. |
| Card zoom / inspector | `#inspector-modal` + `#inspector-modal-actions` | **Critical:** action buttons are filtered by **button text** ("Play"/"Cast"/"Use Skill"/"SELECT TARGET") in e2e. Keep that text. Restyle the big card preview to mockup zoom. |
| Reward (monster slain) | part of monster flow | New visual; wire to slain result. |
| Redraw (3 AP) | RELOAD button → confirm | Confirm dialog before `discard_and_draw_five_action`. |
| Discard view | `#discard-viewer-modal` / `#discard-search-modal` | Restyle grid. Keep `select_peek_card` wiring for search. |
| Game menu | new lightweight overlay OR reuse `board-modal` | Optional; if new, keep it dumb (no socket changes). |
| Victory | `#victory-modal` / `#gameover-screen` | Keep `canvas-confetti`. Restyle to mockup victory card. |
| Skill prompt | `#skill-prompt-modal` (`#skill-prompt-yes`) | "Use Skill? YES/NO". Keep ids. |
| Forced discard / pool pick / immediate play | `#mandatory-discard-modal`, `#global-resolution-modal`, `#immediate-play-modal` | Restyle only. |
| Targeting banner / toasts | `#target-banner`, `#notification-area` | Restyle. |

---

## 5. Hard "do not touch" list (breaks game or tests if changed)

- **All of `server.js`, `skill_engine.js`, `card_effects.js`.** No logic edits.
- **`cards.json`** — read fields freely; never rename/restructure or change `id`s.
- **The 30 client→server emit event names + payloads** (`attackMonster`, `playCard`, `execute_roll`, `submit_skill_target`, `target_selected`, `use_hero_skill`, … full list in handoff §6). Restyling must not change what gets emitted or when.
- **Server→client listeners** (`gameStateUpdate`, `dice_roll_pending`, `challenge_*`, `rollResult`, `heroPlayedPrompt`, `game_over`, …). Keep listening.
- **`const socket = io()`, `myId`, `latestGameState`/`window.*` mirrors, `data.me` + masked-hand convention.**
- **Targeting routing** (`meetsMonsterRequirements()` `app.js:302`, `effectiveHeroClass()` `app.js:291`, and the `valid-target` → emit decision). Fragile, recently bug-fixed. Restyle the *highlight*, never the routing. Re-test steal/destroy/exchange after.
- **e2e selectors/hooks** (handoff §7): `data-id="card_NNN"`, `#player-hand`, `#player-party`, `#opponents-bar .opponent-chip`, `#opponent-modal`, `.valid-target`, `#inspector-modal` + `#inspector-modal-actions button` (by text), `#manual-roll-btn`, `#skill-prompt-modal` + `#skill-prompt-yes`, `#dice-overlay` + `#dice-pass-btn`, `#challenge-modal`, `#start-game-btn`, `#player-name-input`, `#app-container`. Rename only if you update `test/e2e/**` in lockstep. **With two shells (§0.2), every one of these must exist in BOTH the portrait and landscape branch** — a selector that only appears in one shell will pass tests in that orientation and silently fail in the other.
- **`debug_*` events** — leave in.
- **Inline `onclick="globalFn()"`** handlers depend on functions staying on `window`. Don't move/rename them silently.

---

## 6. Two required housekeeping steps

- **Bump the service-worker cache.** After any HTML/CSS/JS change, increment `CACHE_VERSION` in `public/sw.js` (currently `'hts-v4'` → `'hts-v5'`), or returning users / installed PWAs get stale assets and won't see the overhaul.
- **Resolve the font system** (§1): standardize on Outfit (body) + Cinzel (display), both already imported; drop the dead Montserrat/Inter references.

---

## 7. Suggested order of work

1. **Phase 0 — tokens + fonts** in `:root` (§1). No visual risk, unblocks the rest.
2. **`renderCard` + `.card` family** (§2). Biggest visual payoff; every card at once, orientation-independent. Re-run e2e (cards still have `data-id`, classes intact).
3. **Modal shell** classes, then apply per modal (§4). Modals are orientation-independent — do them before the layout split. Re-run e2e after the inspector/dice/challenge ones.
4. **Refactor `renderBoard` into `buildBoardParts` + shared fragments** (§0.2), but first emit the **landscape shell only** and confirm parity with today's behavior + full e2e green in landscape. This isolates the risky refactor from the new portrait work.
5. **Add the portrait shell** + the orientation-lock removal + live re-render on rotation (§0.1, §0.3). Now both mockups are reachable.
6. **Fold in always-visible monsters/deck/discard** in both shells (§0.4), with the rebuild guard.
7. **New cosmetic elements** (win-track, AP gems, leader-raised, reward modal) in both shells.
8. **Bump `sw.js` cache.** Run the **full e2e suite twice — once portrait viewport, once landscape** (§5). Manual multiplayer smoke test of steal/destroy/exchange + challenge, and a live rotation test mid-game (rotate during a roll, during targeting, during a modal — confirm nothing drops).

Throughout: change **look** and **layout**, never **wiring**. If a change requires editing an emit, a listener, a payload, or a routing decision, it's out of scope — stop and flag it. The one sanctioned logic-adjacent change is `checkOrientationAndLayout` (§0.1/0.3), which gains a portrait branch and a rotation re-render; treat even that as surgical.
