# Next chat handoff — Here to Slay UI/art state

## 2026-07-17 — Dragon Berserkers, Necromancers & Monster Expansion

- Implemented all 48 physical cards (`card_173` through `card_220`) from the Dragon Berserkers & Necromancers Expansion and Monster Expansion.
- Added the Berserker and Necromancer classes, bringing class-based victory to 7 distinct classes while ten classes are available in the game.
- Monster victory now requires a slain value of 4; Venomous Gemini still contributes 2 toward that total.
- Own/opponent party sheets render each Party Leader as a full card in its matching class column; target-selection instructions use a compact non-obstructive banner.
- Added all leader, Hero, Magic, Item, Cursed Item, Modifier, Challenge, and Monster effects, including queued/replacement interactions such as Dragon Wasp, Lumbering Demon, Big Buckley, and per-card draw triggers.
- Generated and installed 48 standalone WebP illustrations and 48 full-card WebP frames. Expansion cards are admitted to live decks only when their full frame exists.
- Added double-Item-slot markers to the four printed Berserker Heroes.
- Updated bot targeting/state handling and dynamic simulation card tracking.
- Verification: JavaScript syntax checks passed; `npm test` passed 210/210; the focused Android opponent-targeting regression passed; two-bot simulation ran through normal turns/challenges/modifiers without stalling; Android landscape lobby and representative card assets were visually verified.
- Current release cache version: `hts-v132`.
- Production URL remains `https://here-to-slay-ca6f.onrender.com/`.

Saved 2026-07-14 after the monster-card and monster-inspector pass.

## Current deployed state

- Latest deployed commit: `b2cf8f6 Fix monster inspector button row`
- Production URL: `https://here-to-slay-ca6f.onrender.com/`
- Current service-worker cache version: `hts-v93`
- `main` was pushed and mirrored to `ui-rework`.
- Last deployment verification: production `/sw.js` served `hts-v93`.

## Tests / checks

Most recent checks before deployment:

- `node --check public/app.js` passed
- `node --test "test/**/*.test.js"` passed: 131/131

## Important local working-tree status

Known unrelated local files were intentionally left untouched during the recent deploys:

- `DIRECTOR_STATE.md` is modified from earlier Director/session context.
- `output/` is untracked and contains generated/review artifacts.
- `screenshots/verify-hero-classes-and-roll.js` is untracked.
- `screenshots/verify-landscape-polish.js` is untracked.
- `screenshots/verify-opponent-slain.js` is untracked.

Do not assume these are part of the monster-inspector deployment unless the user asks.

## Monster full-card art work completed

All 15 Monster cards were generated as full baked card PNGs and wired into the board:

- Served path: `public/assets/skin/cards/monster-fullgen-v1/card_001.png` through `card_015.png`
- Board rendering uses `fullCardArtUrl` / `artUrl` pointing to the baked PNGs.
- Existing text overlays on the board were removed for full-art Monster cards.

Key files:

- `server.js`
  - Adds `illustrationArtUrl` for original art-web illustrations.
  - For Monster cards with generated full-card PNGs:
    - `fullCardArtUrl = assets/skin/cards/monster-fullgen-v1/<id>.png`
    - `artUrl = fullCardArtUrl`
    - `illustrationArtUrl = assets/skin/cards/art-web/<id>.webp`
- `public/app.js`
  - Adds `fullCardArtClass(card)`.
  - Board cards with `fullCardArtUrl` get `full-card-art`.
  - Monster inspect modal uses `illustrationArtUrl` so inspect shows original monster art, not the baked full card.
- `public/style.css`
  - `.card.full-card-art` renders the whole baked PNG as the visible board card.
  - Legacy board overlays are hidden for `.full-card-art`.

## Current monster inspector behavior

User likes these parts — do not change unless explicitly asked:

- Monster art in inspector: looks great.
- Monster name and description/details: looks great.
- Inspector uses original monster illustration from `art-web`, not the generated full-card PNG.
- Inspector details show slay/fail roll, requirement, and slay effect.

Latest user-requested inspector button behavior:

- No small X close button is needed.
- Bottom buttons should be two side-by-side buttons:
  - left: attack/locked button, e.g. `Locked: Requirements Unmet`
  - right: `CLOSE`
- CSS chrome should be transparent; use the button art itself.
- The button row fix was deployed in `b2cf8f6` / `hts-v93`.

If the next chat continues button polish, inspect this area first:

- `public/style.css` around `.full-card-art-inspector #inspector-modal-actions`
- `public/app.js` around `window.inspectCard`, especially the Attack Monster and Close Button sections

## Background/control history context

The landscape/portrait backgrounds previously had controls baked/painted in:

- chat/menu and sound buttons integrated into the background
- DRAW / RELOAD / END integrated into the background
- old live CSS text/buttons were made transparent/aligned over the artwork
- AP background/gems logic was adjusted so extra AP from slain monsters updates correctly

The latest active thread, however, was focused on Monster card generation and the Monster inspect modal.

## Deploy convention used recently

For deploys in this repo, recent successful flow:

1. Run exact tests:
   - `node --test "test/**/*.test.js"`
2. If touching `public/*.js`, `public/*.css`, or HTML, bump `public/sw.js` `CACHE_VERSION`.
3. Commit only intended files.
4. Push:
   - `git push origin main`
   - `git push origin main:ui-rework`
5. Verify production cache:
   - poll `https://here-to-slay-ca6f.onrender.com/sw.js?t=<timestamp>` for the new `hts-vXX`
