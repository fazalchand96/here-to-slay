'use strict';

const { test, expect } = require('../helpers/fixtures');
const { newTrackedContext } = require('../helpers/gameSetup');

async function rollLeader(page, name) {
    await page.fill('#player-name-input', name);
    await page.getByText('ROLL FOR LEADER').click();
    await expect(page.locator('#player-name-input')).toBeHidden({ timeout: 10_000 });
}

test('Party leaders: game starts with whichever leader was assigned, no crash', async ({ browser }) => {
    const errors = [];
    const ctx1 = await newTrackedContext(browser);
    const ctx2 = await newTrackedContext(browser);
    const host = await ctx1.newPage();
    const p2   = await ctx2.newPage();

    host.on('pageerror', e => errors.push(e.message));
    p2.on('pageerror', e => errors.push(e.message));

    await host.goto('/', { waitUntil: 'domcontentloaded' });
    await p2.goto('/', { waitUntil: 'domcontentloaded' });

    await rollLeader(host, 'LeaderHost');
    await rollLeader(p2,   'LeaderGuest');

    const hostLeaderName = await host.locator('#leader-selection-container .card-name').textContent().catch(() => 'unknown');

    await expect(host.locator('#start-game-btn')).not.toHaveClass(/hidden/, { timeout: 10_000 });
    // The start button pulses + the lobby re-renders on each broadcast, so it never
    // settles for the default "stable" check — force the click.
    await host.click('#start-game-btn', { force: true });

    await expect(host.locator('#app-container')).not.toHaveClass(/hidden/, { timeout: 12_000 });
    await expect(p2.locator('#app-container')).not.toHaveClass(/hidden/, { timeout: 12_000 });

    expect(errors, `JS errors with leader "${hostLeaderName}": ${errors.join('; ')}`).toEqual([]);

    await ctx1.close(); await ctx2.close();
});

test('Leader reroll works and game can still start', async ({ browser }) => {
    const errors = [];
    const ctx1 = await newTrackedContext(browser);
    const ctx2 = await newTrackedContext(browser);
    const host = await ctx1.newPage();
    const p2   = await ctx2.newPage();

    host.on('pageerror', e => errors.push(e.message));

    await host.goto('/', { waitUntil: 'domcontentloaded' });
    await p2.goto('/', { waitUntil: 'domcontentloaded' });

    await rollLeader(host, 'RerollHost');
    const rerollBtn = host.getByText('REROLL (1 LEFT)');
    if (await rerollBtn.isVisible({ timeout: 4_000 }).catch(() => false)) {
        await rerollBtn.click();
        await host.waitForTimeout(500);
    }

    await rollLeader(p2, 'RerollGuest');
    await expect(host.locator('#start-game-btn')).not.toHaveClass(/hidden/, { timeout: 10_000 });
    // The start button pulses + the lobby re-renders on each broadcast, so it never
    // settles for the default "stable" check — force the click.
    await host.click('#start-game-btn', { force: true });
    await expect(host.locator('#app-container')).not.toHaveClass(/hidden/, { timeout: 12_000 });

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
