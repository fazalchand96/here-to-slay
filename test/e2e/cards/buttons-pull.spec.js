'use strict';

// Regression: Buttons (card_057, SKILL_BUTTONS — "look at a player's hand and pull
// a card") was in PLAYER_TARGETING_SKILLS *and* its executeSkill set up a second
// LOOK_AND_PULL targeting. You picked an opponent once, then had no clickable
// opponent for the pull → soft-lock. Now it resolves with a single player pick
// (and the opponent chip is selectable for LOOK_AND_PULL/PUMA_PULL).
const { test, expect } = require('../helpers/fixtures');
const {
    startGame, injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers,
} = require('../helpers/gameSetup');

const stateOf = (pg) => pg.evaluate(() => window.latestGameState && window.latestGameState.state);

test('Buttons: one opponent pick pulls a card (no soft-lock)', async ({ browser }) => {
    const errors = [];
    const { host, p2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    const hostBefore = await host.evaluate(() => window.latestGameState.players[window.myId].hand.length);
    const oppBefore = await host.evaluate(() => {
        const oid = Object.keys(window.latestGameState.players).find(id => id !== window.myId);
        return window.latestGameState.players[oid].hand.length;
    });

    await injectCard(host, 'card_057'); // Buttons
    await playCardFromHand(host, 'card_057');
    await passChallenge(p2);
    await rollDice(host);            // forced 12 → clears 6+
    await passModifiers(host);
    await passOpponentModifiers(p2);

    // Resolves into a SINGLE pull-targeting (no SKILL_TARGET_PLAYER double step).
    await expect.poll(async () => host.evaluate(() =>
        window.latestGameState && window.latestGameState.pendingAction && window.latestGameState.pendingAction.type))
        .toBe('LOOK_AND_PULL');

    // The opponent chip is a clickable target — click it to pull.
    const chip = host.locator('#opponents-bar .opponent-chip.valid-target').first();
    await expect(chip).toBeVisible({ timeout: 5_000 });
    await chip.click({ force: true });

    // Buttons was injected (+1), played (−1), then a card was pulled (+1) → net +1.
    await expect.poll(async () => host.evaluate(() =>
        window.latestGameState.players[window.myId].hand.length)).toBe(hostBefore + 1);
    // The opponent lost a card from their hand.
    await expect.poll(async () => host.evaluate(() => {
        const oid = Object.keys(window.latestGameState.players).find(id => id !== window.myId);
        return window.latestGameState.players[oid].hand.length;
    })).toBe(oppBefore - 1);
    // Play resumes cleanly — no lingering pending action.
    await expect.poll(async () => stateOf(host)).toBe('PLAYING');
    await expect.poll(async () => host.evaluate(() =>
        window.latestGameState && window.latestGameState.pendingAction)).toBe(null);
    expect(errors).toEqual([]);
});
