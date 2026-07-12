// Drive the ?align=1 dev tool end-to-end: load a game, open the tool, select the
// draw pile, drag it, and read back the CSS it emits.
const { chromium } = require('@playwright/test');
const PORT = process.env.CAP_PORT || '3100';
const URL = `http://127.0.0.1:${PORT}/?align=1`;
const OUT = process.env.OUT || 'screenshots/align-tool.png';

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
  host.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  await host.goto(URL, { waitUntil: 'domcontentloaded' });
  await p2.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'domcontentloaded' });
  await rollLeader(host, 'HostPlayer');
  await rollLeader(p2, 'GuestPlayer');
  await host.locator('#start-game-btn').waitFor({ state: 'visible', timeout: 10000 });
  await host.click('#start-game-btn', { force: true });
  await host.locator('#app-container').waitFor({ state: 'visible', timeout: 12000 });
  await host.waitForTimeout(1500);

  // 1. tool appears only once the board is up
  await host.locator('#__align-panel').waitFor({ state: 'visible', timeout: 5000 });
  console.log('panel visible:', await host.locator('#__align-panel').isVisible());

  // 2. baseline CSS for the draw pile
  const before = await host.locator('#__a-out').inputValue();

  // 3. drag the draw pile 20px right / 10px down
  const box = await host.locator('#main-deck').boundingBox();
  await host.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await host.mouse.down();
  await host.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 10, { steps: 8 });
  await host.mouse.up();
  await host.waitForTimeout(200);

  // 4. rotate + tilt via the sliders
  await host.locator('#__a-rot').fill('4');
  await host.locator('#__a-rot').dispatchEvent('input');
  await host.locator('#__a-tilt').fill('7');
  await host.locator('#__a-tilt').dispatchEvent('input');
  await host.waitForTimeout(200);

  const after = await host.locator('#__a-out').inputValue();
  const inline = await host.locator('#main-deck').getAttribute('style');

  // the drag must actually change left/top, otherwise the tool is a no-op
  const num = (css, prop) => parseFloat(new RegExp(`${prop}: *(-?[\\d.]+)%`).exec(css)?.[1] ?? 'NaN');
  const moved = num(after, 'left') !== num(before, 'left') || num(after, 'top') !== num(before, 'top');
  console.log(`drag moved element: ${moved}  (left ${num(before,'left')} -> ${num(after,'left')}, top ${num(before,'top')} -> ${num(after,'top')})`);
  if (!moved) { console.error('FAIL: dragging did not move the element'); process.exitCode = 1; }
  if (/NaN|width: 0px|height: 0px/.test(after)) { console.error('FAIL: bad geometry in CSS'); process.exitCode = 1; }

  // 5. grid toggle
  await host.locator('#__a-grid').click({ force: true });
  await host.waitForTimeout(150);
  const gridOn = await host.locator('#__align-grid').count();

  console.log('\n--- CSS before drag ---\n' + before);
  console.log('\n--- CSS after drag+rotate+tilt ---\n' + after);
  console.log('\ninline style applied:', inline);
  console.log('grid overlay present:', gridOn === 1);
  console.log('\npageerrors:', errs.length ? errs.slice(0, 5) : 'none');

  await host.screenshot({ path: OUT });
  console.log('shot ->', OUT);
  await browser.close();
})();
