// Reusable: capture the live game in landscape + portrait from ONE game.
// Assumes the server is already running on localhost:3000.
//   node screenshots/capture.js
const { chromium } = require('@playwright/test');

const PARTY = ['card_016', 'card_024', 'card_032', 'card_040']; // Fighter/Bard/Guardian/Ranger
const URL = 'http://localhost:3000';

async function rollLeader(page, name) {
  await page.fill('#player-name-input', name);
  await page.getByText('ROLL FOR LEADER').click();
  await page.locator('#player-name-input').waitFor({ state: 'hidden', timeout: 10000 });
}

async function setupAndShot(browser, viewport, outPath) {
  const ctxOpts = { viewport, hasTouch: true, serviceWorkers: 'block' };
  const c1 = await browser.newContext(ctxOpts);
  const c2 = await browser.newContext(ctxOpts);
  const host = await c1.newPage();
  const p2 = await c2.newPage();
  const errs = [];
  host.on('pageerror', e => errs.push(e.message));

  await host.goto(URL, { waitUntil: 'domcontentloaded' });
  await p2.goto(URL, { waitUntil: 'domcontentloaded' });
  await rollLeader(host, 'HostPlayer');
  await rollLeader(p2, 'GuestPlayer');
  await host.locator('#start-game-btn').waitFor({ state: 'visible', timeout: 10000 });
  await host.click('#start-game-btn', { force: true });
  await host.locator('#app-container').waitFor({ state: 'visible', timeout: 12000 });

  for (const id of PARTY) {
    await host.evaluate((cid) => window._socket.emit('debug_inject_to_party', { cardId: cid }), id);
    await host.waitForTimeout(120);
  }
  await p2.evaluate(() => window._socket.emit('debug_inject_to_party', { cardId: 'card_048' }));
  await host.waitForTimeout(700);
  await host.screenshot({ path: outPath });
  console.log(outPath, '-> pageerrors:', errs.length ? errs.slice(0, 5) : 'none');
  await c1.close();
  await c2.close();
  await new Promise(r => setTimeout(r, 700)); // let server reset to LOBBY
}

(async () => {
  const browser = await chromium.launch();
  await setupAndShot(browser, { width: 844, height: 390 }, 'screenshots/game-landscape.png');
  await setupAndShot(browser, { width: 412, height: 870 }, 'screenshots/game-portrait.png');
  await browser.close();
})();
