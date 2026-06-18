'use strict';

const { test, expect } = require('../helpers/fixtures');
const { startGame, injectCard } = require('../helpers/gameSetup');

// Challenge cards are played by OPPONENTS during the WAITING_FOR_CHALLENGES phase.
// Pattern: host plays any hero card → challenge modal appears on p2 → p2 plays a challenge card.

test('Challenge card: p2 can challenge a hero play, triggering a roll-off', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));
    p2.on('pageerror', e => errors.push(e.message));

    // Give p2 a challenge card
    await injectCard(p2, 'card_117'); // Challenge card

    // Host plays a hero card (Peanut — simple, no targeting)
    await injectCard(host, 'card_030');
    await host.locator(`#player-hand [data-id="card_030"]`).first().click();
    await expect(host.locator('#inspector-modal')).toBeVisible({ timeout: 5_000 });
    await host.locator('#inspector-modal-actions button').filter({ hasText: /Play/i }).first().click();

    // p2's challenge modal should appear
    await expect(p2.locator('#challenge-modal')).not.toHaveClass(/hidden/, { timeout: 10_000 });

    // p2 plays the challenge card
    await p2.evaluate(() => {
        const gs = window.latestGameState;
        const myId = window.myId;
        const myHand = gs && gs.players && gs.players[myId] ? gs.players[myId].hand : [];
        const challenge = myHand.find(c => c.type === 'Challenge Card');
        if (challenge) window._socket.emit('play_challenge', challenge.id);
    });

    await host.waitForTimeout(600);

    // A roll-off should begin — dice overlay appears for both
    const diceVisible = await host.locator('#dice-overlay').evaluate(
        el => !el.classList.contains('hidden'),
    ).catch(() => false);

    // OR the challenge was resolved and we're back to PLAYING
    const backToPlaying = await host.evaluate(() => {
        return window.latestGameState && window.latestGameState.state === 'PLAYING';
    }).catch(() => false);

    expect(diceVisible || backToPlaying, 'Expected dice overlay or resolution').toBe(true);
    expect(errors).toEqual([]);

    await ctx1.close(); await ctx2.close();
});

test('Challenge card: p2 passes, hero resolves normally', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await injectCard(host, 'card_030');
    await host.locator(`#player-hand [data-id="card_030"]`).first().click();
    await expect(host.locator('#inspector-modal')).toBeVisible({ timeout: 5_000 });
    await host.locator('#inspector-modal-actions button').filter({ hasText: /Play/i }).first().click();

    await expect(p2.locator('#challenge-modal')).not.toHaveClass(/hidden/, { timeout: 10_000 });
    await p2.evaluate(() => window._socket.emit('pass_challenge'));
    await host.waitForTimeout(800);

    // After a passed challenge, the hero resolves into the party and the server
    // prompts to use its skill (PROMPT_SKILL_ROLL); PLAYING/WAITING_TO_ROLL are the
    // other acceptable resolutions.
    const backToPlaying = await host.evaluate(() => {
        const s = window.latestGameState;
        return s && (s.state === 'PLAYING' || s.state === 'WAITING_TO_ROLL' || s.state === 'PROMPT_SKILL_ROLL');
    }).catch(() => false);
    expect(backToPlaying).toBe(true);
    expect(errors).toEqual([]);

    await ctx1.close(); await ctx2.close();
});
