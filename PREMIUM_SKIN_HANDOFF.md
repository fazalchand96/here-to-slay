# Premium Tavern Skin — Handoff for the next chat

Self-contained context so another Claude Code chat can continue **without** this
conversation's history. Read this, then verify against the live code (it may have
moved on). Everything below is **uncommitted** working-tree changes.

## The goal (art direction)

Re-skin the game to the **"Premium Tavern Tabletop"** look: dark carved wood, brass
frames, ornate gem-cornered plaques. **This is the target — NOT** the older light
"cozy dusk" mockup (`screenshots/mockup-*.png`), which is abandoned.

The real design targets are:
- The **board mockups** the user pasted (fully-designed dark tavern board, landscape
  + portrait).
- The **asset sheets** in `public/assets/skin/`.

## The assets (already in the repo)

`public/assets/skin/` (see `ASSET_MANIFEST.md` there):
- `premium-tabletop-landscape.png` / `premium-tabletop-portrait.png` — **board
  backgrounds with the play zones carved into them** (deck slot, discard slot,
  monsters panel, party panel, a vertical AP track on the right/side, a hand tray).
  THIS is the key insight for the board work (below).
- `frames/` — per-type ornate card frames (hero/monster/magic/item/modifier/challenge).
- `buttons/` — plaque + coin crops used for buttons AND panels: `primary`(gold),
  `draw-blue`, `danger-red`, `reload-amber`, `confirm-green`, `disabled-dark`(dark
  plaque), `magic-violet`, `secondary-parchment`, `end-seal`(wax), `menu-square`,
  `icon-round`/`iron-round`(coins), `cancel-iron`.
- `textures/` — walnut, parchment, brass, leather, monster-leather, emerald-leather,
  blue-enamel, blackened-iron.
- `cards/` — card backs. `icons/` — AP gems, crests, deck/discard, menu/sound/close.

## PART A — Cards (frame template) — DONE structurally, crop DEFERRED

