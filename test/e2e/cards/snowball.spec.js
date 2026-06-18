'use strict';

// Regression: Snowball (card_060 — "DRAW a card. If it is a Magic card, you may
// play it immediately and DRAW a second card.") used to let you play ANY Magic
// card from hand. It must instead be conditional on the DRAWN card being Magic,
// offered as an immediate-play, and grant a second draw only if you play it.
const { test, expect } = require('../helpers/fixtures');
const {
    startGame, injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers,
} = require('../helpers/gameSetup');

const stateOf = (pg) => pg.evaluate(() => window.latestGameState && window.latestGameState.state);

test('Snowball: drawing a Magic offers immediate play and a second draw', async ({ browser }) => {
    const errors = [];
    const { host, p2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Force the top of the deck to be a Magic card (Enchanted Spell — no targeting).
    await host.evaluate(() => window._socket.emit('debug_stack_deck', { cardId: 'card_109' }));
    await host.waitForTimeout(300);

    const handBefore = await host.evaluate(() => window.latestGameState.players[window.myId].hand.length);

    await injectCard(host, 'card_060'); // Snowball
    await playCardFromHand(host, 'card_060');
    await passChallenge(p2);
    await rollDice(host);            // forced 12 → clears 6+
    await passModifiers(host);
    await passOpponentModifiers(p2);

    // The drawn Magic is offered as an immediate play (NOT a generic hand-selection).
    await expect.poll(async () => stateOf(host)).toBe('WAITING_FOR_IMMEDIATE_PLAY');
    await expect.poll(async () => host.evaluate(() =>
        window.latestGameState.pendingCard && window.latestGameState.pendingCard.id)).toBe('card_109');
    await expect(host.locator('#immediate-play-modal')).not.toHaveClass(/hidden/, { timeout: 5_000 });

    // Choose to play it → triggers the second draw and sends the Magic to challenge.
    await host.evaluate(() => window._socket.emit('resolve_immediate_play', { playNow: true }));
    await passChallenge(p2);

    // The Magic resolved (Enchanted Spell grants +2), and the second card was drawn:
    // injected Snowball (+1) − played Snowball (−1) + second draw (+1) = handBefore + 1.
    await expect.poll(async () => stateOf(host)).toBe('PLAYING');
    await expect.poll(async () => host.evaluate(() =>
        window.latestGameState.players[window.myId].magicRollBonus)).toBe(2);
    await expect.poll(async () => host.evaluate(() =>
        window.latestGameState.players[window.myId].hand.length)).toBe(handBefore + 1);
    expect(errors).toEqual([]);
});

test('Snowball: a non-Magic draw is simply kept (no play offer)', async ({ browser }) => {
    const errors = [];
    const { host, p2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await host.evaluate(() => window._socket.emit('debug_stack_deck', { cardId: 'card_016' })); // Bad Axe (Hero)
    await host.waitForTimeout(300);
    const handBefore = await host.evaluate(() => window.latestGameState.players[window.myId].hand.length);

    await injectCard(host, 'card_060');
    await playCardFromHand(host, 'card_060');
    await passChallenge(p2);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);

    // No immediate-play offer — the drawn Hero just goes to hand, turn continues.
    await expect.poll(async () => stateOf(host)).toBe('PLAYING');
    await expect.poll(async () => host.evaluate(() =>
        window.latestGameState && window.latestGameState.pendingAction)).toBe(null);
    // injected Snowball (+1) − played (−1) + drawn Hero kept (+1) = handBefore + 1.
    await expect.poll(async () => host.evaluate(() =>
        window.latestGameState.players[window.myId].hand.length)).toBe(handBefore + 1);
    expect(errors).toEqual([]);
});
