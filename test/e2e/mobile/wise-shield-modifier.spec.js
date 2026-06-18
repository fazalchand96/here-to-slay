'use strict';

// Wise Shield (card_039, 6+) — "+3 to all your rolls until end of turn."
// Regression for the messy modifier overlay: after the skill roll opens the
// modifier window, the pre-roll "ROLL" button must NOT linger in the dice overlay
// (the screenshot showed a stale "ROLL FOR CHALLENGE" button + blank dice behind
// the modifier prompt). Mobile viewport + screenshot.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');
const {
    injectCard, playCardFromHand, passChallenge, rollDice,
} = require('../helpers/gameSetup');

const WISE_SHIELD = 'card_039';

test('Wise Shield: modifier window has no leftover roll button', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await injectCard(host, WISE_SHIELD);
    await playCardFromHand(host, WISE_SHIELD);
    await passChallenge(p2);
    await rollDice(host);              // forced 6+6 → auto-rolls into the modifier window
    // Intentionally DO NOT pass modifiers — keep the window open to inspect it.
    await host.waitForTimeout(600);

    // We should be in the modifier window now.
    const state = await host.evaluate(() => window.latestGameState.state);
    expect(state).toBe('WAITING_FOR_MODIFIERS');

    // The modifier prompt is up...
    await expect(host.locator('#modifier-modal')).not.toHaveClass(/hidden/);

    // ...and the pre-roll roll button is hidden (the bug left it visible with a
    // stale "ROLL FOR CHALLENGE" label).
    const rollBtnDisplay = await host.evaluate(() => {
        const b = document.getElementById('manual-roll-btn');
        return b ? getComputedStyle(b).display : 'none';
    });
    expect(rollBtnDisplay, 'pre-roll roll button must be hidden in the modifier window').toBe('none');

    await host.screenshot({ path: 'wise-shield-modifier-mobile.png' });

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
