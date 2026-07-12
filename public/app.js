window.onerror = function(msg, url, line, col, error) {
    document.body.innerHTML += '<div style="color:red;font-size:20px;padding:20px;z-index:99999;position:absolute;background:rgba(0,0,0,0.8);top:0;left:0;right:0;"><b>JS Error:</b> ' + msg + '<br>' + (error ? error.stack : '') + '</div>';
};

function getPlayerName(id) {

    if (!latestGameState || !latestGameState.players || !latestGameState.players[id]) {

        return 'Player ' + id.substring(0, 4);

    }

    const p = latestGameState.players[id];

    return p.name && p.name !== 'Player' ? p.name : 'Player ' + id.substring(0, 4);

}



const socket = io();
window._socket = socket;

// --- AUDIO MANAGER ---
// The synth engine below covers every sound procedurally. To upgrade any one of
// them to a richer RECORDED file, do TWO things:
//   1. drop the file in public/sounds/  (any of .ogg/.mp3/.wav/.m4a)
//   2. uncomment its line in SOUND_FILES below (filename incl. extension)
// That's it — the file then auto-overrides the synth for that sound, and a
// missing/failed file silently falls back to synth. Also add the path to
// PRECACHE_ASSETS in sw.js so it's available offline. Per-name volume can be
// given as [filename, volume]; a bare string uses the default 0.6.
const SOUND_FILES = {
    dice: 'dice.ogg',          // shipped
    // tap: 'tap.ogg',         // careful: plays on every press — keep it very short
    // open: 'open.ogg',
    // close: 'close.ogg',
    // confirm: 'confirm.ogg',
    // cardDrop: 'card_drop.ogg',
    // draw: 'draw.ogg',
    // slash: 'slash.ogg',     // used for attacks
    // magic: 'magic.ogg',
    // skill: 'skill.ogg',
    // challenge: 'challenge.ogg',
    // modifier: 'modifier.ogg',
    // target: 'target.ogg',
    // coin: 'coin.ogg',       // slay reward
    // equip: 'equip.ogg',
    // turn: 'turn.ogg',       // your-turn cue
    // error: 'error.ogg',
    // join: 'join.ogg',
    // win: 'win.ogg',
    // lose: 'lose.ogg'
};
const sfx = {};
Object.entries(SOUND_FILES).forEach(([name, spec]) => {
    const [file, vol] = Array.isArray(spec) ? spec : [spec, 0.6];
    const audio = new Audio('/sounds/' + file);
    audio.volume = vol;
    audio.addEventListener('error', () => { audio.src = ''; }); // missing file → synth fallback
    sfx[name] = audio;
});

// Procedural sound engine (Web Audio). Lazily created; must be unlocked by a
// user gesture (handled by the global pointerdown listener near the bottom).
const Sound = (() => {
    let ctx = null, master = null;
    let muted = false;
    try { muted = localStorage.getItem('hts-muted') === '1'; } catch (e) {}

    function init() {
        if (ctx) return ctx;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
        return ctx;
    }
    function unlock() {
        const c = init();
        if (c && c.state === 'suspended') c.resume();
    }

    // A single enveloped oscillator "blip".
    function blip(freq, { type = 'sine', dur = 0.12, vol = 0.3, attack = 0.004, slideTo = null, when = 0 } = {}) {
        const c = init(); if (!c) return;
        const t = c.currentTime + when;
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g); g.connect(master);
        osc.start(t); osc.stop(t + dur + 0.02);
    }
    // Filtered, decaying noise burst (whooshes, slashes, paper slides).
    function noise({ dur = 0.18, vol = 0.25, type = 'highpass', freq = 800, freqEnd = null, when = 0 } = {}) {
        const c = init(); if (!c) return;
        const t = c.currentTime + when;
        const frames = Math.max(1, Math.floor(c.sampleRate * dur));
        const buf = c.createBuffer(1, frames, c.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < frames; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / frames);
        const src = c.createBufferSource(); src.buffer = buf;
        const filt = c.createBiquadFilter(); filt.type = type;
        filt.frequency.setValueAtTime(freq, t);
        if (freqEnd) filt.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
        const g = c.createGain(); g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(filt); filt.connect(g); g.connect(master);
        src.start(t); src.stop(t + dur + 0.02);
    }
    function arp(freqs, { stagger = 0.06, ...opts } = {}) {
        freqs.forEach((f, i) => blip(f, { ...opts, when: (opts.when || 0) + i * stagger }));
    }

    const recipes = {
        tap:       () => blip(420, { type: 'triangle', dur: 0.05, vol: 0.11 }),
        open:      () => blip(520, { type: 'sine', dur: 0.12, vol: 0.18, slideTo: 760 }),
        close:     () => blip(540, { type: 'sine', dur: 0.10, vol: 0.14, slideTo: 320 }),
        confirm:   () => { blip(523, { type: 'triangle', dur: 0.09, vol: 0.2 }); blip(784, { type: 'triangle', dur: 0.13, vol: 0.16, when: 0.07 }); },
        cardDrop:  () => noise({ dur: 0.16, vol: 0.3, type: 'lowpass', freq: 1400, freqEnd: 300 }),
        draw:      () => noise({ dur: 0.22, vol: 0.22, type: 'highpass', freq: 600, freqEnd: 2600 }),
        slash:     () => { noise({ dur: 0.18, vol: 0.34, type: 'highpass', freq: 1200, freqEnd: 400 }); blip(180, { type: 'sawtooth', dur: 0.12, vol: 0.2, slideTo: 60, when: 0.02 }); },
        attack:    () => recipes.slash(),
        magic:     () => arp([660, 990, 1320], { type: 'sine', dur: 0.4, vol: 0.13, stagger: 0.05 }),
        skill:     () => { blip(659, { type: 'triangle', dur: 0.1, vol: 0.18 }); blip(988, { type: 'triangle', dur: 0.16, vol: 0.15, when: 0.08 }); },
        challenge: () => { blip(330, { type: 'sawtooth', dur: 0.18, vol: 0.24, slideTo: 220 }); blip(247, { type: 'sawtooth', dur: 0.22, vol: 0.18, when: 0.1 }); },
        modifier:  () => blip(880, { type: 'triangle', dur: 0.18, vol: 0.17, slideTo: 1320 }),
        target:    () => blip(700, { type: 'sine', dur: 0.06, vol: 0.15 }),
        coin:      () => { blip(988, { type: 'square', dur: 0.08, vol: 0.16 }); blip(1319, { type: 'square', dur: 0.14, vol: 0.14, when: 0.06 }); },
        equip:     () => { blip(1318, { type: 'square', dur: 0.05, vol: 0.14 }); blip(1568, { type: 'square', dur: 0.08, vol: 0.12, when: 0.04 }); },
        turn:      () => { blip(587, { type: 'sine', dur: 0.14, vol: 0.2 }); blip(880, { type: 'sine', dur: 0.2, vol: 0.16, when: 0.1 }); },
        error:     () => { blip(200, { type: 'sawtooth', dur: 0.16, vol: 0.2 }); blip(150, { type: 'sawtooth', dur: 0.2, vol: 0.18, when: 0.08 }); },
        join:      () => blip(660, { type: 'sine', dur: 0.12, vol: 0.16, slideTo: 880 }),
        win:       () => arp([523, 659, 784, 1047], { type: 'triangle', dur: 0.5, vol: 0.2, stagger: 0.12 }),
        lose:      () => arp([392, 330, 262], { type: 'triangle', dur: 0.5, vol: 0.2, stagger: 0.14 }),
        dice:      () => noise({ dur: 0.3, vol: 0.3, type: 'bandpass', freq: 1500 }) // synth fallback; dice.ogg used when present
    };

    return {
        unlock,
        play(name) {
            if (muted) return;
            const r = recipes[name];
            if (r) { try { r(); } catch (e) { /* never let audio break the game */ } }
        },
        toggleMute() {
            muted = !muted;
            try { localStorage.setItem('hts-muted', muted ? '1' : '0'); } catch (e) {}
            return muted;
        },
        isMuted() { return muted; }
    };
})();

// Public API (unchanged signature): prefer a real audio file when one ships,
// otherwise synthesize. Existing playSound('dice'/'slash'/'magic') calls keep working.
function playSound(name) {
    const file = sfx[name];
    if (file && file.src) {
        try { file.currentTime = 0; file.play().catch(() => {}); } catch (e) {}
        return;
    }
    Sound.play(name);
}

function triggerHaptic(pattern) {
    if (Sound.isMuted()) return; // one "silence" switch covers sound + vibration
    if ('vibrate' in navigator) {
        try {
            navigator.vibrate(pattern);
        } catch (e) {
            // Ignore vibration errors on browsers/devices without permission/support
        }
    }
}

// Global press layer: unlock the audio engine on the first gesture, and give a
// light tap + micro-haptic to every interactive element so the whole UI feels
// responsive. Specific actions layer their own richer sound on top. Uses
// pointerdown (fires before click) and is capture-phase so it still runs even if
// a handler stops propagation. Passive — never blocks scrolling/tapping.
document.addEventListener('pointerdown', (e) => {
    Sound.unlock();
    const el = e.target.closest(
        'button, .card, .action-btn, .opponent-chip, .tavern-leader-card, [onclick], .clickable'
    );
    if (el && !el.disabled && !el.classList.contains('disabled')) {
        playSound('tap');
        triggerHaptic(8);
    }
}, { capture: true, passive: true });

// Party-leader class intro lines. Spoken via the Web Speech API (no asset files)
// and shown as a quote under the leader card when a leader is assigned/rerolled.
const CLASS_INTROS = {
    Fighter:  "I am the Fighter. Strength settles every argument.",
    Bard:     "I am the Bard. Let the song of battle begin!",
    Guardian: "I am the Guardian. None shall pass my watch.",
    Ranger:   "I am the Ranger. My aim never wavers.",
    Thief:    "I am the Thief. What's yours is already mine.",
    Wizard:   "I am the Wizard. Power beyond your reckoning."
};
function leaderIntroLine(leader) {
    return (leader && CLASS_INTROS[leader.class]) || "I shall lead this party to glory.";
}
// Speak the intro once per distinct leader (guards against lobby re-renders).
function announceLeader(leader) {
    if (!leader) return;
    const key = leader.id || leader.name;
    if (window._lastLeaderAnnounced === key) return;
    window._lastLeaderAnnounced = key;
    if (Sound.isMuted()) return;
    playSound('skill'); // a small flourish under the voice
    triggerHaptic([20, 30, 20]);
    try {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel(); // drop any queued line (e.g. a quick reroll)
            const u = new SpeechSynthesisUtterance(leaderIntroLine(leader));
            u.rate = 0.95; u.pitch = 0.9; u.volume = 0.9;
            window.speechSynthesis.speak(u);
        }
    } catch (e) { /* TTS unsupported — the on-screen quote still shows */ }
}


function renderDicePips(value) {
    if (value === '?' || value === '' || value === undefined || value === null || isNaN(value)) {
        return `<span class="die-question-mark">?</span>`;
    }
    const num = parseInt(value, 10);
    let html = '';
    for (let i = 0; i < num; i++) {
        html += '<div class="pip"></div>';
    }
    return html;
}

// Show WHICH monster an attack roll is targeting (+ its slay requirement) in the
// dice overlay. The overlay covers the board, so without this an opponent can't
// tell what's being attacked and can't decide whether to play a modifier. No-op
// (and clears) for non-attack rolls.
function renderDiceAttackTarget(data) {
    const preview = document.getElementById('dice-monster-preview');
    if (!preview) return;
    const pr = data && data.pendingRoll;
    const mon = (pr && pr.type === 'ATTACK')
        ? (data.activeMonsters || []).find(m => m.id === pr.targetId)
        : null;
    if (!mon) { preview.innerHTML = ''; preview.style.display = 'none'; return; }
    const rollerName = (data.players[pr.rollerId] && data.players[pr.rollerId].name) || 'Player';
    const reasonEl = document.getElementById('dice-reason');
    if (reasonEl) reasonEl.innerText = `${rollerName} is attacking:`;
    // Show the roll thresholds so watchers know which way to swing a modifier.
    const low = mon.rollType === 'LOW_ROLL';
    const slay = low ? `Slay ≤${mon.slayRoll}` : `Slay ${mon.slayRoll}+`;
    const pen = (mon.penaltyRoll != null)
        ? ` · Penalty ${low ? `${mon.penaltyRoll}+` : `≤${mon.penaltyRoll}`}`
        : '';
    preview.style.display = 'flex';
    preview.innerHTML = `${renderCard(mon, false, false, true, false)}`
        + `<div class="dice-monster-req">🗡 ${slay}${pen}</div>`;
}

// One-shot landing bounce when a die stops tumbling and shows its final face.
// Restart-safe (remove → reflow → add) so rapid consecutive rolls re-trigger it.
function settleDie(el) {
    if (!el) return;
    el.classList.remove('settle');
    void el.offsetWidth; // force reflow so the animation replays
    el.classList.add('settle');
}



// Immersive Auto-Fullscreen on first touch/click interaction

function triggerFullscreen() {

    const docEl = document.documentElement;

    const requestFullscreen = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.mozRequestFullScreen || docEl.msRequestFullscreen;

    if (requestFullscreen) {

        requestFullscreen.call(docEl).catch(err => {

            

        });

    }

}

document.addEventListener('touchstart', triggerFullscreen, { once: true });

document.addEventListener('click', triggerFullscreen, { once: true });



// Ensure hand containers use stacking for landscape mobile

function applyMobileStacking() {

    const handCards = document.querySelectorAll('.hand-container .card, #player-hand .card');

    handCards.forEach((card, index) => {

        card.style.marginLeft = index === 0 ? '0px' : '-15px';

    });



    const partyCards = document.querySelectorAll('#player-party .card');

    partyCards.forEach((card) => {

        card.style.marginLeft = '0px';

    });



    const opponentCards = document.querySelectorAll('.opponent-cards-container .card');

    opponentCards.forEach((card) => {

        card.style.marginLeft = '0px';

    });

}

window.addEventListener('resize', applyMobileStacking);



// Real-time Orientation & Layout Handler (Phase 5: dual-orientation, no lock)
//
// The orientation lock is gone — the game runs in BOTH portrait and landscape.
// This sets a mode class on <body> and #game-board (.portrait / .landscape) and,
// only when the orientation CATEGORY actually flips, re-renders the board so
// ensureBoardShell() can swap to the correct shell. The #rotation-lock-overlay
// element is kept (markup/e2e stability) but is now never shown.

let lastOrientationCategory = null;

function checkOrientationAndLayout() {

    const isLandscape = window.innerWidth > window.innerHeight;
    const category = isLandscape ? 'landscape' : 'portrait';

    // The rotation lock is removed — keep the element but never display it.
    const lockOverlay = document.getElementById('rotation-lock-overlay');
    if (lockOverlay) {
        lockOverlay.classList.add('hidden');
        lockOverlay.style.display = 'none';
    }

    // Mode classes drive the orientation-specific CSS in both shells.
    const board = document.getElementById('game-board');
    if (isLandscape) {
        document.body.classList.add('landscape');
        document.body.classList.remove('portrait');
        board?.classList.add('landscape');
        board?.classList.remove('portrait');
    } else {
        document.body.classList.add('portrait');
        document.body.classList.remove('landscape');
        board?.classList.add('portrait');
        board?.classList.remove('landscape');
    }

    // Re-render the board ONLY when the category actually flips (not on every
    // resize pixel). renderBoard -> ensureBoardShell() builds the right scaffold.
    // The very first (synchronous) call runs before `latestGameState` is even
    // declared, so skip the re-render then — the static landscape shell is fine
    // and there's no game state to draw yet.
    const isFirstRun = lastOrientationCategory === null;
    const flipped = !isFirstRun && category !== lastOrientationCategory;
    lastOrientationCategory = category;
    if (flipped) {
        renderBoard(latestGameState);
    }

    applyMobileStacking();

}

window.addEventListener('resize', checkOrientationAndLayout);

window.addEventListener('orientationchange', checkOrientationAndLayout);

checkOrientationAndLayout(); // Call initially



function setupEventConsoleObserver() {

    // Phase 5.4: the chat/event-log no longer auto-shows when no panel is up — it
    // is hidden by default and lives behind the ☰ toggle (toggleGameMenu). The
    // dice/challenge/skill panels are now fixed overlays, independent of the chat,
    // so the old "hide chat while a panel is active" observer is obsolete. Clear
    // any stale inline display it may have set so the CSS toggle owns visibility.

    const emptyState = document.getElementById('event-console-empty');

    if (emptyState) emptyState.style.display = '';

}



// Initialize event console observer immediately

document.addEventListener('DOMContentLoaded', setupEventConsoleObserver);

setupEventConsoleObserver(); // Also call immediately in case DOM is already loaded



function closeAllModals() {

    const modals = ['challenge-modal', 'modifier-modal', 'skill-prompt-modal', 'action-modal', 'dice-overlay', 'opponent-modal'];

    modals.forEach(id => {

        const el = document.getElementById(id);

        if (el) {

            el.classList.add('hidden');

            el.style.display = ''; // Clear inline styles

            el.style.pointerEvents = '';

        }

    });

    // Keep modals that represent a still-pending REQUIRED action — they're driven
    // by their own events/state and must not be dismissed by a stray PLAYING-state
    // render (e.g. the global-action prompt that appears as a skill resolves).
    const keepOpen = ['inspector-modal', 'mandatory-discard-modal', 'discard-viewer-modal', 'deck-peek-modal', 'global-discard-pool'];
    document.querySelectorAll('.overlay').forEach(el => {

        if (!keepOpen.includes(el.id)) {

            el.classList.add('hidden');

            el.style.display = '';

            el.style.pointerEvents = '';

        }

    });

}





// A Mask item makes the equipped Hero count as the Mask's class instead of its
// original (mirror of the server's rule, for the win tracker + monster-attack
// highlighting). Derived from the Mask's name ("Bard Mask" -> "Bard").
function effectiveHeroClass(hero) {
    if (!hero) return null;
    const item = hero.equippedItem;
    if (item && item.effect_id === 'ITEM_MASK') {
        if (item.class) return item.class;
        const m = /^(\w+)\s+Mask$/.exec(item.name || '');
        if (m) return m[1];
    }
    return hero.class;
}

function meetsMonsterRequirements(playerData, reqString) {

    if (!reqString || reqString === 'None' || reqString === '') return true;



    // 1. Gather available classes (Leader + Party)

    let availableClasses = [];

    if (playerData.leader && playerData.leader.class) {

        availableClasses.push(playerData.leader.class);

    }

    let heroCount = 0;

    if (playerData.party && Array.isArray(playerData.party)) {

        playerData.party.forEach(card => {

            if (card.type === 'Hero Card') {

                heroCount++;

                const cls = effectiveHeroClass(card);

                if (cls) availableClasses.push(cls);

            }

        });

    }



    // 2. Parse the requirement string

    const conditions = reqString.split(',').map(s => s.trim());

    for (let cond of conditions) {

        // Match numbers and text, e.g. "1 Fighter", "3 Heroes"

        const match = cond.match(/(\d+)\s+(.+)/);

        if (!match) continue;

        

        const requiredCount = parseInt(match[1], 10);

        let requiredType = match[2];

        

        // Normalize plural "Heroes" to "Hero"

        if (requiredType === 'Heroes') requiredType = 'Hero';



        if (requiredType === 'Hero') {

            if (heroCount < requiredCount) return false;

        } else {

            // Check specific class count

            const classCount = availableClasses.filter(c => c === requiredType).length;

            if (classCount < requiredCount) return false;

        }

    }



    return true;

}



// DOM Elements

const lobbyScreen = document.getElementById('lobby-modal');

const lobbyPlayers = document.getElementById('lobby-players');

const leaderSelection = document.getElementById('leader-selection-container');

const lobbyWaitingMsg = document.getElementById('lobby-waiting-msg');

const startGameBtn = document.getElementById('start-game-btn');

const opponentsBar = document.getElementById('opponents-bar');

const opponentModal = document.getElementById('opponent-modal');

const opponentModalTitle = document.getElementById('opponent-modal-title');

const opponentModalContent = document.getElementById('opponent-modal-content');



const gameBoard = document.getElementById('game-board');

const appContainer = document.getElementById('app-container');

const gameoverScreen = document.getElementById('gameover-screen');



const activeMonsters = document.getElementById('active-monsters');

const discardPile = document.getElementById('discard-pile');



const playerParty = document.getElementById('player-party');

const playerHand = document.getElementById('player-hand');

const playerAp = document.getElementById('player-ap');

const endTurnBtn = document.getElementById('end-turn-btn');

const drawCardBtn = document.getElementById('draw-card-btn');

const discardDrawBtn = document.getElementById('discard-draw-btn');





const turnIndicator = document.getElementById('turn-indicator');

const waitingOverlay = document.getElementById('waiting-overlay');



const notificationArea = document.getElementById('notification-area');



const skillPromptModal = document.getElementById('skill-prompt-modal');

const skillPromptText = document.getElementById('skill-prompt-text');

const skillPromptYes = document.getElementById('skill-prompt-yes');

const skillPromptNo = document.getElementById('skill-prompt-no');



const modifierModal = document.getElementById('modifier-modal');

let activeDiceSprite = null;
function startDiceSprite() {
    const container = document.getElementById('dice-container');
    activeDiceSprite?.stop();
    activeDiceSprite = window.playSpriteAnim?.(container, {
        sheetUrl: 'assets/skin/anim/dice-roll.png',
        frames: 8,
        fps: 12,
        width: 128,
        height: 128,
        loop: true,
        layers: [
            { className: 'dice-sprite-shadow', zIndex: 0 },
            { className: 'dice-sprite-main', zIndex: 1 }
        ]
    }) || null;
}
function stopDiceSprite() {
    activeDiceSprite?.stop();
    activeDiceSprite = null;
}

