'use strict';

const path = require('node:path');
const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('./mobileSetup');
const { injectCard } = require('../helpers/gameSetup');

const LANDSCAPE_PHONES = [
    { name: 'small-samsung', width: 740, height: 360 },
    { name: 'iphone-pro', width: 874, height: 402 },
    { name: 'large-samsung', width: 915, height: 412 },
    { name: 'iphone-pro-max', width: 956, height: 440 },
];

async function expectSurfaceFits(page, selector, viewport) {
    const surface = page.locator(selector);
    await expect(surface).toBeVisible({ timeout: 8_000 });
    const box = await surface.boundingBox();
    expect(box, `${selector} should have a box at ${viewport.name}`).not.toBeNull();
    expect(box.x, `${selector} left edge at ${viewport.name}`).toBeGreaterThanOrEqual(-1);
    expect(box.y, `${selector} top edge at ${viewport.name}`).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width, `${selector} right edge at ${viewport.name}`).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height, `${selector} bottom edge at ${viewport.name}`).toBeLessThanOrEqual(viewport.height + 1);
    await expect(surface).toHaveClass(/tabletop-modal-b/);
    const backgroundImage = await surface.evaluate(element => getComputedStyle(element).backgroundImage);
    expect(backgroundImage, `${selector} must use the generated tabletop frame`)
        .toContain('unified-v201/panel-large.webp');
}

for (const viewport of LANDSCAPE_PHONES) {
    test(`inspector fits ${viewport.name} at ${viewport.width}x${viewport.height}`, async ({ browser }) => {
        const errors = [];
        const { host, ctx1, ctx2 } = await startMobileGame(browser, viewport);
        host.on('pageerror', error => errors.push(error.message));

        if (viewport.name === 'iphone-pro') {
            await host.getByLabel('Toggle game log').tap();
            const chatPanel = host.locator('#chat-panel');
            await expect(chatPanel).toBeVisible();
            const resetButton = host.locator('#host-reset-game-btn');
            const leaveButton = host.locator('#game-leave-room-btn');
            const [resetBox, leaveBox] = await Promise.all([
                resetButton.boundingBox(),
                leaveButton.boundingBox(),
            ]);
            expect(resetBox.height).toBeLessThanOrEqual(28);
            expect(leaveBox.height).toBeLessThanOrEqual(28);
            expect(Math.abs(resetBox.y - leaveBox.y)).toBeLessThanOrEqual(1);
            expect(await resetButton.evaluate(element => getComputedStyle(element).backgroundImage))
                .toContain('unified-v197/button-primary.webp');
            expect(await leaveButton.evaluate(element => getComputedStyle(element).backgroundImage))
                .toContain('unified-v197/button-secondary.webp');
            const [chatBox, timerBox] = await Promise.all([
                host.locator('#event-console-empty').boundingBox(),
                host.locator('#action-point-timer').boundingBox(),
            ]);
            expect(chatBox.x + chatBox.width).toBeLessThanOrEqual(timerBox.x - 4);
            await host.screenshot({
                path: path.join(process.cwd(), 'output', 'browser-qa', 'unified-chat-v197-874x402.png'),
            });
            await host.getByLabel('Toggle game log').tap();
        }

        const leaderCard = host.locator('#leader-slot .card');
        await expect(leaderCard).toBeVisible();
        const leaderOwnsCenterHit = await leaderCard.evaluate(element => {
            const box = element.getBoundingClientRect();
            const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
            return Boolean(hit && element.contains(hit));
        });
        expect(leaderOwnsCenterHit, `Party Leader hitbox should be unobstructed at ${viewport.name}`).toBe(true);
        await leaderCard.tap();
        await expect(host.locator('#inspector-modal')).not.toHaveClass(/hidden/, { timeout: 1_500 });
        await expect(host.locator('#inspector-modal-type')).toContainText('Party Leader');
        await host.getByRole('button', { name: 'CLOSE' }).click();

        await host.locator('#player-hand .card').first().tap();
        await expectSurfaceFits(host, '#inspector-modal > .tabletop-modal-b', viewport);
        await expect(host.locator('#inspector-modal-actions .action-btn').last()).toBeVisible();
        if (viewport.name === 'iphone-pro') {
            await host.waitForTimeout(450);
            await host.screenshot({
                path: path.join(process.cwd(), 'output', 'browser-qa', 'unified-inspector-v197-874x402.png'),
            });
        }
        expect(errors).toEqual([]);
        await ctx1.close();
        await ctx2.close();
    });
}

test('party, challenge, and skill surfaces share the frame on iPhone landscape', async ({ browser }) => {
    const viewport = LANDSCAPE_PHONES[1];
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser, viewport);
    host.on('pageerror', error => errors.push(error.message));
    p2.on('pageerror', error => errors.push(error.message));

    await host.locator('#discard-pile').tap({ force: true });
    await expectSurfaceFits(host, '#discard-viewer-modal > .tabletop-modal-b', viewport);
    await host.waitForTimeout(450);
    await host.screenshot({
        path: path.join(process.cwd(), 'output', 'browser-qa', 'unified-discard-v197-874x402.png'),
    });
    await host.locator('#discard-viewer-modal .picker-close-action').tap();

    await host.locator('#opponents-bar .opponent-chip').first().tap();
    await expectSurfaceFits(host, '#opponent-modal > .tabletop-modal-b', viewport);
    expect(await host.locator('#opponent-modal > .tabletop-modal-b').evaluate(element => getComputedStyle(element).backgroundImage))
        .toContain('unified-v201/panel-large.webp');
    await host.waitForTimeout(450);
    await host.screenshot({
        path: path.join(process.cwd(), 'output', 'browser-qa', 'unified-party-v197-874x402.png'),
    });
    await expect(host.locator('#opponent-modal-close-btn')).toHaveCount(0);
    await host.locator('#opponent-modal > .tabletop-modal-b > .modal-secondary-action').click();

    await p2.evaluate(() => window._socket.emit('debug_set_hand', { cardIds: ['card_117'] }));
    await expect.poll(() => p2.evaluate(() => window.latestGameState.players[window.myId].hand.length)).toBe(1);
    await injectCard(host, 'card_030');
    await host.evaluate(() => window._socket.emit('playCard', { cardId: 'card_030', isFree: false }));
    await expectSurfaceFits(p2, '#challenge-modal.tabletop-modal-b', viewport);
    await expect(p2.locator('#challenge-pass-btn')).toBeVisible();
    expect(await p2.locator('#challenge-pass-btn').evaluate(element => getComputedStyle(element).backgroundImage))
        .toContain('unified-v197/button-secondary.webp');
    await p2.screenshot({
        path: path.join(process.cwd(), 'output', 'browser-qa', 'unified-challenge-v197-874x402.png'),
    });
    await p2.locator('#challenge-pass-btn').tap();

    const skillPrompt = host.locator('#skill-prompt-modal.tabletop-modal-b');
    await skillPrompt.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => {});
    if (await skillPrompt.isVisible().catch(() => false)) {
        await expectSurfaceFits(host, '#skill-prompt-modal.tabletop-modal-b', viewport);
        await host.screenshot({
            path: path.join(process.cwd(), 'output', 'browser-qa', 'unified-skill-v197-874x402.png'),
        });
        await host.locator('#skill-prompt-no').tap();
    }

    expect(errors).toEqual([]);
    await ctx1.close();
    await ctx2.close();
});
