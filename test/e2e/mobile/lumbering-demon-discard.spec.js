'use strict';

const path = require('node:path');
const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('./mobileSetup');

const LUMBERING_DEMON = 'card_212';
const OLD_HAND_CARD = 'card_016';
const DRAWN_ONE = 'card_017';
const DRAWN_TWO = 'card_018';

test('Lumbering Demon lets mobile players discard only one of the two new cards', async ({ browser }) => {
    const viewport = { width: 874, height: 402 };
    const errors = [];
    const { host, ctx1, ctx2 } = await startMobileGame(browser, viewport);
    host.on('pageerror', error => errors.push(error.message));

    await host.evaluate(({ monster, oldCard, first, second }) => {
        window._socket.emit('debug_add_slain_monster', { cardId: monster });
        window._socket.emit('debug_set_hand', { cardIds: [oldCard] });
        window._socket.emit('debug_stack_deck', { cardId: first });
        window._socket.emit('debug_stack_deck', { cardId: second });
    }, { monster: LUMBERING_DEMON, oldCard: OLD_HAND_CARD, first: DRAWN_ONE, second: DRAWN_TWO });
    await expect.poll(() => host.evaluate(() => window.latestGameState.players[window.myId].hand.map(card => card.id)))
        .toEqual([OLD_HAND_CARD]);

    await host.evaluate(() => window._socket.emit('draw_card_action'));
    await expect.poll(() => host.evaluate(() => window.latestGameState.state))
        .toBe('WAITING_FOR_LUMBERING_DEMON_CHOICE');
    await host.getByRole('button', { name: 'USE EFFECT' }).tap();
    await expect.poll(() => host.evaluate(() => window.latestGameState.state))
        .toBe('WAITING_FOR_DISCARD_PENALTY');

    const pending = await host.evaluate(() => window.latestGameState.pendingAction);
    expect(pending.type).toBe('LUMBERING_DEMON_DISCARD');
    expect(new Set(pending.allowedCardIds)).toEqual(new Set([DRAWN_ONE, DRAWN_TWO]));
    await expect(host.locator(`#player-hand .card[data-id="${OLD_HAND_CARD}"]`)).not.toHaveClass(/valid-target/);
    await expect(host.locator(`#player-hand .card[data-id="${DRAWN_ONE}"]`)).toHaveClass(/valid-target/);
    await expect(host.locator(`#player-hand .card[data-id="${DRAWN_TWO}"]`)).toHaveClass(/valid-target/);

    await host.evaluate((cardId) => window._socket.emit('submit_penalty_discard', { cardIds: [cardId] }), OLD_HAND_CARD);
    await host.waitForTimeout(300);
    expect(await host.evaluate(() => window.latestGameState.state)).toBe('WAITING_FOR_DISCARD_PENALTY');
    expect(await host.evaluate((id) => window.latestGameState.players[window.myId].hand.some(card => card.id === id), OLD_HAND_CARD)).toBe(true);

    await expect(host.locator('#monster-trigger-modal')).not.toBeAttached({ timeout: 8_000 });
    await expect(host.locator('#reward-toast')).toHaveClass(/hidden/, { timeout: 7_000 });
    await host.screenshot({
        path: path.join(process.cwd(), 'output', 'browser-qa', 'lumbering-demon-v197-874x402.png'),
    });
    await host.locator(`#player-hand .card[data-id="${DRAWN_ONE}"]`).tap({ force: true });
    await host.getByRole('button', { name: 'CONFIRM DISCARD' }).tap({ force: true });
    await expect.poll(() => host.evaluate(() => window.latestGameState.state)).toBe('PLAYING');
    expect(await host.evaluate((id) => window.latestGameState.players[window.myId].hand.some(card => card.id === id), OLD_HAND_CARD)).toBe(true);
    expect(await host.evaluate((id) => window.latestGameState.players[window.myId].hand.some(card => card.id === id), DRAWN_ONE)).toBe(false);
    expect(await host.evaluate((id) => window.latestGameState.players[window.myId].hand.some(card => card.id === id), DRAWN_TWO)).toBe(true);
    expect(errors).toEqual([]);

    await ctx1.close();
    await ctx2.close();
});
