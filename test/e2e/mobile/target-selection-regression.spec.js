'use strict';

const path = require('node:path');
const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('./mobileSetup');

const VIEWPORT = { width: 874, height: 402 };
const SERIOUS_GREY = 'card_044';
const TARGET_HERO = 'card_030';

test('Serious Grey inspects first, then explicitly destroys, without leaving the UI locked', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser, VIEWPORT);
    host.on('pageerror', error => errors.push(`host: ${error.message}`));
    p2.on('pageerror', error => errors.push(`p2: ${error.message}`));

    await host.evaluate((id) => window._socket.emit('debug_inject_to_party', { cardId: id }), SERIOUS_GREY);
    await p2.evaluate((id) => window._socket.emit('debug_inject_to_party', { cardId: id }), TARGET_HERO);
    await expect.poll(() => p2.evaluate((id) =>
        window.latestGameState.players[window.myId].party.some(card => card.id === id), TARGET_HERO
    )).toBe(true);

    const handBefore = await host.evaluate(() => window.latestGameState.players[window.myId].hand.length);
    await host.evaluate((id) => {
        window._socket.emit('debug_force_next_roll', { roll1: 6, roll2: 6 });
        window._socket.emit('use_hero_skill', { cardId: id, isFree: false });
    }, SERIOUS_GREY);
    await expect.poll(() => host.evaluate(() => window.latestGameState.state)).toBe('WAITING_TO_ROLL');
    await host.evaluate(() => window._socket.emit('execute_roll'));
    await expect.poll(() => host.evaluate(() => window.latestGameState.state)).toBe('WAITING_FOR_MODIFIERS');
    await host.evaluate(() => window._socket.emit('submit_modifier_action', { action: 'PASS' }));
    await p2.evaluate(() => window._socket.emit('submit_modifier_action', { action: 'PASS' }));

    await expect.poll(() => host.evaluate(() => window.latestGameState.state)).toBe('WAITING_FOR_SKILL_TARGET');
    await host.locator('#opponents-bar .opponent-chip').first().click();
    const target = host.locator(`#opponent-modal [data-id="${TARGET_HERO}"].valid-target`);
    await expect(target).toBeVisible();
    await host.screenshot({
        path: path.join(process.cwd(), 'output', 'browser-qa', 'serious-grey-target-v205-874x402.png')
    });

    // The first tap only opens inspection; nothing destructive happens until the
    // explicit action is pressed.
    await target.click({ force: true });
    await expect(host.locator('#inspector-modal')).toBeVisible();
    await expect(host.locator('#inspector-modal-actions button', { hasText: 'SELECT TO DESTROY' })).toBeVisible();
    await expect.poll(() => p2.evaluate((id) =>
        window.latestGameState.players[window.myId].party.some(card => card.id === id), TARGET_HERO
    )).toBe(true);
    await host.locator('#inspector-modal-actions button', { hasText: 'SELECT TO DESTROY' }).click();
    await expect.poll(() => p2.evaluate((id) =>
        window.latestGameState.players[window.myId].party.some(card => card.id === id), TARGET_HERO
    )).toBe(false);
    await expect.poll(() => host.evaluate(() => window.latestGameState.state)).toBe('PLAYING');
    await expect.poll(() => host.evaluate(() => window.latestGameState.players[window.myId].hand.length)).toBe(handBefore + 1);
    await expect(host.locator('#inspector-modal')).toHaveClass(/hidden/);

    // Once the destroy resolves, ordinary card inspection must work immediately.
    await host.locator('#party-dock').click({ force: true });
    const ownHero = host.locator(`#opponent-modal [data-id="${SERIOUS_GREY}"]`).first();
    await expect(ownHero).toBeVisible();
    await ownHero.click({ force: true });
    await expect(host.locator('#inspector-modal')).toBeVisible();

    expect(errors).toEqual([]);
    await ctx1.close();
    await ctx2.close();
});
