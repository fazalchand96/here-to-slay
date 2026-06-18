'use strict';

// The dice-overlay equation line should itemize every bonus with its source
// (e.g. "Wise Shield +3") instead of collapsing them into one anonymous "+N".
// Setup: use Wise Shield (+3 this turn), then roll a second hero's skill the same
// turn so its breakdown must include "Wise Shield +3". Mobile viewport + shot.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');
const {
    injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers,
} = require('../helpers/gameSetup');

const WISE_SHIELD = 'card_039';
const SECOND_HERO = 'card_030';

test('Roll breakdown line itemizes each bonus source', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // 1) Use Wise Shield -> +3 to all rolls this turn.
    await injectCard(host, WISE_SHIELD);
    await playCardFromHand(host, WISE_SHIELD);
    await passChallenge(p2);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);
    await host.waitForTimeout(400);

    const bonus = await host.evaluate(() => window.latestGameState.players[window.myId].rollBonus);
    expect(bonus, 'Wise Shield should grant +3 this turn').toBe(3);

    // 2) Put a second hero in the party and roll its skill the SAME turn.
    await host.evaluate((id) => window._socket.emit('debug_inject_to_party', { cardId: id }), SECOND_HERO);
    await host.waitForTimeout(300);
    await host.evaluate((id) => {
        window._socket.emit('debug_force_next_roll', { roll1: 5, roll2: 5 });
        window._socket.emit('use_hero_skill', { cardId: id, isFree: false });
    }, SECOND_HERO);
    await host.waitForTimeout(300);
    await host.evaluate(() => window._socket.emit('execute_roll'));
    await host.waitForTimeout(1600); // let the dice animation settle into the equation

    // The equation line must show the dice AND the labelled "Wise Shield +3".
    const bannerText = await host.evaluate(
        () => document.getElementById('math-breakdown-banner').textContent || '',
    );
    expect(bannerText).toMatch(/Wise Shield/);
    expect(bannerText).toMatch(/\+3/);
    expect(bannerText).toMatch(/🎲/);

    await host.screenshot({ path: 'roll-breakdown-mobile.png' });

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