function playHeroSkillCast({ heroId, heroClass }) {
    const slug = String(heroClass || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (!heroId || !['fighter', 'bard', 'guardian', 'ranger', 'thief', 'wizard'].includes(slug)) return;
    const card = [...document.querySelectorAll('#player-party .card')]
        .find(el => el.dataset.id === heroId);
    if (!card) return;
    window.playSpriteAnim?.(card, {
        sheetUrl: `assets/skin/anim/cast-${slug}.png`,
        frames: 8,
        fps: 12,
        width: 128,
        height: 128,
        loop: false,
        layers: [
            { className: 'cast-sprite-glow', zIndex: 0 },
            { className: 'cast-sprite-main', zIndex: 1 }
        ]
    });
}

function playMonsterAttackAnim(monsterEl, monsterId) {
    if (!monsterEl || !/^card_(?:00[1-9]|01[0-5])$/.test(monsterId || '')) return;
    const strikeToken = (window.monsterStrikeUiToken || 0) + 1;
    window.monsterStrikeUiToken = strikeToken;
    clearTimeout(window.monsterStrikeUiTimer);
    document.body.classList.add('monster-strike-playing');
    const restoreStrikeUi = () => {
        if (window.monsterStrikeUiToken !== strikeToken) return;
        document.body.classList.remove('monster-strike-playing');
        clearTimeout(window.monsterStrikeUiTimer);
        window.monsterStrikeUiTimer = null;
    };
    // Independent of image loading and animation callbacks: even a 404/corrupt
    // sheet cannot leave a required target/penalty prompt deferred.
    window.monsterStrikeUiTimer = setTimeout(restoreStrikeUi, 725);
    window.playSpriteAnim?.(monsterEl, {
        sheetUrl: `assets/skin/anim/monster-${monsterId}.png`,
        frames: 8,
        fps: 12,
        width: 128,
        height: 128,
        loop: false,
        onDone: restoreStrikeUi,
        layers: [
            { className: 'monster-strike-shadow', zIndex: 0 },
            { className: 'monster-strike-main', zIndex: 1 }
        ]
    });
}

const MAGIC_BURST_MAP = {
    MAGIC_CALL_FALLEN: 'draw', MAGIC_CRIT_BOOST: 'draw', MAGIC_WINDS_CHANGE: 'draw',
    MAGIC_ENCHANTED: 'buff', MAGIC_WINDS_FORCE: 'buff',
    MAGIC_DESTRUCTIVE: 'damage', MAGIC_ENTANGLING: 'damage', MAGIC_EXCHANGE: 'damage'
};

function playResolutionBurst(targetEl, kind = 'buff', options = {}) {
    if (!targetEl) return null;
    return window.playSpriteAnim?.(targetEl, {
        sheetUrl: `assets/skin/anim/burst-${kind}.png`, frames: 8, fps: 12,
        width: 128, height: 128, loop: false,
        layers: [
            { className: `resolution-burst-glow resolution-burst-${kind}`, zIndex: 0 },
            { className: `resolution-burst-main resolution-burst-${kind}`, zIndex: 1 }
        ],
        onDone: options.onDone
    });
}

function playMagicResolution(card) {
    if (!card) return;
    const display = document.createElement('div');
    display.className = 'magic-resolution-display';
    display.innerHTML = renderCard(card, false, false, false, false);
    document.body.appendChild(display);
    const cleanup = () => display.remove();
    setTimeout(cleanup, 850);
    const kind = MAGIC_BURST_MAP[card.effect_id] || (String(card.effect || '').match(/destroy|steal|discard|sacrifice/i) ? 'damage' : 'buff');
    playResolutionBurst(display.querySelector('.card') || display, kind, { onDone: cleanup });
}

function playGameoverFinale() {
    if (!victoryModal) return;
    window.playSpriteAnim?.(victoryModal, {
        sheetUrl: 'assets/skin/anim/gameover-finale.png', frames: 8, fps: 10,
        width: 128, height: 128, loop: false,
        layers: [
            { className: 'finale-glow', zIndex: 0 },
            { className: 'finale-main', zIndex: 1 }
        ]
    });
}

// Build the dice-overlay equation line, itemized so every bonus is labelled with
// its source (Bard +1, Wise Shield +3, an equipped item, modifiers, ...) instead
// of collapsing them all into one anonymous "+N". Uses the server's breakdown.
function buildRollEquationHTML(data) {
    const r1 = data.roll1 || 1;
    const r2 = data.roll2 || 1;
    const parts = [`🎲 ${r1}+${r2}`];
    const addPart = (label, value) => {
        if (!value) return;
        const sign = value >= 0 ? '+' : '−';
        parts.push(`${label} ${sign}${Math.abs(value)}`);
    };
    if (Array.isArray(data.breakdown)) {
        data.breakdown.forEach(item => {
            if (item.source === 'Base Dice') return; // already shown as the dice
            addPart(item.source, item.value);
        });
    }
    addPart('Modifiers', data.modifierTotal);
    const total = (data.finalTotal != null) ? data.finalTotal
                : (data.total != null ? data.total : '?');
    const sep = '<span style="color:#777; margin:0 8px;">·</span>';
    return `<span style="font-size:1.05rem; line-height:1.7;">${parts.join(sep)}</span>`
         + `<span style="color:white; font-weight:bold; font-size:2rem; margin-left:12px;">= ${total}</span>`;
}

const modifierTitle = document.getElementById('modifier-title');

const modifierText = document.getElementById('modifier-text');

const modifierCards = document.getElementById('modifier-cards');

const modifierPassBtn = document.getElementById('modifier-pass-btn');



const challengeModal = document.getElementById('challenge-modal');

const challengeTitle = document.getElementById('challenge-title');

const challengeText = document.getElementById('challenge-text');

const challengeCardDisplay = document.getElementById('challenge-card-display');

const challengeActionArea = document.getElementById('challenge-action-area');

const challengeCards = document.getElementById('challenge-cards');

const challengePassBtn = document.getElementById('challenge-pass-btn');



const inspectorPanel = document.getElementById('inspector-modal');

const cardInfoPanel = inspectorPanel; // Alias for backward compatibility

const infoCloseBtn = document.getElementById('inspector-close-btn');

const panelCardImage = document.getElementById('inspector-modal-image');

const panelCardName = document.getElementById('inspector-modal-name');

const panelCardType = document.getElementById('inspector-modal-type');

const panelCardDescription = document.getElementById('inspector-modal-description');

const panelActions = document.getElementById('inspector-modal-actions');



const targetBanner = document.getElementById('target-banner');

const targetBannerText = document.getElementById('target-banner-text');



const victoryModal = document.getElementById('victory-modal');

const victoryWinnerName = document.getElementById('victory-winner-name');

const victoryReason = document.getElementById('victory-reason');



// Local state

let myId = null;

let pendingSkillCardId = null;

let isTargetMode = false;

let myTargetMode = false;

let currentPendingAction = null;

let latestGameState = null;

let previousGameState = null;

let currentlyViewedOpponentId = null;

let isLocalTargeting = false;

let localPendingEquipCard = null;

// When an item is played from a "draw then MAY play" prompt (Quick Draw / Hook),
// it must finalize via play_from_hand (so the skill's pendingAction is consumed),
// not the normal play_item_action path.
let equipFromHandSelection = false;



const TARGETING_SKILLS = ['DESTROY_HERO', 'STEAL_HERO', 'SKILL_MEOWZIO', 'SKILL_SHURIKITTY', 'SKILL_TIPSY_TOOTIE'];

const PLAYER_TARGETING_SKILLS = ['PULL_CARD', 'SKILL_HEAVY_BEAR', 'TRADE_HANDS', 'SKILL_SHARP_FOX', 'SKILL_SILENT_SHADOW', 'SKILL_SLIPPERY_PAWS', 'SKILL_HOPPER', 'SKILL_PLUNDERING_PUMA', 'SKILL_SLY_PICKINGS'];

const DISCARD_TARGETING_SKILLS = ['SKILL_GUIDING_LIGHT', 'SKILL_RADIANT_HORN', 'SKILL_LOOKIE_ROOKIE', 'SKILL_BUN_BUN', 'MAGIC_CALL_FALLEN'];

const DECK_PEEKING_SKILLS = ['SKILL_BULLSEYE'];

const SELF_ITEM_TARGETING_SKILLS = ['SKILL_HOLY_CURSELIFTER'];

const MULTI_TARGETING_SKILLS = ['SKILL_FLUFFY'];



let isSkillTargeting = false;

let isPlayerTargeting = false;

let isSelfItemTargeting = false;

let isMultiTargeting = false;

let isLeaderSkillTargeting = false;

let multiTargetSelected = [];

let multiTargetMax = 2;

let pendingHeroSkillCard = null;



function cancelDiscardSearch() {

    document.getElementById('discard-search-modal').classList.add('hidden');

    // If the server is waiting on a deferred discard-pile pick (e.g. Bun Bun after
    // a successful roll), client-only cleanup leaves it stuck in
    // WAITING_FOR_SKILL_TARGET. Tell the server to abort so the turn can continue.
    if (latestGameState && latestGameState.state === 'WAITING_FOR_SKILL_TARGET'
        && latestGameState.pendingAction && latestGameState.pendingAction.type === 'SKILL_TARGET_DISCARD') {
        socket.emit('submit_skill_target', { cancel: true });
    }

    cancelSkillTargeting();

}



// Per-card artwork-crop overrides for the frame-template skin. The frame's art
// window shows a cropped band of the official card image; style.css sets a good
// per-TYPE default, and only the few cards it frames poorly get an entry here.
//   pos  -> CSS background-position (e.g. 'center 22%')  [slides the art band]
//   size -> CSS background-size zoom (e.g. '200%')        [zooms in/out]
// Review/tune with screenshots/cardsheet.js.
const ART_CROP = {
    card_009: { pos: 'center 20%' },   // Malamammoth — head sat near the top edge
};
function artCropStyle(id) {
    const c = ART_CROP[id];
    if (!c) return '';
    return (c.pos ? `--art-pos:${c.pos};` : '') + (c.size ? `--art-size:${c.size};` : '');
}

// Image for a card, everywhere it's drawn (board, hand, inspector, modals,
// avatars). `artUrl` is the generated illustration — pure art, no baked-in name
// or rules text — set by the server for cards that have one. Anything without
// generated art falls back to the old watermarked wiki card scan, which has to
// be zoom-cropped instead (see ART_CROP / the per-type crops in style.css).
function cardArt(card) {
    return (card && (card.artUrl || card.imageUrl)) || '';
}
// Marks an element as showing real art, so CSS shows it edge-to-edge (cover)
// rather than applying the wiki-scan crop.
function artClass(card) {
    return card && card.artUrl ? ' has-art' : '';
}

function renderCard(card, isMine = false, inHand = false, isMonster = false, isMyTurn = false, inlineStyle = "") {

    if (!card) return '';

    

    // For hidden cards (opponent hand)

    if (card.type === 'Hidden') {

        return `<div class="card card-back"></div>`;

    }



    // For a Hero wearing a Mask, show the Mask's class (that's what the game counts
    // it as) so the tile matches the win/requirement logic.
    const shownClass = (card.type === 'Hero Card') ? effectiveHeroClass(card) : card.class;
    const cardClass = shownClass ? `<div class="card-class">${shownClass}</div>` : '';

    let glowClass = '';



    if (window.globalActiveHeroId === card.id) {

        glowClass += ' active-skill-glow';

    }



    if (isTargetMode) {

        if (myTargetMode && inHand && isMine && currentPendingAction.type === 'DISCARD') {

            glowClass += ' valid-target valid-target-equip';

        } else if (myTargetMode && !inHand && isMine && currentPendingAction.type === 'EQUIP' && card.type === 'Hero Card') {

            glowClass += ' valid-target valid-target-equip';

        } else if (myTargetMode && !isMine && !inHand && (currentPendingAction.type === 'DESTROY' || currentPendingAction.type === 'STEAL' || currentPendingAction.type === 'EXCHANGE_STEP_1') && card.type === 'Hero Card') {

            glowClass += ' valid-target valid-target-steal';

        } else if (myTargetMode && isMine && !inHand && currentPendingAction.type === 'EXCHANGE_STEP_2' && card.type === 'Hero Card') {

            glowClass += ' valid-target valid-target-equip';

        } else if (myTargetMode && !inHand && currentPendingAction.type === 'RETURN_ITEM' && card.type === 'Hero Card' && card.equippedItem) {

            glowClass += ' valid-target valid-target-steal';

        }

    } else {

        if (isSkillTargeting && !isMine && !inHand && card.type === 'Hero Card') {

            glowClass += ' valid-target valid-target-steal';

        } else if (isMultiTargeting && !isMine && !inHand && card.type === 'Hero Card' && (!window.latestGameState || !['WAITING_FOR_DISCARD_PENALTY', 'WAITING_FOR_MULTIPLE_DISCARDS', 'WAITING_FOR_VARIABLE_DISCARD'].includes(window.latestGameState.state))) {

            glowClass += ' valid-target valid-target-steal';

        } else if (isSelfItemTargeting && isMine && !inHand && card.type === 'Hero Card' && card.equippedItem) {

            glowClass += ' valid-target valid-target-equip';

        } else if (isLocalTargeting && !inHand && card.type === 'Hero Card') {

            // Any item — normal or cursed — may be equipped to ANY hero on the board
            // (your own or an opponent's). Keep a red "steal" glow for curses to signal
            // their harmful intent, and the regular equip glow for normal items.
            glowClass += isCurseEquip() ? ' valid-target valid-target-steal' : ' valid-target valid-target-equip';

        } else if (myTargetMode && !inHand && isMine && currentPendingAction.type === 'PENALTY' && window.latestGameState && window.latestGameState.state === 'WAITING_FOR_SACRIFICE' && card.type === 'Hero Card') {

            glowClass += ' valid-target valid-target-steal';

        } else if (isMultiTargeting && inHand && isMine && window.latestGameState && ['WAITING_FOR_DISCARD_PENALTY', 'WAITING_FOR_MULTIPLE_DISCARDS', 'WAITING_FOR_VARIABLE_DISCARD'].includes(window.latestGameState.state)) {

            const isSelected = multiTargetSelected && multiTargetSelected.includes(card.id);

            if (isSelected) glowClass += ' active-skill-glow';

            else glowClass += ' valid-target valid-target-equip';

        }

    }



    // Highlight attackable monsters when it's my turn

    if (isMonster && isMyTurn && !isTargetMode && !isSkillTargeting && !isMultiTargeting && !isLocalTargeting && latestGameState && latestGameState.state === 'PLAYING') {

        const canAttack = meetsMonsterRequirements(latestGameState.players[myId], card.requirement);

        if (canAttack) {

            glowClass += ' attackable-monster';

        }

    }



    // Roll badge value: heroes show roll_requirement, monsters show slayRoll; other
    // card types have no roll → empty (CSS hides an empty .card-req badge).
    let badgeVal = '';
    if (isMonster || card.type === 'Monster Card') {
        badgeVal = (card.slayRoll != null) ? card.slayRoll : '';
    } else if (card.type === 'Hero Card' && typeof card.roll_requirement === 'number') {
        badgeVal = card.roll_requirement;
    }
    // Tooltip detail (no extra node) keeps slay/fail/requirement reachable.
    const detailTitle = (isMonster || card.type === 'Monster Card')
        ? `Slay ${card.slayRoll}+ · Fail ${card.penaltyRoll}- · Needs ${card.requirement || '—'}`
        : (card.requirement || card.name || '');
    // Per-class / per-type accent that tints the frame border + type ribbon (--cc).
    const CLASS_TINT = { Fighter: 'var(--class-fighter)', Bard: 'var(--class-bard)', Guardian: 'var(--class-guardian)', Ranger: 'var(--class-ranger)', Thief: 'var(--class-thief)', Wizard: 'var(--class-wizard)' };
    const TYPE_TINT = { 'Item Card': 'var(--gold)', 'Cursed Item Card': 'var(--class-wizard)', 'Magic Card': 'var(--class-wizard)', 'Modifier Card': '#5aa8b8', 'Challenge Card': '#e07a4a' };
    let cardTint, variantClass = '';
    if (card.type === 'Party Leader') { cardTint = 'var(--leader-pink)'; variantClass = ' card-leader'; }
    else if (isMonster || card.type === 'Monster Card') { cardTint = '#e0607a'; variantClass = ' card-monster'; }
    else if (card.type === 'Hero Card') { cardTint = CLASS_TINT[shownClass] || 'var(--gold)'; }
    else { cardTint = TYPE_TINT[card.type] || 'var(--gold)'; }
    const typeSlug = (card.type || 'card').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const classSlug = shownClass ? shownClass.toLowerCase().replace(/[^a-z0-9]+/g, '-') : '';



    let equippedBadge = '';

    if (!inHand && card.type === 'Hero Card' && card.equippedItem) {

        const item = card.equippedItem;
        const isCursed = /cursed/i.test(item.type || '') || /curse/i.test(item.effect_id || '');
        equippedBadge = `<div class="equipped-item-thumb${isCursed ? ' cursed' : ''}" title="${item.name}" style="background-image: url('${cardArt(item)}')"><span class="equipped-item-thumb-name">${item.name}</span></div>`;

    }



    let actionOverlay = '';
    
    // Quick-Play for Modifiers: keep a subtle glow so the playable cards are
    // obvious, but DON'T stamp a "PLAY" button on each one — in a crowded hand the
    // overlays overlap into "PLA`PLA`PLAY" mush. The dice overlay already lists a
    // dedicated PLAY button per modifier.
    if (window.latestGameState && window.latestGameState.state === 'WAITING_FOR_MODIFIERS' && inHand && isMine && card.type === 'Modifier Card') {
        const hasPassed = window.latestGameState.pendingRoll && window.latestGameState.pendingRoll.passedPlayers.includes(window.myId);
        if (!hasPassed) {
            glowClass += ' active-skill-glow';
        }
    }
    
    // Quick-Play for Challenges: keep a glow so the playable card is obvious, but
    // don't stamp a "CHALLENGE" button on each one (crowded hands made them
    // overlap). The challenge modal already offers a dedicated PLAY CHALLENGE button.
    if (window.latestGameState && window.latestGameState.state === 'WAITING_FOR_CHALLENGES' && inHand && isMine && card.type === 'Challenge Card') {
        const hasPassed = window.latestGameState.pendingChallenge && window.latestGameState.pendingChallenge.passedPlayers.includes(window.myId);
        // Only highlight if it's not MY card being challenged
        const isMyCard = window.latestGameState.pendingChallenge.rollerId === window.myId;
        if (!hasPassed && !isMyCard) {
            glowClass += ' active-skill-glow';
        }
    }

    // NOTE: structure restyle (Phase 2). The wooden frame is `.card` (padding +
    // wood gradient); the parchment face lives in a new inner `.card-face` wrapper
    // (clips the art/ribbon). `.card-req` is now the blue roll badge, reparented to
    // a direct child of `.card` so it overlaps the frame corner. ALL load-bearing
    // names are intact: data-id on root, .card-img/.card-info/.card-name/.card-type/
    // .card-class/.card-req/.equipped-item-thumb, and every targeting glow class.
    return `
        <div class="card${variantClass} type-${typeSlug}${classSlug ? ` class-${classSlug}` : ''}${artClass(card)} ${glowClass}" id="${card.id}" data-id="${card.id}" title="${detailTitle}" style="--cc:${cardTint}; ${card.artUrl ? '' : artCropStyle(card.id)} ${inlineStyle}">
            <div class="card-req">${badgeVal}</div>
            ${equippedBadge}
            <div class="card-face">
                <div class="card-type">${card.type}</div>
                <div class="card-img${artClass(card)}" style="background-image: url('${cardArt(card)}')"></div>
                <div class="card-info">
                    <div class="card-name">${card.name}</div>
                    ${cardClass}
                </div>
            </div>
            ${actionOverlay}
        </div>
    `;

}



window.openOpponentModal = function(id) {

    if (isLeaderSkillTargeting) {

        socket.emit('use_leader_skill', { targetPlayerId: id });

        cancelSkillTargeting();

        return;

    }

    if (isPlayerTargeting) {

        if (latestGameState && latestGameState.state === 'WAITING_FOR_SKILL_TARGET') {

            socket.emit('submit_skill_target', {

                targetPlayerId: id

            });

        } else {

            socket.emit('use_hero_skill', {

                cardId: pendingHeroSkillCard ? pendingHeroSkillCard.id : '',

                isFree: false,

                targetPlayerId: id

            });

        }

        cancelSkillTargeting();

        return;

    }



    currentlyViewedOpponentId = id;

    const opp = latestGameState ? latestGameState.players[id] : null;

    if (!opp) return;



    const modal = document.getElementById('opponent-modal');

    const modalTitle = document.getElementById('opponent-modal-title');

    const modalContent = document.getElementById('opponent-modal-content');



    if (!modal) return;



    const displayName = getPlayerName(id);

    modalTitle.innerText = displayName;



    let cardsHtml = opp.leader ? renderCard(opp.leader, false, false, false, false) : '';

    if (opp.party && opp.party.length > 0) {

        const sortedOppParty = [...opp.party].sort((a, b) => {

            const classA = a.class || '';

            const classB = b.class || '';

            return classA.localeCompare(classB);

        });

        cardsHtml += sortedOppParty.map(c => renderCard(c, false, false, false, false)).join('');

    }



    modalContent.innerHTML = cardsHtml;



    modal.style.display = 'flex';

    modal.classList.remove('hidden');

    // Remember what we just rendered so the broadcast loop only rebuilds the modal
    // when it actually changes (see oppModalSignature) — rebuilding on every
    // broadcast destroyed the card DOM and dropped in-flight target taps.
    window._oppModalSig = oppModalSignature(id);

};

// A cheap fingerprint of the opponent-modal contents + current targeting context.
// If this is unchanged between broadcasts, the modal DOM is left intact so taps
// (selecting a hero to target) aren't dropped by a destructive re-render.
function oppModalSignature(id) {
    const opp = latestGameState && latestGameState.players && latestGameState.players[id];
    if (!opp) return null;
    const targetingActive = isSkillTargeting || isMultiTargeting || isLocalTargeting || isSelfItemTargeting || myTargetMode;
    return JSON.stringify({
        l: opp.leader ? opp.leader.id : null,
        p: (opp.party || []).map(h => `${h.id}:${h.equippedItem ? h.equippedItem.id : ''}`),
        t: targetingActive,
        s: latestGameState ? latestGameState.state : null,
    });
}



window.openOpponentOverlay = window.openOpponentModal;



window.closeOpponentModal = function() {

    currentlyViewedOpponentId = null;
    window._oppModalSig = null;

    const modal = document.getElementById('opponent-modal');

    if (modal) {

        modal.classList.add('hidden');

        modal.style.display = 'none';

    }

};

// Read-only viewer for the full discard pile (most recent first).
window.openDiscardViewer = function() {
    const modal = document.getElementById('discard-viewer-modal');
    const content = document.getElementById('discard-viewer-content');
    const title = document.getElementById('discard-viewer-title');
    if (!modal || !content || !latestGameState) return;
    const pile = latestGameState.discardPile || [];
    title.innerText = `Discard Pile (${pile.length})`;
    content.innerHTML = pile.length
        ? [...pile].reverse().map(c => renderCard(c, false, false, false, false)).join('')
        : '<div style="color:var(--text-muted);">The discard pile is empty.</div>';
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
};

window.closeDiscardViewer = function() {
    const modal = document.getElementById('discard-viewer-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
    }
};







// Socket Events

socket.on('connect', () => {

    socket.emit('request_lobby_data');

});



socket.on('lobby_data_update', (data) => {

    

    const container = document.getElementById('leader-selection-container');

    if (container && data.leaders) {

        

        if (data.leaders.length === 0) {

            

            socket.emit('request_lobby_data');

        }

        container.innerHTML = (data.leaders || []).map(l => `

            <div class="card" onclick="socket.emit('select_leader', '${l.id}')">

                <img src="${cardArt(l)}" alt="${l.name}">

                <p>${l.name}</p>

            </div>

        `).join('');

    } else {

        

    }

});



socket.on('lobby_data', (data) => {

    if (!latestGameState) {

        latestGameState = {

            state: 'LOBBY',

            players: data.players,

            playerOrder: data.playerOrder,

            availableLeaders: data.availableLeaders,

            me: socket.id

        };

        myId = socket.id;

    } else {

        latestGameState.availableLeaders = data.availableLeaders;

        latestGameState.players = data.players;

        latestGameState.playerOrder = data.playerOrder;

    }

    renderBoard(latestGameState);

});



socket.on('gameStateUpdate', (data) => {

    previousGameState = latestGameState;

    // A resolved HERO_SKILL roll loses its pendingRoll in the next state. Capture
    // the successful hero before adopting the new state so its class animation can
    // be attached to the freshly rendered party card below.
    let completedHeroCast = null;
    let completedMonsterAttack = null;
    let completedMagicCard = null;
    let completedModifierBurst = null;
    const priorRoll = previousGameState?.pendingRoll;
    if (priorRoll?.type === 'HERO_SKILL'
        && (!data.pendingRoll || data.pendingRoll.targetHeroId !== priorRoll.targetHeroId)) {
        const roller = previousGameState.players?.[priorRoll.rollerId];
        const hero = roller?.party?.find(card => card.id === priorRoll.targetHeroId);
        const finalRoll = Number(priorRoll.currentRoll ?? priorRoll.finalTotal ?? 0);
        if (hero && finalRoll >= Number(hero.roll_requirement || Infinity)) {
            completedHeroCast = { heroId: hero.id, heroClass: hero.class };
        }
    }
    if (priorRoll?.type === 'ATTACK'
        && (!data.pendingRoll || data.pendingRoll.targetId !== priorRoll.targetId)) {
        completedMonsterAttack = {
            monsterId: priorRoll.targetId,
            slain: !(data.activeMonsters || []).some(monster => monster.id === priorRoll.targetId)
        };
    }
    if (window.pendingMagicResolution) {
        const pending = window.pendingMagicResolution;
        const before = previousGameState?.players?.[myId]?.hand?.some(card => card.id === pending.id);
        const after = data.players?.[myId]?.hand?.some(card => card.id === pending.id);
        if (before && !after) {
            completedMagicCard = pending;
            window.pendingMagicResolution = null;
        }
    }
    if (previousGameState?.state === 'WAITING_FOR_MODIFIERS'
        && data.state === 'WAITING_FOR_MODIFIERS') {
        const oldHand = previousGameState.players?.[myId]?.hand || [];
        const newIds = new Set((data.players?.[myId]?.hand || []).map(card => card.id));
        const playedModifier = oldHand.find(card => card.type === 'Modifier Card' && !newIds.has(card.id));
        if (playedModifier) {
            const oldTotal = Number(previousGameState.pendingRoll?.modifierTotal || 0);
            const newTotal = Number(data.pendingRoll?.modifierTotal || 0);
            completedModifierBurst = newTotal - oldTotal >= 0 ? 'buff' : 'debuff';
        }
    }

    // Only adopt `me` when present — some server emits omit it, and blanking myId
    // mid-game breaks any handler that checks ownership (e.g. global actions).
    if (data.me) myId = data.me;
    try {


    } catch(e) {}


    latestGameState = data;

    // Mirror the live state onto window so other code paths (and e2e tests) can
    // read it — `let` bindings don't become window properties on their own.
    window.latestGameState = data;
    if (data.me) window.myId = data.me;

    // View Routing

    lobbyScreen?.classList.add('hidden');

    appContainer?.classList.add('hidden');

    gameoverScreen?.classList.add('hidden');



    if (data.state === 'LOBBY') {

        lobbyScreen?.classList.remove('hidden');

        

        lobbyPlayers.innerHTML = (data.playerOrder || []).map((id, index) => {
            const p = data.players[id];
            const displayName = getPlayerName(p.id);
            const isHost = index === 0;
            
            let statusHtml = '';
            let avatarHtml = '<div class="roster-avatar empty">?</div>';
            
            if (p.hasSelectedLeader && p.leader) {
                statusHtml = `<span class="status-ready">✓ Ready</span>`;
                avatarHtml = `<div class="roster-avatar" style="background-image: url('${cardArt(p.leader)}')"></div>`;
            } else {
                statusHtml = `<span class="status-selecting">⏳ Selecting...</span>`;
            }

            return `
                <div class="roster-entry ${p.hasSelectedLeader ? 'is-ready' : ''}">
                    ${avatarHtml}
                    <div class="roster-info">
                        <div class="roster-name">
                            ${isHost ? '<span class="host-crown" title="Host">👑</span>' : ''} 
                            ${displayName}
                        </div>
                        <div class="roster-status">${statusHtml} ${p.hasSelectedLeader && p.leader.class ? `<span class="roster-class">(${p.leader.class})</span>` : ''}</div>
                    </div>
                </div>
            `;
        }).join('');



        const activeMe = myId || data.me;

        const nameInput = document.getElementById('player-name-input');

        if (data.players[activeMe]) {

            leaderSelection?.classList.remove('hidden');

            if (data.players[activeMe].hasSelectedLeader) {

                if (nameInput) {

                    nameInput.classList.add('hidden');

                    nameInput.style.display = 'none';

                }

                const leader = data.players[activeMe].leader;

                if (leader) {
                    const canReroll = !data.players[activeMe].hasRerolledLeader;
                    const rerollBtnHtml = canReroll ? `<button onclick="socket.emit('reroll_leader')" class="action-btn" style="background: linear-gradient(135deg, #f59e0b, #d97706); color: black; margin-top: 15px; width: 100%; max-width: 250px; font-size: 1.1rem; font-weight: 800; padding: 12px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">🎲 REROLL (1 LEFT)</button>` : `<div style="margin-top: 15px; color: var(--text-muted); font-size: 0.95rem; font-style: italic;">No rerolls remaining</div>`;

                    leaderSelection.innerHTML = `

                        <div class="lobby-leader-display">

                            <h3 class="lobby-leader-label">Your Party Leader:</h3>

                            <div class="card card-leader lobby-leader-card${leader.class ? ` class-${leader.class.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : ''}${artClass(leader)}" style="--cc: var(--leader-pink);">

                                <div class="card-face">

                                    <div class="card-type">${leader.class || 'Party Leader'}</div>

                                    <div class="card-img${artClass(leader)}" style="background-image: url('${cardArt(leader)}')"></div>

                                    <div class="card-info">

                                        <div class="card-name">${leader.name}</div>

                                    </div>

                                </div>

                            </div>

                            <p class="lobby-leader-intro">&ldquo;${leaderIntroLine(leader)}&rdquo;</p>

                            ${rerollBtnHtml}

                        </div>

                    `;

                    announceLeader(leader);

                } else {

                    leaderSelection.innerHTML = '';

                }

            } else {

                if (nameInput) {

                    nameInput.classList.remove('hidden');

                    nameInput.style.display = 'block';

                }

                

                leaderSelection.innerHTML = `

                    <div class="roll-leader-container">

                        <button id="roll-leader-btn" onclick="socket.emit('roll_leader')">

                            🎲 ROLL FOR LEADER

                        </button>

                        <p class="roll-leader-hint">Your Party Leader will be assigned randomly from the available pool.</p>

                    </div>

                `;

            }

        } else {

            leaderSelection?.classList.add('hidden');

            if (nameInput) {

                nameInput.classList.add('hidden');

                nameInput.style.display = 'none';

            }

        }



        const isHost = myId === data.playerOrder[0];

        const allReady = data.playerOrder.every(id => data.players[id].hasSelectedLeader);

        

        if (isHost && data.playerOrder.length >= 2 && allReady) {

            startGameBtn?.classList.remove('hidden');

            lobbyWaitingMsg?.classList.add('hidden');

        } else {

            startGameBtn?.classList.add('hidden');

            lobbyWaitingMsg?.classList.remove('hidden');

            if (isHost && data.playerOrder.length < 2) {

                lobbyWaitingMsg.innerText = "Waiting for more players... (Need at least 2)";

            } else if (isHost && !allReady) {

                lobbyWaitingMsg.innerText = "Waiting for all players to select a leader...";

            } else if (!isHost) {

                lobbyWaitingMsg.innerText = "Waiting for Host to start the game...";

            }

        }

    } else if (data.state === 'PLAYING' || data.state.startsWith('WAITING') || data.state === 'PROMPT_SKILL_ROLL') {

        appContainer?.classList.remove('hidden');

        

        let interceptedDeath = false;

        if (previousGameState && previousGameState.activeMonsters && data.activeMonsters) {

            const oldMonsterIds = (previousGameState.activeMonsters || []).map(m => m.id);

            const newMonsterIds = (data.activeMonsters || []).map(m => m.id);

            const deadMonsterId = oldMonsterIds.find(id => !newMonsterIds.includes(id));

            

            if (deadMonsterId) {

                const monsterEl = document.getElementById(deadMonsterId);

                if (monsterEl) {

                    interceptedDeath = true;
                    if (completedMonsterAttack?.monsterId === deadMonsterId) {
                        playMonsterAttackAnim(monsterEl, deadMonsterId);
                    }

                    setTimeout(() => {
                        monsterEl?.classList.add('monster-dying');
                    }, 670);

                    

                    setTimeout(() => {

                        const rect = monsterEl.getBoundingClientRect();

                        const centerX = rect.left + rect.width / 2;

                        const centerY = rect.top + rect.height / 2;

                        spawnExplosion(centerX, centerY);

                        

                        monsterEl.style.opacity = '0';

                        

                        setTimeout(() => {

                            // Render the NEWEST state, not the captured `data`.
                            // This render is delayed ~1.2s for the slay animation;
                            // if a newer gameStateUpdate arrived and already
                            // rendered during that window, renderBoard(data) here
                            // would clobber the DOM back to this (now stale) update
                            // and — with no further broadcast — leave it desynced
                            // (e.g. a played hero card stuck in the hand). Found by
                            // the mobile-UI harness; exposed more at fast cadence.
                            renderBoard(latestGameState);

                        }, 50);

                    }, 1170);

                }

            }

        }

        

        if (!interceptedDeath) {

            renderBoard(data);

            if (completedHeroCast) {
                requestAnimationFrame(() => playHeroSkillCast(completedHeroCast));
            }
            if (completedMonsterAttack && !completedMonsterAttack.slain) {
                requestAnimationFrame(() => {
                    const monsterEl = document.querySelector(`#active-monsters .card[data-id="${completedMonsterAttack.monsterId}"]`);
                    playMonsterAttackAnim(monsterEl, completedMonsterAttack.monsterId);
                });
            }
            if (completedMagicCard) {
                requestAnimationFrame(() => playMagicResolution(completedMagicCard));
            }
            if (completedModifierBurst) {
                requestAnimationFrame(() => playResolutionBurst(document.getElementById('math-breakdown-banner'), completedModifierBurst));
            }

        }

    }

});



