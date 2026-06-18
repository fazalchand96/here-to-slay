'use strict';

// Regression: Bun Bun (card_056 — "Search the discard pile for a Magic card")
// opens the discard-search modal after a successful roll. When the pile has cards
// but no Magic card, the Cancel button only did client-side cleanup — the server
// stayed in WAITING_FOR_SKILL_TARGET, soft-locking the turn (end_turn is blocked
// while a pendingAction exists). Cancel must now abort server-side too.
const { test, expect } = require('../helpers/fixtures');
const {
    startGame, injectCard, addToDiscard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers,
} = require('../helpers/gameSetup');

const stateOf = (pg) => pg.evaluate(() => window.latestGameState && window.latestGameState.state);

test('Bun Bun: cancelling the discard search (no Magic card) returns to PLAYING', async ({ browser }) => {
    const errors = [];
    const { host, p2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Put a NON-Magic card in the discard pile so the search opens but finds nothing
    // (the deferred search only triggers when the pile is non-empty).
    await addToDiscard(host, 'card_064'); // Bard Mask (Item)

    await injectCard(host, 'card_056'); // Bun Bun
    await playCardFromHand(host, 'card_056');
    await passChallenge(p2);
    await rollDice(host);           // forced 12 → clears the 5+ requirement
    await passModifiers(host);
    await passOpponentModifiers(p2);

    // Server is waiting for the discard pick; the search modal is open with no match.
    await expect.poll(async () => stateOf(host)).toBe('WAITING_FOR_SKILL_TARGET');
    await expect(host.locator('#discard-search-modal')).not.toHaveClass(/hidden/, { timeout: 5_000 });

    // Cancel must return to PLAYING with no lingering pending action.
    await host.locator('#discard-search-modal button').filter({ hasText: /Cancel/i }).first().click();

    await expect.poll(async () => stateOf(host)).toBe('PLAYING');
    await expect.poll(async () => host.evaluate(() =>
        window.latestGameState && window.latestGameState.pendingAction)).toBe(null);

    // And the turn is genuinely unblocked: the player can end their turn.
    await host.evaluate(() => window._socket.emit('end_turn'));
    await expect.poll(async () => host.evaluate(() =>
        window.latestGameState && window.latestGameState.activePlayerSocketId !== window.myId)).toBe(true);
    expect(errors).toEqual([]);
});
