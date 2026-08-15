'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const sourceDir = path.join(__dirname, '..', 'public', 'assets', 'skin', 'modals', 'unified-v197');
const outputDir = path.join(__dirname, '..', 'public', 'assets', 'skin', 'modals', 'unified-v201');

const panelMasks = {
    'panel-large.webp': {
        width: 1600,
        height: 900,
        panel: '60,17 1540,17 1584,62 1584,837 1540,883 60,883 16,837 16,62',
        crest: '748,28 778,0 822,0 852,28 822,59 778,59',
    },
    'panel-compact.webp': {
        width: 1600,
        height: 400,
        panel: '66,13 1534,13 1581,45 1581,355 1534,387 66,387 19,355 19,45',
        crest: '751,27 780,0 820,0 849,27 820,57 780,57',
    },
};

async function applyPanelMask(filename, config) {
    const mask = Buffer.from(`
        <svg width="${config.width}" height="${config.height}" viewBox="0 0 ${config.width} ${config.height}" xmlns="http://www.w3.org/2000/svg">
            <polygon points="${config.panel}" fill="white"/>
            <polygon points="${config.crest}" fill="white"/>
        </svg>
    `);
    await sharp(path.join(sourceDir, filename))
        .ensureAlpha()
        .composite([{ input: mask, blend: 'dest-in' }])
        .webp({ quality: 94, alphaQuality: 100, smartSubsample: true })
        .toFile(path.join(outputDir, filename));
}

async function main() {
    fs.mkdirSync(outputDir, { recursive: true });
    await Promise.all(Object.entries(panelMasks).map(([filename, config]) => applyPanelMask(filename, config)));
    for (const filename of ['content-well.webp', 'button-primary.webp', 'button-secondary.webp']) {
        fs.copyFileSync(path.join(sourceDir, filename), path.join(outputDir, filename));
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
