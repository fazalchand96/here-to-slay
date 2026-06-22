'use strict';

// Capture the 6-player board in whatever orientation the running project uses, to
// eyeball how the UI holds up with the maximum number of players. Saves shots of the
// host view (own party + 5 opponents) and an opponent-modal view.
const { test } = require('../helpers/fixtures');
const { startGameNPlayers } = require('../helpers/gameSetup');
const fs = require('fs');
const path = require('path');

const OUT = path.join(process.cwd(), 'screenshots');

// A spread of heroes per player so party rows, opponent chips and win-counters are
// all populated (worst case for layout).
const PARTY = ['card_016', 'card_024', 'card_032', 'card_040'];

test('6-player board screenshots', async ({ browser }, testInfo) => {
    fs.mkdirSync(OUT, { recursive: true });
    const proj = testInfo.project.name; // mobile-chrome (landscape) | mobile-portrait
    const { host, players, pages } = await startGameNPlayers(browser, 6);

    // Populate every player's party so the board is busy.
    for (const p of pages) {
        for (const id of PARTY) {
            await p.evaluate((cid) => window._socket.emit('debug_inject_to_party', { cardId: cid }), id);
        }
    }
    await host.waitForTimeout(800);

    // Host view — the main board with all 5 opponents on the bar.
    await host.screenshot({ path: path.join(OUT, `6p-${proj}-host.png`), fullPage: false });

    // Open the first opponent's modal to see how an opponent's full party renders.
    await host.locator('#opponents-bar .opponent-chip').first().click({ force: true }).catch(() => {});
    await host.waitForTimeout(600);
    await host.screenshot({ path: path.join(OUT, `6p-${proj}-opponent-modal.png`), fullPage: false });

    // A second player's view too (different leader / perspective).
    await players[0].screenshot({ path: path.join(OUT, `6p-${proj}-player2.png`), fullPage: false });
});
