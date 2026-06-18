'use strict';

const path = require('path');
const { test, expect } = require('../helpers/fixtures');
const {
    startGame, injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers, clickFirstValidTarget,
} = require('../helpers/gameSetup');

// e2e coverage for the three destroy-family hero fixes from the audit:
//   - Serious Grey (card_044): "DESTROY a Hero AND DRAW a card" — draw is unconditional.
//   - Shurikitty   (card_051): "DESTROY a Hero; if it had an Item, take the Item to hand."
//   - Whiskers     (card_062): "STEAL a Hero AND DESTROY a Hero" — two targets.
//
// Screenshots of each resolved board are written to ./test-screenshots/.

const SHOTS = path.join(__dirname, '..', '..', '..', 'test-screenshots');

// hero with an observable, non-targeting skill — handy as a victim/steal target.
const PEANUT  = 'card_030';
const BAD_AXE = 'card_016';
const RING    = 'card_071'; // Really Big Ring — harmless passive item

function partyCount(page) {
    return page.evaluate(() => window.latestGameState.players[window.myId].party.length);
}
function handCount(page) {
    return page.evaluate(() => window.latestGameState.players[window.myId].hand.length);
}
function handHas(page, cardId) {
    return page.evaluate((id) => window.latestGameState.players[window.myId].hand.some(c => c.id === id), cardId);
}
function p2PartyCount(p2) {
    return p2.evaluate(() => window.latestGameState.players[window.myId].party.length);
}

test('Serious Grey: destroys an opponent hero AND draws a card', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await p2.evaluate((id) => window._socket.emit('debug_inject_to_party', { cardId: id }), PEANUT);
    await p2.waitForTimeout(400);

    await injectCard(host, 'card_044');
    await playCardFromHand(host, 'card_044');
    await passChallenge(p2);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);

    // Hand size right before resolving the destroy (Serious Grey is already in party).
    const before = await handCount(host);

    await clickFirstValidTarget(host);
    await host.waitForTimeout(700);

    expect(await p2PartyCount(p2), 'opponent hero should be destroyed').toBe(0);
    expect(await handCount(host) - before, 'Serious Grey draws unconditionally').toBe(1);
    expect(await host.evaluate(() => window.latestGameState.state)).toBe('PLAYING');

    await host.screenshot({ path: path.join(SHOTS, 'serious-grey.png'), fullPage: false });
    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});

test('Shurikitty: destroys a hero and takes its equipped item into hand', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // p2 gets a hero with a Really Big Ring equipped (debug_equip_item targets the
    // caller's last party hero).
    await p2.evaluate((id) => window._socket.emit('debug_inject_to_party', { cardId: id }), PEANUT);
    await p2.waitForTimeout(300);
    await p2.evaluate((id) => window._socket.emit('debug_equip_item', { itemId: id }), RING);
    await p2.waitForTimeout(400);

    await injectCard(host, 'card_051');
    await playCardFromHand(host, 'card_051');
    await passChallenge(p2);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);

    const before = await handCount(host);

    await clickFirstValidTarget(host);
    await host.waitForTimeout(700);

    expect(await p2PartyCount(p2), 'opponent hero should be destroyed').toBe(0);
    expect(await handHas(host, RING), 'the equipped Ring goes to the host hand').toBe(true);
    expect(await handCount(host) - before, 'exactly one card (the Item) added').toBe(1);

    await host.screenshot({ path: path.join(SHOTS, 'shurikitty.png'), fullPage: false });
    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});

test('Whiskers: steals one opponent hero AND destroys a second', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // p2 needs two heroes: one to be stolen, one to be destroyed.
    await p2.evaluate((id) => window._socket.emit('debug_inject_to_party', { cardId: id }), PEANUT);
    await p2.waitForTimeout(250);
    await p2.evaluate((id) => window._socket.emit('debug_inject_to_party', { cardId: id }), BAD_AXE);
    await p2.waitForTimeout(400);

    await injectCard(host, 'card_062');
    await playCardFromHand(host, 'card_062');
    await passChallenge(p2);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);

    // First target = the STEAL.
    await clickFirstValidTarget(host);
    await host.waitForTimeout(600);
    // Whiskers should now be waiting for the DESTROY half.
    expect(await host.evaluate(() => window.latestGameState.pendingAction && window.latestGameState.pendingAction.type))
        .toBe('DESTROY');

    // Second target = the DESTROY.
    await clickFirstValidTarget(host);
    await host.waitForTimeout(700);

    expect(await p2PartyCount(p2), 'both opponent heroes are gone (1 stolen, 1 destroyed)').toBe(0);
    // Host party = Whiskers itself + the one stolen hero.
    expect(await partyCount(host), 'host keeps Whiskers and the stolen hero').toBe(2);

    await host.screenshot({ path: path.join(SHOTS, 'whiskers.png'), fullPage: false });
    expect(errors).toEqual([]);
    await ctx1.close(); await ctx2.close();
});
