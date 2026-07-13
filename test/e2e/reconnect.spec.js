'use strict';

const { test, expect } = require('./helpers/fixtures');
const { startGame } = require('./helpers/gameSetup');

test('a new page in the same browser context restores its mid-match seat', async ({ browser }) => {
    const { host, p2, ctx2 } = await startGame(browser);

    const before = await p2.evaluate(() => {
        const me = window.latestGameState.players[window.myId];
        return {
            socketId: window.myId,
            token: localStorage.getItem('hts-player-session-token'),
            name: me.name,
            handIds: me.hand.map(card => card.id),
            partyIds: me.party.map(card => card.id),
            slainIds: me.slainMonsters.map(card => card.id),
            leaderId: me.leader && me.leader.id,
            ap: me.ap,
            seat: window.latestGameState.playerOrder.indexOf(window.myId),
        };
    });
    expect(before.token).toBeTruthy();

    // Closing the page destroys its Socket.IO connection. A fresh page in the
    // same context retains localStorage but receives a different socket.id.
    await p2.close();
    await expect(host.locator('#opponents-bar')).toContainText('AWAY', { timeout: 8_000 });

    const reconnected = await ctx2.newPage();
    await reconnected.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(reconnected.locator('#app-container')).not.toHaveClass(/hidden/, { timeout: 10_000 });

    const after = await reconnected.evaluate(() => {
        const me = window.latestGameState.players[window.myId];
        return {
            socketId: window.myId,
            token: localStorage.getItem('hts-player-session-token'),
            name: me.name,
            handIds: me.hand.map(card => card.id),
            partyIds: me.party.map(card => card.id),
            slainIds: me.slainMonsters.map(card => card.id),
            leaderId: me.leader && me.leader.id,
            ap: me.ap,
            seat: window.latestGameState.playerOrder.indexOf(window.myId),
        };
    });

    expect(after.socketId).not.toBe(before.socketId);
    expect(after).toEqual({ ...before, socketId: after.socketId });
    await expect(host.locator('#opponents-bar')).not.toContainText('AWAY');

    // Explicit test teardown bypasses the production grace window.
    const leave = page => page.evaluate(() => new Promise(resolve => {
        window._socket.emit('leave_game', resolve);
    }));
    await leave(host);
    await leave(reconnected);
});
