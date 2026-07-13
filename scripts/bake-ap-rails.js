const path = require('node:path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const SKIN = path.join(ROOT, 'public', 'assets', 'skin');
const GEM = path.join(SKIN, 'icons', 'ap-full.png');

// These values mirror public/deck-stage.generated.css. x/y are the center of
// the rail overlay; width/height are its pre-transform bounds.
const RAILS = [
    {
        orientation: 'landscape',
        board: 'premium-tabletop-landscape.png',
        x: 0.878,
        y: 0.442,
        width: 0.036,
        height: 0.28,
        rotate: -4,
    },
    {
        orientation: 'portrait',
        board: 'premium-tabletop-portrait.png',
        x: 0.852,
        y: 0.483,
        width: 0.045,
        height: 0.17,
        rotate: -4,
    },
];

async function extractRail(config) {
    const boardPath = path.join(SKIN, config.board);
    const metadata = await sharp(boardPath).metadata();
    const width = Math.round(metadata.width * config.width);
    const height = Math.round(metadata.height * config.height);
    const centerX = Math.round(metadata.width * config.x);
    const centerY = Math.round(metadata.height * config.y);

    // Sample the board along the same tilted coordinate system used by CSS.
    // Rotating this normalized crop back by --ap-track-rotate in the browser
    // makes its unlit pixels land over the exact pixels they came from.
    const padding = Math.ceil(Math.max(width, height) * 0.08);
    const sourceWidth = width + padding * 2;
    const sourceHeight = height + padding * 2;
    const normalized = await sharp(boardPath)
        .extract({
            left: centerX - Math.floor(sourceWidth / 2),
            top: centerY - Math.floor(sourceHeight / 2),
            width: sourceWidth,
            height: sourceHeight,
        })
        .rotate(-config.rotate)
        .toBuffer();
    const normalizedMetadata = await sharp(normalized).metadata();
    const base = await sharp(normalized)
        .extract({
            left: Math.floor((normalizedMetadata.width - width) / 2),
            top: Math.floor((normalizedMetadata.height - height) / 2),
            width,
            height,
        })
        .png()
        .toBuffer();

    return { base, width, height };
}

async function makeGemLayers(width, height) {
    const gemWidth = Math.max(1, Math.round(width * 0.7));
    const gemHeight = Math.max(1, Math.round(gemWidth * 313 / 250));
    const gem = await sharp(GEM)
        .resize(gemWidth, gemHeight, { fit: 'fill' })
        .modulate({ brightness: 1.15, saturation: 1.2 })
        .png()
        .toBuffer();
    const slots = Array.from({ length: 4 }, (_, index) => ({
        left: Math.round((width - gemWidth) / 2),
        top: Math.round(index * (height - gemHeight) / 3),
    }));

    return { gem, slots };
}

async function renderState(base, width, height, gem, slots, litCount) {
    const gemPlacements = slots.slice(0, litCount).map(({ left, top }) => ({
        input: gem,
        left,
        top,
    }));
    const alphaCanvas = await sharp({
        create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).composite(gemPlacements).png().toBuffer();
    const tightGlow = await sharp(alphaCanvas)
        .tint({ r: 69, g: 169, b: 232 })
        .blur(4)
        .linear(0.95)
        .png()
        .toBuffer();
    const wideGlow = await sharp(alphaCanvas)
        .tint({ r: 35, g: 143, b: 255 })
        .blur(9)
        .linear(0.58)
        .png()
        .toBuffer();

    return sharp(base)
        .composite([
            { input: wideGlow, left: 0, top: 0 },
            { input: tightGlow, left: 0, top: 0 },
            ...gemPlacements,
        ])
        .png()
        .toBuffer();
}

async function main() {
    for (const config of RAILS) {
        const { base, width, height } = await extractRail(config);
        const { gem, slots } = await makeGemLayers(width, height);
        for (let litCount = 1; litCount <= 4; litCount += 1) {
            const output = await renderState(base, width, height, gem, slots, litCount);
            const filename = `ap-rail-${config.orientation}-${litCount}.png`;
            await sharp(output).toFile(path.join(SKIN, filename));
            console.log(`${filename}: ${width}x${height}`);
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
