'use strict';

const { test, expect } = require('../helpers/fixtures');
const {
    startGame, setHand, injectCard, playCardFromHand, passChallenge, rollDice
} = require('../helpers/gameSetup');

const HERO = 'card_030';
const SORCERER_HERO = 'card_223';
const PLUS_SIX = 'card_233';
const SORCERER_CHALLENGE = 'card_236';
const DISCARD_COST = 'card_016';

async function declineFearlessFlameIfNeeded(host) {
    const action = await host.evaluate(() => window.latestGameState?.pendingAction);
    if (action?.type === 'FEARLESS_FLAME_DISCARD') {
        await host.evaluate(() => window._socket.emit('resolve_fearless_flame_choice', { use: false }));
    }
}

test('Modifier +6 requires a different discard and then applies to the live roll', async ({ browser }) => {
    const errors = [];
    const { host, p2 } = await startGame(browser);
    host.on('pageerror', error => errors.push(error.message));
    p2.on('pageerror', error => errors.push(error.message));

    await setHand(p2, [PLUS_SIX, DISCARD_COST]);
    const modifierCard = p2.locator(`#player-hand [data-id="${PLUS_SIX}"]`);
    await expect(modifierCard).toBeVisible();
    await expect(modifierCard.locator('.card-img')).toHaveAttribute('style', /modifier-fullgen-v1\/card_233\.webp/);

    await injectCard(host, HERO);
    await playCardFromHand(host, HERO);
    await passChallenge(p2);
    await rollDice(host);
    await declineFearlessFlameIfNeeded(host);
    await expect.poll(() => host.evaluate(() => window.latestGameState?.state)).toBe('WAITING_FOR_MODIFIERS');

    const before = await host.evaluate(() => window.latestGameState.pendingRoll.currentRoll);
    await p2.evaluate(cardId => window._socket.emit('submit_modifier_action', {
        action: 'PLAY', cardId, modValue: 6
    }), PLUS_SIX);

    await expect.poll(() => p2.evaluate(() => window.latestGameState?.pendingAction?.type))
        .toBe('MODIFIER_DISCARD_COST');
    const excluded = await p2.evaluate(() => window.latestGameState.pendingAction.excludeCardId);
    expect(excluded).toBe(PLUS_SIX);

    await p2.evaluate(cardId => window._socket.emit('submit_penalty_discard', { cardIds: [cardId] }), DISCARD_COST);
    await expect.poll(() => host.evaluate(() => window.latestGameState?.state)).toBe('WAITING_FOR_MODIFIERS');

    const result = await host.evaluate(() => {
        const opponentId = Object.keys(window.latestGameState.players).find(id => id !== window.myId);
        const opponent = window.latestGameState.players[opponentId];
        return {
            currentRoll: window.latestGameState.pendingRoll.currentRoll,
            modifierTotal: window.latestGameState.pendingRoll.modifierTotal,
            opponentHand: opponent.hand.length,
            guardian: opponent.leader?.effect_id === 'LEADER_GUARDIAN'
        };
    });
    const expected = result.guardian ? 7 : 6;
    expect(result.currentRoll).toBe(before + expected);
    expect(result.modifierTotal).toBe(expected);
    expect(result.opponentHand).toBe(0);
    expect(errors).toEqual([]);
});

test('Sorcerer Challenge accepts a Sorcerer and contributes its printed +3', async ({ browser }) => {
    const errors = [];
    const { host, p2 } = await startGame(browser);
    host.on('pageerror', error => errors.push(error.message));
    p2.on('pageerror', error => errors.push(error.message));

    await setHand(p2, [SORCERER_CHALLENGE]);
    await p2.evaluate(cardId => window._socket.emit('debug_inject_to_party', { cardId }), SORCERER_HERO);
    await expect.poll(() => p2.evaluate(() => window.latestGameState.players[window.myId].party
        .some(card => card.class === 'Sorcerer'))).toBe(true);

    await injectCard(host, HERO);
    await playCardFromHand(host, HERO);
    await expect(p2.locator('#challenge-modal')).not.toHaveClass(/hidden/);
    await p2.evaluate(cardId => window._socket.emit('play_challenge', cardId), SORCERER_CHALLENGE);

    await expect.poll(() => host.evaluate(() => window.latestGameState?.state))
        .toBe('WAITING_TO_ROLL_CHALLENGE');
    const challenge = await host.evaluate(() => ({
        bonus: window.latestGameState.pendingRoll.challengerCardBonus,
        name: window.latestGameState.pendingRoll.challengerCardName
    }));
    expect(challenge).toEqual({ bonus: 3, name: 'Sorcerer Challenge' });
    expect(errors).toEqual([]);
});

test('the mobile Party modal keeps all eleven available classes on one row', async ({ browser }) => {
    const errors = [];
    const { host } = await startGame(browser);
    host.on('pageerror', error => errors.push(error.message));

    await host.locator('#party-dock').click({ force: true });
    await expect(host.locator('#opponent-modal')).not.toHaveClass(/hidden/);
    const layout = await host.evaluate(() => {
        const columns = [...document.querySelectorAll('#opponent-modal .party-class-column')];
        return {
            count: columns.length,
            rows: new Set(columns.map(column => Math.round(column.getBoundingClientRect().top))).size,
            labels: columns.map(column => column.querySelector('header strong')?.textContent?.trim())
        };
    });
    expect(layout.count).toBe(11);
    expect(layout.rows).toBe(1);
    expect(layout.labels).toContain('Sorcerer');
    expect(errors).toEqual([]);
});
