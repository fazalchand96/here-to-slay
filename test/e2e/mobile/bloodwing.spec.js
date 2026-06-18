'use strict';

// Bloodwing (card_004) — "Each time another player CHALLENGES you, that player
// must DISCARD a card." The host owns a slain Bloodwing; when the opponent plays a
// Challenge against the host's card, the opponent loses the challenge card AND one
// extra card (the Bloodwing penalty). Mobile viewport + screenshot.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');
const { injectCard, playCardFromHand } = require('../helpers/gameSetup');

const BLOODWING = 'card_004';
const CHALLENGE = 'card_117';
const HERO = 'card_039';

test('Bloodwing: challenging the owner forces the challenger to discard', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Host owns a slain Bloodwing; give the opponent a Challenge card to use.
    await host.evaluate((id) => window._socket.emit('debug_add_slain_monster', { cardId: id }), BLOODWING);
    await p2.evaluate((id) => window._socket.emit('debug_inject_card', { cardId: id }), CHALLENGE);
    await p2.waitForTimeout(300);

    // Host plays a challengeable card -> challenge phase opens.
    await injectCard(host, HERO);
    await playCardFromHand(host, HERO);
    await expect(p2.locator('#challenge-modal')).not.toHaveClass(/hidden/, { timeout: 10_000 });

    const p2Before = await p2.evaluate(() => window.latestGameState.players[window.myId].hand.length);

    // Opponent challenges the host.
    await p2.evaluate((id) => window._socket.emit('play_challenge', id), CHALLENGE);
    await p2.waitForTimeout(500);

    const p2After = await p2.evaluate(() => window.latestGameState.players[window.myId].hand.length);
    // -2: the challenge card itself + the Bloodwing-forced discard.
    expect(p2After, 'challenger loses the challenge card AND a Bloodwing discard').toBe(p2Before - 2);

    await p2.screenshot({ path: 'bloodwing-mobile.png' });

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
