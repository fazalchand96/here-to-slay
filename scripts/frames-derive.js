// Interim frames for the two card types that never had one.
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
// Only writes files that do not already exist, so it will never clobber the real
// generated frames once they are installed.
//
//   node scripts/frames-derive.js [--force]

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const FRAMES = path.join(__dirname, '..', 'public', 'assets', 'skin', 'frames');
const force = process.argv.includes('--force');

// Hue-rotation shifts the parchment as much as the metal (green -> pink), so tint
// instead: it preserves luminance and recolours the whole plate, which reads as a
// single anodised metal. The leader's top medallion is covered at runtime by the
// class crest, so keeping hero's shield underneath is harmless.
const DERIVED = [
  { from: 'hero.png', to: 'leader.png', tint: '#e5b64b', brightness: 1.06 }, // royal gold
  { from: 'item.png', to: 'cursed.png', tint: '#5f8a3a', brightness: 0.70 }, // sickly green
];

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
}

main().catch((e) => { console.error(e); process.exit(1); });
