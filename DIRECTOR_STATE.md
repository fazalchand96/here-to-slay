# Director state — animation + 6p stress-test goal

Written 2026-07-12 ~13:30 by the Fable 5 Director session. Read this plus
GOAL_ANIMATION_AND_TESTING.md, CONTEXT.md, and harness/results/FINDINGS.md to
resume with zero context. Verify against live logs — this is a snapshot.

## ⚠️ UPDATE 2026-07-13

User reopened alignment (baked-background rework), paused streak testing to
do it first. Two streak-breaking softlocks were also found since the section
below was written and are NOT yet fixed — diagnose those once alignment work
is done (or in parallel if convenient).

**New scope (user-approved design, decided via clarifying questions):**
Root cause identified: the premium background uses `background-size: cover`
(crops differently per screen aspect ratio) while board zones position in
viewport-%, so live/baked elements can never reliably match the carved art
across devices — this is the real reason draw pile/discard/AP gems/labels
keep drifting no matter how many times individual zones get nudged.

Approved fix (in order):
1. **Fixed-aspect letterboxed stage** — wrap the whole board in one element
   sized to the background image's native aspect ratio, centered/letterboxed
   (thin dark bars on off-ratio screens, user accepted this tradeoff
   explicitly). Background renders at 1:1 inside the stage, never cropped.
   All overlays (live cards AND new baked-element hotspots) position in %
   of the STAGE, not the viewport. This is the enabling fix — without it,
   baking decor into the background just moves the drift, doesn't fix it.
2. **Bake static decor into the background art via sharp pixel compositing**
   (NOT AI regeneration — deterministic, uses existing PNGs like
   back-main.png/ap-empty.png, positioned via the `?align=1` editor's
   existing % coordinates so baked art and hotspot share one source of
   truth). Zones, in rollout order:
   - **Deck (FIRST — proof of concept)**: bake card-back stack into bg;
     live element becomes an invisible draw-hotspot only.
   - Discard: bake an empty/generic discard slot; click-to-view only
     (opens existing discard-viewer modal) — no live top-card render, no
     peek thumbnail, no count badge (user explicitly chose plain
     click-to-view over a peek+badge variant).
   - AP gems: bake empty sockets into background; overlay only the small
     lit glow per current AP (handles the 4th gem from Mega Slime).
   - "YOUR PARTY" / "MONSTERS" labels: bake text directly into the carved
     banners, no live label element at all.
   - Party/monster card slots stay live (content changes); only their
     empty-slot decoration/labels get baked.

**Deck-only POC: GATED PASS 2026-07-13** — task-mrjba4vy-d5l3el. Verified
independently (screenshots read + npm test rerun by Director, not just
trusted): fixed-aspect letterboxed stage works, deck stack + discard slot
align to carved recesses in both orientations, off-ratio captures show
clean pillarbox/letterbox with no crop drift, 116/116 tests.

**⚠️ SUPERSEDED 2026-07-13 (user):** user reviewed the POC and rejected the
sharp-compositing TECHNIQUE itself (pasting baked PNGs onto the existing
background) — wants the background art redrawn as one coherent piece
instead, elements painted in natively not pasted on. The fixed-aspect-stage
architecture from the POC is KEPT (validated, not in question) — only the
"how the deck/discard/labels/AP-socket art gets made" part changes from
sharp-composite to image-edit/regen.

