'use strict';

// Forced Exchange (card_113) — "Choose a Hero in another player's party. STEAL it
// and move a Hero from your party to theirs." Needs an opponent Hero to steal AND
// one of your own to give. If either is missing the exchange can't complete (it
// used to soft-lock on "WAITING FOR OPPONENT..."). Now the play is blocked.
// Here: host HAS a Hero to give, but the opponent has none -> must be blocked.
// Mobile viewport + screenshot.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');
const { injectCard } = require('../helpers/gameSetup');

const FORCED_EXCHANGE = 'card_113';
const OWN_HERO = 'card_030';

test('Forced Exchange: blocked when the opponent has no Hero to steal', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Host has a Hero to give (so the block is specifically about the opponent
    // having nothing to steal); the opponent (p2) has no Heroes.
    await host.evaluate((id) => window._socket.emit('debug_inject_to_party', { cardId: id }), OWN_HERO);
    await host.waitForTimeout(300);
    await injectCard(host, FORCED_EXCHANGE);
    const apBefore = await host.evaluate(() => window.latestGameState.players[window.myId].ap);

    // UI attempt -> client guard rejects with a notification.
    await host.locator(`#player-hand [data-id="${FORCED_EXCHANGE}"]`).first().click();
    await expect(host.locator('#inspector-modal')).toBeVisible({ timeout: 5_000 });
    await host.locator('#inspector-modal-actions button')
        .filter({ hasText: /Play|Cast|Use/i }).first().click();
    await host.waitForTimeout(300);
    await host.screenshot({ path: 'forced-exchange-blocked-mobile.png' });

    // Server enforcement: a raw socket play is also refused.
    await host.evaluate((id) => window._socket.emit('playCard', { cardId: id, isFree: false }), FORCED_EXCHANGE);
    await host.waitForTimeout(400);

    const state       = await host.evaluate(() => window.latestGameState.state);
    const apAfter     = await host.evaluate(() => window.latestGameState.players[window.myId].ap);
    const stillInHand = await host.evaluate((id) => window.latestGameState.players[window.myId].hand.some(c => c.id === id), FORCED_EXCHANGE);

    expect(state, 'play should be refused (no challenge phase)').toBe('PLAYING');
    expect(stillInHand, 'card stays in hand').toBe(true);
    expect(apAfter, 'no AP spent on a refused play').toBe(apBefore);

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
