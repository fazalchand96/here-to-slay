'use strict';

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame, isWithinViewport, MOBILE_VIEWPORT, rollLeader } = require('./mobileSetup');
const { injectCard, addToDiscard, passChallenge, rollDice, passModifiers, passOpponentModifiers, trackContext } = require('../helpers/gameSetup');

// ---------------------------------------------------------------------------
// 1. Rotation lock: portrait shows overlay; rotating to landscape hides it
// ---------------------------------------------------------------------------
test('Rotation lock overlay appears in portrait and clears in landscape', async ({ browser }) => {
    const ctx = trackContext(await browser.newContext({
        viewport: { width: 390, height: 844 }, // portrait iPhone dimensions
        hasTouch: true,
        serviceWorkers: 'block',
    }));
    const page = await ctx.newPage();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);

    // Portrait: overlay must block the UI
    const overlayPortrait = await page.locator('#rotation-lock-overlay').evaluate(
        el => el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none',
    ).catch(() => false);
    expect(overlayPortrait, 'Rotation lock overlay should be visible in portrait').toBe(true);

    // Resize to landscape
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(400);

    // Landscape: overlay must be gone, lobby must be accessible
    const overlayLandscape = await page.locator('#rotation-lock-overlay').evaluate(
        el => el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none',
    ).catch(() => false);
    expect(overlayLandscape, 'Rotation lock overlay should be hidden in landscape').toBe(false);

    // Back in landscape the lobby must be accessible (the lobby element is #lobby-modal).
    await expect(page.locator('#lobby-modal')).toBeVisible({ timeout: 5_000 });
    await ctx.close();
});

// ---------------------------------------------------------------------------
// 2. Lobby renders on a mobile viewport
// ---------------------------------------------------------------------------
test('Lobby: name input, ROLL FOR LEADER, and leader assignment work on mobile', async ({ browser }) => {
    const ctx1 = trackContext(await browser.newContext({ viewport: MOBILE_VIEWPORT, hasTouch: true, serviceWorkers: 'block' }));
    const ctx2 = trackContext(await browser.newContext({ viewport: MOBILE_VIEWPORT, hasTouch: true, serviceWorkers: 'block' }));
    const host = await ctx1.newPage();
    const p2   = await ctx2.newPage();

    await host.goto('/', { waitUntil: 'domcontentloaded' });
    await p2.goto('/',   { waitUntil: 'domcontentloaded' });

    await rollLeader(host, 'MbLobbyHost');
    await rollLeader(p2,   'MbLobbyGuest');

    // After rolling, the name input should be gone (player is locked in)
    await expect(host.locator('#player-name-input')).toBeHidden({ timeout: 8_000 });

    // Start button should be visible for the host
    await expect(host.locator('#start-game-btn')).not.toHaveClass(/hidden/, { timeout: 10_000 });

    await ctx1.close(); await ctx2.close();
});

// ---------------------------------------------------------------------------
// 3. Full game start on mobile — no JS errors, AP = 3
// ---------------------------------------------------------------------------
test('Game starts on mobile viewport with no JS errors and AP = 3', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));
    p2.on('pageerror',   e => errors.push(e.message));

    await host.waitForTimeout(500);

    await expect(host.locator('#player-ap')).toHaveText('3', { timeout: 8_000 });
    expect(errors, `JS errors: ${errors.join('; ')}`).toEqual([]);

    await ctx1.close(); await ctx2.close();
});

// ---------------------------------------------------------------------------
// 4. Inspector modal opens when a card is tapped
// (#inspector-panel does not exist in the HTML — the real inspector is #inspector-modal)
// ---------------------------------------------------------------------------
test('Tapping a hand card opens the inspector modal on mobile', async ({ browser }) => {
    const errors = [];
    const { host, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await host.locator('#player-hand .card').first().tap();

    // #inspector-modal is the actual card inspector — it must become visible
    await expect(host.locator('#inspector-modal')).not.toHaveClass(/hidden/, { timeout: 8_000 });

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});

// ---------------------------------------------------------------------------
// 5. All 5 hand cards are present in the DOM (hand not clipped/removed)
// ---------------------------------------------------------------------------
test('All 5 starting hand cards are present in the DOM on mobile', async ({ browser }) => {
    const { host, ctx1, ctx2 } = await startMobileGame(browser);

    await expect(host.locator('#player-hand .card')).toHaveCount(5, { timeout: 8_000 });

    await ctx1.close(); await ctx2.close();
});

// ---------------------------------------------------------------------------
// 6. Challenge modal buttons are within the mobile viewport
// ---------------------------------------------------------------------------
test('Challenge modal pass/play buttons are within viewport on mobile', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Inject a hero for host and play it — this triggers the challenge phase for p2
    await injectCard(host, 'card_030'); // Peanut
    await host.evaluate(() => window._socket.emit('playCard', { cardId: 'card_030', isFree: false }));
    await host.waitForTimeout(400);

    // Wait for challenge modal on p2
    await expect(p2.locator('#challenge-modal')).not.toHaveClass(/hidden/, { timeout: 10_000 });

    // Verify the pass button is within viewport bounds
    const passBtn = p2.locator('#challenge-pass-btn');
    await expect(passBtn).toBeVisible({ timeout: 5_000 });
    const fits = await isWithinViewport(passBtn);
    expect(fits, '#challenge-pass-btn must be within 844×390 viewport').toBe(true);

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});

