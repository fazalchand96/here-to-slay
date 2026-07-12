# Director state — animation + 6p stress-test goal

Written 2026-07-12 ~13:30 by the Fable 5 Director session. Read this plus
GOAL_ANIMATION_AND_TESTING.md, CONTEXT.md, and harness/results/FINDINGS.md to
resume with zero context. Verify against live logs — this is a snapshot.

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
