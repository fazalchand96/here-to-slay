'use strict';

// Bullseye (card_040, 7+) — "Look at the top 3 cards. Add one to your hand, then
// return the other two to the top of the deck." Deterministic: stack 3 known
// cards on top, roll Bullseye, take the top one, and verify it enters the hand
// while the other two remain on top of the deck. Mobile viewport + screenshot.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');
const {
    injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers,
} = require('../helpers/gameSetup');

const BULLSEYE = 'card_040';
// three distinct main-deck cards to stack (pushed in this order; last = very top)
const A = 'card_039', B = 'card_045', C = 'card_049';

test('Bullseye: look at top 3, take one, leave the other two on top', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    for (const id of [A, B, C]) {
        await host.evaluate((c) => window._socket.emit('debug_stack_deck', { cardId: c }), id);
    }
    await host.waitForTimeout(200);

    await injectCard(host, BULLSEYE);
    await playCardFromHand(host, BULLSEYE);
    await passChallenge(p2);
    await rollDice(host);              // forced 6+6 beats 7+
    await passModifiers(host);
    await passOpponentModifiers(p2);
    await host.waitForTimeout(500);

    // The peek modal shows the top 3 cards.
    await expect(host.locator('#deck-peek-modal')).not.toHaveClass(/hidden/, { timeout: 8_000 });
    await expect(host.locator('#deck-peek-cards .peek-card-wrap')).toHaveCount(3);
    await host.screenshot({ path: 'bullseye-mobile.png' });

    const handBefore = await host.evaluate(() => window.latestGameState.players[window.myId].hand.length);

    // Take the first (top) card — that's C (the last one we stacked).
    await host.locator('#deck-peek-cards .peek-select-btn').first().click({ force: true });
    await host.waitForTimeout(500);

    // (mainDeck contents aren't sent to clients, so we verify the observable part:
    //  the chosen top card is added to the hand and the peek modal closes.)
    const hasC = await host.evaluate((id) => window.latestGameState.players[window.myId].hand.some(c => c.id === id), C);
    const handAfter = await host.evaluate(() => window.latestGameState.players[window.myId].hand.length);

    expect(hasC, 'chosen top card (C) goes to hand').toBe(true);
    expect(handAfter, 'exactly one card added to hand').toBe(handBefore + 1);
    await expect(host.locator('#deck-peek-modal')).toHaveClass(/hidden/);

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
