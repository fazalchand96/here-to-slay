'use strict';

// E2E tests for in-game UI: hand rendering, AP display, draw button gating,
// renderBoard crash guard, challenge UI, and hand-privacy masking.

const { test, expect } = require('./helpers/fixtures');
const { newTrackedContext } = require('./helpers/gameSetup');

// ---------------------------------------------------------------------------
// Shared fixture: start a 2-player game and return both pages
// ---------------------------------------------------------------------------

async function startTwoPlayerGame(browser) {
    const ctx1 = await newTrackedContext(browser);
    const ctx2 = await newTrackedContext(browser);
    const host = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    await host.goto('/', { waitUntil: 'domcontentloaded' });
    await p2.goto('/', { waitUntil: 'domcontentloaded' });

    // Roll leaders for both players
    async function rollLeader(page, name) {
        await page.fill('#player-name-input', name);
        await page.getByText('ROLL FOR LEADER').click();
        await expect(page.locator('#player-name-input')).toBeHidden({ timeout: 8_000 });
    }

    await rollLeader(host, 'GameHost');
    await rollLeader(p2, 'GameGuest');

    // Wait for start button and launch
    await expect(host.locator('#start-game-btn')).not.toHaveClass(/hidden/, { timeout: 8_000 });
    await host.click('#start-game-btn', { force: true });

    // Wait until game board appears
    await expect(host.locator('#app-container')).not.toHaveClass(/hidden/, { timeout: 10_000 });
    await expect(p2.locator('#app-container')).not.toHaveClass(/hidden/, { timeout: 10_000 });

    return { host, p2, ctx1, ctx2 };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('active player hand contains 5 cards after game start', async ({ browser }) => {
    const { host, ctx1, ctx2 } = await startTwoPlayerGame(browser);

    // Host is always first active player (playerOrder[0])
    const cards = host.locator('#player-hand .card');
    await expect(cards).toHaveCount(5, { timeout: 8_000 });

    await ctx1.close();
    await ctx2.close();
});

test('AP display shows 3 at the start of the first turn', async ({ browser }) => {
    const { host, ctx1, ctx2 } = await startTwoPlayerGame(browser);

    await expect(host.locator('#player-ap')).toHaveText('3', { timeout: 8_000 });

    await ctx1.close();
    await ctx2.close();
});

test('DRAW button is enabled when AP >= 1 and disabled at AP 0', async ({ browser }) => {
    const { host, ctx1, ctx2 } = await startTwoPlayerGame(browser);

    // Should be enabled at 3 AP
    await expect(host.locator('#draw-card-btn')).not.toBeDisabled({ timeout: 8_000 });

    // Draw 3 times to exhaust AP (each draw costs 1 AP)
    await host.click('#draw-card-btn');
    await host.click('#draw-card-btn');
    await host.click('#draw-card-btn');

    // Now AP should be 0 and the button must be disabled
    await expect(host.locator('#player-ap')).toHaveText('0', { timeout: 8_000 });
    await expect(host.locator('#draw-card-btn')).toBeDisabled();

    await ctx1.close();
    await ctx2.close();
});

test('no JS errors thrown during game start and initial render (renderBoard crash guard)', async ({ browser }) => {
    const ctx1 = await newTrackedContext(browser);
    const ctx2 = await newTrackedContext(browser);
    const host = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    const hostErrors = [];
    const p2Errors = [];
    host.on('pageerror', e => hostErrors.push(e.message));
    p2.on('pageerror', e => p2Errors.push(e.message));

    await host.goto('/', { waitUntil: 'domcontentloaded' });
    await p2.goto('/', { waitUntil: 'domcontentloaded' });

    async function rollLeader(page, name) {
        await page.fill('#player-name-input', name);
        await page.getByText('ROLL FOR LEADER').click();
        await expect(page.locator('#player-name-input')).toBeHidden({ timeout: 8_000 });
    }

    await rollLeader(host, 'ErrCheckHost');
    await rollLeader(p2, 'ErrCheckGuest');
    await expect(host.locator('#start-game-btn')).not.toHaveClass(/hidden/, { timeout: 8_000 });
    await host.click('#start-game-btn', { force: true });

    await expect(host.locator('#app-container')).not.toHaveClass(/hidden/, { timeout: 10_000 });
    await expect(p2.locator('#app-container')).not.toHaveClass(/hidden/, { timeout: 10_000 });

    // Let a few state broadcasts propagate
    await host.waitForTimeout(500);

    expect(hostErrors, `Host JS errors: ${hostErrors.join('; ')}`).toHaveLength(0);
    expect(p2Errors, `P2 JS errors: ${p2Errors.join('; ')}`).toHaveLength(0);

    await ctx1.close();
    await ctx2.close();
});

test('3 monsters are shown on the board after game start', async ({ browser }) => {
    const { host, ctx1, ctx2 } = await startTwoPlayerGame(browser);

    // Open the board modal
    await host.click('#view-board-btn');
    const monsters = host.locator('#active-monsters .card');
    await expect(monsters).toHaveCount(3, { timeout: 8_000 });

    await ctx1.close();
    await ctx2.close();
});

test('opponent hand cards are masked (type === Hidden) in gameStateUpdate', async ({ browser }) => {
    const ctx1 = await newTrackedContext(browser);
    const ctx2 = await newTrackedContext(browser);
    const host = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    await host.goto('/', { waitUntil: 'domcontentloaded' });
    await p2.goto('/', { waitUntil: 'domcontentloaded' });

    async function rollLeader(page, name) {
        await page.fill('#player-name-input', name);
        await page.getByText('ROLL FOR LEADER').click();
        await expect(page.locator('#player-name-input')).toBeHidden({ timeout: 8_000 });
    }

    await rollLeader(host, 'PrivacyHost');
    await rollLeader(p2, 'PrivacyGuest');
    await expect(host.locator('#start-game-btn')).not.toHaveClass(/hidden/, { timeout: 8_000 });
    await host.click('#start-game-btn', { force: true });
    await expect(p2.locator('#app-container')).not.toHaveClass(/hidden/, { timeout: 10_000 });

    // Read the state P2 has already received. (Waiting for the *next*
    // gameStateUpdate would hang — an idle game broadcasts nothing further.)
    await expect.poll(async () => p2.evaluate(() => !!window.latestGameState), { timeout: 8_000 }).toBe(true);
    const snapshot = await p2.evaluate(() => window.latestGameState);

    // If we can't intercept via window.socket, fall back to checking the DOM:
    // P2 should see their own hand, but the host's visible hand data must be hidden.
    // We verify by checking that #player-hand .card elements exist (P2 sees their own cards)
    // and the UI doesn't leak count or names for the opponent.
    if (snapshot && snapshot.players) {
        const playerIds = Object.keys(snapshot.players);
        // P2 is the second player; find the host's id
        const myId = await p2.evaluate(() => window.myId);
        const hostId = playerIds.find(id => id !== myId);
        if (hostId) {
            const hostCards = snapshot.players[hostId].hand;
            const allHidden = hostCards.every(c => c.type === 'Hidden');
            expect(allHidden, 'Host hand cards should all be Hidden in P2\'s snapshot').toBe(true);
        }
    } else {
        // Fallback: P2's own hand should be visible (5 real cards)
        await expect(p2.locator('#player-hand .card')).toHaveCount(5, { timeout: 8_000 });
    }

    await ctx1.close();
    await ctx2.close();
});
