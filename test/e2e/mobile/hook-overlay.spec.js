'use strict';

// Hook (card_041, 6+) — "DRAW a card, then may play an Item." After the skill
// roll resolves into the WAITING_FOR_HAND_SELECTION prompt, the dice/modifier
// overlay from the roll must be HIDDEN (it used to linger behind the prompt,
// showing "...WAITING FOR OTHERS" on top of the hand-selection banner).
// Mobile viewport + screenshot.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');
const {
    injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers,
} = require('../helpers/gameSetup');

const HOOK = 'card_041';
const CURSED_ITEM = 'card_075';

test('Hook: dice overlay is hidden under the play-an-item prompt', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await injectCard(host, CURSED_ITEM);
    await injectCard(host, HOOK);
    await playCardFromHand(host, HOOK);
    await passChallenge(p2);
    await rollDice(host);              // forced 6+6 — beats the 6+ requirement
    await passModifiers(host);
    await passOpponentModifiers(p2);
    await host.waitForTimeout(500);

    // We should be in the hand-selection prompt now.
    const state = await host.evaluate(() => window.latestGameState.state);
    expect(state).toBe('WAITING_FOR_HAND_SELECTION');

    // The prompt banner is visible...
    await expect(host.locator('#target-banner')).not.toHaveClass(/hidden/);
    await expect(host.locator('#target-banner')).toContainText(/SELECT A CARD FROM YOUR HAND/i);

    // ...and the leftover dice/modifier overlay is hidden (the bug).
    await expect(host.locator('#dice-overlay')).toHaveClass(/hidden/);

    await host.screenshot({ path: 'hook-overlay-mobile.png' });

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
