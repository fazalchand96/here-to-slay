# Overnight E2E Fix Session — Report

**Goal:** get `npm run test:e2e` (Playwright suite in `test/e2e/`) as green as possible, autonomously.

## Timing note
- Session was scheduled to start ~01:42 and run ~3h. The machine appears to have slept; the kickoff actually fired at **07:15:33 (2026-06-15)**. The original overnight window had passed, so I'm running the work now and iterating until the suite is as green as I can get it, then leaving this report. Prioritizing the actual goal (green tests + clear report) over burning clock time.

## Pre-session changes (done before sleep)
- `playwright.config.js`: added `workers: 1` (single global gameState — parallel workers collided).
- All 22 `page.goto('/')` → `page.goto('/', { waitUntil: 'domcontentloaded' })` (window `load` never fires; was timing out every nav).
- `bot.js`: multi-discard handler fix + self-recovery tick (simulation tooling; unrelated to e2e).

## Iterations

### Iteration 1 — baseline run
- Status: starting…