socket.on('game_over', (data) => {

    // Win/lose sting. game_over only carries winnerName, so compare it to mine.
    const myName = getPlayerName(socket.id);
    const iWon = data.winnerName && myName && data.winnerName === myName;
    playSound(iWon ? 'win' : 'lose');
    triggerHaptic(iWon ? [60, 50, 60, 50, 120] : [120, 60, 120]);

    // Hide game board and show victory modal

    appContainer?.classList.add('hidden');

    gameoverScreen?.classList.add('hidden'); // Ensure old gameover screen is hidden

    

    // Confetti!

    if (typeof confetti === 'function') {

        const duration = 5 * 1000;

        const animationEnd = Date.now() + duration;

        const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 10000 };

        const interval = setInterval(function() {

            const timeLeft = animationEnd - Date.now();

            if (timeLeft <= 0) return clearInterval(interval);

            const particleCount = 50 * (timeLeft / duration);

            confetti(Object.assign({}, defaults, { particleCount, origin: { x: Math.random(), y: Math.random() - 0.2 } }));

        }, 250);

    }

    

    victoryWinnerName.innerText = data.winnerName;

    victoryReason.innerText = `Victory Condition: ${data.reason}`;

    

    victoryModal?.classList.remove('hidden');
    playGameoverFinale();

    

    // Spawn massive confetti

    spawnConfetti();

});



socket.on('game_reset_complete', () => {

    window._lastLeaderAnnounced = null; // re-announce the leader in the next lobby

    // Clean up victory effects

    victoryModal?.classList.add('hidden');

    document.querySelectorAll('.confetti').forEach(el => el.remove());

    

    // Clean up modals and modifiers

    modifierModal?.classList.add('hidden');

    challengeModal?.classList.add('hidden');

    skillPromptModal?.classList.add('hidden');

    closeInspectorModal();

    

    // Show lobby, hide game board

    appContainer?.classList.add('hidden');

    lobbyScreen?.classList.remove('hidden');

});



function calculateWinStats(player) {

    if (!player) return { monsters: 0, uniqueClasses: 0 };

    const monsters = player.slainMonsters ? player.slainMonsters.length : 0;

    const classes = new Set();

    const leader = player.leader || player.partyLeader;

    if (leader && leader.class) {

        classes.add(leader.class);

    }

    if (player.party && Array.isArray(player.party)) {

        player.party.forEach(card => {

            const cls = effectiveHeroClass(card);

            if (cls && cls !== 'None') {

                classes.add(cls);

            }

        });

    }

    return { monsters, uniqueClasses: classes.size };

}



// ---------------------------------------------------------------------------
// Shared board fragments (UI overhaul Phase 4).
//
// buildBoardParts() produces the per-region HTML strings (opponents, monsters,
// discard, party, win-track, hand) ONCE, with every load-bearing id/data-id and
// targeting class intact. renderBoard() then writes each fragment into its
// PERSISTENT panel node — the #game-board shell is never innerHTML-nuked on a
// routine broadcast (Risk #1). The same fragments will feed the portrait shell
// in Phase 5; only the arrangement of the persistent nodes differs per
// orientation, and that re-shell happens solely on a portrait<->landscape flip.
// ---------------------------------------------------------------------------
function buildBoardParts(data, ctx) {
    const { me, isMyTurn, myTargetMode, currentPendingAction } = ctx;

    // --- Opponents bar (chips) ---
    let oppHtml = '';
    data.playerOrder.forEach(id => {
        if (id === myId) return;
        const opp = data.players[id];
        if (!opp) return;

        const displayName = getPlayerName(id);
        const stats = calculateWinStats(opp);

        let chipClass = "opponent-chip";
        let chipClick = `onclick="openOpponentModal('${id}')"`;
        let chipTitle = `title="Click to view cards"`;

        if (myTargetMode && currentPendingAction && ['FORCE_DISCARD_TARGET', 'CONDITIONAL_PULL', 'PUMA_PULL', 'LOOK_AND_PULL'].includes(currentPendingAction.type)) {
            chipClass += " valid-target";
            chipClick = `onclick="selectTarget('${id}')"`;
            chipTitle = `title="Click to select this player as a target"`;
        }

        // Stacked + compact so all opponents (up to 5) fit the bar without horizontal
        // scroll: name on top, a single icon line below (✋ hand, 🏆 slain, 🎴 classes —
        // denominators dropped to save width; the full breakdown is in the opponent modal).
        oppHtml += `
                <div class="${chipClass}" ${chipClick} ${chipTitle}>
                    <span class="opponent-chip-name">${displayName}</span>
                    <span class="opponent-chip-stats">✋${opp.hand.length} 🏆<span class="win-stat-highlight">${stats.monsters}</span> 🎴<span class="win-stat-highlight">${stats.uniqueClasses}</span></span>
                </div>
            `;
    });

    // --- Center board: monsters ---
    const monstersHtml = (data.activeMonsters || []).map(m => renderCard(m, false, false, true, isMyTurn)).join('');

    // --- Discard pile ---
    const safeDiscardPile = data.discardPile || [];
    let discardHtml;
    if (safeDiscardPile.length > 0) {
        const topDiscard = safeDiscardPile[safeDiscardPile.length - 1];
        // The whole pile is tappable to open the read-only viewer. The inner card
        // has pointer-events:none so the tap reaches the wrapper (not the generic
        // card-inspect handler).
        discardHtml = `
            <div onclick="openDiscardViewer()" title="View discard pile" style="cursor:pointer; position:relative;">
                <div style="pointer-events:none;">${renderCard(topDiscard, false, false, false, false)}</div>
                <div class="discard-count" style="text-align:center; color:var(--text-muted); font-size:0.8rem; margin-top:5px; position:absolute; bottom:-25px; width:120px;">Discard: ${safeDiscardPile.length}</div>
            </div>
        `;
    } else {
        discardHtml = '<div class="card empty-slot">Discard</div>';
    }

    // --- My party leader (rendered into #leader-slot on the tray, NOT prepended
    //     to the party row) + party + slain ---
    const leaderHtml = me.leader ? renderCard(me.leader, true, false, false, isMyTurn) : '';
    let partyHtml = '';
    if (me.party && me.party.length > 0) {
        const sortedMyParty = [...me.party].sort((a, b) => {
            const classA = a.class || '';
            const classB = b.class || '';
            return classA.localeCompare(classB);
        });
        partyHtml += sortedMyParty.map(c => renderCard(c, true, false, false, isMyTurn)).join('');
    }
    if (me.slainMonsters.length > 0) {
        partyHtml += `<div class="slain-monsters-container">
            <h3>Slain (${me.slainMonsters.length}/3)</h3>
            <div class="slain-monsters-list">
                ${me.slainMonsters.map(m => `<div class="slain-monster-icon" data-id="${m.id}" onclick="inspectCard('${m.id}')" style="background-image:url('${cardArt(m)}'); cursor:pointer;" title="${m.name}"></div>`).join('')}
            </div>
        </div>`;
    }

    // --- Local win tracker --- (Phase 7: slain ✦✦○ pips + X/6 classes; both win paths)
    const myStats = calculateWinStats(me);
    const slain = Math.min(myStats.monsters, 3);
    const slainPips = [0, 1, 2].map(i => `<span class="wt-pip${i < slain ? ' on' : ''}">${i < slain ? '✦' : '○'}</span>`).join('');
    const winTrackHtml = `<span class="wt-slain" title="Slay 3 monsters to win">Slain ${slainPips}</span>`
        + `<span class="wt-classes" title="Collect 6 different classes to win">Classes <b>${myStats.uniqueClasses}/6</b></span>`;

    // --- My hand ---
    const handHtml = me.hand.map(c => renderCard(c, true, true, false, isMyTurn)).join('');

    return { oppHtml, monstersHtml, discardHtml, partyHtml, leaderHtml, winTrackHtml, handHtml };
}



// Current board-shell orientation ('landscape' | 'portrait'). The persistent
// panel nodes live in index.html as the LANDSCAPE shell; the portrait shell and
// the re-shell-on-flip path arrive in Phase 5. Tracking the mode here gives that
// later work a single seam and lets renderBoard stay a pure fragment-apply pass.
let currentBoardShellMode = 'landscape';

function ensureBoardShell() {
    // Landscape uses the static index.html shell — nothing to (re)build. When the
    // portrait shell lands (Phase 5) this is where a real flip will swap the
    // arrangement of the persistent nodes, and ONLY on an actual category change.
    const mode = (window.innerWidth <= window.innerHeight) ? 'portrait' : 'landscape';
    if (mode !== currentBoardShellMode && mode === 'landscape') {
        currentBoardShellMode = 'landscape';
    }
    return currentBoardShellMode;
}



// Write `html` into `el` only when it differs from what we last wrote there.
// renderBoard runs on EVERY server broadcast, but most board regions are unchanged
// between broadcasts; rewriting innerHTML anyway destroys and recreates the DOM and
// can drop an in-flight tap (the same class of bug as the opponent-modal rebuild,
// but for the board regions — it made the 3-player targeting flow flaky). The
// generated HTML string IS the signature: identical string => identical DOM, so
// skipping the write is always safe and never leaves stale UI. The fingerprint is
// stashed on the node itself, so a shell swap (new node on rotation) re-renders.
function setRegionHtml(el, html) {
    if (!el) return;
    if (el._lastHtmlSig === html) return;
    el._lastHtmlSig = html;
    el.innerHTML = html;
}

function setCardCountState(el, count) {
    if (!el) return;
    el.dataset.cardCount = String(count || 0);
    el.classList.toggle('cards-many', count >= 6);
    el.classList.toggle('cards-crowded', count >= 9);
    el.classList.toggle('cards-packed', count >= 12);
}

