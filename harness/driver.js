// Actuates brain.js decisions through REAL UI interaction on a Playwright page.
// Never emits socket events for game actions — the whole point is exercising the
// rendered mobile client the way a finger would.

const SHORT = 2500;   // ms — patient fallback for inspectors and remote-player modals
const REACTION = 900; // ms — controls implied by current state are already rendering
const MODIFIER_PASS = '#dice-pass-btn:visible, #modifier-pass-btn:visible';

async function tapCard(page, cardId, scope) {
    const sel = `${scope || ''} .card[data-id="${cardId}"]`.trim();
    const el = page.locator(sel).first();
    await el.waitFor({ state: 'visible', timeout: SHORT });
    // Crowded hands overlap cards with negative margins, so a center click can
    // land on the covering neighbor. Only a card's LEFT sliver is guaranteed
    // exposed (the last card is fully visible; left-edge works for it too).
    if (scope && scope.includes('player-hand')) {
        const box = await el.boundingBox().catch(() => null);
        if (box) {
            await el.click({ force: true, position: { x: Math.min(8, box.width / 2), y: box.height / 2 } });
            return;
        }
    }
    await el.click({ force: true });
}

// Opponent party cards are NOT on the mobile board — they render inside
// #opponent-modal after tapping that player's chip. Tap a card wherever it
// lives: board first, then through the owner's opponent modal.
async function tapCardSmart(page, cardId, ownerId) {
    const onBoard = page.locator(`.card[data-id="${cardId}"]`).first();
    if (await onBoard.isVisible().catch(() => false)) {
        await onBoard.click({ force: true });
        return true;
    }
    if (!ownerId) return false;
    const chip = page.locator(`.opponent-chip[onclick*="${ownerId}"]`).first();
    if (!(await chip.isVisible().catch(() => false))) return false;
    await chip.click({ force: true });
    const inModal = page.locator(`#opponent-modal .card[data-id="${cardId}"]`).first();
    try {
        await inModal.waitFor({ state: 'visible', timeout: SHORT });
        await inModal.click({ force: true });
        return true;
    } catch {
        await clickIfVisible(page, '#opponent-modal-close-btn', 1000);
        return false;
    }
}

async function closeOpponentModal(page) {
    if (await page.locator('#opponent-modal:not(.hidden)').count().catch(() => 0)) {
        await clickIfVisible(page, '#opponent-modal-close-btn', 1000);
    }
}

// Tap a card, then tap an inspector-modal action button matching `buttonRe`.
// Returns false (after closing the modal) if the button never appeared or is
// disabled — the server may have advanced state between decision and tap.
async function cardAction(page, cardId, scope, buttonRe) {
    await tapCard(page, cardId, scope);
    const btn = page.locator('#inspector-modal-actions button', { hasText: buttonRe }).first();
    try {
        await btn.waitFor({ state: 'visible', timeout: SHORT });
        if (await btn.isDisabled()) throw new Error('disabled');
        await btn.click({ force: true });
        return true;
    } catch {
        await closeInspector(page);
        return false;
    }
}

async function closeInspector(page) {
    const close = page.locator('#inspector-close-btn');
    try {
        if (await page.locator('#inspector-modal:not(.hidden)').count()) {
            await close.click({ force: true, timeout: 1500 });
        }
    } catch { /* already closed */ }
}

// Scroll a (possibly below-the-fold) element into view, then click. Force-clicks
// don't scroll, so offscreen modal buttons silently no-op without this.
async function clickScrolled(page, locator) {
    if (!(await locator.count().catch(() => 0))) return false;
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    try {
        await locator.click({ timeout: 1500 });
        return true;
    } catch {
        return locator.click({ force: true }).then(() => true).catch(() => false);
    }
}

async function clickIfVisible(page, selector, timeout = SHORT) {
    const el = page.locator(selector).first();
    try {
        await el.waitFor({ state: 'visible', timeout });
        await el.click({ force: true });
        return true;
    } catch {
        return false;
    }
}

// Some flows (equip an item, pick a value for a modifier, choose ACTIVE vs
// CHALLENGER) pop follow-up choices AFTER the primary tap. Handle them best-effort.
async function handleFollowups(page, rngPick) {
    // Modifier value chooser / roll-side chooser lives in the target banner.
    const bannerBtns = page.locator('#target-banner:not(.hidden) button:not([disabled])');
    try {
        await bannerBtns.first().waitFor({ state: 'visible', timeout: 1200 });
        const n = await bannerBtns.count();
        // Skip a trailing "Cancel" when there are other options.
        const idx = n > 1 ? Math.min(rngPick(n - 1), n - 2) : 0;
        await bannerBtns.nth(idx).click({ force: true });
        return true;
    } catch {
        return false;
    }
}

