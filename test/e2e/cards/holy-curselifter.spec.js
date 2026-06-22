'use strict';

// Holy Curselifter (card_034) — "Return a Cursed Item equipped to a Hero in YOUR
// party to your hand." Set up a host hero wearing a cursed item, use the skill, then
// self-target that hero; the cursed item should move from the hero to the host's hand.
const { test, expect } = require('../helpers/fixtures');
const {
    startGame, injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers,
} = require('../helpers/gameSetup');

const HERO = 'card_016';          // Bad Axe — any hero to wear the curse
const CURSED_ITEM = 'card_075';   // Curse of the Snake's Eyes (Cursed Item Card)
const CURSELIFTER = 'card_034';

test('Holy Curselifter: returns a cursed item from your own hero to your hand', async ({ browser }) => {
    const errors = [];
    const { host, p2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Give the host a hero wearing a cursed item.
    await host.evaluate((id) => window._socket.emit('debug_inject_to_party', { cardId: id }), HERO);
    await host.waitForTimeout(200);
    await host.evaluate((id) => window._socket.emit('debug_equip_item', { itemId: id }), CURSED_ITEM);
    await host.waitForTimeout(300);

    const handBefore = await host.evaluate(() => window.latestGameState.players[window.myId].hand.length);

    await injectCard(host, CURSELIFTER);
    await playCardFromHand(host, CURSELIFTER);
    await passChallenge(p2);
    await rollDice(host);                 // forced 12 → clears 5+
    await passModifiers(host);
    await passOpponentModifiers(p2);

    // Roll resolves into self-item targeting.
    await expect.poll(() => host.evaluate(() =>
        window.latestGameState && window.latestGameState.pendingAction
        && window.latestGameState.pendingAction.type), { timeout: 10_000 }).toBe('SKILL_TARGET_SELF_ITEM');

    // Submit the self-item target (the cursed hero) the way the client does in the
    // deferred WAITING_FOR_SKILL_TARGET state — via submit_skill_target.
    await host.evaluate((hid) => window._socket.emit('submit_skill_target', { targetHeroId: hid }), HERO);

    // The cursed item is now in the host's hand and off the hero.
    await expect.poll(() => host.evaluate((cid) =>
        window.latestGameState.players[window.myId].hand.some(c => c.id === cid), CURSED_ITEM),
        { timeout: 10_000 }).toBe(true);
    await expect.poll(() => host.evaluate((hid) => {
        const h = window.latestGameState.players[window.myId].party.find(x => x.id === hid);
        return h && !!h.equippedItem;
    }, HERO)).toBe(false);
    // Curselifter (+1 inject, -1 play) net 0 on hand from the card itself; +1 from the
    // returned curse → hand grew by exactly 1.
    await expect.poll(() => host.evaluate(() =>
        window.latestGameState.players[window.myId].hand.length)).toBe(handBefore + 1);
    expect(errors).toEqual([]);
});
