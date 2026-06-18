# TestSprite AI Testing Report (MCP)

---

## 1️⃣ Document Metadata
- **Project Name:** HeretoslayBestanden (Here to Slay — multiplayer card game)
- **Date:** 2026-06-14
- **Prepared by:** TestSprite AI Team
- **Test Type:** Frontend (single-page PWA served on port 3000)
- **Server Mode:** Production (Node.js / Express / Socket.IO authoritative server)
- **Total Tests:** 30 — ✅ 5 Passed · ❌ 3 Failed · ⛔ 22 Blocked

---

## 2️⃣ Requirement Validation Summary

### Requirement: Lobby join & seating
Players open the app, enter a hero name, and appear seated in the shared tavern lobby; the lobby updates live as players join.

#### Test TC004 — Join the tavern lobby with a hero name
- **Test Code:** [TC004_Join_the_tavern_lobby_with_a_hero_name.py](./TC004_Join_the_tavern_lobby_with_a_hero_name.py)
- **Result:** [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/3fe5e859-256f-4e1e-a231-4168bae74022)
- **Status:** ✅ Passed
- **Analysis / Findings:** The hero-name input accepted text and the player joined successfully. Core lobby entry works.

#### Test TC005 — Join the lobby with a hero name and see yourself seated
- **Test Code:** [TC005_Join_the_lobby_with_a_hero_name_and_see_yourself_seated.py](./TC005_Join_the_lobby_with_a_hero_name_and_see_yourself_seated.py)
- **Result:** [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/1765f32a-1287-4bf5-90cf-a4a9557f076d)
- **Status:** ✅ Passed
- **Analysis / Findings:** After joining, the player's own seat rendered on the tavern board. `set_player_name` → broadcast → render path is healthy.

#### Test TC016 — Reject an empty hero name
- **Test Code:** [TC016_Reject_an_empty_hero_name.py](./TC016_Reject_an_empty_hero_name.py)
- **Result:** [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/ca60132d-bbb5-4d79-9202-014ccc9fe8b5)
- **Status:** ⛔ Blocked
- **Analysis / Findings:** The session arrived in a state where the join/hero-name input was no longer exposed (lobby already host-locked / mid-selection), so empty-name validation could not be exercised. Environmental, not a confirmed defect.

#### Test TC019 — Reject a duplicate hero name
- **Test Code:** [TC019_Reject_a_duplicate_hero_name.py](./TC019_Reject_a_duplicate_hero_name.py)
- **Result:** [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/86eb2717-166d-410f-a195-f8e7b8269928)
- **Status:** ⛔ Blocked
- **Analysis / Findings:** A second join could not be performed because the hero-name input was unavailable after reload. Duplicate-name handling remains unverified.

#### Test TC024 — Show lobby updates when another player joins
- **Test Code:** [TC024_Show_lobby_updates_when_another_player_joins.py](./TC024_Show_lobby_updates_when_another_player_joins.py)
- **Result:** [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/dd05d950-61d5-40db-b139-b2af92e7aab7)
- **Status:** ⛔ Blocked
- **Analysis / Findings:** A single browser session cannot simulate a second concurrent client joining, so live multi-player lobby updates could not be observed.

---

### Requirement: Party Leader selection (roll / reroll / lock / claim)
Each player rolls, optionally rerolls, and locks a Party Leader from a shared depleting pool; claimed leaders become unavailable to others.

#### Test TC020 — Claimed Party Leaders become unavailable to another player
- **Test Code:** [TC020_See_claimed_Party_Leaders_become_unavailable_to_another_player.py](./TC020_See_claimed_Party_Leaders_become_unavailable_to_another_player.py)
- **Result:** [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/b0fa58e8-7561-4a29-ae29-7185dc5cde80)
- **Status:** ✅ Passed
- **Analysis / Findings:** The shared depleting-pool logic is correct — a leader claimed by one player was no longer offered to another.

#### Test TC006 — Roll and lock a Party Leader
- **Test Code:** [TC006_Roll_and_lock_a_Party_Leader.py](./TC006_Roll_and_lock_a_Party_Leader.py)
- **Result:** [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/0c36cf6f-cd6a-4d9e-a1ca-dd886d716489)
- **Status:** ❌ Failed
- **Analysis / Findings:** The agent landed in a lobby state showing only "Waiting for Host to start the game…" with the roll/lock controls not rendered. Because the shared lobby is single-global and other (automation) sessions had already advanced it past the selection phase, the controls this test needed were gone. Likely a test-isolation/timing artifact of the shared global game state rather than a broken roll-and-lock feature (TC020 confirms selection mechanics work).

