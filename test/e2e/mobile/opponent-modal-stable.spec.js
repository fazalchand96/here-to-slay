'use strict';

// Regression: the opponent modal used to rebuild its card DOM on EVERY broadcast,
// which dropped in-flight target taps in multiplayer ("selected the hero, nothing
// happened"). It must now only re-render when the viewed opponent / targeting
// context actually changes. Here: while targeting with p2's modal open, a
// broadcast that changes only the HOST's board must leave p2's modal DOM intact.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');
const {
    injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers, clickFirstValidTarget,
} = require('../helpers/gameSetup');

const TIPSY = 'card_031';
const VICTIM_HERO = 'card_030';

test('Opponent modal is not rebuilt by an unrelated broadcast (taps survive)', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    const ownLeaderId = await host.evaluate(() => window.latestGameState.players[window.myId].leader.id);
    await host.locator('#party-dock').click();
    await expect(host.locator(`#opponent-modal .party-class-leader-card .card[data-id="${ownLeaderId}"]`))
        .toBeVisible({ timeout: 5_000 });
    await host.locator('#opponent-modal-close-btn').click();

    await p2.evaluate((id) => window._socket.emit('debug_inject_to_party', { cardId: id }), VICTIM_HERO);
    await p2.waitForTimeout(300);

    await injectCard(host, TIPSY);
    await playCardFromHand(host, TIPSY);
    await passChallenge(p2);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);
    await host.waitForTimeout(400);
    expect(await host.evaluate(() => window.latestGameState.state)).toBe('WAITING_FOR_SKILL_TARGET');

    const targetBannerBox = await host.locator('#target-banner').boundingBox();
    expect(targetBannerBox, 'target instructions should remain visible').not.toBeNull();
    expect(targetBannerBox.height, 'target instructions should not cover the party cards').toBeLessThanOrEqual(44);

    // Open the opponent's modal and mark the target hero's DOM node.
    await host.locator('#opponents-bar .opponent-chip').first().click();
    const opponentLeaderId = await host.evaluate(() => {
        const opponentId = window.latestGameState.playerOrder.find(id => id !== window.myId);
        return window.latestGameState.players[opponentId].leader.id;
    });
    await expect(host.locator(`#opponent-modal .party-class-leader-card .card[data-id="${opponentLeaderId}"]`))
        .toBeVisible({ timeout: 5_000 });
    const heroSel = '#opponent-modal [data-id="card_030"]';
    await expect(host.locator(heroSel)).toBeVisible({ timeout: 5_000 });
    await host.evaluate((sel) => document.querySelector(sel).setAttribute('data-test-marker', 'x'), heroSel);

    // Fire a broadcast that does NOT change the viewed opponent (host injects to
    // its OWN party). Pre-fix this rebuilt p2's modal and wiped the marker.
    await host.evaluate(() => window._socket.emit('debug_inject_to_party', { cardId: 'card_016' }));
    await host.waitForTimeout(500);

    const survived = await host.locator(`${heroSel}[data-test-marker="x"]`).count();
    expect(survived, 'modal DOM should be left intact by the unrelated broadcast').toBe(1);

    // And the target can still be selected (tap hero -> SELECT TARGET) and resolves.
    await clickFirstValidTarget(host);
    await host.waitForTimeout(600);
    const pa = await host.evaluate(() => window.latestGameState.pendingAction);
    expect(pa, 'selecting the target should resolve the skill').toBeNull();

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
