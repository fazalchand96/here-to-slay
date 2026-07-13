// Deterministically derive recoloured frames from the source templates.
//
// Party Leader was borrowing a card BACK (no art window) and Cursed Item was
// borrowing the Item frame, so a curse looked like a boon. Until the proper
// hand-painted set lands (scripts/frame-run-loop.sh), derive both by hue-shifting
// an existing frame that already has the correct anatomy and window geometry:
//
//   leader.png  <- hero.png   green  -> royal gold   (its medallion is covered at
//                                        runtime by the class crest overlay)
//   cursed.png  <- item.png   bronze -> sickly green, darkened
//
// Class Hero variants also bake their crest into the template itself. Only writes
// files that do not already exist, so it will never clobber replacement artwork
// once installed.
//
//   node scripts/frames-derive.js [--force]

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const FRAMES = path.join(__dirname, '..', 'public', 'assets', 'skin', 'frames');
const CRESTS = path.join(__dirname, '..', 'public', 'assets', 'skin', 'icons', 'crest-v2');
const force = process.argv.includes('--force');

// Hue-rotation shifts the parchment as much as the metal (green -> pink), so tint
// instead: it preserves luminance and recolours the whole plate, which reads as a
// single anodised metal. The leader's top medallion is covered at runtime by the
// class crest, so keeping hero's shield underneath is harmless.
const DERIVED = [
  { from: 'hero.png', to: 'leader.png', tint: '#e5b64b', brightness: 1.06 }, // royal gold
  { from: 'item.png', to: 'cursed.png', tint: '#5f8a3a', brightness: 0.70 }, // sickly green
];

// Class Hero frames use the same luminance-preserving tint as the interim
// frames above, then bake the matching crest into the already-validated
// top-left seal position from the card UI (3.5% left, 4% top, 22% wide).
// hero.png is 364x558, so those values resolve to 13x22 with an 80px crest.
const HERO_CLASSES = [
  { name: 'fighter', tint: '#e05a4a' },
  { name: 'bard', tint: '#e89a3a' },
  { name: 'guardian', tint: '#e8c84a' },
  { name: 'ranger', tint: '#5ab85a' },
  { name: 'thief', tint: '#4a90d9' },
  { name: 'wizard', tint: '#9a5ad9' },
];
const HERO_WIDTH = 364;
const HERO_HEIGHT = 558;
const CREST_PLACEMENT = {
  left: Math.round(HERO_WIDTH * 0.035),
  top: Math.round(HERO_HEIGHT * 0.04),
  size: Math.round(HERO_WIDTH * 0.22),
};

async function main() {
  for (const d of DERIVED) {
    const src = path.join(FRAMES, d.from);
    const dst = path.join(FRAMES, d.to);
    if (!fs.existsSync(src)) { console.warn(`skip ${d.to}: missing ${d.from}`); continue; }
    if (fs.existsSync(dst) && !force) { console.log(`skip ${d.to}: already exists (use --force)`); continue; }

    await sharp(src)
      .modulate({ brightness: d.brightness })
      .tint(d.tint)
      .png()
      .toFile(dst + '.tmp');
    fs.renameSync(dst + '.tmp', dst);
    console.log(`derived ${d.to} from ${d.from} (tint ${d.tint})`);
  }

  const hero = path.join(FRAMES, 'hero.png');
  const metadata = await sharp(hero).metadata();
  if (metadata.width !== HERO_WIDTH || metadata.height !== HERO_HEIGHT) {
    throw new Error(`hero.png changed size: expected ${HERO_WIDTH}x${HERO_HEIGHT}, got ${metadata.width}x${metadata.height}`);
  }

  for (const heroClass of HERO_CLASSES) {
    const outputName = `hero-${heroClass.name}.png`;
    const output = path.join(FRAMES, outputName);
    if (fs.existsSync(output) && !force) {
      console.log(`skip ${outputName}: already exists (use --force)`);
      continue;
    }

    const crest = await sharp(path.join(CRESTS, `${heroClass.name}.png`))
      .resize(CREST_PLACEMENT.size, CREST_PLACEMENT.size, {
        fit: 'contain',
        kernel: sharp.kernel.lanczos3,
      })
      .png()
      .toBuffer();
    const tintedFrame = await sharp(hero)
      .tint(heroClass.tint)
      .png()
      .toBuffer();

    await sharp(tintedFrame)
      .composite([{
        input: crest,
        left: CREST_PLACEMENT.left,
        top: CREST_PLACEMENT.top,
        blend: 'over',
      }])
      .png()
      .toFile(output + '.tmp');
    fs.renameSync(output + '.tmp', output);
    console.log(`derived ${outputName} from hero.png (tint ${heroClass.tint}, crest ${CREST_PLACEMENT.size}px at ${CREST_PLACEMENT.left},${CREST_PLACEMENT.top})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
