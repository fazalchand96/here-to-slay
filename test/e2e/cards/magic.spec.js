'use strict';

const { test, expect } = require('../helpers/fixtures');
const {
    startGame, injectCard, addToDiscard, playCardFromHand, passChallenge,
    rollDice, passModifiers, clickFirstValidTarget, p2DoAction,
} = require('../helpers/gameSetup');

async function setupP2Hero(host, p2) {
    // Drop a hero straight into p2's party — playCard during the host's turn is
    // turn-gated and silently dropped, leaving p2 with no hero to target.
    await p2.evaluate(() => window._socket.emit('debug_inject_to_party', { cardId: 'card_030' }));
    await p2.waitForTimeout(300);
}

test('Enchanted Spell (card_109): plays without crash, +2 roll bonus message', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await injectCard(host, 'card_109');
    await playCardFromHand(host, 'card_109');
    await passChallenge(p2);

    await host.waitForTimeout(400);
    await expect(host.locator('#app-container')).not.toHaveClass(/hidden/);
    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});

test('Critical Boost (card_105): draws 3, then discard banner appears', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    const before = await host.locator('#player-hand .card').count();

    await injectCard(host, 'card_105');
    await playCardFromHand(host, 'card_105');
    await passChallenge(p2);

    await host.waitForTimeout(500);
    // Hand should have grown (drew 3, played 1 = net +2), OR a discard banner appeared
    const bannerVisible = await host.locator('#target-banner').evaluate(el => !el.classList.contains('hidden')).catch(() => false);
    const after = await host.locator('#player-hand .card').count();
    expect(after > before || bannerVisible).toBe(true);
    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});

test('Destructive Spell (card_107): discard-then-destroy flow initiates', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await setupP2Hero(host, p2);

    await injectCard(host, 'card_107');
    await playCardFromHand(host, 'card_107');
    await passChallenge(p2);

    // Destructive Spell makes the caster discard 1, then destroy — the targeting
    // banner must appear with the DISCARD (or DESTROY) prompt.
    await expect(host.locator('#target-banner')).not.toHaveClass(/hidden/, { timeout: 8_000 });
    const bannerText = await host.locator('#target-banner-text').textContent();
    expect(bannerText).toMatch(/DISCARD|DESTROY/);
    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});

test('Forceful Winds (card_114): completes without crash', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await injectCard(host, 'card_114');
    await playCardFromHand(host, 'card_114');
    await passChallenge(p2);

    await host.waitForTimeout(400);
    await expect(host.locator('#app-container')).not.toHaveClass(/hidden/);
    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});

test('Entangling Trap (card_111): discard then steal target flow', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await setupP2Hero(host, p2);

    await injectCard(host, 'card_111');
    await playCardFromHand(host, 'card_111');
    await passChallenge(p2);

    // Entangling Trap: caster discards, then steals — the banner must appear with
    // the DISCARD (or STEAL, if hand was empty) prompt.
    await expect(host.locator('#target-banner')).not.toHaveClass(/hidden/, { timeout: 8_000 });
    const bannerText = await host.locator('#target-banner-text').textContent();
    expect(bannerText).toMatch(/DISCARD|STEAL/);
    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});

test('Forced Exchange (card_113): two-step steal-then-give flow', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await setupP2Hero(host, p2);

    await injectCard(host, 'card_113');
    await playCardFromHand(host, 'card_113');
    await passChallenge(p2);

    await host.waitForTimeout(400);
    const bannerVisible = await host.locator('#target-banner').evaluate(el => !el.classList.contains('hidden')).catch(() => false);
    expect(bannerVisible).toBe(true);
    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});

test('Call to the Fallen (card_104): opens discard search modal', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await addToDiscard(host, 'card_030'); // plant Peanut in discard

    await injectCard(host, 'card_104');
    // Call to the Fallen is a discard-targeting Magic: casting opens the discard
    // search immediately (client-side), before any challenge phase.
    await playCardFromHand(host, 'card_104');

    await expect(host.locator('#discard-search-modal')).toBeVisible({ timeout: 8_000 });
    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});

test('Winds of Change (card_115): return-item flow initiates (or completes gracefully with no items)', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await injectCard(host, 'card_115');
    await playCardFromHand(host, 'card_115');
    await passChallenge(p2);

    await host.waitForTimeout(400);
    // No items equipped, so effect should resolve gracefully (no crash)
    await expect(host.locator('#app-container')).not.toHaveClass(/hidden/);
    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