function renderBoard(data) {

    if (!data) return;

    const me = data.players[myId];

    if (!me) return;

    const opponentId = data.playerOrder.find(id => id !== myId);

    const opponent = opponentId ? data.players[opponentId] : null;

    const isMyTurn = myId === data.activePlayerSocketId;
    const becameMyTurn = isMyTurn && (!previousGameState || previousGameState.activePlayerSocketId !== myId);
    if (becameMyTurn) {
        triggerHaptic(100);
        playSound('turn');
        // One-shot pop on the turn badge (it's revealed later in this same render
        // pass), then drop the class so the idle pulse resumes.
        if (turnIndicator) {
            turnIndicator.classList.remove('turn-cue');
            void turnIndicator.offsetWidth;
            turnIndicator.classList.add('turn-cue');
            setTimeout(() => turnIndicator.classList.remove('turn-cue'), 650);
        }
    }

    // During the modifier window, compact the dice overlay (smaller dice, tighter
    // margins) so the modifier buttons AND the PASS button fit without the PASS
    // button being pushed below the console's visible area.
    const diceOverlayEl = document.getElementById('dice-overlay');
    if (diceOverlayEl) diceOverlayEl.classList.toggle('mod-compact', data.state === 'WAITING_FOR_MODIFIERS');



    currentPendingAction = data.pendingAction;
    
    // Prevent the generic target mode from swallowing dedicated waiting states
    const dedicatedStates = [
        'WAITING_FOR_HAND_SELECTION',
        'WAITING_FOR_SKILL_TARGET',
        'WAITING_FOR_IMMEDIATE_PLAY',
        'WAITING_FOR_SACRIFICE',
        'WAITING_FOR_DISCARD_PENALTY',
        'WAITING_FOR_MULTIPLE_DISCARDS',
        'WAITING_FOR_VARIABLE_DISCARD'
    ];
    isTargetMode = currentPendingAction !== null && !dedicatedStates.includes(data.state);



    // IMPORTANT: Explicitly hide the challenge modal if we are no longer in challenge phase!

    if (data.state !== 'WAITING_FOR_CHALLENGES') {

        if (challengeModal) {

            challengeModal.classList.add('hidden');

            challengeModal.style.display = 'none';

        }

    }



    // IMPORTANT: Explicitly hide the modifier modal if we are no longer in modifier phase!

    if (data.state !== 'WAITING_FOR_MODIFIERS') {

        const modModal = document.getElementById('modifier-modal');

        if (modModal) {

            modModal.classList.add('hidden');

            modModal.style.display = 'none';

        }

    }



    // IMPORTANT: Explicitly hide the skill prompt modal if we are no longer in skill prompt phase!

    if (data.state !== 'PROMPT_SKILL_ROLL') {

        const skillModal = document.getElementById('skill-prompt-modal');

        if (skillModal) {

            skillModal.classList.add('hidden');

            skillModal.style.display = 'none';

        }

    }

    

    // GUARANTEE NO GLASS CEILINGS: Force kill all overlays if we are just playing

    if (data.state === 'PLAYING') {

        closeAllModals();

    }



    myTargetMode = isTargetMode && currentPendingAction && (myId === currentPendingAction.playerToChoose);

    // A server-assigned plain target action (DESTROY/STEAL/EXCHANGE/RETURN_ITEM) means
    // any leftover CLIENT-side skill-targeting flags are stale — e.g. Whiskers resolves
    // its skill-target STEAL and then hands the actor a follow-up DESTROY in PLAYING
    // state. Without this, the stale isSkillTargeting hijacks the next tap into a no-op
    // use_hero_skill instead of selecting the destroy target. (Magic pre-targeting sets
    // isSkillTargeting too, but it never coincides with one of these pending actions
    // being assigned to us, so this is safe.)
    if (myTargetMode && currentPendingAction
        && ['DESTROY', 'STEAL', 'EXCHANGE_STEP_1', 'EXCHANGE_STEP_2', 'RETURN_ITEM'].includes(currentPendingAction.type)) {
        isSkillTargeting = false;
        isPlayerTargeting = false;
        isSelfItemTargeting = false;
        pendingHeroSkillCard = null;
    }

    // WAITING_FOR_SACRIFICE is a dedicated state (so isTargetMode is false), but the
    // chosen player still needs hero-targeting enabled to pick which Hero to give up
    // — used by both Hopper and monster SACRIFICE_HERO penalties.
    if (data.state === 'WAITING_FOR_SACRIFICE' && currentPendingAction && myId === currentPendingAction.playerToChoose) {
        myTargetMode = true;
    }



    // Track active hero globally for highlighting

    window.globalActiveHeroId = null;

    if (data.state === 'WAITING_FOR_MODIFIERS' && data.pendingRoll && data.pendingRoll.type === 'HERO_SKILL') {

        window.globalActiveHeroId = data.pendingRoll.targetHeroId;

    } else if ((isSkillTargeting || isMultiTargeting || isPlayerTargeting || isSelfItemTargeting) && pendingHeroSkillCard) {

        window.globalActiveHeroId = pendingHeroSkillCard.id;

    }



    // Toggle Draw/Discard buttons & AP display
    if (me) {
        playerAp.innerText = me.ap;
        if (data.state === 'PLAYING' && isMyTurn && !isTargetMode) {
            drawCardBtn.disabled = me.ap < 1;
            discardDrawBtn.disabled = me.ap < 3;
        } else {
            drawCardBtn.disabled = true;
            discardDrawBtn.disabled = true;
        }
    } else {
        playerAp.innerText = "0";
        drawCardBtn.disabled = true;
        discardDrawBtn.disabled = true;
    }



    if (isTargetMode) {

        document.body?.classList.add('target-mode-active');

        targetBanner?.classList.remove('hidden');

        if (myTargetMode) {

            if (currentPendingAction.type === 'EQUIP') {

                targetBanner?.classList.remove('hidden');

                targetBannerText.innerText = `SELECT A CARD TO ${String(currentPendingAction.type).replace(/_/g, ' ')}` + (typeof currentPendingAction.amount === 'number' ? ` (${currentPendingAction.amount} left)` : '');

            } else if (currentPendingAction.type === 'EXCHANGE_STEP_1') {

                targetBanner?.classList.remove('hidden');

                targetBannerText.innerText = `SELECT AN OPPONENT'S HERO TO STEAL!`;

            } else if (currentPendingAction.type === 'EXCHANGE_STEP_2') {

                targetBanner?.classList.remove('hidden');

                targetBannerText.innerText = `SELECT ONE OF YOUR HEROES TO GIVE AWAY!`;

            } else if (currentPendingAction.type === 'RETURN_ITEM') {

                targetBanner?.classList.remove('hidden');

                targetBannerText.innerText = `SELECT A HERO TO RETURN THEIR EQUIPPED ITEM!`;

            } else if (currentPendingAction.type === 'DISCARD') {

                targetBanner?.classList.remove('hidden');

                targetBannerText.innerText = `SELECT ${currentPendingAction.amount} CARD(S) FROM YOUR HAND TO DISCARD!`;

            } else if (currentPendingAction.type === 'STEAL') {

                targetBanner?.classList.remove('hidden');

                targetBannerText.innerText = `SELECT AN OPPONENT'S HERO TO STEAL!`;

            } else if (currentPendingAction.type === 'DESTROY') {

                targetBanner?.classList.remove('hidden');

                targetBannerText.innerText = `SELECT A HERO TO DESTROY!`;

                // Optional destroys (e.g. Pan Chucks' "you MAY destroy") can be declined.
                if (currentPendingAction.optional) {
                    targetBannerText.innerHTML += ` <button class="action-btn inline" style="margin-left:10px;" onclick="skipOptionalAction()">SKIP</button>`;
                }

            } else if (currentPendingAction.type === 'FORCE_DISCARD_TARGET') {

                targetBanner?.classList.remove('hidden');

                targetBannerText.innerText = `SELECT AN OPPONENT TO FORCE THEM TO DISCARD ${currentPendingAction.amount} CARD(S)!`;

            } else if (currentPendingAction.type === 'CONDITIONAL_PULL' || currentPendingAction.type === 'PUMA_PULL' || currentPendingAction.type === 'LOOK_AND_PULL') {

                targetBanner?.classList.remove('hidden');

                targetBannerText.innerText = `SELECT AN OPPONENT TO PULL A CARD FROM!`;

            } else if (currentPendingAction.type === 'CHOOSE_FROM_POOL') {

                targetBanner?.classList.remove('hidden');

                targetBannerText.innerHTML = `SELECT A CARD FROM THE DISCARD POOL <button class="action-btn inline attack" style="margin-left:15px; font-size:16px;" onclick="openPoolSelection()">View Pool</button>`;

            } else {

                targetBanner?.classList.remove('hidden');

                targetBannerText.innerText = `SELECT A CARD TO ${String(currentPendingAction.type).replace(/_/g, ' ')}` + (typeof currentPendingAction.amount === 'number' ? ` (${currentPendingAction.amount} left)` : '');

            }

            waitingOverlay?.classList.add('hidden');

        } else {

            targetBannerText.innerText = `WAITING FOR OPPONENT TO SELECT A TARGET...`;

            waitingOverlay?.classList.remove('hidden');

        }

        endTurnBtn.disabled = true;

    } else if (data.state === 'WAITING_FOR_HAND_SELECTION' && !isLocalTargeting) {

        // While picking a Hero to equip an item chosen from this prompt, the server
        // is still in WAITING_FOR_HAND_SELECTION — defer to the equip-targeting
        // branch below so its "Select a Hero to equip" banner stays visible.
        document.body?.classList.add('target-mode-active');

        targetBanner?.classList.remove('hidden');

        if (myId === data.pendingAction?.playerToChoose) {

            const meSel = data.players[myId];
            const allowedSel = data.pendingAction.allowedTypes || [];
            const hasPlayable = !!(meSel && meSel.hand.some(c => allowedSel.includes(c.type)));

            targetBannerText.innerText = 'SELECT A CARD FROM YOUR HAND TO PLAY';

            // The server allows skipping when the action is optional or you hold no
            // card of the required type — surface a button so you can't soft-lock.
            if (data.pendingAction.optional || !hasPlayable) {

                targetBannerText.innerHTML += ` <button class="action-btn inline" style="margin-left:10px;" onclick="skipHandSelection()">${hasPlayable ? 'SKIP' : 'NO PLAYABLE CARD — SKIP'}</button>`;

            }

        } else {

            targetBannerText.innerText = 'WAITING FOR OPPONENT TO SELECT A CARD...';

        }

        waitingOverlay?.classList.add('hidden');

        // The skill roll that triggered this hand-selection (e.g. Hook) left the
        // dice/modifier overlay up. Hide it so it doesn't sit behind the prompt.
        document.getElementById('dice-overlay')?.classList.add('hidden');
        document.getElementById('modifier-modal')?.classList.add('hidden');

    } else if (data.state === 'PLAYING' && data.pendingAction?.type === 'LOOK_AND_PULL') {

        document.body?.classList.add('target-mode-active');

        targetBanner?.classList.remove('hidden');

        if (myId === data.pendingAction?.playerToChoose) {

            targetBannerText.innerText = 'SELECT AN OPPONENT TO PULL A CARD FROM!';

        } else {

            targetBannerText.innerText = 'WAITING FOR OPPONENT TO SELECT A TARGET...';

        }

        waitingOverlay?.classList.add('hidden');

    } else if (data.state === 'PLAYING' && data.pendingAction?.type === 'PUMA_PULL') {

        document.body?.classList.add('target-mode-active');

        targetBanner?.classList.remove('hidden');

        if (myId === data.pendingAction?.playerToChoose) {

            targetBannerText.innerText = 'SELECT AN OPPONENT TO PULL 2 CARDS FROM!';

        } else {

            targetBannerText.innerText = 'WAITING FOR OPPONENT TO SELECT A TARGET...';

        }

        waitingOverlay?.classList.add('hidden');

    } else if (data.state === 'WAITING_FOR_MODIFIERS' || data.state === 'WAITING_FOR_CHALLENGES') {

        document.body?.classList.remove('target-mode-active');

        targetBanner?.classList.add('hidden'); // Hide the banner to prevent overlap with modals

        // The roll has happened — hide the pre-roll "ROLL" button and waiting text so
        // they don't linger in the dice overlay during the modifier window.
        const rollBtnEl = document.getElementById('manual-roll-btn');
        if (rollBtnEl) rollBtnEl.style.display = 'none';
        const waitRollEl = document.getElementById('waiting-roll-text');
        if (waitRollEl) waitRollEl.style.display = 'none';



        endTurnBtn.disabled = true;

        drawCardBtn.disabled = true;

        discardDrawBtn.disabled = true;

        waitingOverlay?.classList.add('hidden'); // Everyone needs to see their cards clearly

        if (isMyTurn) turnIndicator?.classList.remove('hidden');

        else turnIndicator?.classList.add('hidden');

        renderDiceAttackTarget(data); // keep the attacked-monster preview through the modifier window

    } else if (data.state === 'WAITING_TO_ROLL') {

        document.body?.classList.remove('target-mode-active');

        targetBanner?.classList.add('hidden');

        closeAllModals();

        

        const overlay = document.getElementById('dice-overlay');

        if (overlay) overlay?.classList.remove('hidden');



        document.getElementById('math-breakdown-banner').style.display = 'none';

        document.getElementById('modifier-staging-area').classList.add('hidden');

        document.getElementById('dice-final-result').style.opacity = '0';

        

        const die1 = document.getElementById('die1');
        const die2 = document.getElementById('die2');
        if (die1) {
            die1.removeAttribute('data-roll');
            die1.innerHTML = '';
        }
        if (die2) {
            die2.removeAttribute('data-roll');
            die2.innerHTML = '';
        }
        die1?.classList.remove('rolling');
        die2?.classList.remove('rolling');



        // Populate passives

        const passivesContainer = document.getElementById('dice-passives-container');

        passivesContainer.innerHTML = '';

        

        const roller = data.players[data.pendingRoll.rollerId];

        if (roller) {

            let reasonStr = data.pendingRoll.type === 'ATTACK' ? 'to attack a monster' : 'for a skill';

            if (data.pendingRoll.type === 'HERO_SKILL') {

                const hero = roller.party.find(h => h.id === data.pendingRoll.targetHeroId);

                if (hero) reasonStr = `for ${hero.name}`;

            }

            document.getElementById('dice-reason').innerText = `Rolling ${reasonStr}...`;

            renderDiceAttackTarget(data); // name + show the targeted monster (attacks only)



            // Check passives

            if (roller.leader) {

                if (roller.leader.effect_id === 'LEADER_BARD' && data.pendingRoll.type === 'HERO_SKILL') {

                    passivesContainer.innerHTML += `<div class="equipped-item-badge" style="position:relative; transform:none; bottom:auto; left:auto;">🎵 Bard Passive: +1</div>`;

                }

                if (roller.leader.effect_id === 'LEADER_RANGER' && data.pendingRoll.type === 'ATTACK') {

                    passivesContainer.innerHTML += `<div class="equipped-item-badge" style="position:relative; transform:none; bottom:auto; left:auto; background: var(--warning);">🏹 Ranger Passive: +1</div>`;

                }

            }

            if (roller.magicRollBonus) {

                passivesContainer.innerHTML += `<div class="equipped-item-badge" style="position:relative; transform:none; bottom:auto; left:auto; background: var(--accent);">✨ Magic: +${roller.magicRollBonus}</div>`;

            }

            if (data.pendingRoll.type === 'HERO_SKILL') {

                const hero = roller.party.find(h => h.id === data.pendingRoll.targetHeroId);

                if (hero && hero.equippedItem && hero.equippedItem.name === 'Fighter Mask') {

                    passivesContainer.innerHTML += `<div class="equipped-item-badge" style="position:relative; transform:none; bottom:auto; left:auto; background: var(--danger);">🛡️ Fighter Mask: +1</div>`;

                }

            }

            if (roller.slainMonsters) {

                if (roller.slainMonsters.some(m => m.effect_id === 'MONSTER_ANURAN_CAULDRON')) {

                    passivesContainer.innerHTML += `<div class="equipped-item-badge" style="position:relative; transform:none; bottom:auto; left:auto; background: purple;">🐸 Anuran Cauldron: +1</div>`;

                }

                if (roller.slainMonsters.some(m => m.effect_id === 'MONSTER_DARK_DRAGON_KING') && data.pendingRoll.type === 'HERO_SKILL') {

                    passivesContainer.innerHTML += `<div class="equipped-item-badge" style="position:relative; transform:none; bottom:auto; left:auto; background: #333;">🐉 Dark Dragon: +1</div>`;

                }

            }

        }



        if (myId === data.pendingRoll.rollerId) {

            const rb = document.getElementById('manual-roll-btn');
            rb.style.display = 'inline-block';
            // Reset the label — it may still read "ROLL FOR CHALLENGE" from a prior
            // challenge roll. This is a skill/attack roll.
            rb.innerText = data.pendingRoll.type === 'ATTACK' ? 'ROLL TO ATTACK' : 'ROLL FOR SKILL';

            document.getElementById('waiting-roll-text').style.display = 'none';

        } else {

            document.getElementById('manual-roll-btn').style.display = 'none';

            document.getElementById('waiting-roll-text').style.display = 'block';

            document.getElementById('waiting-roll-text').innerText = `Waiting for ${getPlayerName(data.pendingRoll.rollerId)} to roll...`;

        }

    } else if (data.state === 'WAITING_TO_ROLL_CHALLENGE') {

        document.body?.classList.remove('target-mode-active');

        targetBanner?.classList.add('hidden');

        closeAllModals();

        

        const overlay = document.getElementById('dice-overlay');

        if (overlay) overlay?.classList.remove('hidden');

        

        document.getElementById('math-breakdown-banner').style.display = 'none';

        document.getElementById('modifier-staging-area').classList.add('hidden');

        document.getElementById('dice-final-result').style.opacity = '0';

        document.getElementById('dice-reason').innerText = 'Rolling for Challenge!';

        renderDiceAttackTarget(data); // clears any stale monster preview (challenge != attack)

        const pRoll = data.pendingRoll;

        const isMyTurnToRoll = (myId === pRoll.activeId && !pRoll.activeRolled) || (myId === pRoll.challengerId && !pRoll.challengerRolled);

        

        if (isMyTurnToRoll) {

            document.getElementById('manual-roll-btn').style.display = 'inline-block';

            document.getElementById('manual-roll-btn').innerText = 'ROLL FOR CHALLENGE';

            document.getElementById('waiting-roll-text').style.display = 'none';

        } else {

            document.getElementById('manual-roll-btn').style.display = 'none';

            document.getElementById('waiting-roll-text').style.display = 'block';

            document.getElementById('waiting-roll-text').innerText = 'Waiting for players to roll...';

        }

    } else if (data.state === 'WAITING_FOR_SKILL_TARGET') {

        endTurnBtn.disabled = true;

        drawCardBtn.disabled = true;

        discardDrawBtn.disabled = true;

        

        const overlay = document.getElementById('dice-overlay');

        if (overlay) {

            overlay.classList.add('hidden');

            overlay.style.display = 'none';

        }



        if (data.pendingAction && myId === data.pendingAction.originalActor) {

            waitingOverlay?.classList.add('hidden');

            targetBanner?.classList.remove('hidden');

            document.body?.classList.add('target-mode-active');

            

            if (data.pendingAction.type === 'SKILL_TARGET_MULTI') {

                // Only clear the selection when first entering multi-target mode.
                // renderBoard runs on every broadcast (and is called directly when a
                // target is picked), so an unconditional reset here would wipe the
                // selection the moment the player makes it.
                if (!isMultiTargeting) multiTargetSelected = [];

                isMultiTargeting = true;

                targetBannerText.innerText = "Select up to 2 opponent Heroes to target.";

                targetBannerText.innerHTML += ` <button onclick="submitMultiTargets()" style="margin-left: 10px; padding: 5px 10px; background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer;">Submit Targets</button>`;

            } else if (data.pendingAction.type === 'SKILL_TARGET_PLAYER') {

                myTargetMode = true; // or isPlayerTargeting

                isPlayerTargeting = true;

                targetBannerText.innerText = "Select an opponent's player board to target.";

            } else if (data.pendingAction.type === 'SKILL_TARGET_SELF_ITEM') {

                isSelfItemTargeting = true;

                targetBannerText.innerText = "Select one of your equipped items to target.";

            } else if (data.pendingAction.type === 'SKILL_TARGET_DISCARD') {

                targetBannerText.innerText = "Select a card from the discard pile.";

                // Open the discard-search modal once (renderBoard runs on every
                // broadcast); selecting a card submits it via submit_skill_target.
                const dsm = document.getElementById('discard-search-modal');
                if (dsm && dsm.classList.contains('hidden')) openDiscardSearch(data.pendingAction.skillId);

            } else {

                myTargetMode = true;

                isSkillTargeting = true;

                targetBannerText.innerText = "Select an opponent's Hero to target with this skill.";

            }

        } else {

            document.body?.classList.remove('target-mode-active');

            waitingOverlay?.classList.remove('hidden');

            targetBanner?.classList.remove('hidden');

            targetBannerText.innerText = "WAITING FOR OPPONENT TO SELECT A TARGET...";

        }

    } else if (data.state === 'WAITING_FOR_IMMEDIATE_PLAY') {

        document.body?.classList.remove('target-mode-active');

        targetBanner?.classList.add('hidden');

        endTurnBtn.disabled = true;

        drawCardBtn.disabled = true;

        discardDrawBtn.disabled = true;



        if (data.pendingAction && myId === data.pendingAction.playerToChoose) {

            waitingOverlay?.classList.add('hidden');

            document.getElementById('immediate-play-modal').classList.remove('hidden');

            document.getElementById('immediate-play-card').innerHTML = renderCard(data.pendingCard, true, true);

        } else {

            waitingOverlay?.classList.remove('hidden');

            targetBanner?.classList.remove('hidden');

            targetBannerText.innerText = "WAITING FOR OPPONENT TO RESOLVE CARD EFFECT...";

        }

    } else if (data.state === 'WAITING_FOR_SACRIFICE') {

        targetBanner?.classList.add('hidden');

        endTurnBtn.disabled = true;

        drawCardBtn.disabled = true;

        discardDrawBtn.disabled = true;



        if (data.pendingAction && myId === data.pendingAction.playerToChoose) {

            // Enable target visuals so the chooser can tap one of their own Heroes.
            document.body?.classList.add('target-mode-active');

            waitingOverlay?.classList.add('hidden');

            targetBanner?.classList.remove('hidden');

            targetBannerText.innerText = `SELECT ONE OF YOUR HEROES TO SACRIFICE AS A PENALTY`;

        } else {

            document.body?.classList.remove('target-mode-active');


            waitingOverlay?.classList.remove('hidden');

            targetBanner?.classList.remove('hidden');

            targetBannerText.innerText = "WAITING FOR OPPONENT TO RESOLVE PENALTY...";

        }

    } else if (data.state === 'WAITING_FOR_DISCARD_PENALTY' || data.state === 'WAITING_FOR_MULTIPLE_DISCARDS' || data.state === 'WAITING_FOR_VARIABLE_DISCARD') {

        document.body?.classList.remove('target-mode-active');

        targetBanner?.classList.add('hidden');

        endTurnBtn.disabled = true;

        drawCardBtn.disabled = true;

        discardDrawBtn.disabled = true;



        if (data.state === 'WAITING_FOR_MULTIPLE_DISCARDS') {

            if (data.pendingAction && data.pendingAction.targets.includes(myId) && !data.pendingAction.completed.includes(myId)) {

                waitingOverlay?.classList.add('hidden');

                targetBanner?.classList.remove('hidden');

                let amt = data.pendingAction.amount;

                targetBannerText.innerHTML = `SELECT ${amt} CARD(S) TO DISCARD <button class="action-btn inline attack" style="margin-left:15px; font-size:16px;" onclick="submitPenaltyDiscard()">Confirm</button>`;

                if (!isMultiTargeting || multiTargetMax !== amt) {

                    isMultiTargeting = true;

                    multiTargetMax = amt;

                    multiTargetSelected = [];

                }

            } else {

                waitingOverlay?.classList.remove('hidden');

                targetBanner?.classList.remove('hidden');

                targetBannerText.innerText = "WAITING FOR OPPONENTS TO DISCARD...";

            }

        } else if (data.state === 'WAITING_FOR_VARIABLE_DISCARD') {

            if (data.pendingAction && myId === data.pendingAction.originalActor) {

                waitingOverlay?.classList.add('hidden');

                targetBanner?.classList.remove('hidden');

                let maxAmt = data.pendingAction.maxAmount;

                let currentAmt = multiTargetSelected ? multiTargetSelected.length : 0;

                targetBannerText.innerHTML = `SELECT UP TO ${maxAmt} CARD(S) TO DISCARD <button class="action-btn inline attack" style="margin-left:15px; font-size:16px;" onclick="submitPenaltyDiscard()">CONFIRM ${currentAmt} DISCARDS</button>`;

                if (!isMultiTargeting || multiTargetMax !== maxAmt) {

                    isMultiTargeting = true;

                    multiTargetMax = maxAmt; // Allow up to maxAmt

                    multiTargetSelected = [];

                }

            } else {

                waitingOverlay?.classList.remove('hidden');

                targetBanner?.classList.remove('hidden');

                targetBannerText.innerText = "WAITING FOR OPPONENT TO DISCARD...";

            }

        } else {

            if (data.pendingAction && myId === data.pendingAction.playerToChoose) {

                waitingOverlay?.classList.add('hidden');

                targetBanner?.classList.remove('hidden');

                let amt = data.pendingAction.amount;

                targetBannerText.innerHTML = `SELECT ${amt} CARD(S) TO DISCARD AS A PENALTY <button class="action-btn inline attack" style="margin-left:15px; font-size:16px;" onclick="submitPenaltyDiscard()">Confirm</button>`;

                if (!isMultiTargeting || multiTargetMax !== amt) {

                    isMultiTargeting = true;

                    multiTargetMax = amt;

                    multiTargetSelected = [];

                }

            } else {

                waitingOverlay?.classList.remove('hidden');

                targetBanner?.classList.remove('hidden');

                targetBannerText.innerText = "WAITING FOR OPPONENT TO RESOLVE PENALTY...";

            }

        }

    } else if (isLocalTargeting || isSelfItemTargeting) {

        // Client-only targeting (equip an item / target your own equipped item)
        // runs while the server is still in PLAYING with no pendingAction.
        // startEquipTargeting already showed the banner; keep it visible here, or
        // the default PLAYING branch below would immediately hide it again.
        document.body?.classList.add('target-mode-active');

        targetBanner?.classList.remove('hidden');

        waitingOverlay?.classList.add('hidden'); // never coexist with the equip banner

    } else {

        document.body?.classList.remove('target-mode-active');

        targetBanner?.classList.add('hidden');

        waitingOverlay?.classList.add('hidden'); // Fix: ensure overlay is cleared

        challengeModal?.classList.add('hidden');

        modifierModal?.classList.add('hidden');

        const diceOverlay = document.getElementById('dice-overlay');

        if (diceOverlay) diceOverlay?.classList.add('hidden');

        

        // Check if player is required to act in a global action

        const isRequiredToAct = data.pendingGlobalAction && data.pendingGlobalAction.pendingPlayerIds.includes(myId);

        // Re-show the discard/give/sacrifice prompt from state (not just the one-shot
        // socket event) so a refresh or dropped packet mid-action can't strand the
        // table waiting on this player. renderGlobalActionPrompt no-ops if it's already open.
        if (isRequiredToAct) renderGlobalActionPrompt(data.pendingGlobalAction);



        if (isMyTurn || isRequiredToAct) {

            endTurnBtn.disabled = (data.state !== 'PLAYING');

            turnIndicator?.classList.toggle('hidden', !isMyTurn);

            document.getElementById('player-controls')?.classList.remove('block-actions');

        } else {

            endTurnBtn.disabled = true;

            turnIndicator?.classList.add('hidden');

            document.getElementById('player-controls')?.classList.add('block-actions');

        }

    }



    // The "Waiting for Opponent..." overlay and the target banner both announced
    // waiting, so several states showed them at once (a doubled banner). They are
    // mutually exclusive — if the waiting overlay is up, the banner is redundant.
    if (waitingOverlay && !waitingOverlay.classList.contains('hidden')) {
        targetBanner?.classList.add('hidden');
    }

    // Build all shared board fragments once (Phase 4), then write each into its
    // persistent panel node below. ensureBoardShell() keeps the landscape shell
    // (and, from Phase 5, swaps to portrait only on an actual orientation flip).
    ensureBoardShell();
    const boardParts = buildBoardParts(data, { me, isMyTurn, myTargetMode, currentPendingAction });

    // Opponents Bar (Chips)

    setRegionHtml(opponentsBar, boardParts.oppHtml);



    // Refresh modal if open — but ONLY when its contents/targeting context changed.
    // Re-rendering on every (often duplicate) broadcast rebuilt the card DOM and
    // could drop an in-flight tap (e.g. selecting an opponent hero to target),
    // which looked like "nothing happened" when targeting in multiplayer.
    if (currentlyViewedOpponentId && opponentModal && !opponentModal.classList.contains('hidden')) {
        if (oppModalSignature(currentlyViewedOpponentId) !== window._oppModalSig) {
            openOpponentModal(currentlyViewedOpponentId);
        }
    }



    // Center Board

    // Monsters are now always on-board (Phase 6), so guard the rebuild: only
    // rewrite when something affecting their display actually changed (the monster
    // set, whose turn it is, or the party/AP that decides attackability). Without
    // this the always-visible monster cards would re-render on every broadcast and
    // could drop an in-flight attack tap — the same churn fix as the opponent modal.
    const partySig = `${me.leader && me.leader.class || ''}|${(me.party || []).map(c => c.class).sort().join(',')}`;
    const monstersSig = `${(data.activeMonsters || []).map(m => m.id).join(',')}|${data.state}|${isMyTurn}|${me.ap}|${partySig}`;
    if (monstersSig !== window._monstersSig) {
        window._monstersSig = monstersSig;
        activeMonsters.innerHTML = boardParts.monstersHtml;
    }
    setCardCountState(activeMonsters, (data.activeMonsters || []).length);

    

    const globalDiscardPool = document.getElementById('global-discard-pool');

    const gaPool = data.pendingGlobalAction;
    if (gaPool && gaPool.type === 'MULTI_DISCARD_AND_CHOOSE' && gaPool.awaitingChoice && gaPool.submittedCards) {

        // Beary Wise: every opponent has discarded into the pool; the initiator picks
        // one to keep. Render this from broadcastState (not just the one-shot
        // global_action_resolution event) so a dropped packet or a refresh can't
        // soft-lock the game. The initiator gets Select buttons; everyone else watches.
        const iChoose = gaPool.initiatorId === myId;
        const poolSig = `${gaPool.submittedCards.map(c => c.id).join(',')}|${iChoose}`;

        if (poolSig !== window._gaPoolSig) {
            window._gaPoolSig = poolSig;
            const poolCards = document.getElementById('pool-cards');
            poolCards.innerHTML = gaPool.submittedCards.map(c => {
                const btn = iChoose
                    ? `<button class="action-btn inline attack" onclick="resolveGlobalAction('${c.id}')">Select</button>`
                    : '';
                return `<div class="card glow-target">
                        <div class="card-img${artClass(c)}" style="background-image: url('${cardArt(c)}')"></div>
                        <div class="card-info">
                            <div class="card-name">${c.name}</div>
                            <div class="card-type">${c.type}</div>
                        </div>
                        ${btn}
                    </div>`;
            }).join('');
        }
        globalDiscardPool?.classList.remove('hidden');

    } else {

        window._gaPoolSig = null;
        globalDiscardPool?.classList.add('hidden');

    }

    // Stale mandatory-discard guard: the modal is in closeAllModals' keepOpen
    // list (a pending REQUIRED action must survive re-renders), but if the
    // global action resolves WITHOUT this player's submission (timeout,
    // absorbed effect, emptied hand) nothing ever closed it and it ate every
    // tap — a real softlock. Close it the moment the broadcast shows this
    // player is no longer required to act.
    const mdmEl = document.getElementById('mandatory-discard-modal');
    if (mdmEl && !mdmEl.classList.contains('hidden')) {
        const gaNow = data.pendingGlobalAction;
        const stillRequired = gaNow && Array.isArray(gaNow.pendingPlayerIds) && gaNow.pendingPlayerIds.includes(myId);
        if (!stillRequired) mdmEl.classList.add('hidden');
    }

    // Stale dice-overlay guard: a roll can resolve straight into a state that
    // needs the board/hand/modal underneath, without passing any of the
    // transitions that call closeAllModals — leaving the roll overlay parked
    // over the very UI the player must now use. Act-now states hide it
    // immediately; for everything else with no pending roll, a short timer
    // lets the settled result read before the overlay self-hides (the timer,
    // not a future broadcast, does the hiding — a blocked player produces no
    // further broadcasts).
    {
        const diceOv = document.getElementById('dice-overlay');
        const rollingStates = ['WAITING_FOR_MODIFIERS', 'WAITING_TO_ROLL', 'WAITING_TO_ROLL_CHALLENGE'];
        const actNowStates = ['WAITING_FOR_DISCARD_PENALTY', 'WAITING_FOR_MULTIPLE_DISCARDS', 'WAITING_FOR_VARIABLE_DISCARD',
            'WAITING_FOR_SACRIFICE', 'WAITING_FOR_HAND_SELECTION', 'WAITING_FOR_GLOBAL_ACTION',
            'WAITING_FOR_IMMEDIATE_PLAY', 'WAITING_FOR_SKILL_TARGET'];
        const hideNow = () => {
            if (diceOv) {
                diceOv.classList.add('hidden');
                diceOv.style.display = '';
            }
        };
        if (diceOv && !diceOv.classList.contains('hidden')) {
            if (actNowStates.includes(data.state)) {
                hideNow();
            } else if (!data.pendingRoll && !rollingStates.includes(data.state)) {
                clearTimeout(window._diceStaleTimer);
                window._diceStaleTimer = setTimeout(() => {
                    const s = window.latestGameState;
                    if (s && !s.pendingRoll && !rollingStates.includes(s.state)) hideNow();
                }, 2500);
            } else {
                clearTimeout(window._diceStaleTimer);
                window._diceStaleTimer = null;
            }
        }
    }

    

    setRegionHtml(discardPile, boardParts.discardHtml);



    // My Area

    setRegionHtml(playerParty, boardParts.partyHtml);
    setCardCountState(playerParty, (me.party || []).length + (me.slainMonsters || []).length);

    // Party leader — raised on the tray (own slot), not in the party row.
    setRegionHtml(document.getElementById('leader-slot'), boardParts.leaderHtml);



    // Update local player win tracker

    const myWinTracker = document.getElementById('player-win-tracker');

    setRegionHtml(myWinTracker, boardParts.winTrackHtml);

    // AP gems (Phase 7): one amber gem per current AP, from the real me.ap (can be
    // 4 with Mega Slime — show a 4th slot only then, otherwise a 3-slot track).
    const apGemsEl = document.getElementById('ap-gems');
    if (apGemsEl) {
        const ap = me.ap || 0;
        const slots = ap > 3 ? 4 : 3;
        const apHtml = `<span class="ap-gems-label">AP</span>` +
            Array.from({ length: slots }, (_, i) => `<span class="ap-gem${i < ap ? ' on' : ''}"></span>`).join('');
        setRegionHtml(apGemsEl, apHtml);
    }

    // Reward toast (Phase 7): celebrate when MY slain count grows. Client-side
    // only — reads slainMonsters, fires no socket events. Guarded by a remembered
    // count so it shows once per slay, not on every re-render/rotation.
    const slainNow = me.slainMonsters ? me.slainMonsters.length : 0;
    if (window._lastSlainShown === undefined) window._lastSlainShown = slainNow;
    if (slainNow > window._lastSlainShown) {
        const newest = me.slainMonsters[me.slainMonsters.length - 1];
        showRewardToast(newest && newest.name);
    }
    window._lastSlainShown = slainNow;

    setRegionHtml(playerHand, boardParts.handHtml);
    setCardCountState(playerHand, (me.hand || []).length);

    applyMobileStacking();
}

