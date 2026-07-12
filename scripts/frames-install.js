// Install a generated frame set (frames/v2/*.png) as the live card frames.
//
// Codex generates large portrait frames; the game expects 364x558 RGBA PNGs whose
// transparent area is everything outside the rounded card silhouette. Image models
// return opaque rectangles, so we apply a rounded-corner alpha mask ourselves.
//
// The previous frames are backed up to frames/v1_backup/ before anything is
// overwritten, so this is reversible.
//
//   node scripts/frames-install.js          # install
//   node scripts/frames-install.js --check  # report only, write nothing

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const FRAMES = path.join(__dirname, '..', 'public', 'assets', 'skin', 'frames');
const SRC = path.join(FRAMES, 'v2');
const BACKUP = path.join(FRAMES, 'v1_backup');
const ICONS = path.join(__dirname, '..', 'public', 'assets', 'skin', 'icons');
const CREST_SRC = path.join(ICONS, 'crest-v2');
const W = 364, H = 558, RADIUS = 22;
const CREST = 128;

// v2 filename -> live frame filename
const NAMES = ['leader', 'hero', 'monster', 'magic', 'item', 'cursed', 'modifier', 'challenge'];
const CLASSES = ['fighter', 'bard', 'guardian', 'ranger', 'thief', 'wizard'];
const check = process.argv.includes('--check');

const mask = Buffer.from(
  `<svg width="${W}" height="${H}"><rect x="0" y="0" width="${W}" height="${H}" rx="${RADIUS}" ry="${RADIUS}" fill="#fff"/></svg>`
);
// Crests sit on the leader frame's medallion, so they must be circular with a
// transparent surround — the image model returns opaque squares.
const circle = Buffer.from(
  `<svg width="${CREST}" height="${CREST}"><circle cx="${CREST / 2}" cy="${CREST / 2}" r="${CREST / 2}" fill="#fff"/></svg>`
);

async function main() {
  if (!fs.existsSync(SRC)) { console.error('missing', SRC); process.exit(1); }

  const present = NAMES.filter((n) => fs.existsSync(path.join(SRC, `${n}.png`)));
  const absent = NAMES.filter((n) => !present.includes(n));
  console.log(`v2 frames present: ${present.length}/${NAMES.length}${absent.length ? ' — missing: ' + absent.join(', ') : ''}`);
  if (check) {
    for (const n of present) {
      const m = await sharp(path.join(SRC, `${n}.png`)).metadata();
      console.log(`  ${n.padEnd(10)} ${m.width}x${m.height} alpha:${!!m.hasAlpha}`);
    }
    return;
  }
  if (absent.length) { console.error('refusing to install a partial set'); process.exit(1); }

  fs.mkdirSync(BACKUP, { recursive: true });
  for (const f of fs.readdirSync(FRAMES)) {
    if (f.endsWith('.png') && !fs.existsSync(path.join(BACKUP, f))) {
      fs.copyFileSync(path.join(FRAMES, f), path.join(BACKUP, f));
    }
  }
  console.log(`backed up existing frames -> ${path.relative(process.cwd(), BACKUP)}`);

  for (const n of NAMES) {
    const out = path.join(FRAMES, `${n}.png`);
    await sharp(path.join(SRC, `${n}.png`))
      .resize(W, H, { fit: 'fill' })              // frames are a fixed aspect
      .ensureAlpha()
      .composite([{ input: mask, blend: 'dest-in' }]) // round the corners
      .png()
      .toFile(out + '.tmp');
    fs.renameSync(out + '.tmp', out);
    console.log(`installed ${n}.png  (${W}x${H})`);
  }

  // Class crests: square -> circular badge with transparent surround.
  const crests = CLASSES.filter((c) => fs.existsSync(path.join(CREST_SRC, `${c}.png`)));
  if (crests.length !== CLASSES.length) {
    console.warn(`WARNING: only ${crests.length}/${CLASSES.length} crests present — skipping missing: ` +
      CLASSES.filter((c) => !crests.includes(c)).join(', '));
  }
  for (const c of crests) {
    const out = path.join(CREST_SRC, `${c}.png`);
    await sharp(path.join(CREST_SRC, `${c}.png`))
      .resize(CREST, CREST, { fit: 'cover' })
      .ensureAlpha()
      .composite([{ input: circle, blend: 'dest-in' }])
      .png()
      .toFile(out + '.tmp');
    fs.renameSync(out + '.tmp', out);
    console.log(`installed crest ${c}.png (${CREST}x${CREST}, circular)`);
  }

  console.log('\ndone — bump CACHE_VERSION in public/sw.js so clients refetch.');
}

main().catch((e) => { console.error(e); process.exit(1); });