**Round 2 dispatched:** Codex task **task-mrjcq1ul-r57r4a** (background,
--write, --resume-last, --model gpt-5.6-sol, same thread
019f5bdb-8a87-7e91-be35-322cfa1324c4). Scope: redraw
premium-tabletop-landscape.png + premium-tabletop-portrait.png with (1)
deck card-back stack, (2) empty discard slot (stays empty — top card still
renders live only on click, per user: pure click-to-view, no peek/badge),
(3) "YOUR PARTY"/"MONSTERS" labels carved into the banners (replacing the
DOM ribbon overlays for just those two), (4) empty/unlit AP gem-socket
track (lit-gem state stays a small live glow overlay per current AP — user
flagged this can't be baked since AP count changes live). Told Codex to
PREFER image-editing the existing background files in place (preserve
everything outside the 4 zones) over full text-prompt regeneration, to
avoid drifting from the established dark-tavern/brass/parchment look — full
regen only as fallback if its tool can't edit. Codex's restated plan
confirmed it's using "the image-editing skill with the current landscape
and portrait boards as source images" — the preferred path. Report must
state which path (edit vs regen) was actually used per orientation.
Gate from screenshots (normal + off-ratio, both orientations) + npm test
before considering alignment done.

**Round 2 attempt 1 FAILED 2026-07-13** — task-mrjcq1ul-r57r4a ran 50m11s,
correct plan (confirmed via restated intent), but the image-edit backend
call itself hung ~43 min then the stream disconnected 5/5 reconnects
exhausted ("stream disconnected before completion... backend-api/codex/
responses"), turn failed, ZERO output written (verified: premium-tabletop-
landscape/portrait.png untouched on disk, same mtime as before the turn).
Not a logic failure — pure network/backend flake on a long image-gen call.

**Retry (task-mrjgmvu2-87eecy) ALSO disconnected (3m30s)** but — key finding
— the actual image-edit calls had ALREADY SUCCEEDED before the stream drop;
only a follow-up local step got cut off. Director verified on disk:
premium-tabletop-landscape.png (now 1672x941) and premium-tabletop-
portrait.png (now ~863x1823) were both overwritten with real new art.
Director visually inspected both — genuinely good: baked deck stack, a
visually distinct empty discard slot, carved 4-socket AP gem track, and
"MONSTERS"/"YOUR PARTY" painted natively into the carved banners,
style-consistent with the rest of the board. Art content itself looks
correct (final gate still pending screenshots once wired into the live game).

**Wiring-only follow-up dispatched:** task-mrjh5b1u-fuqv0v (--resume-last,
same thread). Explicitly told: do NOT regenerate/re-edit images again, the
two new PNGs are final — this round is pure CSS/JS wiring (point
deck-stage.generated.css at the plain premium-tabletop-*.png instead of
the round-1 -deck-baked.png variants, re-measure deck coords via ?align=1
since art changed, add new stage-relative coords for discard slot + AP
socket track, convert #discard-pile to an invisible hotspot opening the
existing discard-viewer modal, convert AP gems to a lit-glow-only overlay
on the baked sockets, hide the now-redundant DOM MONSTERS/YOUR PARTY
ribbon labels, retire the round-1 sharp-bake runtime dependency). No image
generation this round → should NOT hit the network-hang failure mode above.

**Gotcha: Monitor tool unreliable for this** — armed a 30-min Monitor poll
loop (status check every 30s + heartbeat every 2min) on attempt 1; it
produced ZERO events (no heartbeats, no terminal-state catch) and just
silently timed out at 30 min, even though the task was genuinely still
running for the whole window (didn't fail until 50m11s, i.e. ~20min after
the monitor gave up). Root cause not diagnosed — could be a script/quoting
issue under this Monitor's shell, or events getting dropped. Don't trust a
long Monitor window for these Codex jobs; prefer manual status checks on
request, or a monitor with a verified-working heartbeat before trusting it
unattended.

## ⚠️ STREAK TARGET CHANGED (2026-07-12, user): 15 games per orientation, NOT 50.
Relaunch streaks with `--games 15` (was 50). DoD = two CLEAN 15-game 6p streaks
(landscape + portrait), 2 lanes each. Live deploy is on the -ca6f URL; every
bug fix → commit/push/deploy (Codex fixes, Director does git — Codex .git is RO).

## Definition-of-Done status

- **Track A Step 1 (alignment): PASS** (4 gate rounds; portrait leader needed a
  reserved 40px party-grid inset; occupied-discard proofs via OCCUPY_DISCARD=1).
- **Track A Step 2 (animation): PASS — Track A fully DONE.** All five assets
  gated from real-flow captures: dice (numeric steps verified), 6 class casts,
  15 monster strikes (composited from card art; overlay restoration via hard
  timer + generation tokens), 4 bursts, finale (plays BEHIND the victory panel).
  Technique per docs/adr/0001 (CSS steps() + layered DOM). Cache: hts-v65.
- **Track B harness: built** (harness/brain.js, driver.js, game.js, streak.js).
  Real UI taps, 5 streak-breaker detectors, breaker screenshots to
  harness/results/breaks/, per-action outcome logging (r/ms fields).
- **Landscape 50-streak: IN PROGRESS, attempt 7 (fast harness, 2 lanes)** —
  detached, ports 3200-3201, baseSeed 555007, logs
  harness/results/logs/landscape50g-*.log, results JSONL
  harness/results/landscape-6p-2026-07-12T12-27-05-939Z.jsonl. Launched
  2026-07-12 ~12:27 UTC. Attempt 6 (landscape50f, single-lane, slow harness)
  reached 2 clean + game 3 in progress and was deliberately killed to relaunch
  on the gated fast harness (per plan; not a break).
- **Portrait 50-streak: IN PROGRESS, attempt 2 (fast harness, 2 lanes)** —
  detached, ports 3300-3301, baseSeed 777002, logs
  harness/results/logs/portrait50b-*.log, results JSONL
  harness/results/portrait-6p-2026-07-12T12-27-10-143Z.jsonl. Launched
  2026-07-12 ~12:27 UTC.

## ⚠️ HOLD (user, 2026-07-13)

Hold everything else — including diagnosing the two new streak-breaker
softlocks above — until the alignment rework (deck POC, then
discard/AP/labels) is fully gated PASS. Do not resume streak testing or
softlock diagnosis until the user says alignment is done.

## ⚠️ Alignment gated PASS + shipped 2026-07-13 — HOLD LIFTED

Round 2 wiring gated PASS by Director (independently verified: 116/116
tests, all 6 screenshots correct, discard hotspot opens viewer in both
orientations). Committed `060e531`, pushed to origin/main, confirmed LIVE
on Render (hts-v71 verified on production /sw.js + deck-stage.generated.css
served correctly). The whole alignment goal (Track A step 1 rework) is
DONE. User lifted the hold and requested next batch of work (below).

**DONE — card-logic bug batch: GATED PASS + SHIPPED 2026-07-13.**
task-mrjjhbog-mz0spm. All 8 items fixed (Mimimeow/Mask, Orthus, Rex Major,
Crowned Serpent confirmed not-actually-regressed + hardened, Sly Pickings,
Buttons free-play, Winds of Change, opponent-modal slain monsters).
Director independently reran `node --test "test/**/*.test.js"` → 123/123
(not just trusted Codex's report). Codex's own sandbox had NO browser
available so it could not produce the opponent-modal screenshot it was
asked for — Director wrote a standalone Playwright script
(screenshots/verify-opponent-slain.js, NOT committed, kept locally as
scratch) to independently prove it: 2 slain-monster icons render in the
opponent modal, screenshot confirms visually. Committed `481434e`.
**GOTCHA — Codex changed public/app.js but did NOT bump CACHE_VERSION in
public/sw.js** (project convention requires this on every client-file
change or the PWA serves stale JS to installed clients). Director caught
this before it shipped, bumped hts-v71→hts-v72, committed `3a76fc1`
separately. Pushed both; live-deploy verification in progress. **Add "bump
CACHE_VERSION in public/sw.js if you touch any public/*.js|html|css file"
to future Codex dispatch prompts explicitly** — it was in the original
alignment prompts (round 1/2 both bumped it correctly) but NOT in this
card-logic prompt since Director didn't think to ask, and Codex didn't
infer it from project convention on its own.

**IN PROGRESS — reconnect grace period:** task-mrjkmy6u-pu55nv, fresh
thread 019f5ccb-5064-7bb3-b443-6e5a0b7d9833. Dispatched with the full
root-cause + two-part fix spec below, explicit reminder to bump
CACHE_VERSION (currently hts-v72) if it touches any public/*.js|html|css,
and instructions to write unit tests + attempt a real e2e reconnect sim.
Gate the same way as the last two batches (Director verifies independently,
does not just trust the report) before commit/push/deploy. User report
2026-07-13: backgrounding the app briefly (switching to WhatsApp/TikTok for
a few seconds) gets them kicked "too fast." Director root-caused in
server.js:
- `new Server(server)` (line 12) uses Socket.IO DEFAULT ping timing (~25s
  interval + ~20s timeout ≈ 45s before a stalled connection even fires
  'disconnect') — mobile OSes commonly throttle/suspend background-tab JS
  around that same window.
- WORSE: the `disconnect` handler (line 2406-2464) has ZERO grace period —
  the instant it fires mid-match, `clearBoard()` wipes activeMonsters/
  mainDeck/discardPile/pending* AND resets EVERY remaining player's hand/
  party/slainMonsters/leader back to LOBBY, immediately, for the whole
  match. One player's phone lock currently costs everyone their game.
Fix needs TWO parts: (a) raise `new Server(server, { pingInterval, pingTimeout })`
to something more lenient (e.g. 25s/60s) so brief backgrounding often never
even fires disconnect; (b) add a real reconnect-grace window (~60-90s)
that holds the disconnected player's seat/state instead of immediately
wiping to LOBBY, keyed by a persistent client-side token (socket.id changes
on reconnect, so identity needs to survive the reconnect some other way) —
only wipe to LOBBY if the grace period elapses with no reconnect. This is a
real feature (server session persistence across reconnect), not just a
config tweak — scope it accordingly, write tests, gate before shipping.

**QUEUED NEXT #2:** landscape-only UI request from user 2026-07-13 (given
across two messages, consolidated + Director root-caused each item below
against current code before dispatch):
- The DRAW / RELOAD / END action buttons (right rail) should be stacked
  vertically on top of each other in the corner (verify current layout
  first — may already be a vertical stack; user says DRAW/RELOAD currently
  sit "a bit too high" — lower their position).
- DRAW button's blue fill and RELOAD button's amber fill do not fully fill
  their button/plaque shape.
- The win tracker ("Slain ooo / Classes X/6", currently top-right in
  landscape) should move to the LEFT side of the screen, vertically
  centered (middle of screen height), with Slain and Classes stacked
  top-to-bottom instead of the current horizontal single-line layout.
  Portrait is NOT mentioned — landscape only unless told otherwise.
- **AP indicator overlap — user wants it RE-DESIGNED, not just nudged.**
  Root cause (Director, public/style.css ~line 6121-6131): `#ap-gems
  .ap-gems-label` ("AP" text) is `position:absolute; top:-18%` inside the
  `#ap-gems` stage-relative box, which is only `--ap-track-width: 3.6%`
  wide / `28%` tall in landscape — pushing the label upward out of that
  tiny box collides with the gem sockets/other elements. User: scrap the
  current text-label-above-gems approach, think of a different way to
  show AP (e.g. drop the redundant "AP" text entirely — the gem column is
  already visually distinct on the rail, same reasoning as why DECK/
  DISCARD don't need text labels — or find a placement that cannot
  collide with the 4-socket track). This is fresh (round-2 wiring, today),
  not a regression.
- **Split the two floating icon buttons.** Root cause (Director,
  public/style.css ~line 3572-3593): `#mute-btn` (sound) and
  `#game-menu-btn` (☰, toggles the game log — user calls it "chat", it is
  actually the event/game log) are both `position:fixed; top:8px`,
  `right:10px` / `right:56px` — clustered together top-right. User wants
  ONE button top-right, the OTHER moved to top-left (does not say which
  goes where — Director/Codex judgment call, e.g. sound stays right,
  game-log moves left, or vice versa; note reasonably not portrait-scoped
  either since this rule isn't currently orientation-scoped, ask user or
  keep both orientations consistent).
- **Button/icon asset scaling — likely the SAME root cause as the
  DRAW/RELOAD fill issue above, look at all of them together.** Root cause
  (Director, public/style.css ~line 5070-5092): `#mute-btn`/`#game-menu-btn`
  background uses `url(assets/skin/buttons/icon-round.png) center/100%
  100%` stretched into a **non-square** 40x34px box (round plaque asset
  forced into a non-1:1 box will distort), with a fixed 22x22px icon
  layered on top via `::after`. Check whether DRAW/RELOAD/END use the same
  stretch-to-fit pattern against their own plaque assets (draw-blue.png /
  reload-amber.png / end-seal.png per PREMIUM_SKIN_HANDOFF.md's asset
  list) — likely why those colors "don't fully fill the square" too. Fix
  the general pattern (button box aspect ratio should match its plaque
  asset, or use `contain`/`cover` correctly) rather than patching each
  button's numbers individually.
- Gate via landscape screenshots (landscape only per the request) before
  commit/push/deploy.

**QUEUED NEXT #3 (dispatch after reconnect-grace is gated+committed):**
AND-vs-THEN hero-skill targeting bug, user-reported via Serious Grey
2026-07-13, user correctly suspected it affects other cards too. Root
cause (Director, server.js ~line 706-714): the deferred-targeting gate for
EVERY skill in `TARGETING_SKILLS` (server.js line 91) does ONE blanket
check — `hasOpponentHeroTarget(...)`, and if false, fizzles the ENTIRE
skill with a message and `resetToPlayingState()`, no partial effect at
all. This is correct for THEN/single-clause cards but wrong for AND cards
with an independent second clause — violates [[then-vs-and-card-playability]]
("X AND Y → playable if either part can").

Director pre-classified every card in TARGETING_SKILLS against its actual
cards.json text before dispatch (do not re-derive from scratch, verify
against current code instead — this is 2026-07-13):
- Bad Axe (DESTROY_HERO), Kit Napper (STEAL_HERO): single-clause, ALREADY
  CORRECT, not a bug.
- Destructive Spell (MAGIC_DESTRUCTIVE): explicit "DISCARD... then
  DESTROY" — sequential, ALREADY CORRECT (matches prior fix in
  [[card-audit-progress]]).
- Shurikitty: item-transfer is a CONSEQUENCE of the destroy (conditional
  on it happening), not an independent action — ALREADY CORRECT.
- Tipsy Tootie: "steal... and move Tipsy Tootie to that party" is one
  combined steal action, not two independent ones — ALREADY CORRECT.
- Wiggles: surface wording says "and" but "roll to use its effect
  immediately" is entirely dependent on WHICH hero got stolen — correctly
  sequential despite the "and", ALREADY CORRECT.
- **Serious Grey ("DESTROY a Hero and DRAW a card") — CONFIRMED BUG**,
  matches user report exactly. No destroy target should still allow the
  draw.
- **Whiskers ("STEAL a Hero card and DESTROY a Hero card") — LIKELY SAME
  BUG.** Two independent hero-targeting actions; current flow (per
  [[card-audit-progress]]) checks for a legal STEAL target upfront via
  this same gate — if none exists but a DESTROY target does, it should
  still fire the destroy half instead of fully fizzling.
- **Meowzio ("STEAL a Hero from that player AND pull a card from that
  player's hand") — AMBIGUOUS, needs judgment, do not auto-fix.** If the
  chosen player has no Hero but has hand cards, should you still be able
  to choose them just to pull? Flagged for Codex to reason through and
  report its choice, not decide unilaterally.

Dispatch instructions for Codex: fix Serious Grey and Whiskers per the AND
rule (let the independent half resolve when only one target type is
legal), reason through and resolve the Meowzio edge case explicitly
(report the decision), do NOT touch Bad Axe/Kit Napper/Destructive
Spell/Shurikitty/Tipsy Tootie/Wiggles (already correct — re-verify with
existing tests, don't "fix" them). Add unit tests for the newly-fixed
partial-resolution paths. Remember the CACHE_VERSION bump rule if any
public/*.js|html|css file changes (check current value in public/sw.js
first, do not assume hts-v72 — Director bumped it once already this
session and Codex's own reconnect-fix task may have bumped it again).

**Explicitly deferred (user, 2026-07-13):** the 2 streak-breaker softlocks
(landscape50i game 11 PROMPT_SKILL_ROLL stall, portrait50d game 8
WAITING_FOR_CHALLENGES stuck-retry) and resuming the 15-game streak runs —
"not necessary right now, we will do that later." Do not pick these up
unless the user asks.

**Queued bugs reported by user during the hold (not yet fixed):**
- 6 card-logic bugs (Mimimeow/Thief-Mask, Ortus, Rex Major, Serpent, Sly
  Pickings, Buttons) + Winds of Change — logged with full detail in memory
  [[card-audit-progress]], several flagged as possible regressions of
  previously-"DONE" fixes.
- **Opponent modal never shows slain monsters (UI bug, root-caused, ready
  to fix quickly when unblocked):** `public/app.js`, `openOpponentModal`
  (~line 1237-1253) builds `cardsHtml` from `opp.leader` + `opp.party`
  only — `opp.slainMonsters` is never included, so inspecting an opponent
  shows their leader/party but never their slain-monster trophies (the
  opponent bar's slain *count* chip is fine, this is the detail-view gap).
  Also fix while there: `oppModalSignature` (~line 1275-1285), which gates
  when the modal re-renders, doesn't fingerprint `slainMonsters` either —
  add it or a change in opponent's slain monsters between broadcasts won't
  trigger a rebuild even after the render fix.

## In flight right now

- Codex task task-mrho8gfx-lz7roc (harness speedup): **COMPLETED and GATED
  PASS 2026-07-12** by the test-ops agent. Verified: --lanes plumbing sound
  (shared game scheduler + clean counter, per-lane ports base+i, first breaker
  aborts all lanes, aborted lanes recorded as 'aborted' not breakers);
  TICK_MS 150 + 50 jitter. Key speedup was a real harness bug — normal
  modifier phases render #dice-pass-btn but the harness only clicked
  #modifier-pass-btn, so every roll ate the server's 15s fallback; the
  selector now hits either. Verification game: 6p landscape CLEAN in 5.1 min
  (vs 21.7 min recorded average, ~4x faster). Games should now run ~5-8 min.
- **WATCH ITEM (possible game bug, unconfirmed):** both of Codex's 2-player
  smoke runs broke on a hand desync ("P2: hand DOM=5 state=4", stable 10s+;
  screenshots harness/results/breaks/landscape-g1-desync-*.png and
  landscape-g2-desync-*.png). Never seen at 6p (27 prior clean games + the
  5.1-min verification were clean). Could be a render race exposed by the
  faster cadence. The relaunched streaks carry the same detector — if it
  reproduces at 6p, diagnose via the breaker screenshots + actionsTail.
- A game server for screenshots runs detached on port 3100.

## Standing rules (from the goal spec + user)

- Never git push. Local commits only if asked. Commit-B files are STAGED only.
- All Codex dispatches: `codex-companion.mjs task --background --write
  --resume-last --model gpt-5.6-sol "<prompt>"` (user-mandated model; also in
  memory codex-model-gpt-5-6-sol.md). Session id 019f4d9e-3e4a-73b0-ba5b-23f2117e9a9d.
- On a REAL "usage limit" error (not "model at capacity" — that's transient,
  retry once): stop and tell the user.
- 5 failed gate rounds on one criterion → escalate; 2 unresolved escalations →
  halt the goal.
- Streak-breakers: server crash, client console error, softlock, wrong win,
  hand/state desync. Cosmetic issues log to the verdict, never break.
  A break → fix → FRESH 50 count.
- Check-in milestones remaining: landscape-50 done, portrait-50 done (= goal DONE).

## Gotchas learned this goal

- Session restarts kill session-scoped background tasks: run streaks/servers
  DETACHED (Start-Process, logs to harness/results/logs/), poll on wakeups,
  and read BOTH -out and -err logs (breakers print to stderr).
- Never rewrite files with PowerShell Get-Content|-replace|Set-Content — it
  mojibakes UTF-8 (happened once; reversed byte-exactly). Use the Edit tool.
- games ~20-30 min at 6p; GAME_CAP_MS is 60 min on purpose (long games are legal).
- Playwright force-clicks don't scroll and land on covering overlays — the
  driver closes the inspector before banner clicks; keep that pattern.
- cards.json has duplicate card ids: always scope hand taps to #player-hand.
- Bash tool: backticks inside a double-quoted command STRING trigger real shell
  command substitution (even for markdown-style `file.css` references in a
  Codex prompt) — one dispatch hit `?align=1: command not found`. Avoid
  backticks in prompt text passed via Bash; use plain text or single-quote
  the whole arg instead. Confirmed harmless here (Codex's restated plan
  showed the intent survived), but don't rely on that.
