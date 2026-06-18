'use strict';

const { test, expect } = require('../helpers/fixtures');
const {
    startGame, injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers, clickFirstValidTarget,
} = require('../helpers/gameSetup');

// Wiggles (card_063, req 10): "STEAL a Hero card and roll to use its effect
// immediately." This spec drives the FULL chain in the browser — steal an
// opponent's Peanut (card_030, DRAW_2_CARDS, req 7), then confirm the immediate
// free roll fires Peanut's own skill and the host actually draws 2 cards.

async function handCount(page) {
    return page.evaluate(() => {
        const gs = window.latestGameState;
        return gs && gs.players && gs.players[window.myId]
            ? gs.players[window.myId].hand.length
            : -1;
    });
}

test('Wiggles steals a hero and immediately rolls to use its effect', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));
    p2.on('pageerror', e => errors.push(e.message));

    // Give p2 a Peanut (DRAW_2_CARDS) in their party to be stolen. playCard is
    // turn-gated, so inject straight into p2's party via the debug handler.
    await p2.evaluate(() => window._socket.emit('debug_inject_to_party', { cardId: 'card_030' }));
    await p2.waitForTimeout(400);

    // Host plays Wiggles and rolls (forced 6+6 = 12 >= 10) to use its skill.
    await injectCard(host, 'card_063');
    await playCardFromHand(host, 'card_063');
    await passChallenge(p2);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);

    // Pick the steal target — p2's Peanut.
    await clickFirstValidTarget(host);
    await host.waitForTimeout(600);

    // The hero moved into the host's party...
    expect(await host.locator('#player-party [data-id="card_030"]').count(),
        'host should have stolen Peanut').toBeGreaterThan(0);

    // ...and Wiggles set up an immediate FREE skill roll for the stolen hero.
    const stateAfterSteal = await host.evaluate(() => window.latestGameState.state);
    expect(stateAfterSteal, 'Wiggles should queue an immediate roll for the stolen hero')
        .toBe('WAITING_TO_ROLL');
    const rollTarget = await host.evaluate(() => window.latestGameState.pendingRoll.targetHeroId);
    expect(rollTarget, 'the queued roll should target the stolen hero').toBe('card_030');

    // Roll the stolen Peanut's skill (forced 12 >= 7) — it should DRAW 2 cards.
    const before = await handCount(host);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);
    await host.waitForTimeout(600);

    const after = await handCount(host);
    expect(after - before, "Peanut's DRAW_2_CARDS should add 2 cards to the host's hand").toBe(2);

    // And the turn returns to normal play (no lingering roll/penalty soft-lock).
    expect(await host.evaluate(() => window.latestGameState.state)).toBe('PLAYING');
    expect(errors).toEqual([]);

    await ctx1.close(); await ctx2.close();
});
