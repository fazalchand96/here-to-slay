'use strict';

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('./mobileSetup');
const { setHand, passModifiers, passOpponentModifiers } = require('../helpers/gameSetup');

test.setTimeout(90_000);

const PHONE_VIEWPORTS = [
    { name: 'small-samsung', width: 740, height: 360 },
    { name: 'iphone-pro', width: 874, height: 402 },
    { name: 'large-samsung', width: 915, height: 412 },
    { name: 'iphone-pro-max', width: 956, height: 440 },
];

async function usePartyHeroSkill(page, heroId) {
    await expect.poll(() => page.evaluate((id) => {
        const me = window.latestGameState?.players?.[window.myId];
        return Boolean(me?.party?.some(card => card.id === id));
    }, heroId)).toBe(true);
    await page.evaluate((id) => {
        window._socket.emit('debug_force_next_roll', { roll1: 6, roll2: 6 });
        window._socket.emit('use_hero_skill', { cardId: id, isFree: false });
    }, heroId);
    await expect.poll(() => page.evaluate(() => window.latestGameState.state)).toBe('WAITING_TO_ROLL');
    await page.evaluate(() => window._socket.emit('execute_roll'));
}

for (const viewport of PHONE_VIEWPORTS) {
    test(`Quick Draw exposes only the exact newly drawn Item on ${viewport.name}`, async ({ browser }) => {
        const { host, p2, ctx1, ctx2 } = await startMobileGame(browser, viewport);
        await host.evaluate(() => window._socket.emit('debug_inject_to_party', { cardId: 'card_043' }));
        await setHand(host, ['card_064']); // older Item: must not be selectable
        await host.evaluate(() => {
            window._socket.emit('debug_stack_deck', { cardId: 'card_030' });
            window._socket.emit('debug_stack_deck', { cardId: 'card_065' }); // newly drawn Item
        });

        await usePartyHeroSkill(host, 'card_043');
        await expect.poll(() => host.evaluate(() => window.latestGameState.state)).toBe('WAITING_FOR_MODIFIERS');
        await passModifiers(host);
        await passOpponentModifiers(p2);
        await expect.poll(() => host.evaluate(() => window.latestGameState.state)).toBe('WAITING_FOR_HAND_SELECTION');

        await expect(host.locator('#player-hand [data-id="card_064"]')).not.toHaveClass(/valid-target/);
        await expect(host.locator('#player-hand [data-id="card_065"]')).toHaveClass(/valid-target/);

        await host.locator('#player-hand [data-id="card_064"]').click({ force: true });
        await expect(host.locator('#inspector-modal-actions button').filter({ hasText: /Play This Card/i })).toHaveCount(0);
        await host.evaluate(() => window.closeInspectorModal());

        await host.locator('#player-hand [data-id="card_065"]').click({ force: true });
        await expect(host.locator('#inspector-modal-actions button').filter({ hasText: /Play This Card/i })).toBeVisible();

        await ctx1.close();
        await ctx2.close();
    });
}

test('Dragalter choice replaces the dice overlay and accepts one tap', async ({ browser }) => {
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser, PHONE_VIEWPORTS[1]);
    await host.evaluate(() => window._socket.emit('debug_inject_to_party', { cardId: 'card_223' }));
    await setHand(host, ['card_079']);

    await usePartyHeroSkill(host, 'card_223');
    await expect.poll(() => host.evaluate(() => window.latestGameState.state)).toBe('WAITING_FOR_MODIFIERS');
    await passModifiers(host);
    await passOpponentModifiers(p2);
    await expect.poll(() => host.evaluate(() => window.latestGameState.state)).toBe('WAITING_FOR_DRAGALTER_CHOICE');

    await expect(host.locator('#dice-overlay')).toHaveClass(/hidden/);
    const choice = host.locator('#target-banner [data-decision-button]').first();
    await expect(choice).toBeVisible();
    await choice.click();
    await expect.poll(() => host.evaluate(() => window.latestGameState.state)).toBe('PLAYING');
    await expect(host.locator('body')).not.toHaveClass(/selection-submitting/);

    await ctx1.close();
    await ctx2.close();
});
