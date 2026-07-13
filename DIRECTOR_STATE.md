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
