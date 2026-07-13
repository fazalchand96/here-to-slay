'use strict';

const { randomUUID } = require('crypto');

const RECONNECT_GRACE_MS = 90_000;

function replaceSocketIdReferences(value, oldSocketId, newSocketId, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            if (value[i] === oldSocketId) value[i] = newSocketId;
            else replaceSocketIdReferences(value[i], oldSocketId, newSocketId, seen);
        }
        return;
    }

    for (const key of Object.keys(value)) {
        if (value[key] === oldSocketId) value[key] = newSocketId;
        else replaceSocketIdReferences(value[key], oldSocketId, newSocketId, seen);
    }
}

function migratePlayerSocketId(gameState, oldSocketId, newSocketId) {
    const player = gameState.players[oldSocketId];
    if (!player || gameState.players[newSocketId]) return null;

    delete gameState.players[oldSocketId];
    gameState.players[newSocketId] = player;
    replaceSocketIdReferences(gameState, oldSocketId, newSocketId);

    player.id = newSocketId;
    player.connected = true;
    player.away = false;
    player.disconnectedAt = null;
    return player;
}

function createReconnectManager({
    gameState,
    graceMs = RECONNECT_GRACE_MS,
    onPlayerExpired,
    onPlayerAway = () => {},
    onPlayerRestored = () => {},
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
}) {
    const sessionsBySocketId = new Map();
    const recordsByToken = new Map();

    function register(socketId, requestedToken) {
        let token = typeof requestedToken === 'string' ? requestedToken.trim() : '';
        if (token.length < 16 || token.length > 200 || recordsByToken.has(token)) {
            token = randomUUID();
        }
        sessionsBySocketId.set(socketId, token);
        recordsByToken.set(token, { socketId, timer: null, expiresAt: null });
        return token;
    }

    function restore(newSocketId, token) {
        if (typeof token !== 'string') return null;
        const record = recordsByToken.get(token.trim());
        if (!record || !record.timer) return null;

        const oldSocketId = record.socketId;
        const oldPlayer = gameState.players[oldSocketId];
        if (!oldPlayer || oldPlayer.connected !== false) return null;

        clearTimeoutFn(record.timer);
        const player = migratePlayerSocketId(gameState, oldSocketId, newSocketId);
        if (!player) return null;

        sessionsBySocketId.delete(oldSocketId);
        sessionsBySocketId.set(newSocketId, token.trim());
        record.socketId = newSocketId;
        record.timer = null;
        record.expiresAt = null;
        onPlayerRestored(player, oldSocketId, newSocketId);
        return { player, oldSocketId };
    }

    function expire(token) {
        const record = recordsByToken.get(token);
        if (!record || !record.timer) return false;

        const socketId = record.socketId;
        const player = gameState.players[socketId];
        if (!player || player.connected !== false) return false;

        clearTimeoutFn(record.timer);
        recordsByToken.delete(token);
        sessionsBySocketId.delete(socketId);
        onPlayerExpired(socketId);
        return true;
    }

    function disconnect(socketId) {
        const player = gameState.players[socketId];
        if (!player) return false;

        const token = sessionsBySocketId.get(socketId);
        const record = token && recordsByToken.get(token);

        // Lobby seats have no match state to preserve, so retain the existing
        // immediate-removal behaviour there.
        if (gameState.state === 'LOBBY' || !record) {
            if (token) recordsByToken.delete(token);
            sessionsBySocketId.delete(socketId);
            onPlayerExpired(socketId);
            return true;
        }

        if (record.timer) return true;
        player.connected = false;
        player.away = true;
        player.disconnectedAt = Date.now();
        record.expiresAt = player.disconnectedAt + graceMs;
        record.timer = setTimeoutFn(() => expire(token), graceMs);
        onPlayerAway(player, record.expiresAt);
        return true;
    }

    function leaveNow(socketId) {
        const token = sessionsBySocketId.get(socketId);
        const record = token && recordsByToken.get(token);
        if (record && record.timer) clearTimeoutFn(record.timer);
        if (token) recordsByToken.delete(token);
        sessionsBySocketId.delete(socketId);
        if (!gameState.players[socketId]) return false;
        onPlayerExpired(socketId);
        return true;
    }

    function getToken(socketId) {
        return sessionsBySocketId.get(socketId) || null;
    }

    return { register, restore, disconnect, leaveNow, expire, getToken };
}

module.exports = {
    RECONNECT_GRACE_MS,
    createReconnectManager,
    migratePlayerSocketId,
};
