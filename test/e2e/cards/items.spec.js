'use strict';

const { test, expect } = require('../helpers/fixtures');
const { startGame, injectCard, passChallenge } = require('../helpers/gameSetup');

// Items are played via play_item_action (not playCard). After playing, the host
// selects a hero in their own party to equip the item onto. Since the host starts
// with no heroes (party is empty at game start), we inject a hero first.

async function injectHeroToPartyViaSocket(host) {
    // Drop a hero straight into the host's party. Playing it via playCard would
    // enter WAITING_FOR_CHALLENGES and stall (p2 never passes), so the hero would
    // never resolve into the party and there'd be nothing to equip onto.
    await host.evaluate(() => window._socket.emit('debug_inject_to_party', { cardId: 'card_030' }));
    await host.waitForTimeout(300);
}

const ITEM_CARDS = [
    { name: 'Bard Mask',               id: 'card_064', effectId: 'ITEM_MASK' },
    { name: 'Fighter Mask',             id: 'card_066', effectId: 'ITEM_MASK' },
    { name: 'Guardian Mask',            id: 'card_067', effectId: 'ITEM_MASK' },
    { name: 'Ranger Mask',              id: 'card_070', effectId: 'ITEM_MASK' },
    { name: 'Thief Mask',               id: 'card_073', effectId: 'ITEM_MASK' },
    { name: 'Wizard Mask',              id: 'card_074', effectId: 'ITEM_MASK' },
    { name: 'Really Big Ring',          id: 'card_071', effectId: 'ITEM_RING' },
    { name: 'Particularly Rusty Coin',  id: 'card_068', effectId: 'ITEM_COIN_RUSTY' },
    { name: 'Decoy Doll',               id: 'card_065', effectId: 'ITEM_DECOY' },
];

for (const { name, id, effectId } of ITEM_CARDS) {
test(`${name} (${effectId}): equip targeting UI appears`, async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await injectHeroToPartyViaSocket(host);
    await injectCard(host, id);

    // Click the item card in hand
    // The dealt hand can already contain a copy of the injected card, so scope to first.
    await host.locator(`#player-hand [data-id="${id}"]`).first().click();
    await expect(host.locator('#inspector-modal')).toBeVisible({ timeout: 5_000 });

    // Click "Play Card" (item play triggers equip targeting)
    await host.locator('#inspector-modal-actions button').filter({ hasText: /Play/i }).first().click();

    // Target banner should appear asking to select a hero to equip. Poll (don't
    // single-shot after a fixed wait) — the banner can lag briefly under load.
    await expect(host.locator('#target-banner'), `${id}: expected equip targeting banner`)
        .not.toHaveClass(/hidden/, { timeout: 8_000 });
    expect(errors).toEqual([]);

    await ctx1.close(); await ctx2.close();
});
}

const CURSED_ITEM_CARDS = [
    { name: 'Curse of the Snake\'s Eyes', id: 'card_075', effectId: 'CURSE_SNAKE' },
    { name: 'Sealing Key',                id: 'card_077', effectId: 'CURSE_KEY' },
    { name: 'Suspiciously Shiny Coin',    id: 'card_078', effectId: 'CURSE_COIN_SHINY' },
];

for (const { name, id, effectId } of CURSED_ITEM_CARDS) {
test(`${name} (${effectId}): equip targeting UI appears`, async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Cursed items are played onto opponent heroes — drop one straight into p2's
    // party (playCard during the host's turn is turn-gated and dropped).
    await p2.evaluate(() => window._socket.emit('debug_inject_to_party', { cardId: 'card_030' }));
    await p2.waitForTimeout(300);

    await injectCard(host, id);
    // The dealt hand can already contain a copy of the injected card, so scope to first.
    await host.locator(`#player-hand [data-id="${id}"]`).first().click();
    await expect(host.locator('#inspector-modal')).toBeVisible({ timeout: 5_000 });
    await host.locator('#inspector-modal-actions button').filter({ hasText: /Play/i }).first().click();

    // Poll for the targeting banner — avoids a fixed-wait race under load.
    await expect(host.locator('#target-banner'), `${id}: expected cursed item targeting banner`)
        .not.toHaveClass(/hidden/, { timeout: 8_000 });
    expect(errors).toEqual([]);

    await ctx1.close(); await ctx2.close();
});
}
