// Real attackMonster -> execute_roll proof for Batch 3a monsters.
const { chromium } = require('@playwright/test');
const PORT = process.env.CAP_PORT || '3100';
const URL = `http://127.0.0.1:${PORT}`;
const OUT = process.env.OUT_DIR || 'screenshots/fit';
const TARGETS = new Set(process.env.MONSTER_IDS
  ? process.env.MONSTER_IDS.split(',')
  : (process.env.MONSTER_BATCH === '3b'
    ? ['card_009','card_010','card_011','card_012','card_013','card_014','card_015']
    : ['card_001','card_002','card_003','card_004','card_005','card_006','card_007','card_008']));
const PARTY = ['card_023','card_029','card_034','card_042','card_050','card_056'];

async function leader(page, name) {
  await page.fill('#player-name-input', name);
  await page.getByText('ROLL FOR LEADER').click();
  await page.locator('#player-name-input').waitFor({ state: 'hidden', timeout: 10000 });
}

(async () => {
  const browser = await chromium.launch();
  for (let game = 1; TARGETS.size && game <= 80; game++) {
    const opts = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, serviceWorkers: 'block' };
    const c1 = await browser.newContext(opts), c2 = await browser.newContext(opts);
    const host = await c1.newPage(), guest = await c2.newPage();
    const errors = []; host.on('pageerror', e => errors.push(e.message));
    try {
      await host.goto(URL, { waitUntil: 'domcontentloaded' }); await guest.goto(URL, { waitUntil: 'domcontentloaded' });
      await leader(host, `Hunter-${game}`); await leader(guest, `Guest-${game}`);
      await host.locator('#start-game-btn').waitFor({ state: 'visible', timeout: 10000 });
      await host.click('#start-game-btn', { force: true });
      await host.locator('#app-container').waitFor({ state: 'visible', timeout: 12000 });
      const active = await host.evaluate(() => (window.latestGameState?.activeMonsters || []).map(m => m.id));
      const target = active.find(id => TARGETS.has(id));
      if (!target) continue;
      for (const id of PARTY) {
        await host.evaluate(cid => window._socket.emit('debug_inject_to_party', { cardId: cid }), id);
        await host.waitForTimeout(45);
      }
      await host.evaluate(id => window._socket.emit('attackMonster', id), target);
      await host.waitForFunction(() => window.latestGameState?.state === 'WAITING_TO_ROLL', null, { timeout: 3000 });
      await host.evaluate(() => window._socket.emit('execute_roll'));
      await host.waitForFunction(() => window.latestGameState?.state === 'WAITING_FOR_MODIFIERS', null, { timeout: 5000 });
      await host.waitForTimeout(1100);
      await host.evaluate(() => window._socket.emit('submit_modifier_action', { action: 'PASS' }));
      await guest.evaluate(() => window._socket.emit('submit_modifier_action', { action: 'PASS' }));
      const sprite = host.locator(`#active-monsters .card[data-id="${target}"] .sprite-anim-root`);
      await sprite.waitFor({ state: 'visible', timeout: 3500 });
      await host.waitForTimeout(180);
      const pos = await sprite.locator('.monster-strike-main').evaluate(el => getComputedStyle(el).backgroundPositionX);
      const slain = await host.evaluate(id => !(window.latestGameState?.activeMonsters || []).some(m => m.id === id), target);
      await host.screenshot({ path: `${OUT}/step2-monster-${target}.png` });
      console.log(target, 'DONE', slain ? 'SLAY' : 'SURVIVED', 'backgroundPositionX', pos, 'pageerrors', errors.length ? errors : 'none');
      TARGETS.delete(target);
    } catch (e) {
      console.log('game', game, 'retry', e.message.split('\n')[0]);
    } finally {
      await c1.close(); await c2.close();
      await new Promise(r => setTimeout(r, 450));
    }
  }
  await browser.close();
  if (TARGETS.size) throw new Error(`Uncaptured monsters: ${[...TARGETS].join(', ')}`);
})();
