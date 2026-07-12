// Compress the generated card art for the web.
//
// Codex writes full-size illustrations (~1024x1536, ~2.5 MB each) to
//   public/assets/skin/cards/art/<card_id>.png
// which is far too heavy for the PWA — the on-screen card art window is only
// ~60x86 CSS px. This resizes them to 512x768 WebP (~60-90 KB each) into
//   public/assets/skin/cards/art-web/<card_id>.webp
// which is what the game actually loads (see loadCards() in server.js).
//
// Safe to re-run: it skips any output that is already newer than its source, so
// it can be run repeatedly while Codex is still generating the rest.
//
//   node scripts/compress-art.js            # only new/changed art
//   node scripts/compress-art.js --force    # rebuild everything

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SRC = path.join(__dirname, '..', 'public', 'assets', 'skin', 'cards', 'art');
const OUT = path.join(__dirname, '..', 'public', 'assets', 'skin', 'cards', 'art-web');
const WIDTH = 512;
const HEIGHT = 768;
const QUALITY = 82;
const force = process.argv.includes('--force');

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error('No source art dir:', SRC);
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const sources = fs.readdirSync(SRC).filter((f) => f.toLowerCase().endsWith('.png'));
  let built = 0, skipped = 0, bytesIn = 0, bytesOut = 0;

  for (const file of sources) {
    const id = path.basename(file, '.png');
    const src = path.join(SRC, file);
    const out = path.join(OUT, `${id}.webp`);

    const sStat = fs.statSync(src);
    if (!force && fs.existsSync(out) && fs.statSync(out).mtimeMs >= sStat.mtimeMs) {
      skipped++;
      bytesIn += sStat.size;
      bytesOut += fs.statSync(out).size;
      continue;
    }

    await sharp(src)
      .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'attention' })
      .webp({ quality: QUALITY })
      .toFile(out);

    built++;
    bytesIn += sStat.size;
    bytesOut += fs.statSync(out).size;
  }

  const mb = (b) => (b / 1024 / 1024).toFixed(1) + ' MB';
  console.log(`art: ${sources.length} source(s) — built ${built}, skipped ${skipped}`);
  console.log(`size: ${mb(bytesIn)} -> ${mb(bytesOut)} (${(bytesOut / bytesIn * 100).toFixed(1)}%)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
