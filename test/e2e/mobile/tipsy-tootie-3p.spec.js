'use strict';

// Tipsy Tootie in a THREE-player game — repro for "after selecting the opponent's
// hero, nothing happened." 2-player works, so this isolates the 3-player case.

const { test, expect } = require('../helpers/fixtures');
const { rollLeader } = require('../mobile/mobileSetup');
const {
    newTrackedContext, injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, clickFirstValidTarget,
} = require('../helpers/gameSetup');

const TIPSY = 'card_031';
const VICTIM_HERO = 'card_030';
const MOBILE = { viewport: { width: 844, height: 390 }, hasTouch: true, serviceWorkers: 'block' };

test('Tipsy Tootie (3 players): selecting an opponent hero resolves', async ({ browser }) => {
    const errors = [];
    const c1 = await newTrackedContext(browser, MOBILE);
    const c2 = await newTrackedContext(browser, MOBILE);
    const c3 = await newTrackedContext(browser, MOBILE);
    const host = await c1.newPage();
    const p2 = await c2.newPage();
    const p3 = await c3.newPage();
    host.on('pageerror', e => errors.push(e.message));

    for (const [pg, name] of [[host, 'Host'], [p2, 'Guest2'], [p3, 'Guest3']]) {
        await pg.goto('/', { waitUntil: 'domcontentloaded' });
        await rollLeader(pg, name);
    }
    await expect(host.locator('#start-game-btn')).not.toHaveClass(/hidden/, { timeout: 10_000 });
    await host.click('#start-game-btn', { force: true });
    await expect(host.locator('#app-container')).not.toHaveClass(/hidden/, { timeout: 12_000 });

    // Give BOTH opponents a hero so there are two possible targets.
    await p2.evaluate((id) => window._socket.emit('debug_inject_to_party', { cardId: id }), VICTIM_HERO);
    await p3.evaluate((id) => window._socket.emit('debug_inject_to_party', { cardId: id }), VICTIM_HERO);
    await host.waitForTimeout(400);

    await injectCard(host, TIPSY);
    await playCardFromHand(host, TIPSY);
    // Both opponents may challenge — pass for whichever sees the modal.
    await passChallenge(p2).catch(() => {});
    await p3.evaluate(() => window._socket.emit('pass_challenge')).catch(() => {});
    await rollDice(host);
    await passModifiers(host);
    await p2.locator('#dice-pass-btn').click().catch(() => {});
    await p3.locator('#dice-pass-btn').click().catch(() => {});
    await host.waitForTimeout(500);

    const state = await host.evaluate(() => window.latestGameState.state);
    expect(state).toBe('WAITING_FOR_SKILL_TARGET');

    await clickFirstValidTarget(host);
    await host.waitForTimeout(600);

    const paAfter = await host.evaluate(() => window.latestGameState.pendingAction);
    const hostHeroCount = await host.evaluate(() => window.latestGameState.players[window.myId].party.filter(h => h.type === 'Hero Card').length);
    expect(paAfter, 'pending action should clear after selecting a hero').toBeNull();
    expect(hostHeroCount, 'host should have gained a stolen hero').toBeGreaterThan(0);

    expect(errors).toEqual([]);
    await c1.close(); await c2.close(); await c3.close();
});
