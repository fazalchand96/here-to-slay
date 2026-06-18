'use strict';

// Slippery Paws (card_053) — "Pull 2 cards from another player's hand, then
// DISCARD one of those cards." Verifies the fixed behavior on a mobile viewport:
//   - 2 cards are pulled from the target into the roller's hand
//   - the roller must discard ONE OF THOSE TWO (modal shows exactly the 2 pulled)
//   - net result: roller +1, target -2, discard pile +1
// (The old bug let the roller discard ANY hand card, not one of the pulled two.)
// Also captures a mobile screenshot of the "discard one" modal.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');
const {
    injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers,
} = require('../helpers/gameSetup');

const SLIPPERY_PAWS = 'card_053';

test('Slippery Paws: pull 2, discard one of those two', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await injectCard(host, SLIPPERY_PAWS);
    await playCardFromHand(host, SLIPPERY_PAWS);
    await passChallenge(p2);
    await rollDice(host);              // forced 6+6 — beats the 6+ requirement
    await passModifiers(host);
    await passOpponentModifiers(p2);
    await host.waitForTimeout(400);

    const hostHandBefore = await host.evaluate(() => window.latestGameState.players[window.myId].hand.length);
    const p2HandBefore   = await p2.evaluate(() => window.latestGameState.players[window.myId].hand.length);
    const discardBefore  = await host.evaluate(() => window.latestGameState.discardPile.length);

    // Host targets the opponent (player-target skill).
    await host.evaluate(() => {
        const st = window.latestGameState;
        const oppId = st.playerOrder.find(id => id !== window.myId);
        window._socket.emit('submit_skill_target', { targetPlayerId: oppId });
    });

    // The "discard one" modal shows exactly the 2 pulled cards.
    await expect(host.locator('#deck-peek-modal')).not.toHaveClass(/hidden/, { timeout: 8_000 });
    const discardBtns = host.locator('#deck-peek-cards button', { hasText: /discard/i });
    await expect(discardBtns).toHaveCount(2, { timeout: 5_000 });

    // Screenshot the choose-to-discard UI.
    await host.screenshot({ path: 'slippery-paws-mobile.png' });

    // After pulling 2 but before discarding: roller +2, target -2.
    const hostHandPulled = await host.evaluate(() => window.latestGameState.players[window.myId].hand.length);
    const p2HandPulled   = await p2.evaluate(() => window.latestGameState.players[window.myId].hand.length);
    expect(hostHandPulled).toBe(hostHandBefore + 2);
    expect(p2HandPulled).toBe(p2HandBefore - 2);

    // Discard one of the two pulled (cards pulse, so force the click).
    await discardBtns.first().click({ force: true });
    await host.waitForTimeout(400);

    const hostHandAfter = await host.evaluate(() => window.latestGameState.players[window.myId].hand.length);
    const discardAfter  = await host.evaluate(() => window.latestGameState.discardPile.length);

    // Net: roller +1 (pulled 2, discarded 1); exactly one card hit the discard pile.
    expect(hostHandAfter, 'roller nets +1 card').toBe(hostHandBefore + 1);
    expect(discardAfter, 'exactly one pulled card was discarded').toBe(discardBefore + 1);

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
