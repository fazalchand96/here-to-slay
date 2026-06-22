'use strict';

// Screen-size fit check. Android phones (esp. landscape ~360px tall, or narrow
// ~360px-wide portrait) are tighter than iPhones, so the board can clip controls
// off-screen on Android while fitting on iOS. For a spread of real phone viewports
// (both orientations), boot a game, populate the board, and assert the bottom-most
// critical control — the END TURN button — stays within the viewport. Screenshots
// land in screenshots/fit/ for eyeballing.
const { test, expect } = require('../helpers/fixtures');
const { trackContext } = require('../helpers/gameSetup');
const fs = require('fs');
const path = require('path');

const OUT = path.join(process.cwd(), 'screenshots', 'fit');

// width<height → portrait; width>height → landscape (the client picks the shell off
// the window aspect ratio).
const VIEWPORTS = [
    // Landscape — Android landscapes are commonly only 360px tall (vs iPhone ~390-430).
    { name: 'land-pixel7-915x412', w: 915, h: 412 },
    { name: 'land-iphoneSE-667x375', w: 667, h: 375 },
    { name: 'land-android-740x360', w: 740, h: 360 },
    { name: 'land-android-640x360', w: 640, h: 360 },
    { name: 'land-android-800x360', w: 800, h: 360 },
    // Portrait — narrow Android widths.
    { name: 'port-pixel7-412x915', w: 412, h: 915 },
    { name: 'port-android-360x800', w: 360, h: 800 },
    { name: 'port-small-360x640', w: 360, h: 640 },
    { name: 'port-iphoneSE-375x667', w: 375, h: 667 },
];

async function rollLeader(page, name) {
    await page.fill('#player-name-input', name);
    await page.getByText('ROLL FOR LEADER').click();
    await expect(page.locator('#player-name-input')).toBeHidden({ timeout: 10_000 });
}

for (const vp of VIEWPORTS) {
    test(`screen fit: ${vp.name}`, async ({ browser }) => {
        const opts = { viewport: { width: vp.w, height: vp.h }, hasTouch: true, serviceWorkers: 'block' };
        const ctx1 = trackContext(await browser.newContext(opts));
        const ctx2 = trackContext(await browser.newContext(opts));
        const host = await ctx1.newPage();
        const p2 = await ctx2.newPage();

        await host.goto('/', { waitUntil: 'domcontentloaded' });
        await p2.goto('/', { waitUntil: 'domcontentloaded' });
        await rollLeader(host, 'Host');
        await rollLeader(p2, 'Guest');
        await expect(host.locator('#start-game-btn')).not.toHaveClass(/hidden/, { timeout: 10_000 });
        await host.click('#start-game-btn', { force: true });
        await expect(host.locator('#app-container')).not.toHaveClass(/hidden/, { timeout: 12_000 });

        // Populate the host party so the board is at a realistic height.
        for (const id of ['card_016', 'card_024', 'card_032', 'card_040']) {
            await host.evaluate((c) => window._socket.emit('debug_inject_to_party', { cardId: c }), id);
        }
        await host.waitForTimeout(600);

        fs.mkdirSync(OUT, { recursive: true });
        await host.screenshot({ path: path.join(OUT, `${vp.name}.png`) });

        const fit = await host.evaluate(() => {
            const vw = window.innerWidth, vh = window.innerHeight;
            const check = (sel) => {
                const el = document.querySelector(sel);
                if (!el) return { found: false };
                const b = el.getBoundingClientRect();
                return {
                    found: true, top: Math.round(b.top), bottom: Math.round(b.bottom), right: Math.round(b.right),
                    offBottom: b.bottom > vh + 1, offRight: b.right > vw + 1, offTop: b.top < -1,
                };
            };
            return { vw, vh, end: check('#end-turn-btn'), hand: check('#player-hand'), bar: check('#opponents-bar') };
        });
        console.log(`[FIT ${vp.name}]`, JSON.stringify(fit));

        // The END button is the bottom-most must-reach control.
        if (fit.end.found) {
            expect(fit.end.offBottom, `END button clipped off the bottom on ${vp.name} (${vp.w}x${vp.h})`).toBe(false);
            expect(fit.end.offRight, `END button clipped off the right on ${vp.name}`).toBe(false);
        }
        // The hand must not be clipped off the bottom either.
        if (fit.hand.found) {
            expect(fit.hand.offBottom, `hand clipped off the bottom on ${vp.name}`).toBe(false);
        }
    });
}
