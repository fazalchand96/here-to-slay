'use strict';

// Silent Shadow (card_052) — "Look at another player's hand. Choose a card and
// add it to your hand." Verifies the fixed behavior on a mobile viewport:
//   - the roller sees the opponent's hand WITH selectable cards
//   - choosing a card moves exactly that card: target -1, roller +1
// (The old bug pulled a RANDOM card instead of letting you choose.)
// Also captures a mobile screenshot of the choose modal.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');
const {
    injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers,
} = require('../helpers/gameSetup');

const SILENT_SHADOW = 'card_052';

test('Silent Shadow: look at hand, choose a card, take exactly that card', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await injectCard(host, SILENT_SHADOW);
    await playCardFromHand(host, SILENT_SHADOW);
    await passChallenge(p2);
    await rollDice(host);              // forced 6+6 — beats the 8+ requirement
    await passModifiers(host);
    await passOpponentModifiers(p2);
    await host.waitForTimeout(400);

    const hostHandBefore = await host.evaluate(() => window.latestGameState.players[window.myId].hand.length);
    const p2HandBefore   = await p2.evaluate(() => window.latestGameState.players[window.myId].hand.length);

    // Host targets the opponent (player-target skill).
    await host.evaluate(() => {
        const st = window.latestGameState;
        const oppId = st.playerOrder.find(id => id !== window.myId);
        window._socket.emit('submit_skill_target', { targetPlayerId: oppId });
    });

    // The choose modal appears for the roller, WITH selectable cards.
    await expect(host.locator('#deck-peek-modal')).not.toHaveClass(/hidden/, { timeout: 8_000 });
    const selectBtns = host.locator('#deck-peek-cards button', { hasText: /select/i });
    await expect(selectBtns.first()).toBeVisible({ timeout: 5_000 });

    // Screenshot the choose UI before picking.
    await host.screenshot({ path: 'silent-shadow-mobile.png' });

    // Choose the first card. The peek cards run a pulsing glow animation, so the
    // button never satisfies Playwright's "stable" check — force the click.
    await selectBtns.first().click({ force: true });
    await host.waitForTimeout(400);

    const hostHandAfter = await host.evaluate(() => window.latestGameState.players[window.myId].hand.length);
    const p2HandAfter   = await p2.evaluate(() => window.latestGameState.players[window.myId].hand.length);

    expect(hostHandAfter, 'roller gains exactly one chosen card').toBe(hostHandBefore + 1);
    expect(p2HandAfter, 'target loses exactly the chosen card').toBe(p2HandBefore - 1);

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
