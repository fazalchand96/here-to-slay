const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ART_DIR = path.join(
    __dirname,
    '..',
    'public',
    'assets',
    'skin',
    'cards',
    'art-web'
);
const MAX_WIDTH = 512;
const MAX_HEIGHT = 768;

async function optimize(file) {
    const source = path.join(ART_DIR, file);
    // Read first so Sharp does not keep the source path open while Windows
    // replaces that same file with the optimized buffer.
    const sourceBuffer = fs.readFileSync(source);
    const metadata = await sharp(sourceBuffer).metadata();
    const before = fs.statSync(source).size;

    if (metadata.width <= MAX_WIDTH && metadata.height <= MAX_HEIGHT) {
        return { changed: false, before, after: before };
    }

    const optimized = await sharp(sourceBuffer)
        .resize({
            width: MAX_WIDTH,
            height: MAX_HEIGHT,
            fit: 'inside',
            withoutEnlargement: true
        })
        .webp({
            quality: 82,
            alphaQuality: 100,
            effort: 6
        })
        .toBuffer();

    if (optimized.length >= before) {
        return { changed: false, before, after: before };
    }

    fs.writeFileSync(source, optimized);
    return { changed: true, before, after: optimized.length };
}

async function main() {
    const files = fs.readdirSync(ART_DIR)
        .filter(file => file.toLowerCase().endsWith('.webp'));
    let changed = 0;
    let before = 0;
    let after = 0;

    for (const file of files) {
        const result = await optimize(file);
        if (result.changed) changed++;
        before += result.before;
        after += result.after;
    }

    const megabytes = bytes => (bytes / 1024 / 1024).toFixed(1);
    console.log(`Inspector art: optimized ${changed} of ${files.length} files.`);
    console.log(`${megabytes(before)} MB -> ${megabytes(after)} MB`);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
