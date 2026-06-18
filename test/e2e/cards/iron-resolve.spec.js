'use strict';

// Regression: Iron Resolve (card_035 — "Cards you play cannot be challenged for
// the rest of your turn") set player.cannotBeChallenged in the skill engine, but
// server.js never read it — opponents could still challenge. Now the challenge
// phase is skipped for that player's cards for the rest of the turn.
const { test, expect } = require('../helpers/fixtures');
const {
    startGame, injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers,
} = require('../helpers/gameSetup');

const stateOf = (pg) => pg.evaluate(() => window.latestGameState && window.latestGameState.state);

test('Iron Resolve: cards played afterwards skip the challenge phase', async ({ browser }) => {
    const errors = [];
    const { host, p2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Use Iron Resolve (this play itself CAN be challenged — passed normally).
    await injectCard(host, 'card_035');
    await playCardFromHand(host, 'card_035');
    await passChallenge(p2);
    await rollDice(host);            // forced 12 → clears the 8+ requirement
    await passModifiers(host);
    await passOpponentModifiers(p2);

    // The protection flag is now set on the caster.
    await expect.poll(async () => host.evaluate(() =>
        window.latestGameState.players[window.myId].cannotBeChallenged)).toBe(true);

    // Now play another card — it must resolve WITHOUT entering the challenge phase.
    await injectCard(host, 'card_109'); // Enchanted Spell (Magic, no targeting)
    await playCardFromHand(host, 'card_109');

    // It resolves straight to PLAYING; the game never enters WAITING_FOR_CHALLENGES.
    await expect.poll(async () => stateOf(host)).toBe('PLAYING');

    // The opponent is never prompted to challenge.
    await p2.waitForTimeout(500);
    const challVisible = await p2.locator('#challenge-modal').evaluate(
        el => !el.classList.contains('hidden')).catch(() => false);
    expect(challVisible).toBe(false);

    // The magic actually applied (Enchanted Spell grants +2 magicRollBonus).
    await expect.poll(async () => host.evaluate(() =>
        window.latestGameState.players[window.myId].magicRollBonus)).toBe(2);
    expect(errors).toEqual([]);
});
