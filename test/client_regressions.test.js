const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('free Monster target actions use the inspector action container', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const freeAttackBranch = appSource.match(
        /if \(context\.location === 'monsters' && myTargetMode[\s\S]*?else if \(context\.location === 'monsters' && !isTargetMode\)/
    );

    assert.ok(freeAttackBranch, 'Expected the free Monster attack inspector branch to exist');
    assert.match(freeAttackBranch[0], /modalActions\.appendChild\(btn\)/);
    assert.doesNotMatch(freeAttackBranch[0], /(^|[^A-Za-z])actions\.appendChild\(btn\)/);
});

test('Fearless Flame waits for the settled roll and restores it after a decision', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

    assert.match(appSource, /isFearlessFlameChoice[\s\S]*?_fearlessFlamePromptTimer[\s\S]*?1100/);
    assert.match(appSource, /fearlessFlameChoice[\s\S]*?_diceStaleTimer[\s\S]*?1100/);
    assert.match(appSource, /if \(!data\.isRollUpdate && \(window\.currentRollSignature/);
});

test('new full-art Monsters receive a requirement overlay without duplicating older art', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

    assert.match(appSource, /const needsMonsterRequirementOverlay = isFullCardArt/);
    assert.match(appSource, /\['Berserkers & Necromancers', 'Monster Expansion'\]\.includes\(card\.expansion\)/);
    assert.match(appSource, /needs-requirement-overlay/);
});

test('opponent boards use dedicated art and clearly mark the active player', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const styleSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

    assert.match(appSource, /const isActiveOpponent = data\.activePlayerSocketId === id/);
    assert.match(appSource, /is-active-turn/);
    assert.match(appSource, /opponent-turn-label/);
    assert.match(styleSource, /assets\/skin\/boards\/opponent-board\.webp/);
    assert.match(styleSource, /\.opponent-chip\.is-active-turn/);
});

test('the redundant DRAW control is hidden while the draw-pile hotspot remains active', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const htmlSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const styleSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

    assert.match(htmlSource, /id="draw-card-btn" class="action-btn hidden"/);
    assert.match(htmlSource, /id="main-deck" role="button"[\s\S]*?aria-label="Draw a card"/);
    assert.match(appSource, /mainDeckHotspot\.addEventListener\('click', \(\) => drawCardBtn\.click\(\)\)/);
    assert.match(appSource, /premium-tabletop-landscape-nodraw\.webp/);
    assert.doesNotMatch(appSource, /['"]assets\/skin\/premium-tabletop-landscape\.webp['"]/);
    assert.match(styleSource, /body\.landscape #draw-card-btn \{[\s\S]*?display: none !important;[\s\S]*?pointer-events: none !important;/);
    [
        'premium-tabletop-landscape-nodraw.webp',
        ...[1, 2, 3, 4].map(ap => `premium-tabletop-landscape-nodraw-ap${ap}-v80.webp`)
    ].forEach(file => {
        assert.equal(
            fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'skin', file)),
            true,
            `${file} should exist`
        );
    });
});
