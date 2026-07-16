# Card / rule test coverage ledger

How the test layers map to game logic. Keep this updated when adding cards or effects.

- **`test/skill_engine.test.js`** — unit tests for `executeSkill` / `executeMagic` (active hero skills + Magic). Fast, deterministic, no server/browser.
- **`test/server_rules.test.js`** — unit tests for the pure passive-rule functions exported from `server.js` (`calculateRollDetails`, `meetsMonsterRequirements`, `checkWinCondition`).
- **`test/e2e/`** — Playwright (mobile-chrome) for UI/integration: targeting flows, modals, viewport, lobby/turn flow.

Run: `node --test "test/**/*.test.js"` (unit), `npx playwright test --workers=1` (e2e).

## Active hero skills (48 `skill_id`s) — ✅ all covered (skill_engine.test.js)
Includes edge branches: protected targets (Terratuga, Mighty Blade/`cannotBeDestroyed`, Calming Voice/`cannotBeStolen`, Corrupted Sabretooth, Dracos), empty deck/hand/discard, optional play-from-hand, multi-target, global actions, deck peek, swap, discard search.

## Magic effects (8 `MAGIC_*`) — ✅ all covered (skill_engine.test.js)
ENCHANTED, CRIT_BOOST, WINDS_FORCE, CALL_FALLEN, ENTANGLING, EXCHANGE, WINDS_CHANGE, DESTRUCTIVE (incl. empty-hand branches).

## Passive effects
| Effect group | Coverage | Where |
|---|---|---|
| `LEADER_BARD/RANGER/FIGHTER` (roll bonuses) | ✅ | server_rules (calculateRollDetails) |
| `LEADER_WIZARD/GUARDIAN/THIEF` | ⚠️ gap | non-roll passives in play flow; not unit-tested |
| `MONSTER_ANURAN_CAULDRON/DARK_DRAGON_KING/TITAN_WYVERN` (roll bonuses) | ✅ | server_rules |
| `MONSTER_TERRATUGA/CORRUPTED_SABRETOOTH/DRACOS` (destroy interactions) | ✅ | skill_engine (DESTROY tests) |
| `MONSTER_ARTIC_ARIES/REX_MAJOR/MALAMAMMOTH/ORTHUS/MEGA_SLIME` etc. (draw/AP/on-slay) | ⚠️ gap | resolvePendingRoll / dealCards / startGame; not unit-tested |
| `ITEM_RING`, `CURSE_SNAKE` (roll mods) | ✅ | server_rules |
| `ITEM_MASK/COIN_RUSTY/DECOY`, `CURSE_KEY/COIN_SHINY` (equip effects) | ⚠️ partial | e2e equip-targeting; effect logic not unit-tested |
| `MOD_*` (modifier cards) | ⚠️ partial | e2e modifiers.spec (can be played); math not unit-tested |
| Monster attack requirements | ✅ | server_rules (meetsMonsterRequirements) |
| Win conditions (3 monsters / 7 classes) | ✅ | server_rules (checkWinCondition) |

## Known gaps / follow-ups
- Non-roll leader passives (Wizard/Guardian/Thief) and most monster on-slay passives (AP, conditional draws) live inside server.js play-flow handlers, not pure functions — they'd need either extraction or socket-level integration tests.
- Item/Curse equip *effects* (beyond roll mods) and Modifier *math* are only exercised at the e2e "it appears / can be played" level, not asserted on outcome.
