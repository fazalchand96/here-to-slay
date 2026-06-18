'use strict';

const { test, expect } = require('../helpers/fixtures');
const {
    startGame, injectCard, playCardFromHand, passChallenge,
    rollDice, passModifiers, passOpponentModifiers, clickFirstValidTarget, p2DoAction,
} = require('../helpers/gameSetup');

// Give p2 a hero in their party so there is a valid destroy target.
// playCard is turn-gated, so during the host's turn p2 cannot play a hero the
// normal way — inject it straight into p2's party via the debug handler instead.
async function setupP2Hero(host, p2) {
    await p2.evaluate(() => window._socket.emit('debug_inject_to_party', { cardId: 'card_030' }));
    await p2.waitForTimeout(400);
}

const DESTROY_CARDS = [
    { name: 'Bad Axe',     id: 'card_016' },
    { name: 'Shurikitty',  id: 'card_051' },
    { name: 'Whiskers',    id: 'card_062' },
    { name: 'Serious Grey', id: 'card_044' },
];

for (const { name, id } of DESTROY_CARDS) {
test(`${name}: opponent hero is removed from party`, async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await setupP2Hero(host, p2);
    const partyBefore = await p2.locator('#player-party .card').count();

    await injectCard(host, id);
    await playCardFromHand(host, id);
    await passChallenge(p2);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);

    // Targeting mode: click the opponent's highlighted hero
    await clickFirstValidTarget(host);
    await host.waitForTimeout(500);

    const partyAfter = await p2.locator('#player-party .card').count();
    expect(partyAfter, `${id}: expected p2 party to shrink`).toBeLessThan(partyBefore);
    expect(errors).toEqual([]);

    await ctx1.close(); await ctx2.close();
});
}

test('Fluffy (card_058): destroys up to 2 opponent heroes', async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await setupP2Hero(host, p2);

    const partyBefore = await p2.locator('#player-party .card').count();

    await injectCard(host, 'card_058');
    await playCardFromHand(host, 'card_058');
    await passChallenge(p2);
    await rollDice(host);
    await passModifiers(host);
    await passOpponentModifiers(p2);

    // Multi-target: clickFirstValidTarget selects the one hero (via the inspector's
    // SELECT TARGET button). Then close the inspector/opponent modals so the target
    // banner's "Submit Targets" button is clickable, and submit.
    await clickFirstValidTarget(host);
    await host.evaluate(() => { window.closeInspectorModal?.(); window.closeOpponentModal?.(); });
    const submitBtn = host.locator('button').filter({ hasText: /Submit Targets/i }).first();
    await expect(submitBtn).toBeVisible({ timeout: 5_000 });
    await submitBtn.click();
    await host.waitForTimeout(500);

    const partyAfter = await p2.locator('#player-party .card').count();
    expect(partyAfter).toBeLessThan(partyBefore);
    expect(errors).toEqual([]);

    await ctx1.close(); await ctx2.close();
});
