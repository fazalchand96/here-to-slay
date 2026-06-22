'use strict';

// 6-PLAYER verification for the cards whose behaviour actually scales with player
// count — the "each other player" global actions. With 6 players the host's skill
// must collect from / affect all 5 opponents and still resolve cleanly (this is
// exactly where the earlier Beary Wise soft-lock lived). Driven mostly over sockets
// since it's the LOGIC (not the per-orientation UI) that changes with count.
const { test, expect } = require('../helpers/fixtures');
const {
    startGameNPlayers, injectCard, playCardFromHand, rollDice,
} = require('../helpers/gameSetup');

const stateOf = (pg) => pg.evaluate(() => window.latestGameState && window.latestGameState.state);
const myHand = (pg) => pg.evaluate(() => window.latestGameState.players[window.myId].hand.length);

// Everyone (host + opponents) passes the challenge window for a just-played card.
async function allPassChallenge(pages) {
    await expect.poll(() => pages[0].evaluate(() => window.latestGameState.state), { timeout: 10_000 })
        .toBe('WAITING_FOR_CHALLENGES');
    for (const p of pages.slice(1)) {
        await p.evaluate(() => window._socket.emit('pass_challenge')).catch(() => {});
    }
}

// Everyone passes the modifier window so the roll resolves.
async function allPassModifiers(pages) {
    await expect.poll(() => pages[0].evaluate(() => window.latestGameState.state), { timeout: 10_000 })
        .toBe('WAITING_FOR_MODIFIERS');
    for (const p of pages) {
        await p.evaluate(() => window._socket.emit('submit_modifier_action', { action: 'PASS' })).catch(() => {});
    }
}

test('6-player Beary Wise: all 5 opponents discard into the pool, host picks one', async ({ browser }) => {
    const errors = [];
    const { host, players, pages } = await startGameNPlayers(browser, 6);
    host.on('pageerror', e => errors.push(e.message));
    expect(pages.length).toBe(6);

    const hostBefore = await myHand(host);

    await injectCard(host, 'card_018');        // Beary Wise
    await playCardFromHand(host, 'card_018');
    await allPassChallenge(pages);
    await rollDice(host);                        // forced 12 → clears 7+
    await allPassModifiers(pages);

    // Skill resolves into the 5-way collect. Every opponent must be pending.
    await expect.poll(() => host.evaluate(() =>
        window.latestGameState.pendingGlobalAction
        && window.latestGameState.pendingGlobalAction.type), { timeout: 10_000 })
        .toBe('MULTI_DISCARD_AND_CHOOSE');
    await expect.poll(() => host.evaluate(() =>
        window.latestGameState.pendingGlobalAction.pendingPlayerIds.length)).toBe(5);

    // Each opponent discards their first hand card into the pool.
    for (const p of players) {
        await p.evaluate(() => {
            const me = window.latestGameState.players[window.myId];
            if (me.hand.length) window._socket.emit('submit_global_action', { cardId: me.hand[0].id });
        });
        await p.waitForTimeout(150);
    }

    // Pool now holds 5 cards and the host is prompted to choose.
    await expect.poll(() => host.evaluate(() => {
        const ga = window.latestGameState.pendingGlobalAction;
        return ga && ga.awaitingChoice && ga.submittedCards.length;
    }), { timeout: 10_000 }).toBe(5);

    // Host picks one from the pool.
    await host.evaluate(() => {
        const ga = window.latestGameState.pendingGlobalAction;
        window._socket.emit('resolve_global_action', { cardId: ga.submittedCards[0].id });
    });

    // Beary Wise: injected (+1), played (−1), chosen card kept (+1) → net +1; clean resume.
    await expect.poll(() => myHand(host), { timeout: 10_000 }).toBe(hostBefore + 1);
    await expect.poll(() => host.evaluate(() => window.latestGameState.pendingGlobalAction)).toBeFalsy();
    await expect.poll(() => stateOf(host)).toBe('PLAYING');
    expect(errors).toEqual([]);
});

test('6-player Greedy Cheeks: all 5 opponents give the host a card', async ({ browser }) => {
    const errors = [];
    const { host, players, pages } = await startGameNPlayers(browser, 6);
    host.on('pageerror', e => errors.push(e.message));

    const hostBefore = await myHand(host);

    await injectCard(host, 'card_026');        // Greedy Cheeks
    await playCardFromHand(host, 'card_026');
    await allPassChallenge(pages);
    await rollDice(host);                        // forced 12 → clears 8+
    await allPassModifiers(pages);

    await expect.poll(() => host.evaluate(() =>
        window.latestGameState.pendingGlobalAction
        && window.latestGameState.pendingGlobalAction.type), { timeout: 10_000 })
        .toBe('MULTI_GIVE');

    for (const p of players) {
        await p.evaluate(() => {
            const me = window.latestGameState.players[window.myId];
            if (me.hand.length) window._socket.emit('submit_global_action', { cardId: me.hand[0].id });
        });
        await p.waitForTimeout(150);
    }

    // Greedy Cheeks: injected (+1), played (−1), +5 given by opponents → net +5.
    await expect.poll(() => myHand(host), { timeout: 12_000 }).toBe(hostBefore + 5);
    await expect.poll(() => host.evaluate(() => window.latestGameState.pendingGlobalAction)).toBeFalsy();
    await expect.poll(() => stateOf(host)).toBe('PLAYING');
    expect(errors).toEqual([]);
});
