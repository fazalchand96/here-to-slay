// Proof capture for the real hero-skill -> execute_roll socket flow.
const { chromium } = require('@playwright/test');

const PORT = process.env.CAP_PORT || '3100';
const URL = `http://127.0.0.1:${PORT}`;
const OUT = process.env.OUT_DIR || 'screenshots/fit';

async function rollLeader(page, name) {
  await page.fill('#player-name-input', name);
  await page.getByText('ROLL FOR LEADER').click();
  await page.locator('#player-name-input').waitFor({ state: 'hidden', timeout: 10000 });
}

(async () => {
  const browser = await chromium.launch();
  const opts = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, serviceWorkers: 'block' };
  const c1 = await browser.newContext(opts);
  const c2 = await browser.newContext(opts);
  const host = await c1.newPage();
  const guest = await c2.newPage();
  const errors = [];
  host.on('pageerror', e => errors.push(e.message));

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

  await host.locator('#dice-container .sprite-anim-root').waitFor({ state: 'visible', timeout: 5000 });
  await host.waitForTimeout(20);
  await host.screenshot({ path: `${OUT}/step2-dice-mid-20ms.png` });
  await host.waitForTimeout(80);
  await host.screenshot({ path: `${OUT}/step2-dice-mid-100ms.png` });
  await host.waitForTimeout(80);
  await host.screenshot({ path: `${OUT}/step2-dice-mid-180ms.png` });
  await host.locator('#dice-container .sprite-anim-root').waitFor({ state: 'detached', timeout: 5000 });
  await host.waitForTimeout(350);
  await host.screenshot({ path: `${OUT}/step2-dice-settled.png` });

  console.log('dice proof -> pageerrors:', errors.length ? errors : 'none');
  await c1.close(); await c2.close(); await browser.close();
})();
