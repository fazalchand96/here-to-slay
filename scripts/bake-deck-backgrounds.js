const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const SKIN = path.join(PUBLIC, 'assets', 'skin');
const CARD_BACK = path.join(SKIN, 'cards', 'back-main.png');
const BUTTONS = path.join(SKIN, 'buttons');

// Single source of truth for both Sharp compositing and the generated CSS
// hotspot. Centers preserve the values currently exported by ?align=1:
// landscape 6% + 14% * 52.5%, 13% + 63% * 30.3%;
// portrait 22% + 52% * 30%, 7% + 12% * 52%.
const LAYOUTS = {
  landscape: {
    source: 'premium-tabletop-landscape.png',
    output: 'premium-tabletop-landscape-deck-baked.png',
    width: 1672,
    height: 941,
    centerXPercent: 13.35,
    centerYPercent: 32.089,
    deckWidth: 160,
    deckHeight: 205,
    cssVars: {
      '--stage-width': '1672',
      '--stage-height': '941',
      '--deck-x': '13.4%',
      '--deck-y': '33.5%',
      '--deck-width': '10%',
      '--deck-height': '28.5%',
      '--discard-x': '11.5%',
      '--discard-y': '64%',
      '--discard-width': '10.5%',
      '--discard-height': '28%',
      '--ap-track-x': '87.8%',
      '--ap-track-y': '44.2%',
      '--ap-track-width': '3.6%',
      '--ap-track-height': '28%',
      '--ap-track-rotate': '-4deg',
    },
    actionButtons: [
      { image: 'draw-blue.png', rightPercent: 0.8, topPercent: 60, height: 114 },
      { image: 'reload-amber.png', rightPercent: 0.8, topPercent: 71.5, height: 114 },
      { image: 'end-seal.png', rightPercent: 2.8, topPercent: 82.5, height: 150 },
    ],
  },
  portrait: {
    source: 'premium-tabletop-portrait.png',
    output: 'premium-tabletop-portrait-deck-baked.png',
    width: 863,
    height: 1823,
    centerXPercent: 37.6,
    centerYPercent: 13.24,
    deckWidth: 130,
    deckHeight: 180,
    cssVars: {
      '--stage-width': '863',
      '--stage-height': '1823',
      '--deck-x': '36.4%',
      '--deck-y': '14.3%',
      '--deck-width': '19%',
      '--deck-height': '12.5%',
      '--discard-x': '60%',
      '--discard-y': '14.3%',
      '--discard-width': '19%',
      '--discard-height': '12.5%',
      '--ap-track-x': '85.2%',
      '--ap-track-y': '48.3%',
      '--ap-track-width': '4.5%',
      '--ap-track-height': '17%',
      '--ap-track-rotate': '-4deg',
    },
  },
};

async function makeLayer(width, height, brightness) {
  return sharp(CARD_BACK)
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .modulate({ brightness })
    .png()
    .toBuffer();
}

async function makeShadow(topLayer, width, height) {
  const alpha = await sharp(topLayer).ensureAlpha().extractChannel(3).blur(7).toBuffer();
  return sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).joinChannel(alpha).png().toBuffer();
}

async function makeButtonLayer(item) {
  return sharp(path.join(BUTTONS, item.image))
    .resize({ height: item.height, fit: 'inside', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
}

async function bake(layout) {
  const centerX = layout.width * layout.centerXPercent / 100;
  const centerY = layout.height * layout.centerYPercent / 100;
  const baseLeft = Math.round(centerX - layout.deckWidth / 2);
  const baseTop = Math.round(centerY - layout.deckHeight / 2);
  const offsets = [
    { x: 0.024, y: 0.018, brightness: 0.46 },
    { x: -0.008, y: -0.006, brightness: 0.7 },
    { x: -0.04, y: -0.03, brightness: 1 },
  ];
  const layers = await Promise.all(offsets.map((item) =>
    makeLayer(layout.deckWidth, layout.deckHeight, item.brightness)));
  const shadow = await makeShadow(layers[2], layout.deckWidth, layout.deckHeight);
  const placement = (item) => ({
    left: baseLeft + Math.round(layout.deckWidth * item.x),
    top: baseTop + Math.round(layout.deckHeight * item.y),
  });
  const top = placement(offsets[2]);
  const composites = [
    { input: shadow, left: top.left + 5, top: top.top + 9, blend: 'over' },
    ...layers.map((input, index) => ({ input, ...placement(offsets[index]), blend: 'over' })),
  ];

  if (layout.actionButtons) {
    for (const item of layout.actionButtons) {
      const input = await makeButtonLayer(item);
      const metadata = await sharp(input).metadata();
      composites.push({
        input,
        left: Math.round(layout.width * (100 - item.rightPercent) / 100 - metadata.width),
        top: Math.round(layout.height * item.topPercent / 100),
        blend: 'over',
      });
    }
  }

  const source = path.join(SKIN, layout.source);
  const metadata = await sharp(source).metadata();
  if (metadata.width !== layout.width || metadata.height !== layout.height) {
    throw new Error(`${layout.source} changed size: expected ${layout.width}x${layout.height}, got ${metadata.width}x${metadata.height}`);
  }
  await sharp(source)
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toFile(path.join(SKIN, layout.output));
}

function generatedCss() {
  const rules = Object.entries(LAYOUTS).map(([orientation, layout]) => {
    const vars = Object.entries(layout.cssVars)
      .map(([name, value]) => `    ${name}: ${value};`)
      .join('\n');
    return `body.${orientation} #board-stage {\n` +
      `${vars}\n` +
      `}\n` +
      `body.${orientation} #game-board {\n` +
      `    background-image: url('assets/skin/${layout.output}') !important;\n` +
      `}`;
  }).join('\n\n');
  return `/* Generated by scripts/bake-deck-backgrounds.js. Do not edit. */\n${rules}\n`;
}

(async () => {
  for (const layout of Object.values(LAYOUTS)) await bake(layout);
  await fs.writeFile(path.join(PUBLIC, 'deck-stage.generated.css'), generatedCss(), 'utf8');
  console.log('Baked landscape and portrait deck backgrounds and generated hotspot coordinates.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