// ---------------------------------------------------------------------------
// 7. Dice overlay roll button is within viewport on mobile
// ---------------------------------------------------------------------------
test('Dice overlay roll button is within viewport on mobile', async ({ browser }) => {
    const errors = [];
    const { host, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Every monster needs >=1 hero to attack — inject a full class spread first.
    for (const heroId of ['card_016', 'card_024', 'card_032', 'card_040', 'card_048', 'card_056']) {
        await host.evaluate((id) => window._socket.emit('debug_inject_to_party', { cardId: id }), heroId);
    }
    await host.waitForTimeout(300);

    // Attack first monster via socket (costs 2 AP; game starts with 3)
    const activeId = await host.evaluate(() => {
        const gs = window.latestGameState;
        return gs && gs.activeMonsters && gs.activeMonsters[0] ? gs.activeMonsters[0].id : null;
    });
    expect(activeId, 'Should have at least one active monster').toBeTruthy();

    await host.evaluate((id) => window._socket.emit('attackMonster', id), activeId);
    await host.waitForTimeout(400);

    await expect(host.locator('#dice-overlay')).not.toHaveClass(/hidden/, { timeout: 8_000 });

    const rollBtn = host.locator('#manual-roll-btn');
    await expect(rollBtn).toBeVisible({ timeout: 5_000 });
    const fits = await isWithinViewport(rollBtn);
    expect(fits, '#manual-roll-btn must be within 844×390 viewport').toBe(true);

    // Actually click roll — should not crash
    await rollBtn.tap();
    await host.waitForTimeout(400);

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});

// ---------------------------------------------------------------------------
// 8. Board modal shows 3 monsters on mobile
// ---------------------------------------------------------------------------
test('Board modal shows 3 monsters on mobile viewport', async ({ browser }) => {
    const errors = [];
    const { host, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await host.locator('#view-board-btn').tap();
    await expect(host.locator('#active-monsters .card')).toHaveCount(3, { timeout: 8_000 });

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});

// ---------------------------------------------------------------------------
// 9. Action bar buttons (DRAW, END, BOARD) are all within the mobile viewport
// ---------------------------------------------------------------------------
test('Action bar buttons are all within the 844×390 mobile viewport', async ({ browser }) => {
    const { host, ctx1, ctx2 } = await startMobileGame(browser);

    for (const id of ['#view-board-btn', '#draw-card-btn', '#end-turn-btn']) {
        const fits = await isWithinViewport(host.locator(id));
        expect(fits, `${id} must be within viewport on mobile`).toBe(true);
    }

    await ctx1.close(); await ctx2.close();
});

// ---------------------------------------------------------------------------
// 10. Inspector close button is tappable and dismisses the modal
// ---------------------------------------------------------------------------
test('Inspector close button dismisses the modal on mobile', async ({ browser }) => {
    const errors = [];
    const { host, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Open inspector by tapping a card
    await host.locator('#player-hand .card').first().tap();
    await expect(host.locator('#inspector-modal')).not.toHaveClass(/hidden/, { timeout: 8_000 });

    // Verify close button is within viewport
    const closeBtn = host.locator('#inspector-close-btn');
    await expect(closeBtn).toBeVisible({ timeout: 5_000 });
    const fits = await isWithinViewport(closeBtn);
    expect(fits, '#inspector-close-btn must be within 844×390 viewport').toBe(true);

    // Tap it — modal should close
    await closeBtn.tap();
    await expect(host.locator('#inspector-modal')).toHaveClass(/hidden/, { timeout: 5_000 });

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});

// ---------------------------------------------------------------------------
// 11. Full play-card flow on mobile (tap → inspect → Play → challenge → result)
// ---------------------------------------------------------------------------
test('Full play-card flow completes on mobile without errors', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));
    p2.on('pageerror',   e => errors.push(e.message));

    const before = await host.locator('#player-hand .card').count();

    // Inject Peanut (draw 2 — simple, no targeting)
    await injectCard(host, 'card_030');

    // Tap the card in hand to open inspector
    await host.locator('#player-hand [data-id="card_030"]').tap();
    await expect(host.locator('#inspector-modal')).not.toHaveClass(/hidden/, { timeout: 8_000 });

    // Tap the Play button inside the inspector
    await host.locator('#inspector-modal-actions button').filter({ hasText: /Play/i }).first().tap();

    // p2 passes the challenge via socket
    await passChallenge(p2);

    // Host rolls dice
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);

    await host.waitForTimeout(500);

    // Hand should have grown (Peanut draws 2 cards)
    const after = await host.locator('#player-hand .card').count();
    expect(after, 'Hand should grow after Peanut resolves').toBeGreaterThan(before);
    expect(errors, `JS errors: ${errors.join('; ')}`).toEqual([]);

    await ctx1.close(); await ctx2.close();
});

