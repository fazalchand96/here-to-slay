'use strict';

// E2E tests for the lobby phase — joining, leader selection, and start-game guards.
// Playwright runs two separate browser contexts to simulate two real players.

const { test, expect } = require('./helpers/fixtures');
const { newTrackedContext } = require('./helpers/gameSetup');

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------

// Type a name and click ROLL FOR LEADER. Waits until the reroll/lock-in UI
// confirms the leader was assigned (i.e. hasSelectedLeader becomes true).
async function rollLeader(page, name = 'TestPlayer') {
    await page.fill('#player-name-input', name);
    await page.getByText('ROLL FOR LEADER').click();
    // After rolling, the name input is hidden and a reroll/lock-in UI appears
    await expect(page.locator('#player-name-input')).toBeHidden({ timeout: 8_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('lobby overlay is visible on load and game board is hidden', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#lobby-modal')).not.toHaveClass(/hidden/);
    await expect(page.locator('#app-container')).toHaveClass(/hidden/);
});

test('ROLL FOR LEADER button appears once player is registered', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // The button is rendered dynamically inside the leader-selection-container
    await expect(page.locator('#leader-selection-container')).toBeVisible();
    await expect(page.getByText('ROLL FOR LEADER')).toBeVisible();
});

test('start button stays hidden with only one player', async ({ browser }) => {
    const ctx = await newTrackedContext(browser);
    const page = await ctx.newPage();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await rollLeader(page, 'Solo');
    // Even after selecting a leader, the button must not appear (need ≥2 players)
    await page.waitForTimeout(1_000);
    await expect(page.locator('#start-game-btn')).toHaveClass(/hidden/);
    await ctx.close();
});

test('start button hidden for non-host even when both have leaders', async ({ browser }) => {
    const ctx1 = await newTrackedContext(browser);
    const ctx2 = await newTrackedContext(browser);
    const host = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    await host.goto('/', { waitUntil: 'domcontentloaded' });
    await p2.goto('/', { waitUntil: 'domcontentloaded' });

    await rollLeader(host, 'Host');
    await rollLeader(p2, 'Guest');

    // Give server a moment to propagate state
    await host.waitForTimeout(800);

    // p2 is not the host — they must never see the start button
    await expect(p2.locator('#start-game-btn')).toHaveClass(/hidden/);

    await ctx1.close();
    await ctx2.close();
});

test('start button appears for host once both players have a leader', async ({ browser }) => {
    const ctx1 = await newTrackedContext(browser);
    const ctx2 = await newTrackedContext(browser);
    const host = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    await host.goto('/', { waitUntil: 'domcontentloaded' });
    await p2.goto('/', { waitUntil: 'domcontentloaded' });

    await rollLeader(host, 'HostPlayer');
    await rollLeader(p2, 'GuestPlayer');

    // Host should now see the start button
    await expect(host.locator('#start-game-btn')).not.toHaveClass(/hidden/, { timeout: 8_000 });

    await ctx1.close();
    await ctx2.close();
});

test('happy path: two players start the game and reach PLAYING state', async ({ browser }) => {
    const ctx1 = await newTrackedContext(browser);
    const ctx2 = await newTrackedContext(browser);
    const host = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    // Catch any JS errors during the test
    const errors = [];
    host.on('pageerror', e => errors.push(e.message));

    await host.goto('/', { waitUntil: 'domcontentloaded' });
    await p2.goto('/', { waitUntil: 'domcontentloaded' });

    await rollLeader(host, 'AliceHost');
    await rollLeader(p2, 'BobGuest');

    // Wait for start button to be available on the host page
    await expect(host.locator('#start-game-btn')).not.toHaveClass(/hidden/, { timeout: 8_000 });
    // Force — the start button pulses and the lobby re-renders each broadcast.
    await host.click('#start-game-btn', { force: true });

    // After starting: game board visible, lobby hidden
    await expect(host.locator('#app-container')).not.toHaveClass(/hidden/, { timeout: 10_000 });
    await expect(host.locator('#lobby-modal')).toHaveClass(/hidden/);

    // Host is first player and gets 3 AP
    await expect(host.locator('#player-ap')).toHaveText('3', { timeout: 8_000 });

    expect(errors).toEqual([]);

    await ctx1.close();
    await ctx2.close();
});
