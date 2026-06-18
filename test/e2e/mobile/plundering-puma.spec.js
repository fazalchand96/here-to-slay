'use strict';

// Plundering Puma (card_050, 6+) — "Pull 2 cards from another player's hand. That
// player may DRAW a card." Verifies: roller pulls 2 (roller +2) and the target
// loses 2 but draws 1 (target net -1). Mobile viewport + screenshot.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');
const {
    injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers,
} = require('../helpers/gameSetup');

const PUMA = 'card_050';

test('Plundering Puma: pull 2 from a player, that player draws 1', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await injectCard(host, PUMA);
    await playCardFromHand(host, PUMA);
    await passChallenge(p2);
    await rollDice(host);              // forced 6+6 beats 6+
    await passModifiers(host);
    await passOpponentModifiers(p2);
    await host.waitForTimeout(400);

    const hostBefore = await host.evaluate(() => window.latestGameState.players[window.myId].hand.length);
    const p2Before   = await p2.evaluate(() => window.latestGameState.players[window.myId].hand.length);

    // It's a player-target pull (PUMA_PULL) — banner should prompt to pick a player.
    expect(await host.evaluate(() => window.latestGameState.pendingAction.type)).toBe('PUMA_PULL');
    await host.screenshot({ path: 'plundering-puma-mobile.png' });

    // Target the opponent.
    await host.evaluate(() => {
        const st = window.latestGameState;
        const oppId = st.playerOrder.find(id => id !== window.myId);
        window._socket.emit('target_selected', oppId);
    });
    await host.waitForTimeout(500);

    const hostAfter = await host.evaluate(() => window.latestGameState.players[window.myId].hand.length);
    const p2After   = await p2.evaluate(() => window.latestGameState.players[window.myId].hand.length);

    expect(hostAfter, 'roller pulls 2 cards').toBe(hostBefore + 2);
    expect(p2After, 'target loses 2 then draws 1 = net -1').toBe(p2Before - 1);
    expect(await host.evaluate(() => window.latestGameState.pendingAction)).toBeNull();

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
