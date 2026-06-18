'use strict';

// Pan Chucks (card_021, 8+) — "DRAW 2 cards. If at least one is a Challenge card,
// you MAY reveal it, then DESTROY a Hero." The destroy is OPTIONAL: the player can
// SKIP it (it used to be forced). Deck is stacked with Challenges so the destroy
// is offered deterministically. Mobile viewport + screenshot.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');
const {
    injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers,
} = require('../helpers/gameSetup');

const PAN_CHUCKS = 'card_021';
const CHALLENGE = 'card_117';
const VICTIM_HERO = 'card_030';

test('Pan Chucks: optional destroy can be SKIPPED (and the hero survives)', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Opponent has a hero (a valid destroy target).
    await p2.evaluate((id) => window._socket.emit('debug_inject_to_party', { cardId: id }), VICTIM_HERO);
    await p2.waitForTimeout(200);
    // Stack two Challenge cards on top so Pan Chucks definitely reveals a Challenge.
    await host.evaluate((id) => window._socket.emit('debug_stack_deck', { cardId: id }), CHALLENGE);
    await host.evaluate((id) => window._socket.emit('debug_stack_deck', { cardId: id }), CHALLENGE);
    await host.waitForTimeout(200);

    await injectCard(host, PAN_CHUCKS);
    await playCardFromHand(host, PAN_CHUCKS);
    await passChallenge(p2);
    await rollDice(host);              // forced 6+6 beats 8+
    await passModifiers(host);
    await passOpponentModifiers(p2);
    await host.waitForTimeout(500);

    // The OPTIONAL destroy is offered to the caster.
    const pa = await host.evaluate(() => window.latestGameState.pendingAction);
    const myId = await host.evaluate(() => window.myId);
    expect(pa && pa.type, 'should offer DESTROY').toBe('DESTROY');
    expect(pa && pa.optional, 'destroy must be optional (you MAY)').toBe(true);
    expect(pa && pa.playerToChoose).toBe(myId);

    // A SKIP button is shown in the banner.
    await expect(host.locator('#target-banner')).toContainText(/SKIP/i);
    await host.screenshot({ path: 'pan-chucks-mobile.png' });

    // Skip it -> action clears, turn continues, and the opponent's hero survives.
    await host.evaluate(() => window._socket.emit('skip_optional_action'));
    await host.waitForTimeout(400);

    const paAfter = await host.evaluate(() => window.latestGameState.pendingAction);
    const state = await host.evaluate(() => window.latestGameState.state);
    const victimAlive = await p2.evaluate((id) => window.latestGameState.players[window.myId].party.some(h => h.id === id), VICTIM_HERO);
    expect(paAfter, 'skipping clears the pending action').toBeNull();
    expect(state).toBe('PLAYING');
    expect(victimAlive, 'declined destroy leaves the hero alive').toBe(true);

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
