'use strict';

// Sharp Fox (card_045) — "Look at another player's hand."
// Verifies the fixed behavior on a mobile viewport:
//   - the roller sees the opponent's hand in a view-only peek modal
//   - NOTHING is stolen (the old bug pulled a random card)
// Also captures a mobile screenshot of the resulting modal.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');
const {
    injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers,
} = require('../helpers/gameSetup');

const SHARP_FOX = 'card_045';

test('Sharp Fox: reveals opponent hand (view-only) and steals nothing', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await injectCard(host, SHARP_FOX);
    await playCardFromHand(host, SHARP_FOX);
    await passChallenge(p2);
    await rollDice(host);              // forced 6+6 — beats the 5+ requirement
    await passModifiers(host);
    await passOpponentModifiers(p2);
    await host.waitForTimeout(400);

    // Record hand sizes from each player's OWN state (opponent hands are masked).
    const hostHandBefore = await host.evaluate(() => window.latestGameState.players[window.myId].hand.length);
    const p2HandBefore   = await p2.evaluate(() => window.latestGameState.players[window.myId].hand.length);

    // Host targets the opponent (player-target skill).
    await host.evaluate(() => {
        const st = window.latestGameState;
        const oppId = st.playerOrder.find(id => id !== window.myId);
        window._socket.emit('submit_skill_target', { targetPlayerId: oppId });
    });

    // The view-only peek modal should appear for the roller.
    await expect(host.locator('#deck-peek-modal')).not.toHaveClass(/hidden/, { timeout: 8_000 });
    await expect(host.locator('#deck-peek-title')).toContainText(/hand/i);
    // View-only: there must be NO "Select" button in the peek modal.
    await expect(host.locator('#deck-peek-cards button', { hasText: /select/i })).toHaveCount(0);
    await host.waitForTimeout(300);

    // Nothing was stolen: both hands unchanged.
    const hostHandAfter = await host.evaluate(() => window.latestGameState.players[window.myId].hand.length);
    const p2HandAfter   = await p2.evaluate(() => window.latestGameState.players[window.myId].hand.length);

    expect(hostHandAfter, 'Sharp Fox must not add a card to the roller').toBe(hostHandBefore);
    expect(p2HandAfter, 'Sharp Fox must not remove a card from the target').toBe(p2HandBefore);

    await host.screenshot({ path: 'sharp-fox-mobile.png' });

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
