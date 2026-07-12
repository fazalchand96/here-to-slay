// Real-flow proof for the private hand picker and active-monster requirements.
// Uses the already-running capture server (CAP_PORT, default 3100); starts no server.
const { chromium } = require('@playwright/test');

const PORT = process.env.CAP_PORT || '3100';
const URL = `http://127.0.0.1:${PORT}`;
const OUT = process.env.OUT_DIR || 'screenshots/fit';

async function join(page, name) {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.fill('#player-name-input', name);
  await page.getByText('ROLL FOR LEADER').click();
  await page.locator('#player-name-input').waitFor({ state: 'hidden', timeout: 10000 });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const hostContext = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, serviceWorkers: 'block' });
  const guestContext = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, serviceWorkers: 'block' });
  const portraitContext = await browser.newContext({ viewport: { width: 412, height: 870 }, hasTouch: true, serviceWorkers: 'block' });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const portrait = await portraitContext.newPage();
  const errors = [];
  host.on('pageerror', error => errors.push(error.message));

  await join(host, 'PickerHost');
  await join(guest, 'PickerGuest');
  await join(portrait, 'PortraitObserver');
  await host.locator('#start-game-btn').waitFor({ state: 'visible', timeout: 10000 });
  await host.click('#start-game-btn', { force: true });
  await host.locator('#app-container').waitFor({ state: 'visible', timeout: 12000 });

  // Silent Shadow is the real "look at another hand, choose one" flow.
  await host.evaluate(() => window._socket.emit('debug_inject_to_party', { cardId: 'card_052' }));
  await host.waitForTimeout(150);
  await host.evaluate(() => window._socket.emit('debug_force_next_roll', { roll1: 6, roll2: 6 }));
  await host.evaluate(() => window._socket.emit('use_hero_skill', { cardId: 'card_052', isFree: true }));
  await host.waitForFunction(() => window.latestGameState?.state === 'WAITING_TO_ROLL');
  await host.locator('#manual-roll-btn').click({ force: true });
  await host.waitForFunction(() => window.latestGameState?.state === 'WAITING_FOR_MODIFIERS');
  await host.locator('#dice-pass-btn:visible').click({ force: true });
  await guest.locator('#dice-pass-btn:visible').click({ force: true });
  await portrait.locator('#dice-pass-btn:visible').click({ force: true });
  await host.waitForFunction(() => window.latestGameState?.state === 'WAITING_FOR_SKILL_TARGET');
  await host.locator('#opponents-bar .opponent-chip').first().click({ force: true });
  await host.locator('#deck-peek-modal:not(.hidden)').waitFor({ state: 'visible', timeout: 5000 });
  await host.locator('.peek-card-details').first().waitFor({ state: 'visible' });

  const pickerProof = await host.locator('.peek-card-details').evaluateAll(nodes => nodes.map(node => ({
    name: node.querySelector('.peek-card-name')?.textContent.trim(),
    type: node.querySelector('.peek-card-type')?.textContent.trim(),
    effect: node.querySelector('.peek-card-effect')?.textContent.trim(),
  })));
  if (!pickerProof.length || pickerProof.some(card => !card.name || !card.type || !card.effect)) {
    throw new Error(`picker text incomplete: ${JSON.stringify(pickerProof)}`);
  }
  await host.screenshot({ path: `${OUT}/ui-bug-a-steal-picker.png` });

  await host.evaluate(() => document.getElementById('deck-peek-modal')?.classList.add('hidden'));
  await host.waitForTimeout(150);
  const landscapeReqs = await host.locator('#active-monsters .monster-requirement-badge').allTextContents();
  if (landscapeReqs.length !== 3 || landscapeReqs.some(text => !/^Req:\s*\S/.test(text))) {
    throw new Error(`landscape monster requirements missing: ${JSON.stringify(landscapeReqs)}`);
  }
  await host.screenshot({ path: `${OUT}/ui-bug-b-monster-requirements-landscape.png` });

  const portraitReqs = await portrait.locator('#active-monsters .monster-requirement-badge').allTextContents();
  if (portraitReqs.length !== 3 || portraitReqs.some(text => !/^Req:\s*\S/.test(text))) {
    throw new Error(`portrait monster requirements missing: ${JSON.stringify(portraitReqs)}`);
  }
  await portrait.screenshot({ path: `${OUT}/ui-bug-b-monster-requirements-portrait.png` });

  console.log(JSON.stringify({ pickerProof, landscapeReqs, portraitReqs, pageErrors: errors }, null, 2));
  await hostContext.close();
  await guestContext.close();
  await portraitContext.close();
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
