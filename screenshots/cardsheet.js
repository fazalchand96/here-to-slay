// Card-art crop review harness.
//   node screenshots/cardsheet.js
// Reads cards.json + an optional per-card crop map (screenshots/art_crops.json),
// generates public/_cardsheet.html (renders every card through the REAL /style.css
// and frame assets), then screenshots one PNG per card type into screenshots/sheet/.
// Iterate: eyeball a type's sheet -> add {id:{pos,size}} entries to art_crops.json
// -> re-run -> repeat. CAP_PORT selects the already-running static server.
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.CAP_PORT || '3100';
const cards = JSON.parse(fs.readFileSync(path.join(ROOT, 'cards.json'), 'utf-8'));

// Single source of truth: pull the ART_CROP overrides straight out of app.js so the
// sheet always reflects exactly what the game renders.
function loadCrops() {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf-8');
  const m = src.match(/const ART_CROP\s*=\s*(\{[\s\S]*?\n\});/);
  if (!m) return {};
  // eslint-disable-next-line no-new-func
  return Function(`"use strict"; return (${m[1]});`)();
}
const crops = loadCrops();

const slug = (s) => (s || 'card').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Group cards by a review bucket (type), skipping party leaders (shown full, no crop).
const buckets = {};
for (const c of cards) {
  if (/Party Leader/i.test(c.type)) continue;
  const t = slug(c.type);
  (buckets[t] ||= []).push(c);
}

function cardHtml(c) {
  const typeSlug = slug(c.type);
  const variant = /Monster/i.test(c.type) ? ' card-monster' : '';
  const crop = crops[c.id] || {};
  const vars = [];
  if (crop.pos) vars.push(`--art-pos:${crop.pos}`);
  if (crop.size) vars.push(`--art-size:${crop.size}`);
  const style = vars.length ? ` style="${vars.join(';')}"` : '';
  const localArt = `/assets/skin/cards/art-web/${c.id}.webp`;
  return `
    <div class="cell">
      <div class="card type-${typeSlug}${variant}"${style}>
        <div class="card-face">
          <div class="card-type">${c.type}</div>
          <div class="card-img has-art" style="background-image:url('${localArt}')"></div>
          <div class="card-info"><div class="card-name">${c.name}</div></div>
        </div>
      </div>
      <div class="cap">${c.id} · ${c.name}</div>
    </div>`;
}

let body = '';
const mixed = Object.values(buckets).map((list) => list[0]).filter(Boolean);
body += `<section id="sec-mixed"><h2>mixed card types (${mixed.length})</h2><div class="grid">${mixed.map(cardHtml).join('')}</div></section>`;
for (const [type, list] of Object.entries(buckets)) {
  body += `<section id="sec-${type}"><h2>${type} (${list.length})</h2><div class="grid">${list.map(cardHtml).join('')}</div></section>`;
}

const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css">
<style>
  body{background:#1c140d;margin:0;padding:16px;font-family:sans-serif;}
  h2{color:#f6cf72;text-transform:capitalize;margin:18px 0 8px;font-size:16px;}
  .grid{display:grid;grid-template-columns:repeat(8,1fr);gap:10px 8px;}
  .cell{display:flex;flex-direction:column;align-items:center;}
  .sheet .card,.grid .card{height:150px!important;width:107px!important;margin:0!important;flex:0 0 auto!important;}
  .cap{color:#cbb48a;font-size:9px;margin-top:3px;text-align:center;max-width:107px;line-height:1.1;}
</style></head><body class="sheet">${body}</body></html>`;

const outHtml = path.join(ROOT, 'public', '_cardsheet.html');
fs.writeFileSync(outHtml, html);
console.log('wrote', outHtml);

(async () => {
  const outDir = path.join(__dirname, 'sheet');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newContext({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 2 }).then(c => c.newPage());
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/_cardsheet.html`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.locator('#sec-mixed').screenshot({ path: path.join(outDir, 'mixed-card-types.png') });
  console.log('shot mixed-card-types');
  for (const type of Object.keys(buckets)) {
    const sec = page.locator(`#sec-${type}`);
    await sec.screenshot({ path: path.join(outDir, `${type}.png`) });
    console.log('shot', type);
  }
  console.log('pageerrors:', errs.length ? errs.slice(0, 3) : 'none');
  await browser.close();
})();
