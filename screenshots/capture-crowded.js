// Capture crowded hand/party states in landscape + portrait.
// Assumes the server is already running on 127.0.0.1:3000.
const { chromium } = require('@playwright/test');

const URL = 'http://127.0.0.1:3000';
const PARTY = [
  'card_016', 'card_017', 'card_018', 'card_019', 'card_020',
  'card_021', 'card_022', 'card_023', 'card_024', 'card_025'
];
const HAND = [
  'card_076', 'card_077', 'card_078', 'card_079', 'card_080', 'card_081',
  'card_082', 'card_083', 'card_084', 'card_085', 'card_086', 'card_087'
];

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

  await host.evaluate((ids) => window._socket.emit('debug_set_hand', { cardIds: ids }), HAND);
  for (const id of PARTY) {
    await host.evaluate((cid) => window._socket.emit('debug_inject_to_party', { cardId: cid }), id);
    await host.waitForTimeout(80);
  }

  await host.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await host.waitForTimeout(1600);
  await host.screenshot({ path: outPath });
  console.log(outPath, '-> pageerrors:', errs.length ? errs.slice(0, 5) : 'none');
  await c1.close();
  await c2.close();
  await new Promise(r => setTimeout(r, 700));
}

(async () => {
  const browser = await chromium.launch();
  await setupAndShot(browser, { width: 844, height: 390 }, 'screenshots/crowded-landscape.png');
  await setupAndShot(browser, { width: 412, height: 870 }, 'screenshots/crowded-portrait.png');
  await browser.close();
})();
