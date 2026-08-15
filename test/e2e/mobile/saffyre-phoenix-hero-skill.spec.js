'use strict';

// Saffyre Phoenix can activate when its owner loses a Hero during somebody
// else's turn. The free Hero must still receive the normal "use its effect?"
// question, and that non-active owner must be allowed to answer it.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');
const { injectCard } = require('../helpers/gameSetup');

const SAFFYRE_PHOENIX = 'card_215';
const DESTRUCTIVE_SPELL = 'card_107';
const LOST_HERO = 'card_031';
const FREE_HERO = 'card_030'; // Peanut: simple roll, no target selection

test('Saffyre Phoenix offers the free Hero effect outside its owner turn', async ({ browser }) => {
    const errors = [];
    const viewport = { width: 874, height: 402 };
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser, viewport);
    host.on('pageerror', error => errors.push(`host: ${error.message}`));
    p2.on('pageerror', error => errors.push(`p2: ${error.message}`));

    // Host is the active player. The opponent owns Saffyre Phoenix, has a Hero
    // that can be destroyed, and holds exactly one Hero for the immediate play.
    await p2.evaluate(({ monster, lostHero, freeHero }) => {
        window._socket.emit('debug_add_slain_monster', { cardId: monster });
        window._socket.emit('debug_inject_to_party', { cardId: lostHero });
        window._socket.emit('debug_set_hand', { cardIds: [freeHero] });
    }, { monster: SAFFYRE_PHOENIX, lostHero: LOST_HERO, freeHero: FREE_HERO });

    await expect.poll(() => p2.evaluate(() => ({
        active: window.latestGameState.activePlayerSocketId,
        me: window.myId,
        party: window.latestGameState.players[window.myId].party.map(card => card.id),
        hand: window.latestGameState.players[window.myId].hand.map(card => card.id)
    }))).toMatchObject({ party: [LOST_HERO], hand: [FREE_HERO] });
    await expect(p2.locator('#reward-toast')).toHaveClass(/hidden/, { timeout: 5_000 });

    // Destroy the opponent's Hero with a real card flow, including Challenge and
    // the required discard. That queues Saffyre Phoenix for the non-active p2.
    await injectCard(host, DESTRUCTIVE_SPELL);
    await host.evaluate(id => window._socket.emit('playCard', { cardId: id, isFree: false }), DESTRUCTIVE_SPELL);
    await p2.evaluate(() => window._socket.emit('pass_challenge'));

    await expect.poll(() => host.evaluate(() => window.latestGameState.pendingAction?.type)).toBe('DISCARD');
    await host.evaluate(() => {
        const card = window.latestGameState.players[window.myId].hand[0];
        window._socket.emit('target_selected', card.id);
    });
    await expect.poll(() => host.evaluate(() => window.latestGameState.pendingAction?.type)).toBe('DESTROY');
    await host.evaluate(id => window._socket.emit('target_selected', id), LOST_HERO);

    await expect.poll(() => p2.evaluate(() => ({
        state: window.latestGameState.state,
        chooser: window.latestGameState.pendingAction?.playerToChoose,
        me: window.myId
    }))).toMatchObject({ state: 'WAITING_FOR_HAND_SELECTION' });
    await expect(p2.locator('#monster-trigger-modal')).toBeVisible({ timeout: 2_000 });
    await p2.screenshot({
        path: 'output/browser-qa/monster-effect-v197-874x402.png'
    });

    // Choose the Saffyre Hero, then let the active player pass its Challenge.
    await p2.evaluate(id => window._socket.emit('play_from_hand', { cardId: id }), FREE_HERO);
    await expect.poll(() => host.evaluate(() => window.latestGameState.state)).toBe('WAITING_FOR_CHALLENGES');
    await host.evaluate(() => window._socket.emit('pass_challenge'));

    // The actual missing behavior: p2 receives a usable effect question even
    // though host remains the active turn player.
    const prompt = p2.locator('#skill-prompt-modal');
    await expect(prompt).toBeVisible({ timeout: 5_000 });
    await expect(prompt).toContainText(/Peanut/i);
    await expect(prompt).toContainText(/0 AP/i);
    expect(await p2.evaluate(() => window.latestGameState.pendingHeroSkillPrompt)).toMatchObject({
        cardId: FREE_HERO
    });

    await p2.screenshot({
        path: 'output/browser-qa/saffyre-phoenix-skill-prompt-v197-874x402.png'
    });

    const apBefore = await p2.evaluate(() => window.latestGameState.players[window.myId].ap);
    await p2.evaluate(() => window._socket.emit('debug_force_next_roll', { roll1: 6, roll2: 6 }));
    await prompt.locator('#skill-prompt-yes').click();
    await expect.poll(() => p2.evaluate(() => ({
        state: window.latestGameState.state,
        roller: window.latestGameState.pendingRoll?.rollerId,
        me: window.myId
    }))).toMatchObject({ roller: await p2.evaluate(() => window.myId) });
    expect(await p2.evaluate(() => window.latestGameState.players[window.myId].ap)).toBe(apBefore);

    // Finish Peanut's roll to prove the offered button is not cosmetic: the
    // out-of-turn Hero effect resolves and draws its two cards for p2.
    await expect.poll(() => p2.evaluate(() => window.latestGameState.state)).toBe('WAITING_FOR_MODIFIERS');
    await p2.evaluate(() => window._socket.emit('submit_modifier_action', { action: 'PASS' }));
    await host.evaluate(() => window._socket.emit('submit_modifier_action', { action: 'PASS' }));
    await expect.poll(() => p2.evaluate(() => ({
        state: window.latestGameState.state,
        handCount: window.latestGameState.players[window.myId].hand.length,
        active: window.latestGameState.activePlayerSocketId,
        me: window.myId
    }))).toMatchObject({ state: 'PLAYING', handCount: 2 });
    expect(await host.evaluate(() => window.latestGameState.activePlayerSocketId === window.myId)).toBe(true);

    expect(errors).toEqual([]);
    await ctx1.close();
    await ctx2.close();
});
