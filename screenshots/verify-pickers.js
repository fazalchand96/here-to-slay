// Verify the picker text fix: open the mandatory-discard (Beary Wise) modal in a
// real 2p game and confirm each card shows name/type/effect, not just art.
const { chromium } = require('@playwright/test');
const PORT = process.env.CAP_PORT || '3100';
const URL = `http://127.0.0.1:${PORT}`;
const OUT = process.env.OUT || 'screenshots/fit/verify-picker-discard.png';
const VP = process.env.CAP_W ? { width: +process.env.CAP_W, height: +process.env.CAP_H } : { width: 844, height: 390 };

async function rollLeader(page, name) {
  await page.fill('#player-name-input', name);
  await page.getByText('ROLL FOR LEADER').click();
  await page.locator('#player-name-input').waitFor({ state: 'hidden', timeout: 10000 });
}

(async () => {
  const browser = await chromium.launch();
  const opts = { viewport: VP, hasTouch: true, serviceWorkers: 'block', deviceScaleFactor: 2 };
  const c1 = await browser.newContext(opts); const c2 = await browser.newContext(opts);
  const host = await c1.newPage(); const guest = await c2.newPage();
  const errs = []; host.on('pageerror', e => errs.push(e.message));
  await host.goto(URL, { waitUntil: 'domcontentloaded' });
  await guest.goto(URL, { waitUntil: 'domcontentloaded' });
  await rollLeader(host, 'HostPlayer'); await rollLeader(guest, 'GuestPlayer');
  await host.locator('#start-game-btn').waitFor({ state: 'visible', timeout: 10000 });
  await host.click('#start-game-btn', { force: true });
  await host.locator('#app-container').waitFor({ state: 'visible', timeout: 12000 });
  await host.waitForTimeout(1200);

  // Trigger the mandatory-discard (MULTI_DISCARD) modal for the host, using the
  // host's real dealt hand. renderGlobalActionPrompt is a global fn in app.js.
  const info = await host.evaluate(() => {
    const me = window._socket.id;
    renderGlobalActionPrompt({ type: 'MULTI_DISCARD', pendingPlayerIds: [me] });
    const cards = document.querySelectorAll('#mandatory-discard-cards .peek-card-wrap');
    const first = cards[0];
    return {
      count: cards.length,
      hasDetails: !!(first && first.querySelector('.peek-card-effect')),
      firstName: first && first.querySelector('.peek-card-name')?.textContent,
      firstEffect: first && first.querySelector('.peek-card-effect')?.textContent?.slice(0, 40),
      hasButton: !!(first && first.querySelector('.peek-select-btn')),
    };
  });
  await host.waitForTimeout(400);
  await host.screenshot({ path: OUT });
  console.log('picker verify:', JSON.stringify(info), 'pageerrors:', errs.length ? errs.slice(0,3) : 'none');
  await c1.close(); await c2.close(); await browser.close();
})();
