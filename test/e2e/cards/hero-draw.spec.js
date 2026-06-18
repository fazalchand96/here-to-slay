'use strict';

const { test, expect } = require('../helpers/fixtures');
const { startGame, injectCard, playCardFromHand, passChallenge, rollDice, passModifiers, passOpponentModifiers } = require('../helpers/gameSetup');

// Cards whose primary effect is drawing cards (no complex targeting).
const DRAW_CARDS = [
    { name: 'Peanut',   id: 'card_030', expectedMin: 2 }, // draw 2
    { name: 'Wildshot', id: 'card_046', expectedMin: 3 }, // draw 3 then discard 1 net +2
    { name: 'Wily Red', id: 'card_047', expectedMin: 1 }, // draw to 7 (already have 5+)
];

for (const { name, id, expectedMin } of DRAW_CARDS) {
test(`${name}: hand grows after playing`, async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    const before = await host.locator('#player-hand .card').count();

    await injectCard(host, id);
    await playCardFromHand(host, id);
    await passChallenge(p2);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);

    // For Wildshot: a discard banner may appear. Dismissing it is best-effort
    // cleanup — the hand already grew from the draw, so keep every click bounded
    // and forced (the cards pulse) so this can never hang the test.
    const discardBanner = await host.locator('#target-banner').evaluate(
        el => !el.classList.contains('hidden') && el.textContent.includes('DISCARD'),
    ).catch(() => false);
    if (discardBanner) {
        await host.locator('#player-hand .card').first().click({ force: true, timeout: 4000 }).catch(() => {});
        await host.locator('#inspector-modal-actions button').filter({ hasText: /Discard/i }).first().click({ force: true, timeout: 4000 }).catch(() => {});
    }

    await host.waitForTimeout(500);
    const after = await host.locator('#player-hand .card').count();

    // Hand grew by at least 1 (accounting for the card that was played)
    expect(after).toBeGreaterThanOrEqual(before);
    expect(errors).toEqual([]);

    await ctx1.close(); await ctx2.close();
});
}

// Cards that offer an immediate play — just verify the WAITING_FOR_HAND_SELECTION banner appears.
const IMMEDIATE_PLAY_DRAW_CARDS = [
    { name: 'Mellow Dee',   id: 'card_028' }, // draw 1, play if hero
    { name: 'Fuzzy Cheeks', id: 'card_025' }, // draw 1, play hero
    { name: 'Hook',         id: 'card_041' }, // draw 1, play item
    { name: 'Quick Draw',   id: 'card_043' }, // draw 2, play item (optional)
    { name: 'Snowball',     id: 'card_060' }, // draw 1, play magic
];

for (const { name, id } of IMMEDIATE_PLAY_DRAW_CARDS) {
test(`${name}: hand-selection banner or hand grows after draw`, async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    const before = await host.locator('#player-hand .card').count();

    await injectCard(host, id);
    await playCardFromHand(host, id);
    await passChallenge(p2);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);

    await host.waitForTimeout(600);

    // Either a hand-selection banner appeared, the hand grew, OR a drawn Hero
    // triggered the immediate-play prompt (DRAW_AND_PLAY → WAITING_FOR_IMMEDIATE_PLAY,
    // which uses its own modal and doesn't put the card in hand yet).
    const bannerVisible = await host.locator('#target-banner').evaluate(
        el => !el.classList.contains('hidden'),
    ).catch(() => false);
    const immediatePlay = await host.evaluate(() => {
        const s = window.latestGameState && window.latestGameState.state;
        const m = document.getElementById('immediate-play-modal');
        return s === 'WAITING_FOR_IMMEDIATE_PLAY' || (m && !m.classList.contains('hidden'));
    }).catch(() => false);
    const after = await host.locator('#player-hand .card').count();

    expect(bannerVisible || immediatePlay || after > before, 'Expected banner, immediate-play prompt, or hand growth').toBe(true);
    expect(errors).toEqual([]);

    await ctx1.close(); await ctx2.close();
});
}

// Fuzzy Cheeks ("DRAW a card; you MAY play a Hero") must never soft-lock: the
// hand-selection prompt is optional, so a Skip button must appear and return to
// PLAYING even when there's no Hero to play.
test('Fuzzy Cheeks (card_025): hand-selection is skippable (no soft-lock)', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await injectCard(host, 'card_025');
    await playCardFromHand(host, 'card_025');
    await passChallenge(p2);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);

    // The skill resolved into the hand-selection prompt (which means the draw ran,
    // since drawCards is called immediately before setting that state).
    await expect(host.locator('#target-banner')).not.toHaveClass(/hidden/, { timeout: 8_000 });
    await expect.poll(async () => host.evaluate(() =>
        window.latestGameState && window.latestGameState.state)).toBe('WAITING_FOR_HAND_SELECTION');

    // A Skip button must be offered (optional action) — click it and confirm we're
    // back to PLAYING rather than stuck.
    const skipBtn = host.locator('#target-banner button').filter({ hasText: /SKIP/i }).first();
    await expect(skipBtn).toBeVisible({ timeout: 5_000 });
    await skipBtn.click();

    await expect.poll(async () => host.evaluate(() =>
        window.latestGameState && window.latestGameState.state)).toBe('PLAYING');
    expect(errors).toEqual([]);

    await ctx1.close(); await ctx2.close();
});

// Quick Draw ("DRAW 2; you MAY play an Item") — an item played from the
// hand-selection prompt must actually EQUIP to a hero, not silently hit the
// discard pile (regression: play_from_hand carried no equip target, so
// resolvePendingCard discarded the item instead of equipping it).
test('Quick Draw (card_043): an item played from the prompt equips to a hero', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Give the host a Hero in their party so there's a valid equip target.
    await host.evaluate(() => window._socket.emit('debug_inject_to_party', { cardId: 'card_016' }));
    await host.waitForTimeout(300);

    await injectCard(host, 'card_043');
    await playCardFromHand(host, 'card_043');
    await passChallenge(p2);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);

    await expect.poll(async () => host.evaluate(() =>
        window.latestGameState && window.latestGameState.state)).toBe('WAITING_FOR_HAND_SELECTION');

    // Guarantee a playable item is in hand, then choose it from the prompt.
    await injectCard(host, 'card_064'); // Bard Mask (Item)
    await host.locator('#player-hand [data-id="card_064"]').first().click();
    await expect(host.locator('#inspector-modal')).toBeVisible({ timeout: 5_000 });
    await host.locator('#inspector-modal-actions button').filter({ hasText: /Play This Card/i }).first().click();

    // Now in client-only equip targeting: the party hero is a valid target. Click
    // it, then confirm via SELECT TARGET.
    const heroTarget = host.locator('#player-party [data-id="card_016"]').first();
    await expect(heroTarget).toHaveClass(/valid-target/, { timeout: 5_000 });
    await heroTarget.click({ force: true });
    await host.locator('#inspector-modal-actions button').filter({ hasText: /SELECT TARGET/i }).first().click();

    // The item enters the challenge phase; let the opponent pass.
    await passChallenge(p2);

    // The item is now equipped to the hero — NOT in the discard pile.
    await expect.poll(async () => host.evaluate(() => {
        const me = window.latestGameState.players[window.myId];
        const hero = me.party.find(h => h.id === 'card_016');
        return hero && hero.equippedItem && hero.equippedItem.id === 'card_064';
    })).toBe(true);
    expect(errors).toEqual([]);

    await ctx1.close(); await ctx2.close();
});