// Brief celebratory banner shown when the local player slays a monster (Phase 7).
let _rewardToastTimer = null;
function showRewardToast(monsterName) {
    const toast = document.getElementById('reward-toast');
    if (!toast) return;
    const nameEl = document.getElementById('reward-toast-name');
    if (nameEl) nameEl.textContent = monsterName || '';
    toast.classList.remove('hidden');
    toast.classList.add('show');
    playSound('coin');
    triggerHaptic([30, 40, 30]);
    if (_rewardToastTimer) clearTimeout(_rewardToastTimer);
    _rewardToastTimer = setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hidden');
    }, 2800);
}
window.showRewardToast = showRewardToast;



socket.on('dice_roll_pending', (data) => {

    try {

        // 1. Hide conflicting modals to prevent overlap

        if (cardInfoPanel) { cardInfoPanel.classList.add('hidden'); cardInfoPanel.style.display = 'none'; }

        if (challengeModal) { challengeModal.classList.add('hidden'); challengeModal.style.display = 'none'; }

        if (skillPromptModal) { skillPromptModal.classList.add('hidden'); skillPromptModal.style.display = 'none'; }

        const discardModal = document.getElementById('discard-search-modal');

        if (discardModal) { discardModal.classList.add('hidden'); discardModal.style.display = 'none'; }

        closeOpponentModal();

        

        // NUKE THE BACKGROUND MODALS

        const targetBanner = document.getElementById('target-banner');

        if (targetBanner) { 

            targetBanner.classList.add('hidden'); 

            targetBanner.style.display = ''; 

        }

        

        closeAllModals(); // aggressive reset before modifier phase



        const modifierModalElement = document.getElementById('modifier-modal');

        if (modifierModalElement) {

            if (data.type === 'CHALLENGE' || data.isChallenge) {

                modifierModalElement.classList.remove('hidden');

                modifierModalElement.style.display = '';

            } else {

                modifierModalElement.classList.add('hidden');

                modifierModalElement.style.display = 'none';

            }

        }



        if (data.type === 'CHALLENGE' || data.isChallenge) {

            modifierTitle.innerText = `Challenge Pending!`;

            modifierText.innerText = `Modifiers can be played on either player's roll ${data.reason}.`;

            

            const aBase = data.activeRollBase ?? data.activeTotal ?? 0;

            const aMod = data.activeModifierTotal ?? 0;

            const aFinal = data.activeFinalTotal ?? aBase;



            const cBase = data.challengerRollBase ?? data.challengerTotal ?? 0;

            const cMod = data.challengerModifierTotal ?? 0;

            const cFinal = data.challengerFinalTotal ?? cBase;



            let breakdownHTML = `

                <div style="display:flex; justify-content: space-around; width:100%; gap: 10px;">

                    <div style="text-align:center; flex: 1; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px;">

                        <h4 style="margin:0 0 5px 0;">${data.activeName}</h4>

                        <div style="font-size: 0.9rem;">Base Roll: <strong>${aBase}</strong></div>

                        <div style="font-size: 0.9rem;">Modifiers: <strong style="color:var(--accent)">${aMod > 0 ? '+' : ''}${aMod}</strong></div>

                        <div class="roll-total" style="font-size: 1.2rem; margin-top: 5px;">Total: ${aFinal}</div>

                    </div>

                    <div style="text-align:center; flex: 1; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px; border: 1px solid var(--danger);">

                        <h4 style="margin:0 0 5px 0; color: var(--danger);">${data.challengerName}</h4>

                        <div style="font-size: 0.9rem;">Base Roll: <strong>${cBase}</strong></div>

                        <div style="font-size: 0.9rem;">Modifiers: <strong style="color:var(--danger)">${cMod > 0 ? '+' : ''}${cMod}</strong></div>

                        <div class="roll-total" style="font-size: 1.2rem; margin-top: 5px;">Total: ${cFinal}</div>

                    </div>

                </div>

            `;

            const breakdownContainer = document.getElementById('dice-breakdown-container');

            if (breakdownContainer) breakdownContainer.innerHTML = breakdownHTML;



        } else {

            modifierTitle.innerText = `Dice Roll Pending...`;

            modifierText.innerText = `${data.rollerName} is rolling ${data.reason}`;

            

            let breakdownHTML = '<ul class="roll-breakdown">';

            if (data.breakdown) {

                data.breakdown.forEach(item => {

                    const sign = item.value >= 0 ? '+' : '';

                    breakdownHTML += `<li>${item.source}: <strong>${sign}${item.value}</strong></li>`;

                });

            }

            if (data.modifierTotal !== 0) {

                const sign = data.modifierTotal > 0 ? '+' : '';

                breakdownHTML += `<li>Modifiers Played: <strong style="color:var(--accent)">${sign}${data.modifierTotal}</strong></li>`;

            }

            breakdownHTML += `</ul><div class="roll-total">Total: ${data.finalTotal}</div>`;

            

            const breakdownContainer = document.getElementById('dice-breakdown-container');

            if (breakdownContainer) breakdownContainer.innerHTML = breakdownHTML;

        }        

        

        const passed = latestGameState && latestGameState.passedModifiers?.includes(myId);

        

        if (passed) {

            modifierPassBtn.disabled = true;

            modifierPassBtn.innerText = "WAITING FOR OTHERS...";

        } else {

            modifierPassBtn.disabled = false;

            modifierPassBtn.innerText = "PASS";

        }



        // Hide redundant title
        const modTitle = document.getElementById('modifier-title');
        if (modTitle) modTitle.style.display = 'none';

        if (latestGameState && latestGameState.players[myId]) {
            const targetContainer = (data.type === 'CHALLENGE' || data.isChallenge) 
                ? document.getElementById('modifier-cards') 
                : document.getElementById('dice-hand-modifiers');
                
            if (targetContainer) {
                if (passed) {
                    targetContainer.innerHTML = '';
                } else {
                    targetContainer.innerHTML = `<div style="color: var(--accent); font-size: 1.1rem; margin: 15px 0; text-align: center;">Play a Modifier from your hand,<br>or click Pass.</div>`;
                }
            }
        }



        if (data.type === 'CHALLENGE' || data.isChallenge) {
            // WE NOW USE THE NORMAL DICE OVERLAY FOR CHALLENGES
            // Do not hide the overlay!
        }



        const signature = `${data.rollerId}-${data.reason}`;

        const overlay = document.getElementById('dice-overlay');

        const die1 = document.getElementById('die1');

        const die2 = document.getElementById('die2');

        const banner = document.getElementById('math-breakdown-banner');

        const reason = document.getElementById('dice-reason');

        const resultDisplay = document.getElementById('dice-final-result');

        const stagingArea = document.getElementById('modifier-staging-area');



        if (window.currentRollSignature !== signature || overlay?.classList.contains('hidden')) {

            window.currentRollSignature = signature;

            overlay?.classList.remove('hidden');

            const waitText = document.getElementById('waiting-roll-text');
            if (waitText) waitText.style.display = 'none';
            const manRollBtn = document.getElementById('manual-roll-btn');
            if (manRollBtn) manRollBtn.style.display = 'none';

            reason.innerText = `Rolling ${data.reason}...`;

            resultDisplay.style.opacity = '0';

            stagingArea.innerHTML = ''; 



            banner.style.display = 'block';

            stagingArea?.classList.remove('hidden');



            const passBtn = document.getElementById('dice-pass-btn');

            if (passBtn) {

                passBtn.style.display = 'inline-block';

                if (passed) {

                    passBtn.disabled = true;

                    passBtn.innerText = "WAITING FOR OTHERS...";

                } else {

                    passBtn.disabled = false;

                    passBtn.innerText = "NO MODIFIERS (PASS)";

                }

            }

            

            const rollBtn = document.getElementById('manual-roll-btn');

            if (rollBtn) rollBtn.style.display = 'none';



            if (window.diceRollInterval) {
                clearInterval(window.diceRollInterval);
            }

            die1?.classList.add('rolling');
            die2?.classList.add('rolling');
            startDiceSprite();
            playSound('dice');
            triggerHaptic(50);
            
            window.diceRollInterval = setInterval(() => {
                const temp1 = Math.floor(Math.random() * 6) + 1;
                const temp2 = Math.floor(Math.random() * 6) + 1;
                if (die1) {
                    die1.setAttribute('data-roll', temp1);
                    die1.innerHTML = renderDicePips(temp1);
                }
                if (die2) {
                    die2.setAttribute('data-roll', temp2);
                    die2.innerHTML = renderDicePips(temp2);
                }
            }, 80);

            banner.innerText = data.isChallenge ? `[🎲 ?] vs [🎲 ?]` : `[🎲 ?] + [🎲 ?] + [⭐ ?] = ?`;

            setTimeout(() => {
                clearInterval(window.diceRollInterval);
                window.diceRollInterval = null;
                stopDiceSprite();
                die1?.classList.remove('rolling');
                die2?.classList.remove('rolling');
                settleDie(die1);
                settleDie(die2);

                if (data.isChallenge) {
                    if (die1) {
                        die1.setAttribute('data-roll', '?');
                        die1.innerHTML = renderDicePips('?');
                    }
                    if (die2) {
                        die2.setAttribute('data-roll', '?');
                        die2.innerHTML = renderDicePips('?');
                    }
                    
                    const activeModText = data.activeModifierTotal ? ` ${data.activeModifierTotal > 0 ? '+' : ''}${data.activeModifierTotal}` : '';
                    const challModText = data.challengerModifierTotal ? ` ${data.challengerModifierTotal > 0 ? '+' : ''}${data.challengerModifierTotal}` : '';
                    
                    banner.innerHTML = `<div style="display:flex; justify-content:center; gap: 20px; font-size:1.5rem;">
                        <div style="color:var(--danger);">
                            ${data.activeName}<br>
                            <span style="color:white; font-size:2.2rem;">${data.activeFinalTotal}</span>
                            <div style="font-size:1rem; color:#aaa;">[🎲 ${data.activeTotal}]${activeModText}</div>
                        </div>
                        <div style="color:white; align-self:center; font-size: 2rem;">VS</div>
                        <div style="color:var(--info);">
                            ${data.challengerName}<br>
                            <span style="color:white; font-size:2.2rem;">${data.challengerFinalTotal}</span>
                            <div style="font-size:1rem; color:#aaa;">[🎲 ${data.challengerTotal}]${challModText}</div>
                        </div>
                    </div>`;
                    
                    resultDisplay.innerText = `Active: ${data.activeFinalTotal} | Challenger: ${data.challengerFinalTotal}`;
                    playResolutionBurst(banner, 'damage');
                } else {
                    const r1 = data.roll1 || 1;
                    const r2 = data.roll2 || 1;
                    if (die1) {
                        die1.setAttribute('data-roll', r1);
                        die1.innerHTML = renderDicePips(r1);
                    }
                    if (die2) {
                        die2.setAttribute('data-roll', r2);
                        die2.innerHTML = renderDicePips(r2);
                    }
                    
                    banner.innerHTML = buildRollEquationHTML(data);
                    resultDisplay.innerText = `Final Total: ${data.finalTotal}`;
                }

                resultDisplay.style.opacity = '1';
            }, 1000);

        } else {
            if (data.isChallenge) {
                const activeModText = data.activeModifierTotal ? ` ${data.activeModifierTotal > 0 ? '+' : ''}${data.activeModifierTotal}` : '';
                const challModText = data.challengerModifierTotal ? ` ${data.challengerModifierTotal > 0 ? '+' : ''}${data.challengerModifierTotal}` : '';
                
                banner.innerHTML = `<div style="display:flex; justify-content:center; gap: 20px; font-size:1.5rem;">
                    <div style="color:var(--danger);">
                        ${data.activeName}<br>
                        <span style="color:white; font-size:2.2rem;">${data.activeFinalTotal}</span>
                        <div style="font-size:1rem; color:#aaa;">[🎲 ${data.activeTotal}]${activeModText}</div>
                    </div>
                    <div style="color:white; align-self:center; font-size: 2rem;">VS</div>
                    <div style="color:var(--info);">
                        ${data.challengerName}<br>
                        <span style="color:white; font-size:2.2rem;">${data.challengerFinalTotal}</span>
                        <div style="font-size:1rem; color:#aaa;">[🎲 ${data.challengerTotal}]${challModText}</div>
                    </div>
                </div>`;
                
                resultDisplay.innerText = `Active: ${data.activeFinalTotal} | Challenger: ${data.challengerFinalTotal}`;
            } else {
                banner.innerHTML = buildRollEquationHTML(data);
                resultDisplay.innerText = `Final Total: ${data.finalTotal}`;
            }
        }

        // Ensure Pass Button is visible and styled correctly inside the console
        const passBtn = document.getElementById('dice-pass-btn');
        if (passBtn) {
            passBtn.style.display = 'block';
            passBtn.style.width = '100%';
            passBtn.style.padding = '15px';
            passBtn.style.marginTop = '10px';
            passBtn.style.fontSize = '1.1rem';
            passBtn.style.fontWeight = 'bold';

            // 1. FORCE KILL INVISIBLE GAPS (Removes 240px of dead space)
            const stagingArea = document.getElementById('modifier-staging-area');
            if (stagingArea) {
                stagingArea.style.minHeight = '0px';
                stagingArea.style.paddingTop = '5px';
            }
            const handMods = document.getElementById('dice-hand-modifiers');
            if (handMods) {
                handMods.style.minHeight = '0px';
                handMods.style.paddingTop = '0px';
                handMods.style.marginTop = '0px';
                handMods.innerHTML = ''; // Clear redundant text
            }

            // 2. FORCE HIDE REDUNDANT FINAL SCORE TEXT
            const finalResult = document.getElementById('dice-final-result');
            if (finalResult) finalResult.style.display = 'none';

            // 3. INSTRUCTION HINT ABOVE PASS BUTTON. Modifiers are now played by
            // tapping the card in your hand (inspect → Play Modifier), not from
            // buttons inside this overlay.
            let instructionEl = document.getElementById('modifier-instruction-text');
            if (!instructionEl) {
                instructionEl = document.createElement('div');
                instructionEl.id = 'modifier-instruction-text';
                instructionEl.style.width = '100%';
                instructionEl.style.textAlign = 'center';
                instructionEl.style.margin = '8px 0';
                passBtn.parentNode.insertBefore(instructionEl, passBtn);
            }

            const hasPassed = latestGameState && latestGameState.pendingRoll && latestGameState.pendingRoll.passedPlayers.includes(myId);

            if (hasPassed) {
                passBtn.disabled = true;
                passBtn.innerText = "WAITING FOR OTHERS...";
                instructionEl.innerHTML = '';
            } else {
                passBtn.disabled = false;
                passBtn.innerText = "NO MODIFIERS (PASS)";

                const hand = latestGameState && latestGameState.players[myId] ? latestGameState.players[myId].hand : [];
                const modCount = hand.filter(c => c.type === 'Modifier Card').length;

                instructionEl.innerHTML = modCount > 0
                    ? `<div style="color: var(--text-muted); font-size: 0.95rem;">Tap a Modifier card in your hand to play it.</div>`
                    : `<div style="color: var(--text-muted); font-size: 0.95rem;">No modifiers in hand.</div>`;
            }
        }

        modifierModal?.classList.remove('hidden');

    } catch (error) {

        

    }

});



