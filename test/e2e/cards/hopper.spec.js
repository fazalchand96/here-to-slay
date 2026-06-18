'use strict';

// Regression: Hopper (card_059 — "Choose a player. That player must SACRIFICE a
// Hero card.") used to auto-discard the target's LAST hero. Per the rules the
// TARGET chooses which Hero to give up, via WAITING_FOR_SACRIFICE. That state's
// targeting UI was also never enabled for the chosen player (myTargetMode stayed
// false), so this verifies the target can actually pick.
const { test, expect } = require('../helpers/fixtures');
const {
    startGame, injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers,
} = require('../helpers/gameSetup');

const stateOf = (pg) => pg.evaluate(() => window.latestGameState && window.latestGameState.state);

test('Hopper: the TARGET chooses which Hero to sacrifice', async ({ browser }) => {
    const errors = [];
    const { host, p2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));
    p2.on('pageerror', e => errors.push(e.message));

    // Give p2 two heroes so "which one" is a real choice (Bad Axe + Tipsy Tootie).
    await p2.evaluate(() => window._socket.emit('debug_inject_to_party', { cardId: 'card_016' }));
    await p2.evaluate(() => window._socket.emit('debug_inject_to_party', { cardId: 'card_031' }));
    await p2.waitForTimeout(300);

    await injectCard(host, 'card_059'); // Hopper
    await playCardFromHand(host, 'card_059');
    await passChallenge(p2);
    await rollDice(host);            // forced 12 → clears the 7+ requirement
    await passModifiers(host);
    await passOpponentModifiers(p2);

    // The roll resolves into a single player-target pick for the caster.
    await expect.poll(async () => host.evaluate(() =>
        window.latestGameState && window.latestGameState.pendingAction && window.latestGameState.pendingAction.type))
        .toBe('SKILL_TARGET_PLAYER');

    const targetId = await host.evaluate(() =>
        Object.keys(window.latestGameState.players).find(id => id !== window.myId));
    await host.evaluate((id) => window._socket.emit('submit_skill_target', { targetPlayerId: id }), targetId);

    // p2 must now be the one choosing — nothing has been removed yet.
    await expect.poll(async () => stateOf(p2)).toBe('WAITING_FOR_SACRIFICE');
    await expect.poll(async () => p2.evaluate(() =>
        window.latestGameState.players[window.myId].party.length)).toBe(2);

    // The targeting UI must be enabled for p2: their hero shows as a valid target.
    const heroToKeep = 'card_016';
    const heroToSacrifice = 'card_031';
    const sacTarget = p2.locator(`#player-party [data-id="${heroToSacrifice}"]`).first();
    await expect(sacTarget).toHaveClass(/valid-target/, { timeout: 5_000 });

    // p2 taps the hero they choose to sacrifice, then confirms via SELECT TARGET.
    await sacTarget.click({ force: true });
    await p2.locator('#inspector-modal-actions button').filter({ hasText: /SELECT TARGET/i }).first().click();

    // The CHOSEN hero is gone; the other one stays. Flow resumes to PLAYING.
    await expect.poll(async () => stateOf(p2)).toBe('PLAYING');
    const party = await p2.evaluate(() => window.latestGameState.players[window.myId].party.map(h => h.id));
    expect(party).toContain(heroToKeep);
    expect(party).not.toContain(heroToSacrifice);
    expect(errors).toEqual([]);
});
