'use strict';

// Sealing Key (card_077, CURSE_KEY) — "Equipped Hero card cannot use its effect."
// Equip it on a hero, then confirm that hero's skill can't be used: no roll
// starts, no AP is spent, and the inspector shows a disabled "Sealed" button.
// Mobile viewport + screenshot.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');
const { injectCard } = require('../helpers/gameSetup');

const HERO = 'card_039';        // Wise Shield (has a skill)
const SEALING_KEY = 'card_077'; // CURSE_KEY

test('Sealing Key: the equipped hero cannot use its skill', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await host.evaluate((id) => window._socket.emit('debug_inject_to_party', { cardId: id }), HERO);
    await host.waitForTimeout(300);

    // Equip the Sealing Key onto that hero (item-play flow), opponent passes.
    await injectCard(host, SEALING_KEY);
    await host.evaluate((a) => {
        window._socket.emit('play_item_action', {
            itemCardId: a.k, targetPlayerId: window.myId, targetHeroId: a.h, isFree: false,
        });
    }, { k: SEALING_KEY, h: HERO });
    await host.waitForTimeout(400);
    await p2.evaluate(() => window._socket.emit('pass_challenge')).catch(() => {});
    await host.waitForTimeout(500);

    expect(await host.evaluate((id) => {
        const h = window.latestGameState.players[window.myId].party.find(c => c.id === id);
        return h && h.equippedItem && h.equippedItem.effect_id;
    }, HERO)).toBe('CURSE_KEY');

    const apBefore = await host.evaluate(() => window.latestGameState.players[window.myId].ap);

    // Attempt to use the sealed hero's skill -> must be refused.
    await host.evaluate((id) => window._socket.emit('use_hero_skill', { cardId: id, isFree: false }), HERO);
    await host.waitForTimeout(400);

    expect(await host.evaluate(() => window.latestGameState.state), 'no roll should start').toBe('PLAYING');
    expect(await host.evaluate(() => window.latestGameState.players[window.myId].ap), 'no AP spent').toBe(apBefore);

    // Inspector shows a disabled "Sealed" button instead of "Use Skill".
    await host.locator(`#player-party [data-id="${HERO}"]`).click();
    await expect(host.locator('#inspector-modal')).toBeVisible({ timeout: 5_000 });
    await host.screenshot({ path: 'sealing-key-mobile.png' });
    const sealedBtn = host.locator('#inspector-modal-actions button', { hasText: /Sealed/i });
    await expect(sealedBtn).toBeVisible();
    await expect(sealedBtn).toBeDisabled();

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