async function perform(page, decision, ctx) {
    const rngPick = (n) => Math.floor(ctx.rng() * n);

    switch (decision.type) {
        case 'ROLL_LEADER': {
            const input = page.locator('#player-name-input');
            if (await input.isVisible().catch(() => false)) {
                await input.fill(ctx.name);
            }
            return clickIfVisible(page, '#roll-leader-btn');
        }
        case 'REROLL_LEADER':
            return clickIfVisible(page, 'button:has-text("REROLL")', 2500);
        case 'KEEP_LEADER':
            return true; // keeping = doing nothing; server flags hasSelectedLeader
        case 'START_GAME':
            return clickIfVisible(page, '#start-game-btn');

        case 'ATTACK':
            return cardAction(page, decision.monsterId, '#active-monsters', /Attack Monster/i);

        case 'PLAY_CARD': {
            const ok = await cardAction(page, decision.cardId, '#player-hand', /Play Card|Cast Magic/i);
            if (ok) await handleFollowups(page, rngPick).catch(() => {});
            return ok;
        }

        case 'DRAW': {
            const btn = page.locator('#draw-card-btn');
            if (await btn.isEnabled().catch(() => false)) {
                await btn.click({ force: true });
                return true;
            }
            if (decision.fallback) return perform(page, decision.fallback, ctx);
            return clickIfVisible(page, '#end-turn-btn', 2000);
        }

        case 'END_TURN':
            return clickIfVisible(page, '#end-turn-btn');

        case 'ROLL':
            return clickIfVisible(page, '#manual-roll-btn');

        case 'CHALLENGE_PLAY': {
            // Preferred path: the challenge bar's PLAY CHALLENGE button.
            if (await clickIfVisible(page, '#challenge-play-btn:not([disabled])', 1200)) {
                await handleFollowups(page, rngPick).catch(() => {});
                return true;
            }
            // Fallback: play the specific card through the inspector.
            return cardAction(page, decision.cardId, '#player-hand', /Play Challenge/i);
        }
        case 'CHALLENGE_PASS':
            return clickIfVisible(page, '#challenge-pass-btn', REACTION);

        case 'MODIFIER_PLAY': {
            const ok = await cardAction(page, decision.cardId, '#player-hand', /Play Modifier/i);
            if (ok) await handleFollowups(page, rngPick).catch(() => {});
            else return clickIfVisible(page, MODIFIER_PASS, REACTION);
            return ok;
        }
        case 'MODIFIER_PASS':
            return clickIfVisible(page, MODIFIER_PASS, REACTION);

        case 'SELECT_TARGET': {
            const t = decision.target;
            if (t.kind === 'player') {
                // Prefer the chosen player's chip; fall back to any valid-target chip.
                for (const sel of [`.opponent-chip[onclick*="${t.id}"]`, '.opponent-chip.valid-target', '.opponent-chip']) {
                    const chip = page.locator(sel).first();
                    if (await chip.isVisible().catch(() => false)) {
                        await chip.click({ force: true });
                        return true;
                    }
                }
                return false;
            }
            // Card target: own-hand targets are scoped to #player-hand (duplicate
            // card ids exist elsewhere in the DOM); others tap the board or the
            // owner's opponent modal.
            if (t.location === 'hand') {
                try {
                    await tapCard(page, t.id, '#player-hand');
                } catch {
                    return false;
                }
            } else if (!(await tapCardSmart(page, t.id, t.owner))) {
                await closeOpponentModal(page);
                return false;
            }
            const selBtn = page.locator('#inspector-modal-actions button', { hasText: /Select|Target|Steal|Destroy|Sacrifice|Return/i }).first();
            try {
                await selBtn.waitFor({ state: 'visible', timeout: 1500 });
                await selBtn.click({ force: true });
            } catch {
                await closeInspector(page);
            }
            await closeOpponentModal(page);
            return true;
        }

        case 'SKILL_TARGET_CARD': {
            if (!(await tapCardSmart(page, decision.targetHeroId, decision.targetPlayerId))) {
                await closeOpponentModal(page);
                return clickIfVisible(page, '#target-banner button:has-text("Cancel")', 1500);
            }
            const btn = page.locator('#inspector-modal-actions button', { hasText: /SELECT TARGET|Select|Target/i }).first();
            try {
                await btn.waitFor({ state: 'visible', timeout: 1500 });
                await btn.click({ force: true });
            } catch {
                await closeInspector(page);
            }
            await closeOpponentModal(page);
            return true;
        }

        case 'SKILL_TARGET_PLAYER': {
            // In isPlayerTargeting mode the chip tap itself submits the target
            // (openOpponentModal short-circuits to submit_skill_target).
            for (const sel of [`.opponent-chip[onclick*="${decision.targetPlayerId}"]`, '.opponent-chip.valid-target', '.opponent-chip']) {
                const chip = page.locator(sel).first();
                if (await chip.isVisible().catch(() => false)) {
                    await chip.click({ force: true });
                    return true;
                }
            }
            // Some player-target skills render a player-picker modal/banner instead.
            return handleFollowups(page, rngPick);
        }

        case 'SKILL_TARGET_MULTI': {
            for (const t of decision.targets) {
                if (!(await tapCardSmart(page, t.id, t.owner))) continue;
                const btn = page.locator('#inspector-modal-actions button', { hasText: /SELECT TARGET|Select|Target/i }).first();
                try {
                    await btn.waitFor({ state: 'visible', timeout: 1200 });
                    await btn.click({ force: true });
                } catch { /* fall through to close */ }
                await closeInspector(page);
                await closeOpponentModal(page);
            }
            // SELECT TARGET leaves the inspector open, which would swallow the
            // banner Submit click — make sure nothing covers the banner.
            await closeInspector(page);
            return (await clickScrolled(page, page.locator('#target-banner button', { hasText: /Submit/i }).first())) ||
                   (await clickScrolled(page, page.locator('#target-banner button', { hasText: /Confirm/i }).first()));
        }

        case 'SKILL_TARGET_DISCARD': {
            const sel = page.locator('#discard-search-modal button', { hasText: /Select/i }).first();
            if (await sel.count().catch(() => 0)) {
                await sel.scrollIntoViewIfNeeded().catch(() => {});
                await sel.click({ timeout: 1500 }).catch(async () => { await sel.click({ force: true }).catch(() => {}); });
                return true;
            }
            // No matching card — cancel out of the picker.
            return clickIfVisible(page, '#discard-search-modal button:has-text("Cancel")', 2000);
        }

        case 'SKILL_TARGET_CANCEL':
            // The cancel affordance lives in different containers per mode.
            return (await clickIfVisible(page, '#target-banner button:has-text("Cancel")', 1200)) ||
                   (await clickIfVisible(page, '#discard-search-modal button:has-text("Cancel")', 1200)) ||
                   (await clickIfVisible(page, '.overlay:not(.hidden) button:has-text("Cancel")', 1200));

        case 'HAND_SELECT': {
            // If a previous attempt already entered equip-targeting (banner up),
            // don't restart from the hand — finish the equip. A dropped hero-tap
            // otherwise loops this decision forever.
            const bannerText = await page.locator('#target-banner:not(.hidden) #target-banner-text').innerText().catch(() => '');
            const equipActive = /equip/i.test(bannerText);
            if (!equipActive) {
                const ok = await cardAction(page, decision.cardId, '#player-hand', /Play This Card/i);
                if (!ok) return false;
                if (!decision.equipTarget) {
                    await handleFollowups(page, rngPick).catch(() => {});
                    return true;
                }
                await page.waitForTimeout(300);
            }
            if (decision.equipTarget) {
                // Tap the chosen hero, then SELECT TARGET; one retry for dropped taps.
                for (let attempt = 0; attempt < 2; attempt++) {
                    if (!(await tapCardSmart(page, decision.equipTarget.id, decision.equipTarget.owner))) continue;
                    const btn = page.locator('#inspector-modal-actions button', { hasText: /SELECT TARGET|Select/i }).first();
                    try {
                        await btn.waitFor({ state: 'visible', timeout: 1500 });
                        await btn.click({ force: true });
                        await closeOpponentModal(page);
                        return true;
                    } catch {
                        await closeInspector(page);
                        await closeOpponentModal(page);
                    }
                }
            }
            return true;
        }
        case 'HAND_SKIP':
            return clickIfVisible(page, '#target-banner button:has-text("SKIP")');

        case 'DISCARD_PENALTY': {
            // Tap each hand card, SELECT TARGET in the inspector, and CLOSE the
            // inspector after each selection — SELECT TARGET does not close it,
            // and the open overlay swallows the banner Confirm click (root cause
            // of the variable-discard softlock). Skip already-selected cards so
            // a retry doesn't toggle them off.
            for (const id of decision.cardIds) {
                const cls = await page.locator(`#player-hand .card[data-id="${id}"]`).first()
                    .getAttribute('class').catch(() => '') || '';
                if (/active-skill-glow/.test(cls)) continue;
                await tapCard(page, id, '#player-hand').catch(() => {});
                const btn = page.locator('#inspector-modal-actions button', { hasText: /Select|Discard/i }).first();
                try {
                    await btn.waitFor({ state: 'visible', timeout: 1200 });
                    await btn.click({ force: true });
                } catch { /* fall through to close */ }
                await closeInspector(page);
            }
            await closeInspector(page);
            return clickScrolled(page, page.locator('#target-banner button', { hasText: /Confirm/i }).first());
        }

        case 'SACRIFICE': {
            // Sacrifice runs through target mode: tap own hero, then the
            // inspector's SELECT TARGET button (labelled so by the PENALTY branch).
            return cardAction(page, decision.heroId, '#player-party', /SELECT TARGET|Sacrifice/i);
        }

        case 'IMMEDIATE_PLAY':
            return clickIfVisible(page, '#immediate-play-modal button:has-text("Play Immediately")');

        case 'GLOBAL_CARD': {
            // Mandatory-discard modal lists hand cards with inline Discard/Give
            // buttons — they can sit below the fold, so scroll before clicking.
            return clickScrolled(page, page.locator('#mandatory-discard-modal button', { hasText: /Discard|Give/i }).first());
        }
        case 'GLOBAL_SACRIFICE': {
            return clickScrolled(page, page.locator('#mandatory-discard-modal button', { hasText: /Sacrifice/i }).first());
        }
        case 'GLOBAL_RESOLVE': {
            return clickScrolled(page, page.locator('#global-discard-pool button', { hasText: /Select/i }).first());
        }

        case 'NO_TARGET':
            // Brain found no valid target; try a SKIP/Cancel affordance so the game moves.
            return (await clickIfVisible(page, '#target-banner button:has-text("SKIP")', 1500)) ||
                   (await clickIfVisible(page, '#target-banner button:has-text("Cancel")', 1500));

        case 'GAMEOVER':
        default:
            return true;
    }
}