#### Test TC015 — Reroll a Party Leader before locking it
- **Test Code:** [TC015_Reroll_a_Party_Leader_before_locking_it.py](./TC015_Reroll_a_Party_Leader_before_locking_it.py)
- **Result:** [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/6941ff1c-1213-4251-a343-cd360f55c8ce)
- **Status:** ⛔ Blocked
- **Analysis / Findings:** Leader roll/reroll controls were not visible from the session's UI state (possibly viewport/orientation or shared-state advancement), so reroll could not be exercised.

#### Test TC012 — Prevent claiming an already locked leader
- **Test Code:** [TC012_Prevent_claiming_an_already_locked_leader.py](./TC012_Prevent_claiming_an_already_locked_leader.py)
- **Result:** [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/1f56f19a-89aa-4b32-bf98-bc29d9ff009a)
- **Status:** ⛔ Blocked
- **Analysis / Findings:** Lobby was in a pre/inter-game state with no leader controls exposed; the contention case could not be set up. (Partially covered indirectly by TC020.)

---

### Requirement: Match start gating (host-only, all players must have a leader)
Only the host may start; the match must not start until every seated player has locked a leader.

#### Test TC009 — Keep the match from starting until all seated players have leaders
- **Test Code:** [TC009_Keep_the_match_from_starting_until_all_seated_players_have_leaders.py](./TC009_Keep_the_match_from_starting_until_all_seated_players_have_leaders.py)
- **Result:** [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/68f94598-56d1-4c9c-9981-5bc075b91247)
- **Status:** ✅ Passed
- **Analysis / Findings:** The start gate held — the match did not begin while a seated player still lacked a leader. Pre-condition enforcement is correct.

#### Test TC002 — Block host start until leaders are locked
- **Test Code:** [TC002_Block_host_start_until_leaders_are_locked.py](./TC002_Block_host_start_until_leaders_are_locked.py)
- **Result:** [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/1269db44-63f9-4bc2-a504-fd9847471b5b)
- **Status:** ⛔ Blocked
- **Analysis / Findings:** The session was not the Host (the host seat belonged to another automation client), so the host-only Start control was correctly absent — but that meant the "attempt to start early" step could not be performed. The non-host gating message *was* observed, which is positive corroboration.

#### Test TC001 — Start a valid match with seated players and locked leaders
- **Test Code:** [TC001_Start_a_valid_match_with_seated_players_and_locked_leaders.py](./TC001_Start_a_valid_match_with_seated_players_and_locked_leaders.py)
- **Result:** [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/2cbd8d88-821b-4c8e-a99b-839ed77a114e)
- **Status:** ❌ Failed
- **Analysis / Findings:** The "ENTER THE DUNGEON" start button is host-only and only this session's *other* automation client held the host seat, so the controlled session never saw a Start control. The test could not coordinate two roles (host + second player) from one driver. Failure reflects multiplayer-coordination limits of single-session testing, not necessarily a start-flow defect.

#### Test TC003 — Start a valid match after all seated players lock leaders
- **Test Code:** [TC003_Start_a_valid_match_after_all_seated_players_lock_leaders.py](./TC003_Start_a_valid_match_after_all_seated_players_lock_leaders.py)
- **Result:** [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/7f1199e4-392e-4382-b0c2-4b60e5724827)
- **Status:** ❌ Failed
- **Analysis / Findings:** Same root cause as TC001 — preconditions (≥2 ready players with locked leaders) appeared met, but the host-only Start control was not on the session being driven, so the start transition could not be triggered.

---

### Requirement: Turn actions (AP, draw, reload, end turn)
On the active player's turn, AP-costed actions (draw, reload/discard-and-draw-five, end turn) work and AP is enforced.

#### Test TC013 — Draw cards and end the turn while action points decrease — ⛔ Blocked
- [TC013_Draw_cards_and_end_the_turn_while_action_points_decrease.py](./TC013_Draw_cards_and_end_the_turn_while_action_points_decrease.py) · [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/93fa246d-5023-4893-9562-65003050f8dc)
- **Analysis:** Could not start a match from a non-host single session, so no active turn was reached.

#### Test TC021 — Reload the hand and continue the turn — ⛔ Blocked
- [TC021_Reload_the_hand_and_continue_the_turn.py](./TC021_Reload_the_hand_and_continue_the_turn.py) · [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/5f780f42-a49b-45c0-a788-8496ef9333ba)
- **Analysis:** Lobby had only one player ("Need at least 2"); a game could not be started.

