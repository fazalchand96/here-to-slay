'use strict';

// Regression: Curse of the Snake's Eyes (card_075, CURSE_SNAKE — "-2 to the
// equipped Hero's rolls") is a Cursed Item. Equip targeting only allowed your OWN
// party, but a curse is meant to be dropped on an OPPONENT's hero. This verifies
// the curse can be equipped onto an opponent.
const { test, expect } = require('../helpers/fixtures');
const {
    startGame, injectCard, playCardFromHand, passChallenge, clickFirstValidTarget,
} = require('../helpers/gameSetup');

test("Curse of the Snake's Eyes: can be equipped onto an opponent's hero", async ({ browser }) => {
    const errors = [];
    const { host, p2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    // Give the opponent a hero to curse.
    await p2.evaluate(() => window._socket.emit('debug_inject_to_party', { cardId: 'card_016' }));
    await p2.waitForTimeout(300);

    // Host plays the cursed item — the Play button routes into equip targeting.
    await injectCard(host, 'card_075');
    await playCardFromHand(host, 'card_075');

    // The valid target is the OPPONENT's hero — clickFirstValidTarget opens the
    // opponent modal and selects it.
    await clickFirstValidTarget(host);

    // It goes through the challenge phase; opponent passes.
    await passChallenge(p2);

    // The curse is now equipped onto the opponent's hero.
    await expect.poll(async () => p2.evaluate(() => {
        const me = window.latestGameState.players[window.myId];
        const hero = me.party.find(h => h.id === 'card_016');
        return hero && hero.equippedItem && hero.equippedItem.id === 'card_075';
    })).toBe(true);
    expect(errors).toEqual([]);
});
