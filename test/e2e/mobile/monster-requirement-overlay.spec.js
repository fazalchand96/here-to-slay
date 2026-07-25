'use strict';

const path = require('node:path');
const { test, expect } = require('@playwright/test');

test('blank expansion Monster plaques show party and discard requirements', async ({ page }, testInfo) => {
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
                fullCardArtUrl: 'assets/skin/cards/monster-fullgen-v1/card_208.webp',
                artUrl: 'assets/skin/cards/monster-fullgen-v1/card_208.webp'
            },
            {
                id: 'card_218',
                name: 'Voltclaw Lion',
                type: 'Monster Card',
                expansion: 'Monster Expansion',
                requirement: '1 Hero',
                attack_cost: { discard: 'Magic Card', count: 1 },
                fullCardArtUrl: 'assets/skin/cards/monster-fullgen-v1/card_218.webp',
                artUrl: 'assets/skin/cards/monster-fullgen-v1/card_218.webp'
            },
            {
                id: 'card_175',
                name: 'Doombringer',
                type: 'Monster Card',
                expansion: 'Berserkers & Necromancers',
                requirement: '1 Necromancer, 1 Hero',
                fullCardArtUrl: 'assets/skin/cards/monster-fullgen-v1/card_175.webp',
                artUrl: 'assets/skin/cards/monster-fullgen-v1/card_175.webp'
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

    const badges = page.locator('#active-monsters .monster-requirement-badge');
    await expect(badges).toHaveCount(3);
    await expect(badges.nth(0)).toHaveText('Req: 1 Hero • Discard 1 Card');
    await expect(badges.nth(1)).toHaveText('Req: 1 Hero • Discard 1 Magic Card');
    await expect(badges.nth(2)).toHaveText('Req: 1 Necromancer, 1 Hero');

    for (let index = 0; index < 3; index += 1) {
        const badge = badges.nth(index);
        await expect(badge).toBeVisible();
        const display = await badge.evaluate(element => getComputedStyle(element).display);
        expect(display).toBe('block');

        const bounds = await badge.boundingBox();
        const cardBounds = await page.locator('#active-monsters .card').nth(index).boundingBox();
        expect(bounds.y).toBeGreaterThanOrEqual(cardBounds.y);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(cardBounds.y + cardBounds.height + 1);
    }

    await page.screenshot({
        path: path.join('screenshots', `monster-requirement-overlays-${testInfo.project.name}.png`),
        fullPage: true
    });
});
