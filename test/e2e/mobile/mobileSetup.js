'use strict';

const { expect } = require('@playwright/test');
const { newTrackedContext } = require('../helpers/gameSetup');

const MOBILE_VIEWPORT = { width: 844, height: 390 };

async function rollLeader(page, name) {
    await page.fill('#player-name-input', name);
    await page.getByText('ROLL FOR LEADER').click();
    await expect(page.locator('#player-name-input')).toBeHidden({ timeout: 10_000 });
}

// Start a 2-player game at mobile viewport size. Returns { host, p2, ctx1, ctx2 }.
async function startMobileGame(browser) {
    const mobileCtx = {
        viewport: MOBILE_VIEWPORT,
        hasTouch: true,
        serviceWorkers: 'block',
    };
    const ctx1 = await newTrackedContext(browser, mobileCtx);
    const ctx2 = await newTrackedContext(browser, mobileCtx);
    const host = await ctx1.newPage();
    const p2   = await ctx2.newPage();

    await host.goto('/', { waitUntil: 'domcontentloaded' });
    await p2.goto('/',   { waitUntil: 'domcontentloaded' });

    await rollLeader(host, 'MobileHost');
    await rollLeader(p2,   'MobileGuest');

    await expect(host.locator('#start-game-btn')).not.toHaveClass(/hidden/, { timeout: 10_000 });
    // Force — the start button pulses and the lobby re-renders each broadcast.
    await host.click('#start-game-btn', { force: true });

    await expect(host.locator('#app-container')).not.toHaveClass(/hidden/, { timeout: 12_000 });
    await expect(p2.locator('#app-container')).not.toHaveClass(/hidden/,   { timeout: 12_000 });

    return { host, p2, ctx1, ctx2 };
}

// Check that an element's bounding box fits within the given viewport dimensions.
async function isWithinViewport(locator, width = MOBILE_VIEWPORT.width, height = MOBILE_VIEWPORT.height) {
    const box = await locator.boundingBox();
    if (!box) return false;
    return box.x >= 0 && box.y >= 0 &&
           box.x + box.width  <= width &&
           box.y + box.height <= height;
}

module.exports = { startMobileGame, isWithinViewport, MOBILE_VIEWPORT, rollLeader };