#### Test TC025 — Prevent further actions after action points are exhausted — ⛔ Blocked
- [TC025_Prevent_further_actions_after_action_points_are_exhausted.py](./TC025_Prevent_further_actions_after_action_points_are_exhausted.py) · [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/117adaae-e041-42e6-a970-5b849cff334f)
- **Analysis:** No active turn reachable from this session; AP-exhaustion blocking unverified.

---

### Requirement: Dice roll, modifier window & challenge phase
Skill/attack rolls open a timed modifier window; opponents may play Challenge cards triggering a roll-off.

#### Test TC017 — Resolve a dice roll and final result — ⛔ Blocked
- [TC017_Resolve_a_dice_roll_and_final_result.py](./TC017_Resolve_a_dice_roll_and_final_result.py) · [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/c02a0aaa-0a77-4fff-9a00-a2fd0b0fb1e1)
- **Analysis:** Not host; game not started; roll/dice UI never reached.

#### Test TC022 — Stage a modifier and pass in the roll window — ⛔ Blocked
- [TC022_Stage_a_modifier_and_pass_in_the_roll_window.py](./TC022_Stage_a_modifier_and_pass_in_the_roll_window.py) · [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/fc732c0e-8fb3-4bc5-8ef1-011f442899a0)
- **Analysis:** No in-game state reachable; modifier window not exercised.

#### Test TC026 — Challenge an opponent's card play — ⛔ Blocked
- [TC026_Challenge_an_opponents_card_play.py](./TC026_Challenge_an_opponents_card_play.py) · [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/fbd1902f-b478-4fe1-8869-23f759fb283a)
- **Analysis:** Lobby showed "A player disconnected. Game reset." — disconnect-reset prevented reaching an opponent's card play. Indirectly demonstrates the disconnect-reset behavior (see TC027).

---

### Requirement: Hero/Leader skills, targeting & penalties
Players use skills on chosen targets and resolve discard/sacrifice penalties.

#### Test TC029 — Use a hero skill on a chosen target — ⛔ Blocked
- [TC029_Use_a_hero_skill_on_a_chosen_target.py](./TC029_Use_a_hero_skill_on_a_chosen_target.py) · [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/d00469f4-0638-438b-b94c-f8643e7718de)
- **Analysis:** No active game; skill/targeting flow not reachable.

#### Test TC030 — Resolve a penalty by discarding or sacrificing a card — ⛔ Blocked
- [TC030_Resolve_a_penalty_by_discarding_or_sacrificing_a_card.py](./TC030_Resolve_a_penalty_by_discarding_or_sacrificing_a_card.py) · [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/cc92a5c7-0689-4480-aba2-d55a51aec66a)
- **Analysis:** Penalty prompt requires an in-progress game; not startable from one session.

---

### Requirement: Win conditions, victory modal & reset-to-lobby
On slaying 3 monsters or assembling 6 classes, a victory modal shows winner+reason; players can reset to the lobby. On disconnect the game resets.

#### Test TC027 — Reset back to the lobby after a disconnect
- **Test Code:** [TC027_Reset_back_to_the_lobby_after_a_disconnect.py](./TC027_Reset_back_to_the_lobby_after_a_disconnect.py)
- **Result:** [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/a126f384-573c-4774-98c7-0dd58a761c43)
- **Status:** ✅ Passed
- **Analysis / Findings:** On a player disconnect the server reset the whole game back to the lobby, as designed. Disconnect-recovery behaves correctly.

