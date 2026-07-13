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
//   node scripts/frames-derive.js [--force] [--heroes-only]

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const FRAMES = path.join(__dirname, '..', 'public', 'assets', 'skin', 'frames');
const CRESTS = path.join(__dirname, '..', 'public', 'assets', 'skin', 'icons', 'crest-v2');
const force = process.argv.includes('--force');
const heroesOnly = process.argv.includes('--heroes-only');

// Hue-rotation shifts the parchment as much as the metal (green -> pink), so tint
// instead: it preserves luminance and recolours the whole plate, which reads as a
// single anodised metal. The leader's top medallion is covered at runtime by the
// class crest, so keeping hero's shield underneath is harmless.
const DERIVED = [
  { from: 'hero.png', to: 'leader.png', tint: '#e5b64b', brightness: 1.06 }, // royal gold
  { from: 'item.png', to: 'cursed.png', tint: '#5f8a3a', brightness: 0.70 }, // sickly green
];

// Class Hero frames use the same luminance-preserving tint as the interim
// frames above. The source template's generic shield is smoothed away under a
// feathered silhouette mask before the matching crest is seated in its place.
// Bard and Guardian need extra saturation because their hues are close to the
// source frame's bronze/brass and otherwise read as brown/olive.
const HERO_CLASSES = [
  { name: 'fighter', tint: '#e05a4a' },
  { name: 'bard', tint: '#e89a3a', saturation: 1.45 },
  // CSS accent: #e8c84a. A lighter render tint keeps shaded metal gold
  // instead of pushing its dark yellow values toward olive.
  { name: 'guardian', tint: '#ffd84a', saturation: 1.45, brightness: 1.08 },
  { name: 'ranger', tint: '#5ab85a' },
  { name: 'thief', tint: '#4a90d9' },
  { name: 'wizard', tint: '#9a5ad9' },
];
const HERO_WIDTH = 364;
const HERO_HEIGHT = 558;
const CREST_PLACEMENT = {
  left: 130,
  top: 24,
  size: 104,
};
const SHIELD_MASK = Buffer.from(`
  <svg width="${HERO_WIDTH}" height="${HERO_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <path d="M105 0H259V44L244 55V96L226 113L182 143L138 113L120 96V55L105 44Z" fill="#fff"/>
  </svg>
`);

async function eraseShield(tintedFrame) {
  // A large median filter removes the shield's hard embossed edges while
  // retaining the local ribbon/metal colour; the blurred mask feathers that
  // sampled texture back into the untouched frame with no visible seam.
  const sampledRibbon = await sharp(tintedFrame)
    .median(61)
    .blur(8)
    .png()
    .toBuffer();
  const featheredMask = await sharp(SHIELD_MASK)
    .blur(18)
    .png()
    .toBuffer();

  return sharp(sampledRibbon)
    .ensureAlpha()
    .composite([{ input: featheredMask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function main() {
  for (const d of heroesOnly ? [] : DERIVED) {
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
    const tintPipeline = sharp(hero).tint(heroClass.tint);
    if (heroClass.saturation || heroClass.brightness) {
      tintPipeline.modulate({
        saturation: heroClass.saturation || 1,
        brightness: heroClass.brightness || 1,
      });
    }
    const tintedFrame = await tintPipeline
      .png()
      .toBuffer();
    const shieldPatch = await eraseShield(tintedFrame);

    await sharp(tintedFrame)
      .composite([
        { input: shieldPatch, left: 0, top: 0, blend: 'over' },
        {
          input: crest,
          left: CREST_PLACEMENT.left,
          top: CREST_PLACEMENT.top,
          blend: 'over',
        },
      ])
      .png()
      .toFile(output + '.tmp');
    fs.renameSync(output + '.tmp', output);
    const adjustments = [
      `tint ${heroClass.tint}`,
      heroClass.saturation ? `saturation ${heroClass.saturation}` : null,
      heroClass.brightness ? `brightness ${heroClass.brightness}` : null,
    ].filter(Boolean).join(', ');
    console.log(`derived ${outputName} from hero.png (${adjustments}, shield erased, crest ${CREST_PLACEMENT.size}px at ${CREST_PLACEMENT.left},${CREST_PLACEMENT.top})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
