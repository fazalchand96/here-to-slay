// Build the six class crest badges from the card art we already generated.
//
// A Party Leader has to show WHICH class it leads, so each class needs a badge.
// Rather than generate new icons (and burn image quota, and risk a style drift),
// crop the class animal's head straight out of a representative hero's artwork.
// The badge is then guaranteed to match the deck's art exactly.
//
// Output: public/assets/skin/icons/crest-v2/<class>.png — a circular badge with a
// coloured ring in the class colour, transparent outside the circle.
//
//   node scripts/crests-from-art.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const ART = path.join(ROOT, 'public', 'assets', 'skin', 'cards', 'art');
const OUT = path.join(ROOT, 'public', 'assets', 'skin', 'icons', 'crest-v2');

const SIZE = 160;       // final badge
const RING = 8;         // ring thickness

// Representative hero per class + the head crop within its 2:3 artwork, given as
// fractions of the source image. Heads sit high and centre; tuned per card.
const CLASSES = [
  { cls: 'fighter',  id: 'card_022', colour: '#e05a4a', cx: 0.50, cy: 0.42, s: 0.52 }, // Qi Bear
  { cls: 'bard',     id: 'card_030', colour: '#e89a3a', cx: 0.45, cy: 0.42, s: 0.52 }, // Peanut
  { cls: 'guardian', id: 'card_037', colour: '#e8c84a', cx: 0.50, cy: 0.40, s: 0.54 }, // Radiant Horn
  { cls: 'ranger',   id: 'card_040', colour: '#5ab85a', cx: 0.47, cy: 0.42, s: 0.52 }, // Bullseye
  { cls: 'thief',    id: 'card_049', colour: '#4a90d9', cx: 0.50, cy: 0.42, s: 0.52 }, // Meowzio
  { cls: 'wizard',   id: 'card_056', colour: '#9a5ad9', cx: 0.50, cy: 0.42, s: 0.52 }, // Bun Bun
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const circle = Buffer.from(
    `<svg width="${SIZE}" height="${SIZE}"><circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${SIZE / 2}" fill="#fff"/></svg>`
  );

  for (const c of CLASSES) {
    const src = path.join(ART, `${c.id}.png`);
    if (!fs.existsSync(src)) { console.warn(`skip ${c.cls}: missing ${c.id}.png`); continue; }

    const { width: W, height: H } = await sharp(src).metadata();
    const side = Math.round(Math.min(W, H) * c.s);
    const left = clamp(Math.round(W * c.cx - side / 2), 0, W - side);
    const top = clamp(Math.round(H * c.cy - side / 2), 0, H - side);

    const head = await sharp(src)
      .extract({ left, top, width: side, height: side })
      .resize(SIZE, SIZE, { fit: 'cover' })
      .ensureAlpha()
      .composite([{ input: circle, blend: 'dest-in' }])   // clip to a circle
      .png()
      .toBuffer();

    // Ring in the class colour, drawn over the clipped head.
    const ring = Buffer.from(
      `<svg width="${SIZE}" height="${SIZE}">
         <circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${SIZE / 2 - RING / 2}"
                 fill="none" stroke="${c.colour}" stroke-width="${RING}"/>
         <circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${SIZE / 2 - RING - 1.5}"
                 fill="none" stroke="rgba(0,0,0,0.45)" stroke-width="2"/>
       </svg>`
    );

    const out = path.join(OUT, `${c.cls}.png`);
    await sharp(head).composite([{ input: ring }]).png().toFile(out);
    console.log(`${c.cls.padEnd(9)} <- ${c.id}  crop ${side}px @ (${left},${top})  -> ${path.basename(out)}`);
  }
  console.log(`\n${CLASSES.length} crest(s) written to ${path.relative(ROOT, OUT)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
