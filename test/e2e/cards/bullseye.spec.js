'use strict';

// Regression: Bullseye (card_040 — "Look at the top 3 cards, add 1 to your hand")
// emits its peek modal exactly as the skill resolves to PLAYING. closeAllModals()
// (which runs on every PLAYING render) hid every .overlay not in its allowlist, so
// the peek modal flashed up with the 3 cards then immediately closed — "I don't
// see the cards." The peek modal is now kept open until the player picks.
const { test, expect } = require('../helpers/fixtures');
const {
    startGame, injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers,
} = require('../helpers/gameSetup');

test('Bullseye: the top-3 peek modal stays visible and a card can be taken', async ({ browser }) => {
    const errors = [];
    const { host, p2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    const before = await host.locator('#player-hand .card').count();

    await injectCard(host, 'card_040'); // Bullseye
    await playCardFromHand(host, 'card_040');
    await passChallenge(p2);
    await rollDice(host);            // forced 12 → clears the 7+ requirement
    await passModifiers(host);
    await passOpponentModifiers(p2);

    // The peek modal must be VISIBLE (not flashed-then-hidden) and hold 3 cards.
    const peek = host.locator('#deck-peek-modal');
    await expect(peek).not.toHaveClass(/hidden/, { timeout: 8_000 });
    await expect.poll(async () => host.evaluate(() =>
        document.getElementById('deck-peek-cards').children.length)).toBe(3);

    // Taking one closes the modal and adds it to the hand. Invoke the button's
    // own handler in-page (avoids a Playwright click/teardown race on the modal).
    await host.evaluate(() => document.querySelector('#deck-peek-cards button').click());
    await expect(peek).toHaveClass(/hidden/, { timeout: 5_000 });
    await expect.poll(async () => host.locator('#player-hand .card').count()).toBe(before + 1);
    expect(errors).toEqual([]);
});
