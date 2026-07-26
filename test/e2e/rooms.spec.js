'use strict';

const { test, expect } = require('./helpers/fixtures');
const {
    newTrackedContext, createRoom, joinRoom, startGame, setHand,
} = require('./helpers/gameSetup');

async function makePage(browser, contextOptions) {
    const context = await newTrackedContext(browser, contextOptions);
    const page = await context.newPage();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    return page;
}

async function chooseLeader(page, name) {
    await page.locator('#player-name-input').fill(name);
    await page.getByText('ROLL FOR LEADER').click();
    await expect(page.locator('#player-name-input')).toBeHidden({ timeout: 10_000 });
}

test('a player can leave to the main menu and create a different lobby', async ({ browser }) => {
    const page = await makePage(browser);
    const firstRoom = await createRoom(page);

    page.once('dialog', dialog => dialog.accept());
    await page.locator('#lobby-leave-room-btn').click();

    await expect(page.locator('#room-modal')).not.toHaveClass(/hidden/);
    await expect(page.locator('#lobby-modal')).toHaveClass(/hidden/);
    await expect.poll(() => page.evaluate(() => window.activeRoomCode || '')).toBe('');

    const secondRoom = await createRoom(page);
    expect(secondRoom).not.toBe(firstRoom);
});

test('two lobby codes keep players, broadcasts, and match state isolated', async ({ browser }) => {
    const [aHost, aGuest, bHost, bGuest] = await Promise.all([
        makePage(browser), makePage(browser), makePage(browser), makePage(browser),
    ]);

    const roomA = await createRoom(aHost);
    const roomB = await createRoom(bHost);
    expect(roomA).not.toBe(roomB);

    await joinRoom(aGuest, roomA);
    await joinRoom(bGuest, roomB);

    await chooseLeader(aHost, 'AlphaHost');
    await chooseLeader(aGuest, 'AlphaGuest');
    await chooseLeader(bHost, 'BetaHost');
    await chooseLeader(bGuest, 'BetaGuest');

    await expect(aHost.locator('#lobby-players')).toContainText('AlphaGuest');
    await expect(aHost.locator('#lobby-players')).not.toContainText('BetaGuest');
    await expect(bHost.locator('#lobby-players')).toContainText('BetaGuest');
    await expect(bHost.locator('#lobby-players')).not.toContainText('AlphaGuest');

    await expect(aHost.locator('#start-game-btn')).not.toHaveClass(/hidden/);
    await aHost.locator('#start-game-btn').click({ force: true });
    await expect(aHost.locator('#app-container')).not.toHaveClass(/hidden/);
    await expect(aGuest.locator('#app-container')).not.toHaveClass(/hidden/);

    await expect(bHost.locator('#lobby-modal')).not.toHaveClass(/hidden/);
    await expect(bGuest.locator('#lobby-modal')).not.toHaveClass(/hidden/);
    await expect(bHost.locator('#app-container')).toHaveClass(/hidden/);
});

test('joining a running room becomes a read-only spectator with every hand visible', async ({ browser }) => {
    const { host, p2 } = await startGame(browser);
    const roomCode = await host.evaluate(() => window.activeRoomCode);

    await setHand(host, ['card_104']);
    await setHand(p2, ['card_107', 'card_169']);
    for (const cardId of ['card_056', 'card_048', 'card_040']) {
        await p2.evaluate(id => window._socket.emit('debug_inject_to_party', { cardId: id }), cardId);
    }
    for (const cardId of ['card_001', 'card_002']) {
        await p2.evaluate(id => window._socket.emit('debug_add_slain_monster', { cardId: id }), cardId);
    }

    const watcher = await makePage(browser, {
        viewport: { width: 915, height: 412 },
        hasTouch: true,
        serviceWorkers: 'block'
    });
    await joinRoom(watcher, roomCode);
    await expect(watcher.locator('#app-container')).not.toHaveClass(/hidden/);
    await expect.poll(() => watcher.evaluate(() => window.isSpectator)).toBe(true);

    const spectatorState = await watcher.evaluate(() => window.latestGameState);
    expect(spectatorState.playerOrder).toHaveLength(2);
    expect(spectatorState.players[spectatorState.playerOrder[0]].hand[0].id).toBe('card_104');
    expect(spectatorState.players[spectatorState.playerOrder[1]].hand[0].id).toBe('card_107');
    expect(spectatorState.players[spectatorState.me]).toBeUndefined();

    await expect(watcher.locator('#spectator-banner')).not.toHaveClass(/hidden/);
    await expect(watcher.locator('#player-hand [data-id="card_104"]')).toBeVisible();
    await expect(watcher.locator('#player-controls .btn-group')).toBeHidden();

    await watcher.locator('#opponents-bar .opponent-chip').click();
    await expect(watcher.locator('.spectator-hand-view [data-id="card_107"]')).toBeVisible();
    await expect(watcher.locator('.party-classes-zone')).toBeVisible();

    const modalLayout = await watcher.evaluate(() => {
        const content = document.querySelector('#opponent-modal-content').getBoundingClientRect();
        const hand = document.querySelector('.spectator-hand-view').getBoundingClientRect();
        const classes = document.querySelector('.party-classes-zone').getBoundingClientRect();
        const columns = [...document.querySelectorAll('.party-class-column')]
            .map(column => column.getBoundingClientRect());
        return {
            columnCount: columns.length,
            handAndPartyOverlap: hand.right > classes.left && hand.left < classes.right,
            contentContainsClasses: classes.left >= content.left - 1 && classes.right <= content.right + 1,
            contentContainsLastClass: columns.at(-1).right <= content.right + 1,
            hasMonsterZone: !!document.querySelector('.own-party-monsters')
        };
    });
    expect(modalLayout.columnCount).toBe(11);
    expect(modalLayout.handAndPartyOverlap).toBe(false);
    expect(modalLayout.contentContainsClasses).toBe(true);
    expect(modalLayout.contentContainsLastClass).toBe(true);
    expect(modalLayout.hasMonsterZone).toBe(false);

    await watcher.locator('#party-monsters-tab').click();
    await expect(watcher.locator('#opponent-modal')).toHaveAttribute('data-section', 'monsters');
    await expect(watcher.locator('.spectator-hand-view')).toHaveCount(0);
    await expect(watcher.locator('.party-classes-zone')).toHaveCount(0);
    await expect(watcher.locator('.own-party-monsters .party-monster-card-slot')).toHaveCount(2);
    const monsterModalScrolls = await watcher.evaluate(() => {
        const content = document.querySelector('#opponent-modal-content');
        return content.scrollHeight > content.clientHeight + 1
            || content.scrollWidth > content.clientWidth + 1;
    });
    expect(monsterModalScrolls).toBe(false);

    const activeBefore = spectatorState.activePlayerSocketId;
    await watcher.evaluate(() => window._socket.emit('end_turn'));
    await watcher.waitForTimeout(250);
    await expect.poll(() => watcher.evaluate(() => window.latestGameState.activePlayerSocketId)).toBe(activeBefore);
});