socket.on('challenge_individual_roll', (data) => {
    const overlay = document.getElementById('dice-overlay');
    if (overlay) {
        overlay.classList.remove('hidden');
        overlay.style.display = '';
    }
    
    document.getElementById('dice-reason').innerText = `${data.rollerName} is rolling...`;
    const die1 = document.getElementById('die1');
    const die2 = document.getElementById('die2');
    const banner = document.getElementById('math-breakdown-banner');
    
    if (window.diceRollInterval) {
        clearInterval(window.diceRollInterval);
    }
    
    die1.classList.add('rolling');
    die2.classList.add('rolling');
    startDiceSprite();
    
    window.diceRollInterval = setInterval(() => {
        const temp1 = Math.floor(Math.random() * 6) + 1;
        const temp2 = Math.floor(Math.random() * 6) + 1;
        if (die1) {
            die1.setAttribute('data-roll', temp1);
            die1.innerHTML = renderDicePips(temp1);
        }
        if (die2) {
            die2.setAttribute('data-roll', temp2);
            die2.innerHTML = renderDicePips(temp2);
        }
    }, 80);

    banner.style.display = 'block';
    banner.innerText = `[🎲 ?] + [🎲 ?] = ?`;
    
    setTimeout(() => {
        clearInterval(window.diceRollInterval);
        window.diceRollInterval = null;
        stopDiceSprite();
        die1.classList.remove('rolling');
        die2.classList.remove('rolling');
        settleDie(die1);
        settleDie(die2);

        const r1 = data.roll1 || 1;
        const r2 = data.roll2 || 1;
        if (die1) {
            die1.setAttribute('data-roll', r1);
            die1.innerHTML = renderDicePips(r1);
        }
        if (die2) {
            die2.setAttribute('data-roll', r2);
            die2.innerHTML = renderDicePips(r2);
        }

        banner.innerText = `${data.rollerName} rolled a ${data.total}!`;
    }, 1000);
});



socket.on('modifier_played', (data) => {
    playSound('modifier');
    triggerHaptic(20);
    const stagingArea = document.getElementById('modifier-staging-area');

    const cardEl = document.createElement('div');

    cardEl.className = 'card modifier-drop';

    cardEl.style.position = 'relative';

    cardEl.innerHTML = `

        <div class="card-img${artClass(data.card)}" style="background-image: url('${cardArt(data.card)}')"></div>

        <div class="card-info">

            <div class="card-name">${data.card.name}</div>

        </div>

        <div class="floating-text">${data.modValue > 0 ? '+' : ''}${data.modValue}!</div>

    `;

    stagingArea.appendChild(cardEl);
    playResolutionBurst(document.getElementById('math-breakdown-banner'), data.modValue >= 0 ? 'buff' : 'debuff');

});



socket.on('rollResult', (data) => {

    try {

        showNotification(data.message);

        modifierModal?.classList.add('hidden');

        const diceOverlay = document.getElementById('dice-overlay');

        if (diceOverlay) diceOverlay?.classList.add('hidden');

    } catch (error) {

        

    }

});



socket.on('challenge_pending', (data) => {

    playSound('challenge');

    triggerHaptic([20, 40, 20]);

    const challengeModalElement = document.getElementById('challenge-modal');

    if (!challengeModalElement) {

        

        return;

    }



    // AGGRESSIVE RESET: Ensure the modal is visible and on top

    challengeModalElement.style.display = 'flex';

    challengeModalElement.classList.remove('hidden', 'fade-out');

    challengeModalElement.style.zIndex = '9999';



    // Hide the redundant title
    const challengeTitle = document.getElementById('challenge-title');
    if (challengeTitle) challengeTitle.style.display = 'none';

    // Simplify the text
    challengeText.innerText = `${data.rollerName} is playing:`;
    challengeCardDisplay.innerHTML = renderCard(data.card, false, false, false, false);

    // Only render buttons, NO duplicate cards
    if (data.rollerId === myId) {
        challengeActionArea.innerHTML = `<div style="text-align:center; padding: 15px; font-size:1.1rem; color: var(--text-muted);">Waiting for opponents...</div>`;
    } else {
        const hand = latestGameState && latestGameState.players[myId] ? latestGameState.players[myId].hand : [];
        const hasChallengeCard = hand.some(c => c.type === 'Challenge Card');
        
        challengeActionArea.innerHTML = `
            <div class="challenge-buttons-container" style="display: flex; flex-direction: column; align-items: center; gap: 15px; width: 100%; margin-top: 15px;">
                ${hasChallengeCard ? `<button id="challenge-play-btn" class="action-btn" style="width: 100%; padding: 15px; font-size: 1.1rem; background: var(--warning); color: black;">PLAY CHALLENGE</button>` : `<div style="color: var(--text-muted);">No Challenge Cards in hand</div>`}
                <button id="challenge-pass-btn" class="action-btn" style="background: #ef4444; width: 100%; padding: 15px; font-size: 1.1rem;">PASS</button>
            </div>
        `;

        // Reattach listeners
        const cPassBtn = document.getElementById('challenge-pass-btn');
        const cPlayBtn = document.getElementById('challenge-play-btn');
        
        if (cPassBtn) {
            cPassBtn.addEventListener('click', () => {
                socket.emit('pass_challenge');
                cPassBtn.disabled = true;
                cPassBtn.innerText = "WAITING FOR OTHERS...";
                if (cPlayBtn) cPlayBtn.disabled = true;
            });
        }

        if (cPlayBtn && hasChallengeCard) {
            cPlayBtn.addEventListener('click', () => {
                const challengeCard = hand.find(c => c.type === 'Challenge Card');
                if (challengeCard) {
                    playChallenge(challengeCard.id);
                    cPlayBtn.disabled = true;
                    if (cPassBtn) cPassBtn.disabled = true;
                }
            });
        }
    }

});



socket.on('challenge_resolved', (data) => {

    showNotification(data.message);

    if (challengeModal) {
        const display = document.createElement('div');
        display.className = 'challenge-resolution-display';
        display.innerHTML = challengeCardDisplay.innerHTML;
        document.body.appendChild(display);
        const cleanup = () => display.remove();
        setTimeout(cleanup, 850);
        playResolutionBurst(display.querySelector('.card') || display, 'damage', { onDone: cleanup });
        challengeModal.classList.add('hidden');
        challengeModal.style.display = 'none';
    }

});



socket.on('heroPlayedPrompt', ({ cardId, cardName }) => {

    pendingSkillCardId = cardId;

    skillPromptText.innerText = `Would you like to use ${cardName}'s skill now for 0 AP?`;

    if (skillPromptModal) {

        skillPromptModal.style.display = 'flex';

        skillPromptModal.classList.remove('hidden');

        skillPromptModal.style.setProperty('z-index', '9999', 'important');

    }

});



skillPromptYes.addEventListener('click', () => {

    if (pendingSkillCardId) {

        const context = findCardContext(pendingSkillCardId);

        if (context && context.card) {

            const skillId = context.card.skill_id;

            

            // --- Pre-Activation Checks ---

            if (TARGETING_SKILLS.includes(skillId) || MULTI_TARGETING_SKILLS.includes(skillId)) {

                let hasOpponentHero = false;

                if (latestGameState) {

                    Object.keys(latestGameState.players).forEach(pId => {

                        if (pId !== myId && latestGameState.players[pId].party.length > 0) hasOpponentHero = true;

                    });

                }

                if (!hasOpponentHero) {

                    showNotification("No valid Heroes to target!");

                    pendingSkillCardId = null;

                    if (skillPromptModal) {

                        skillPromptModal.style.display = 'none';

                        skillPromptModal.classList.add('hidden');

                    }

                    socket.emit('decline_hero_skill');

                    return;

                }

            } else if (PLAYER_TARGETING_SKILLS.includes(skillId)) {

                let hasOpponentCards = false;

                if (latestGameState) {

                    Object.keys(latestGameState.players).forEach(pId => {

                        if (pId !== myId && latestGameState.players[pId].hand.length > 0) hasOpponentCards = true;

                    });

                }

                if (!hasOpponentCards) {

                    showNotification("No opponents have cards in hand!");

                    pendingSkillCardId = null;

                    if (skillPromptModal) {

                        skillPromptModal.style.display = 'none';

                        skillPromptModal.classList.add('hidden');

                    }

                    socket.emit('decline_hero_skill');

                    return;

                }

            } else if (SELF_ITEM_TARGETING_SKILLS.includes(skillId)) {

                let hasSelfCursed = false;

                if (latestGameState && latestGameState.players[myId]) {

                    hasSelfCursed = latestGameState.players[myId].party.some(h => h.equippedItem);

                }

                if (!hasSelfCursed) {

                    showNotification("You have no equipped items to target!");

                    pendingSkillCardId = null;

                    if (skillPromptModal) {

                        skillPromptModal.style.display = 'none';

                        skillPromptModal.classList.add('hidden');

                    }

                    socket.emit('decline_hero_skill');

                    return;

                }

            } else if (DISCARD_TARGETING_SKILLS.includes(skillId)) {

                if (!latestGameState || latestGameState.discardPile.length === 0) {

                    showNotification("The discard pile is empty!");

                    pendingSkillCardId = null;

                    if (skillPromptModal) {

                        skillPromptModal.style.display = 'none';

                        skillPromptModal.classList.add('hidden');

                    }

                    socket.emit('decline_hero_skill');

                    return;

                }

            }



            // Deferred Targeting: Do not ask for target now. Just roll!

            socket.emit('use_hero_skill', { cardId: pendingSkillCardId, isFree: true });

            

            // AUTOMATICALLY TRIGGER THE ROLL TO BYPASS THE MANUAL CLICK

            setTimeout(() => {

                socket.emit('execute_roll');

            }, 50);

        }

    }

    

    // Aggressively hide the modal!

    if (skillPromptModal) {

        skillPromptModal.style.display = 'none';

        skillPromptModal.classList.add('hidden');

    }

    pendingSkillCardId = null;

});



skillPromptNo.addEventListener('click', () => {

    if (skillPromptModal) {

        skillPromptModal.classList.add('hidden');

        skillPromptModal.style.display = 'none';

    }

    socket.emit('decline_hero_skill');

    pendingSkillCardId = null;

});



socket.on('message', (msg) => {

    showNotification(msg);

});



socket.on('peek_cards', (data) => {

    const modal = document.getElementById('deck-peek-modal');

    const container = document.getElementById('deck-peek-cards');

    const titleEl = document.getElementById('deck-peek-title');

    const subtitleEl = modal?.querySelector('p');

    container.innerHTML = '';

    // View-only peeks (e.g. Sharp Fox: "Look at another player's hand") show the
    // cards purely as information — no Select button, since nothing is taken.
    const viewOnly = data.viewOnly === true;

    if (titleEl) titleEl.innerText = data.title || (viewOnly ? "Opponent's Hand" : 'Look at Top Cards');

    if (subtitleEl) subtitleEl.innerText = data.subtitle || (viewOnly

        ? 'Viewing only — you cannot take a card.'

        : 'Select a card to add to your hand.');



    if (!data.cards || data.cards.length === 0) {

        container.innerHTML = '<p style="opacity:0.7; text-align:center;">Their hand is empty.</p>';

    } else {

        data.cards.forEach(c => {

            // Wrap each card with its Select button BELOW it. The old inline button
            // was an absolute overlay that only appeared on hover and clipped against
            // the card's overflow — bad on touch. A persistent button under the card
            // is always visible and never clipped.
            const wrap = document.createElement('div');

            wrap.className = 'peek-card-wrap';

            wrap.innerHTML = `

                <div class="card">

                    <div class="card-img${artClass(c)}" style="background-image: url('${cardArt(c)}')"></div>

                    <div class="card-info">

                        <div class="card-name">${c.name}</div>

                        <div class="card-type">${c.type}</div>

                    </div>

                </div>

                ${viewOnly ? '' : `<button class="action-btn peek-select-btn" onclick="selectPeekCard('${c.id}', '${data.skillId}')">${data.actionLabel || 'Select'}</button>`}

            `;

            container.appendChild(wrap);

        });

    }

    // A view-only peek has no Select to dismiss it, so give it an explicit Close
    // button. Dedupe by id so reopening doesn't stack buttons.
    const glass = modal?.querySelector('.glass-panel');

    glass?.querySelector('#deck-peek-close-btn')?.remove();

    if (viewOnly && glass) {

        const closeBtn = document.createElement('button');

        closeBtn.className = 'action-btn';

        closeBtn.id = 'deck-peek-close-btn';

        closeBtn.innerText = 'Close';

        closeBtn.onclick = () => modal.classList.add('hidden');

        glass.appendChild(closeBtn);

    }

    modal?.classList.remove('hidden');

});



window.selectPeekCard = function(cardId, skillId) {

    socket.emit('select_peek_card', { cardId, skillId });

    document.getElementById('deck-peek-modal').classList.add('hidden');

};



function renderGlobalActionPrompt(action) {

    if (action && action.pendingPlayerIds && action.pendingPlayerIds.includes(myId)) {

        // Don't rebuild if the prompt is already open (a re-broadcast must not clobber
        // an in-flight selection).
        const openModal = document.getElementById('mandatory-discard-modal');
        if (openModal && !openModal.classList.contains('hidden')) return;

        if (action.type === 'MULTI_DISCARD_AND_CHOOSE' || action.type === 'MULTI_DISCARD' || action.type === 'MULTI_GIVE') {

            const modal = document.getElementById('mandatory-discard-modal');

            const container = document.getElementById('mandatory-discard-cards');

            document.getElementById('mandatory-discard-title').innerText = "Mandatory Discard";

            document.getElementById('mandatory-discard-message').innerText = action.type === 'MULTI_GIVE' ? "You must give a card to the player." : "You must discard a card.";

            container.innerHTML = '';

            

            const myHand = latestGameState.players[myId].hand;

            myHand.forEach(c => {

                const cardEl = document.createElement('div');

                cardEl.className = 'card glow-target';

                cardEl.innerHTML = `

                    <div class="card-img${artClass(c)}" style="background-image: url('${cardArt(c)}')"></div>

                    <div class="card-info">

                        <div class="card-name">${c.name}</div>

                        <div class="card-type">${c.type}</div>

                    </div>

                    <button class="action-btn inline attack" onclick="submitGlobalAction('${c.id}')">${action.type === 'MULTI_GIVE' ? 'Give' : 'Discard'}</button>

                `;

                container.appendChild(cardEl);

            });

            

            modal?.classList.remove('hidden');

            document.getElementById('waiting-overlay')?.classList.add('hidden');

        } else if (action.type === 'MULTI_SACRIFICE') {

            const modal = document.getElementById('mandatory-discard-modal');

            const container = document.getElementById('mandatory-discard-cards');

            document.getElementById('mandatory-discard-title').innerText = "Mandatory Sacrifice";

            document.getElementById('mandatory-discard-message').innerText = "You must sacrifice a Hero.";

            container.innerHTML = '';

            

            const myParty = latestGameState.players[myId].party;

            myParty.forEach(c => {

                const cardEl = document.createElement('div');

                cardEl.className = 'card glow-target';

                cardEl.innerHTML = `

                    <div class="card-img${artClass(c)}" style="background-image: url('${cardArt(c)}')"></div>

                    <div class="card-info">

                        <div class="card-name">${c.name}</div>

                        <div class="card-type">${c.type}</div>

                    </div>

                    <button class="action-btn inline attack" onclick="socket.emit('submit_global_action', { targetHeroId: '${c.id}' }); document.getElementById('mandatory-discard-modal').classList.add('hidden');">Sacrifice</button>

                `;

                container.appendChild(cardEl);

            });

            

            modal?.classList.remove('hidden');

            document.getElementById('waiting-overlay')?.classList.add('hidden');

        }

    }

}

// Server pushes this once when the action starts; broadcastState also calls
// renderGlobalActionPrompt so the prompt survives a refresh / dropped packet.
socket.on('global_action_requested', renderGlobalActionPrompt);



window.submitGlobalAction = function(cardId, targetHeroId) {

    if (cardId) {

        socket.emit('submit_global_action', { cardId });

    } else if (targetHeroId) {

        socket.emit('submit_global_action', { targetHeroId });

    }

    document.getElementById('mandatory-discard-modal').classList.add('hidden');

    showNotification('Waiting for other players...');

};



socket.on('global_action_resolution', (data) => {

    const pool = document.getElementById('global-discard-pool');

    const container = document.getElementById('pool-cards');

    container.innerHTML = '';

    

    data.submittedCards.forEach(c => {

        const cardEl = document.createElement('div');

        cardEl.className = 'card glow-target';

        cardEl.innerHTML = `

            <div class="card-img${artClass(c)}" style="background-image: url('${cardArt(c)}')"></div>

            <div class="card-info">

                <div class="card-name">${c.name}</div>

                <div class="card-type">${c.type}</div>

            </div>

            <button class="action-btn inline attack" onclick="resolveGlobalAction('${c.id}')">Select</button>

        `;

        container.appendChild(cardEl);

    });

    

    pool?.classList.remove('hidden');

});



window.resolveGlobalAction = function(cardId) {

    socket.emit('resolve_global_action', { cardId });

    document.getElementById('global-discard-pool').classList.add('hidden');

};



function showNotification(msg) {
    // Messages now live in the scrollable event log (chat box) in the event
    // console, rather than as transient floating toasts.
    logEvent(msg);
}

// Phase 5.4: show/hide the game log/chat (the ☰ button). Hidden by default; the
// `chat-open` class on <body> drives a floating panel via CSS. No socket changes
// and no change to how events are written into the log — visibility only.
// Silence / unsilence all sound + haptics. Persists via Sound (localStorage).
window.toggleMute = function() {
    const muted = Sound.toggleMute();
    syncMuteBtn();
    if (!muted) { Sound.unlock(); playSound('tap'); } // confirm we're back on
};
function syncMuteBtn() {
    const btn = document.getElementById('mute-btn');
    if (!btn) return;
    const muted = Sound.isMuted();
    btn.classList.toggle('is-muted', muted);
    btn.innerHTML = muted ? '&#128263;' : '&#128266;'; // 🔇 / 🔊
    btn.setAttribute('aria-pressed', String(muted));
}
syncMuteBtn();

window.toggleGameMenu = function(forceOpen) {
    const open = typeof forceOpen === 'boolean'
        ? forceOpen
        : !document.body.classList.contains('chat-open');
    document.body.classList.toggle('chat-open', open);
    if (open) {
        const log = document.getElementById('event-log');
        if (log) log.scrollTop = log.scrollHeight; // newest in view on open
    }
};

// Collapse/expand the game chat. Collapsed shows only the latest ~2 lines; tap
// the header (or the collapsed log) to expand into the full scrollable history.
window.toggleChat = function(forceExpand) {
    const log = document.getElementById('event-log');
    const caret = document.getElementById('chat-caret');
    if (!log) return;
    const willExpand = forceExpand === true ? true
        : forceExpand === false ? false
        : !log.classList.contains('expanded');
    log.classList.toggle('expanded', willExpand);
    if (caret) caret.textContent = willExpand ? '▾' : '▴';
    // Always keep the newest message in view.
    log.scrollTop = log.scrollHeight;
};

function logEvent(msg) {
    const log = document.getElementById('event-log');
    if (!log) return;

    // Drop the "Waiting for events…" placeholder on the first real message.
    const placeholder = log.querySelector('.event-log-empty');
    if (placeholder) placeholder.remove();

    const line = document.createElement('div');
    line.className = 'event-log-line';
    line.innerText = msg;
    log.appendChild(line);

    // Cap history so it can't grow unbounded over a long game.
    while (log.children.length > 120) log.removeChild(log.firstChild);

    // Auto-scroll to the newest message.
    log.scrollTop = log.scrollHeight;
}







// Decline an optional / unsatisfiable "play a card from hand" prompt. The server
// resets to PLAYING when the action is optional or the hand has no playable card.
window.skipHandSelection = function() {
    socket.emit('play_from_hand', { cancel: true });
    closeInspectorModal();
};

// Decline an OPTIONAL pending target action (e.g. Pan Chucks' "you MAY destroy").
// The server clears the action and returns to PLAYING.
window.skipOptionalAction = function() {
    socket.emit('skip_optional_action');
    document.body?.classList.remove('target-mode-active');
    targetBanner?.classList.add('hidden');
};

