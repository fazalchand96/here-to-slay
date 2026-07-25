const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('action point countdown is visible and warns during the final seconds', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const htmlSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const styleSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

    assert.match(htmlSource, /id="action-point-timer"[\s\S]*?id="action-point-timer-seconds"/);
    assert.match(appSource, /function syncActionPointCountdown\(data\)/);
    assert.match(appSource, /seconds === 10 \|\| \(seconds >= 1 && seconds <= 5\)/);
    assert.match(appSource, /playSound\(seconds <= 5 \? 'timerUrgent' : 'timerWarning'\)/);
    assert.match(styleSource, /#action-point-timer\.timer-danger/);
    assert.match(styleSource, /timer-plaque-v150\.webp/);
    assert.match(styleSource, /body\.landscape #action-point-timer \{[\s\S]*?left: 91\.54%[\s\S]*?top: 73\.2%/);
    assert.equal(
        fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'skin', 'timer-plaque-v150.webp')),
        true
    );
});

test('Muscipula Rex shows every player a longer non-blocking free-draw banner', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const styleSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

    assert.match(serverSource, /effectLabel: 'FREE DRAW · 0 AP'/);
    assert.match(serverSource, /durationMs: 5200/);
    assert.match(appSource, /className = 'overlay rex-major-reveal-modal monster-trigger-modal'/);
    assert.match(appSource, /const keepOpen = \[[\s\S]*?'monster-trigger-modal'[\s\S]*?\];/);
    assert.match(appSource, /setTimeout\(\(\) => overlay\.remove\(\), visibleMs\)/);
    assert.match(styleSource, /\.monster-trigger-modal \{[\s\S]*?pointer-events: none !important;/);
    assert.match(styleSource, /monster-trigger-countdown var\(--monster-trigger-duration, 2400ms\)/);
});

