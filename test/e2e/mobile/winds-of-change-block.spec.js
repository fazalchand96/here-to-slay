'use strict';

// Winds of Change (card_115) — "Return an Item equipped to a Hero to your hand,
// then DRAW a card." If NO Hero anywhere has an equipped Item, there's nothing to
// return and it used to soft-lock on the item-select step. Now the play is blocked.
// Mobile viewport + screenshot.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');
const { injectCard } = require('../helpers/gameSetup');

const WINDS_OF_CHANGE = 'card_115';

test('Winds of Change: blocked when no equipped Items exist', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // No equipped items anywhere (fresh game).
    await injectCard(host, WINDS_OF_CHANGE);
    const apBefore = await host.evaluate(() => window.latestGameState.players[window.myId].ap);

    // UI attempt -> client guard rejects with a notification.
    await host.locator(`#player-hand [data-id="${WINDS_OF_CHANGE}"]`).first().click();
    await expect(host.locator('#inspector-modal')).toBeVisible({ timeout: 5_000 });
    await host.locator('#inspector-modal-actions button')
        .filter({ hasText: /Play|Cast|Use/i }).first().click();
    await host.waitForTimeout(300);
    await host.screenshot({ path: 'winds-of-change-blocked-mobile.png' });

    // Server enforcement: a raw socket play is also refused.
    await host.evaluate((id) => window._socket.emit('playCard', { cardId: id, isFree: false }), WINDS_OF_CHANGE);
    await host.waitForTimeout(400);

    const state       = await host.evaluate(() => window.latestGameState.state);
    const apAfter     = await host.evaluate(() => window.latestGameState.players[window.myId].ap);
    const stillInHand = await host.evaluate((id) => window.latestGameState.players[window.myId].hand.some(c => c.id === id), WINDS_OF_CHANGE);

    expect(state, 'play should be refused (no challenge phase)').toBe('PLAYING');
    expect(stillInHand, 'card stays in hand').toBe(true);
    expect(apAfter, 'no AP spent on a refused play').toBe(apBefore);

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
