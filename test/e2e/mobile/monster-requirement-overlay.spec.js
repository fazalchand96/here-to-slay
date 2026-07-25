'use strict';

const path = require('node:path');
const { test, expect } = require('@playwright/test');

test('expansion Monsters use complete baked frames without HTML requirement overlays', async ({ page }, testInfo) => {
    await page.goto('/');

    await page.evaluate(() => {
        const cards = [
            {
                id: 'card_208',
                name: 'Ancient Megashark',
                type: 'Monster Card',
                expansion: 'Monster Expansion',
                requirement: '1 Hero',
                attack_cost: { discard: 'ANY', count: 1 },
                fullCardArtUrl: 'assets/skin/cards/monster-fullgen-v2/card_208.webp',
                artUrl: 'assets/skin/cards/monster-fullgen-v2/card_208.webp'
            },
            {
                id: 'card_218',
                name: 'Voltclaw Lion',
                type: 'Monster Card',
                expansion: 'Monster Expansion',
                requirement: '1 Hero',
                attack_cost: { discard: 'Magic Card', count: 1 },
                fullCardArtUrl: 'assets/skin/cards/monster-fullgen-v2/card_218.webp',
                artUrl: 'assets/skin/cards/monster-fullgen-v2/card_218.webp'
            },
            {
                id: 'card_175',
                name: 'Doombringer',
                type: 'Monster Card',
                expansion: 'Berserkers & Necromancers',
                requirement: '1 Necromancer, 1 Hero',
                fullCardArtUrl: 'assets/skin/cards/monster-fullgen-v2/card_175.webp',
                artUrl: 'assets/skin/cards/monster-fullgen-v2/card_175.webp'
            }
        ];

        document.body.className = 'landscape';
        document.body.innerHTML = `
            <main class="monster-requirement-test-stage">
                <div id="active-monsters">
                    ${cards.map(card => renderCard(card, false, false, true, false)).join('')}
                </div>
            </main>
        `;
    });

    await page.addStyleTag({
        content: `
            .monster-requirement-test-stage {
                position: fixed;
                inset: 0;
                display: grid;
                place-items: center;
                background: #17110d;
            }
            .monster-requirement-test-stage #active-monsters {
                position: static !important;
                display: flex !important;
                width: 520px !important;
                height: 245px !important;
                gap: 18px !important;
            }
            .monster-requirement-test-stage #active-monsters > .card {
                width: 150px !important;
                height: 225px !important;
            }
            @media (max-width: 600px) {
                .monster-requirement-test-stage #active-monsters {
                    width: 370px !important;
                    height: 180px !important;
                    gap: 8px !important;
                }
                .monster-requirement-test-stage #active-monsters > .card {
                    width: 112px !important;
                    height: 168px !important;
                }
            }
        `
    });

    await expect(page.locator('#active-monsters .monster-requirement-badge')).toHaveCount(0);
    await expect(page.locator('#active-monsters .card.full-card-art')).toHaveCount(3);
    await expect(page.locator('#active-monsters .card .card-img').nth(0)).toHaveCSS(
        'background-image',
        /monster-fullgen-v2\/card_208\.webp/
    );
    await expect(page.locator('#active-monsters .card .card-img').nth(1)).toHaveCSS(
        'background-image',
        /monster-fullgen-v2\/card_218\.webp/
    );
    await expect(page.locator('#active-monsters .card .card-img').nth(2)).toHaveCSS(
        'background-image',
        /monster-fullgen-v2\/card_175\.webp/
    );

    await page.screenshot({
        path: path.join('screenshots', `monster-requirement-baked-${testInfo.project.name}.png`),
        fullPage: true
    });
});
