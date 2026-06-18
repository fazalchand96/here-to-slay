'use strict';

const { test, expect } = require('../helpers/fixtures');
const { startGame, injectCard, playCardFromHand, passChallenge, rollDice, passModifiers, passOpponentModifiers } = require('../helpers/gameSetup');

const SELF_BUFF_CARDS = [
    { name: 'Vibrant Glow',  id: 'card_038' },
    { name: 'Wise Shield',   id: 'card_039' },
    { name: 'Iron Resolve',  id: 'card_035' },
    { name: 'Calming Voice', id: 'card_032' },
    { name: 'Mighty Blade',  id: 'card_036' },
    { name: 'Napping Nibbles', id: 'card_029' },
];

for (const { name, id } of SELF_BUFF_CARDS) {
test(`${name}: plays without crash and transitions state`, async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await injectCard(host, id);
    await playCardFromHand(host, id);
    await passChallenge(p2);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);

    // After resolving, game should return to PLAYING state
    await expect(host.locator('#app-container')).not.toHaveClass(/hidden/);
    expect(errors).toEqual([]);

    await ctx1.close(); await ctx2.close();
});
}
