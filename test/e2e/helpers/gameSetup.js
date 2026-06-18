'use strict';

// Shared fixtures and utilities for all card e2e tests.

const { expect } = require('@playwright/test');

// ---------------------------------------------------------------------------
// Boot helpers
// ---------------------------------------------------------------------------

async function rollLeader(page, name) {
    await page.fill('#player-name-input', name);
    await page.getByText('ROLL FOR LEADER').click();
    await expect(page.locator('#player-name-input')).toBeHidden({ timeout: 10_000 });
}

// Every context created for a test, so the auto-cleanup fixture can close them
// all on teardown — even when a test fails before its own ctx.close() runs. The
// server keeps one global gameState and adds each socket to playerOrder on
// connect, so a leaked context would make the next test's host wrong and cascade
// timeouts across the whole suite.
const _trackedContexts = [];

// Create a BrowserContext that the auto-cleanup fixture will close on teardown.
// Use this instead of browser.newContext() directly so a failing test can't leak
// sockets into the next one. Pass options to override (e.g. mobile viewport/touch).
async function newTrackedContext(browser, options = { serviceWorkers: 'block' }) {
    const ctx = await browser.newContext(options);
    _trackedContexts.push(ctx);
    return ctx;
}

// Register an already-created context for auto-cleanup (for tests that must build
// the context inline with special options, e.g. a portrait viewport).
function trackContext(ctx) {
    _trackedContexts.push(ctx);
    return ctx;
}

// Close (and forget) every context created during the current test. Safe to call
// even if the test already closed them — double close is swallowed.
async function closeTrackedContexts() {
    while (_trackedContexts.length) {
        const ctx = _trackedContexts.pop();
        await ctx.close().catch(() => {});
    }
    // Give the server a moment to process the disconnects and reset to a clean
    // LOBBY before the next test connects. Without this, a late disconnect can
    // fire after the next test's players have joined and wipe them mid-setup.
    await new Promise(r => setTimeout(r, 400));
}

// Start a full 2-player game. Returns { host, p2, ctx1, ctx2 }.
async function startGame(browser) {
    const ctx1 = await newTrackedContext(browser);
    const ctx2 = await newTrackedContext(browser);
    const host = await ctx1.newPage();
    const p2   = await ctx2.newPage();

    await host.goto('/', { waitUntil: 'domcontentloaded' });
    await p2.goto('/', { waitUntil: 'domcontentloaded' });

    await rollLeader(host, 'HostPlayer');
    await rollLeader(p2,   'GuestPlayer');

    await expect(host.locator('#start-game-btn')).not.toHaveClass(/hidden/, { timeout: 10_000 });
    // The start button has an infinite pulse animation + the lobby re-renders on each
    // socket broadcast, so it never satisfies the default "stable" actionability check.
    // We've already asserted it's visible/enabled above, so force the click.
    await host.click('#start-game-btn', { force: true });

    await expect(host.locator('#app-container')).not.toHaveClass(/hidden/, { timeout: 12_000 });
    await expect(p2.locator('#app-container')).not.toHaveClass(/hidden/,   { timeout: 12_000 });

    return { host, p2, ctx1, ctx2 };
}

// ---------------------------------------------------------------------------
// Card injection (uses the debug_inject_card / debug_add_to_discard handlers)
// ---------------------------------------------------------------------------

async function injectCard(page, cardId) {
    await page.evaluate((id) => window._socket.emit('debug_inject_card', { cardId: id }), cardId);
    await page.waitForTimeout(400);
}

async function addToDiscard(page, cardId) {
    await page.evaluate((id) => window._socket.emit('debug_add_to_discard', { cardId: id }), cardId);
    await page.waitForTimeout(300);
}

// ---------------------------------------------------------------------------
// UI actions
// ---------------------------------------------------------------------------

// Click a card in the player's hand, then click the Play/Cast/Use button in
// the inspector modal.
async function playCardFromHand(page, cardId) {
    // A hand can legitimately hold duplicates of the same card id, so scope to the first.
    await page.locator(`#player-hand [data-id="${cardId}"]`).first().click();
    await expect(page.locator('#inspector-modal')).toBeVisible({ timeout: 5_000 });
    const actionBtn = page.locator('#inspector-modal-actions button').filter({
        hasText: /Play|Cast|Use Skill/i,
    }).first();
    await actionBtn.click();
}

