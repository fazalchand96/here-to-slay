// Click a party card to open the inspector, and assert it shows the generated
// art (art-web/*.webp) rather than the old watermarked wiki scan.
const { chromium } = require('@playwright/test');
const PORT = process.env.CAP_PORT || '3100';
const URL = `http://127.0.0.1:${PORT}`;
const OUT = process.env.OUT || 'screenshots/inspect-art.png';
const CARD = process.env.CARD || 'card_040'; // Bullseye — has generated art

async function rollLeader(page, name) {
  await page.fill('#player-name-input', name);
  await page.getByText('ROLL FOR LEADER').click();
  await page.locator('#player-name-input').waitFor({ state: 'hidden', timeout: 10000 });
}

(async () => {
  const browser = await chromium.launch();
  const ctx = { viewport: { width: 844, height: 390 }, hasTouch: true, serviceWorkers: 'block', deviceScaleFactor: 2 };
  const c1 = await browser.newContext(ctx), c2 = await browser.newContext(ctx);
  const host = await c1.newPage(), p2 = await c2.newPage();
  const errs = [];
  host.on('pageerror', (e) => errs.push(e.message));

  await host.goto(URL, { waitUntil: 'domcontentloaded' });
  await p2.goto(URL, { waitUntil: 'domcontentloaded' });
  await rollLeader(host, 'HostPlayer');
  await rollLeader(p2, 'GuestPlayer');
  await host.locator('#start-game-btn').waitFor({ state: 'visible', timeout: 10000 });
  await host.click('#start-game-btn', { force: true });
  await host.locator('#app-container').waitFor({ state: 'visible', timeout: 12000 });

  await host.evaluate((cid) => window._socket.emit('debug_inject_to_party', { cardId: cid }), CARD);
  await host.waitForTimeout(900);

  // board card should already use the art
  const boardBg = await host.locator(`#player-party .card[data-id="${CARD}"] .card-img`)
    .evaluate((n) => getComputedStyle(n).backgroundImage);

  // open the inspector
  await host.evaluate((cid) => window.inspectCard(cid), CARD);
  await host.waitForTimeout(700);

  const img = host.locator('#inspector-modal-image');
  const visible = await img.isVisible();
  const src = await img.getAttribute('src');
  const hasArtClass = await img.evaluate((n) => n.classList.contains('has-art'));
  const name = await host.locator('#inspector-modal-name').innerText();
  const desc = await host.locator('#inspector-modal-description').innerText();

  console.log('board card-img background :', boardBg);
  console.log('inspector visible        :', visible);
  console.log('inspector src            :', src);
  console.log('inspector .has-art       :', hasArtClass);
  console.log('inspector name           :', name);
  console.log('inspector desc (len)     :', (desc || '').length);
  console.log('pageerrors               :', errs.length ? errs.slice(0, 3) : 'none');

  const ok = /art-web\//.test(src || '') && hasArtClass && visible
    && /art-web\//.test(boardBg || '') && (desc || '').length > 0;
  console.log(ok ? '\nPASS: inspector shows generated art, rules text still present'
                 : '\nFAIL: inspector not using generated art');
  if (!ok) process.exitCode = 1;

  await host.screenshot({ path: OUT });
  await browser.close();
})();
