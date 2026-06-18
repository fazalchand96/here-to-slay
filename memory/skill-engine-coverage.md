---
name: skill-engine-coverage
description: Unit-test coverage of skill_engine.js (per-card matrix) and known code-level findings
metadata:
  type: project
---

`test/skill_engine.test.js` (run `node --test "test/**/*.test.js"`, ~74 tests, no server/browser) is the **exhaustive per-card layer** — it calls `executeSkill`/`executeMagic` with a hand-built `gameState` + mock `io` and asserts exact state mutations. It covers **all 48 `skill_id`s and all 8 `MAGIC_*` effects** with edge branches (roll already resolved upstream; here we test the effect itself): protected targets (Terratuga / Mighty Blade `cannotBeDestroyed` / Calming Voice `cannotBeStolen`), empty deck/hand/discard, optional play-from-hand, multi-target partial, global-action targeting, etc. Factories live in-file: `makeIo()`, `card()`, `hero()`, `player()`, `makeState()`, `withRandom()`. Add a test here for every new card.

Server-side passive rules now have a unit harness too: **`test/server_rules.test.js`** covers `calculateRollDetails` (LEADER_BARD/RANGER/FIGHTER, MONSTER roll bonuses, ITEM_RING/CURSE_SNAKE, magicRollBonus), `meetsMonsterRequirements`, and `checkWinCondition`. To enable this, `server.js` now guards `server.listen` with `if (require.main === module)` and `module.exports` the pure functions; `meetsMonsterRequirements` was moved from inside the `io.on('connection')` callback to module scope. Full unit suite: ~95 tests. Coverage map lives in `test/COVERAGE.md` (remaining gaps: non-roll leader passives, most monster on-slay passives, item/curse equip effects, modifier math — all play-flow, not pure functions).

Resolved (previously open) findings:
- The duplicate dead `case 'SKILL_HEAVY_BEAR'` was removed.
- The discard-pile viewer was added: tap the discard pile (inside the BOARD modal) to open the read-only `#discard-viewer-modal` (`openDiscardViewer`/`closeDiscardViewer` in app.js; in `closeAllModals` keep-open list).
