const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');

function trackedRuntimePngs() {
    const output = execFileSync('git', ['ls-files', 'public'], {
        cwd: ROOT,
        encoding: 'utf8'
    });

    return output
        .split(/\r?\n/)
        .filter((file) => file.startsWith('public/assets/skin/'))
        .filter((file) => file.toLowerCase().endsWith('.png'));
}

async function optimize(file) {
    const source = path.join(ROOT, file);
    const target = source.slice(0, -4) + '.webp';

    await sharp(source)
        .webp({
            quality: 88,
            alphaQuality: 100,
            effort: 6,
            smartSubsample: true
        })
        .toFile(target);

    const before = fs.statSync(source).size;
    const after = fs.statSync(target).size;
    return { file, before, after };
}

async function main() {
    const files = trackedRuntimePngs();
    const results = [];

    for (const file of files) {
        results.push(await optimize(file));
    }

    const before = results.reduce((sum, result) => sum + result.before, 0);
    const after = results.reduce((sum, result) => sum + result.after, 0);
    const megabytes = (bytes) => (bytes / 1024 / 1024).toFixed(2);

    console.log(`Optimized ${results.length} runtime PNG files.`);
    console.log(`${megabytes(before)} MB -> ${megabytes(after)} MB (${Math.round((1 - after / before) * 100)}% smaller)`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
