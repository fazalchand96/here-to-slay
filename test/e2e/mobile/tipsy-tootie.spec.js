'use strict';

// Tipsy Tootie (card_031, 6+) — "STEAL a Hero from a player and move Tipsy Tootie
// into that player's party." Reproduction for: after rolling, selecting the
// opponent's hero did nothing. Uses the standard target-selection helper.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');
const {
    injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers, clickFirstValidTarget,
} = require('../helpers/gameSetup');

const TIPSY = 'card_031';
const VICTIM_HERO = 'card_030';

test('Tipsy Tootie: selecting an opponent hero resolves the swap', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await p2.evaluate((id) => window._socket.emit('debug_inject_to_party', { cardId: id }), VICTIM_HERO);
    await p2.waitForTimeout(300);

    await injectCard(host, TIPSY);
    await playCardFromHand(host, TIPSY);
    await passChallenge(p2);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);
    await host.waitForTimeout(400);

    // Should be waiting for the host to pick an opponent hero.
    const state = await host.evaluate(() => window.latestGameState.state);
    expect(state).toBe('WAITING_FOR_SKILL_TARGET');

    await clickFirstValidTarget(host);
    await host.waitForTimeout(600);

    // The swap resolved: host gained the stolen hero, p2 received Tipsy Tootie.
    const hostHasStolen = await host.locator('#player-party [data-id="card_030"]').count();
    const paAfter = await host.evaluate(() => window.latestGameState.pendingAction);
    expect(hostHasStolen, 'host should gain the stolen hero').toBeGreaterThan(0);
    expect(paAfter, 'pending action should clear').toBeNull();

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
