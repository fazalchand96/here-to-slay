// Real-flow proof for all six class skill-cast sheets.
const { chromium } = require('@playwright/test');
const PORT = process.env.CAP_PORT || '3100';
const URL = `http://127.0.0.1:${PORT}`;
const OUT = process.env.OUT_DIR || 'screenshots/fit';
const CASES = [
  ['fighter', 'card_023'], ['bard', 'card_029'], ['guardian', 'card_034'],
  ['ranger', 'card_042'], ['thief', 'card_050'], ['wizard', 'card_056']
];

async function leader(page, name) {
  await page.fill('#player-name-input', name);
  await page.getByText('ROLL FOR LEADER').click();
  await page.locator('#player-name-input').waitFor({ state: 'hidden', timeout: 10000 });
}

async function attempt(browser, slug, cardId, attemptNo) {
  const opts = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, serviceWorkers: 'block' };
  const c1 = await browser.newContext(opts), c2 = await browser.newContext(opts);
  const host = await c1.newPage(), guest = await c2.newPage();
  const errors = []; host.on('pageerror', e => errors.push(e.message));
  try {
    await host.goto(URL, { waitUntil: 'domcontentloaded' });
    await guest.goto(URL, { waitUntil: 'domcontentloaded' });
    await leader(host, `Host-${slug}-${attemptNo}`); await leader(guest, `Guest-${slug}-${attemptNo}`);
    await host.locator('#start-game-btn').waitFor({ state: 'visible', timeout: 10000 });
    await host.click('#start-game-btn', { force: true });
    await host.locator('#app-container').waitFor({ state: 'visible', timeout: 12000 });
    await host.evaluate(id => window._socket.emit('debug_inject_to_party', { cardId: id }), cardId);
    await host.waitForTimeout(250);
    await host.evaluate(id => window._socket.emit('use_hero_skill', { cardId: id, isFree: true }), cardId);
    await host.waitForTimeout(80);
    await host.evaluate(() => window._socket.emit('execute_roll'));
    await host.waitForFunction(() => window.latestGameState?.state === 'WAITING_FOR_MODIFIERS', null, { timeout: 5000 });
    await host.waitForTimeout(1100);
    await host.evaluate(() => window._socket.emit('submit_modifier_action', { action: 'PASS' }));
    await guest.evaluate(() => window._socket.emit('submit_modifier_action', { action: 'PASS' }));
    const sprite = host.locator(`#player-party .card[data-id="${cardId}"] .sprite-anim-root`);
    await sprite.waitFor({ state: 'visible', timeout: 2500 });
    await host.waitForTimeout(180);
    const sample = await sprite.locator('.cast-sprite-main').evaluate(el => getComputedStyle(el).backgroundPositionX);
    await host.screenshot({ path: `${OUT}/step2-cast-${slug}.png` });
    console.log(slug, 'SUCCESS', 'attempt', attemptNo, 'backgroundPositionX', sample, 'pageerrors', errors.length ? errors : 'none');
    return true;
  } catch (e) {
    console.log(slug, 'retry', attemptNo, e.message.split('\n')[0]);
    return false;
  } finally {
    await c1.close(); await c2.close();
    await new Promise(r => setTimeout(r, 500));
  }
}

(async () => {
  const browser = await chromium.launch();
  for (const [slug, cardId] of CASES) {
    let done = false;
    for (let n = 1; n <= 8 && !done; n++) done = await attempt(browser, slug, cardId, n);
    if (!done) throw new Error(`Could not capture successful ${slug} cast after 8 real rolls`);
  }
  await browser.close();
})();
