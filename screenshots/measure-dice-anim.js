// Gate helper: sample the live dice sprite's computed background-position at
// intervals during a REAL roll — proves frame advancement numerically.
const { chromium } = require('@playwright/test');
const PORT = process.env.CAP_PORT || '3100';
const URL = `http://127.0.0.1:${PORT}`;

async function rollLeader(page, name) {
  await page.fill('#player-name-input', name);
  await page.getByText('ROLL FOR LEADER').click();
  await page.locator('#player-name-input').waitFor({ state: 'hidden', timeout: 10000 });
}

(async () => {
  const browser = await chromium.launch();
  const opts = { viewport: { width: 844, height: 390 }, serviceWorkers: 'block' };
  const c1 = await browser.newContext(opts);
  const c2 = await browser.newContext(opts);
  const host = await c1.newPage();
  const guest = await c2.newPage();
  await host.goto(URL, { waitUntil: 'domcontentloaded' });
  await guest.goto(URL, { waitUntil: 'domcontentloaded' });
  await rollLeader(host, 'HostPlayer');
  await rollLeader(guest, 'GuestPlayer');
  await host.locator('#start-game-btn').waitFor({ state: 'visible', timeout: 10000 });
  await host.click('#start-game-btn', { force: true });
  await host.locator('#app-container').waitFor({ state: 'visible', timeout: 12000 });

  await host.evaluate(() => window._socket.emit('debug_inject_to_party', { cardId: 'card_016' }));
  await host.waitForTimeout(250);
  await host.evaluate(() => window._socket.emit('use_hero_skill', { cardId: 'card_016', isFree: true }));
  await host.waitForTimeout(80);
  await host.evaluate(() => window._socket.emit('execute_roll'));
  await host.locator('#dice-container .sprite-anim-layer').first().waitFor({ state: 'attached', timeout: 5000 });

  const samples = await host.evaluate(async () => {
    const out = [];
    const t0 = performance.now();
    for (let i = 0; i < 14; i++) {
      const el = document.querySelector('#dice-container .sprite-anim-layer:last-child');
      out.push({
        t: Math.round(performance.now() - t0),
        pos: el ? getComputedStyle(el).backgroundPosition : 'GONE',
        size: el ? getComputedStyle(el).backgroundSize : '',
        rootCount: document.querySelectorAll('#dice-container .sprite-anim-root').length,
      });
      await new Promise(r => setTimeout(r, 60));
    }
    return out;
  });
  console.log(JSON.stringify(samples, null, 1));
  await c1.close(); await c2.close(); await browser.close();
})();
