# UI Rework — Session Handoff (continue here)

This file lets a fresh chat pick up the **Here to Slay** UI overhaul exactly where we stopped. Read this first, then `UI_OVERHAUL_SPEC.md` (the plan) and `UI_HANDOFF.md` (the original codebase snapshot).

> **Next step the user asked for:** keep cleaning up the UI and add/polish **animations**, using the **`emil-design-eng`** skill (Emil Kowalski's design-engineering philosophy). Invoke that skill at the start of UI work.

---

## 0. TL;DR state

- This is a vanilla-JS PWA (no build). Server is authoritative (`server.js`); client renders snapshots over Socket.IO. **Do not touch game logic / socket wiring.**
- We've taken the overhaul through the spec's phases **0–8** and then heavily reworked the **landscape** and **portrait** shells to match the two mockups (`here-to-slay-landscape.jsx`, `here-to-slay-board.jsx`) and the user's live feedback.
- **Everything is uncommitted** (working tree only). Nothing has been committed or pushed this session.
- All work is **CSS + a small render split**; the socket/e2e contract is intact.

Changed files (uncommitted): `public/style.css` (most of it), `public/app.js`, `public/index.html`, `public/manifest.json`, `public/sw.js`, `playwright.config.js`, `test/e2e/gameplay.spec.js`, `test/e2e/mobile/mobile-smoke.spec.js`. Untracked helpers: `screenshots/`, `.agents/` (skills), `skills-lock.json`, the two `*.jsx` mockups, `UI_HANDOFF.md`, `UI_OVERHAUL_SPEC.md`.

---

## 1. The visual feedback loop (USE THIS)

`screenshots/capture.js` drives a real 2-player game with a populated party and screenshots **both orientations at real device sizes** (landscape 844×390, portrait 412×870). This is how we iterate.

```bash
# 1. start the server once (background)
node server.js            # listens on :3000
# 2. capture (writes screenshots/game-landscape.png + game-portrait.png)
node screenshots/capture.js
# then open/Read those PNGs to see the result
```

For close-up debugging, copy `capture.js` and screenshot a single element (e.g. `await h.locator('#player-party').screenshot(...)`) with `deviceScaleFactor: 3`. Delete throwaway diag scripts when done (`screenshots/_*.js`). `screenshots/` is gitignored.

---

## 2. Where the layout lives (public/style.css)

The shells are pure CSS keyed on `body.landscape` / `#game-board.portrait` (set by `checkOrientationAndLayout()` in `app.js`). Wrapper nodes are flattened with `display:contents` so leaf regions become direct grid/flex items — **no DOM is moved**, so ids/classes/onclick stay valid.

- **LANDSCAPE SHELL** — search `LANDSCAPE SHELL (UI overhaul`. A CSS **grid** on `body.landscape #game-board`:
  `opp` (top-left) · `win` (top-right, fixed) · `mons` (row2 center) · left rail `deck`+`draw` · center `party` · right rail `ap`+`redraw` · bottom row `leader`+`hand`+`endturn`. The old right-hand action **sidebar was dissolved** (buttons relocated into rails/tray, ids intact).
- **PORTRAIT PASS** — search `PORTRAIT PASS`. Flattens `#player-zone`/`#player-assets`, then orders: monsters → divider → **party** → raised **leader** (center) → **hand** → buttons (pinned bottom via `margin-top:auto`).
- **Global card-image rule** — search `In-game cards show the FULL card image`. The `imageUrl` is a whole card scan, so on in-game cards we hide `.card-type` + `.card-info` and let `.card-img` fill the frame (`background-size: contain`). **`.card-info`/`.card-class` stay in the DOM (hidden)** because e2e reads their text — do not remove them.
- **`.card-req { display:none }`** — roll/slay badge hidden on faces (info is in the inspector).
- **Monster attack highlight** — `.attackable-monster` box-shadow tightened to `0 0 5px 1px` (was a wide bleed).
- New DOM hooks in `index.html`: `#leader-slot` (leader renders here, not as first party card) and `#landscape-tray-bg` (invisible per user request).

In `app.js`: `buildBoardParts()` returns `leaderHtml` separately; `renderBoard()` writes it into `#leader-slot`. **`setRegionHtml(el, html)`** (just above `renderBoard`) skips innerHTML writes when the fragment is unchanged — a churn guard that fixed a tap-drop regression; **keep it**.

---

## 3. Hard constraints (breaking these breaks the game or tests)

- No edits to `server.js`, `skill_engine.js`, `card_effects.js`, `cards.json` ids, or the 30 client→server emit events / listeners. See `UI_OVERHAUL_SPEC.md` §5 for the full list.
- Load-bearing e2e selectors must keep existing in **both** shells: `data-id="card_NNN"`, `#player-hand`, `#player-party`, `#opponents-bar .opponent-chip`, `#opponent-modal`, `.valid-target`, `#inspector-modal` + `#inspector-modal-actions button` (filtered by text "Play"/"Cast"/"Use Skill"/"SELECT TARGET"), `#manual-roll-btn`, `#skill-prompt-modal`/`#skill-prompt-yes`, `#dice-overlay`/`#dice-pass-btn`, `#challenge-modal`, `#start-game-btn`, `#player-name-input`, `#app-container`, `#draw-card-btn`, `#end-turn-btn`, `#active-monsters`.
- `#view-board-btn` is hidden (BOARD modal redundant — monsters are always on-board). Its two old tests were repointed at on-board `#active-monsters`.
- Keep `.card-info`/`.card-class` in the DOM (hidden is fine — `toHaveText` reads hidden text).

---

## 4. Testing

```bash
npx playwright test --project=mobile-chrome     # landscape
npx playwright test --project=mobile-portrait   # portrait
```
Run targeted specs while iterating (e.g. `test/e2e/mobile/party-scroll.spec.js`, `mobile-smoke.spec.js`, `gameplay.spec.js`). Full run is ~37 min for both projects.

**Known PRE-EXISTING failures (NOT ours — they fail on the committed baseline too):** `magic.spec.js` **Forced Exchange** (line 106) and **Winds of Change** (line 141) — p2's `#challenge-modal` never appears (`passChallenge` helper times out). Don't chase these as overhaul regressions. Quick Draw / Tipsy-3p are occasional multiplayer flakes (pass on retry). See memory `ui-overhaul-phase8-e2e.md`.

---

## 5. Done so far (this session)

- Phases 0–8 of `UI_OVERHAUL_SPEC.md` §7 (tokens, card restyle, modal shell, board refactor, dual orientation, on-board monsters, cosmetic HUD, sw bump).
- **Landscape**: full grid rework to the mockup; sidebar dissolved; win-track + turn fixed top-right (stacked); monsters centered + enlarged; rail piles sized so the hand isn't clipped on 360px-tall devices; zone boxes/tray band removed.
- **Portrait**: reordered to party → raised leader → hand → bottom buttons; zone boxes/tray/label removed; everything centered (killed a stray `.monsters-area { margin-left:20px }`); party is a 2-row **horizontal-scroll** grid; hand is a **fanned** scrollable row.
- **Cards (both)**: full card image fills the frame; bigger; corner number badge removed; party container no longer clips card bottoms; monster red glow tightened.

## 5b. Animation polish pass (emil-design-eng session)

CSS-only, verified against mobile-smoke in **both** orientations (14/14 landscape, 5/5 portrait spot-check). No JS/selector changes.
- Added a single motion token `--ease-out: cubic-bezier(0.23,1,0.32,1)` (strong ease-out; built-ins are too weak).
- Removed all 8 `transition: all` declarations → explicit `transform`/`box-shadow`/`filter`/`border-color` lists on `--ease-out`.
- Modal entrance: `.glass-panel` swapped shared `fadeIn 0.5s` (translateY only) → dedicated `modalPop 0.28s var(--ease-out)` (scale 0.96→1 + fade, origin center per Emil's modal rule).
- Card lift (`.card`, `#player-hand .card`) now eases on `--ease-out`.
- `.opponent-chip:active { scale(0.97) }` press feedback (it opens the opponent modal).
- Bumped `sw.js` CACHE_VERSION `hts-v5` → `hts-v6`.
- **Not committed yet** (awaiting user OK). Reduced-motion guard already neutralizes `modalPop`.
- Deliberately skipped: per-AP-gem and per-win-pip fill animations — those regions full-rerender via `setRegionHtml`, so a CSS entrance would re-fire on every unrelated state change (distracting flash). Slay reward toast + monster-death shake already cover that beat.

### 5b-2: event-driven motion (second pass)
Verified: mobile-smoke 14/14, gameplay.spec 6/6, both orientations spot-checked. No selector/contract changes.
- **Dice landing bounce** — new `settleDie(el)` helper (app.js, by `renderDicePips`) toggles `.die.settle` (restart-safe reflow) at the two roll-resolution points (challenge roll-off + skill/attack roll). CSS `@keyframes dieSettle` (overshoot→settle, 0.4s) by the `diceThrow` block. `executeManualRoll` only kicks the roll; settle fires in the socket handlers.
- **Turn-change cue** — `becameMyTurn` block (already fired haptic) now pops the `#turn-indicator` once via `.turn-cue` (`@keyframes turnCue`, 0.6s) then drops the class so the idle `pulse` resumes. The badge is revealed later in the same synchronous render pass, so the anim plays on reveal.
- Both new keyframes are transform/filter only and covered by the `prefers-reduced-motion` guard.
- **Skipped (and why):** hand-fan-on-hover — user already likes the static fan, and a hover-spread shifts click targets (e2e flake risk). Modal **exit** transitions — would need to defer `.hidden` on every close path; tests assert immediate hide → higher risk, low reward vs the entrance we already added.

### 5b-3: sound + haptics pass
Goal was "everything should have a sound + haptics." Only `dice.ogg` ever shipped — `slash/magic/card_drop.ogg` were referenced but missing (silently 404'd). Instead of sourcing/licensing ~20 audio files, added a **Web Audio synth engine** (`Sound` IIFE near the top of app.js) — procedural blip/noise/arp recipes, no asset files, offline-safe. Verified: all 21 recipes run without throwing, mobile-smoke 14/14, no pageerrors.
- `playSound(name)` keeps its signature: plays a real file if one exists (`dice.ogg`), else synthesizes. `sfx` map trimmed to just `dice`.
- **Global press layer**: one capture-phase `pointerdown` listener unlocks the AudioContext (autoplay policy) and plays a light `tap` + 8ms haptic on any `button/.card/.action-btn/.opponent-chip/[onclick]/.clickable`. This is what gives "everything" feedback; specific actions layer richer sounds on top.
- Semantic hooks added: `cardDrop` (playCard), `slash`+haptic (attack), `draw` (draw/reload btns), `confirm` (end turn), `skill` (useSkillLater), `equip` (item lands on hero), `target` (selectTarget), `challenge` (playChallenge + `challenge_pending`), `modifier` (playModifier + `modifier_played`), `coin` (slay reward toast), `turn` (becameMyTurn), `open` (inspector), `win`/`lose` (game_over — compares `data.winnerName` to my name since server only sends winnerName).
- **Mute toggle**: `#mute-btn` (🔊/🔇) added left of the ☰ menu; `window.toggleMute` → `Sound.toggleMute()`, persisted in `localStorage['hts-muted']`. Mute silences **both** sound and haptics (`triggerHaptic` early-returns when muted).
- To add a new synth sound: add a recipe to the `recipes` map, call `playSound('name')`.
- **Recorded-SFX drop-in (preferred by user — synth is a placeholder):** every sound can be upgraded to a recorded file with no code restructure. In `app.js` there's a `SOUND_FILES` manifest listing all names commented out. To enable one: drop the file in `public/sounds/`, uncomment its line (filename incl. ext; or `[file, volume]`), and add the path to `PRECACHE_ASSETS` in `sw.js`. The file auto-overrides the synth for that name; a missing/failed file silently falls back to synth. Currently only `dice.ogg` is enabled; the rest stay synth until files are added. User wants to decide per-file over time.
- sw bumped `hts-v6` → `hts-v7`.

## 6. TODO / next (for the new chat)

1. **Use the `emil-design-eng` skill** for any further polish. The obvious candidates are done (5b, 5b-2). Remaining/optional: modal **exit** transitions (needs JS deferral on close paths — see skip note), hand-fan-on-hover (user likes current fan), victory-screen choreography. Good candidates: card hover/lift/select, hand fan on hover, dice-roll motion, modal enter/exit (challenge/inspector/victory), turn-change cue, monster-slain reward, AP-gem fill, page/orientation transitions. (`review-animations` skill exists for critiquing motion — it's manual-invoke only.)
2. Open layout questions the user may revisit: the **gap between hand and bottom buttons** in portrait; whether the shrunken **deck/discard rail** should be bigger; landscape hand still has the fan overlap (user likes the fan).
3. **Before shipping**: bump `public/sw.js` `CACHE_VERSION` again (currently `hts-v5`; more shell changes since) and run the **full e2e in both orientations**.
4. **Committing**: nothing is committed yet — the user hasn't asked to. Confirm before committing/pushing.

## 7. Skills installed

`.agents/skills/emil-design-eng` (model-invocable — use for UI polish/animation decisions) and `.agents/skills/review-animations` (manual review). Installed via `npx skills add emilkowalski/skill`; symlinked to Claude Code. They should appear as invocable skills in a fresh session.
