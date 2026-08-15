'use strict';

const path = require('node:path');
const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('./mobileSetup');

const VIEWPORT = { width: 874, height: 402 };
const PEANUT = 'card_030';
const SNOWBALL = 'card_060';
const BULLSEYE = 'card_040';
const MODIFIER = 'card_079';
const MAGIC = 'card_106';

async function startSuccessfulSkill(host, heroId) {
    await host.evaluate((id) => {
        window._socket.emit('debug_inject_to_party', { cardId: id });
        window._socket.emit('debug_force_next_roll', { roll1: 6, roll2: 6 });
    }, heroId);
    await expect.poll(() => host.evaluate((id) =>
        window.latestGameState.players[window.myId].party.some(card => card.id === id), heroId)).toBe(true);
    await host.evaluate((id) => window._socket.emit('use_hero_skill', { cardId: id, isFree: false }), heroId);
    await expect.poll(() => host.evaluate(() => window.latestGameState.state)).toBe('WAITING_TO_ROLL');
    await host.evaluate(() => window._socket.emit('execute_roll'));
    await expect.poll(() => host.evaluate(() => window.latestGameState.state)).toBe('WAITING_FOR_MODIFIERS');
}

async function passModifierWindow(host, p2) {
    await host.evaluate(() => window._socket.emit('submit_modifier_action', { action: 'PASS' }));
    await p2.evaluate(() => window._socket.emit('submit_modifier_action', { action: 'PASS' }));
}

test('modifier popup shows a played Modifier in the unified frame', async ({ browser }) => {
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser, VIEWPORT);
    await p2.evaluate((id) => window._socket.emit('debug_set_hand', { cardIds: [id] }), MODIFIER);
    await startSuccessfulSkill(host, PEANUT);

    const dice = host.locator('#dice-overlay.tabletop-modal-b');
    await expect(dice).toBeVisible();
    expect(await dice.evaluate(element => getComputedStyle(element).backgroundImage))
        .toContain('unified-v201/panel-large.webp');
    const diceBox = await dice.boundingBox();
    expect(diceBox.x).toBeGreaterThanOrEqual(0);
    expect(diceBox.x + diceBox.width).toBeLessThanOrEqual(VIEWPORT.width);
    expect(await host.locator('#dice-pass-btn').evaluate(element => getComputedStyle(element).backgroundImage))
        .toContain('unified-v197/button-secondary.webp');
    await p2.screenshot({
        path: path.join(process.cwd(), 'output', 'browser-qa', 'modifier-window-v197-874x402.png')
    });
    await p2.evaluate((id) => window._socket.emit('submit_modifier_action', {
        action: 'PLAY', cardId: id, modValue: -3
    }), MODIFIER);
    await expect(host.locator('#math-breakdown-banner')).toContainText(/Modifiers\s*Total/i);
    await expect.poll(() => p2.evaluate(() => window.latestGameState.players[window.myId].hand.length)).toBe(0);
    await expect(host.locator('#monster-trigger-modal')).toBeHidden({ timeout: 8_000 });
    await host.screenshot({
        path: path.join(process.cwd(), 'output', 'browser-qa', 'modifier-played-v197-874x402.png')
    });

    await ctx1.close();
    await ctx2.close();
});

test('Snowball immediate-play and opponent waiting popups use the unified frame', async ({ browser }) => {
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser, VIEWPORT);
    await host.evaluate((magicId) => window._socket.emit('debug_stack_deck', { cardId: magicId }), MAGIC);
    await startSuccessfulSkill(host, SNOWBALL);
    await passModifierWindow(host, p2);

    await expect.poll(() => host.evaluate(() => window.latestGameState.state)).toBe('WAITING_FOR_IMMEDIATE_PLAY');
    await expect(host.locator('#immediate-play-modal > .tabletop-modal-b')).toBeVisible();
    await host.screenshot({
        path: path.join(process.cwd(), 'output', 'browser-qa', 'immediate-play-v197-874x402.png')
    });

    await expect(p2.locator('#waiting-overlay.tabletop-modal-b')).toBeVisible();
    await p2.screenshot({
        path: path.join(process.cwd(), 'output', 'browser-qa', 'opponent-waiting-v197-874x402.png')
    });

    await ctx1.close();
    await ctx2.close();
});

test('Bullseye card picker uses the same generated frame and buttons', async ({ browser }) => {
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser, VIEWPORT);
    for (const cardId of ['card_016', 'card_024', 'card_032']) {
        await host.evaluate((id) => window._socket.emit('debug_stack_deck', { cardId: id }), cardId);
    }
    await startSuccessfulSkill(host, BULLSEYE);
    await passModifierWindow(host, p2);

    const picker = host.locator('#deck-peek-modal > .tabletop-modal-b');
    await expect(picker).toBeVisible({ timeout: 5_000 });
    expect(await picker.evaluate(element => getComputedStyle(element).backgroundImage))
        .toContain('unified-v201/panel-large.webp');
    await host.screenshot({
        path: path.join(process.cwd(), 'output', 'browser-qa', 'card-picker-v197-874x402.png')
    });

    await ctx1.close();
    await ctx2.close();
});

test('monster-slay reward toast uses the compact generated frame', async ({ browser }) => {
    const { host, ctx1, ctx2 } = await startMobileGame(browser, VIEWPORT);
    await expect(host.locator('#reward-toast')).toHaveClass(/hidden/);
    await host.evaluate(() => window._socket.emit('debug_add_slain_monster', { cardId: 'card_006' }));
    await expect(host.locator('#reward-toast.show')).toBeVisible({ timeout: 3_000 });
    expect(await host.locator('#reward-toast-inner.tabletop-modal-b').evaluate(element => getComputedStyle(element).backgroundImage))
        .toContain('unified-v201/panel-compact.webp');
    await host.screenshot({
        path: path.join(process.cwd(), 'output', 'browser-qa', 'monster-slay-reward-v197-874x402.png')
    });

    await ctx1.close();
    await ctx2.close();
});
