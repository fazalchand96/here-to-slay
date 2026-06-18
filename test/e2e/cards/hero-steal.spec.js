'use strict';

const { test, expect } = require('../helpers/fixtures');
const {
    startGame, injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers, clickFirstValidTarget, p2DoAction,
} = require('../helpers/gameSetup');

// playCard is turn-gated, so inject the hero straight into p2's party via the
// debug handler (p2 cannot play it the normal way during the host's turn).
async function setupP2Hero(host, p2) {
    await p2.evaluate(() => window._socket.emit('debug_inject_to_party', { cardId: 'card_030' }));
    await p2.waitForTimeout(400);
}

const STEAL_CARDS = [
    { name: 'Kit Napper',   id: 'card_048' },
    { name: 'Tipsy Tootie', id: 'card_031' },
    { name: 'Wiggles',      id: 'card_063' },
];

for (const { name, id } of STEAL_CARDS) {
test(`${name}: opponent hero moves into host party`, async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await setupP2Hero(host, p2);

    await injectCard(host, id);
    await playCardFromHand(host, id);
    await passChallenge(p2);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);

    await clickFirstValidTarget(host);
    await host.waitForTimeout(600);

    // The stolen hero (card_030, injected into p2's party in setupP2Hero) should
    // move out of p2's party and into the host's. Counting party size doesn't work
    // for Tipsy Tootie, which swaps itself in — p2's size stays the same — so we
    // assert on the specific card moving instead.
    const hostHasStolen   = await host.locator('#player-party [data-id="card_030"]').count();
    const p2StillHasStolen = await p2.locator('#player-party [data-id="card_030"]').count();

    expect(hostHasStolen,    `${id}: host should gain the stolen hero`).toBeGreaterThan(0);
    expect(p2StillHasStolen, `${id}: p2 should lose the stolen hero`).toBe(0);
    expect(errors).toEqual([]);

    await ctx1.close(); await ctx2.close();
});
}
