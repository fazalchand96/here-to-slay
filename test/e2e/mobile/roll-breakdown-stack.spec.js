'use strict';

// Stacked self-buffs: Wise Shield (+3) AND Vibrant Glow (+5) used the same turn.
// The breakdown line must list BOTH sources and the total must include +8 (no
// double-count, no overlap/overflow). Mobile viewport + screenshot to eyeball it.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');

const WISE_SHIELD = 'card_039';   // 6+, +3
const VIBRANT_GLOW = 'card_038';  // 9+, +5
const THIRD_HERO = 'card_030';

// Use a party hero's skill via sockets and resolve its modifier window (both
// players pass) so the self-buff is actually applied.
async function useSkillAndResolve(host, p2, heroId) {
    await host.evaluate((id) => {
        window._socket.emit('debug_force_next_roll', { roll1: 6, roll2: 6 });
        window._socket.emit('use_hero_skill', { cardId: id, isFree: false });
    }, heroId);
    await host.waitForTimeout(300);
    await host.evaluate(() => window._socket.emit('execute_roll'));
    await host.waitForTimeout(300);
    await host.evaluate(() => window._socket.emit('submit_modifier_action', { action: 'PASS' }));
    await p2.evaluate(() => window._socket.emit('submit_modifier_action', { action: 'PASS' }));
    await host.waitForTimeout(400);
}

test('Roll breakdown stacks Wise Shield +3 and Vibrant Glow +5', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Put all three heroes straight into the party.
    for (const id of [WISE_SHIELD, VIBRANT_GLOW, THIRD_HERO]) {
        await host.evaluate((c) => window._socket.emit('debug_inject_to_party', { cardId: c }), id);
        await host.waitForTimeout(200);
    }

    // Apply both self-buffs this turn.
    await useSkillAndResolve(host, p2, WISE_SHIELD);
    await useSkillAndResolve(host, p2, VIBRANT_GLOW);

    const bonus = await host.evaluate(() => window.latestGameState.players[window.myId].rollBonus);
    expect(bonus, 'Wise Shield +3 and Vibrant Glow +5 should stack to +8').toBe(8);

    // Roll the third hero and hold the modifier window to read the breakdown.
    await host.evaluate((id) => {
        window._socket.emit('debug_force_next_roll', { roll1: 4, roll2: 5 });
        window._socket.emit('use_hero_skill', { cardId: id, isFree: false });
    }, THIRD_HERO);
    await host.waitForTimeout(300);
    await host.evaluate(() => window._socket.emit('execute_roll'));
    await host.waitForTimeout(1600); // let the dice animation settle

    const bannerText = await host.evaluate(
        () => document.getElementById('math-breakdown-banner').textContent || '',
    );
    expect(bannerText, 'shows Wise Shield source').toMatch(/Wise Shield/);
    expect(bannerText, 'shows Vibrant Glow source').toMatch(/Vibrant Glow/);
    expect(bannerText).toMatch(/\+3/);
    expect(bannerText).toMatch(/\+5/);
    // dice 4+5=9, +8 buffs = 17
    expect(bannerText).toMatch(/17/);

    await host.screenshot({ path: 'roll-breakdown-stack-mobile.png' });

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
