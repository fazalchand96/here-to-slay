# Session Handoff — 2026-06-22 (updated)

Quick-start context for the next chat. Read this first, then verify against the
current code (it may have moved on).

## Where things stand RIGHT NOW

- **Branch:** `main` (also keep `ui-rework` in sync — the deploy mirrors both;
  both now exist on the remote and point at the same commit).
- **Last commit:** `72f66c9` — "Landscape opponent chips: stack name over stats
  so long names show in full".
- **All commits PUSHED + DEPLOYED.** `origin/main` is up to date (`origin/main..HEAD`
  is empty). Render auto-deploys from `origin/main`.
- **Service worker cache:** `hts-v21` (bump on any further client change:
  `public/app.js` / `index.html` / `style.css`).

## What the latest session did (commit 72f66c9)

- **Landscape opponent chips no longer truncate long names ("GU…").** At 6
  players each chip is only ~70px wide; the single-line layout made the name
  share that width with the fixed `✋🏆🎴` stats, leaving it ~8px. Now the
  landscape chip stacks name-over-stats (column) like portrait, so the name gets
  the chip's full width. Tight `padding: 2px 6px` + `line-height: 1.15` +
  `gap: 0` keep both lines inside the fixed 34px opp row (no overflow onto the
  monsters strip — the reason stacking had been avoided before).
  (`public/style.css`, `body.landscape #opponents-bar .opponent-chip`.)
  Verified on Pixel 7 landscape (915×412, 6 players): all 5 names render in full,
  none clipped (incl. 11-char "Bartholomew"); `opponent-modal-stable` e2e passes.

## What the prior session did (all in commit 316366e)

1. **Holy Curselifter bug (real fix).** Played + used the same turn, it silently
   did nothing. The deferred self-item targeting state is `WAITING_FOR_SKILL_TARGET`,
   but the client click emitted `use_hero_skill` (rejected outside PLAYING/
   PROMPT_SKILL_ROLL). Now emits `submit_skill_target` in that state
   (`public/app.js`, isSelfItemTargeting click handler).
2. **6-player opponent bar.** Chips were too wide — only ~2 of 5 opponents showed
   in landscape, ~1 in portrait. Now compact (icons ✋hand/🏆slain/🎴classes) and
   flex-shrink so all 5 fit. Portrait stacks name-over-stats; landscape single-line.
   (`public/app.js` chip HTML + `public/style.css` `#opponents-bar .opponent-chip`.)
3. **Landscape monsters overlapping the opponent bar.** Grid row 1 was `auto` and
   under-sized (~19px) so the bar overflowed onto the monsters. Pinned row 1 to
   `34px` (`body.landscape #game-board` grid-template-rows).
4. **Small-screen fit (the "fits on iPhone, not Android" bug).** Portrait board is
   `height:100dvh; overflow-y:auto` but its fixed-height card sections summed to
   ~900px, so on phones shorter than that the hand + END button fell below the fold.
   Fixed: portrait card heights are viewport-relative `min(px, Ndvh)`, tighter
   `gap: clamp(...)`, plus a `@media (max-height:700px)` compression block.
   Verified the END button stays on-screen across 9 phone viewports both
   orientations via `test/e2e/cards/screen-fit.spec.js`.

### Earlier this session (already committed + DEPLOYED in prior commits)
- Slain monsters are tap-to-inspect.
- Hook / Beary Wise multi-step flow fixes; global-action subsystem made
  state-driven (no soft-lock).
- Items (normal or cursed) can be equipped to ANY hero on the board.
- Modifier cards: the player now CHOOSES the value (+ or −) on any roll/side.
- Challenge ties go to the CHALLENGER (house rule, `cFinal >= aFinal`).

## Verification status (the /goal: every card works, both orientations)

- Unit tests: **113/113 pass** (`npm test`).
- Landscape e2e: all card specs pass except 2 PRE-EXISTING harness flakes
  (Forced Exchange, Winds of Change — the spec's opponent challenge-modal times
  out; the card LOGIC is verified correct) + Quick Draw flake (passes on retry).
- Portrait e2e: **139 pass**, same known failures as landscape — NO
  portrait-specific card bug.
- 6-bot sim: 2 full games, zero crashes/soft-locks at max player count.
- Screen-fit: all 9 viewports pass (360×640 … 412×915 portrait; 640×360 …
  915×412 landscape).

## Open / possible next items

- The 2 magic e2e flakes (Forced Exchange / Winds of Change) are a TEST-harness
  issue, not card bugs — worth fixing the spec's challenge-pass step if you care
  about a green board.
- ~~Landscape opponent chips truncate long names to "GU…".~~ DONE in 72f66c9
  (stacked name-over-stats; see above).
- Auto-applied "may" effects (Plundering Puma "that player may draw", Decoy,
  Bloodwing, Crowned Serpent) are auto-resolved, not prompted — turn into real
  choices if desired (in the spirit of the modifier/item choice work).
- Bullseye doesn't let you reorder the 2 cards returned to the deck top.

## Deploy (how to push live)

There is no working cached/GUI git auth on this Windows box; pushing needs a
fine-grained PAT (Contents: read/write, scoped to the repo). Method that works
(token never persisted):

```bash
GIT_USER='fazalchand96' GIT_PAT='<token>' \
  git -c credential.helper= \
  -c credential.helper='!f() { echo username=$GIT_USER; echo password=$GIT_PAT; }; f' \
  push origin main
# then: git branch -f ui-rework main   (keep branches in sync)
```

Render auto-deploys from `origin/main`. Remind the user to revoke the PAT after.
The Bash tool has git on PATH; the PowerShell tool does NOT (prefix with
`$env:Path = "$env:ProgramFiles\Git\cmd;" + $env:Path`).

## Run / test commands

```bash
npm start                 # server on :3000
npm test                  # unit tests (node --test "test/**/*.test.js")
npm run test:simulation   # server + 2 bots auto-play (for N bots: node bot.js <name> <url>)
npx playwright test --project=mobile-chrome    # landscape e2e
npx playwright test --project=mobile-portrait  # portrait e2e
npx playwright test screen-fit                 # the new multi-viewport fit check
```

Test-only debug socket events: `debug_inject_card`, `debug_inject_to_party`,
`debug_equip_item`, `debug_set_hand` (new — replaces a player's hand for
deterministic pulls), `debug_force_next_roll`, `debug_add_slain_monster`,
`debug_add_to_discard`, `debug_stack_deck`. e2e helpers in
`test/e2e/helpers/gameSetup.js` (`setHand`, `startGameNPlayers`, etc.).

## Deeper notes

The persistent memory (auto-loaded each session) has the running detail —
especially `memory/card-audit-progress.md` (card-by-card audit + this session's
fixes) and `memory/deployment.md` (deploy specifics). MEMORY.md is the index.
