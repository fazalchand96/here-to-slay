'use strict';

const path = require('node:path');
const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('./mobileSetup');

const THIEF_LEADER = 'card_136';
const OPPONENT_CARD = 'card_001';
const LANDSCAPE_PHONES = [
    { name: 'small-samsung', width: 740, height: 360 },
    { name: 'iphone-pro', width: 874, height: 402 },
    { name: 'large-samsung', width: 915, height: 412 },
    { name: 'iphone-pro-max', width: 956, height: 440 },
];

for (const viewport of LANDSCAPE_PHONES) {
    test(`Thief Party Leader works on the first tap at ${viewport.name}`, async ({ browser }) => {
        const errors = [];
        const { host, p2, ctx1, ctx2 } = await startMobileGame(browser, viewport);
        host.on('pageerror', error => errors.push(error.message));

        const leaderSetup = await host.evaluate((cardId) => new Promise((resolve, reject) => {
            window._socket.timeout(4_000).emit('debug_set_leader', { cardId }, (error, response) => {
                if (error) reject(new Error('debug_set_leader timed out'));
                else resolve(response);
            });
        }), THIEF_LEADER);
        expect(leaderSetup).toEqual({ ok: true, leaderId: THIEF_LEADER });
        await expect.poll(() => host.evaluate(() => window.latestGameState.players[window.myId].leader?.id))
            .toBe(THIEF_LEADER);
        await p2.evaluate((cardId) => window._socket.emit('debug_set_hand', { cardIds: [cardId] }), OPPONENT_CARD);
        await expect.poll(() => p2.evaluate(() => window.latestGameState.players[window.myId].hand.length))
            .toBe(1);
        await expect(host.locator(`#leader-slot .card[data-id="${THIEF_LEADER}"]`)).toBeVisible({ timeout: 5_000 });

        const before = await host.evaluate(() => ({
            hand: window.latestGameState.players[window.myId].hand.length,
            ap: window.latestGameState.players[window.myId].ap,
        }));

        await host.locator(`#leader-slot .card[data-id="${THIEF_LEADER}"]`).tap();
        await expect(host.locator('#inspector-modal')).not.toHaveClass(/hidden/, { timeout: 1_500 });
        const skillButton = host.getByRole('button', { name: 'Use Thief Leader Skill (1 AP)' });
        await expect(skillButton).toBeVisible();
        await skillButton.tap();

        await expect.poll(() => host.evaluate(() => window.latestGameState.players[window.myId].hand.length))
            .toBe(before.hand + 1);
        await expect.poll(() => p2.evaluate(() => window.latestGameState.players[window.myId].hand.length))
            .toBe(0);
        const after = await host.evaluate(() => ({
            ap: window.latestGameState.players[window.myId].ap,
            used: window.latestGameState.players[window.myId].usedLeaderSkillThisTurn,
        }));
        expect(after.ap).toBe(before.ap - 1);
        expect(after.used).toBe(true);
        if (viewport.name === 'iphone-pro') {
            await expect(host.locator('#monster-trigger-modal')).toBeVisible({ timeout: 2_000 });
            await host.screenshot({
                path: path.join(process.cwd(), 'output', 'browser-qa', 'party-leader-effect-v197-874x402.png'),
            });
        }
        expect(errors).toEqual([]);

        await ctx1.close();
        await ctx2.close();
    });
}
