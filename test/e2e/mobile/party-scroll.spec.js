'use strict';

// Layout: a large party must NOT push the hand off the bottom of the screen.
// The party zone is capped to its share of the player area and scrolls
// horizontally; the hand zone stays on screen. Mobile viewport + screenshot.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame, MOBILE_VIEWPORT } = require('../mobile/mobileSetup');

const HEROES = ['card_021', 'card_030', 'card_039', 'card_041', 'card_045', 'card_049', 'card_055', 'card_031'];

test('A big party keeps the hand on screen and the party stays horizontally scrollable', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Stuff the host's party with many heroes.
    for (const id of HEROES) {
        await host.evaluate((c) => window._socket.emit('debug_inject_to_party', { cardId: c }), id);
    }
    await host.waitForTimeout(500);

    // The party container is set up to scroll horizontally (not wrap/grow vertically),
    // and overflows once it's this full.
    const party = await host.evaluate(() => {
        const el = document.getElementById('player-party');
        return { overflowX: getComputedStyle(el).overflowX, noWrap: getComputedStyle(el).flexWrap };
    });
    // Party is a single, horizontally-scrollable row (doesn't wrap and grow down).
    expect(party.overflowX, 'party scrolls horizontally').toBe('auto');
    expect(party.noWrap, 'party row does not wrap').toBe('nowrap');

    // The hand zone stays within the viewport (not pushed off the bottom).
    const handBox = await host.locator('#hand-zone').boundingBox();
    expect(handBox, 'hand zone should be present').not.toBeNull();
    expect(handBox.y + handBox.height, 'hand must stay on screen')
        .toBeLessThanOrEqual(MOBILE_VIEWPORT.height + 1);

    // And the hand cards are actually visible.
    await expect(host.locator('#player-hand .card').first()).toBeVisible();

    await host.screenshot({ path: 'party-scroll-mobile.png' });

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
