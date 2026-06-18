'use strict';

// Regression: Heavy Bear (card_020 — "Choose a player. That player must DISCARD
// 2 cards.") used to double-target. It is in PLAYER_TARGETING_SKILLS, so the roll
// resolves into a SKILL_TARGET_PLAYER pick; the executeSkill case then IGNORED
// that pick and opened a SECOND FORCE_DISCARD_TARGET selection, soft-locking the
// flow. After the fix the chosen target is consumed directly into a single
// discard penalty.
const { test, expect } = require('../helpers/fixtures');
const {
    startGame, injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers,
} = require('../helpers/gameSetup');

const stateOf = (pg) => pg.evaluate(() => window.latestGameState && window.latestGameState.state);

test('Heavy Bear: one target pick → opponent discards 2, then play resumes (no soft-lock)', async ({ browser }) => {
    const errors = [];
    const { host, p2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await injectCard(host, 'card_020'); // Heavy Bear
    await playCardFromHand(host, 'card_020');
    await passChallenge(p2);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);

    // The roll resolved into a SINGLE player-target pick for the caster.
    await expect.poll(async () => host.evaluate(() =>
        window.latestGameState && window.latestGameState.pendingAction && window.latestGameState.pendingAction.type))
        .toBe('SKILL_TARGET_PLAYER');

    // Caster chooses the opponent (the only other player).
    const targetId = await host.evaluate(() =>
        Object.keys(window.latestGameState.players).find(id => id !== window.myId));
    await host.evaluate((id) => window._socket.emit('submit_skill_target', { targetPlayerId: id }), targetId);

    // The opponent is now forced to discard exactly 2 — NOT a second target pick
    // on the caster's side.
    await expect.poll(async () => stateOf(p2)).toBe('WAITING_FOR_DISCARD_PENALTY');
    const amount = await p2.evaluate(() => window.latestGameState.pendingAction.amount);
    expect(amount).toBe(2);

    // The discard penalty belongs to the opponent, and the caster is NOT stuck in
    // another targeting state.
    await expect.poll(async () => p2.evaluate(() =>
        window.latestGameState.pendingAction.playerToChoose === window.myId)).toBe(true);

    // Opponent discards the required cards.
    await p2.evaluate(() => {
        const me = window.latestGameState.players[window.myId];
        const ids = me.hand.slice(0, 2).map(c => c.id);
        window._socket.emit('submit_penalty_discard', { cardIds: ids });
    });

    // Flow resumes to PLAYING for both players — no lingering pending action.
    await expect.poll(async () => stateOf(p2)).toBe('PLAYING');
    await expect.poll(async () => host.evaluate(() =>
        window.latestGameState && window.latestGameState.pendingAction)).toBe(null);
    expect(errors).toEqual([]);
});