// ---------------------------------------------------------------------------
// 12. End-turn button works on mobile
// ---------------------------------------------------------------------------
test('End-turn button advances the game on mobile', async ({ browser }) => {
    const errors = [];
    const { host, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Exhaust all 3 AP by drawing 3 times
    await host.locator('#draw-card-btn').tap();
    await host.locator('#draw-card-btn').tap();
    await host.locator('#draw-card-btn').tap();
    await expect(host.locator('#player-ap')).toHaveText('0', { timeout: 8_000 });

    // End-turn button must now be enabled and within viewport
    const endBtn = host.locator('#end-turn-btn');
    await expect(endBtn).not.toBeDisabled({ timeout: 5_000 });
    const fits = await isWithinViewport(endBtn);
    expect(fits, '#end-turn-btn must be within 844×390 viewport').toBe(true);

    // Tap it — the game advances (our turn ends, then eventually comes back)
    await endBtn.tap();
    // After ending turn, the waiting overlay or p2's turn is active — no crash
    await host.waitForTimeout(800);

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});

// ---------------------------------------------------------------------------
// 13. Discard-search modal fits within the mobile viewport
// ---------------------------------------------------------------------------
test('Discard-search modal fits within mobile viewport', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Plant a card in discard so Guiding Light has something to retrieve
    await addToDiscard(host, 'card_030');

    // Inject and play Guiding Light (card_033) — its skill opens the discard search modal
    await injectCard(host, 'card_033');
    await host.locator('#player-hand [data-id="card_033"]').tap();
    await expect(host.locator('#inspector-modal')).not.toHaveClass(/hidden/, { timeout: 8_000 });
    await host.locator('#inspector-modal-actions button').filter({ hasText: /Play|Use Skill/i }).first().tap();

    await passChallenge(p2);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);

    await host.waitForTimeout(500);

    // Discard search modal should appear
    await expect(host.locator('#discard-search-modal')).not.toHaveClass(/hidden/, { timeout: 8_000 });

    // Verify the modal itself fits in viewport (top + height <= 390)
    const modalBox = await host.locator('#discard-search-modal .glass-panel').boundingBox();
    if (modalBox) {
        expect(
            modalBox.y + modalBox.height,
            'Discard-search modal must not overflow the 390px viewport height',
        ).toBeLessThanOrEqual(MOBILE_VIEWPORT.height + 2); // 2px tolerance for rounding
    }

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});

// ---------------------------------------------------------------------------
// 14. Discard-pile viewer: tap the pile to browse all discarded cards
// ---------------------------------------------------------------------------
test('Discard-pile viewer opens and lists all discarded cards on mobile', async ({ browser }) => {
    const errors = [];
    const { host, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Plant two cards in the discard pile so it is non-empty and tappable.
    await addToDiscard(host, 'card_030');
    await addToDiscard(host, 'card_016');

    // The discard pile lives inside the board modal — open it first.
    await host.locator('#view-board-btn').tap();
    await expect(host.locator('#board-modal')).not.toHaveClass(/hidden/, { timeout: 5_000 });

    // Tap the discard pile to open the read-only viewer. Force — the visible card
    // inside has pointer-events:none, so a normal tap's hit-test is ambiguous.
    await host.locator('#discard-pile').tap({ force: true });
    await expect(host.locator('#discard-viewer-modal')).not.toHaveClass(/hidden/, { timeout: 5_000 });
    await expect(host.locator('#discard-viewer-content .card')).toHaveCount(2, { timeout: 5_000 });

    // Close it (the Close buttons are wired to closeDiscardViewer).
    await host.evaluate(() => window.closeDiscardViewer());
    await expect(host.locator('#discard-viewer-modal')).toHaveClass(/hidden/, { timeout: 5_000 });

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
