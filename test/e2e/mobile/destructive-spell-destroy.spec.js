'use strict';

// Destructive Spell (card_107) happy path — after discarding, the CASTER must be
// able to pick the Hero to destroy. The DESTROY step was missing `playerToChoose`,
// so the caster saw "WAITING FOR OPPONENT..." forever. Mobile viewport + shot.

const { test, expect } = require('../helpers/fixtures');
const { startMobileGame } = require('../mobile/mobileSetup');
const { injectCard } = require('../helpers/gameSetup');

const DESTRUCTIVE_SPELL = 'card_107';
const VICTIM_HERO = 'card_030';

test('Destructive Spell: caster picks the destroy target after discarding', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startMobileGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Opponent has a Hero to destroy.
    await p2.evaluate((id) => window._socket.emit('debug_inject_to_party', { cardId: id }), VICTIM_HERO);
    await p2.waitForTimeout(300);

    // Cast via socket (no upfront target), then opponent passes the challenge.
    await injectCard(host, DESTRUCTIVE_SPELL);
    await host.evaluate((id) => window._socket.emit('playCard', { cardId: id, isFree: false }), DESTRUCTIVE_SPELL);
    await host.waitForTimeout(400);
    await p2.evaluate(() => window._socket.emit('pass_challenge'));
    await host.waitForTimeout(400);

    // DISCARD step (action 1): discard the first hand card.
    await host.evaluate(() => {
        const me = window.latestGameState.players[window.myId];
        window._socket.emit('target_selected', me.hand[0].id);
    });
    await host.waitForTimeout(500);

    // DESTROY step (action 2): the CASTER must be the chooser (the fix).
    const pa = await host.evaluate(() => window.latestGameState.pendingAction);
    const myId = await host.evaluate(() => window.myId);
    expect(pa && pa.type, 'should be on the DESTROY step').toBe('DESTROY');
    expect(pa && pa.playerToChoose, 'caster must be the one to choose').toBe(myId);

    await host.screenshot({ path: 'destructive-spell-destroy-step-mobile.png' });

    // Pick the opponent's hero -> it gets destroyed and the action clears.
    await host.evaluate((id) => window._socket.emit('target_selected', id), VICTIM_HERO);
    await host.waitForTimeout(500);

    const p2StillHasHero = await p2.evaluate((id) => window.latestGameState.players[window.myId].party.some(h => h.id === id), VICTIM_HERO);
    const paAfter = await host.evaluate(() => window.latestGameState.pendingAction);
    expect(p2StillHasHero, 'victim hero should be destroyed').toBe(false);
    expect(paAfter, 'pending action should clear').toBeNull();

    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