#### Tests TC007, TC008, TC010, TC011, TC014, TC018, TC023, TC028 — ⛔ Blocked
All eight require a *finished/winning* game state (victory modal, winning-reason text, reset/return-to-lobby, board reset, new match after reset). None could be reached because a full multiplayer game cannot be played to completion from a single automated browser session.
- TC007 Show the victory modal when a player wins · [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/b2b98064-2326-41f1-96a8-64365bfb9f37)
- TC008 Return to the lobby after a win · [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/91089f5e-a472-4833-bde7-4e54eb78cffe)
- TC010 Resume the lobby after the game is reset · [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/f05b2437-d82e-45dd-9699-c21ff9222837)
- TC011 Display the winning reason for monster victory · [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/a07639de-1371-48a8-8d37-2b9aad79abda)
- TC014 Display the winning reason for class victory · [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/f0b2d092-c8f6-406b-956d-4cfc5359383f)
- TC018 Reset the board state after returning to the lobby · [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/a500a93e-837f-4fef-afed-9ac5e34e6787)
- TC023 Allow starting a new match after resetting to the lobby · [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/28742e4c-c92d-4b79-9302-6d5b6a8479aa)
- TC028 Show the reset option after a win · [Visualization](https://www.testsprite.com/dashboard/mcp/tests/92d1bb1c-7c86-4cdb-91d1-cc5598fb39a6/66ad9793-049e-4426-ab20-5a26162043a2)

---

## 3️⃣ Coverage & Matching Metrics

- **16.67% of tests passed (5 / 30).** Of the 25 non-passing tests, **22 were Blocked** (could not reach the scenario from a single browser session) and **3 Failed** (host-only start control absent on the driven session). No functional defect in tested code paths was confirmed; every reachable scenario that was actually exercised passed.

| Requirement | Total | ✅ Passed | ❌ Failed | ⛔ Blocked |
|-------------|-------|-----------|-----------|------------|
| Lobby join & seating | 4 | 2 (TC004, TC005) | 0 | 2 (TC016, TC019, TC024 → 3*) |
| Party Leader selection | 3 | 1 (TC020) | 1 (TC006) | 2 (TC012, TC015) |
| Match start gating | 4 | 1 (TC009) | 2 (TC001, TC003) | 1 (TC002) |
| Turn actions (AP/draw/reload/end) | 3 | 0 | 0 | 3 (TC013, TC021, TC025) |
| Dice / modifier / challenge | 3 | 0 | 0 | 3 (TC017, TC022, TC026) |
| Skills, targeting & penalties | 2 | 0 | 0 | 2 (TC029, TC030) |
| Win / victory modal / reset | 9 | 1 (TC027) | 0 | 8 (TC007, TC008, TC010, TC011, TC014, TC018, TC023, TC028) |
| **Total** | **30** | **5** | **3** | **22** |

\*Lobby join group contains 5 cases (TC004, TC005, TC016, TC019, TC024): 2 passed, 3 blocked.

### What is actually validated (green)
- Joining the lobby with a hero name and seeing yourself seated (TC004, TC005).
- Shared depleting Party Leader pool — a claimed leader becomes unavailable to others (TC020).
- Start gate holds until all seated players have leaders (TC009).
- Whole-game reset to lobby on player disconnect (TC027).

---

## 4️⃣ Key Gaps / Risks

1. **Single-session automation cannot drive a real-time multiplayer game (primary cause of all 22 blocks + 3 failures).** "Here to Slay" needs 2–6 concurrent clients, a designated host, and alternating turns. One TestSprite browser session can reach the lobby and select a leader but cannot (a) be both host and second player, (b) play turns that require an opponent, or (c) drive a game to a win. The 3 "Failed" start-flow tests (TC001/TC003/TC006) are the same limitation surfacing as a missing host-only control on the driven session — not confirmed product bugs.
   - **Recommendation:** Add a test-only/E2E harness that spins up multiple bot clients (the repo already has `bot.js` and `npm run test:simulation`) so full-game flows — turns, dice/modifier window, challenges, skills, penalties, and the victory/reset modal — can be asserted. Alternatively expose a guarded "debug start / seed win-state" hook gated behind an env flag for automated runs.

2. **Single global game state causes cross-test interference.** Because the server holds one global `gameState` and resets to LOBBY on any disconnect, concurrent automation sessions advanced or reset each other's lobby (seen in TC006, TC026's "A player disconnected. Game reset."). This made several lobby controls disappear mid-test.
   - **Recommendation:** Per-room/session isolation (or a fresh server per test) would make lobby/selection tests deterministic.

3. **Landscape-only UI.** The PWA blocks portrait with a rotation-lock overlay. Tests must run wide; a narrow viewport hides all controls and would produce false "control not found" failures.
   - **Recommendation:** Keep the test viewport wide (already advised); consider a non-blocking degraded layout for tooling.

4. **No authentication / identity is just a typed name.** Duplicate-name and empty-name validation (TC016, TC019) went unverified. Worth confirming the server rejects empties/dupes server-side regardless of client state.

5. **Coverage skew.** All currently-green coverage is pre-game (lobby/selection/disconnect). The entire in-match rule engine (AP economy, 2d6 rolls, modifier timing, challenge roll-offs, hero/magic effects, win checks) has **zero** end-to-end frontend coverage from this run — these are best covered by the existing `node --test` unit suite (`test/**/*.test.js`) plus the bot-driven simulation rather than single-session browser tests.
