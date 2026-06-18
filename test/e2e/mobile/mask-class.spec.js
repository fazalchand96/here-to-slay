'use strict';

// Masks (ITEM_MASK) — an equipped Mask makes the Hero count as the Mask's class.
// Here: equip a Bard Mask on a Guardian hero and confirm the tile now shows "Bard"
// (the class the game counts it as). Server win/requirement logic is unit-tested;
// this verifies the end-to-end equip + UI. Mobile viewport + screenshot.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');
const { injectCard } = require('../helpers/gameSetup');

const GUARDIAN_HERO = 'card_039'; // Wise Shield (class Guardian)
const BARD_MASK = 'card_064';

test('Mask: equipped hero is shown/counted as the mask class', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Put a Guardian hero in the host's party.
    await host.evaluate((id) => window._socket.emit('debug_inject_to_party', { cardId: id }), GUARDIAN_HERO);
    await host.waitForTimeout(300);
    // Sanity: tile shows its original class first.
    await expect(host.locator(`#player-party [data-id="${GUARDIAN_HERO}"] .card-class`)).toHaveText('Guardian');

    // Equip a Bard Mask onto that hero (via the item-play flow), opponent passes.
    await injectCard(host, BARD_MASK);
    await host.evaluate((args) => {
        window._socket.emit('play_item_action', {
            itemCardId: args.item, targetPlayerId: window.myId, targetHeroId: args.hero, isFree: false,
        });
    }, { item: BARD_MASK, hero: GUARDIAN_HERO });
    await host.waitForTimeout(400);
    await p2.evaluate(() => window._socket.emit('pass_challenge')).catch(() => {});
    await host.waitForTimeout(500);

    // The mask is equipped...
    const equipped = await host.evaluate((id) => {
        const h = window.latestGameState.players[window.myId].party.find(c => c.id === id);
        return h && h.equippedItem && h.equippedItem.effect_id;
    }, GUARDIAN_HERO);
    expect(equipped, 'mask should be equipped').toBe('ITEM_MASK');

    // ...and the tile now shows the mask's class (Bard), not Guardian.
    await expect(host.locator(`#player-party [data-id="${GUARDIAN_HERO}"] .card-class`)).toHaveText('Bard');

    await host.screenshot({ path: 'mask-class-mobile.png' });

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
