// Portrait-only capture against an isolated server (PORT env, default 3100),
// output path from OUT env. Used for iterating the portrait board skin without
// colliding with the main :3000 server. Mirrors capture.js setup.
const { chromium } = require('@playwright/test');

// Override with CAP_PARTY=card_040,card_021,... to stage specific cards.
const PARTY = (process.env.CAP_PARTY || 'card_016,card_024,card_032,card_040').split(',');
const PORT = process.env.CAP_PORT || '3100';
const URL = `http://127.0.0.1:${PORT}`;
const OUT = process.env.OUT || 'screenshots/game-portrait.png';

async function rollLeader(page, name) {
  await page.fill('#player-name-input', name);
  await page.getByText('ROLL FOR LEADER').click();
  await page.locator('#player-name-input').waitFor({ state: 'hidden', timeout: 10000 });
}

(async () => {
  const browser = await chromium.launch();
  const viewport = { width: 412, height: 870 };
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
  const overlapCheck = await host.evaluate(() => {
    const rect = el => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const leader = rect(document.querySelector('#leader-slot .card'));
    const panel = rect(document.querySelector('#party-zone'));
    const cards = [...document.querySelectorAll('#player-party .card')].map((el, index) => {
      const card = rect(el);
      const overlapWidth = Math.max(0, Math.min(leader.right, card.right) - Math.max(leader.x, card.x));
      const overlapHeight = Math.max(0, Math.min(leader.bottom, card.bottom) - Math.max(leader.y, card.y));
      return { index, ...card, overlapWidth, overlapHeight, overlapArea: overlapWidth * overlapHeight };
    });
    return { partyCount: cards.length, leader, panel, cards, maxOverlapArea: Math.max(0, ...cards.map(c => c.overlapArea)) };
  });
  console.log('OVERLAP_CHECK', JSON.stringify(overlapCheck));
  await host.screenshot({ path: OUT });
  console.log(OUT, '-> pageerrors:', errs.length ? errs.slice(0, 5) : 'none');
  await c1.close();
  await c2.close();
  await browser.close();
})();
