'use strict';

const { test, expect } = require('../helpers/fixtures');
const {
    startGame, injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers, p2DoAction,
} = require('../helpers/gameSetup');

test('Spooky (card_061): all-sacrifice modal appears on p2', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Give p2 a hero so Spooky has a valid sacrifice target. Drop it straight
    // into p2's party — playCard during the host's turn is turn-gated and silently
    // dropped, so p2 would otherwise have no hero to sacrifice.
    await p2.evaluate(() => window._socket.emit('debug_inject_to_party', { cardId: 'card_030' }));
    await p2.waitForTimeout(300);

    await injectCard(host, 'card_061');
    await playCardFromHand(host, 'card_061');
    await passChallenge(p2);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);

    // p2 should see a sacrifice/global-action modal
    await expect(p2.locator('#mandatory-discard-modal')).toBeVisible({ timeout: 8_000 });
    expect(errors).toEqual([]);

    await ctx1.close(); await ctx2.close();
});

test('Greedy Cheeks (card_026): p2 sees give-card prompt', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await injectCard(host, 'card_026');
    await playCardFromHand(host, 'card_026');
    await passChallenge(p2);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);

    // p2 should see the mandatory give-card modal
    await expect(p2.locator('#mandatory-discard-modal')).toBeVisible({ timeout: 8_000 });
    expect(errors).toEqual([]);

    await ctx1.close(); await ctx2.close();
});

test('Beary Wise (card_018): p2 sees discard-to-pool prompt', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await injectCard(host, 'card_018');
    await playCardFromHand(host, 'card_018');
    await passChallenge(p2);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);

    await expect(p2.locator('#mandatory-discard-modal')).toBeVisible({ timeout: 8_000 });
    expect(errors).toEqual([]);

    await ctx1.close(); await ctx2.close();
});

test('Tough Teddy (card_023): completes without crash (triggers only if p2 has Fighter)', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await injectCard(host, 'card_023');
    await playCardFromHand(host, 'card_023');
    await passChallenge(p2);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);

    await host.waitForTimeout(500);
    await expect(host.locator('#app-container')).not.toHaveClass(/hidden/);
    expect(errors).toEqual([]);

    await ctx1.close(); await ctx2.close();
});
