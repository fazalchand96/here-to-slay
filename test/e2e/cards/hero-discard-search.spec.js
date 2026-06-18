'use strict';

const { test, expect } = require('../helpers/fixtures');
const {
    startGame, injectCard, addToDiscard, playCardFromHand,
    passChallenge, rollDice, passModifiers, passOpponentModifiers,
} = require('../helpers/gameSetup');

// Cards that search the discard pile and retrieve a card.
// card_030 (Peanut / DRAW_2_CARDS) is planted in the discard pile as the retrieval target.
const DISCARD_SEARCH_CARDS = [
    { name: 'Guiding Light',  id: 'card_033', allowedTypes: 'Hero Card' },
    { name: 'Radiant Horn',   id: 'card_037', allowedTypes: 'Modifier Card' },
    { name: 'Lookie Rookie',  id: 'card_042', allowedTypes: 'Item Card' },
    { name: 'Bun Bun',        id: 'card_056', allowedTypes: 'Magic Card' },
];

// Plant a card of the right type in the discard pile for each skill
const PLANT_CARDS = {
    'card_033': 'card_030', // Hero (Peanut)
    'card_037': 'card_079', // Modifier +1/-3
    'card_042': 'card_064', // Bard Mask (Item)
    'card_056': 'card_104', // Call to the Fallen (Magic)
};

for (const { name, id } of DISCARD_SEARCH_CARDS) {
test(`${name}: discard-search modal opens and card retrieved`, async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Plant the target card in the discard pile
    const plantId = PLANT_CARDS[id];
    await addToDiscard(host, plantId);

    const handBefore = await host.locator('#player-hand .card').count();

    await injectCard(host, id);
    await playCardFromHand(host, id);
    await passChallenge(p2);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);

    // Discard search modal should open
    await expect(host.locator('#discard-search-modal')).toBeVisible({ timeout: 8_000 });

    // Click the planted card's Select button. The cards have a pulsing glow
    // animation, so force the click rather than waiting for "stable".
    await host.locator(`#discard-search-modal [data-id="${plantId}"] button`).click({ force: true });

    await host.waitForTimeout(500);

    // Hand grew by 1 (retrieved the planted card)
    const handAfter = await host.locator('#player-hand .card').count();
    expect(handAfter, `${id}: expected hand to grow after retrieval`).toBeGreaterThan(handBefore);
    expect(errors).toEqual([]);

    await ctx1.close(); await ctx2.close();
});
}
