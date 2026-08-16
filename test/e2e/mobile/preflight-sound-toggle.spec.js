'use strict';

const { test, expect } = require('../helpers/fixtures');

test('sound can be checked and changed before choosing a Party Leader', async ({ page }) => {
    await page.goto('/');

    const roomButton = page.locator('#room-sound-btn');
    await expect(roomButton).toBeVisible();
    await expect(roomButton).toHaveAttribute('aria-pressed', 'false');
    await expect(roomButton.locator('[data-sound-label]')).toHaveText('SOUND ON');

    await roomButton.click();
    await expect(roomButton).toHaveAttribute('aria-pressed', 'true');
    await expect(roomButton.locator('[data-sound-label]')).toHaveText('SOUND OFF');

    await roomButton.click();
    await expect(roomButton).toHaveAttribute('aria-pressed', 'false');
    await expect(roomButton.locator('[data-sound-label]')).toHaveText('SOUND ON');

    await page.locator('#create-room-btn').click();

    const lobbyButton = page.locator('#lobby-sound-btn');
    await expect(lobbyButton).toBeVisible();
    await expect(lobbyButton).toHaveAttribute('aria-pressed', 'false');
    await expect(lobbyButton.locator('[data-sound-label]')).toHaveText('SOUND ON');

    const layout = await page.evaluate(() => {
        const button = document.querySelector('#lobby-sound-btn').getBoundingClientRect();
        const panel = document.querySelector('#lobby-modal .lobby-panel').getBoundingClientRect();
        return {
            insidePanel: button.left >= panel.left
                && button.top >= panel.top
                && button.right <= panel.right
                && button.bottom <= panel.bottom,
            usableSize: button.width >= 100 && button.height >= 30,
        };
    });

    expect(layout.insidePanel).toBe(true);
    expect(layout.usableSize).toBe(true);
});
