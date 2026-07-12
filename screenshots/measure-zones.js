// Fable-5-gate helper: enter a game (same flow as cap-both.js) and print
// getBoundingClientRect for the key zones vs the viewport, per orientation.
const { chromium } = require('@playwright/test');

const PORT = process.env.CAP_PORT || '3100';
const URL = `http://127.0.0.1:${PORT}`;

async function rollLeader(page, name) {
  await page.fill('#player-name-input', name);
  await page.getByText('ROLL FOR LEADER').click();
  await page.locator('#player-name-input').waitFor({ state: 'hidden', timeout: 10000 });
}

async function measure(browser, viewport, label) {
  const ctxOpts = { viewport, hasTouch: true, serviceWorkers: 'block' };
  const c1 = await browser.newContext(ctxOpts);
  const c2 = await browser.newContext(ctxOpts);
  const host = await c1.newPage();
  const p2 = await c2.newPage();
  await host.goto(URL, { waitUntil: 'domcontentloaded' });
  await p2.goto(URL, { waitUntil: 'domcontentloaded' });
  await rollLeader(host, 'HostPlayer');
  await rollLeader(p2, 'GuestPlayer');
  await host.locator('#start-game-btn').waitFor({ state: 'visible', timeout: 10000 });
  await host.click('#start-game-btn', { force: true });
  await host.locator('#app-container').waitFor({ state: 'visible', timeout: 12000 });
  await host.waitForTimeout(1200);

  const zones = await host.evaluate(() => {
    const ids = ['main-deck', 'discard-pile', 'active-monsters', 'player-party',
      'player-hand', 'leader-slot', 'opponents-bar', 'draw-card-btn',
      'discard-draw-btn', 'end-turn-btn'];
    const out = { viewport: { w: innerWidth, h: innerHeight } };
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) { out[id] = null; continue; }
      const r = el.getBoundingClientRect();
      out[id] = {
        x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
        right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1),
        offRight: +(r.right - innerWidth).toFixed(1), offBottom: +(r.bottom - innerHeight).toFixed(1),
        offLeft: +(-r.x).toFixed(1), offTop: +(-r.y).toFixed(1),
      };
    }
    return out;
  });
  console.log(`\n=== ${label} (${viewport.width}x${viewport.height}) ===`);
  console.log(JSON.stringify(zones, null, 1));
  await c1.close();
  await c2.close();
  await new Promise(r => setTimeout(r, 700));
}

(async () => {
  const browser = await chromium.launch();
  await measure(browser, { width: 844, height: 390 }, 'LANDSCAPE');
  await measure(browser, { width: 412, height: 870 }, 'PORTRAIT');
  await browser.close();
})();
