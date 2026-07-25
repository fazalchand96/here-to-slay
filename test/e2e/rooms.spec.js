'use strict';

const { test, expect } = require('./helpers/fixtures');
const {
    newTrackedContext, createRoom, joinRoom,
} = require('./helpers/gameSetup');

async function makePage(browser) {
    const context = await newTrackedContext(browser);
    const page = await context.newPage();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    return page;
}

async function chooseLeader(page, name) {
    await page.locator('#player-name-input').fill(name);
    await page.getByText('ROLL FOR LEADER').click();
    await expect(page.locator('#player-name-input')).toBeHidden({ timeout: 10_000 });
}

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
