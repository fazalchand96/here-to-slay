'use strict';

// Meowzio (card_049, 10+) — "Choose a player. STEAL a Hero from that player and
// pull a card from that player's hand." Verifies on a mobile viewport that it:
//   - STEALS the chosen hero (moves into the roller's party; not destroyed)
//   - pulls one card from that player's hand (roller +1, target -1)
// (The old bug DESTROYED the hero and made the ROLLER discard 2 cards.)
// Also captures a mobile screenshot of the result.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');
const {
    injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers, clickFirstValidTarget,
} = require('../helpers/gameSetup');

const MEOWZIO = 'card_049';
const VICTIM_HERO = 'card_030';

test('Meowzio: steals a hero AND pulls a card (not destroy/self-discard)', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Give p2 a hero to steal (playCard is turn-gated, so inject straight to party).
    await p2.evaluate((id) => window._socket.emit('debug_inject_to_party', { cardId: id }), VICTIM_HERO);
    await p2.waitForTimeout(400);

    await injectCard(host, MEOWZIO);
    await playCardFromHand(host, MEOWZIO);
    await passChallenge(p2);
    await rollDice(host);              // forced 6+6 = 12 — beats the 10+ requirement
    await passModifiers(host);
    await passOpponentModifiers(p2);
    await host.waitForTimeout(400);

    const hostHandBefore = await host.evaluate(() => window.latestGameState.players[window.myId].hand.length);
    const p2HandBefore   = await p2.evaluate(() => window.latestGameState.players[window.myId].hand.length);

    await clickFirstValidTarget(host);
    await host.waitForTimeout(600);

    // Hero was STOLEN (moved into host party), not destroyed.
    const hostHasStolen    = await host.locator('#player-party [data-id="card_030"]').count();
    const p2StillHasStolen = await p2.locator('#player-party [data-id="card_030"]').count();
    expect(hostHasStolen, 'host should gain the stolen hero').toBeGreaterThan(0);
    expect(p2StillHasStolen, 'p2 should lose the stolen hero').toBe(0);

    // A card was pulled from p2 into host's hand: host +1, p2 -1. (The old bug made
    // the roller DISCARD 2 instead — host hand would have dropped.)
    const hostHandAfter = await host.evaluate(() => window.latestGameState.players[window.myId].hand.length);
    const p2HandAfter   = await p2.evaluate(() => window.latestGameState.players[window.myId].hand.length);
    expect(hostHandAfter, 'roller pulls one card (does not discard)').toBe(hostHandBefore + 1);
    expect(p2HandAfter, 'target loses one card to the pull').toBe(p2HandBefore - 1);

    await host.screenshot({ path: 'meowzio-mobile.png' });

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
