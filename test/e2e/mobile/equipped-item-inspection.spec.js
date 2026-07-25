'use strict';

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');

const HERO = 'card_030'; // Peanut
const ITEM = 'card_064'; // Bard Mask

test('equipped Item and Hero remain separate tap targets in the mobile Party view', async ({ browser }) => {
    const errors = [];
    const { host, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', error => errors.push(error.message));

    await host.evaluate(({ heroId, itemId }) => {
        window._socket.emit('debug_inject_to_party', { cardId: heroId });
        window._socket.emit('debug_equip_item', { heroId, itemId });
    }, { heroId: HERO, itemId: ITEM });

    await host.locator('#party-dock').click();
    const hero = host.locator(`#opponent-modal .card[data-id="${HERO}"]`);
    const item = hero.locator(`[data-equipped-item-id="${ITEM}"]`);
    await expect(hero).toBeVisible({ timeout: 5_000 });
    await expect(item).toBeVisible();

    const [heroBox, itemBox] = await Promise.all([hero.boundingBox(), item.boundingBox()]);
    expect(heroBox).not.toBeNull();
    expect(itemBox).not.toBeNull();
    expect(itemBox.width * itemBox.height, 'Item hit area must not cover the Hero')
        .toBeLessThan(heroBox.width * heroBox.height * 0.3);

    // Tap the Hero away from its bottom-right attachment.
    await hero.click({ position: { x: 4, y: 4 } });
    await expect(host.locator('#inspector-modal')).toBeVisible();
    await expect(host.locator('#inspector-modal-name')).toHaveText('Peanut');
    await expect(host.locator('#inspector-modal-actions')).toContainText('Use Skill');
    await host.locator('#inspector-modal-actions .inspector-close-action').click();

    // Tap the attachment itself: it opens the Item rules, not the Hero actions.
    await item.click();
    await expect(host.locator('#inspector-modal')).toBeVisible();
    await expect(host.locator('#inspector-modal-name')).toHaveText('Bard Mask');
    await expect(host.locator('#inspector-modal-description'))
        .toContainText('considered a Bard');
    await expect(host.locator('#inspector-modal-actions')).not.toContainText('Use Skill');

    expect(errors).toEqual([]);
    await ctx1.close();
    await ctx2.close();
});
