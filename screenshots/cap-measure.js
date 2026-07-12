// Portrait capture with a % grid overlaid on #game-board so carved-slot edges and
// element positions can be read in board-% units. CAP_PORT/OUT env.
const { chromium } = require('@playwright/test');
const PORT = process.env.CAP_PORT || '3100';
const URL = `http://127.0.0.1:${PORT}`;
const OUT = process.env.OUT || 'screenshots/measure.png';
const VW = parseInt(process.env.CAP_W || '412', 10);
const VH = parseInt(process.env.CAP_H || '870', 10);

async function rollLeader(page, name) {
  await page.fill('#player-name-input', name);
  await page.getByText('ROLL FOR LEADER').click();
  await page.locator('#player-name-input').waitFor({ state: 'hidden', timeout: 10000 });
}

(async () => {
  const browser = await chromium.launch();
  const ctxOpts = { viewport: { width: VW, height: VH }, hasTouch: true, serviceWorkers: 'block', deviceScaleFactor: 2 };
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
  for (const id of ['card_016','card_024','card_032','card_040']) {
    await host.evaluate((cid) => window._socket.emit('debug_inject_to_party', { cardId: cid }), id);
    await host.waitForTimeout(120);
  }
  await host.waitForTimeout(1200);
  // Overlay a % grid on the board (every 5%, bolder every 10% with labels).
  await host.addStyleTag({ content: `
    #__grid{position:absolute;inset:0;z-index:99999;pointer-events:none;}
    #__grid .l{position:absolute;background:rgba(0,255,255,.35);}
    #__grid .b{background:rgba(255,0,180,.6)!important;}
    #__grid span{position:absolute;color:#0ff;font:8px monospace;background:rgba(0,0,0,.6);padding:0 1px;}
  `});
  await host.evaluate(() => {
    const b = document.getElementById('game-board');
    b.style.position = 'relative';
    const g = document.createElement('div'); g.id = '__grid';
    for (let p = 0; p <= 100; p += 5) {
      const bold = p % 10 === 0;
      const v = document.createElement('div'); v.className = 'l' + (bold?' b':''); v.style.left = p+'%'; v.style.top=0; v.style.width='1px'; v.style.height='100%'; g.appendChild(v);
      const h = document.createElement('div'); h.className = 'l' + (bold?' b':''); h.style.top = p+'%'; h.style.left=0; h.style.height='1px'; h.style.width='100%'; g.appendChild(h);
      if (bold){ const sv=document.createElement('span'); sv.textContent=p; sv.style.left=p+'%'; sv.style.top='0'; g.appendChild(sv);
                 const sh=document.createElement('span'); sh.textContent=p; sh.style.top=p+'%'; sh.style.left='0'; g.appendChild(sh); }
    }
    b.appendChild(g);
  });
  await host.screenshot({ path: OUT });
  console.log(OUT, 'done');
  await browser.close();
})();
