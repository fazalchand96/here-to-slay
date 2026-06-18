'use strict';

// Smooth Mimimeow (card_055, 7+) — "Pull a card from the hand of each other player
// with a Thief in their Party." Give the opponent a Thief; rolling the skill should
// auto-pull one card from them (no targeting step / no hang). Mobile + screenshot.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');
const {
    injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers,
} = require('../helpers/gameSetup');

const SMOOTH = 'card_055';
const THIEF_HERO = 'card_049'; // Meowzio — class Thief

test('Smooth Mimimeow: pulls a card from an opponent who has a Thief', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Opponent has a Thief in their party -> qualifies for the pull.
    await p2.evaluate((id) => window._socket.emit('debug_inject_to_party', { cardId: id }), THIEF_HERO);
    await p2.waitForTimeout(300);
    const p2Before = await p2.evaluate(() => window.latestGameState.players[window.myId].hand.length);

    await injectCard(host, SMOOTH);
    await playCardFromHand(host, SMOOTH);
    await passChallenge(p2);
    const hostBeforeResolve = await host.evaluate(() => window.latestGameState.players[window.myId].hand.length);
    await rollDice(host);              // forced 6+6 beats 7+
    await passModifiers(host);
    await passOpponentModifiers(p2);
    await host.waitForTimeout(500);

    // Auto-resolves on the roll: no targeting step, back to PLAYING.
    expect(await host.evaluate(() => window.latestGameState.state)).toBe('PLAYING');
    expect(await host.evaluate(() => window.latestGameState.pendingAction)).toBeNull();

    const p2After = await p2.evaluate(() => window.latestGameState.players[window.myId].hand.length);
    const hostAfter = await host.evaluate(() => window.latestGameState.players[window.myId].hand.length);
    expect(p2After, 'thief-holding opponent loses one card').toBe(p2Before - 1);
    expect(hostAfter, 'roller gains the pulled card').toBe(hostBeforeResolve + 1);

    await host.screenshot({ path: 'smooth-mimimeow-mobile.png' });

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
