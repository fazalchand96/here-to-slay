'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createReconnectManager, RECONNECT_GRACE_MS } = require('../reconnect');
const { gameState, removePlayerAndResetMatch } = require('../server');

function player(id, extra = {}) {
    return {
        id,
        name: id,
        hand: [{ id: `${id}-hand` }],
        party: [{ id: `${id}-hero` }],
        slainMonsters: [{ id: `${id}-monster` }],
        leader: { id: `${id}-leader` },
        ap: 2,
        connected: true,
        away: false,
        ...extra,
    };
}

test('reconnect within grace restores the same seat and preserves full match state', () => {
    const oldId = 'old-socket';
    const newId = 'new-socket';
    const token = 'persistent-session-token-123';
    const originalPlayer = player(oldId);
    const state = {
        state: 'WAITING_FOR_MODIFIERS',
        players: { [oldId]: originalPlayer, other: player('other') },
        playerOrder: [oldId, 'other'],
        activePlayerSocketId: oldId,
        pendingAction: { playerToChoose: oldId, originalActor: oldId },
        pendingRoll: { rollerId: oldId, passedPlayers: [oldId] },
        modifierResponses: { actedPlayers: [oldId] },
        mainDeck: [{ id: 'deck-card' }],
        discardPile: [{ id: 'discard-card' }],
        activeMonsters: [{ id: 'active-monster' }],
    };
    let scheduled;
    let cleared = false;
    const manager = createReconnectManager({
        gameState: state,
        onPlayerExpired: () => assert.fail('grace fallback must not run'),
        setTimeoutFn: callback => { scheduled = callback; return { callback }; },
        clearTimeoutFn: () => { cleared = true; },
    });

    assert.equal(manager.register(oldId, token), token);
    manager.disconnect(oldId);
    assert.equal(state.players[oldId], originalPlayer);
    assert.equal(originalPlayer.connected, false);
    assert.equal(originalPlayer.away, true);
    assert.equal(typeof scheduled, 'function');

    const restored = manager.restore(newId, token);
    assert.equal(restored.player, originalPlayer);
    assert.equal(cleared, true);
    assert.equal(state.players[oldId], undefined);
    assert.equal(state.players[newId], originalPlayer);
    assert.deepEqual(state.playerOrder, [newId, 'other']);
    assert.equal(state.activePlayerSocketId, newId);
    assert.equal(state.pendingAction.playerToChoose, newId);
    assert.equal(state.pendingAction.originalActor, newId);
    assert.equal(state.pendingRoll.rollerId, newId);
    assert.deepEqual(state.pendingRoll.passedPlayers, [newId]);
    assert.deepEqual(state.modifierResponses.actedPlayers, [newId]);
    assert.equal(originalPlayer.hand[0].id, `${oldId}-hand`);
    assert.equal(originalPlayer.party[0].id, `${oldId}-hero`);
    assert.equal(originalPlayer.slainMonsters[0].id, `${oldId}-monster`);
    assert.equal(originalPlayer.leader.id, `${oldId}-leader`);
    assert.equal(originalPlayer.ap, 2);
    assert.equal(originalPlayer.connected, true);
    assert.equal(originalPlayer.away, false);
});

test('grace expiry removes the player and falls back to the existing wipe-to-lobby reset', () => {
    const droppedId = 'dropped-socket';
    const remainingId = 'remaining-socket';
    let scheduled;

    Object.assign(gameState, {
        state: 'PLAYING',
        players: {
            [droppedId]: player(droppedId),
            [remainingId]: player(remainingId),
        },
        playerOrder: [droppedId, remainingId],
        activePlayerSocketId: droppedId,
        pendingAction: { playerToChoose: droppedId },
        pendingCard: { id: 'pending-card' },
        pendingRoll: { rollerId: droppedId },
        pendingChallenge: { rollerId: droppedId },
        pendingGlobalAction: { originalActor: droppedId },
        mainDeck: [{ id: 'deck-card' }],
        monsterDeck: [{ id: 'monster-deck-card' }],
        discardPile: [{ id: 'discard-card' }],
        activeMonsters: [{ id: 'active-monster' }],
        winner: null,
    });

    const manager = createReconnectManager({
        gameState,
        graceMs: RECONNECT_GRACE_MS,
        onPlayerExpired: removePlayerAndResetMatch,
        setTimeoutFn: callback => { scheduled = callback; return { callback }; },
        clearTimeoutFn: () => {},
    });

    manager.register(droppedId, 'expiring-session-token-123');
    manager.disconnect(droppedId);
    assert.equal(gameState.state, 'PLAYING');
    assert.equal(gameState.players[droppedId].hand.length, 1);

    scheduled();
    assert.equal(gameState.state, 'LOBBY');
    assert.equal(gameState.players[droppedId], undefined);
    assert.deepEqual(gameState.playerOrder, [remainingId]);
    assert.deepEqual(gameState.players[remainingId].hand, []);
    assert.deepEqual(gameState.players[remainingId].party, []);
    assert.deepEqual(gameState.players[remainingId].slainMonsters, []);
    assert.equal(gameState.players[remainingId].leader, null);
    assert.equal(gameState.players[remainingId].ap, 0);
    assert.deepEqual(gameState.mainDeck, []);
    assert.deepEqual(gameState.monsterDeck, []);
    assert.deepEqual(gameState.discardPile, []);
    assert.deepEqual(gameState.activeMonsters, []);
    assert.equal(gameState.pendingAction, null);
    assert.equal(gameState.pendingRoll, null);
    assert.equal(gameState.pendingChallenge, null);
    assert.equal(gameState.pendingGlobalAction, null);
});