// Service modals that closeAllModals deliberately keeps open (inspector,
// deck-peek, discard-viewer). Left stranded, these full-screen overlays eat
// every subsequent tap. Runs at tick start, when no perform() is in flight —
// so a visible inspector here is by definition stray.
async function handleStrayModals(page) {
    let acted = false;

    const peek = page.locator('#deck-peek-modal:not(.hidden)');
    if (await peek.count().catch(() => 0)) {
        const sel = page.locator('#deck-peek-modal .peek-select-btn').first();
        if (await sel.isVisible().catch(() => false)) await sel.click({ force: true });
        else await clickIfVisible(page, '#deck-peek-close-btn', 800);
        acted = true;
    }

    const viewer = page.locator('#discard-viewer-modal:not(.hidden)');
    if (await viewer.count().catch(() => 0)) {
        const sel = page.locator('#discard-viewer-modal button', { hasText: /Select/i }).first();
        if (await sel.isVisible().catch(() => false)) { await sel.click({ force: true }); acted = true; }
        else acted = (await clickIfVisible(page, '#discard-viewer-modal .close-btn', 800)) || acted;
    }

    // Search-discard picker (Call to the Fallen, Guiding Light, ...). Its Select
    // buttons can sit below the fold — scroll them into view; force-clicks don't.
    const search = page.locator('#discard-search-modal:not(.hidden)');
    if (await search.count().catch(() => 0)) {
        const sel = page.locator('#discard-search-modal button', { hasText: /Select/i }).first();
        if (await sel.count().catch(() => 0)) {
            await sel.scrollIntoViewIfNeeded().catch(() => {});
            await sel.click({ timeout: 1500 }).catch(async () => { await sel.click({ force: true }).catch(() => {}); });
            acted = true;
        } else {
            acted = (await clickIfVisible(page, '#discard-search-modal button:has-text("Cancel")', 800)) || acted;
        }
    }

    if (await page.locator('#inspector-modal:not(.hidden)').count().catch(() => 0)) {
        await closeInspector(page);
        acted = true;
    }

    if (await page.locator('#opponent-modal:not(.hidden)').count().catch(() => 0)) {
        await clickIfVisible(page, '#opponent-modal-close-btn', 800);
        acted = true;
    }

    return acted;
}

// The skill-roll prompt (heroPlayedPrompt) is a modal, not a state — poll it.
async function handleSkillPrompt(page, rng) {
    const modal = page.locator('#skill-prompt-modal:not(.hidden)');
    if (await modal.isVisible().catch(() => false)) {
        if (rng() < 0.8) await clickIfVisible(page, '#skill-prompt-yes', 1500);
        else await clickIfVisible(page, '#skill-prompt-no', 1500);
        return true;
    }
    return false;
}

module.exports = { perform, handleSkillPrompt, closeInspector, handleStrayModals };
