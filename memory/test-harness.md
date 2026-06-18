---
name: test-harness
description: How unit tests run in this project and a node --test discovery gotcha
metadata:
  type: project
---

Unit tests use the built-in `node:test` runner (Node 26, no test framework dependency). `npm test` runs `node --test "test/**/*.test.js"`.

**Why the explicit glob:** the repo ROOT contains ad-hoc one-off scripts named `test.js`, `test2.js`…`test6.js`, `test-client.js`, `test_render.js` that are NOT unit tests — some connect to a running server and will hang `node --test`. Bare `node --test` (or `node --test test/` with a trailing slash) matches the root `test.js` instead of the real suite, so always scope to the `test/**/*.test.js` glob.

Real unit tests live in `test/` (e.g. `test/skill_engine.test.js`). The skill engine is testable in isolation because `skill_engine.js` exports pure-ish `executeSkill(gameState, io, ...)` / `executeMagic(...)` — tests pass a mock `io` that records `emit` calls and a hand-built gameState.
