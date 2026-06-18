'use strict';

// Entangling Trap (card_111) — block the play entirely when its payoff (the
// steal) is impossible: no opponent has a stealable Hero. The card must NOT be
// playable (no AP spent, card stays in hand, no challenge phase). Mobile + shot.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');
const { injectCard } = require('../helpers/gameSetup');

const ENTANGLING_TRAP = 'card_111';

test('Entangling Trap: cannot be played when there is no Hero to steal', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // p2 has no heroes (just a leader) — nothing to steal.
    await injectCard(host, ENTANGLING_TRAP);
    const apBefore = await host.evaluate(() => window.latestGameState.players[window.myId].ap);

    // UI attempt: tap the card, hit Play/Cast — the client guard rejects it.
    await host.locator(`#player-hand [data-id="${ENTANGLING_TRAP}"]`).first().click();
    await expect(host.locator('#inspector-modal')).toBeVisible({ timeout: 5_000 });
    await host.locator('#inspector-modal-actions button')
        .filter({ hasText: /Play|Cast|Use/i }).first().click();
    await host.waitForTimeout(300);
    await host.screenshot({ path: 'entangling-trap-blocked-mobile.png' });

    // Server-side enforcement: a raw socket play is also refused.
    await host.evaluate((id) => window._socket.emit('playCard', { cardId: id, isFree: false }), ENTANGLING_TRAP);
    await host.waitForTimeout(400);

    const state      = await host.evaluate(() => window.latestGameState.state);
    const apAfter    = await host.evaluate(() => window.latestGameState.players[window.myId].ap);
    const stillInHand = await host.evaluate((id) => window.latestGameState.players[window.myId].hand.some(c => c.id === id), ENTANGLING_TRAP);

    expect(state, 'play should be refused (no challenge phase)').toBe('PLAYING');
    expect(stillInHand, 'card stays in hand').toBe(true);
    expect(apAfter, 'no AP spent on a refused play').toBe(apBefore);

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