Each card = its per-type **frame PNG** as the whole `.card` background, with the
**cropped artwork** shown in the center window and a **blank ribbon** (pure art, no
name — user's explicit choice). Name/type/class are hidden (still in DOM for e2e).

Implementation:
- `public/style.css` — search **"Ornate frame templates"** block. Sets `.card`
  padding 0 + frame bg; `.card-face` = inset art window; hides `.card-type` /
  `.card-info`; crops `.card-img` per type via `background-size`/`background-position`.
- `public/app.js` — `renderCard` adds `type-<slug>` + `class-<slug>` classes and
  injects a per-card crop via `artCropStyle(card.id)` reading the **`ART_CROP`** map
  (near the top of app.js). `--art-pos` / `--art-size` override the per-type default.

### ⚠️ DEFERRED: per-card crop tuning
User is **"still not content"** — the wiki source images are watermarked ("SAMPLE",
accepted) and the per-type crop leaves some cards mis-framed. Decision: **fix every
card one-by-one via per-card `ART_CROP` entries**, but this was set aside to work on
the board first. Only `card_009` has an override so far.

**Review harness:** `node screenshots/cardsheet.js` → writes one PNG per type to
`screenshots/sheet/` (each card labeled with its id). It reads `ART_CROP` straight
from `app.js`, so the sheet always matches the game. Loop: eyeball a sheet → add
`card_xxx: { pos: 'center 25%', size: '170%' }` to `ART_CROP` in app.js → re-run →
repeat.

## PART B — Board alignment — LANDSCAPE DONE, PORTRAIT DONE

**Core idea:** the background PNG already has the zones carved in, so **stop drawing
CSS panels on top**. Instead: stretch the bg to fill the board exactly
(`background-size: 100% 100%` → `%` coords map 1:1 to the carved slots), make every
zone container transparent, and **absolutely-position each zone into its carved
slot**.

### Landscape (DONE)
In `public/style.css`, appended at the end — two blocks: **"BOARD ALIGNED TO THE
CARVED BACKGROUND (landscape)"** and **"Landscape HUD polish"**. It:
- Sets `body.landscape #game-board` to `display:block; position:relative;` bg
  `100% 100%`, kills the `::before` vignette.
- Absolutely positions (as % of the board): `#opponents-bar` (top), `.monsters-area`
  (top parchment panel), `#party-zone` (lower panel), `.deck-area` (left slots),
  `#ap-gems` (right green track), `#hand-zone` (bottom tray), `#leader-slot`
  (bottom-left), and the DRAW/RELOAD/END buttons (right rail).
- Polish: bigger cards to fill panels (viewport-relative `clamp`), AP gems enlarged,
  opponent chip → `disabled-dark.png` plaque, MONSTERS/YOUR PARTY → `secondary-
  parchment.png` ribbon labels centered on each panel's top edge.

**Gotcha that cost time:** `#hand-zone` is `position:relative` elsewhere, so an
absolute `#player-hand` resolves to that wrapper (floats to the top). Fix = position
`#hand-zone` (the wrapper), let `#player-hand` fill it. Same pattern applies if other
zones misbehave — check for a `position:relative` ancestor.

### Portrait (DONE)
In `public/style.css`, appended at the very end — "BOARD ALIGNED TO THE CARVED
BACKGROUND (portrait)" + "Portrait HUD polish". Mirrors the landscape approach:
`#game-board.portrait` → `display:block; position:relative;` bg `100% 100%`, kills the
`::before`; the flex wrappers (`#board-top-bar`, `#board-center`, `#player-zone`,
`#player-assets`) are flattened with `display:contents` so leaf zones position relative
to the board. Absolute placements (% of board): win-tracker → left half of the top
plaque, `#opponents-bar` → right half, `.deck-area` → the two carved squares,
`.monsters-area` → red panel, `#party-zone` → green panel, `#ap-gems` → right green
rail (vertical), `#hand-zone` → leather tray, `#leader-slot` → bottom-left wood pocket,
`#player-controls` → bottom plaque. Polish: cards sized to fill panels, AP gems on the
rail, opponent chips → `disabled-dark.png` plaque, MONSTERS/PARTY area-labels hidden
(the red/green rails already distinguish the panels; the inter-panel gap is too tight
for a ribbon). Overrides the older portrait flex rules via source order at equal
specificity. Minor nitpick left: leader card kisses the tray's gold corner scroll.

Capture harness used: `screenshots/cap-portrait.js` (portrait-only, `CAP_PORT`/`OUT`
env) against an isolated server on port 3100 so it never collides with the main :3000
server (e.g. while a bot simulation runs there).

## Verify + test (still TODO)
- `npm test` (unit — `node --test "test/**/*.test.js"`; keep the glob).
- e2e: `npx playwright test --project=mobile-chrome` (landscape) /
  `--project=mobile-portrait`. Cards hide `.card-name`/`.card-type`/`.card-info` via
  CSS but keep them in the DOM, so text-content selectors should still pass — watch
  for any visibility-based assertions.

## Dev workflow / gotchas
- Run server: `node server.js` (port 3000). **Restart it clean between screenshot
  runs** — a crashed capture leaves ghost browser contexts connected; the first
  `playerOrder[0]` ghost never rolls a leader, so `#start-game-btn` stays hidden and
  every later capture times out. Kill the port-3000 PID and restart.
- Screenshots: `node screenshots/capture.js` (a 2-player game → `screenshots/game-
  landscape.png` @844×390 + `game-portrait.png` @412×870).
- **Bump `CACHE_VERSION` in `public/sw.js` on every client change** (HTML/JS/CSS).
  Currently `hts-v31`. (Screenshot captures block the SW, so bumping isn't needed to
  see changes in captures — but it IS needed for the deployed PWA.)

## Files touched (all uncommitted)
- `public/style.css` — frame-template cards + landscape board alignment/polish.
- `public/app.js` — `ART_CROP` map/helper, card type/class slug classes,
  `setCardCountState` crowding helper.
- `public/sw.js` — `CACHE_VERSION` + precache the skin assets.
- New (untracked): `public/assets/` (the whole skin folder),
  `screenshots/cardsheet.js` (+ `screenshots/sheet/`), `screenshots/capture-crowded.js`.
- **Unrelated, also uncommitted** (don't mix into the skin commit): `cards.json`
  stat tweaks (Rex Major, Winds of Change wording), `scrape_wiki_compare.ps1`,
  `wiki_card_compare.json` — a separate card-data-vs-wiki task.

## Decisions locked
- Direction = dark premium tavern (NOT the cozy dusk mockup).
- Cards = pure art in the frame, blank ribbon (no name text).
- Watermark on wiki card images = accepted.
- Card crop = per-card overrides, one by one (deferred until after the board).

## Suggested next order
1. Portrait board alignment + HUD polish (mirror the landscape block).
2. Verify both orientations in-game + run `npm test` and e2e.
3. Resume per-card `ART_CROP` tuning using the cardsheet harness.
4. Then commit — ideally split: (a) premium skin, (b) the unrelated cards.json/wiki
   changes.
