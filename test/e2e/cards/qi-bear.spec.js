'use strict';

// Regression: Qi Bear (card_022 — "DISCARD up to 3 cards. For each card discarded,
// DESTROY a Hero card."). The discard is the COST of destroying, so it must be
// capped to the destroyable opponent heroes and skipped entirely when there are
// none (otherwise you'd discard cards for nothing / soft-lock). It must also
// destroy one Hero per discarded card.
const { test, expect } = require('../helpers/fixtures');
const {
    startGame, injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers,
} = require('../helpers/gameSetup');

const stateOf = (pg) => pg.evaluate(() => window.latestGameState && window.latestGameState.state);

async function castQiBear(host, p2) {
    await injectCard(host, 'card_022');
    await playCardFromHand(host, 'card_022');
    await passChallenge(p2);
    await rollDice(host);            // forced 12 → clears 10+
    await passModifiers(host);
    await passOpponentModifiers(p2);
}

test('Qi Bear: with NO opponent heroes it does not prompt a discard (cards kept)', async ({ browser }) => {
    const errors = [];
    const { host, p2 } = await startGame(browser); // p2 has an empty party
    host.on('pageerror', e => errors.push(e.message));

    const handBefore = await host.evaluate(() => window.latestGameState.players[window.myId].hand.length);

    await castQiBear(host, p2);

    // The skill fizzles straight back to PLAYING — no discard, no pending action.
    await expect.poll(async () => stateOf(host)).toBe('PLAYING');
    await expect.poll(async () => host.evaluate(() =>
        window.latestGameState && window.latestGameState.pendingAction)).toBe(null);
    // Qi Bear was played from hand (net 0) and NO cards were discarded.
    await expect.poll(async () => host.evaluate(() =>
        window.latestGameState.players[window.myId].hand.length)).toBe(handBefore);
    expect(errors).toEqual([]);
});

test('Qi Bear: destroys one opponent hero per discarded card (capped to available)', async ({ browser }) => {
    const errors = [];
    const { host, p2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Opponent gets two heroes; the discard cap should become 2.
    await p2.evaluate(() => window._socket.emit('debug_inject_to_party', { cardId: 'card_016' }));
    await p2.evaluate(() => window._socket.emit('debug_inject_to_party', { cardId: 'card_031' }));
    await p2.waitForTimeout(300);

    await castQiBear(host, p2);

    // Discard cap is min(3, hand, 2 opponent heroes) = 2.
    await expect.poll(async () => stateOf(host)).toBe('WAITING_FOR_VARIABLE_DISCARD');
    await expect.poll(async () => host.evaluate(() =>
        window.latestGameState.pendingAction.maxAmount)).toBe(2);

    // Discard the max allowed.
    await host.evaluate(() => {
        const me = window.latestGameState.players[window.myId];
        const max = window.latestGameState.pendingAction.maxAmount;
        const ids = me.hand.slice(0, max).map(c => c.id);
        window._socket.emit('submit_penalty_discard', { cardIds: ids });
    });

    // DESTROY for 2 opponent heroes.
    await expect.poll(async () => host.evaluate(() =>
        window.latestGameState.pendingAction && window.latestGameState.pendingAction.type)).toBe('DESTROY');
    await expect.poll(async () => host.evaluate(() =>
        window.latestGameState.pendingAction.amount)).toBe(2);

    await host.evaluate(() => window._socket.emit('target_selected', 'card_016'));
    await expect.poll(async () => host.evaluate(() => {
        const oid = Object.keys(window.latestGameState.players).find(id => id !== window.myId);
        return window.latestGameState.players[oid].party.length;
    })).toBe(1);

    await host.evaluate(() => window._socket.emit('target_selected', 'card_031'));
    await expect.poll(async () => host.evaluate(() => {
        const oid = Object.keys(window.latestGameState.players).find(id => id !== window.myId);
        return window.latestGameState.players[oid].party.length;
    })).toBe(0);
    await expect.poll(async () => stateOf(host)).toBe('PLAYING');
    await expect.poll(async () => host.evaluate(() =>
        window.latestGameState && window.latestGameState.pendingAction)).toBe(null);
    expect(errors).toEqual([]);
});
