---
name: e2e-cards-suite
description: How the Playwright card e2e suite (test/e2e/cards/) works and its shared-server isolation gotchas
metadata:
  type: project
---

The e2e tests live under `test/e2e/`: `cards/*.spec.js` (card behaviors), root `lobby.spec.js` + `gameplay.spec.js`, and `mobile/mobile-smoke.spec.js` (viewport/tap/rotation). ~94 tests total, ~7 min at `--workers=1`. Run one file: `npx playwright test test/e2e/<path>.spec.js --workers=1`. **The suite is mobile-only** — the desktop `chromium` project was removed from `playwright.config.js`; only `mobile-chrome` (Pixel 7 landscape) remains, because this is a landscape-only mobile PWA. Goal state: full suite green (94/0/0).

**Single global gameState = isolation is fragile.** The server holds one `gameState` and adds every connecting socket to `playerOrder` on connect, resetting to LOBBY on any disconnect. Consequences baked into the helpers (`test/e2e/helpers/`):
- Specs must import `test`/`expect` from `helpers/fixtures.js` (not `@playwright/test`) so the auto-teardown fixture closes all contexts even on failure — a leaked context makes the next test's host wrong and cascades timeouts.
- Create contexts via `startGame()` or `newTrackedContext(browser, opts)` so they're tracked; never raw `browser.newContext()`. For a context built inline with special options (e.g. portrait), wrap it: `trackContext(await browser.newContext(...))`. Mobile specs use `startMobileGame()` / `MOBILE_VIEWPORT` from `mobile/mobileSetup.js` (also tracked).
- `closeTrackedContexts()` waits ~400ms after closing so disconnects settle before the next test connects.
- Force the start-game click (`#start-game-btn`, `{ force: true }`) — it pulses and the lobby re-renders each broadcast.

**Common per-test patterns:**
- Give an opponent (p2) a hero with `debug_inject_to_party` — NOT `playCard` (turn-gated during host's turn, silently dropped).
- To attack a monster you need party heroes meeting its requirement (every monster needs ≥1 hero); inject a full class spread (card_016/024/032/040/048/056).
- After a roll, pass the opponent's modifier window with `passOpponentModifiers(p2)` (polls) — a missed pass makes the roll wait out the server's 15s modifier timer and flakes downstream targeting.
- Click hand cards with `.first()` — the dealt hand can already contain a copy of an injected card (strict-mode violation otherwise).
- Targeting cards: opponent heroes only render inside `#opponent-modal`; `clickFirstValidTarget` opens it and retries the click until the inspector's SELECT TARGET button appears. valid-target/glow cards pulse, so force clicks.

With the above hardening the full mobile suite reached 94/0/0. Residual timing flakiness can still appear under load (Playwright `retries: 1` absorbs it); one signature is the host briefly showing "WAITING FOR OPPONENT TO SELECT A TARGET" (a `myId` vs `pendingAction.originalActor` propagation race).

Real mobile UI bug found+fixed via this suite: the action bar (`.action-bar`/`#player-controls`, 80px right sidebar) overflowed a 390px-tall landscape viewport — the End Turn button rendered off-screen. Causes: `.action-bar` had a stale `grid-row: 2/4` on a now-2-row `#game-board` grid (→ `2/3`), and the AP box (`.ap-display` 2rem) + turn indicator ate ~170px. Fixed by compacting `#turn-indicator` and `.ap-display` so all four action buttons fit.