// Click the first highlighted valid-target on the board.
//
// Destroy/steal/exchange targets are opponent heroes, which the client only
// renders inside the #opponent-modal (the board just shows a collapsed
// "Click to view cards" chip per opponent). So if no valid-target is currently
// visible, open the first opponent's modal and click the target inside it.
async function clickFirstValidTarget(page) {
    // valid-target cards run an infinite scale-pulse animation, so they never
    // satisfy Playwright's "stable" actionability check — force the click once
    // we know the element exists/visible.
    // Clicking a valid-target card opens the inspector with a "SELECT TARGET"
    // button — that second click is what actually submits the target.
    const selectBtn = page.locator('#inspector-modal-actions button').filter({
        hasText: /SELECT TARGET/i,
    }).first();

    const visibleTarget = page.locator('.valid-target:visible').first();
    if (await visibleTarget.count() > 0) {
        await visibleTarget.click({ timeout: 8_000, force: true });
        await expect(selectBtn).toBeVisible({ timeout: 8_000 });
        await selectBtn.click();
        return;
    }

    // Opponent heroes (destroy/steal targets) only render inside the
    // #opponent-modal — the board shows a collapsed chip per opponent. The chip
    // keeps its normal openOpponentModal onclick during targeting, so clicking it
    // reveals the party.
    await page.locator('#opponents-bar .opponent-chip').first().click();
    await expect(page.locator('#opponent-modal')).not.toHaveClass(/hidden/, { timeout: 5_000 });
    const modalTarget = page.locator('#opponent-modal .valid-target').first();
    await expect(modalTarget).toBeVisible({ timeout: 8_000 });

    // The opponent modal re-renders on every server broadcast, which can drop a
    // click before the inspector opens. Retry the click until the SELECT TARGET
    // button actually appears.
    await expect(async () => {
        await modalTarget.click({ force: true });
        await expect(selectBtn).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    await selectBtn.click();
}

// ---------------------------------------------------------------------------
// Second-player socket shortcuts (avoids driving p2 through full UI)
// ---------------------------------------------------------------------------

async function p2DoAction(p2Page, event, data = {}) {
    await p2Page.evaluate(
        ([ev, d]) => window._socket.emit(ev, d),
        [event, data],
    );
    await p2Page.waitForTimeout(300);
}

async function passChallenge(p2Page) {
    // Wait for the challenge modal to appear for p2 first
    await expect(p2Page.locator('#challenge-modal')).not.toHaveClass(/hidden/, { timeout: 10_000 });
    await p2DoAction(p2Page, 'pass_challenge');
}

async function passModifiers(page) {
    await expect(page.locator('#dice-overlay')).not.toHaveClass(/hidden/, { timeout: 10_000 });
    await page.locator('#dice-pass-btn').click();
}

// Pass the opponent's modifier window. On a skill/attack roll every player gets
// the window, but the overlay can lag a broadcast — poll for it rather than a
// single-shot check (a missed pass makes the roll wait out the 15s modifier timer
// before resolving, which flakes downstream targeting). If it never appears, the
// roll already resolved, so just return.
async function passOpponentModifiers(p2Page) {
    try {
        await expect(p2Page.locator('#dice-overlay')).not.toHaveClass(/hidden/, { timeout: 6_000 });
    } catch {
        return;
    }
    await p2Page.locator('#dice-pass-btn').click().catch(() => {});
}

// Advance the active player into the roll for the action they just played.
//
// Two distinct flows exist:
//   - Hero skills: after the challenge passes the server emits `heroPlayedPrompt`
//     and the client shows #skill-prompt-modal. Clicking YES emits use_hero_skill
//     and the client AUTO-fires execute_roll — there is no manual roll button.
//   - Attacks / explicit rolls: the client shows #manual-roll-btn to click.
//
// We wait for whichever appears and drive it accordingly.
async function rollDice(page) {
    const prompt  = page.locator('#skill-prompt-modal');
    const rollBtn = page.locator('#manual-roll-btn');

    // Force the upcoming roll to 6+6=12 so skills that require a high roll succeed
    // deterministically (card-behavior tests shouldn't depend on dice luck).
    await page.evaluate(() => window._socket.emit('debug_force_next_roll', { roll1: 6, roll2: 6 }));

    await expect
        .poll(async () => (await prompt.isVisible()) || (await rollBtn.isVisible()), { timeout: 8_000 })
        .toBe(true);

    if (await prompt.isVisible()) {
        await page.locator('#skill-prompt-yes').click(); // triggers use_hero_skill + auto-roll
    } else {
        await rollBtn.click();
    }
}

// Full roll sequence: roll dice, pass modifiers for both pages.
async function completeRoll(hostPage, p2Page) {
    await rollDice(hostPage);
    await passModifiers(hostPage);
    // p2 may also be in the modifier window
    const p2DiceVisible = await p2Page.locator('#dice-overlay').evaluate(
        el => !el.classList.contains('hidden'),
    ).catch(() => false);
    if (p2DiceVisible) await passModifiers(p2Page);
}

// ---------------------------------------------------------------------------
// Ensure p2 has a hero in their party (needed for destroy/steal tests).
// Injects a hero for p2 then auto-plays it via socket (bypasses challenge).
// ---------------------------------------------------------------------------
async function ensureP2HasHero(p2Page, heroCardId = 'card_016') {
    await injectCard(p2Page, heroCardId);
    // Play it via socket directly (start_game_debug style — bypass challenge)
    await p2Page.evaluate((id) => {
        window._socket.emit('playCard', { cardId: id, isFree: false });
    }, heroCardId);
    await p2Page.waitForTimeout(400);
    // Pass the challenge so the hero resolves into party
    const hostChallengeVisible = await p2Page.evaluate(() => {
        const state = window.latestGameState;
        return state && state.state === 'WAITING_FOR_CHALLENGES';
    });
    if (hostChallengeVisible) {
        await p2DoAction(p2Page, 'pass_challenge');
    }
    await p2Page.waitForTimeout(400);
}

module.exports = {
    startGame,
    newTrackedContext,
    trackContext,
    closeTrackedContexts,
    injectCard,
    addToDiscard,
    playCardFromHand,
    clickFirstValidTarget,
    p2DoAction,
    passChallenge,
    passModifiers,
    passOpponentModifiers,
    rollDice,
    completeRoll,
    ensureP2HasHero,
};