function playCard(id) {
    triggerHaptic([20, 30, 20]);
    playSound('cardDrop');
    if (latestGameState && latestGameState.state === 'WAITING_FOR_HAND_SELECTION') {

        socket.emit('play_from_hand', { cardId: id });

        closeInspectorModal();

        return;

    }

    const context = findCardContext(id);

    if (context?.card?.type === 'Magic Card') {
        window.pendingMagicResolution = { ...context.card };
    }

    if (!context || !context.card) {

        socket.emit('playCard', { cardId: id, isFree: window.isNextPlayFree });

        window.isNextPlayFree = false;

        closeInspectorModal(); // Ensure modal closes

        return;

    }



    const effectId = context.card.effect_id;

    // Mirror the server's block: Entangling Trap's payoff is the steal, so if no
    // opponent has a stealable Hero, give instant feedback and don't spend AP/cards.
    if (effectId === 'MAGIC_ENTANGLING') {
        const st = latestGameState;
        const canSteal = st && Object.values(st.players).some(p =>
            p.id !== myId && !p.cannotBeStolen && (p.party || []).some(h => h.type === 'Hero Card'));
        if (!canSteal) {
            showNotification("No Heroes to steal — you can't play Entangling Trap right now.");
            closeInspectorModal();
            return;
        }
    }
    // Forced Exchange needs an opponent Hero to steal AND one of your own to give.
    if (effectId === 'MAGIC_EXCHANGE') {
        const st = latestGameState;
        const canSteal = st && Object.values(st.players).some(p =>
            p.id !== myId && !p.cannotBeStolen && (p.party || []).some(h => h.type === 'Hero Card'));
        const hasOwnHero = st && (st.players[myId].party || []).some(h => h.type === 'Hero Card');
        if (!canSteal || !hasOwnHero) {
            showNotification("Forced Exchange needs an opponent's Hero to steal and one of your own Heroes to give.");
            closeInspectorModal();
            return;
        }
    }
    // Winds of Change needs at least one equipped Item on the board to return.
    if (effectId === 'MAGIC_WINDS_CHANGE') {
        const st = latestGameState;
        const anyEquipped = st && Object.values(st.players).some(p => (p.party || []).some(h => h.equippedItem));
        if (!anyEquipped) {
            showNotification("No equipped Items anywhere — you can't play Winds of Change right now.");
            closeInspectorModal();
            return;
        }
    }
    // Destructive Spell: "discard, THEN destroy a Hero" — needs a destroyable
    // opponent Hero (not protected by Mighty Blade / Terratuga).
    if (effectId === 'MAGIC_DESTRUCTIVE') {
        const st = latestGameState;
        const canDestroy = st && Object.values(st.players).some(p =>
            p.id !== myId && !p.cannotBeDestroyed
            && !(p.slainMonsters || []).some(m => m.effect_id === 'MONSTER_TERRATUGA')
            && (p.party || []).some(h => h.type === 'Hero Card'));
        if (!canDestroy) {
            showNotification("No Heroes to destroy — you can't play Destructive Spell right now.");
            closeInspectorModal();
            return;
        }
    }

    if (TARGETING_SKILLS && TARGETING_SKILLS.includes(effectId)) {

        isSkillTargeting = true;

        pendingHeroSkillCard = context.card;

        document.body?.classList.add('target-mode-active');

        targetBannerText.innerText = "Select an opponent's Hero to target with this Magic card.";

        targetBannerText.innerHTML += ` <button onclick="cancelSkillTargeting()" style="margin-left: 10px; padding: 5px 10px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer;">Cancel</button>`;

        targetBanner?.classList.remove('hidden');

        closeInspectorModal();

        if (latestGameState) renderBoard(latestGameState);

    } else if (DISCARD_TARGETING_SKILLS && DISCARD_TARGETING_SKILLS.includes(effectId)) {

        closeInspectorModal();

        pendingHeroSkillCard = context.card;

        openDiscardSearch(effectId);

    } else {

        socket.emit('playCard', { cardId: id, isFree: window.isNextPlayFree });

        window.isNextPlayFree = false;

        closeInspectorModal();

    }

}



// True while equipping a Cursed Item — its target is an OPPONENT's hero, not your
// own. Drives which heroes highlight as valid during equip targeting.
function isCurseEquip() {
    return isLocalTargeting && localPendingEquipCard && localPendingEquipCard.type === 'Cursed Item Card';
}

function startEquipTargeting(cardId, fromHandSelection = false) {

    const context = findCardContext(cardId);

    if (!context || !context.card) return;



    isLocalTargeting = true;

    equipFromHandSelection = fromHandSelection === true;

    localPendingEquipCard = context.card;



    document.body?.classList.add('target-mode-active');

    targetBannerText.innerText = context.card.type === 'Cursed Item Card'
        ? "Select any Hero on the board to curse with this item."
        : "Select any Hero on the board to equip this item.";

    targetBannerText.innerHTML += ` <button onclick="cancelEquipTargeting()" style="margin-left: 10px; padding: 5px 10px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer;">Cancel</button>`;

    targetBanner?.classList.remove('hidden');

    if (latestGameState) renderBoard(latestGameState);

    

    // Hide panel so player can click board

    closeInspectorModal();

}



window.resolveImmediatePlay = function(action) {

    document.getElementById('immediate-play-modal').classList.add('hidden');

    socket.emit('resolve_immediate_play', { playNow: action === 'PLAY' });

};



window.cancelEquipTargeting = function() {

    window.isNextPlayFree = false;

    isLocalTargeting = false;

    equipFromHandSelection = false;

    localPendingEquipCard = null;

    document.body?.classList.remove('target-mode-active');

    targetBanner?.classList.add('hidden');

    targetBannerText.innerText = "";

    if (latestGameState) renderBoard(latestGameState);

};



function useSkillLater(id) {

    const context = findCardContext(id);

    if (!context || !context.card) return;

    playSound('skill');

    triggerHaptic([15, 25, 15]);

    pendingHeroSkillCard = context.card;

    const skillId = context.card.skill_id;



    // --- Pre-Activation Checks ---

    if (TARGETING_SKILLS.includes(skillId) || MULTI_TARGETING_SKILLS.includes(skillId)) {

        // Need at least one opponent Hero

        let hasOpponentHero = false;

        if (latestGameState) {

            Object.keys(latestGameState.players).forEach(pId => {

                if (pId !== myId && latestGameState.players[pId].party.length > 0) {

                    hasOpponentHero = true;

                }

            });

        }

        if (!hasOpponentHero) {

            showNotification("No valid Heroes to target!");

            closeInspectorModal();

            return;

        }

    } else if (PLAYER_TARGETING_SKILLS.includes(skillId)) {

        // Need at least one opponent with cards in hand

        let hasOpponentCards = false;

        if (latestGameState) {

            Object.keys(latestGameState.players).forEach(pId => {

                if (pId !== myId && latestGameState.players[pId].hand.length > 0) {

                    hasOpponentCards = true;

                }

            });

        }

        if (!hasOpponentCards) {

            showNotification("No opponents have cards in hand!");

            closeInspectorModal();

            return;

        }

    } else if (SELF_ITEM_TARGETING_SKILLS.includes(skillId)) {

        // Need self cursed item

        let hasSelfCursed = false;

        if (latestGameState && latestGameState.players[myId]) {

            hasSelfCursed = latestGameState.players[myId].party.some(h => h.equippedItem); // simplistic check for now

        }

        if (!hasSelfCursed) {

            showNotification("You have no equipped items to target!");

            closeInspectorModal();

            return;

        }

    } else if (DISCARD_TARGETING_SKILLS.includes(skillId)) {

        if (!latestGameState || latestGameState.discardPile.length === 0) {

            showNotification("The discard pile is empty!");

            closeInspectorModal();

            return;

        }

    }



    // Deferred Targeting: Do not ask for target now. Just roll!

    closeInspectorModal();

    socket.emit('use_hero_skill', { cardId: id, isFree: false });

}



function openDiscardSearch(skillId) {

    const modal = document.getElementById('discard-search-modal');

    const container = document.getElementById('discard-search-cards');

    container.innerHTML = '';

    

    // Filter condition based on skill

    let condition = () => true;

    if (skillId === 'SKILL_GUIDING_LIGHT' || skillId === 'MAGIC_CALL_FALLEN') condition = c => c.type === 'Hero Card';

    if (skillId === 'SKILL_RADIANT_HORN') condition = c => c.type === 'Modifier Card';

    if (skillId === 'SKILL_LOOKIE_ROOKIE') condition = c => c.type === 'Item Card' || c.type === 'Cursed Item Card';

    if (skillId === 'SKILL_BUN_BUN') condition = c => c.type === 'Magic Card';



    const validCards = latestGameState.discardPile.filter(condition);

    

    if (validCards.length === 0) {

        container.innerHTML = `<div style="color:white;">No matching cards found in the discard pile.</div>`;

    } else {

        validCards.forEach(c => {

            const cardEl = document.createElement('div');

            cardEl.className = 'card glow-target';

            cardEl.id = c.id;

            cardEl.dataset.id = c.id;

            cardEl.innerHTML = `

                <div class="card-img${artClass(c)}" style="background-image: url('${cardArt(c)}')"></div>

                <div class="card-info">

                    <div class="card-name">${c.name}</div>

                    <div class="card-type">${c.type}</div>

                </div>

                <button class="action-btn inline attack" onclick="selectDiscardCard('${c.id}')">Select</button>

            `;

            container.appendChild(cardEl);

        });

    }

    

    modal?.classList.remove('hidden');

}



window.openPoolSelection = function() {

    const modal = document.getElementById('discard-search-modal');

    const container = document.getElementById('discard-search-cards');

    const title = document.getElementById('discard-search-title');

    title.innerText = "Select a card from the Discard Pool";

    container.innerHTML = '';

    

    if (latestGameState && latestGameState.pendingAction && latestGameState.pendingAction.pooledCards) {

        latestGameState.pendingAction.pooledCards.forEach(c => {

            const cardEl = document.createElement('div');

            cardEl.className = 'card glow-target';

            cardEl.innerHTML = `

                <div class="card-img${artClass(c)}" style="background-image: url('${cardArt(c)}')"></div>

                <div class="card-info">

                    <div class="card-name">${c.name}</div>

                    <div class="card-type">${c.type}</div>

                </div>

                <button class="action-btn inline attack" onclick="selectPoolCard('${c.id}')">Select</button>

            `;

            container.appendChild(cardEl);

        });

    }

    modal?.classList.remove('hidden');

};



window.selectPoolCard = function(cardId) {

    socket.emit('target_selected', cardId);

    document.getElementById('discard-search-modal').classList.add('hidden');

    document.getElementById('discard-search-title').innerText = "Search Discard Pile"; // reset

};



window.selectDiscardCard = function selectDiscardCard(cardId) {

    // Deferred post-roll selection: the hero skill already rolled and the server
    // is waiting for the discard target. Submit it without re-rolling.
    if (latestGameState && latestGameState.state === 'WAITING_FOR_SKILL_TARGET'
        && latestGameState.pendingAction && latestGameState.pendingAction.type === 'SKILL_TARGET_DISCARD') {
        socket.emit('submit_skill_target', { targetCardId: cardId });
        document.getElementById('discard-search-modal').classList.add('hidden');
        pendingHeroSkillCard = null;
        return;
    }

    let isMagic = false;

    if (pendingHeroSkillCard && pendingHeroSkillCard.type === 'Magic Card') {

        isMagic = true;

    }



    if (isMagic) {

        socket.emit('playCard', { cardId: pendingHeroSkillCard.id, isFree: window.isNextPlayFree, targetData: { targetCardId: cardId } });

        window.isNextPlayFree = false;

    } else {

        socket.emit('use_hero_skill', { 

            cardId: pendingHeroSkillCard.id, 

            isFree: false, 

            targetCardId: cardId 

        });

    }

    document.getElementById('discard-search-modal').classList.add('hidden');

    pendingHeroSkillCard = null;

};



window.submitMultiTargets = function() {

    if (latestGameState && latestGameState.state === 'WAITING_FOR_SKILL_TARGET') {

        socket.emit('submit_skill_target', {

            targetHeroIds: multiTargetSelected

        });

    } else {

        socket.emit('use_hero_skill', {

            cardId: pendingHeroSkillCard ? pendingHeroSkillCard.id : '',

            isFree: false,

            targetHeroIds: multiTargetSelected

        });

    }

    cancelSkillTargeting();

};



window.submitPenaltyDiscard = function() {

    if (!latestGameState || !latestGameState.pendingAction) return;

    // Fixed-amount discards carry `amount` (select exactly N); variable ones
    // (Qi Bear's "up to N") carry `maxAmount` only - the old exact-match check
    // compared against undefined there, so NO count could ever confirm and the
    // flow soft-locked behind an alert loop.
    const pa = latestGameState.pendingAction;
    const isVariable = typeof pa.maxAmount === 'number' && typeof pa.amount !== 'number';
    const okCount = isVariable
        ? multiTargetSelected.length <= pa.maxAmount
        : multiTargetSelected.length === pa.amount;

    if (okCount) {

        socket.emit('submit_penalty_discard', { cardIds: multiTargetSelected });

        isMultiTargeting = false;

        multiTargetSelected = [];

    } else {

        alert(`You must select ${isVariable ? 'at most ' + pa.maxAmount : 'exactly ' + pa.amount} card(s).`);

    }

};



window.cancelSkillTargeting = function() {

    window.isNextPlayFree = false;

    isSkillTargeting = false;

    isPlayerTargeting = false;

    isSelfItemTargeting = false;

    isLeaderSkillTargeting = false;

    if (isMultiTargeting) {

        multiTargetSelected.forEach(id => {

            const el = document.getElementById(id);

            if(el) el.style.boxShadow = '';

        });

    }

    isMultiTargeting = false;

    multiTargetSelected = [];

    pendingHeroSkillCard = null;

    document.body?.classList.remove('target-mode-active');

    targetBanner?.classList.add('hidden');

    targetBannerText.innerText = "";

    if (latestGameState) renderBoard(latestGameState);

};



window.startLeaderSkillTargeting = function() {

    isLeaderSkillTargeting = true;

    document.body?.classList.add('target-mode-active');

    targetBannerText.innerText = "Select an opponent to steal a card from!";

    targetBannerText.innerHTML += ` <button onclick="cancelSkillTargeting()" style="margin-left: 10px; padding: 5px 10px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer;">Cancel</button>`;

    targetBanner?.classList.remove('hidden');

    if (latestGameState) renderBoard(latestGameState);

};



function attackMonster(id) {
    playSound('slash');
    triggerHaptic([30, 50, 40]);
    socket.emit('attackMonster', id);

}



function selectTarget(id) {

    playSound('target');

    triggerHaptic(15);

    socket.emit('target_selected', id);

    closeOpponentModal();

}



// Modifier cards carry a `modifier_values` array — e.g. [1, -3] for "+1/-3", or a
// single [4] / [-4]. The player ALWAYS chooses which value to apply (you may even
// put a minus on your own roll), and on a challenge which of the two rolls to hit.
function playModifier(id) {
    triggerHaptic([20, 30, 20]);
    playSound('modifier');

    closeInspectorModal();
    inspectorPanel?.classList.add('hidden-mobile');

    const ctx = findCardContext(id);
    const card = ctx && ctx.card;
    const values = (card && Array.isArray(card.modifier_values)) ? card.modifier_values : [];
    const pr = latestGameState && latestGameState.pendingRoll;
    const isChallenge = latestGameState && latestGameState.state === 'WAITING_FOR_MODIFIERS'
        && pr && pr.type === 'CHALLENGE';

    if (isChallenge) {
        // First pick which roll to modify, then (if two values) which value.
        showModifierRollChoice(id, values);
    } else if (values.length <= 1) {
        // Single-value modifier — nothing to choose.
        socket.emit('submit_modifier_action', { action: 'PLAY', cardId: id, modValue: values[0] });
    } else {
        showModifierValueChoice(id, values, null);
    }
}

// Format a signed modifier value as a button label: positive gets an explicit '+'.
function modValueLabel(v) { return v > 0 ? `+${v}` : `${v}`; }

// Challenge step 1: choose which of the two rolls the modifier lands on.
function showModifierRollChoice(id, values) {
    const activeName = getPlayerName(latestGameState.pendingRoll.activeId);
    const challengerName = getPlayerName(latestGameState.pendingRoll.challengerId);
    document.body?.classList.add('target-mode-active');
    const banner = document.getElementById('target-banner');
    const text = document.getElementById('target-banner-text');
    if (!banner || !text) return;
    text.innerHTML = `
        <div style="font-size: 1.2rem; margin-bottom: 10px; color: var(--text-main);">Which roll to modify?</div>
        <button class="action-btn" style="margin: 0 10px; background: var(--accent);" onclick="modifierRollPicked('${id}', 'ACTIVE')">${activeName}</button>
        <button class="action-btn" style="margin: 0 10px; background: var(--danger);" onclick="modifierRollPicked('${id}', 'CHALLENGER')">${challengerName}</button>
        <button class="action-btn" style="margin: 0 10px; background: #475569;" onclick="cancelSkillTargeting()">Cancel</button>
    `;
    banner.classList.remove('hidden');
}

// A roll side was chosen for a challenge modifier — advance to the value choice,
// or submit straight away for a single-value card.
window.modifierRollPicked = function(id, targetRoll) {
    const ctx = findCardContext(id);
    const values = (ctx && ctx.card && Array.isArray(ctx.card.modifier_values)) ? ctx.card.modifier_values : [];
    if (values.length <= 1) {
        submitModifierChoice(id, values[0], targetRoll);
    } else {
        showModifierValueChoice(id, values, targetRoll);
    }
};

// Choose which value (+ or -) to apply. `targetRoll` is null for a normal roll, or
// 'ACTIVE'/'CHALLENGER' for a challenge.
function showModifierValueChoice(id, values, targetRoll) {
    document.body?.classList.add('target-mode-active');
    const banner = document.getElementById('target-banner');
    const text = document.getElementById('target-banner-text');
    if (!banner || !text) return;
    const targetArg = targetRoll ? `'${targetRoll}'` : 'null';
    const buttons = values.map(v => {
        const bg = v > 0 ? '#10b981' : 'var(--danger)';
        return `<button class="action-btn" style="margin: 0 10px; background: ${bg};" onclick="submitModifierChoice('${id}', ${v}, ${targetArg})">${modValueLabel(v)}</button>`;
    }).join('');
    text.innerHTML = `
        <div style="font-size: 1.2rem; margin-bottom: 10px; color: var(--text-main);">Apply which modifier?</div>
        ${buttons}
        <button class="action-btn" style="margin: 0 10px; background: #475569;" onclick="cancelSkillTargeting()">Cancel</button>
    `;
    banner.classList.remove('hidden');
}

window.submitModifierChoice = function(cardId, value, targetRoll) {
    const payload = { action: 'PLAY', cardId: cardId, modValue: value };
    if (targetRoll) payload.targetRoll = targetRoll;
    socket.emit('submit_modifier_action', payload);
    cancelSkillTargeting();
};



function playChallenge(id) {
    triggerHaptic([20, 30, 20]);
    playSound('challenge');
    socket.emit('play_challenge', id);
}



modifierPassBtn.addEventListener('click', () => {

    socket.emit('submit_modifier_action', { action: 'PASS' });

    modifierPassBtn.disabled = true;

    modifierPassBtn.innerText = "WAITING FOR OTHERS...";

});



endTurnBtn.addEventListener('click', () => {

    if (!latestGameState || latestGameState.state !== 'PLAYING' || latestGameState.pendingAction !== null) {

        return;

    }

    playSound('confirm');

    triggerHaptic(25);

    socket.emit('end_turn');

});



drawCardBtn.addEventListener('click', () => {

    playSound('draw');

    triggerHaptic(15);

    socket.emit('draw_card_action');

});



discardDrawBtn.addEventListener('click', () => {

    playSound('draw');

    triggerHaptic(15);

    socket.emit('discard_and_draw_five_action');

});





startGameBtn.addEventListener('click', () => {

    const nameInput = document.getElementById('player-name-input');

    if (nameInput) {

        const playerName = nameInput.value || 'Player';

        socket.emit('set_player_name', playerName);

    }

    socket.emit('start_game');

});



// Sync player name on keypress/input in real-time

document.addEventListener('input', (e) => {

    if (e.target && e.target.id === 'player-name-input') {

        const name = e.target.value.trim() || 'Player';

        socket.emit('set_player_name', name);

    }

});



function requestGameReset() {

    socket.emit('request_game_reset');

}



function executeManualRoll() {
    const die1 = document.getElementById('die1');
    const die2 = document.getElementById('die2');
    die1?.classList.add('rolling');
    die2?.classList.add('rolling');
    playSound('dice'); // <-- ADD THIS
    triggerHaptic(50);
    document.getElementById('manual-roll-btn').style.display = 'none';
    socket.emit('execute_roll');

}



function passModifierPhase() {

    socket.emit('submit_modifier_action', { action: 'PASS' });

    const passBtn = document.getElementById('dice-pass-btn');

    if (passBtn) {

        passBtn.disabled = true;

        passBtn.innerText = 'WAITING FOR OTHERS...';

    }

}





// --- Card Info Panel Logic ---

function findCardContext(id) {

    if (!latestGameState) return null;

    

    let card = latestGameState.activeMonsters.find(c => c.id === id);

    if (card) return { card, location: 'monsters', owner: null };

    

    card = latestGameState.discardPile.find(c => c.id === id);

    if (card) return { card, location: 'discard', owner: null };

    

    for (const playerId in latestGameState.players) {

        const p = latestGameState.players[playerId];

        if (p.leader && p.leader.id === id) return { card: p.leader, location: 'leader', owner: playerId };

        

        card = p.party.find(c => c.id === id);

        if (card) return { card, location: 'party', owner: playerId };

        

        card = p.hand.find(c => c.id === id);

        if (card) return { card, location: 'hand', owner: playerId };

        card = (p.slainMonsters || []).find(c => c.id === id);

        if (card) return { card, location: 'slain', owner: playerId };

    }

    

    if (latestGameState.pendingAction && latestGameState.pendingAction.itemCard && latestGameState.pendingAction.itemCard.id === id) {

        return { card: latestGameState.pendingAction.itemCard, location: 'pending', owner: null };

    }

    if (latestGameState.pendingChallenge && latestGameState.pendingChallenge.card && latestGameState.pendingChallenge.card.id === id) {

        return { card: latestGameState.pendingChallenge.card, location: 'pending', owner: null };

    }



    return null;

}



