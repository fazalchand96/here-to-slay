'use strict';

// Destructive Spell (card_107) — "DISCARD a card, then DESTROY a Hero card."
// A "THEN" card: if there's no Hero to destroy, the whole card is unplayable
// (otherwise you'd waste the discard, and the empty-hand path could soft-lock on
// the destroy step). Mobile viewport + screenshot.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');
const { injectCard } = require('../helpers/gameSetup');

const DESTRUCTIVE_SPELL = 'card_107';

test('Destructive Spell: blocked when there is no Hero to destroy', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Opponent has no heroes (fresh game) -> nothing to destroy.
    await injectCard(host, DESTRUCTIVE_SPELL);
    const apBefore = await host.evaluate(() => window.latestGameState.players[window.myId].ap);

    // UI attempt -> client guard rejects.
    await host.locator(`#player-hand [data-id="${DESTRUCTIVE_SPELL}"]`).first().click();
    await expect(host.locator('#inspector-modal')).toBeVisible({ timeout: 5_000 });
    await host.locator('#inspector-modal-actions button')
        .filter({ hasText: /Play|Cast|Use/i }).first().click();
    await host.waitForTimeout(300);
    await host.screenshot({ path: 'destructive-spell-blocked-mobile.png' });

    // Server enforcement: raw socket play is also refused.
    await host.evaluate((id) => window._socket.emit('playCard', { cardId: id, isFree: false }), DESTRUCTIVE_SPELL);
    await host.waitForTimeout(400);

    const state       = await host.evaluate(() => window.latestGameState.state);
    const apAfter     = await host.evaluate(() => window.latestGameState.players[window.myId].ap);
    const stillInHand = await host.evaluate((id) => window.latestGameState.players[window.myId].hand.some(c => c.id === id), DESTRUCTIVE_SPELL);

    expect(state, 'play should be refused (no challenge phase)').toBe('PLAYING');
    expect(stillInHand, 'card stays in hand').toBe(true);
    expect(apAfter, 'no AP spent on a refused play').toBe(apBefore);

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
