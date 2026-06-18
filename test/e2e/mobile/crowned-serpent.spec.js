'use strict';

// Crowned Serpent (card_006) — "Each time any player plays a Modifier card, you
// may DRAW a card." The host owns a slain Crowned Serpent; when the OPPONENT plays
// a modifier during the host's roll window, the host draws a card. Mobile + shot.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');
const { injectCard, playCardFromHand, passChallenge, rollDice } = require('../helpers/gameSetup');

const CROWNED_SERPENT = 'card_006';
const MODIFIER = 'card_079';
const HERO = 'card_039';

test('Crowned Serpent: owner draws when any player plays a Modifier', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await host.evaluate((id) => window._socket.emit('debug_add_slain_monster', { cardId: id }), CROWNED_SERPENT);
    await p2.evaluate((id) => window._socket.emit('debug_inject_card', { cardId: id }), MODIFIER);
    await p2.waitForTimeout(300);

    // Host rolls a hero skill -> opens the modifier window.
    await injectCard(host, HERO);
    await playCardFromHand(host, HERO);
    await passChallenge(p2);
    await rollDice(host);
    await host.waitForTimeout(400);
    expect(await host.evaluate(() => window.latestGameState.state)).toBe('WAITING_FOR_MODIFIERS');

    const hostBefore = await host.evaluate(() => window.latestGameState.players[window.myId].hand.length);
    const p2Before = await p2.evaluate(() => window.latestGameState.players[window.myId].hand.length);

    // Opponent plays a modifier on the host's roll.
    await p2.evaluate((id) => window._socket.emit('submit_modifier_action', { action: 'PLAY', cardId: id }), MODIFIER);
    await host.waitForTimeout(500);

    const hostAfter = await host.evaluate(() => window.latestGameState.players[window.myId].hand.length);
    const p2After = await p2.evaluate(() => window.latestGameState.players[window.myId].hand.length);

    expect(hostAfter, 'Crowned Serpent owner draws on a modifier play').toBe(hostBefore + 1);
    expect(p2After, 'the player who played the modifier loses it').toBe(p2Before - 1);

    await host.screenshot({ path: 'crowned-serpent-mobile.png' });

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