window.inspectCard = function(cardId) {
    triggerHaptic(10);
    const context = findCardContext(cardId);

    if (!context || !context.card || context.card.type === 'Hidden') return;



    const card = context.card;

    playSound('open');



    const modal = document.getElementById('inspector-modal');

    const modalImage = document.getElementById('inspector-modal-image');

    const modalName = document.getElementById('inspector-modal-name');

    const modalType = document.getElementById('inspector-modal-type');

    const modalDescription = document.getElementById('inspector-modal-description');

    const modalActions = document.getElementById('inspector-modal-actions');



    if (!modal) return;



    // Set fields

    // Generated art is illustration-only, so the modal's own name/type/description
    // fields below carry the text the old full-card scan used to show.
    const inspectArt = cardArt(card);

    if (inspectArt) {

        modalImage.src = inspectArt;

        modalImage.classList.toggle('has-art', !!card.artUrl);

        modalImage.style.display = 'block';

    } else {

        modalImage.style.display = 'none';

    }



    modalName.innerText = card.name || 'Unknown';

    modalType.innerText = `${card.type || ''} ${card.class ? '- ' + card.class : ''}`;



    let descriptionText = '';

    if (card.type === 'Monster Card') {

        descriptionText += `Slay: ${card.slayRoll}+ | Fail: ${card.penaltyRoll}-\n\n`;

    } else if (card.requirement && card.requirement !== 'None') {

        descriptionText += `Requirement: ${card.requirement}\n\n`;

    }

    descriptionText += card.effect || 'No effect text.';

    modalDescription.innerText = descriptionText;



    // Populate actions

    modalActions.innerHTML = '';



    const isMyTurn = latestGameState && latestGameState.activePlayerSocketId === myId;

    const isPlayingState = latestGameState && latestGameState.state === 'PLAYING';

    const isModifierPhase = latestGameState && latestGameState.state === 'WAITING_FOR_MODIFIERS';



    // 1. Play Button (from Hand)

    if (context.owner === myId && context.location === 'hand') {

        // Modifier phase: you can play a Modifier unless you've already passed.
        const modPassed = isModifierPhase && latestGameState.pendingRoll
            && (latestGameState.pendingRoll.passedPlayers || []).includes(myId);

        // Challenge phase: you can play a Challenge card against an opponent's card
        // (not your own) unless you've already passed.
        const challengePhase = latestGameState && latestGameState.state === 'WAITING_FOR_CHALLENGES'
            && latestGameState.pendingChallenge;
        const challengePassed = challengePhase
            && (latestGameState.pendingChallenge.passedPlayers || []).includes(myId);
        const isMyChallengedCard = challengePhase && latestGameState.pendingChallenge.rollerId === myId;

        if (isModifierPhase && card.type === 'Modifier Card' && !modPassed) {

            const btn = document.createElement('button');

            btn.className = 'action-btn';

            btn.style.background = '#f59e0b';

            btn.innerText = 'Play Modifier';

            btn.onclick = () => {

                playModifier(card.id);

                closeInspectorModal();

            };

            modalActions.appendChild(btn);

        } else if (challengePhase && card.type === 'Challenge Card' && !isMyChallengedCard && !challengePassed) {

            const btn = document.createElement('button');

            btn.className = 'action-btn';

            btn.style.background = '#ef4444';

            btn.innerText = 'Play Challenge';

            btn.onclick = () => {

                playChallenge(card.id);

                closeInspectorModal();

            };

            modalActions.appendChild(btn);

        } else if (latestGameState && latestGameState.state === 'WAITING_FOR_HAND_SELECTION'
                   && latestGameState.pendingAction
                   && latestGameState.pendingAction.playerToChoose === myId
                   && (latestGameState.pendingAction.allowedTypes || []).includes(card.type)) {

            // "Draw then you MAY play" prompts (Quick Draw, Hook, Fuzzy Cheeks,
            // Snowball). Plays via play_from_hand — no normal AP cost here.
            const handBtn = document.createElement('button');
            handBtn.className = 'action-btn';
            handBtn.style.background = '#10b981';
            handBtn.innerText = 'Play This Card';
            handBtn.onclick = () => {
                // Items must pick a Hero to equip to before they resolve, otherwise
                // the server discards them. Route through equip-targeting (flagged so
                // it finalizes via play_from_hand). Heroes/Magic play directly.
                if (card.type === 'Item Card' || card.type === 'Cursed Item Card') {
                    startEquipTargeting(card.id, true);
                } else {
                    playCard(card.id);
                    closeInspectorModal();
                }
            };
            modalActions.appendChild(handBtn);

        } else if (isMyTurn && isPlayingState && !isTargetMode) {

            const btn = document.createElement('button');

            btn.className = 'action-btn';

            const isFree = window.isNextPlayFree || false;

            const btnText = card.type === 'Magic Card' ? `Cast Magic (${isFree ? '0' : '1'} AP)` : `Play Card (${isFree ? '0' : '1'} AP)`;

            const color = card.type === 'Magic Card' ? '#a855f7' : '#3b82f6';

            btn.style.background = color;

            btn.innerText = btnText;

            

            const myAp = latestGameState.players[myId]?.ap || 0;

            if (myAp >= 1 || isFree) {

                btn.onclick = () => {

                    if (card.type === 'Item Card' || card.type === 'Cursed Item Card') {

                        startEquipTargeting(card.id);

                    } else {

                        playCard(card.id);

                    }

                    closeInspectorModal();

                };

            } else {

                btn.disabled = true;

                btn.style.opacity = '0.5';

                btn.style.cursor = 'not-allowed';

            }

            modalActions.appendChild(btn);

        }

    }



    // 2. Use Hero Skill (from Party)

    if (context.owner === myId && context.location === 'party' && card.type === 'Hero Card' && !isTargetMode) {

        if (isMyTurn && isPlayingState) {

            const btn = document.createElement('button');

            btn.className = 'action-btn';

            btn.style.background = '#10b981';

            

            const isSealed = card.equippedItem && card.equippedItem.effect_id === 'CURSE_KEY';

            if (isSealed) {

                btn.innerText = '🔒 Sealed — no skill';

                btn.disabled = true;

                btn.style.background = '#475569';

                btn.style.cursor = 'not-allowed';

            } else if (card.usedSkillThisTurn) {

                btn.innerText = 'Skill Used';

                btn.disabled = true;

                btn.style.background = '#475569';

                btn.style.cursor = 'not-allowed';

            } else {

                btn.innerText = 'Use Skill (1 AP)';

                const myAp = latestGameState.players[myId]?.ap || 0;

                if (myAp >= 1) {

                    btn.onclick = () => {

                        useSkillLater(card.id);

                        closeInspectorModal();

                    };

                } else {

                    btn.disabled = true;

                    btn.style.opacity = '0.5';

                    btn.style.cursor = 'not-allowed';

                }

            }

            modalActions.appendChild(btn);

        }

    }



    // 3. Use Leader Skill (Thief)

    if (context.owner === myId && context.location === 'leader' && card.type === 'Party Leader' && card.effect_id === 'LEADER_THIEF' && !isTargetMode) {

        if (isMyTurn && isPlayingState) {

            const player = latestGameState.players[myId];

            if (player && !player.usedLeaderSkillThisTurn) {

                const btn = document.createElement('button');

                btn.className = 'action-btn';

                btn.style.background = '#10b981';

                btn.innerText = 'Use Thief Leader Skill (1 AP)';

                

                const myAp = player.ap || 0;

                if (myAp >= 1) {

                    btn.onclick = () => {

                        startLeaderSkillTargeting();

                        closeInspectorModal();

                    };

                } else {

                    btn.disabled = true;

                    btn.style.opacity = '0.5';

                    btn.style.cursor = 'not-allowed';

                }

                modalActions.appendChild(btn);

            }

        }

    }



    // 4. Attack Monster

    if (context.location === 'monsters' && !isTargetMode) {

        if (isMyTurn && isPlayingState) {

            const btn = document.createElement('button');

            btn.className = 'action-btn';

            btn.style.background = '#ef4444';

            btn.innerText = 'Attack Monster (2 AP)';

            

            const canAttack = meetsMonsterRequirements(latestGameState.players[myId], card.requirement);

            const myAp = latestGameState.players[myId]?.ap || 0;

            

            if (myAp >= 2 && canAttack) {

                btn.onclick = () => {

                    attackMonster(card.id);

                    closeInspectorModal();

                };

            } else {

                btn.disabled = true;

                btn.style.opacity = '0.5';

                btn.style.cursor = 'not-allowed';

                if (!canAttack) {

                    btn.title = "You do not meet party requirements to attack this monster.";

                    btn.innerText = "Locked: Requirements Unmet";

                } else {

                    btn.title = "Not enough AP.";

                }

            }

            modalActions.appendChild(btn);

        }

    }



    // 5. Select Target (if in targeting mode and valid)

    const targetingActive = isLocalTargeting || isSelfItemTargeting || isMultiTargeting || isSkillTargeting || myTargetMode;

    if (targetingActive) {

        const inHand = context.location === 'hand';

        const isMine = context.owner === myId;

        let isValid = false;



        if (myTargetMode) {

            const type = currentPendingAction.type;

            if (type === 'DISCARD' && inHand && isMine) isValid = true;

            else if (type === 'EQUIP' && !inHand && isMine && card.type === 'Hero Card') isValid = true;

            else if ((type === 'DESTROY' || type === 'STEAL' || type === 'EXCHANGE_STEP_1' || type === 'SKILL_TARGET_HERO') && !inHand && !isMine && card.type === 'Hero Card') isValid = true;

            else if (type === 'EXCHANGE_STEP_2' && !inHand && isMine && card.type === 'Hero Card') isValid = true;

            else if (type === 'RETURN_ITEM' && !inHand && card.type === 'Hero Card' && card.equippedItem) isValid = true;

            else if (type === 'PENALTY' && window.latestGameState && window.latestGameState.state === 'WAITING_FOR_SACRIFICE' && !inHand && isMine && card.type === 'Hero Card') isValid = true;

        } else if (isLocalTargeting) {

            // Any item (normal or cursed) may be equipped to ANY hero on the board.
            if (context.location === 'party' && card.type === 'Hero Card') isValid = true;

        } else if (isSelfItemTargeting) {

            if (context.location === 'party' && isMine && card.equippedItem) isValid = true;

        } else if (isMultiTargeting) {

            if (latestGameState && ['WAITING_FOR_DISCARD_PENALTY', 'WAITING_FOR_MULTIPLE_DISCARDS', 'WAITING_FOR_VARIABLE_DISCARD'].includes(latestGameState.state)) {

                if (context.location === 'hand' && isMine) isValid = true;

            } else {

                if (context.location === 'party' && card.type === 'Hero Card' && !isMine) isValid = true;

            }

        } else if (isSkillTargeting) {

            if (context.location === 'party' && card.type === 'Hero Card' && !isMine) isValid = true;

        }



        if (isValid) {

            const btn = document.createElement('button');

            btn.className = 'action-btn';

            btn.style.background = '#ffd700';

            btn.style.color = '#000';

            btn.style.fontWeight = 'bold';



            if (isMultiTargeting) {

                const isSelected = multiTargetSelected.includes(card.id);

                btn.innerText = isSelected ? 'DESELECT TARGET' : 'SELECT TARGET';

            } else {

                btn.innerText = 'SELECT TARGET';

            }



            btn.onclick = () => {

                if (myTargetMode && currentPendingAction.type === 'PENALTY' && window.latestGameState?.state === 'WAITING_FOR_SACRIFICE') {

                    socket.emit('submit_penalty_sacrifice', { targetHeroId: card.id });

                } else if (isLocalTargeting) {

                    playSound('equip');

                    triggerHaptic([15, 20, 25]);

                    if (equipFromHandSelection) {

                        socket.emit('play_from_hand', {

                            cardId: localPendingEquipCard.id,

                            targetPlayerId: context.owner,

                            targetHeroId: card.id

                        });

                    } else {

                        socket.emit('play_item_action', {

                            itemCardId: localPendingEquipCard.id,

                            targetPlayerId: context.owner,

                            targetHeroId: card.id,

                            isFree: window.isNextPlayFree

                        });

                    }

                    window.isNextPlayFree = false;

                    cancelEquipTargeting();

                } else if (isSelfItemTargeting) {

                    if (latestGameState && latestGameState.state === 'WAITING_FOR_SKILL_TARGET') {

                        socket.emit('submit_skill_target', {

                            targetHeroId: card.id

                        });

                    } else {

                        socket.emit('use_hero_skill', {

                            cardId: pendingHeroSkillCard ? pendingHeroSkillCard.id : '',

                            isFree: false,

                            targetHeroId: card.id

                        });

                    }

                    cancelSkillTargeting();

                } else if (isMultiTargeting) {

                    const idx = multiTargetSelected.indexOf(card.id);

                    if (idx !== -1) {

                        multiTargetSelected.splice(idx, 1);

                    } else if (multiTargetSelected.length < multiTargetMax) {

                        multiTargetSelected.push(card.id);

                    }

                    renderBoard(latestGameState);

                } else if (isSkillTargeting) {

                    let isMagic = pendingHeroSkillCard && pendingHeroSkillCard.type === 'Magic Card';

                    if (isMagic) {

                        socket.emit('playCard', { cardId: pendingHeroSkillCard.id, isFree: window.isNextPlayFree, targetData: { targetPlayerId: context.owner, targetHeroId: card.id } });

                        window.isNextPlayFree = false;

                    } else if (latestGameState && latestGameState.state === 'WAITING_FOR_SKILL_TARGET') {

                        socket.emit('submit_skill_target', {

                            targetPlayerId: context.owner,

                            targetHeroId: card.id

                        });

                    } else {

                        socket.emit('use_hero_skill', {

                            cardId: pendingHeroSkillCard ? pendingHeroSkillCard.id : '',

                            isFree: false,

                            targetPlayerId: context.owner,

                            targetHeroId: card.id

                        });

                    }

                    cancelSkillTargeting();

                } else {

                    selectTarget(card.id);

                }

                closeInspectorModal();

            };

            modalActions.appendChild(btn);

        }

    }



    // 6. Close Button

    const closeBtn = document.createElement('button');

    closeBtn.className = 'action-btn primary';

    closeBtn.innerText = 'CLOSE';

    closeBtn.style.background = '#ef4444';

    closeBtn.onclick = () => {

        closeInspectorModal();

    };

    modalActions.appendChild(closeBtn);



    // Show modal

    modal.style.display = 'flex';

    modal.classList.remove('hidden');

};



window.selectCard = window.inspectCard; // Backward compatibility



window.closeInspectorModal = function() {

    const modal = document.getElementById('inspector-modal');

    if (modal) {

        modal.classList.add('hidden');

        modal.style.display = 'none';

    }

};



// Touch Interaction State

let lastTap = { cardId: null, time: 0 };

function handleTargetingClick(cardEl, cardId) {

    if (myTargetMode) {

        const context = findCardContext(cardId);

        if (context) {

            const card = context.card;

            const inHand = context.location === 'hand';

            const isMine = context.owner === myId;

            

            let isValid = false;

            const type = currentPendingAction.type;

            

            if (type === 'DISCARD' && inHand && isMine) isValid = true;

            else if (type === 'EQUIP' && !inHand && isMine && card.type === 'Hero Card') isValid = true;

            else if ((type === 'DESTROY' || type === 'STEAL' || type === 'EXCHANGE_STEP_1' || type === 'SKILL_TARGET_HERO') && !inHand && !isMine && card.type === 'Hero Card') isValid = true;

            else if (type === 'EXCHANGE_STEP_2' && !inHand && isMine && card.type === 'Hero Card') isValid = true;

            else if (type === 'RETURN_ITEM' && !inHand && card.type === 'Hero Card' && card.equippedItem) isValid = true;

            else if (type === 'PENALTY' && window.latestGameState && window.latestGameState.state === 'WAITING_FOR_SACRIFICE' && !inHand && isMine && card.type === 'Hero Card') isValid = true;

            

            if (isValid) {

                if (type === 'PENALTY' && window.latestGameState && window.latestGameState.state === 'WAITING_FOR_SACRIFICE') {

                    socket.emit('submit_penalty_sacrifice', { targetHeroId: cardId });

                } else {

                    selectTarget(cardId);

                }

                return;

            }

        }

    }



    if (isLocalTargeting) {

        const context = findCardContext(cardId);

        if (context && context.location === 'party' && context.card.type === 'Hero Card') {

            if (equipFromHandSelection) {

                socket.emit('play_from_hand', {

                    cardId: localPendingEquipCard.id,

                    targetPlayerId: context.owner,

                    targetHeroId: context.card.id

                });

            } else {

                socket.emit('play_item_action', {

                    itemCardId: localPendingEquipCard.id,

                    targetPlayerId: context.owner,

                    targetHeroId: context.card.id,

                    isFree: window.isNextPlayFree

                });

            }

            window.isNextPlayFree = false;

            cancelEquipTargeting();

        }

        return;

    }



    if (isSelfItemTargeting) {

        const context = findCardContext(cardId);

        if (context && context.location === 'party' && context.owner === myId && context.card.equippedItem) {

            if (latestGameState && latestGameState.state === 'WAITING_FOR_SKILL_TARGET') {

                // Deferred self-item targeting (Holy Curselifter played + used the same
                // turn): the roll already happened, so the server is waiting on a target.
                // It only accepts submit_skill_target here — use_hero_skill is rejected
                // outside PLAYING/PROMPT_SKILL_ROLL, which silently dropped the pick.
                socket.emit('submit_skill_target', { targetHeroId: context.card.id });

            } else {

                socket.emit('use_hero_skill', {

                    cardId: pendingHeroSkillCard.id,

                    isFree: false,

                    targetHeroId: context.card.id

                });

            }

            cancelSkillTargeting();

        }

        return;

    }



    if (isMultiTargeting) {

        const context = findCardContext(cardId);

        if (latestGameState && ['WAITING_FOR_DISCARD_PENALTY', 'WAITING_FOR_MULTIPLE_DISCARDS', 'WAITING_FOR_VARIABLE_DISCARD'].includes(latestGameState.state)) {

            if (context && context.location === 'hand' && context.owner === myId) {

                const idx = multiTargetSelected.indexOf(context.card.id);

                if (idx !== -1) {

                    multiTargetSelected.splice(idx, 1);

                    renderBoard(latestGameState);

                } else if (multiTargetSelected.length < multiTargetMax) {

                    multiTargetSelected.push(context.card.id);

                    renderBoard(latestGameState);

                }

            }

            return;

        }



        if (context && context.location === 'party' && context.card.type === 'Hero Card' && context.owner !== myId) {

            const idx = multiTargetSelected.indexOf(context.card.id);

            if (idx !== -1) {

                multiTargetSelected.splice(idx, 1);

                cardEl.style.boxShadow = '';

            } else if (multiTargetSelected.length < multiTargetMax) {

                multiTargetSelected.push(context.card.id);

                cardEl.style.boxShadow = '0 0 15px red';

            }

        }

        return;

    }



    if (isSkillTargeting) {

        const context = findCardContext(cardId);

        if (context && context.location === 'party' && context.card.type === 'Hero Card' && context.owner !== myId) {

            let isMagic = false;

            if (pendingHeroSkillCard && pendingHeroSkillCard.type === 'Magic Card') {

                isMagic = true;

            }



            if (isMagic) {

                socket.emit('playCard', { cardId: pendingHeroSkillCard.id, isFree: window.isNextPlayFree, targetData: { targetPlayerId: context.owner, targetHeroId: context.card.id } });

                window.isNextPlayFree = false;

            } else if (latestGameState && latestGameState.state === 'WAITING_FOR_SKILL_TARGET') {

                socket.emit('submit_skill_target', {

                    targetPlayerId: context.owner,

                    targetHeroId: context.card.id

                });

            } else {

                // Fallback for legacy flows

                socket.emit('use_hero_skill', {

                    cardId: pendingHeroSkillCard ? pendingHeroSkillCard.id : '',

                    isFree: false,

                    targetPlayerId: context.owner,

                    targetHeroId: context.card.id

                });

            }

            

            cancelSkillTargeting();

            closeOpponentModal();

        }

        return;

    }

}



// Touch Interaction State

let longPressTimeout = null;



// Touch Start / Long Press Detection (500ms) for Card Inspection

// Click / Single Tap Controller

document.body.addEventListener('click', (e) => {

    if (e.target.closest('#inspector-close-btn') || e.target.closest('#info-close-btn')) {

        closeInspectorModal();

        return;

    }



    const cardEl = e.target.closest('.card');

    if (cardEl && cardEl.dataset.id && !cardEl.classList.contains('empty-slot') && !cardEl.classList.contains('card-back')) {

        if (e.target.closest('.equipped-item-badge') || e.target.closest('.equipped-item-thumb')) {

            // If they click the equipped badge, inspect the equipped item instead!

            const context = findCardContext(cardEl.dataset.id);

            if (context && context.card && context.card.equippedItem) {

                inspectCard(context.card.equippedItem.id);

                return;

            }

        }

        

        if (e.target.tagName === 'BUTTON') return;

        

        const cardId = cardEl.dataset.id;

        const context = findCardContext(cardId);

        if (context) {

            inspectCard(cardId);

        }

    } else {

        const modal = document.getElementById('inspector-modal');

        if (modal && !modal.classList.contains('hidden') && e.target === modal) {

            closeInspectorModal();

        }

    }

});



function spawnExplosion(x, y) {

    const colors = ['#ef4444', '#f97316', '#eab308', '#000000'];

    for (let i = 0; i < 30; i++) {

        const particle = document.createElement('div');

        particle.className = 'particle';

        

        const size = Math.random() * 10 + 5;

        particle.style.width = `${size}px`;

        particle.style.height = `${size}px`;

        

        particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];

        particle.style.left = `${x}px`;

        particle.style.top = `${y}px`;

        

        document.body.appendChild(particle);

        

        const angle = Math.random() * Math.PI * 2;

        const distance = Math.random() * 150 + 50;

        const dx = Math.cos(angle) * distance;

        const dy = Math.sin(angle) * distance;

        

        // Force reflow

        particle.getBoundingClientRect();

        

        particle.style.transform = `translate(${dx}px, ${dy}px) scale(0)`;

        particle.style.opacity = '0';

        

        setTimeout(() => particle.remove(), 1000);

    }

}



function spawnConfetti() {

    const colors = ['#ffd700', '#ff8c00', '#ffffff', '#eab308'];

    for (let i = 0; i < 150; i++) {

        const confetti = document.createElement('div');

        confetti.className = 'confetti';

        

        // Randomize dimensions for rectangular or square confetti

        const isRect = Math.random() > 0.5;

        confetti.style.width = isRect ? `${Math.random() * 8 + 4}px` : `${Math.random() * 8 + 6}px`;

        confetti.style.height = isRect ? `${Math.random() * 16 + 8}px` : confetti.style.width;

        

        confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];

        

        // Start randomly across the top of the screen

        confetti.style.left = `${Math.random() * 100}vw`;

        

        // Randomize animation duration and delay for staggered falling

        const duration = Math.random() * 2 + 2;

        const delay = Math.random() * 2;

        confetti.style.animation = `confetti-fall ${duration}s linear ${delay}s forwards`;

        

        document.body.appendChild(confetti);

        

        // Cleanup after animation completes

        setTimeout(() => confetti.remove(), (duration + delay) * 1000);

    }

}
