// Capture BOTH landscape + portrait from one game against an isolated server
// (CAP_PORT env, default 3100). Outputs to OUT_L / OUT_P env paths.
const { chromium } = require('@playwright/test');

const PARTY = (process.env.CAP_PARTY || 'card_016,card_024,card_032,card_040')
  .split(',').map(id => id.trim()).filter(Boolean);
const PORT = process.env.CAP_PORT || '3100';
const URL = `http://127.0.0.1:${PORT}`;
const OUT_L = process.env.OUT_L || 'screenshots/game-landscape.png';
const OUT_P = process.env.OUT_P || 'screenshots/game-portrait.png';
const OCCUPY_DISCARD = process.env.OCCUPY_DISCARD === '1';
const DEPTH_ONLY = process.env.CAP_DEPTH_ONLY || '';

async function rollLeader(page, name) {
  await page.fill('#player-name-input', name);
  await page.getByText('ROLL FOR LEADER').click();
  await page.locator('#player-name-input').waitFor({ state: 'hidden', timeout: 10000 });
}

async function setupAndShot(browser, viewport, outPath) {
  const ctxOpts = { viewport, hasTouch: true, serviceWorkers: 'block', deviceScaleFactor: 2 };
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
  await host.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await host.waitForTimeout(1500);
  if (DEPTH_ONLY) {
    await host.evaluate((proposal) => document.body.classList.add(`depth-only-${proposal}`), DEPTH_ONLY);
    await host.waitForTimeout(100);
  }
  if (OCCUPY_DISCARD) {
    // Visual-only fixture: activate the real discard stack CSS without changing game state.
    await host.evaluate(() => {
      const source = document.querySelector('#player-party .card');
      const discard = document.querySelector('#discard-pile');
      if (!source || !discard) throw new Error('discard capture fixture unavailable');
      discard.innerHTML = source.outerHTML;
    });
    await host.waitForTimeout(150);
  }
  await host.screenshot({ path: outPath });
  console.log(outPath, '-> pageerrors:', errs.length ? errs.slice(0, 5) : 'none');
  await c1.close();
  await c2.close();
  await new Promise(r => setTimeout(r, 700));
}

(async () => {
  const browser = await chromium.launch();
  await setupAndShot(browser, { width: 844, height: 390 }, OUT_L);
  await setupAndShot(browser, { width: 412, height: 870 }, OUT_P);
  await browser.close();
})();
