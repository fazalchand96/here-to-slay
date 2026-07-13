'use strict';

// Coverage for the four CONDITIONAL_PULL heroes that lacked dedicated specs:
//   Bear Claw   (card_017) — pull; if Hero, pull a second.
//   Fury Knuckle(card_019) — pull; if Challenge, pull a second.
//   Lucky Bucky (card_027) — pull; if Hero, MAY play it immediately.
//   Sly Pickings(card_054) — pull; if Item, MAY play it immediately.
//
// We make the random pull deterministic with debug_set_hand (setHand): the
// opponent's hand is stacked with exactly the card type that triggers the
// conditional branch.
const { test, expect } = require('../helpers/fixtures');
const {
    startGame, injectCard, setHand, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers,
} = require('../helpers/gameSetup');

const stateOf = (pg) => pg.evaluate(() => window.latestGameState && window.latestGameState.state);
const pendingType = (pg) => pg.evaluate(() => window.latestGameState && window.latestGameState.pendingAction && window.latestGameState.pendingAction.type);
const p2HandLen = (host) => host.evaluate(() => {
    const oid = Object.keys(window.latestGameState.players).find(id => id !== window.myId);
    return window.latestGameState.players[oid].hand.length;
});

// Drive the active player through play → challenge → roll → modifiers, then click
// the opponent chip to resolve the pull-targeting.
async function playPullHero(host, p2, cardId, p2Hand) {
    await injectCard(host, cardId);
    await setHand(p2, p2Hand);            // deterministic opponent hand
    await playCardFromHand(host, cardId);
    await passChallenge(p2);
    await rollDice(host);                 // forced 6+6 = 12 clears any requirement
    await passModifiers(host);
    await passOpponentModifiers(p2);

    await expect.poll(() => pendingType(host), { timeout: 10_000 }).toBe('CONDITIONAL_PULL');

    const chip = host.locator('#opponents-bar .opponent-chip.valid-target').first();
    await expect(chip).toBeVisible({ timeout: 8_000 });
    await chip.click({ force: true });
}

test('Bear Claw: pulled Hero triggers a SECOND pull (opponent loses both)', async ({ browser }) => {
    const errors = [];
    const { host, p2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Two Heroes — first pull is guaranteed a Hero → second pull fires → both leave.
    await playPullHero(host, p2, 'card_017', ['card_016', 'card_018']);

    await expect.poll(() => p2HandLen(host), { timeout: 10_000 }).toBe(0);
    await expect.poll(() => stateOf(host)).toBe('PLAYING');
    await expect.poll(() => pendingType(host)).toBeFalsy();
    expect(errors).toEqual([]);
});

test('Fury Knuckle: pulled Challenge triggers a SECOND pull (opponent loses both)', async ({ browser }) => {
    const errors = [];
    const { host, p2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Two Challenge cards — first pull is a Challenge → second pull fires.
    await playPullHero(host, p2, 'card_019', ['card_117', 'card_118']);

    await expect.poll(() => p2HandLen(host), { timeout: 10_000 }).toBe(0);
    await expect.poll(() => stateOf(host)).toBe('PLAYING');
    expect(errors).toEqual([]);
});

test('Lucky Bucky: pulled Hero offers immediate play', async ({ browser }) => {
    const errors = [];
    const { host, p2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await playPullHero(host, p2, 'card_027', ['card_016']); // one Hero to pull

    // The conditional fires → caster may play the pulled Hero immediately.
    await expect.poll(() => stateOf(host), { timeout: 10_000 }).toBe('WAITING_FOR_IMMEDIATE_PLAY');
    await expect.poll(() => host.evaluate(() =>
        window.latestGameState.pendingCard && window.latestGameState.pendingCard.type)).toBe('Hero Card');

    // Decline → the pulled Hero lands in hand and play resumes cleanly.
    await host.evaluate(() => window._socket.emit('resolve_immediate_play', { playNow: false }));
    await expect.poll(() => stateOf(host), { timeout: 8_000 }).toBe('PLAYING');
    expect(errors).toEqual([]);
});

test('Sly Pickings: pulled Item can be played immediately and equips instead of discarding', async ({ browser }) => {
    const errors = [];
    const { host, p2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await playPullHero(host, p2, 'card_054', ['card_064']); // one Item to pull (Bard Mask)

    await expect.poll(() => stateOf(host), { timeout: 10_000 }).toBe('WAITING_FOR_IMMEDIATE_PLAY');
    await expect.poll(() => host.evaluate(() =>
        window.latestGameState.pendingCard && window.latestGameState.pendingCard.type)).toBe('Item Card');

    await host.evaluate(() => window._socket.emit('resolve_immediate_play', { playNow: true }));
    await expect.poll(() => stateOf(host), { timeout: 8_000 }).toBe('WAITING_FOR_HAND_SELECTION');

    await host.evaluate(() => window._socket.emit('play_from_hand', {
        cardId: 'card_064', targetPlayerId: window.myId, targetHeroId: 'card_054'
    }));
    await passChallenge(p2);

    await expect.poll(() => host.evaluate(() => {
        const me = window.latestGameState.players[window.myId];
        return me.party.find(h => h.id === 'card_054')?.equippedItem?.id || null;
    }), { timeout: 8_000 }).toBe('card_064');
    await expect.poll(() => host.evaluate(() =>
        window.latestGameState.discardPile.some(c => c.id === 'card_064'))).toBe(false);
    expect(errors).toEqual([]);
});
