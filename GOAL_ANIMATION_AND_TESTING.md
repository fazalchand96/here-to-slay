# Goal: Premium Animation (via Codex) + 6-Player Mobile Stress Test

Written 2026-07-10, from a grilling session with the project owner. This is the
handoff for the **Fable 5** Claude Code session that will run this end to end.
Read `CLAUDE.md`, `HANDOFF.md`, and `CONTEXT.md` first for project context and
vocabulary (`Definition of Done`, `Fable 5 gate`, `streak`, `class animation`).

You (Fable 5) are the **Director** for this goal, in the sense of the
`/goal` skill: you own the Definition of Done, dispatch Codex (via this
project's Codex plugin) for the specialist work, and act as the **Fable 5
gate** — Codex's work is not done until you PASS it from screenshots.

---

## Standing rule (non-negotiable, applies throughout)

**Never `git push` or publish without asking the human first.** Committing to
a local working branch is fine. Destructive git operations remain blocked per
this repo's own git safety protocol.

## Usage-limit handling

There is no proactive quota meter for either Codex or Claude — only a reactive
"usage limit" error when a call actually fails (Codex surfaces this as text,
e.g. "You've hit your usage limit... try again at 7:44 PM"). **The moment that
error actually fires, stop and check in with the human** — do not try to
predict it in advance, and do not silently loop-and-retry unattended (a prior
unattended retry loop in this project got stuck for 4+ hours on a stale
`sleep`; don't repeat that pattern — surface it instead).

## Escalation cap

If the same Definition-of-Done criterion has been escalated to the human twice
(i.e. it already exhausted Codex's 5-round retry cap twice — see below) without
the human's intervention resolving it, **stop the entire goal and wait** rather
than continuing to grind other criteria around a known-broken one.

## Check-in milestones

Report to the human at each of these points (not continuously):
1. Alignment pass complete (Track A, step 1, PASS).
2. Animation pass complete = Track A fully DONE.
3. Landscape 50-game streak complete.
4. Portrait 50-game streak complete = everything DONE.
5. Any escalation per the cap above.

If invoked via `/loop` without an interval, self-pace between these milestones
rather than staying resident — this will likely span multiple sessions/days
due to Codex's image-gen quota resetting on its own schedule.

---

## Track A — Codex: alignment, then animation

Dispatch Codex via this project's Codex plugin. After each batch of work,
Codex must produce screenshots (reuse `screenshots/cap-both.js` / `cap-measure.js`
etc. — already produce landscape+portrait captures) proving the specific claim
being checked. You then render a **Fable 5 gate** verdict:
- **PASS** → check off that criterion, Codex moves to the next.
- **FAIL** → give Codex a specific, actionable critique; Codex fixes and
  resubmits the *same* criterion.
- If a single criterion fails **5 rounds in a row**, stop and escalate to the
  human instead of continuing indefinitely (see "Escalation cap" above).

### Step 1 — Alignment (must fully PASS before Step 2 starts)

Every zone, both orientations, verified against the carved background art —
not just the zones flagged as obviously wrong. Zones (from the existing
`?align=1` alignment editor): draw pile, discard, deck area, AP gems, leader,
monsters panel, party panel, hand tray, opponents bar, win tracker, action
buttons.

The specific complaint that started this: the draw/discard pile 2.5D stack
depth looks "too in-half-deep" and doesn't match the board's carved
perspective. Fix that, and re-verify every other zone against the same
standard.

**Bonus, non-blocking:** Codex may propose *additional* 2.5D depth layers
anywhere in the UI that would make it "pop" more. These don't block Step 1's
DoD — you (Fable 5) have final discretion on whether each proposed addition
earns its keep. Don't let this turn into open-ended polish-chasing.

### Step 2 — Animation (only starts once Step 1 fully PASSes)

Scope is **by class/event-type, not by individual card** (137 cards is not
feasible given Codex's ~15 min execution windows and hours-long quota resets).
Rendering approach is locked in: see `docs/adr/0001-css-sprite-sheet-animation.md`
— CSS sprite-sheet `steps()` animation + layered DOM elements, no canvas, no
new dependency.

Asset list (each is one **class animation** in the sense defined in
`CONTEXT.md` — authored once, reused across every card it applies to):

1. **Dice roll** — one shared tumbling-dice sprite sheet, used for every
   skill/attack roll.
2. **Hero skill activation** — one sprite sheet per class (Fighter=bear,
   Bard=squirrel, Guardian=unicorn, Ranger=fox, Thief=cat, Wizard=rabbit), a
   generic cast/flourish for that class's animal.
3. **Monster attack/slay** — one sprite sheet per monster, built on the
   monster's existing card art.
4. **Magic/Challenge/Modifier resolution** — a small set of generic effect
   bursts (buff, debuff, damage, draw), not one per card.
5. **Win/game-over** — a single finale sequence.

Track A is **DONE** when every item above has a Fable 5 PASS.

---

## Track B — Fable 5: build the test harness (parallel with Track A), then run it (after Track A is DONE)

### While Track A is running: build the harness

Don't sit idle waiting on Codex. Build a **real mobile-browser test harness**:
Playwright (or equivalent) with mobile-viewport device emulation, driving
**actual UI clicks/taps** — not the existing headless `bot.js`, which plays via
raw `socket.emit` and never touches the rendered client at all, so it can't
catch UI/layout/interaction bugs.

- Reuse `bot.js`'s existing decision logic (legal-move / monster-requirement
  heuristics) as the "brain," but actuate through real UI interaction in the
  Playwright mobile viewport instead of socket emits.
- Get it running reliably on a handful of games first so it's trustworthy the
  moment Track A is approved.
- Lower priority, if time allows: stage (don't commit) the unrelated **commit
  B** split from `HANDOFF.md` — `cards.json`, `skill_engine.js`,
  `test/skill_engine.test.js`, `scrape_wiki_compare.ps1`,
  `wiki_card_compare.json`. These aren't touched by Track A's work so there's
  no conflict staging them now; hold the actual commit until everything here
  is done.

### After Track A is DONE: run the stress test

**Two separate 50-game streaks, both at 6 players (max)** — one all-landscape,
one all-portrait. Isolated by orientation on purpose: a failure at game N tells
you which orientation's layout broke, not muddied by mixed clients in the same
game. The project owner specifically flagged that bugs get worse with more
players, hence 6p as the standard, not a sample of player counts.

**Streak-breaking bugs** (any of these resets the counter to 0, requires a fix
before resuming a *fresh* count — not resuming from where it broke, since a
fix could introduce a new regression):
1. Server crash / uncaught exception in `server.js`.
2. Client console error/exception in the mobile browser.
3. Softlock — no player has a legal action and the game stops progressing.
4. Wrong win detection — game ends without 3 monsters slain / 6 classes
   assembled actually being true, or fails to end when one is met.
5. Hand/state desync — a client's rendered state doesn't match what the server
   holds for that player (the `broadcastState()` hand-masking risk called out
   in `CLAUDE.md`).

**Not streak-breaking** — log and report separately, don't fail the run over
them: cosmetic layout issues (overlap, offscreen elements). Chasing every
pixel via automated failure would make a clean 50-game run nearly unreachable
and isn't what "bug" means here.

Track B (and the whole goal) is **DONE** when both 50-game streaks are clean.
