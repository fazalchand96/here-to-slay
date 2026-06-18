'use strict';

const { test, expect } = require('../helpers/fixtures');
const {
    startGame, injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers,
} = require('../helpers/gameSetup');

// These skills target a PLAYER (not a specific hero). After playing and rolling,
// the opponent's avatar/chip in #opponents-bar becomes a .valid-target.
const PLAYER_TARGET_CARDS = [
    { name: 'Heavy Bear',     id: 'card_020' }, // force discard 2
    { name: 'Sharp Fox',      id: 'card_045' }, // look at hand
    { name: 'Silent Shadow',  id: 'card_052' }, // look/pull
    { name: 'Slippery Paws',  id: 'card_053' }, // pull 2
    { name: 'Hopper',         id: 'card_059' }, // force sacrifice
    { name: 'Plundering Puma', id: 'card_050' }, // pull 2 cards
    { name: 'Dodgy Dealer',   id: 'card_024' }, // trade hands
];

for (const { name, id } of PLAYER_TARGET_CARDS) {
test(`${name}: player-target chip highlights after skill roll`, async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await injectCard(host, id);
    await playCardFromHand(host, id);
    await passChallenge(p2);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);

    await host.waitForTimeout(400);

    // Either a .valid-target chip appeared in #opponents-bar, OR a target-banner appeared,
    // OR the effect resolved immediately (e.g., heavy bear needs a target chosen via pending action).
    const validTargetVisible = await host.locator('.valid-target').count();
    const bannerVisible = await host.locator('#target-banner').evaluate(
        el => !el.classList.contains('hidden'),
    ).catch(() => false);

    expect(validTargetVisible > 0 || bannerVisible, `${id}: expected targeting UI`).toBe(true);
    expect(errors).toEqual([]);

    await ctx1.close(); await ctx2.close();
});
}