test('Lightning Labrys confirmation uses a tappable banner and waits for server acknowledgement', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const styleSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

    assert.match(appSource, /data-submit-variable-discard/);
    assert.match(appSource, /socket\.timeout\(4000\)\.emit\([\s\S]*?'submit_penalty_discard'/);
    assert.match(appSource, /if \(error \|\| !response\?\.ok\)/);
    assert.match(styleSource, /#target-banner \{[\s\S]*?pointer-events: auto !important;/);
    assert.match(serverSource, /reply\(\{ ok: true, discardedCount \}\)/);
});

test('Challenge prompt lists every legal card and keeps class-locked Challenges selectable only when eligible', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const styleSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

    assert.match(appSource, /function getChallengeCardChoices\(data\)/);
    assert.match(appSource, /data-challenge-card-id="\$\{card\.id\}"/);
    assert.match(appSource, /data-locked-challenge-card-id="\$\{card\.id\}"/);
    assert.match(appSource, /Normal Challenge/);
    assert.match(appSource, /socket\.timeout\(4000\)\.emit\('play_challenge'/);
    assert.match(styleSource, /\.challenge-choice-list,/);
    assert.match(styleSource, /\.challenge-choice\.is-locked/);
    assert.match(serverSource, /You need a \$\{challengeCard\.required_class\} Hero in your Party/);
    assert.match(serverSource, /reply\(\{\s*ok: true,\s*cardId: challengeCard\.id/);
});

test('free Monster target actions use the inspector action container', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const freeAttackBranch = appSource.match(
        /if \(context\.location === 'monsters' && myTargetMode[\s\S]*?else if \(context\.location === 'monsters' && !isTargetMode\)/
    );

    assert.ok(freeAttackBranch, 'Expected the free Monster attack inspector branch to exist');
    assert.match(freeAttackBranch[0], /modalActions\.appendChild\(btn\)/);
    assert.doesNotMatch(freeAttackBranch[0], /(^|[^A-Za-z])actions\.appendChild\(btn\)/);
});

test('Fearless Flame is offered beside PASS during the visible modifier phase', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

    assert.match(appSource, /id = 'fearless-flame-controls'/);
    assert.match(appSource, /USE THE FEARLESS FLAME \(\+1\)/);
    assert.match(appSource, /socket\.emit\('use_fearless_flame'\)/);
    assert.match(serverSource, /socket\.on\('use_fearless_flame'/);
    assert.doesNotMatch(appSource, /resolve_fearless_flame_choice/);
});

test('Item targeting keeps both own and opponent Party boards available', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

    assert.match(
        appSource,
        /else if \(isLocalTargeting\) \{[\s\S]*?item-target-board[\s\S]*?open this Party/i
    );
    assert.match(
        appSource,
        /`\$\{context\.card\.name\}: open your Party or an opponent's Party/
    );
    assert.match(
        appSource,
        /const targetingParty = !spectator && \(myTargetMode \|\| isLocalTargeting \|\| isSelfItemTargeting\)/
    );
    assert.match(
        appSource,
        /window\.openOwnPartyModal = function\(requestedSection = 'classes'\)[\s\S]*?buildClassPartyGrid\(me, true\)/
    );
    assert.match(
        appSource,
        /window\.openOpponentModal = function\(id, requestedSection = 'classes'\)[\s\S]*?buildClassPartyGrid\(opp, false\)/
    );
});

test('expansion Monster requirements are baked into upgraded card art without a live overlay', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const styleSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

    assert.match(serverSource, /monsterRequirementV2: loadFullCardArtSource\('monster-fullgen-v2'/);
    assert.match(serverSource, /upgradedMonsterSource\?\.extensionById\.has\(artId\)/);
    assert.match(appSource, /const monsterRequirement = !isFullCardArt/);
    assert.doesNotMatch(appSource, /needsMonsterRequirementOverlay|needs-requirement-overlay/);
    assert.doesNotMatch(styleSource, /needs-requirement-overlay/);

    [
        'card_175', 'card_176',
        'card_208', 'card_209', 'card_210', 'card_211', 'card_212', 'card_213',
        'card_214', 'card_215', 'card_216', 'card_217', 'card_218', 'card_219',
        'card_220'
    ].forEach(id => {
        assert.equal(
            fs.existsSync(path.join(
                __dirname, '..', 'public', 'assets', 'skin', 'cards',
                'monster-fullgen-v2', `${id}.webp`
            )),
            true,
            `${id} should have a fully baked requirement frame`
        );
    });
});

test('opponent boards use dedicated art and clearly mark the active player', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const styleSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

    assert.match(appSource, /const isActiveOpponent = data\.activePlayerSocketId === id/);
    assert.match(appSource, /is-active-turn/);
    assert.match(appSource, /opponent-turn-label/);
    assert.match(styleSource, /assets\/skin\/boards\/opponent-board-idle\.webp/);
    assert.match(styleSource, /assets\/skin\/boards\/opponent-board-active\.webp/);
    assert.match(styleSource, /\.opponent-chip\.is-active-turn[\s\S]*?filter: none !important/);
    assert.doesNotMatch(styleSource, /\.opponent-chip\.is-active-turn[\s\S]*?brightness\(1\.32\)/);
    assert.doesNotMatch(styleSource, /rgba\(255, 247, 169, \.95\)/);
    ['opponent-board-idle.webp', 'opponent-board-active.webp'].forEach(file => {
        assert.equal(
            fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'skin', 'boards', file)),
            true,
            `${file} should exist`
        );
    });
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

test('Druid skill rolls show low-roll labels and Majestelk reaches its dedicated choice', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

    assert.match(
        appSource,
        /function formatHeroRollRequirement\(hero\)[\s\S]*?hero\.rollType === 'LOW_ROLL' \? '-' : '\+'/
    );
    assert.match(
        appSource,
        /function isSuccessfulHeroRoll\(hero, roll\)[\s\S]*?total <= requirement : total >= requirement/
    );
    assert.match(appSource, /Skill \$\{formatHeroRollRequirement\(hero\)\}/);
    assert.doesNotMatch(appSource, /Skill \$\{hero\.roll_requirement\}\+/);

    const dedicatedStates = appSource.match(/const dedicatedStates = \[[\s\S]*?\];/);
    assert.ok(dedicatedStates, 'Expected the dedicated waiting-state list');
    assert.match(dedicatedStates[0], /WAITING_FOR_MAJESTELK_CHOICE/);

    const actNowStates = appSource.match(/const actNowStates = \[[\s\S]*?\];/);
    assert.ok(actNowStates, 'Expected the dice-overlay act-now state list');
    assert.match(actNowStates[0], /WAITING_FOR_MAJESTELK_CHOICE/);
    assert.match(
        appSource,
        /const showMajestelkChoice = data\.state === 'WAITING_FOR_MAJESTELK_CHOICE'/
    );

    const htmlSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert.match(htmlSource, /id="majestelk-choice-modal"/);
    assert.match(htmlSource, /onclick="chooseMajestelkModifier\(5\)"/);
    assert.match(htmlSource, /onclick="chooseMajestelkModifier\(-5\)"/);
});
