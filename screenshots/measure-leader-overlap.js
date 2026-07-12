// Gate helper: portrait, 6-hero party — does the leader card intersect any
// party card or the party panel?
const { chromium } = require('@playwright/test');
const PORT = process.env.CAP_PORT || '3100';
const URL = `http://127.0.0.1:${PORT}`;
const PARTY = 'card_016,card_024,card_032,card_040,card_017,card_025'.split(',');

async function rollLeader(page, name) {
  await page.fill('#player-name-input', name);
  await page.getByText('ROLL FOR LEADER').click();
  await page.locator('#player-name-input').waitFor({ state: 'hidden', timeout: 10000 });
}

(async () => {
  const browser = await chromium.launch();
  const ctxOpts = { viewport: { width: 412, height: 870 }, hasTouch: true, serviceWorkers: 'block' };
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
  for (const id of PARTY) {
    await host.evaluate((cid) => window._socket.emit('debug_inject_to_party', { cardId: cid }), id);
    await host.waitForTimeout(120);
  }
  await host.waitForTimeout(1500);

  const report = await host.evaluate(() => {
    const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom }; };
    const leaderEl = document.querySelector('#leader-slot .card') || document.getElementById('leader-slot');
    const L = r(leaderEl);
    const out = { leader: L, overlaps: [] };
    document.querySelectorAll('#player-party .card').forEach((el, i) => {
      const C = r(el);
      const ox = Math.min(L.r, C.r) - Math.max(L.x, C.x);
      const oy = Math.min(L.b, C.b) - Math.max(L.y, C.y);
      if (ox > 0 && oy > 0) out.overlaps.push({ card: i, ox: +ox.toFixed(1), oy: +oy.toFixed(1) });
    });
    const panel = document.getElementById('player-party').getBoundingClientRect();
    out.panel = { x: panel.x, r: panel.right };
    out.leaderIntoPanelX = +(L.r - panel.x).toFixed(1);
    return out;
  });
  console.log(JSON.stringify(report, null, 1));
  await c1.close(); await c2.close(); await browser.close();
})();
