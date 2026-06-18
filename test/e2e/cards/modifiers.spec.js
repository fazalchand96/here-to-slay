'use strict';

const { test, expect } = require('../helpers/fixtures');
const { startGame, injectCard } = require('../helpers/gameSetup');

// One hero per class, so the host's party meets ANY active monster's requirement
// (the heaviest is "4 Heroes"; the rest are "N Heroes" or "1 ClassX, 1 Hero").
const ALL_CLASS_HEROES = ['card_016', 'card_024', 'card_032', 'card_040', 'card_048', 'card_056'];

// Start a monster attack to enter the dice/modifier phase, then play a modifier card.
// We initiate the attack via socket on the host (bypass the board UI for brevity).
async function startMonsterAttack(host) {
    // The host starts with an empty party, but every monster requires at least one
    // hero — inject a full class spread so the attack is never rejected.
    for (const heroId of ALL_CLASS_HEROES) {
        await host.evaluate((id) => window._socket.emit('debug_inject_to_party', { cardId: id }), heroId);
    }
    await host.waitForTimeout(300);

    // Get the first active monster ID from game state
    const monsterId = await host.evaluate(() => {
        const gs = window.latestGameState;
        return gs && gs.activeMonsters && gs.activeMonsters[0] ? gs.activeMonsters[0].id : null;
    });
    if (!monsterId) throw new Error('No active monster found');
    await host.evaluate((id) => window._socket.emit('attackMonster', id), monsterId);
    await host.waitForTimeout(400);
}

const MODIFIER_CARDS = [
    { name: 'Modifier +4',    id: 'card_096', effectId: 'MOD_4' },
    { name: 'Modifier -4',    id: 'card_100', effectId: 'MOD_MINUS_4' },
    { name: 'Modifier +3/-1', id: 'card_092', effectId: 'MOD_3_1' },
    { name: 'Modifier +2/-2', id: 'card_083', effectId: 'MOD_2_2' },
    { name: 'Modifier +1/-3', id: 'card_079', effectId: 'MOD_1_3' },
];

for (const { name, id, effectId } of MODIFIER_CARDS) {
test(`${name} (${effectId}): can be played during modifier phase`, async ({ browser }) => {
    const errors = [];
    const { host, p2, ctx1, ctx2 } = await startGame(browser);
    host.on('pageerror', e => errors.push(e.message));

    await injectCard(host, id);
    await startMonsterAttack(host);

    // Dice overlay should appear
    await expect(host.locator('#dice-overlay')).not.toHaveClass(/hidden/, { timeout: 8_000 });

    // Roll the dice first (host must roll)
    const rollBtn = host.locator('#manual-roll-btn');
    if (await rollBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await rollBtn.click();
        await host.waitForTimeout(300);
    }

    // Now in modifier phase — play the modifier by INSPECTING the hand card and
    // using its "Play Modifier" action (modifier buttons no longer live in the
    // dice overlay).
    const handCard = host.locator(`#player-hand [data-id="${id}"]`).first();
    await expect(handCard).toBeVisible({ timeout: 5_000 });
    // Hand modifier cards run the pulsing active-skill-glow animation, so they
    // never satisfy the "stable" actionability check — force the tap.
    await handCard.click({ force: true });
    await expect(host.locator('#inspector-modal')).toBeVisible({ timeout: 5_000 });
    await host.locator('#inspector-modal-actions button').filter({ hasText: /Play Modifier/i }).first().click();

    // The modifier was actually played — it left the hand.
    await expect.poll(async () => host.evaluate((cid) => {
        const me = window.latestGameState.players[window.myId];
        return me.hand.some(c => c.id === cid);
    }, id)).toBe(false);

    // Close out the modifier window.
    const passBtn = host.locator('#dice-pass-btn');
    if (await passBtn.isVisible({ timeout: 3_000 }).catch(() => false)) await passBtn.click();

    await host.waitForTimeout(400);
    expect(errors).toEqual([]);

    await ctx1.close(); await ctx2.close();
});
}
