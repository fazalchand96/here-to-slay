const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createReconnectManager, RECONNECT_GRACE_MS } = require('./reconnect');
const fs = require('fs');
const path = require('path');
const { resolveSkill } = require('./card_effects');
const { getPlayerName } = require('./player_utils');
const {
    executeSkill, executeMagic, hasOpponentHeroTarget, getTargetingSkillPlan, drawCardsWithPassives,
    drawCardsWithoutPassives, applyDrawnCardPassives, queueLumberingDrawSequence,
    triggerCrownedSerpent, prepareImmediateItemPlay, markButtonsFreePlay,
    returnEquippedItemToOwner, equippedItems, hasEquippedEffect, refundTemporalHourglass,
    triggerCursedGlove, triggerSoulTethers, recordSacrificeEvent, recordDestroyEvent, recordFailedSkillEvent,
    queueCommittedHeroRemovalTriggers, resolveRexMajorChoice, clearRexMajorChoices
} = require('./skill_engine');
const ALL_CARDS = require('./cards.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    pingInterval: 25_000,
    pingTimeout: 60_000,
});

const STATIC_MEDIA_EXTENSIONS = new Set([
    '.avif', '.gif', '.ico', '.jpeg', '.jpg', '.ogg', '.png', '.svg', '.webp', '.woff', '.woff2'
]);

app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
        const extension = path.extname(filePath).toLowerCase();
        if (STATIC_MEDIA_EXTENSIONS.has(extension)) {
            res.setHeader('Cache-Control', 'public, max-age=2592000, stale-while-revalidate=604800');
            return;
        }

        res.setHeader('Cache-Control', 'no-cache');
    }
}));
// Game State
let gameState = {
    state: 'LOBBY', // LOBBY, PLAYING, WAITING_FOR_MODIFIERS, WAITING_FOR_CHALLENGES, GAMEOVER
    players: {}, // socketId -> playerData
    playerOrder: [], // array of socketIds
    availableLeaders: [], // shared, depleting pool of leaders
    activePlayerSocketId: null, // explicit active player tracker
    pendingAction: null, // { type, playerToChoose, amount, originalActor }
    pendingRoll: null, // { type: 'SKILL'|'ATTACK', rollerId, targetId, baseRoll, currentRoll, passedPlayers: [] }
    pendingChallenge: null, // { rollerId, card, passedPlayers: [] }
    mainDeck: [],
    monsterDeck: [],
    discardPile: [],
    activeMonsters: [],
    winner: null,
    pendingGlobalAction: null,
    modifierResponses: {
        actedPlayers: [],
        totalPlayers: 0
    }
};

let modifierTimer = null;
let challengeTimer = null;
const CHALLENGE_TIMEOUT_MS = 15_000;

// Test-only: when set, the next skill/attack roll uses these dice instead of
// random ones, so e2e tests asserting on success/failure are deterministic.
let debugForcedRoll = null;

function startModifierTimer() {
    if (modifierTimer) clearTimeout(modifierTimer);
    modifierTimer = setTimeout(() => {
        if (gameState.state === 'WAITING_FOR_MODIFIERS') {
            resolvePendingRoll();
        }
    }, 15000);
}

// Does any OPPONENT of `actorId` have a Hero that `actorId` could STEAL/DESTROY?
// Used to skip a steal/destroy step that would otherwise soft-lock the actor when
// no legal target exists (e.g. Entangling Trap's "then STEAL a Hero" with no
// opponent heroes on the board). Party Leaders aren't Hero Cards, so they're
// excluded automatically. Respects Calming Voice / Mighty Blade / Terratuga.
function hasStealOrDestroyTarget(actorId, type) {
    for (const pid in gameState.players) {
        if (pid === actorId) continue;
        const p = gameState.players[pid];
        if (!p || !p.party) continue;
        if (!p.party.some(h => h.type === 'Hero Card')) continue;
        if (type === 'STEAL' && p.cannotBeStolen) continue;
        if (type === 'DESTROY') {
            if (p.cannotBeDestroyed) continue;
            if (p.slainMonsters && p.slainMonsters.some(m => m.effect_id === 'MONSTER_TERRATUGA')) continue;
        }
        return true;
    }
    return false;
}

function queueFearlessFlameChoices(entries) {
    const eligible = entries.filter(entry => {
        const player = gameState.players[entry.playerId];
        return player?.leader?.effect_id === 'LEADER_SORCERER' && player.hand.length > 0;
    });
    gameState.pendingRoll.fearlessFlameQueue = eligible;
    return startNextFearlessFlameChoice();
}

function startNextFearlessFlameChoice() {
    const next = gameState.pendingRoll?.fearlessFlameQueue?.[0];
    if (!next) {
        if (gameState.pendingRoll) gameState.pendingRoll.fearlessFlameQueue = [];
        gameState.pendingAction = null;
        gameState.state = 'WAITING_FOR_MODIFIERS';
        startModifierTimer();
        return false;
    }
    gameState.state = 'WAITING_FOR_DISCARD_PENALTY';
    gameState.pendingAction = {
        type: 'FEARLESS_FLAME_DISCARD', playerToChoose: next.playerId,
        originalActor: next.playerId, amount: 1, optional: true, rollSide: next.rollSide
    };
    io.emit('message', `${getPlayerName(gameState, next.playerId)} may discard a card for +1 with The Fearless Flame.`);
    return true;
}

function finishFearlessFlameChoice(useBonus) {
    const action = gameState.pendingAction;
    const roll = gameState.pendingRoll;
    if (!roll || action?.type !== 'FEARLESS_FLAME_DISCARD') return;
    if (useBonus) {
        if (roll.type === 'CHALLENGE') {
            if (action.rollSide === 'ACTIVE') {
                roll.activeBase += 1;
                (roll.activeBreakdown = roll.activeBreakdown || []).push({ source: 'The Fearless Flame', value: 1 });
            } else {
                roll.challengerBase += 1;
                (roll.challengerBreakdown = roll.challengerBreakdown || []).push({ source: 'The Fearless Flame', value: 1 });
            }
        } else {
            roll.baseRoll += 1;
            roll.currentRoll += 1;
            roll.passiveBonus += 1;
            (roll.breakdown = roll.breakdown || []).push({ source: 'The Fearless Flame', value: 1 });
        }
        io.emit('message', `${getPlayerName(gameState, action.playerToChoose)} gained +1 from The Fearless Flame.`);
        if (roll.type === 'CHALLENGE') {
            io.emit('dice_roll_pending', {
                isChallenge: true, type: 'CHALLENGE',
                activeId: roll.activeId, activeName: getPlayerName(gameState, roll.activeId),
                activeRoll1: roll.activeRoll1, activeRoll2: roll.activeRoll2, activeBreakdown: roll.activeBreakdown,
                activeTotal: roll.activeBase, activeModifierTotal: roll.activeModifiers || 0,
                activeFinalTotal: roll.activeBase + (roll.activeModifiers || 0),
                challengerId: roll.challengerId, challengerName: getPlayerName(gameState, roll.challengerId),
                challengerRoll1: roll.challengerRoll1, challengerRoll2: roll.challengerRoll2,
                challengerBreakdown: roll.challengerBreakdown, challengerTotal: roll.challengerBase,
                challengerModifierTotal: roll.challengerModifiers || 0,
                challengerFinalTotal: roll.challengerBase + (roll.challengerModifiers || 0), reason: 'for a CHALLENGE!'
            });
        } else {
            io.emit('dice_roll_pending', {
                rollerId: roll.rollerId, rollerName: getPlayerName(gameState, roll.rollerId),
                roll1: roll.roll1, roll2: roll.roll2, passiveBonus: roll.passiveBonus,
                breakdown: roll.breakdown, modifierTotal: roll.modifierTotal || 0,
                finalTotal: roll.currentRoll, total: roll.currentRoll,
                reason: roll.type === 'ATTACK' ? 'to attack a monster' : 'for a skill'
            });
        }
    }
    roll.fearlessFlameQueue.shift();
    startNextFearlessFlameChoice();
}

function clearChallengeTimer() {
    if (!challengeTimer) return;
    clearTimeout(challengeTimer);
    challengeTimer = null;
}

function getConnectedChallengeOpponentIds(state, connectedSocketIds = null) {
    const pending = state && state.pendingChallenge;
    if (!pending) return [];
    const connectedSet = connectedSocketIds ? new Set(connectedSocketIds) : null;
    return Object.keys(state.players || {}).filter(playerId => {
        if (playerId === pending.rollerId) return false;
        const player = state.players[playerId];
        if (!player || player.connected === false) return false;
        return !connectedSet || connectedSet.has(playerId);
    });
}

function haveAllConnectedChallengeOpponentsPassed(state, connectedSocketIds = null) {
    const pending = state && state.pendingChallenge;
    if (!pending) return false;
    const passedPlayers = new Set(pending.passedPlayers || []);
    return getConnectedChallengeOpponentIds(state, connectedSocketIds)
        .every(playerId => passedPlayers.has(playerId));
}

function settleUnchallengedCardIfComplete(message) {
    if (gameState.state !== 'WAITING_FOR_CHALLENGES' || !gameState.pendingChallenge) return false;
    const connectedSocketIds = Array.from(io.sockets.sockets.keys());
    if (!haveAllConnectedChallengeOpponentsPassed(gameState, connectedSocketIds)) return false;

    clearChallengeTimer();
    io.emit('challenge_resolved', {
        message: message || `${gameState.pendingChallenge.card.name} was not challenged and resolves normally.`
    });
    resolvePendingCard();
    return true;
}

function ensureChallengeTimer() {
    if (challengeTimer || gameState.state !== 'WAITING_FOR_CHALLENGES' || !gameState.pendingChallenge) return;
    gameState.pendingChallenge.expiresAt = Date.now() + CHALLENGE_TIMEOUT_MS;
    const pendingAtStart = gameState.pendingChallenge;
    challengeTimer = setTimeout(() => {
        challengeTimer = null;
        if (gameState.state !== 'WAITING_FOR_CHALLENGES' || gameState.pendingChallenge !== pendingAtStart) return;
        io.emit('challenge_resolved', {
            message: `Challenge window expired. ${pendingAtStart.card.name} resolves normally.`
        });
        resolvePendingCard();
    }, CHALLENGE_TIMEOUT_MS);
}

function clearUntilNextTurnProtections(player) {
    if (!player) return;
    player.cannotBeStolen = false;
    player.cannotBeDestroyed = false;
    player.maegistyActive = false;
    player.untilNextTurnRollBonus = 0;
}

function pendingActionForTargetingPlan(plan, rollerId, skillId, heroId) {
    if (!plan) return null;
    if (plan.type === 'EXECUTE_SKILL_IMMEDIATE') {
        return { type: plan.type, rollerId, skillId, heroId };
    }
    if (plan.type === 'DESTROY') {
        return { type: 'DESTROY', playerToChoose: rollerId, originalActor: rollerId };
    }
    return { type: plan.type, originalActor: rollerId, skillId, heroId };
}

function queueLightningLabrysPlayerChoice(state, originalActor, remainingChoices) {
    if (!state.players?.[originalActor] || remainingChoices <= 0) {
        state.state = 'PLAYING';
        state.pendingAction = null;
        return false;
    }
    state.state = 'WAITING_FOR_SKILL_TARGET';
    state.pendingAction = {
        type: 'LIGHTNING_LABRYS_PLAYER',
        playerToChoose: originalActor,
        originalActor,
        remainingChoices,
        allowSelf: true
    };
    return true;
}

function queueLightningLabrysSacrifice(state, targetPlayerId) {
    const action = state.pendingAction;
    if (!action || action.type !== 'LIGHTNING_LABRYS_PLAYER') return false;
    const target = state.players?.[targetPlayerId];
    if (!target || target.connected === false) return false;

    const remainingChoices = Math.max(0, action.remainingChoices - 1);
    if (!(target.party || []).some(card => card.type === 'Hero Card')) {
        queueLightningLabrysPlayerChoice(state, action.originalActor, remainingChoices);
        return 'NO_HERO';
    }

    state.state = 'WAITING_FOR_SACRIFICE';
    state.pendingAction = {
        type: 'LIGHTNING_LABRYS_SACRIFICE',
        playerToChoose: targetPlayerId,
        originalActor: action.originalActor,
        remainingChoices
    };
    return true;
}

const CLASSES = ['Fighter', 'Bard', 'Guardian', 'Ranger', 'Thief', 'Wizard', 'Druid', 'Warrior', 'Necromancer', 'Berserker', 'Sorcerer'];

const TARGETING_SKILLS = ['DESTROY_HERO', 'STEAL_HERO', 'MAGIC_DESTRUCTIVE', 'SKILL_MEOWZIO', 'SKILL_SHURIKITTY', 'SKILL_TIPSY_TOOTIE', 'SKILL_WHISKERS', 'SKILL_WIGGLES', 'SKILL_SERIOUS_GREY', 'SKILL_PERFECT_VESSEL', 'SKILL_UNBRIDLED_FURY'];
// Skills whose executeSkill consumes targetData and resolves immediately (single
// player pick). Buttons/Plundering Puma/Sly Pickings/Lucky Bucky are NOT here:
// their executeSkill sets up its own pull-targeting (LOOK_AND_PULL/PUMA_PULL/
// CONDITIONAL_PULL), so listing them here caused a double player-selection that
// soft-locked (you picked once, then had no clickable opponent for the pull).
const PLAYER_TARGETING_SKILLS = ['PULL_CARD', 'SKILL_HEAVY_BEAR', 'TRADE_HANDS', 'SKILL_SHARP_FOX', 'SKILL_SILENT_SHADOW', 'SKILL_SLIPPERY_PAWS', 'SKILL_HOPPER', 'SKILL_BUCK_OMENS', 'SKILL_BLINDING_BLADE', 'SKILL_HOLLOW_HUSK', 'SKILL_BOSTON_TERROR', 'SKILL_DYSTORTIVERN', 'SKILL_ORACON'];
const DISCARD_TARGETING_SKILLS = ['SKILL_GUIDING_LIGHT', 'SKILL_RADIANT_HORN', 'SKILL_LOOKIE_ROOKIE', 'SKILL_BUN_BUN', 'SKILL_MAGUS_MOOSE', 'SKILL_ANNIHILATOR', 'SKILL_RENOVERN', 'SKILL_SHAMANAGA', 'MAGIC_CALL_FALLEN'];
const SELF_ITEM_TARGETING_SKILLS = ['SKILL_HOLY_CURSELIFTER'];
const MULTI_TARGETING_SKILLS = ['SKILL_FLUFFY', 'SKILL_TENACIOUS_TIMBER'];

let PARTY_LEADERS = [];
let trackedCardsPlayed = [];
let trackableCardTotal = 0;

const TRACKABLE_CARD_TYPES = new Set([
    'Hero Card',
    'Item Card',
    'Cursed Item Card',
    'Modifier Card',
    'Magic Card',
    'Challenge Card'
]);

function registerCardPlayed(card) {
    if (!card) return;
    if (!TRACKABLE_CARD_TYPES.has(card.type)) return;
    if (card.id && !trackedCardsPlayed.includes(card.id)) {
        trackedCardsPlayed.push(card.id);
    }
}

function loadCardAssetIds(relativeDir, extension) {
    const dir = path.join(__dirname, 'public', ...relativeDir.split('/'));
    try {
        return new Set(
            fs.readdirSync(dir)
                .filter(f => f.endsWith(extension))
                .map(f => f.slice(0, -extension.length))
        );
    } catch {
        return new Set();   // assets not generated yet
    }
}

function loadFullCardArtSource(directory, extensions) {
    const extensionById = new Map();
    extensions.forEach(extension => {
        loadCardAssetIds(`assets/skin/cards/${directory}`, extension).forEach(id => {
            extensionById.set(id, extension.slice(1));
        });
    });
    return { directory, extensionById };
}

// Card ids that have generated illustration art on disk (art-web/<id>.webp,
// produced by scripts/compress-art.js). Selected card families additionally have
// fully baked card faces; those are rendered whole on the board.
function applyGeneratedCardArt(card, artIds, fullArtSources) {
    if (!card) return;
    if (artIds.has(card.id)) {
        card.illustrationArtUrl = `assets/skin/cards/art-web/${card.id}.webp`;
    }
    const fullArtSource = fullArtSources[card.type];
    const fullArtExtension = fullArtSource?.extensionById.get(card.id);
    if (fullArtSource && fullArtExtension) {
        card.fullCardArtUrl = `assets/skin/cards/${fullArtSource.directory}/${card.id}.${fullArtExtension}`;
        card.artUrl = card.fullCardArtUrl;
        return;
    }
    if (card.illustrationArtUrl) {
        card.artUrl = card.illustrationArtUrl;
    }
}

function loadCards() {
    const rawData = fs.readFileSync(path.join(__dirname, 'cards.json'), 'utf-8');
    const cards = JSON.parse(rawData);
    const artIds = loadCardAssetIds('assets/skin/cards/art-web', '.webp');
    const fullArtSources = {
        'Monster Card': loadFullCardArtSource('monster-fullgen-v1', ['.webp']),
        'Party Leader': loadFullCardArtSource('leader-fullgen-v1', ['.webp']),
        'Item Card': loadFullCardArtSource('item-fullgen-v1', ['.webp']),
        'Cursed Item Card': loadFullCardArtSource('cursed-item-fullgen-v1', ['.webp']),
        'Magic Card': loadFullCardArtSource('magic-fullgen-v1', ['.webp']),
        'Hero Card': loadFullCardArtSource('hero-fullgen-v1', ['.webp']),
        'Modifier Card': loadFullCardArtSource('modifier-fullgen-v1', ['.webp']),
        'Challenge Card': loadFullCardArtSource('challenge-fullgen-v1', ['.webp'])
    };

    // ALL_CARDS is a separate raw require of cards.json used for by-id lookups
    // (skill targets, debug injection, card inspection), so it needs artUrl too —
    // otherwise cards reached through those paths render the old wiki scan.
    ALL_CARDS.forEach(c => {
        applyGeneratedCardArt(c, artIds, fullArtSources);
    });

    PARTY_LEADERS = [];
    gameState.mainDeck = [];
    gameState.monsterDeck = [];
    gameState.availableLeaders = [];

    cards.forEach(c => {
        if (c.type === 'Unknown' && c.name.startsWith('Modifier')) {
            c.type = 'Modifier Card';
        } else if (c.type === 'Unknown' && c.name.includes('Challenge')) {
            c.type = 'Challenge Card';
        } else if (c.type === 'Unknown' || c.type === 'Rule Card') {
            return;
        }
        
        let card = { ...c };

        applyGeneratedCardArt(card, artIds, fullArtSources);

        // Expansion cards enter live decks only after their complete baked card
        // face exists. This lets us add names/rules ahead of the visual rollout
        // without exposing unfinished cards during normal matches.
        if (card.expansion && !card.fullCardArtUrl) {
            return;
        }

        if (card.type === 'Party Leader') {
            PARTY_LEADERS.push(card);
            gameState.availableLeaders.push(card);
        } else if (card.type === 'Monster Card') {
            gameState.monsterDeck.push(card);
        } else {
            gameState.mainDeck.push(card);
        }
    });

    trackableCardTotal = gameState.mainDeck.filter(card => TRACKABLE_CARD_TYPES.has(card.type)).length;

    shuffle(gameState.mainDeck);
    shuffle(gameState.monsterDeck);
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function dealCards(count, playerSocketId, source = 'draw', continuation = null) {
    const player = gameState.players[playerSocketId];
    if (queueLumberingDrawSequence(gameState, player, count, continuation, source)) return [];
    if (count === 1 && gameState.state === 'PLAYING') {
        if (gameState.mainDeck.length === 0) {
            drawCardsWithPassives(gameState, io, 1, player);
            return;
        }
        if (gameState.mainDeck.length > 0) {
            const nextCard = gameState.mainDeck[gameState.mainDeck.length - 1];
            const hasMalamammoth = player.slainMonsters && player.slainMonsters.some(m => m.effect_id === 'MONSTER_MALAMAMMOTH');
            if (hasMalamammoth && nextCard.type === 'Item Card') {
                const card = gameState.mainDeck.pop();
                gameState.state = 'WAITING_FOR_IMMEDIATE_PLAY';
                gameState.pendingCard = card;
                gameState.pendingAction = {
                    playerToChoose: playerSocketId,
                    type: 'IMMEDIATE_PLAY',
                    originalActor: playerSocketId
                };
                broadcastState();
                return;
            } else {
                drawCardsWithPassives(gameState, io, 1, player);
                if (gameState.state === 'WAITING_FOR_IMMEDIATE_PLAY') {
                    broadcastState();
                    return;
                }
            }
        }
    } else {
        drawCardsWithPassives(gameState, io, count, player);
    }
}

function spawnMonsters() {
    while (gameState.activeMonsters.length < 3 && gameState.monsterDeck.length > 0) {
        gameState.activeMonsters.push(gameState.monsterDeck.pop());
    }
}

// A Mask item makes the equipped Hero count as the Mask's class instead of its
// original (matters for the 6-class win and monster requirements). The class is
// derived from the Mask's name ("Bard Mask" -> "Bard"); an explicit item.class
// wins if one is ever added to the data.
function maskClass(item) {
    if (!item || item.effect_id !== 'ITEM_MASK') return null;
    if (item.class) return item.class;
    const m = /^(\w+)\s+Mask$/.exec(item.name || '');
    return m ? m[1] : null;
}
function effectiveHeroClass(hero) {
    if (!hero) return null;
    return [hero.equippedItem, hero.equippedItem2].map(maskClass).find(Boolean) || hero.class;
}

function attackCostAllowedTypes(attackCost) {
    if (!attackCost?.discard || attackCost.discard === 'ANY') return null;
    if (attackCost.discard === 'Item Card' && attackCost.include_cursed) {
        return ['Item Card', 'Cursed Item Card'];
    }
    return [attackCost.discard];
}

function canPayMonsterAttackCost(player, monster) {
    const cost = monster?.attack_cost;
    if (!cost?.count) return true;
    const allowedTypes = attackCostAllowedTypes(cost);
    return (player?.hand || []).filter(card => !allowedTypes || allowedTypes.includes(card.type)).length >= cost.count;
}

function startMonsterAttackRoll(playerId, monsterId, { freeAttack = false } = {}) {
    const player = gameState.players[playerId];
    const monster = gameState.activeMonsters.find(card => card.id === monsterId);
    if (!player || !monster || (!freeAttack && player.ap < 2) || !meetsMonsterRequirements(player, monster.requirement)) return false;
    if (!freeAttack) player.ap -= 2;
    gameState.state = 'WAITING_TO_ROLL';
    gameState.pendingAction = null;
    gameState.pendingRoll = {
        type: 'ATTACK', rollerId: playerId, targetId: monster.id,
        roll1: 0, roll2: 0, passiveBonus: 0, modifierTotal: 0,
        baseRoll: 0, currentRoll: 0, passedPlayers: [], freeAttack
    };
    return true;
}

function slayFaceUpMonster(playerId, monsterId, source = 'attack') {
    const player = gameState.players[playerId];
    const monsterIndex = gameState.activeMonsters.findIndex(monster => monster.id === monsterId);
    if (!player || monsterIndex === -1) return null;
    const monster = gameState.activeMonsters.splice(monsterIndex, 1)[0];
    player.slainMonsters.push(monster);
    spawnMonsters();

    if (monster.effect_id === 'MONSTER_MEGA_SLIME') {
        player.ap += 1;
        io.emit('message', `${getPlayerName(gameState, player.id)} gained +1 AP from defeating Mega Slime!`);
    }
    if (player.leader?.effect_id === 'LEADER_BERSERKER') {
        dealCards(2, player.id, 'The Raging Manticore');
        io.emit('message', `${getPlayerName(gameState, player.id)} drew 2 cards from The Raging Manticore after slaying ${monster.name}.`);
    }
    if (monster.rewardAction === 'DRAW_1') dealCards(1, playerId);
    if (monster.rewardAction === 'DRAW_2') dealCards(2, playerId);
    if (monster.rewardAction && monster.rewardAction !== 'NONE') {
        io.emit('message', `${getPlayerName(gameState, player.id)} slew ${monster.name} and triggered reward: ${monster.rewardAction}`);
    }
    io.emit('message', `${getPlayerName(gameState, player.id)} slew ${monster.name}${source === 'SKILL_VICIOUS_WILDCAT' ? ' with Vicious Wildcat' : ''}!`);
    return monster;
}

// Decoy Doll (ITEM_DECOY): sacrifice the Doll to save the Hero from sacrifice/destroy.
// Auto-applied (always the better choice). Returns true if it absorbed the effect.
function consumeDecoyDoll(targetHero, action = 'DESTROY') {
    if (action === 'STEAL') return false;
    const slot = ['equippedItem', 'equippedItem2'].find(key => targetHero?.[key]?.effect_id === 'ITEM_DECOY');
    if (slot) {
        gameState.discardPile.push(targetHero[slot]);
        targetHero[slot] = null;
        return true;
    }
    return false;
}

function checkWinCondition() {
    for (const socketId of gameState.playerOrder) {
        const p = gameState.players[socketId];

        // Condition 1: Slay 4 Monsters
        const slainValue = (p.slainMonsters || []).reduce((sum, monster) => sum + (monster.slain_value || 1), 0);
        if (slainValue >= 4) {
            return { winnerId: p.id, reason: 'slayed 4 monsters' };
        }

        // Condition 2: 9 Different Classes in Party with all live expansions.
        const classes = new Set();
        if (p.leader) classes.add(p.leader.class);
        p.party.forEach(hero => {
            const cls = effectiveHeroClass(hero);
            if (cls) classes.add(cls);
        });

        if (classes.size >= 9) {
            return { winnerId: p.id, reason: 'assembled 9 classes' };
        }
    }
    return null;
}

function handleGameOver(winResult) {
    if (gameState.state === 'GAMEOVER') return;
    
    gameState.state = 'GAMEOVER';
    gameState.winner = winResult.winnerId;
    
    const winnerName = gameState.players[winResult.winnerId] ? getPlayerName(gameState, winResult.winnerId) : 'Unknown';
    io.emit('game_over', { winnerName, reason: winResult.reason });

    console.log(`\n[SIMULATION PROGRESS] Unique cards tested so far: ${trackedCardsPlayed.length} out of ${trackableCardTotal}.`);
    console.log(`[SIMULATION] Game over! Winner: ${winnerName} (${winResult.reason}). Automatically resetting game in 5 seconds...\n`);

    setTimeout(() => {
        resetGameForNextMatch();
    }, 5000);
}

function resetGameForNextMatch() {
    console.log(`[SIMULATION] Resetting match now...`);
    // Reset global game state
    gameState.state = 'LOBBY';
    gameState.pendingAction = null;
    gameState.pendingRoll = null;
    gameState.pendingChallenge = null;
    gameState.pendingCard = null;
    gameState.pendingPeek = null;
    gameState.pendingGlobalAction = null;
    gameState.pendingPassiveDraws = [];
    gameState.pendingMonsterTriggers = [];
    gameState.pendingLumberingDraws = [];
    gameState.pendingDeferredDrawPassives = [];
    gameState.pendingEndTurnEffects = null;
    gameState.pendingShamanagaSacrifice = null;
    gameState.pendingSmokReveal = null;
    gameState.pendingSilentShieldActorId = null;
    gameState.freePlayQueue = [];
    gameState.forcedEndTurnPlayerId = null;
    gameState.waitingForInput = false;
    gameState.modifierResponses = { actedPlayers: [], totalPlayers: 0 };
    gameState.activePlayerSocketId = null;
    gameState.winner = null;
    if (modifierTimer) clearTimeout(modifierTimer);
    modifierTimer = null;
    clearChallengeTimer();
    clearRexMajorChoices(gameState);
    debugForcedRoll = null;

    // Reset individual player stats but keep connections and order
    for (const playerId of gameState.playerOrder) {
        const player = gameState.players[playerId];
        if (player) {
            gameState.players[playerId] = {
                id: player.id,
                name: player.name,
                hand: [],
                party: [],
                slainMonsters: [],
                leader: null,
                ap: 0,
                connected: player.connected !== false,
                away: Boolean(player.away),
                disconnectedAt: player.disconnectedAt || null,
                hasSelectedLeader: false,
                hasRerolledLeader: false
            };
        }
    }

    // Decks will be re-initialized when startGame is called from the lobby,
    // but we can clear them now for safety.
    gameState.mainDeck = [];
    gameState.monsterDeck = [];
    gameState.discardPile = [];
    gameState.activeMonsters = [];
    gameState.availableLeaders = [...PARTY_LEADERS];

    io.emit('game_reset_complete');
    broadcastState();
}

function resetToPlayingState() {
    clearChallengeTimer();
    gameState.state = 'PLAYING';
    gameState.pendingAction = null;
    gameState.pendingCard = null;
    gameState.challengePhase = false;
    gameState.modifierPhase = false;
    gameState.pendingChallenge = null;
}

function queuePassiveDraw(playerId, count, source) {
    if (!gameState.players[playerId] || count <= 0) return;
    if (!gameState.pendingPassiveDraws) gameState.pendingPassiveDraws = [];
    gameState.pendingPassiveDraws.push({ playerId, count, source });
}

function triggerPlayedCardMonsterPassives(playerId, card) {
    const player = gameState.players[playerId];
    if (!player || !card) return;
    const slain = player.slainMonsters || [];
    if (card.type === 'Challenge Card' && slain.some(monster => monster.effect_id === 'MONSTER_POSSESSED_PLUSH')) {
        queuePassiveDraw(playerId, 1, 'Possessed Plush');
    }
    if (card.type === 'Magic Card' && slain.some(monster => monster.effect_id === 'MONSTER_VOLTCLAW_LION')) {
        queuePassiveDraw(playerId, 1, 'Voltclaw Lion');
    }
    if (['Item Card', 'Cursed Item Card'].includes(card.type)
        && slain.some(monster => monster.effect_id === 'MONSTER_WICKED_SEA_SERPENT')) {
        queuePassiveDraw(playerId, 1, 'Wicked Sea Serpent');
    }
}

function advanceTurn(currentPlayerId) {
    const currentIndex = gameState.playerOrder.indexOf(currentPlayerId);
    if (currentIndex === -1 || gameState.playerOrder.length === 0) return false;
    const nextIndex = (currentIndex + 1) % gameState.playerOrder.length;
    gameState.activePlayerSocketId = gameState.playerOrder[nextIndex];

    resetToPlayingState();
    gameState.pendingRoll = null;
    gameState.pendingChallenge = null;
    gameState.pendingGlobalAction = null;
    gameState.pendingAction = null;
    gameState.waitingForInput = false;
    gameState.forcedEndTurnPlayerId = null;
    if (modifierTimer) clearTimeout(modifierTimer);

    const currentPlayer = gameState.players[currentPlayerId];
    if (currentPlayer) {
        currentPlayer.magicRollBonus = 0;
        currentPlayer.rollBonus = 0;
        currentPlayer.rollBonusSources = [];
        currentPlayer.attackRollBonus = 0;
        currentPlayer.stagguardActive = false;
        currentPlayer.blocksOpponentModifiersThisTurn = false;
        currentPlayer.silentShieldActive = false;
        currentPlayer.cannotBeChallenged = false;
        currentPlayer.usedLeaderSkillThisTurn = false;
    }

    const nextPlayer = gameState.players[gameState.activePlayerSocketId];
    if (nextPlayer) {
        clearUntilNextTurnProtections(nextPlayer);
        nextPlayer.usedLeaderSkillThisTurn = false;
        nextPlayer.ap = (nextPlayer.slainMonsters || []).some(monster => monster.effect_id === 'MONSTER_MEGA_SLIME') ? 4 : 3;
    }

    Object.values(gameState.players).forEach(player => {
        player.usedNobleShamanThisTurn = false;
        player.usedMuscipulaRexThisTurn = false;
        (player.party || []).forEach(card => {
            if (card.type === 'Hero Card') card.usedSkillThisTurn = false;
        });
    });
    return true;
}

function eligibleEndTurnMonsterEffects(player) {
    if (!player || player.hand.length !== 0) return [];
    const slain = player.slainMonsters || [];
    return [
        ['MONSTER_CLAWED_NIGHTMARE', 'CLAWED_NIGHTMARE_PULL'],
        ['MONSTER_GORETELODONT', 'GORETELODONT_DRAW'],
        ['MONSTER_SCAVENGER_GRIFFIN', 'SCAVENGER_GRIFFIN_STEAL']
    ].filter(([monsterId]) => slain.some(monster => monster.effect_id === monsterId))
        .map(([, effect]) => effect);
}

function advanceEndTurnMonsterEffect() {
    const sequence = gameState.pendingEndTurnEffects;
    if (!sequence) return false;
    const player = gameState.players[sequence.playerId];
    if (!player) {
        gameState.pendingEndTurnEffects = null;
        return false;
    }
    const effect = sequence.effects.shift();
    if (!effect) {
        const playerId = sequence.playerId;
        gameState.pendingEndTurnEffects = null;
        advanceTurn(playerId);
        return true;
    }
    gameState.state = 'WAITING_FOR_END_TURN_CHOICE';
    gameState.pendingAction = {
        type: 'END_TURN_MONSTER_CHOICE', effect,
        playerToChoose: player.id, originalActor: player.id, optional: true
    };
    return true;
}

function beginEndTurn(playerId) {
    const player = gameState.players[playerId];
    const effects = eligibleEndTurnMonsterEffects(player);
    if (effects.length === 0) return advanceTurn(playerId);
    gameState.pendingEndTurnEffects = { playerId, effects };
    return advanceEndTurnMonsterEffect();
}

function sacrificePartyCard(player, targetCardId, allowedTarget = 'ANY_PARTY_CARD') {
    if (!player || !targetCardId) return null;

    for (const hero of player.party || []) {
        for (const slot of ['equippedItem', 'equippedItem2']) {
            const item = hero[slot];
            if (!item || item.id !== targetCardId || allowedTarget === 'HERO_ONLY') continue;
            hero[slot] = null;
            gameState.discardPile.push(item);
            recordSacrificeEvent(gameState, player, item, { isHero: false });
            return { card: item, didSacrifice: true, kind: 'ITEM' };
        }
    }

    const heroIndex = (player.party || []).findIndex(card => card.id === targetCardId && card.type === 'Hero Card');
    if (heroIndex === -1 || allowedTarget === 'ITEM_ONLY') return null;
    const hero = player.party[heroIndex];
    const decoy = equippedItems(hero).find(item => item.effect_id === 'ITEM_DECOY');
    if (consumeDecoyDoll(hero, 'SACRIFICE')) {
        if (decoy) recordSacrificeEvent(gameState, player, decoy, { isHero: false });
        return { card: decoy || hero, didSacrifice: true, kind: 'DECOY' };
    }
    if (player.maegistyActive) {
        const removedItems = ['equippedItem', 'equippedItem2']
            .filter(slot => hero[slot])
            .map(slot => ({ slot, card: hero[slot] }));
        const items = removedItems.map(entry => entry.card);
        player.party.splice(heroIndex, 1);
        hero.equippedItem = null;
        hero.equippedItem2 = null;
        player.hand.push(hero, ...items);
        return { card: hero, didSacrifice: false, kind: 'RETURNED' };
    }

    player.party.splice(heroIndex, 1);
    const removedItems = ['equippedItem', 'equippedItem2']
        .filter(slot => hero[slot])
        .map(slot => ({ slot, card: hero[slot] }));
    removedItems.forEach(entry => gameState.discardPile.push(entry.card));
    hero.equippedItem = null;
    hero.equippedItem2 = null;
    gameState.discardPile.push(hero);
    recordSacrificeEvent(gameState, player, hero, {
        isHero: true, removedItems,
        initiatorId: player.silentShieldActive ? player.id : null
    });
    return { card: hero, didSacrifice: true, kind: 'HERO' };
}

function destroyOpponentPartyCard(actorId, targetCardId) {
    for (const owner of Object.values(gameState.players)) {
        if (!owner || owner.id === actorId) continue;
        for (const hero of owner.party || []) {
            for (const slot of ['equippedItem', 'equippedItem2']) {
                const item = hero[slot];
                if (!item || item.id !== targetCardId) continue;
                hero[slot] = null;
                gameState.discardPile.push(item);
                return { card: item, didDestroy: true, kind: 'ITEM' };
            }
        }

        const heroIndex = (owner.party || []).findIndex(card => card.id === targetCardId && card.type === 'Hero Card');
        if (heroIndex === -1) continue;
        if (owner.cannotBeDestroyed || (owner.slainMonsters || []).some(monster => monster.effect_id === 'MONSTER_TERRATUGA')) {
            return { card: owner.party[heroIndex], didDestroy: false, kind: 'PROTECTED' };
        }
        const hero = owner.party[heroIndex];
        if (consumeDecoyDoll(hero, 'DESTROY')) return { card: hero, didDestroy: false, kind: 'DECOY' };
        owner.party.splice(heroIndex, 1);
        const removedItems = ['equippedItem', 'equippedItem2']
            .filter(slot => hero[slot])
            .map(slot => ({ slot, card: hero[slot] }));
        const items = removedItems.map(entry => entry.card);
        hero.equippedItem = null;
        hero.equippedItem2 = null;
        if (owner.maegistyActive) {
            owner.hand.push(hero, ...items);
            return { card: hero, didDestroy: false, kind: 'RETURNED' };
        }
        gameState.discardPile.push(hero, ...items);
        const actor = gameState.players[actorId];
        recordDestroyEvent(gameState, owner, hero, {
            removedItems,
            initiatorId: actor?.silentShieldActive ? actorId : null
        });
        return { card: hero, didDestroy: true, kind: 'HERO' };
    }
    return null;
}

function hasDestroyableOpponentPartyCard(actorId) {
    return Object.values(gameState.players).some(owner => {
        if (!owner || owner.id === actorId) return false;
        return (owner.party || []).some(hero => equippedItems(hero).length > 0
            || (!owner.cannotBeDestroyed
                && !(owner.slainMonsters || []).some(monster => monster.effect_id === 'MONSTER_TERRATUGA')));
    });
}

function finishSequentialGlobalAction(action) {
    const after = action.afterResolution;
    gameState.pendingGlobalAction = null;
    resetToPlayingState();
    if (after?.type === 'MEOWNTAIN_BONUS') {
        const player = gameState.players[after.playerId];
        if (player) {
            player.rollBonus = (player.rollBonus || 0) + 5;
            (player.rollBonusSources = player.rollBonusSources || []).push({ source: 'Meowntain', value: 5 });
            io.emit('message', `${getPlayerName(gameState, player.id)} gains +5 to all rolls for the rest of the turn from Meowntain.`);
        }
    } else if (after?.type === 'DISCARD_RETRIEVAL') {
        const hasEligibleCard = gameState.discardPile.some(card => after.allowedTypes.includes(card.type));
        if (gameState.players[after.playerId] && hasEligibleCard) {
            gameState.state = 'WAITING_FOR_SKILL_TARGET';
            gameState.pendingAction = {
                type: 'SKILL_TARGET_DISCARD', playerToChoose: after.playerId, originalActor: after.playerId,
                skillId: after.skillId, heroId: null, allowedTypes: after.allowedTypes
            };
            io.emit('message', `${getPlayerName(gameState, after.playerId)} must choose a card from the discard pile.`);
        } else {
            io.emit('message', `No eligible card is available in the discard pile, so the retrieval ends.`);
        }
    }
}

function queueBostonTerrorRetrieval(playerId) {
    if (!gameState.players[playerId] || gameState.discardPile.length === 0) {
        resetToPlayingState();
        gameState.pendingGlobalAction = null;
        return false;
    }
    gameState.pendingGlobalAction = null;
    gameState.state = 'WAITING_FOR_SKILL_TARGET';
    gameState.pendingAction = {
        type: 'SKILL_TARGET_DISCARD', playerToChoose: playerId, originalActor: playerId,
        skillId: 'SKILL_BOSTON_TERROR_RETRIEVE', allowedTypes: [
            'Hero Card', 'Item Card', 'Cursed Item Card', 'Magic Card', 'Modifier Card', 'Challenge Card'
        ], remaining: Math.min(2, gameState.discardPile.length), optional: true
    };
    return true;
}

function queueGobletReroll(playerId, heroId) {
    const player = gameState.players[playerId];
    const hero = player?.party?.find(card => card.id === heroId);
    if (!hero || !hasEquippedEffect(hero, 'ITEM_GOBLET_CAFFEINATION')) return false;
    gameState.state = 'WAITING_FOR_GOBLET_REROLL';
    gameState.pendingAction = {
        type: 'GOBLET_REROLL', playerToChoose: playerId, originalActor: playerId, heroId
    };
    return true;
}

function restoreDragonWaspHero(trigger) {
    const owner = gameState.players[trigger?.playerId];
    const hero = trigger?.hero;
    if (!owner || !hero) return false;
    const restoredIds = new Set([hero.id, ...(trigger.removedItems || []).map(entry => entry.card?.id)]);
    gameState.discardPile = gameState.discardPile.filter(card => !restoredIds.has(card.id));
    Object.values(gameState.players).forEach(player => {
        player.hand = (player.hand || []).filter(card => !restoredIds.has(card.id));
    });
    hero.equippedItem = null;
    hero.equippedItem2 = null;
    (trigger.removedItems || []).forEach(entry => {
        if (entry?.slot && entry.card) hero[entry.slot] = entry.card;
    });
    if (!(owner.party || []).some(card => card.id === hero.id)) owner.party.push(hero);
    return true;
}

function completeLumberingDrawStep(sequence, drawnCards) {
    if (!sequence) return;
    sequence.remaining = Math.max(0, sequence.remaining - 1);
    sequence.drawnCardIds.push(...drawnCards.map(card => card.id));
    sequence.drawnCards.push(...drawnCards);
    if (!gameState.pendingDeferredDrawPassives) gameState.pendingDeferredDrawPassives = [];
    drawnCards.forEach(card => gameState.pendingDeferredDrawPassives.push({
        playerId: sequence.playerId, card
    }));
}

function resolveLumberingContinuation(sequence) {
    const continuation = sequence?.continuation;
    if (!continuation) return;
    const player = gameState.players[continuation.playerId || sequence.playerId];
    if (!player) return;
    if (continuation.type === 'ADVANCE_END_TURN_MONSTER_EFFECT') {
        advanceEndTurnMonsterEffect();
    } else if (continuation.type === 'DISCARD_ONE') {
        if (player.hand.length > 0) {
            gameState.state = 'PLAYING';
            gameState.pendingAction = {
                type: 'DISCARD', playerToChoose: player.id, amount: 1, originalActor: player.id
            };
        }
    } else if (continuation.type === 'PAN_CHUCKS') {
        const drewChallenge = sequence.drawnCards.some(card => card.type === 'Challenge Card');
        if (drewChallenge && hasStealOrDestroyTarget(player.id, 'DESTROY')) {
            gameState.state = 'PLAYING';
            gameState.pendingAction = {
                type: 'DESTROY', playerToChoose: player.id,
                originalActor: player.id, optional: true
            };
        }
    } else if (continuation.type === 'FUZZY_CHEEKS') {
        if (player.hand.some(card => card.type === 'Hero Card')) {
            gameState.state = 'WAITING_FOR_HAND_SELECTION';
            gameState.pendingAction = {
                type: 'PLAY_FROM_HAND', allowedTypes: ['Hero Card'],
                playerToChoose: player.id, originalActor: player.id
            };
        }
    } else if (continuation.type === 'QUICK_DRAW') {
        const itemIds = sequence.drawnCards
            .filter(card => ['Item Card', 'Cursed Item Card'].includes(card.type)
                && player.hand.some(held => held.id === card.id))
            .map(card => card.id);
        if (itemIds.length > 0) {
            gameState.state = 'WAITING_FOR_HAND_SELECTION';
            gameState.pendingAction = {
                type: 'PLAY_FROM_HAND', allowedTypes: ['Item Card', 'Cursed Item Card'],
                allowedCardIds: itemIds, playerToChoose: player.id,
                originalActor: player.id, optional: true
            };
        }
    } else if (continuation.type === 'SNOWBALL') {
        const magicCards = sequence.drawnCards.filter(card => card.type === 'Magic Card'
            && player.hand.some(held => held.id === card.id));
        if (magicCards.length === 1) {
            const card = magicCards[0];
            player.hand.splice(player.hand.findIndex(held => held.id === card.id), 1);
            gameState.state = 'WAITING_FOR_IMMEDIATE_PLAY';
            gameState.pendingCard = card;
            gameState.pendingAction = {
                type: 'IMMEDIATE_PLAY_CHOICE', playerToChoose: player.id,
                originalActor: player.id, thenDraw: 1
            };
        } else if (magicCards.length > 1) {
            gameState.state = 'WAITING_FOR_HAND_SELECTION';
            gameState.pendingAction = {
                type: 'PLAY_FROM_HAND', allowedTypes: ['Magic Card'],
                allowedCardIds: magicCards.map(card => card.id), playerToChoose: player.id,
                originalActor: player.id, optional: true, thenDraw: 1
            };
        }
    } else if (continuation.type === 'DRAW_AND_PLAY') {
        const heroIds = sequence.drawnCards
            .filter(card => card.type === 'Hero Card' && player.hand.some(held => held.id === card.id))
            .map(card => card.id);
        if (heroIds.length > 0) {
            gameState.state = 'WAITING_FOR_HAND_SELECTION';
            gameState.pendingAction = {
                type: 'PLAY_FROM_HAND', allowedTypes: ['Hero Card'], allowedCardIds: heroIds,
                playerToChoose: player.id, originalActor: player.id, optional: true
            };
        }
    } else if (continuation.type === 'SMOK_REVEAL') {
        const magicIds = sequence.drawnCards
            .filter(card => card.type === 'Magic Card' && player.hand.some(held => held.id === card.id))
            .map(card => card.id);
        if (magicIds.length > 0) {
            gameState.pendingSmokReveal = { playerId: player.id, allowedCardIds: magicIds };
        }
    } else if (continuation.type === 'START_CARD_CHALLENGE') {
        gameState.pendingCard = continuation.card;
        gameState.pendingChallenge = {
            rollerId: player.id, card: continuation.card,
            targetPlayerId: continuation.targetPlayerId,
            targetHeroId: continuation.targetHeroId,
            passedPlayers: []
        };
        if (player.cannotBeChallenged) {
            resolvePendingCard();
        } else {
            gameState.state = 'WAITING_FOR_CHALLENGES';
            io.emit('challenge_pending', {
                rollerId: player.id, rollerName: getPlayerName(gameState, player.id),
                card: continuation.card
            });
        }
    }
}

function resumeExpansionChoices() {
    if (gameState.state !== 'PLAYING' || gameState.pendingAction || gameState.pendingCard || gameState.pendingChallenge) return;

    if (gameState.pendingShamanagaSacrifice) {
        const pending = gameState.pendingShamanagaSacrifice;
        gameState.pendingShamanagaSacrifice = null;
        const owner = gameState.players[pending.playerId];
        const index = owner?.party?.findIndex(card => card.id === pending.heroId) ?? -1;
        if (owner && index !== -1) {
            const hero = owner.party[index];
            const items = equippedItems(hero);
            owner.party.splice(index, 1);
            hero.equippedItem = null;
            hero.equippedItem2 = null;
            if (owner.maegistyActive) {
                owner.hand.push(hero, ...items);
                io.emit('message', `${hero.name} and its Items returned to ${getPlayerName(gameState, owner.id)}'s hand instead of being sacrificed after Shamanaga.`);
            } else {
                gameState.discardPile.push(hero, ...items);
                recordSacrificeEvent(gameState, owner, hero, { isHero: true });
                io.emit('message', `${getPlayerName(gameState, owner.id)} sacrificed ${hero.name} after resolving its effect with Shamanaga.`);
            }
        }
    }

    if (gameState.pendingSmokReveal) {
        const pending = gameState.pendingSmokReveal;
        gameState.pendingSmokReveal = null;
        const player = gameState.players[pending.playerId];
        const allowedCardIds = (pending.allowedCardIds || []).filter(cardId =>
            player?.hand?.some(card => card.id === cardId && card.type === 'Magic Card'));
        if (player && allowedCardIds.length > 0) {
            gameState.state = 'WAITING_FOR_SMOK_CHOICE';
            gameState.pendingAction = {
                type: 'SMOK_REVEAL', playerToChoose: player.id,
                originalActor: player.id, allowedCardIds
            };
            return;
        }
    }

    if (gameState.pendingSilentShieldActorId) {
        const playerId = gameState.pendingSilentShieldActorId;
        gameState.pendingSilentShieldActorId = null;
        if (gameState.players[playerId]?.silentShieldActive && gameState.discardPile.some(card => card.type === 'Hero Card')) {
            gameState.state = 'WAITING_FOR_SKILL_TARGET';
            gameState.pendingAction = {
                type: 'SKILL_TARGET_DISCARD', originalActor: playerId, playerToChoose: playerId,
                skillId: 'SKILL_SILENT_SHIELD_RETRIEVE', optional: true
            };
            return;
        }
    }

    while (gameState.pendingDeferredDrawPassives?.length > 0) {
        const entry = gameState.pendingDeferredDrawPassives.shift();
        const player = gameState.players[entry.playerId];
        if (!player) continue;
        applyDrawnCardPassives(gameState, io, player, entry.card);
        if (gameState.state !== 'PLAYING' || gameState.pendingAction || gameState.pendingCard) return;
    }

    while (gameState.pendingLumberingDraws?.length > 0) {
        const sequence = gameState.pendingLumberingDraws[0];
        const player = gameState.players[sequence.playerId];
        if (!player) {
            gameState.pendingLumberingDraws.shift();
            continue;
        }
        if (sequence.remaining <= 0) {
            gameState.pendingLumberingDraws.shift();
            resolveLumberingContinuation(sequence);
            if (gameState.state !== 'PLAYING' || gameState.pendingAction || gameState.pendingCard) return;
            continue;
        }
        gameState.state = 'WAITING_FOR_LUMBERING_DEMON_CHOICE';
        gameState.pendingAction = {
            type: 'LUMBERING_DEMON_DRAW', playerToChoose: player.id,
            originalActor: player.id, source: sequence.source
        };
        return;
    }

    while (gameState.pendingPassiveDraws?.length > 0) {
        const entry = gameState.pendingPassiveDraws[0];
        const player = gameState.players[entry.playerId];
        entry.count -= 1;
        if (entry.count <= 0) gameState.pendingPassiveDraws.shift();
        if (!player) continue;
        dealCards(1, player.id, entry.source);
        io.emit('message', `${getPlayerName(gameState, player.id)} drew a card from ${entry.source}.`);
        if (gameState.pendingLumberingDraws?.length > 0) {
            resumeExpansionChoices();
            return;
        }
        if (gameState.state !== 'PLAYING' || gameState.pendingAction || gameState.pendingCard) return;
    }

    while (gameState.pendingMonsterTriggers?.length > 0) {
        const trigger = gameState.pendingMonsterTriggers.shift();
        const player = gameState.players[trigger.playerId];
        if (!player) continue;
        if (trigger.type === 'DRAGON_WASP_REPLACEMENT') {
            if ((player.hand || []).length < 2) {
                queueCommittedHeroRemovalTriggers(gameState, player, trigger.hero, { ...trigger, isHero: true });
                continue;
            }
            gameState.state = 'WAITING_FOR_DRAGON_WASP_CHOICE';
            gameState.pendingAction = {
                type: 'DRAGON_WASP_REPLACEMENT', playerToChoose: player.id,
                originalActor: player.id, trigger
            };
            return;
        }
        if (trigger.type === 'FERAL_DRAGON_DRAW') {
            dealCards(1, player.id, 'Feral Dragon');
            const message = `${getPlayerName(gameState, trigger.sacrificingPlayerId)} sacrificed a card, so ${getPlayerName(gameState, player.id)} draws a card.`;
            io.emit('monster_effect_triggered', { monsterId: 'card_138', monsterName: 'Feral Dragon', ownerId: player.id, message });
            io.emit('message', `Feral Dragon activated: ${message}`);
            if (gameState.pendingLumberingDraws?.length > 0) {
                resumeExpansionChoices();
                return;
            }
            if (gameState.state !== 'PLAYING' || gameState.pendingAction || gameState.pendingCard) return;
            continue;
        }
        if (trigger.type === 'CALAMITY_MONGREL_REPLACE') {
            const card = player.hand.find(entry => entry.id === trigger.cardId && entry.type === 'Challenge Card');
            if (!card) continue;
            gameState.state = 'WAITING_FOR_CALAMITY_MONGREL_CHOICE';
            gameState.pendingAction = {
                type: 'CALAMITY_MONGREL_REPLACE', playerToChoose: player.id,
                originalActor: player.id, cardId: card.id
            };
            return;
        }
        if (trigger.type === 'DOOMBRINGER_RETRIEVE') {
            if (gameState.discardPile.length === 0) continue;
            gameState.state = 'WAITING_FOR_SKILL_TARGET';
            gameState.pendingAction = {
                type: 'SKILL_TARGET_DISCARD', playerToChoose: player.id, originalActor: player.id,
                skillId: 'MONSTER_DOOMBRINGER_RETRIEVE', optional: true,
                allowedTypes: ['Hero Card', 'Item Card', 'Cursed Item Card', 'Magic Card', 'Modifier Card', 'Challenge Card']
            };
            io.emit('message', `${getPlayerName(gameState, player.id)} may retrieve a card from the discard pile with Doombringer.`);
            return;
        }
        if (['WANDERING_BEHEMOTH_DRAW', 'REEF_RIPPER_DRAW'].includes(trigger.type)) {
            gameState.state = 'WAITING_FOR_MONSTER_TRIGGER_CHOICE';
            gameState.pendingAction = {
                type: 'MONSTER_OPTIONAL_DRAW', source: trigger.type === 'REEF_RIPPER_DRAW' ? 'Reef Ripper' : 'Wandering Behemoth',
                playerToChoose: player.id, originalActor: player.id, optional: true
            };
            return;
        }
        if (trigger.type === 'SAFFYRE_PHOENIX_PLAY') {
            if (!player.hand.some(card => card.type === 'Hero Card')) continue;
            gameState.state = 'WAITING_FOR_HAND_SELECTION';
            gameState.pendingAction = {
                type: 'PLAY_FROM_HAND', allowedTypes: ['Hero Card'], playerToChoose: player.id,
                originalActor: player.id, optional: true, expansionFreePlay: true,
                source: 'Saffyre Phoenix'
            };
            io.emit('message', `${getPlayerName(gameState, player.id)} may immediately play a Hero for 0 AP with Saffyre Phoenix.`);
            return;
        }
    }

    const queue = gameState.freePlayQueue;
    if (queue) {
        const player = gameState.players[queue.playerId];
        const eligible = (player?.hand || []).filter(card => queue.allowedTypes.includes(card.type)
            && (!queue.allowedCardIds || queue.allowedCardIds.includes(card.id)));
        if (queue.remaining > 0 && eligible.length > 0) {
            gameState.state = 'WAITING_FOR_HAND_SELECTION';
            gameState.pendingAction = {
                type: 'PLAY_FROM_HAND', allowedTypes: queue.allowedTypes, allowedCardIds: queue.allowedCardIds,
                playerToChoose: queue.playerId, originalActor: queue.playerId,
                optional: !queue.mandatory, expansionFreePlay: true
            };
            return;
        }
        gameState.freePlayQueue = null;
    }

    if (gameState.forcedEndTurnPlayerId === gameState.activePlayerSocketId) {
        const playerId = gameState.forcedEndTurnPlayerId;
        gameState.forcedEndTurnPlayerId = null;
        beginEndTurn(playerId);
        return;
    }
    if (gameState.pendingEndTurnEffects) {
        advanceEndTurnMonsterEffect();
    }
}

function broadcastState() {
    resumeExpansionChoices();
    if (gameState.state === 'PLAYING' && !gameState.pendingAction && !gameState.pendingCard
        && !gameState.pendingChallenge && !gameState.pendingGlobalAction) {
        const winResult = checkWinCondition();
        if (winResult) handleGameOver(winResult);
    }
    if (gameState.state === 'WAITING_FOR_CHALLENGES' && gameState.pendingChallenge) {
        ensureChallengeTimer();
    } else {
        clearChallengeTimer();
    }
    // Hide hands of other players before sending
    const stateToSend = JSON.parse(JSON.stringify(gameState)); console.log(`[DEBUG] broadcastState: playerOrder=${gameState.playerOrder.join(", ")}, players:`, Object.keys(gameState.players).map(k => `${k} has ${gameState.players[k].hand.length} cards`));
    console.log(`[DEBUG] broadcastState -> state=${gameState.state}, mainDeck=${gameState.mainDeck.length}, monsterDeck=${gameState.monsterDeck.length}, activeMonsters=${gameState.activeMonsters.length}`);
    console.log(`[DEBUG] broadcastState -> active=${gameState.activePlayerSocketId ? gameState.activePlayerSocketId.substring(0,4) : 'none'}, pendingAction=${gameState.pendingAction ? gameState.pendingAction.type : 'none'}, pendingRoll=${gameState.pendingRoll ? gameState.pendingRoll.type : 'none'}, pendingChallenge=${gameState.pendingChallenge ? 'yes' : 'no'}, pendingGlobal=${gameState.pendingGlobalAction ? gameState.pendingGlobalAction.type : 'none'}`);
    
    // We will send customized state to each player
    console.log('[DEBUG] broadcastState: Hand sizes: ' + Object.values(gameState.players).map(p => p.hand.length).join(', ')); io.sockets.sockets.forEach((socket) => {
        const playerState = JSON.parse(JSON.stringify(gameState));
        
        // Mask other players' hands
        for (const id in playerState.players) {
            if (id !== socket.id) {
                playerState.players[id].hand = playerState.players[id].hand.map(() => ({ type: 'Hidden' }));
            }
        }
        
        // The pending immediate-play card (Snowball / Mellow Dee / pulled-card
        // play) is shown in the chooser's "play it now?" modal. Only reveal it to
        // the player making the choice — others just see "waiting".
        const pendingCardForSocket = (playerState.pendingAction && playerState.pendingAction.playerToChoose === socket.id)
            ? playerState.pendingCard : null;
        let privatePendingCards = null;
        let privatePendingTargetName = null;
        if (gameState.pendingAction?.type === 'GRUESOME_GLADIATOR_HAND'
            && gameState.pendingAction.playerToChoose === socket.id) {
            const target = gameState.players[gameState.pendingAction.targetPlayerId];
            privatePendingCards = target ? JSON.parse(JSON.stringify(target.hand)) : [];
            privatePendingTargetName = target ? getPlayerName(gameState, target.id) : 'Opponent';
        }

        socket.emit('gameStateUpdate', {
            state: playerState.state,
            players: playerState.players,
            playerOrder: playerState.playerOrder,
            activePlayerSocketId: playerState.activePlayerSocketId,
            pendingAction: playerState.pendingAction,
            pendingCard: pendingCardForSocket,
            pendingRoll: playerState.pendingRoll,
            pendingChallenge: playerState.pendingChallenge,
            activeMonsters: playerState.activeMonsters,
            discardPile: playerState.discardPile,
            pendingGlobalAction: playerState.pendingGlobalAction,
            privatePendingCards,
            privatePendingTargetName,
            winner: playerState.winner,
            me: socket.id,
            availableLeaders: (gameState.availableLeaders && gameState.availableLeaders.length > 0) ? gameState.availableLeaders : PARTY_LEADERS // Send for selection
        });
    });
}

function resolvePendingCard() {
    try {
        if (!gameState.pendingChallenge) return;
        clearChallengeTimer();

        const { rollerId, card } = gameState.pendingChallenge;
        registerCardPlayed(card);
        const player = gameState.players[rollerId];

        if (card.type === 'Hero Card') {
            card.usedSkillThisTurn = false;
            player.party.push(card);
            gameState.state = 'PROMPT_SKILL_ROLL';
            io.to(rollerId).emit('heroPlayedPrompt', { cardId: card.id, cardName: card.name });
        } else if (card.type === 'Item Card' || card.type === 'Cursed Item Card') {
            const targetPlayerId = gameState.pendingChallenge.targetPlayerId || gameState.pendingChallenge.targetData?.targetPlayerId;
            const targetHeroId = gameState.pendingChallenge.targetHeroId || gameState.pendingChallenge.targetData?.targetHeroId;
            const targetPlayer = gameState.players[targetPlayerId];
            if (targetPlayer) {
                const targetHero = targetPlayer.party.find(h => h.id === targetHeroId);
                if (targetHero) {
                    const hasSecondSlot = Number(targetHero.item_slots || 1) >= 2;
                    if (!targetHero.equippedItem) {
                        targetHero.equippedItem = card;
                    } else if (hasSecondSlot && !targetHero.equippedItem2) {
                        targetHero.equippedItem2 = card;
                    } else {
                        gameState.discardPile.push(targetHero.equippedItem);
                        targetHero.equippedItem = card;
                    }
                    io.emit('message', `${getPlayerName(gameState, player.id)} equipped ${card.name} to ${targetHero.name}!`);
                } else {
                    gameState.discardPile.push(card);
                }
            } else {
                gameState.discardPile.push(card);
            }
        } else if (card.type === 'Magic Card') {
            gameState.discardPile.push(card);
            const targetData = gameState.pendingChallenge.targetData || null;
            executeMagic(gameState, io, card.effect_id, rollerId, targetData);
        }

        const winResult = checkWinCondition();
        if (winResult) {
            handleGameOver(winResult);
        } else {
            if (gameState.pendingAction) {
                // A Magic card set up a follow-up targeting action (e.g. Forced
                // Exchange / Entangling Trap / Winds of Change). Return to PLAYING
                // but keep the pendingAction — resetToPlayingState would null it.
                gameState.state = 'PLAYING';
            } else if (gameState.state !== 'WAITING_FOR_ACTION_TARGET' && gameState.state !== 'PROMPT_SKILL_ROLL') {
                resetToPlayingState();
            }
            gameState.pendingCard = null;
            gameState.challengePhase = false;
            gameState.modifierPhase = false;
        }

        gameState.pendingChallenge = null;
        broadcastState();
    } catch (error) {
        console.error(`[CRASH in resolvePendingCard]:`, error.message);
        console.error(error.stack);
        resetToPlayingState();
        broadcastState();
    }
}

function calculateRollDetails(player, baseRoll, context, targetCard = null) {
    let total = baseRoll;
    let breakdown = [{ source: 'Base Dice', value: baseRoll }];

    // 1. Check Party Leader Passives
    if (player.leader) {
        if (player.leader.effect_id === 'LEADER_BARD' && context === 'HERO_SKILL') {
            total += 1;
            breakdown.push({ source: player.leader.name, value: 1 });
        }
        if (player.leader.effect_id === 'LEADER_RANGER' && context === 'ATTACK') {
            total += 1;
            breakdown.push({ source: player.leader.name, value: 1 });
        }
        if (player.leader.effect_id === 'LEADER_FIGHTER' && context === 'CHALLENGE') {
            total += 2;
            breakdown.push({ source: player.leader.name, value: 2 });
        }
        if (player.leader.effect_id === 'LEADER_WARRIOR') {
            const equippedItemCount = (player.party || []).reduce((count, hero) => {
                const items = [hero && hero.equippedItem, hero && hero.equippedItem2].filter(Boolean);
                return count + items.filter(item => ['Item Card', 'Cursed Item Card'].includes(item.type)).length;
            }, 0);
            if (equippedItemCount > 0) {
                total += equippedItemCount;
                breakdown.push({ source: player.leader.name, value: equippedItemCount });
            }
        }
    }

    // 2. Check Slain Monsters Passives
    if (player.slainMonsters && player.slainMonsters.length > 0) {
        player.slainMonsters.forEach(monster => {
            if (monster.effect_id === 'MONSTER_ANURAN_CAULDRON') {
                total += 1;
                breakdown.push({ source: monster.name, value: 1 });
            }
            if (monster.effect_id === 'MONSTER_DARK_DRAGON_KING' && context === 'HERO_SKILL') {
                total += 1;
                breakdown.push({ source: monster.name, value: 1 });
            }
            if (monster.effect_id === 'MONSTER_TITAN_WYVERN' && context === 'CHALLENGE') {
                total += 1;
                breakdown.push({ source: monster.name, value: 1 });
            }
            if (monster.effect_id === 'MONSTER_ANCIENT_MEGASHARK' && context === 'ATTACK') {
                total += 1;
                breakdown.push({ source: monster.name, value: 1 });
            }
            if (monster.effect_id === 'MONSTER_REPTILIAN_RIPPER' && context === 'ATTACK') {
                total += 2;
                breakdown.push({ source: monster.name, value: 2 });
            }
        });
    }

    if (context === 'ATTACK' && targetCard?.attack_bonus_per_additional_hero) {
        const heroCount = (player.party || []).filter(card => card.type === 'Hero Card').length;
        const bonus = Math.max(0, heroCount - 1) * targetCard.attack_bonus_per_additional_hero;
        if (bonus > 0) {
            total += bonus;
            breakdown.push({ source: `${targetCard.name} party bonus`, value: bonus });
        }
    }

    // 3. Check Global Turn Modifiers (e.g., Enchanted Spell)
    if (player.magicRollBonus && player.magicRollBonus !== 0) {
        total += player.magicRollBonus;
        breakdown.push({ source: 'Global Magic Effects', value: player.magicRollBonus });
    }

    // 3b. Self-buff skills (Wise Shield +3, Vibrant Glow +5): "+X to all your rolls
    // until the end of your turn." Cleared in the end_turn handler. Label each by
    // its skill name when we know it, so the breakdown reads "Wise Shield +3".
    if (player.rollBonus && player.rollBonus !== 0) {
        total += player.rollBonus;
        if (Array.isArray(player.rollBonusSources) && player.rollBonusSources.length > 0) {
            player.rollBonusSources.forEach(s => breakdown.push({ source: s.source, value: s.value }));
        } else {
            breakdown.push({ source: 'Roll Buff', value: player.rollBonus });
        }
    }

    if (player.untilNextTurnRollBonus) {
        total += player.untilNextTurnRollBonus;
        breakdown.push({ source: 'Majestelk', value: player.untilNextTurnRollBonus });
    }
    if (context === 'ATTACK' && player.attackRollBonus) {
        total += player.attackRollBonus;
        breakdown.push({ source: 'Critical Fang', value: player.attackRollBonus });
    }

    // 4. Check Global Item Effects (None currently modify rolls globally)

    // 5. Check Target-Specific Equipped Items
    if (context === 'HERO_SKILL' && targetCard) {
        equippedItems(targetCard).forEach(item => {
            if (item.effect_id === 'ITEM_RING') {
                total += 2;
                breakdown.push({ source: item.name, value: 2 });
            } else if (item.effect_id === 'ITEM_EVEN_BIGGER_RING') {
                total += 4;
                breakdown.push({ source: item.name, value: 4 });
            } else if (item.effect_id === 'CURSE_SNAKE') {
                total -= 2;
                breakdown.push({ source: item.name, value: -2 });
            }
        });
    }

    return { total, breakdown };
}

function isHeroSkillRollSuccessful(hero, roll) {
    return hero?.rollType === 'LOW_ROLL'
        ? roll <= hero.roll_requirement
        : roll >= hero.roll_requirement;
}

// Count Hero cards belonging to the actor's OPPONENTS that can actually be
// destroyed (skipping players protected by Terratuga or Mighty Blade). Used to cap
// "destroy N heroes" effects (Qi Bear) so they never ask for more targets than
// exist — which previously soft-locked when the opponent had no heroes. The client
// and bot only target opponent heroes, so we count opponents only.
function countDestroyableOpponentHeroes(actorId) {
    let count = 0;
    for (const pid in gameState.players) {
        if (pid === actorId) continue;
        const p = gameState.players[pid];
        if (!p || p.cannotBeDestroyed) continue;
        const hasTerratuga = p.slainMonsters && p.slainMonsters.some(m => m.effect_id === 'MONSTER_TERRATUGA');
        if (hasTerratuga) continue;
        count += (p.party || []).filter(h => h.type === 'Hero Card').length;
    }
    return count;
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

function grantExpansionModifierDraws(pendingRoll, finalForEntry) {
    if (pendingRoll.expansionRewardsProcessed) return;
    (pendingRoll.playedExpansionModifiers || []).forEach(entry => {
        const player = gameState.players[entry.playerId];
        if (!player) return;
        let count = entry.drawCount || 0;
        if (entry.effectId === 'MOD_PLUS_4_DRAW_ABOVE_12' && finalForEntry(entry) > 12) count = 1;
        if (count > 0) {
            dealCards(count, player.id, 'Modifier effect');
            io.emit('message', `${getPlayerName(gameState, entry.playerId)} drew ${count} card${count === 1 ? '' : 's'} from a Modifier effect.`);
        }
    });
    pendingRoll.expansionRewardsProcessed = true;
}

function playerHasEffectiveClass(player, requiredClass) {
    if (!player || !requiredClass) return false;
    if (player.leader && player.leader.class === requiredClass) return true;
    return (player.party || []).some(hero => effectiveHeroClass(hero) === requiredClass);
}

function prepareMinusFourRetrievals(pendingRoll, finalForEntry) {
    if (pendingRoll.minusFourRetrievalsProcessed) return false;
    const queue = (pendingRoll.playedExpansionModifiers || [])
        .filter(entry => entry.effectId === 'MOD_MINUS_4_RETRIEVE_BELOW_2' && finalForEntry(entry) < 2)
        .map(entry => entry.playerId);
    if (queue.length === 0 || gameState.discardPile.length === 0) {
        pendingRoll.minusFourRetrievalsProcessed = true;
        gameState.discardPile.push(...(pendingRoll.heldMinusFourCards || []));
        pendingRoll.heldMinusFourCards = [];
        return false;
    }
    gameState.state = 'WAITING_FOR_MODIFIER_RETRIEVAL';
    gameState.pendingAction = {
        type: 'MODIFIER_MINUS_FOUR_RETRIEVAL',
        playerToChoose: queue[0],
        queue
    };
    io.emit('message', `${getPlayerName(gameState, queue[0])} may retrieve a card from the discard pile due to Modifier -4.`);
    broadcastState();
    return true;
}

function resolvePendingRoll() {
    if (!gameState.pendingRoll) return;
    if (modifierTimer) clearTimeout(modifierTimer);
    // Always clear pass tracking when a roll resolves (incl. the 15s-timer path,
    // which doesn't go through the all-passed branch) so the next window is clean.
    gameState.passedModifiers = [];

    // HANDLE CHALLENGE RESOLUTION FIRST (To prevent reset wipes)
    if (gameState.pendingRoll.type === 'CHALLENGE') {
        const pRoll = gameState.pendingRoll;
        const aFinal = pRoll.activeBase + (pRoll.activeModifiers || 0);
        const cFinal = pRoll.challengerBase + (pRoll.challengerModifiers || 0);
        if (prepareMinusFourRetrievals(pRoll, entry => entry.targetRoll === 'ACTIVE' ? aFinal : cFinal)) return;
        grantExpansionModifierDraws(pRoll, entry => entry.targetRoll === 'ACTIVE' ? aFinal : cFinal);
        const aName = getPlayerName(gameState, pRoll.activeId);
        const cName = getPlayerName(gameState, pRoll.challengerId);

        let outcomeMsg = `${cName} CHALLENGED! ${aName} final total ${aFinal}. ${cName} final total ${cFinal}. `;

        // House rule: ties go to the CHALLENGER. The challenge succeeds unless the
        // challenged player (the one who played the card) rolls STRICTLY higher.
        if (cFinal >= aFinal) {
            outcomeMsg += `Challenge SUCCEEDS! ${pRoll.cardInDispute.name} is discarded.`;
            gameState.discardPile.push(pRoll.cardInDispute);
            io.emit('rollResult', { message: outcomeMsg });
            resetToPlayingState();
            broadcastState();
        } else {
            outcomeMsg += `Challenge FAILS! ${pRoll.cardInDispute.name} resolves.`;
            io.emit('rollResult', { message: outcomeMsg });
            
            // Store it safely, perform a clean reset, then execute the original card.
            // Carry over ALL target fields: Items/Cursed Items store their target as
            // targetPlayerId/targetHeroId directly on pendingChallenge (not inside
            // targetData), so dropping them here made a challenged-but-surviving item
            // fail to find its hero and get discarded instead of attaching.
            const prevChallenge = gameState.pendingChallenge || {};
            const survivingChallenge = {
                rollerId: pRoll.activeId,
                card: pRoll.cardInDispute,
                targetPlayerId: prevChallenge.targetPlayerId,
                targetHeroId: prevChallenge.targetHeroId,
                targetData: prevChallenge.targetData || null
            };
            resetToPlayingState();
            gameState.pendingChallenge = survivingChallenge;
            resolvePendingCard();
        }
        return; // CRITICAL: Stop here so normal logic doesn't run!
    }

    // NORMAL SKILL/ATTACK RESOLUTION
    resetToPlayingState();
    gameState.modifierResponses.actedPlayers = [];

    const { type, rollerId, targetId, currentRoll, roll1, roll2, passiveBonus, modifierTotal } = gameState.pendingRoll;
    const player = gameState.players[rollerId];

    // passiveBonus is already baked into currentRoll when generated!
    let finalRoll = currentRoll; 
    if (prepareMinusFourRetrievals(gameState.pendingRoll, () => finalRoll)) return;
    grantExpansionModifierDraws(gameState.pendingRoll, () => finalRoll);

    if (passiveBonus !== 0 && type !== 'CHALLENGE') {
        io.emit('message', `[Passive/Magic Modifier] ${getPlayerName(gameState, player.id)} had a ${passiveBonus > 0 ? '+' : ''}${passiveBonus} passive bonus! Final roll: ${finalRoll}`);
    }

    if (type === 'HERO_SKILL') {
        const heroId = gameState.pendingRoll.targetHeroId;
        const hero = player.party.find(c => c.id === heroId);
        if (hero) {
            // Strictly enforce usage flag whether roll succeeds or fails
            hero.usedSkillThisTurn = true;
            
            if (isHeroSkillRollSuccessful(hero, finalRoll)) {
                const hasAries = player.slainMonsters && player.slainMonsters.some(m => m.effect_id === 'MONSTER_ARTIC_ARIES');
                if (hasAries) {
                    io.emit('message', `${getPlayerName(gameState, player.id)} draws a card due to Artic Aries!`);
                    dealCards(1, rollerId);
                }

                const targetingPlan = TARGETING_SKILLS.includes(hero.skill_id)
                    ? getTargetingSkillPlan(gameState, rollerId, hero.skill_id)
                    : null;
                if (TARGETING_SKILLS.includes(hero.skill_id) && !targetingPlan) {
                    io.emit('message', `${getPlayerName(gameState, player.id)} successfully rolled for ${hero.name}, but there is no legal target for its effect.`);
                    resetToPlayingState();
                    broadcastState();
                    return;
                }

                // Check for Suspiciously Shiny Coin!
                const hasShinyCoin = hero.equippedItem && hero.equippedItem.effect_id === 'CURSE_COIN_SHINY';

                if (hasShinyCoin && player.hand.length > 0) {
                    let nextAction = null;
                    if (TARGETING_SKILLS.includes(hero.skill_id)) {
                        nextAction = pendingActionForTargetingPlan(targetingPlan, rollerId, hero.skill_id, hero.id);
                    } else if (PLAYER_TARGETING_SKILLS.includes(hero.skill_id)) {
                        nextAction = {
                            type: 'SKILL_TARGET_PLAYER',
                            originalActor: rollerId,
                            skillId: hero.skill_id,
                            heroId: hero.id
                        };
                    } else if (SELF_ITEM_TARGETING_SKILLS.includes(hero.skill_id)) {
                        nextAction = {
                            type: 'SKILL_TARGET_SELF_ITEM',
                            originalActor: rollerId,
                            skillId: hero.skill_id,
                            heroId: hero.id
                        };
                    } else if (MULTI_TARGETING_SKILLS.includes(hero.skill_id)) {
                        nextAction = {
                            type: 'SKILL_TARGET_MULTI',
                            originalActor: rollerId,
                            skillId: hero.skill_id,
                            heroId: hero.id,
                            maxTargets: hero.skill_id === 'SKILL_TENACIOUS_TIMBER'
                                ? Math.max(0, (player.slainMonsters || []).length)
                                : 2
                        };
                    } else if (DISCARD_TARGETING_SKILLS.includes(hero.skill_id)) {
                        const allowedTypes = hero.skill_id === 'SKILL_RENOVERN'
                            ? ['Item Card']
                            : hero.skill_id === 'SKILL_SHAMANAGA'
                                ? ['Hero Card']
                                : null;
                        nextAction = {
                            type: 'SKILL_TARGET_DISCARD', originalActor: rollerId,
                            skillId: hero.skill_id, heroId: hero.id, allowedTypes
                        };
                    } else {
                        nextAction = {
                            type: 'EXECUTE_SKILL_IMMEDIATE',
                            rollerId: rollerId,
                            skillId: hero.skill_id,
                            heroId: hero.id
                        };
                    }

                    gameState.state = 'PLAYING';
                    gameState.pendingAction = {
                        type: 'DISCARD',
                        playerToChoose: rollerId,
                        amount: 1,
                        originalActor: rollerId,
                        nextAction: nextAction
                    };
                    
                    io.emit('message', `${getPlayerName(gameState, player.id)} successfully rolled for ${hero.name}! Suspiciously Shiny Coin forces them to discard a card first.`);
                    broadcastState();
                } else {
                    // DEFERRED TARGETING LOGIC
                    if (TARGETING_SKILLS.includes(hero.skill_id)) {
                        const nextAction = pendingActionForTargetingPlan(targetingPlan, rollerId, hero.skill_id, hero.id);
                        if (nextAction.type === 'EXECUTE_SKILL_IMMEDIATE') {
                            executeSkill(gameState, io, hero.skill_id, rollerId, hero.id, null);
                            io.emit('message', `No legal Hero could be destroyed, so that independent clause was skipped.`);
                        } else {
                            gameState.pendingAction = nextAction;
                            gameState.state = nextAction.type === 'DESTROY' ? 'PLAYING' : 'WAITING_FOR_SKILL_TARGET';
                            if (targetingPlan.skippedClause) {
                                io.emit('message', `${getPlayerName(gameState, player.id)} successfully rolled for ${hero.name}. The ${targetingPlan.skippedClause} clause has no legal target, so it is skipped; choose a target for the remaining clause.`);
                            } else {
                                io.emit('message', `${getPlayerName(gameState, player.id)} successfully rolled for ${hero.name}! Waiting for them to select a target...`);
                            }
                        }
                        broadcastState();
                    } else if (PLAYER_TARGETING_SKILLS.includes(hero.skill_id)) {
                        gameState.state = 'WAITING_FOR_SKILL_TARGET';
                        gameState.pendingAction = {
                            type: 'SKILL_TARGET_PLAYER',
                            originalActor: rollerId,
                            skillId: hero.skill_id,
                            heroId: hero.id
                        };
                        io.emit('message', `${getPlayerName(gameState, player.id)} successfully rolled for ${hero.name}! Waiting for them to select a target...`);
                        broadcastState();
                    } else if (SELF_ITEM_TARGETING_SKILLS.includes(hero.skill_id)) {
                        gameState.state = 'WAITING_FOR_SKILL_TARGET';
                        gameState.pendingAction = {
                            type: 'SKILL_TARGET_SELF_ITEM',
                            originalActor: rollerId,
                            skillId: hero.skill_id,
                            heroId: hero.id
                        };
                        io.emit('message', `${getPlayerName(gameState, player.id)} successfully rolled for ${hero.name}! Waiting for them to select an item...`);
                        broadcastState();
                    } else if (MULTI_TARGETING_SKILLS.includes(hero.skill_id)) {
                        const maxTargets = hero.skill_id === 'SKILL_TENACIOUS_TIMBER'
                            ? Math.max(0, (player.slainMonsters || []).length)
                            : 2;
                        if (maxTargets === 0) {
                            executeSkill(gameState, io, hero.skill_id, rollerId, hero.id, { targetHeroIds: [] });
                            broadcastState();
                            return;
                        }
                        gameState.state = 'WAITING_FOR_SKILL_TARGET';
                        gameState.pendingAction = {
                            type: 'SKILL_TARGET_MULTI',
                            originalActor: rollerId,
                            skillId: hero.skill_id,
                            heroId: hero.id,
                            maxTargets
                        };
                        io.emit('message', `${getPlayerName(gameState, player.id)} successfully rolled for ${hero.name}! Waiting for them to select targets...`);
                        broadcastState();
                    } else if (DISCARD_TARGETING_SKILLS.includes(hero.skill_id)) {
                        const allowedTypes = hero.skill_id === 'SKILL_RENOVERN'
                            ? ['Item Card']
                            : hero.skill_id === 'SKILL_SHAMANAGA'
                                ? ['Hero Card']
                                : null;
                        const hasEligible = gameState.discardPile.some(card => !allowedTypes || allowedTypes.includes(card.type));
                        if (!hasEligible) {
                            executeSkill(gameState, io, hero.skill_id, rollerId, heroId, null);
                            broadcastState();
                            return;
                        }
                        gameState.state = 'WAITING_FOR_SKILL_TARGET';
                        gameState.pendingAction = {
                            type: 'SKILL_TARGET_DISCARD',
                            originalActor: rollerId,
                            skillId: hero.skill_id,
                            heroId: hero.id,
                            allowedTypes
                        };
                        io.emit('message', `${getPlayerName(gameState, player.id)} successfully rolled for ${hero.name}! Waiting for them to search the discard pile...`);
                        broadcastState();
                    } else {
                        // No targeting required, execute immediately!
                        executeSkill(gameState, io, hero.skill_id, rollerId, heroId, null);
                    }
                }
            } else {
                const requirementText = hero.rollType === 'LOW_ROLL' ? `${hero.roll_requirement} or lower` : `${hero.roll_requirement} or higher`;
                io.emit('message', `${getPlayerName(gameState, player.id)}'s skill roll for ${hero.name} failed! (Needed ${requirementText}, rolled ${finalRoll})`);
                recordFailedSkillEvent(gameState, player, hero);
                
                if (refundTemporalHourglass(hero, player, gameState.pendingRoll.apSpent)) {
                    io.emit('message', `Temporal Hourglass returned the action point spent on ${hero.name}'s failed skill roll.`);
                }

                if (hasEquippedEffect(hero, 'ITEM_SILVER_LINING')) {
                    player.rollBonus = (player.rollBonus || 0) + 2;
                    (player.rollBonusSources = player.rollBonusSources || []).push({ source: 'Silver Lining', value: 2 });
                    io.emit('message', `Silver Lining gives ${getPlayerName(gameState, player.id)} +2 to every roll for the rest of the turn.`);
                }

                // Check for Particularly Rusty Coin
                if (hero.equippedItem && hero.equippedItem.effect_id === 'ITEM_COIN_RUSTY') {
                    io.emit('message', `Particularly Rusty Coin allows ${getPlayerName(gameState, player.id)} to draw a card because the roll failed!`);
                    dealCards(1, rollerId);
                }

                io.emit('rollResult', { player: rollerId, roll: finalRoll, message: "Skill Roll Failed." });

                const hasGoblet = hasEquippedEffect(hero, 'ITEM_GOBLET_CAFFEINATION');
                if (hasEquippedEffect(hero, 'CURSE_DRAGONS_BILE') && player.party.length > 0) {
                    gameState.state = 'WAITING_FOR_SACRIFICE';
                    gameState.pendingAction = {
                        type: 'DRAGONS_BILE_SACRIFICE', playerToChoose: rollerId, originalActor: rollerId,
                        failedHeroId: hero.id,
                        nextAction: hasGoblet ? { type: 'OFFER_GOBLET_REROLL', heroId: hero.id } : null
                    };
                    gameState.pendingRoll = null;
                    io.emit('message', `${getPlayerName(gameState, player.id)} must sacrifice a Hero because ${hero.name} failed while equipped with Dragon's Bile.`);
                    broadcastState();
                    return;
                }
                if (hasGoblet && queueGobletReroll(rollerId, hero.id)) {
                    gameState.pendingRoll = null;
                    broadcastState();
                    return;
                }
                resetToPlayingState();
                broadcastState();
            }
        }
    } else if (type === 'ATTACK') {
        const monsterIndex = gameState.activeMonsters.findIndex(m => m.id === targetId);
        if (monsterIndex !== -1) {
            const monster = gameState.activeMonsters[monsterIndex];
            let resultMsg = `Final roll ${finalRoll}. `;

            let isSlain = false;
            let isPenalty = false;

            if (monster.rollType === 'LOW_ROLL') {
                isSlain = finalRoll <= monster.slayRoll;
                isPenalty = finalRoll >= monster.penaltyRoll;
            } else {
                isSlain = finalRoll >= monster.slayRoll;
                isPenalty = finalRoll <= monster.penaltyRoll;
            }

            if (isSlain) {
                player.slainMonsters.push(monster);
                gameState.activeMonsters.splice(monsterIndex, 1);
                spawnMonsters();
                resultMsg += 'Monster SLAIN!';

                if (monster.effect_id === 'MONSTER_MEGA_SLIME') {
                    player.ap += 1;
                    io.emit('message', `${getPlayerName(gameState, player.id)} gained +1 AP from defeating Mega Slime!`);
                }

                if (player.leader?.effect_id === 'LEADER_BERSERKER') {
                    dealCards(2, player.id, 'The Raging Manticore');
                    io.emit('message', `${getPlayerName(gameState, player.id)} drew 2 cards from The Raging Manticore after slaying ${monster.name}.`);
                }

                // Process Reward
                if (monster.rewardAction === 'DRAW_1') {
                    dealCards(1, rollerId);
                } else if (monster.rewardAction === 'DRAW_2') {
                    dealCards(2, rollerId);
                }
                
                if (monster.rewardAction && monster.rewardAction !== 'NONE') {
                    io.emit('message', `${getPlayerName(gameState, player.id)} slew ${monster.name} and triggered reward: ${monster.rewardAction}`);
                }
            } else if (isPenalty) {
                const penaltyAction = monster.penaltyAction || 'DISCARD_1';
                
                if (penaltyAction === 'DISCARD_HAND') {
                    const count = player.hand.length;
                    gameState.discardPile.push(...player.hand.splice(0));
                    resultMsg += `Suffer penalty! Discarded the entire hand (${count} card${count === 1 ? '' : 's'}).`;
                } else if (penaltyAction === 'SACRIFICE_2_HEROES') {
                    const count = Math.min(2, player.party.filter(card => card.type === 'Hero Card').length);
                    if (count > 0) {
                        gameState.state = 'WAITING_FOR_GLOBAL_ACTION';
                        gameState.pendingGlobalAction = {
                            type: 'SEQUENTIAL_PARTY_SACRIFICE', initiatorId: rollerId,
                            pendingPlayerIds: [rollerId],
                            remainingPlayerIds: Array(Math.max(0, count - 1)).fill(rollerId),
                            allowedTarget: 'HERO_ONLY', afterResolution: null
                        };
                        io.emit('global_action_requested', gameState.pendingGlobalAction);
                        resultMsg += `Suffer penalty! Sacrifice ${count} Hero${count === 1 ? '' : 'es'} one at a time.`;
                        io.emit('rollResult', { player: rollerId, roll: finalRoll, message: resultMsg });
                        gameState.pendingRoll = null;
                        broadcastState();
                        return;
                    }
                    resultMsg += 'No Heroes to sacrifice!';
                } else if (penaltyAction === 'SACRIFICE_HERO') {
                    if (player.party.length > 0) {
                        gameState.state = 'WAITING_FOR_SACRIFICE';
                        gameState.pendingAction = {
                            type: 'PENALTY',
                            amount: 1,
                            playerToChoose: rollerId
                        };
                        resultMsg += 'Suffer penalty! Select a Hero to sacrifice.';
                        io.emit('rollResult', { player: rollerId, roll: finalRoll, message: resultMsg });
                        gameState.pendingRoll = null;
                        broadcastState();
                        return; // Return early to prevent state reset
                    } else {
                        resultMsg += 'No heroes to sacrifice!';
                    }
                } else if (penaltyAction.startsWith('DISCARD_')) {
                    const amount = parseInt(penaltyAction.split('_')[1]) || 1;
                    if (player.hand.length > 0) {
                        gameState.state = 'WAITING_FOR_DISCARD_PENALTY';
                        gameState.pendingAction = {
                            type: 'PENALTY',
                            amount: Math.min(amount, player.hand.length),
                            playerToChoose: rollerId
                        };
                        resultMsg += `Suffer penalty! Discard ${amount} card(s).`;
                        io.emit('rollResult', { player: rollerId, roll: finalRoll, message: resultMsg });
                        gameState.pendingRoll = null;
                        broadcastState();
                        return; // Return early to prevent state reset
                    } else {
                        resultMsg += 'No cards in hand to discard!';
                    }
                } else {
                    resultMsg += 'Suffer penalty! (Unhandled action)';
                }
            } else {
                resultMsg += 'Nothing happens.';
            }

            io.emit('rollResult', { player: rollerId, roll: finalRoll, message: resultMsg });
            
            const winResult = checkWinCondition();
            if (winResult) {
                handleGameOver(winResult);
                // Return early so we don't set state back to PLAYING
                gameState.pendingRoll = null;
                broadcastState();
                return;
            }
        }
    }

    // STATE RESET ENFORCEMENT
    if (gameState.state !== 'DISCARD' && !gameState.state.startsWith('WAITING_FOR_') && gameState.state !== 'GAMEOVER' && !gameState.pendingAction) {
        resetToPlayingState();
    }
    gameState.pendingRoll = null;
    gameState.waitingForInput = false;
    broadcastState();
}

function isValidItemEquipTarget(state, targetPlayerId, targetHeroId) {
    const targetPlayer = state.players && state.players[targetPlayerId];
    return Boolean(targetPlayer && (targetPlayer.party || []).some(hero => hero.id === targetHeroId));
}

// Apply the pre-reconnect disconnect fallback. Mid-match this deliberately
// keeps the remaining sockets in the lobby, but clears every per-match field and
// every board/pending-action field so a fresh match cannot inherit stale cards.
function removePlayerAndResetMatch(socketId) {
    if (!gameState.players[socketId]) return;
    const name = getPlayerName(gameState, socketId);

    delete gameState.players[socketId];
    gameState.playerOrder = gameState.playerOrder.filter(id => id !== socketId);

    const clearBoard = () => {
        clearRexMajorChoices(gameState);
        gameState.activePlayerSocketId = null;
        gameState.pendingAction = null;
        gameState.pendingCard = null;
        gameState.pendingRoll = null;
        gameState.pendingChallenge = null;
        gameState.pendingGlobalAction = null;
        gameState.winner = null;
        gameState.discardPile = [];
        gameState.activeMonsters = [];
        gameState.mainDeck = [];
        gameState.monsterDeck = [];
        gameState.availableLeaders = [...PARTY_LEADERS];
        debugForcedRoll = null;
        if (modifierTimer) { clearTimeout(modifierTimer); modifierTimer = null; }
        clearChallengeTimer();
    };

    if (gameState.playerOrder.length === 0) {
        gameState.state = 'LOBBY';
        gameState.players = {};
        clearBoard();
        broadcastState();
        return;
    }

    if (gameState.state !== 'LOBBY') {
        clearBoard();
        gameState.state = 'LOBBY';
        Object.values(gameState.players).forEach(player => {
            player.hand = [];
            player.party = [];
            player.slainMonsters = [];
            player.leader = null;
            player.ap = 0;
            player.hasSelectedLeader = false;
            player.hasRerolledLeader = false;
        });
        io.emit('message', `${name} did not reconnect in time. Returning to lobby.`);
        broadcastState();
        return;
    }

    io.emit('message', `${name} left the lobby.`);
    broadcastState();
}

const reconnectManager = createReconnectManager({
    gameState,
    graceMs: RECONNECT_GRACE_MS,
    onPlayerExpired: removePlayerAndResetMatch,
    onPlayerAway: player => {
        io.emit('message', `${getPlayerName(gameState, player.id)} is away. Waiting up to ${RECONNECT_GRACE_MS / 1000} seconds for them to reconnect.`);
        if (!settleUnchallengedCardIfComplete()) broadcastState();
    },
    onPlayerRestored: player => {
        io.emit('message', `${getPlayerName(gameState, player.id)} reconnected.`);
        broadcastState();
    },
});

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    const requestedSessionToken = socket.handshake.auth && socket.handshake.auth.sessionToken;
    const restoredSession = reconnectManager.restore(socket.id, requestedSessionToken);

    // Force send lobby data upon connection
    socket.emit('lobby_data_update', {
        leaders: PARTY_LEADERS,
        state: gameState.state
    });

    if (restoredSession) {
        socket.emit('session_token', requestedSessionToken.trim());
    } else if (gameState.state === 'LOBBY' && gameState.playerOrder.length < 6) {
        gameState.players[socket.id] = {
            id: socket.id,
            name: '',
            hand: [],
            party: [],
            slainMonsters: [],
            leader: null,
            ap: 0,
            connected: true,
            away: false,
            disconnectedAt: null,
            hasSelectedLeader: false,
            hasRerolledLeader: false
        };
        gameState.playerOrder.push(socket.id);
        const sessionToken = reconnectManager.register(socket.id, requestedSessionToken);
        socket.emit('session_token', sessionToken);
    } else {
        // Observers not fully supported, but let them connect
        socket.emit('message', 'Game is full or already in progress.');
    }

    // Emergency Reset sync if connection happens in LOBBY state
    if (gameState.state === 'LOBBY') {
        socket.emit('lobby_data', {
            availableLeaders: (gameState.availableLeaders && gameState.availableLeaders.length > 0) ? gameState.availableLeaders : PARTY_LEADERS,
            playerOrder: gameState.playerOrder,
            players: gameState.players
        });
    }

    broadcastState();

/* --- CORE ACTIONS --- */
    socket.on('request_lobby_data', () => {
        if (gameState.state === 'LOBBY') {
            
            if (PARTY_LEADERS.length === 0) {
                
                loadCards(); console.log(`[DEBUG] After loadCards, mainDeck size: ${gameState.mainDeck.length}`);
            }
            socket.emit('lobby_data', {
                availableLeaders: (gameState.availableLeaders && gameState.availableLeaders.length > 0) ? gameState.availableLeaders : PARTY_LEADERS,
                playerOrder: gameState.playerOrder,
                players: gameState.players
            });
        }
    });
    socket.on('set_player_name', (name) => {
        if (gameState.players[socket.id]) {
            gameState.players[socket.id].name = name || 'Player'; // Save as .name, do NOT overwrite .id
            broadcastState();
        }
    });

    socket.on('resolve_rex_major_choice', ({ choiceId, reveal } = {}, acknowledgement) => {
        const result = resolveRexMajorChoice(gameState, io, socket.id, choiceId, reveal === true);
        if (result.revealed) broadcastState();
        if (typeof acknowledgement === 'function') acknowledgement({ ok: result.ok, revealed: Boolean(result.revealed) });
    });

    // The browser UI has no leave button today; this event exists so controlled
    // clients/test harnesses can explicitly abandon a seat without waiting out
    // the reconnect grace timer.
    socket.on('leave_game', acknowledgement => {
        reconnectManager.leaveNow(socket.id);
        if (typeof acknowledgement === 'function') acknowledgement();
        socket.disconnect(true);
    });

    socket.on('roll_leader', () => {
        if (gameState.state !== 'LOBBY') return;
        const player = gameState.players[socket.id];
        if (!player || player.hasSelectedLeader || player.leader) return;

        if (!gameState.availableLeaders || gameState.availableLeaders.length === 0) {
            const assignedLeaders = Object.values(gameState.players).map(p => p.leader?.id).filter(id => id);
            gameState.availableLeaders = PARTY_LEADERS.filter(l => !assignedLeaders.includes(l.id));
        }

        if (gameState.availableLeaders.length > 0) {
            const randomIndex = Math.floor(Math.random() * gameState.availableLeaders.length);
            const chosenLeader = gameState.availableLeaders.splice(randomIndex, 1)[0];
            player.leader = chosenLeader;
            player.hasSelectedLeader = true;
            broadcastState();
        }
    });

    socket.on('reroll_leader', () => {
        if (gameState.state !== 'LOBBY') return;
        const player = gameState.players[socket.id];
        if (!player || !player.leader || player.hasRerolledLeader) return;

        const oldLeader = player.leader;
        const assignedToOthers = new Set(Object.entries(gameState.players)
            .filter(([playerId]) => playerId !== socket.id)
            .map(([, otherPlayer]) => otherPlayer.leader?.id)
            .filter(Boolean));
        const eligibleLeaders = (gameState.availableLeaders || []).filter(leader =>
            leader.id !== oldLeader.id && !assignedToOthers.has(leader.id)
        );

        // A reroll always draws from the leaders that were still available before
        // this player returned their current leader. This prevents rolling the
        // same leader again and can never take another player's chosen leader.
        if (eligibleLeaders.length === 0) return;

        const chosenLeader = eligibleLeaders[Math.floor(Math.random() * eligibleLeaders.length)];
        const chosenIndex = gameState.availableLeaders.findIndex(leader => leader.id === chosenLeader.id);
        if (chosenIndex === -1) return;

        gameState.availableLeaders.splice(chosenIndex, 1);
        if (!gameState.availableLeaders.some(leader => leader.id === oldLeader.id)) {
            gameState.availableLeaders.push(oldLeader);
        }
        player.leader = chosenLeader;
        player.hasRerolledLeader = true;
        broadcastState();
    });

    socket.on('lock_in_leader', () => {
        if (gameState.state !== 'LOBBY') return;
        const player = gameState.players[socket.id];
        if (player && player.leader && !player.hasSelectedLeader) {
            player.hasSelectedLeader = true;
            broadcastState();
        }
    });

    socket.on('start_game', () => {
        if (gameState.state !== 'LOBBY') return;
        if (socket.id !== gameState.playerOrder[0]) return; // Only host can start
        
        const allSelected = gameState.playerOrder.every(id => gameState.players[id].hasSelectedLeader);
        if (!allSelected) return;

        startGame();
        broadcastState();
    });

    socket.on('start_game_debug', () => { startGame(); broadcastState(); });

    socket.on('debug_inject_card', ({ cardId }) => {
        const card = ALL_CARDS.find(c => c.id === cardId);
        if (card && gameState.players[socket.id]) {
            gameState.players[socket.id].hand.push({ ...card });
            broadcastState();
        }
    });

    // Test-only: give the caller a slain Monster (its passive) without having to
    // attack/slay it — lets e2e tests exercise MONSTER_* passives directly.
    socket.on('debug_add_slain_monster', ({ cardId }) => {
        const card = ALL_CARDS.find(c => c.id === cardId);
        if (card && gameState.players[socket.id]) {
            gameState.players[socket.id].slainMonsters.push({ ...card });
            broadcastState();
        }
    });

    socket.on('debug_add_to_discard', ({ cardId }) => {
        const card = ALL_CARDS.find(c => c.id === cardId);
        if (card) { gameState.discardPile.push({ ...card }); broadcastState(); }
    });

    // Test-only: place a card on TOP of the main deck (the next card drawn). Lets
    // e2e tests control a "draw the top card" effect like Snowball deterministically.
    socket.on('debug_stack_deck', ({ cardId }) => {
        const card = ALL_CARDS.find(c => c.id === cardId);
        if (card) {
            // Preserve the real-deck invariant that every card id occurs once.
            // Otherwise a stacked duplicate makes id-based chooser validation
            // ambiguous and can cause Bullseye to show more than three cards.
            gameState.mainDeck = gameState.mainDeck.filter(deckCard => deckCard.id !== cardId);
            gameState.mainDeck.push({ ...card });
            broadcastState();
        }
    });

    // Test-only: place a hero directly into the caller's party regardless of whose
    // turn it is. Lets e2e tests give an opponent a valid target for destroy/steal
    // skills (playCard is turn-gated, so it can't be used out of turn).
    socket.on('debug_inject_to_party', ({ cardId }) => {
        const card = ALL_CARDS.find(c => c.id === cardId);
        if (card && gameState.players[socket.id]) {
            gameState.players[socket.id].party.push({ ...card, usedSkillThisTurn: false });
            broadcastState();
        }
    });

    // Test-only: equip an Item onto a Hero already in the caller's party. Defaults
    // to the last hero in the party when heroId is omitted. Used by e2e specs that
    // need a pre-equipped hero (e.g. Shurikitty taking the destroyed hero's Item).
    socket.on('debug_equip_item', ({ heroId, itemId } = {}) => {
        const player = gameState.players[socket.id];
        const item = ALL_CARDS.find(c => c.id === itemId);
        if (!player || !item) return;
        const hero = heroId
            ? player.party.find(h => h.id === heroId)
            : player.party[player.party.length - 1];
        if (hero) {
            hero.equippedItem = { ...item };
            broadcastState();
        }
    });

    // Test-only: replace the caller's hand with the given card ids (in order), so
    // e2e specs can make random pulls / peeks / trades deterministic by controlling
    // exactly what an opponent (or the caller) is holding.
    socket.on('debug_set_hand', ({ cardIds } = {}) => {
        const player = gameState.players[socket.id];
        if (!player || !Array.isArray(cardIds)) return;
        player.hand = cardIds
            .map(id => { const c = ALL_CARDS.find(x => x.id === id); return c ? { ...c } : null; })
            .filter(Boolean);
        broadcastState();
    });

    // Test-only: force the next skill/attack roll to specific dice (defaults to
    // 6+6=12) so effect-asserting e2e tests don't depend on random roll success.
    socket.on('debug_force_next_roll', ({ roll1 = 6, roll2 = 6 } = {}) => {
        debugForcedRoll = { roll1, roll2 };
    });

    socket.on('request_game_reset', () => {
        // Only allow reset if the game is over
        if (gameState.state !== 'GAMEOVER') return;
        resetGameForNextMatch();
    });

    socket.on('host_reset_game', (ack) => {
        const hostId = gameState.playerOrder[0];
        if (!hostId || socket.id !== hostId) {
            if (typeof ack === 'function') ack({ ok: false, error: 'Only the host can reset the game.' });
            return;
        }
        const hostName = getPlayerName(gameState, socket.id);
        io.emit('message', `${hostName} reset the game and returned everyone to the lobby.`);
        resetGameForNextMatch();
        if (typeof ack === 'function') ack({ ok: true });
    });

    socket.on('play_item_action', (data) => {
        if (gameState.state !== 'PLAYING') return;
        if (socket.id !== gameState.activePlayerSocketId) return;

        const player = gameState.players[socket.id];
        const isFree = data.isFree === true;
        if (!isFree && player.ap < 1) return; // Costs 1 AP

        const { itemCardId, targetPlayerId, targetHeroId } = data;
        
        const cardIndex = player.hand.findIndex(c => c.id === itemCardId);
        if (cardIndex === -1) return;

        const card = player.hand[cardIndex];
        if (card.type !== 'Item Card' && card.type !== 'Cursed Item Card') return;
        if (!isValidItemEquipTarget(gameState, targetPlayerId, targetHeroId)) {
            io.to(socket.id).emit('message', 'Select a valid Hero to equip this Item.');
            return;
        }

        if (!isFree) player.ap -= 1;
        player.hand.splice(cardIndex, 1);
        triggerPlayedCardMonsterPassives(socket.id, card);
        
        const hasOwlbear = player.slainMonsters && player.slainMonsters.some(m => m.effect_id === 'MONSTER_WARWORN_OWLBEAR');
        // Owlbear skips challenges for items; Iron Resolve skips challenges for any
        // card this player plays this turn.
        if (hasOwlbear || player.cannotBeChallenged) {
            if (player.cannotBeChallenged && !hasOwlbear) {
                io.emit('message', `${getPlayerName(gameState, socket.id)}'s ${card.name} cannot be challenged (Iron Resolve)!`);
            }
            gameState.pendingChallenge = {
                rollerId: socket.id,
                card: card,
                targetPlayerId: targetPlayerId,
                targetHeroId: targetHeroId
            };
            resolvePendingCard();
        } else {
            gameState.state = 'WAITING_FOR_CHALLENGES';
            gameState.pendingChallenge = {
                rollerId: socket.id,
                card: card,
                targetPlayerId: targetPlayerId,
                targetHeroId: targetHeroId,
                passedPlayers: []
            };

            io.emit('challenge_pending', {
                rollerId: socket.id,
                rollerName: `${getPlayerName(gameState, socket.id)}`,
                card: card
            });

            broadcastState();
        }
    });

/* --- CARD PLAYING --- */
    socket.on('playCard', (data) => {
        try {
            if (gameState.state !== 'PLAYING') return;
            if (socket.id !== gameState.activePlayerSocketId) return;

            let cardId = data;
            let isFree = false;
            let targetData = null;
            if (typeof data === 'object') {
                cardId = data.cardId;
                isFree = data.isFree === true;
                targetData = data.targetData;
            }

            const player = gameState.players[socket.id];
            const cardIndex = player.hand.findIndex(c => c.id === cardId);
            if (cardIndex === -1) return;

            const card = player.hand[cardIndex];
            if (card.freePlay === true) isFree = true;
            if (!isFree && player.ap < 1) return; // Costs 1 AP

            // Block plays whose entire payoff is impossible, so the player doesn't
            // waste AP + cards on a no-op. Entangling Trap's payoff is the steal —
            // if no opponent has a stealable Hero, refuse the play (nothing is spent).
            if (card.effect_id === 'MAGIC_ENTANGLING' && !hasStealOrDestroyTarget(socket.id, 'STEAL')) {
                io.to(socket.id).emit('message', "No Heroes to steal — you can't play Entangling Trap right now.");
                return;
            }
            // Forced Exchange: steal an opponent's Hero AND give one of yours. Needs
            // BOTH a stealable opponent Hero and a Hero of your own to give, or the
            // exchange can't complete (and would soft-lock at the steal/give step).
            if (card.effect_id === 'MAGIC_EXCHANGE') {
                const hasOwnHero = player.party.some(h => h.type === 'Hero Card');
                if (!hasStealOrDestroyTarget(socket.id, 'STEAL') || !hasOwnHero) {
                    io.to(socket.id).emit('message', "Forced Exchange needs an opponent's Hero to steal and one of your own Heroes to give.");
                    return;
                }
            }
            // Winds of Change returns an equipped Item to your hand — if no Hero
            // anywhere has an Item equipped, there's nothing to return (it would
            // soft-lock on the item-select step).
            if (card.effect_id === 'MAGIC_WINDS_CHANGE') {
                const anyEquipped = Object.values(gameState.players).some(p => (p.party || []).some(h => h.equippedItem));
                if (!anyEquipped) {
                    io.to(socket.id).emit('message', "No equipped Items anywhere — you can't play Winds of Change right now.");
                    return;
                }
            }
            // Destructive Spell: "DISCARD a card, THEN DESTROY a Hero." If there's
            // no Hero to destroy, the payoff is impossible — block so the discard
            // isn't wasted (and the empty-hand path can't soft-lock on DESTROY).
            if (card.effect_id === 'MAGIC_DESTRUCTIVE' && !hasStealOrDestroyTarget(socket.id, 'DESTROY')) {
                io.to(socket.id).emit('message', "No Heroes to destroy — you can't play Destructive Spell right now.");
                return;
            }

            if (card.freePlay === true) delete card.freePlay;

            // Clear stale pending cards to prevent locks
            if (gameState.state === 'PLAYING' && gameState.pendingCard) {
                gameState.pendingCard = null;
            }

            if (card.type === 'Hero Card' || card.type === 'Magic Card') {
                if (!isFree) player.ap -= 1;
                player.hand.splice(cardIndex, 1);
                triggerPlayedCardMonsterPassives(socket.id, card);
                
                // Wizard passive check
                if (card.type === 'Magic Card' && player.leader && player.leader.effect_id === 'LEADER_WIZARD') {
                    dealCards(1, socket.id);
                    io.emit('message', "The Cloaked Sage (Wizard) grants a free drawn card for playing Magic!");
                }
                
                gameState.pendingChallenge = {
                    rollerId: socket.id,
                    card: card,
                    targetData: targetData,
                    passedPlayers: []
                };

                // Iron Resolve: cards this player plays cannot be challenged this
                // turn — skip the challenge phase and resolve immediately.
                if (player.cannotBeChallenged) {
                    io.emit('message', `${getPlayerName(gameState, socket.id)}'s ${card.name} cannot be challenged (Iron Resolve)!`);
                    resolvePendingCard();
                } else {
                    gameState.state = 'WAITING_FOR_CHALLENGES';
                    io.emit('challenge_pending', {
                        rollerId: socket.id,
                        rollerName: getPlayerName(gameState, socket.id),
                        card: card
                    });
                    broadcastState();
                }
            }
        } catch (error) {
            console.error("[CRASH in playCard]:", error);
            resetToPlayingState();
            broadcastState();
        }
    });

    socket.on('decline_hero_skill', () => {
        if (gameState.state === 'PROMPT_SKILL_ROLL' && socket.id === gameState.activePlayerSocketId) {
            resetToPlayingState();
            broadcastState();
        }
    });

    socket.on('use_hero_skill', ({ cardId, isFree, targetPlayerId, targetHeroId, targetCardId, targetHeroIds }) => {
        if (gameState.state !== 'PLAYING' && gameState.state !== 'PROMPT_SKILL_ROLL') {
            return;
        }
        if (socket.id !== gameState.activePlayerSocketId) {
            return;
        }

        const player = gameState.players[socket.id];
        
        const hero = player.party.find(c => c.id === cardId);
        if (!hero) {
            return;
        }
        if (hero.usedSkillThisTurn && !hasEquippedEffect(hero, 'ITEM_BOTTOMLESS_BAG')) {
            return;
        }
        // Sealing Key (CURSE_KEY): the equipped Hero cannot use its effect at all.
        const sealingKey = equippedItems(hero).find(item => item.effect_id === 'CURSE_KEY');
        if (sealingKey) {
            io.to(socket.id).emit('message', `${hero.name} is sealed by ${sealingKey.name} and cannot use its effect!`);
            return;
        }

        if (!isFree) {
            const skillCost = hasEquippedEffect(hero, 'CURSE_SOULBOUND_GRIMOIRE') ? 2 : 1;
            if (player.ap < skillCost) {
                return;
            }
            player.ap -= skillCost;
        }

        // Delay setting usedSkillThisTurn to true until the skill actually resolves

        gameState.state = 'WAITING_TO_ROLL';
        gameState.pendingRoll = {
            type: 'HERO_SKILL',
            rollerId: socket.id,
            targetHeroId: hero.id,
            skillTargetPlayerId: targetPlayerId,
            skillTargetHeroId: targetHeroId,
            skillTargetCardId: targetCardId,
            skillTargetHeroIds: targetHeroIds,
            roll1: 0,
            roll2: 0,
            passiveBonus: 0,
            modifierTotal: 0,
            baseRoll: 0,
            currentRoll: 0,
            passedPlayers: [],
            apSpent: isFree ? 0 : (hasEquippedEffect(hero, 'CURSE_SOULBOUND_GRIMOIRE') ? 2 : 1)
        };

        broadcastState();
    });

    socket.on('submit_skill_target', (targetData) => {
        if (gameState.state !== 'WAITING_FOR_SKILL_TARGET') return;
        if (socket.id !== gameState.activePlayerSocketId) return;
        if (!gameState.pendingAction) return;

        if (gameState.pendingAction.type === 'LIGHTNING_LABRYS_PLAYER') {
            if (socket.id !== gameState.pendingAction.playerToChoose) return;
            const targetPlayerId = targetData?.targetPlayerId;
            const result = queueLightningLabrysSacrifice(gameState, targetPlayerId);
            if (!result) return;
            if (result === 'NO_HERO') {
                io.emit('message', `${getPlayerName(gameState, targetPlayerId)} has no Hero to sacrifice for Lightning Labrys.`);
            } else {
                io.emit('message', `${getPlayerName(gameState, targetPlayerId)} must choose a Hero to sacrifice for Lightning Labrys.`);
            }
            broadcastState();
            return;
        }

        if (gameState.pendingAction.type === 'END_CLAWED_NIGHTMARE_PLAYER') {
            const targetId = targetData?.targetPlayerId;
            const target = gameState.players[targetId];
            const actor = gameState.players[socket.id];
            if (!target || targetId === socket.id || target.connected === false || target.hand.length === 0) return;
            let pulled = 0;
            while (pulled < 2 && target.hand.length > 0) {
                const index = Math.floor(Math.random() * target.hand.length);
                actor.hand.push(target.hand.splice(index, 1)[0]);
                pulled += 1;
            }
            io.emit('message', `${getPlayerName(gameState, socket.id)} pulled ${pulled} card${pulled === 1 ? '' : 's'} from ${getPlayerName(gameState, targetId)} with Clawed Nightmare.`);
            resetToPlayingState();
            advanceEndTurnMonsterEffect();
            broadcastState();
            return;
        }

        if (gameState.pendingAction.skillId === 'SKILL_BOSTON_TERROR_RETRIEVE') {
            const action = gameState.pendingAction;
            if (socket.id !== action.playerToChoose) return;
            const cardIndex = gameState.discardPile.findIndex(card => card.id === targetData?.targetCardId
                && action.allowedTypes.includes(card.type));
            if (cardIndex === -1) return;
            const card = gameState.discardPile.splice(cardIndex, 1)[0];
            gameState.players[socket.id].hand.push(card);
            action.remaining -= 1;
            io.emit('message', `${getPlayerName(gameState, socket.id)} retrieved ${card.name} with Boston Terror.`);
            if (action.remaining <= 0 || gameState.discardPile.length === 0) resetToPlayingState();
            broadcastState();
            return;
        }

        if (gameState.pendingAction.skillId === 'MONSTER_DOOMBRINGER_RETRIEVE') {
            const action = gameState.pendingAction;
            if (socket.id !== action.playerToChoose) return;
            const cardIndex = gameState.discardPile.findIndex(card => card.id === targetData?.targetCardId
                && action.allowedTypes.includes(card.type));
            if (cardIndex === -1) return;
            const card = gameState.discardPile.splice(cardIndex, 1)[0];
            gameState.players[socket.id].hand.push(card);
            io.emit('message', `${getPlayerName(gameState, socket.id)} retrieved ${card.name} with Doombringer.`);
            resetToPlayingState();
            broadcastState();
            return;
        }

        // Player declined / had no valid target (e.g. Bun Bun with no Magic card in
        // the discard pile). Abort the deferred skill: clear the pending action and
        // return to PLAYING so the turn isn't soft-locked. The roll already happened
        // and the hero is spent — the skill simply produces no effect.
        if (targetData && targetData.cancel) {
            io.emit('message', `${getPlayerName(gameState, socket.id)} found no valid target and cancelled the skill.`);
            resetToPlayingState();
            broadcastState();
            return;
        }

        const rollerId = gameState.pendingAction.originalActor;
        const skillId = gameState.pendingAction.skillId;
        const heroId = gameState.pendingAction.heroId;
        if (gameState.pendingAction.type === 'SKILL_TARGET_DISCARD' && targetData?.targetCardId) {
            const selected = gameState.discardPile.find(card => card.id === targetData.targetCardId);
            const allowedTypes = gameState.pendingAction.allowedTypes;
            if (!selected || (allowedTypes && !allowedTypes.includes(selected.type))) return;
        }

        // Reset state
        resetToPlayingState();
        executeSkill(gameState, io, skillId, rollerId, heroId, targetData);
        broadcastState();
    });

    socket.on('select_peek_card', ({ cardId, skillId }) => {
        if (gameState.state !== 'PLAYING') return;
        const player = gameState.players[socket.id];
        if (!player) return;

        if (skillId === 'SKILL_BUCK_OMENS') {
            const peek = gameState.pendingPeek;
            const target = peek?.targetPlayerId && gameState.players[peek.targetPlayerId];
            if (!peek || peek.skillId !== skillId || peek.rollerId !== socket.id || !peek.allowedCardIds?.includes(cardId) || !target) return;
            const index = target.hand.findIndex(card => card.id === cardId && card.type === 'Hero Card');
            if (index === -1) return;
            const hero = target.hand.splice(index, 1)[0];
            hero.usedSkillThisTurn = false;
            player.party.push(hero);
            gameState.pendingPeek = null;
            io.emit('message', `${getPlayerName(gameState, player.id)} brought ${hero.name} directly into their party with Buck Omens.`);
            broadcastState();
            return;
        }

        // Verify the user was peeking from BULLSEYE (top 3 cards)
        if (skillId === 'SKILL_BULLSEYE') {
            const peek = gameState.pendingPeek;
            if (!peek || peek.skillId !== 'SKILL_BULLSEYE' || peek.rollerId !== socket.id) return;
            if (!peek.allowedCardIds?.includes(cardId)) return;

            if (peek.stage === 'CHOOSE_CARD') {
                const cardIndex = gameState.mainDeck.findIndex(c => c.id === cardId);
                if (cardIndex === -1) return;
                const chosenCard = gameState.mainDeck.splice(cardIndex, 1)[0];
                player.hand.push(chosenCard);
                const remainingCards = gameState.mainDeck
                    .filter(card => peek.allowedCardIds.includes(card.id));

                if (remainingCards.length > 1) {
                    gameState.pendingPeek = {
                        rollerId: socket.id,
                        skillId: 'SKILL_BULLSEYE',
                        stage: 'CHOOSE_TOP_CARD',
                        allowedCardIds: remainingCards.map(card => card.id)
                    };
                    io.emit('message', `${getPlayerName(gameState, player.id)} selected a card with Bullseye and is ordering the remaining cards.`);
                    // Broadcast the updated hand first. Rendering that state may
                    // close transient overlays; emit the private second step after
                    // it so the ordering chooser remains on top.
                    broadcastState();
                    io.to(socket.id).emit('peek_cards', {
                        cards: remainingCards,
                        skillId: 'SKILL_BULLSEYE',
                        title: 'Order the Remaining Cards',
                        subtitle: 'Choose which card goes directly on top of the deck.',
                        actionLabel: 'Put On Top'
                    });
                    return;
                } else {
                    gameState.pendingPeek = null;
                    io.emit('message', `${getPlayerName(gameState, player.id)} selected a card from the deck using Bullseye's skill.`);
                }
                broadcastState();
            } else if (peek.stage === 'CHOOSE_TOP_CARD') {
                const remainingCards = peek.allowedCardIds
                    .map(id => gameState.mainDeck.find(card => card.id === id))
                    .filter(Boolean);
                const topCard = remainingCards.find(card => card.id === cardId);
                const belowCard = remainingCards.find(card => card.id !== cardId);
                if (!topCard || !belowCard) return;

                gameState.mainDeck = gameState.mainDeck
                    .filter(card => !peek.allowedCardIds.includes(card.id));
                gameState.mainDeck.push(belowCard, topCard);
                gameState.pendingPeek = null;
                io.emit('message', `${getPlayerName(gameState, player.id)} finished ordering the deck with Bullseye.`);
                broadcastState();
            }
        } else if (skillId === 'SKILL_SILENT_SHADOW') {
            // Silent Shadow: take the chosen card from the exact player whose hand
            // was revealed. Validate the pending peek belongs to this roller.
            const peek = gameState.pendingPeek;
            if (!peek || peek.skillId !== 'SKILL_SILENT_SHADOW' || peek.rollerId !== socket.id) return;
            const tp = gameState.players[peek.targetPlayerId];
            gameState.pendingPeek = null;
            if (!tp) return;
            const cardIndex = tp.hand.findIndex(c => c.id === cardId);
            if (cardIndex !== -1) {
                const chosen = tp.hand.splice(cardIndex, 1)[0];
                player.hand.push(chosen);
                io.emit('message', `${getPlayerName(gameState, player.id)} took a card from ${getPlayerName(gameState, tp.id)}'s hand using Silent Shadow!`);
                broadcastState();
            }
        } else if (skillId === 'SKILL_HOLLOW_HUSK') {
            const peek = gameState.pendingPeek;
            if (!peek || peek.skillId !== 'SKILL_HOLLOW_HUSK' || peek.rollerId !== socket.id
                || !peek.allowedCardIds?.includes(cardId)) return;
            const tp = gameState.players[peek.targetPlayerId];
            gameState.pendingPeek = null;
            if (!tp) return;
            const cardIndex = tp.hand.findIndex(card => card.id === cardId && card.type === 'Magic Card');
            if (cardIndex === -1) return;
            const magic = tp.hand.splice(cardIndex, 1)[0];
            player.hand.push(magic);
            gameState.state = 'WAITING_FOR_HAND_SELECTION';
            gameState.pendingAction = {
                type: 'PLAY_FROM_HAND', allowedTypes: ['Magic Card'], allowedCardIds: [magic.id],
                playerToChoose: socket.id, originalActor: socket.id, optional: true, expansionFreePlay: true
            };
            io.emit('message', `${getPlayerName(gameState, player.id)} took a Magic card with Hollow Husk and may play it immediately.`);
            broadcastState();
        } else if (skillId === 'SKILL_SLIPPERY_PAWS') {
            // Slippery Paws: discard one of the two cards just pulled (now in the
            // roller's own hand). Validate the choice is one of those pulled cards.
            const peek = gameState.pendingPeek;
            if (!peek || peek.skillId !== 'SKILL_SLIPPERY_PAWS' || peek.rollerId !== socket.id) return;
            if (!peek.allowedCardIds || !peek.allowedCardIds.includes(cardId)) return;
            gameState.pendingPeek = null;
            const cardIndex = player.hand.findIndex(c => c.id === cardId);
            if (cardIndex !== -1) {
                const discarded = player.hand.splice(cardIndex, 1)[0];
                gameState.discardPile.push(discarded);
                io.emit('message', `${getPlayerName(gameState, player.id)} discarded ${discarded.name} (Slippery Paws).`);
                broadcastState();
            }
        }
    });

    socket.on('select_gruesome_gladiator_card', ({ cardId } = {}) => {
        const action = gameState.pendingAction;
        if (gameState.state !== 'WAITING_FOR_SKILL_TARGET' || action?.type !== 'GRUESOME_GLADIATOR_HAND'
            || action.playerToChoose !== socket.id || socket.id !== gameState.activePlayerSocketId) return;
        const actor = gameState.players[socket.id];
        const target = gameState.players[action.targetPlayerId];
        if (!actor || !target) return;
        const cardIndex = target.hand.findIndex(card => card.id === cardId);
        if (cardIndex === -1) return;
        const card = target.hand.splice(cardIndex, 1)[0];
        actor.hand.push(card);
        io.emit('message', `${getPlayerName(gameState, actor.id)} took one card from ${getPlayerName(gameState, target.id)} with Gruesome Gladiator.`);

        let nextId = action.remainingPlayerIds.shift();
        while (nextId && !gameState.players[nextId]?.hand?.length) nextId = action.remainingPlayerIds.shift();
        if (nextId) {
            action.targetPlayerId = nextId;
        } else {
            resetToPlayingState();
        }
        broadcastState();
    });

    socket.on('submit_global_action', (data) => {
        if (!gameState.pendingGlobalAction) return;
        const ga = gameState.pendingGlobalAction;
        const player = gameState.players[socket.id];
        
        if (!ga.pendingPlayerIds.includes(socket.id)) return;

        if (ga.type === 'VARIABLE_PARTY_SACRIFICE') {
            if (data.done === true) {
                if (ga.sacrificedCount > 0 && hasDestroyableOpponentPartyCard(ga.initiatorId)) {
                    ga.type = 'SEQUENTIAL_PARTY_DESTROY';
                    ga.pendingPlayerIds = [ga.initiatorId];
                    ga.remainingDestroys = ga.sacrificedCount;
                    io.emit('global_action_requested', ga);
                } else {
                    gameState.pendingGlobalAction = null;
                    resetToPlayingState();
                    io.emit('message', ga.sacrificedCount > 0
                        ? `Rabid Beast found no opponent Party card to destroy.`
                        : `${getPlayerName(gameState, ga.initiatorId)} chose not to sacrifice any cards with Rabid Beast.`);
                }
            } else {
                const result = sacrificePartyCard(player, data.targetPartyCardId);
                if (!result) return;
                if (result.didSacrifice) ga.sacrificedCount += 1;
                io.emit('message', `${getPlayerName(gameState, player.id)} sacrificed ${result.card.name} with Rabid Beast (${ga.sacrificedCount} total).`);
            }
            broadcastState();
            return;
        }

        if (ga.type === 'SEQUENTIAL_PARTY_DESTROY') {
            const result = destroyOpponentPartyCard(ga.initiatorId, data.targetPartyCardId);
            if (!result || result.kind === 'PROTECTED') return;
            ga.remainingDestroys -= 1;
            io.emit('message', result.didDestroy
                ? `${getPlayerName(gameState, ga.initiatorId)} destroyed ${result.card.name} with Rabid Beast.`
                : `${result.card.name} avoided destruction through ${result.kind === 'DECOY' ? 'Decoy Doll' : 'Maegisty'}.`);
            if (ga.remainingDestroys <= 0 || !hasDestroyableOpponentPartyCard(ga.initiatorId)) {
                gameState.pendingGlobalAction = null;
                resetToPlayingState();
            }
            broadcastState();
            return;
        }

        if (ga.type === 'BOSTON_TERROR_GIVE') {
            const initiator = gameState.players[ga.initiatorId];
            if (!initiator) return;
            if (data.decline === true || player.hand.length === 0) {
                io.emit('message', `${getPlayerName(gameState, player.id)} declined to give a card for Boston Terror.`);
                queueBostonTerrorRetrieval(ga.initiatorId);
            } else {
                const cardIndex = player.hand.findIndex(card => card.id === data.cardId);
                if (cardIndex === -1) return;
                const card = player.hand.splice(cardIndex, 1)[0];
                initiator.hand.push(card);
                gameState.pendingGlobalAction = null;
                resetToPlayingState();
                io.emit('message', `${getPlayerName(gameState, player.id)} gave a card to ${getPlayerName(gameState, initiator.id)} for Boston Terror.`);
            }
            broadcastState();
            return;
        }

        if (ga.type === 'SEQUENTIAL_PARTY_SACRIFICE') {
            const result = sacrificePartyCard(player, data.targetPartyCardId, ga.allowedTarget);
            if (!result) return;
            if (result.kind === 'DECOY') {
                io.emit('message', `${getPlayerName(gameState, player.id)} sacrificed Decoy Doll instead of ${result.card.name}.`);
            } else if (result.kind === 'RETURNED') {
                io.emit('message', `${result.card.name} returned to ${getPlayerName(gameState, player.id)}'s hand due to Maegisty.`);
            } else {
                io.emit('message', `${getPlayerName(gameState, player.id)} sacrificed ${result.card.name}.`);
            }
            const hasChoice = playerId => {
                const target = gameState.players[playerId];
                if (!target) return false;
                if (ga.allowedTarget === 'HERO_ONLY') return target.party.some(card => card.type === 'Hero Card');
                if (ga.allowedTarget === 'ITEM_ONLY') return target.party.some(hero => equippedItems(hero).length > 0);
                return target.party.some(hero => hero.type === 'Hero Card' || equippedItems(hero).length > 0);
            };
            let nextId = ga.remainingPlayerIds.shift();
            while (nextId && !hasChoice(nextId)) nextId = ga.remainingPlayerIds.shift();
            if (nextId) {
                ga.pendingPlayerIds = [nextId];
                io.emit('global_action_requested', ga);
            } else {
                finishSequentialGlobalAction(ga);
            }
            broadcastState();
            return;
        }

        if (ga.type === 'SEQUENTIAL_DISCARD') {
            const cardIndex = player.hand.findIndex(card => card.id === data.cardId);
            if (cardIndex === -1) return;
            const card = player.hand.splice(cardIndex, 1)[0];
            gameState.discardPile.push(card);
            ga.remainingForCurrent -= 1;
            io.emit('message', `${getPlayerName(gameState, player.id)} discarded a card.`);

            if (ga.remainingForCurrent <= 0 || player.hand.length === 0) {
                let nextId = ga.remainingPlayerIds.shift();
                while (nextId && !gameState.players[nextId]?.hand?.length) nextId = ga.remainingPlayerIds.shift();
                if (nextId) {
                    ga.pendingPlayerIds = [nextId];
                    ga.remainingForCurrent = Math.min(ga.amount, gameState.players[nextId].hand.length);
                    io.emit('global_action_requested', ga);
                } else {
                    finishSequentialGlobalAction(ga);
                }
            }
            broadcastState();
            return;
        }

        if (ga.type === 'MULTI_SACRIFICE') {
            const heroIndex = player.party.findIndex(h => h.id === data.targetHeroId);
            if (heroIndex === -1) return; // not a hero this player owns — ignore
            const sacrificed = player.party[heroIndex];
            const decoy = equippedItems(sacrificed).find(item => item.effect_id === 'ITEM_DECOY');
            if (consumeDecoyDoll(sacrificed, 'SACRIFICE')) {
                if (decoy) recordSacrificeEvent(gameState, player, decoy, { isHero: false });
                io.emit('message', `${getPlayerName(gameState, player.id)} discarded Decoy Doll instead of sacrificing ${sacrificed.name}.`);
            } else {
                player.party.splice(heroIndex, 1);
                const removedItems = ['equippedItem', 'equippedItem2']
                    .filter(slot => sacrificed[slot])
                    .map(slot => ({ slot, card: sacrificed[slot] }));
                removedItems.forEach(entry => gameState.discardPile.push(entry.card));
                sacrificed.equippedItem = null;
                sacrificed.equippedItem2 = null;
                gameState.discardPile.push(sacrificed);
                recordSacrificeEvent(gameState, player, sacrificed, { isHero: true, removedItems });
                io.emit('message', `${getPlayerName(gameState, player.id)} sacrificed a Hero.`);
            }
            ga.pendingPlayerIds = ga.pendingPlayerIds.filter(id => id !== socket.id);
        } else {
            // Card-based global actions: MULTI_DISCARD, MULTI_DISCARD_AND_CHOOSE, MULTI_GIVE.
            const cardIndex = player.hand.findIndex(c => c.id === data.cardId);
            if (cardIndex === -1) return; // card not in hand — ignore, keep them pending
            const card = player.hand.splice(cardIndex, 1)[0];
            ga.pendingPlayerIds = ga.pendingPlayerIds.filter(id => id !== socket.id);

            if (ga.type === 'MULTI_GIVE') {
                // Greedy Cheeks: the card goes straight to the initiator's hand.
                gameState.players[ga.initiatorId].hand.push(card);
                io.emit('message', `${getPlayerName(gameState, player.id)} gave a card to ${getPlayerName(gameState, ga.initiatorId)}.`);
            } else if (ga.type === 'MULTI_DISCARD') {
                // Tough Teddy etc.: a plain forced discard, no one takes it.
                gameState.discardPile.push(card);
                io.emit('message', `${getPlayerName(gameState, player.id)} discarded a card.`);
            } else {
                // MULTI_DISCARD_AND_CHOOSE (Beary Wise): pool it for the initiator to pick from.
                ga.submittedCards.push(card);
                io.emit('message', `${getPlayerName(gameState, player.id)} discarded into the pool.`);
            }
        }

        // Everyone has acted — settle the action.
        if (ga.pendingPlayerIds.length === 0) {
            if (ga.type === 'MULTI_DISCARD_AND_CHOOSE' && ga.submittedCards.length > 0) {
                // Beary Wise: the initiator now picks one card from the pool. Stay in
                // WAITING_FOR_GLOBAL_ACTION and flag awaitingChoice so the pick UI is
                // reconstructable from broadcastState — a dropped one-shot or a refresh
                // must not soft-lock the game.
                ga.awaitingChoice = true;
                io.to(ga.initiatorId).emit('global_action_resolution', { type: ga.type, submittedCards: ga.submittedCards });
                io.emit('message', `All cards collected. Waiting for ${getPlayerName(gameState, ga.initiatorId)} to choose a card.`);
            } else {
                // MULTI_DISCARD / MULTI_GIVE / MULTI_SACRIFICE (and AND_CHOOSE with an
                // empty pool) need no choice — return straight to play.
                resetToPlayingState();
                gameState.pendingGlobalAction = null;
                io.emit('message', `Global action resolved.`);
            }
        }

        broadcastState();
    });

    socket.on('resolve_global_action', ({ cardId }) => {
        if (!gameState.pendingGlobalAction) return;
        const ga = gameState.pendingGlobalAction;
        const player = gameState.players[socket.id];
        
        // Only the Beary-Wise choose step accepts a pick, and only from the initiator.
        if (ga.type === 'MULTI_DISCARD_AND_CHOOSE' && ga.awaitingChoice && socket.id === ga.initiatorId && player) {
            const cardIndex = ga.submittedCards.findIndex(c => c.id === cardId);
            if (cardIndex !== -1) {
                const chosen = ga.submittedCards.splice(cardIndex, 1)[0];
                player.hand.push(chosen);

                // Discard the rest
                ga.submittedCards.forEach(c => gameState.discardPile.push(c));

                io.emit('message', `${getPlayerName(gameState, player.id)} chose ${chosen.name} from the discards!`);
                resetToPlayingState();
                gameState.pendingGlobalAction = null;
                broadcastState();
            }
        }
    });

    socket.on('attackMonster', (monsterId) => {
        if (gameState.state !== 'PLAYING') return;
        if (socket.id !== gameState.activePlayerSocketId) return;

        const player = gameState.players[socket.id];
        if (player.ap < 2) return; // Costs 2 AP to attack

        const monsterIndex = gameState.activeMonsters.findIndex(m => m.id === monsterId);
        if (monsterIndex === -1) return;

        const monster = gameState.activeMonsters[monsterIndex];
        
        if (!meetsMonsterRequirements(player, monster.requirement)) return socket.emit('error', 'Requirements not met');
        
        const cost = monster.attack_cost;
        if (cost?.count > 0) {
            const allowedTypes = attackCostAllowedTypes(cost);
            if (!canPayMonsterAttackCost(player, monster)) {
                io.to(socket.id).emit('message', `You need ${cost.count} ${cost.discard === 'ANY' ? '' : cost.discard + ' '}card${cost.count === 1 ? '' : 's'} to attack ${monster.name}.`);
                return;
            }
            gameState.pendingAction = {
                type: 'DISCARD', playerToChoose: socket.id, originalActor: socket.id,
                amount: cost.count, allowedTypes,
                nextAction: { type: 'START_MONSTER_ATTACK', monsterId: monster.id, playerId: socket.id }
            };
            io.emit('message', `${getPlayerName(gameState, socket.id)} must pay ${monster.name}'s discard cost before rolling.`);
            broadcastState();
            return;
        }

        startMonsterAttackRoll(socket.id, monster.id);

        broadcastState();
    });

    socket.on('execute_roll', () => {
        // RESTORE THE ORIGINAL WORKING LOGIC FOR SKILLS/ATTACKS
        if (gameState.state === 'WAITING_TO_ROLL') {
            if (!gameState.pendingRoll || socket.id !== gameState.pendingRoll.rollerId) return;
            const player = gameState.players[socket.id];
            const type = gameState.pendingRoll.type;
            
            let targetCard = null;
            if (type === 'HERO_SKILL') targetCard = player.party.find(h => h.id === gameState.pendingRoll.targetHeroId);
            if (type === 'ATTACK') targetCard = gameState.activeMonsters.find(monster => monster.id === gameState.pendingRoll.targetId);

            let roll1, roll2;
            if (debugForcedRoll) {
                roll1 = debugForcedRoll.roll1;
                roll2 = debugForcedRoll.roll2;
                debugForcedRoll = null;
            } else {
                roll1 = Math.floor(Math.random() * 6) + 1;
                roll2 = Math.floor(Math.random() * 6) + 1;
            }
            const baseRoll = roll1 + roll2;
            const rollDetails = calculateRollDetails(player, baseRoll, type, targetCard);
            if (gameState.pendingRoll.mirroryuBonus) {
                rollDetails.total += gameState.pendingRoll.mirroryuBonus;
                rollDetails.breakdown.push({ source: 'Mirroryu', value: gameState.pendingRoll.mirroryuBonus });
            }
            
            gameState.state = 'WAITING_FOR_MODIFIERS';
            gameState.modifierResponses.actedPlayers = [];
            gameState.modifierResponses.totalPlayers = gameState.playerOrder.length;
            // Reset pass tracking for THIS roll's window. Without this, a stale pass
            // left over from a prior roll (e.g. one that resolved on the 15s timer)
            // carries over, so the window can resolve before the roller even sees
            // the modifier prompt. The challenge-roll path already does this.
            gameState.passedModifiers = [];
            
            gameState.pendingRoll.roll1 = roll1;
            gameState.pendingRoll.roll2 = roll2;
            gameState.pendingRoll.passiveBonus = rollDetails.total - baseRoll;
            gameState.pendingRoll.baseRoll = rollDetails.total;
            gameState.pendingRoll.currentRoll = rollDetails.total;
            gameState.pendingRoll.breakdown = rollDetails.breakdown;

            io.emit('dice_roll_pending', {
                rollerId: socket.id,
                rollerName: getPlayerName(gameState, socket.id),
                roll1, roll2,
                passiveBonus: gameState.pendingRoll.passiveBonus,
                breakdown: rollDetails.breakdown,
                modifierTotal: 0,
                finalTotal: rollDetails.total,
                reason: type === 'ATTACK' ? 'to attack a monster' : 'for a skill'
            });
            queueFearlessFlameChoices([{ playerId: socket.id, rollSide: 'ROLL' }]);
            broadcastState();
        } 
        // NEW LOGIC FOR DUAL CHALLENGE ROLLS
        else if (gameState.state === 'WAITING_TO_ROLL_CHALLENGE') {
            const pRoll = gameState.pendingRoll;
            let rolled = false;
            
            if (socket.id === pRoll.activeId && !pRoll.activeRolled) {
                pRoll.activeRoll1 = Math.floor(Math.random() * 6) + 1;
                pRoll.activeRoll2 = Math.floor(Math.random() * 6) + 1;
                pRoll.activeBase = pRoll.activeRoll1 + pRoll.activeRoll2;
                pRoll.activeBreakdown = [{ source: 'Base Dice', value: pRoll.activeBase }];
                const p = gameState.players[pRoll.activeId];
                if (p && p.leader && p.leader.effect_id === 'LEADER_FIGHTER') {
                    pRoll.activeBase += 2;
                    pRoll.activeBreakdown.push({ source: p.leader.name, value: 2 });
                }
                if (p && p.slainMonsters && p.slainMonsters.some(m => m.effect_id === 'MONSTER_TITAN_WYVERN')) {
                    pRoll.activeBase += 1;
                    pRoll.activeBreakdown.push({ source: 'Titan Wyvern', value: 1 });
                }
                pRoll.activeRolled = true;
                rolled = true;
            } else if (socket.id === pRoll.challengerId && !pRoll.challengerRolled) {
                pRoll.challengerRoll1 = Math.floor(Math.random() * 6) + 1;
                pRoll.challengerRoll2 = Math.floor(Math.random() * 6) + 1;
                pRoll.challengerBase = pRoll.challengerRoll1 + pRoll.challengerRoll2;
                pRoll.challengerBreakdown = [{ source: 'Base Dice', value: pRoll.challengerBase }];
                const p = gameState.players[pRoll.challengerId];
                if (p && p.leader && p.leader.effect_id === 'LEADER_FIGHTER') {
                    pRoll.challengerBase += 2;
                    pRoll.challengerBreakdown.push({ source: p.leader.name, value: 2 });
                }
                if (p && p.slainMonsters && p.slainMonsters.some(m => m.effect_id === 'MONSTER_TITAN_WYVERN')) {
                    pRoll.challengerBase += 1;
                    pRoll.challengerBreakdown.push({ source: 'Titan Wyvern', value: 1 });
                }
                if (pRoll.challengerCardBonus) {
                    pRoll.challengerBase += pRoll.challengerCardBonus;
                    pRoll.challengerBreakdown.push({ source: pRoll.challengerCardName, value: pRoll.challengerCardBonus });
                }
                pRoll.challengerRolled = true;
                rolled = true;
            }

            if (rolled && pRoll.activeRolled && pRoll.challengerRolled) {
                gameState.state = 'WAITING_FOR_MODIFIERS';
                gameState.passedModifiers = [];
                io.emit('dice_roll_pending', {
                    isChallenge: true, type: 'CHALLENGE',
                    activeId: pRoll.activeId, activeName: getPlayerName(gameState, pRoll.activeId),
                    activeRoll1: pRoll.activeRoll1, activeRoll2: pRoll.activeRoll2, activeBreakdown: pRoll.activeBreakdown,
                    activeTotal: pRoll.activeBase, activeModifierTotal: 0, activeFinalTotal: pRoll.activeBase,
                    challengerId: pRoll.challengerId, challengerName: getPlayerName(gameState, pRoll.challengerId),
                    challengerRoll1: pRoll.challengerRoll1, challengerRoll2: pRoll.challengerRoll2, challengerBreakdown: pRoll.challengerBreakdown,
                    challengerTotal: pRoll.challengerBase, challengerModifierTotal: 0, challengerFinalTotal: pRoll.challengerBase,
                    reason: 'for a CHALLENGE!'
                });
                queueFearlessFlameChoices([
                    { playerId: pRoll.activeId, rollSide: 'ACTIVE' },
                    { playerId: pRoll.challengerId, rollSide: 'CHALLENGER' }
                ]);
            }
            broadcastState();
        }
    });

/* --- MODIFIER / DICE PHASE --- */
    function completeDiscardCostModifier({ playerId, cardId, modValue, targetRoll }) {
        const player = gameState.players[playerId];
        const index = player?.hand?.findIndex(card => card.id === cardId && card.type === 'Modifier Card') ?? -1;
        if (index === -1 || !gameState.pendingRoll) return false;
        const card = player.hand[index];
        const allowed = Array.isArray(card.modifier_values) ? card.modifier_values : [];
        if (!allowed.includes(modValue)) return false;
        if (gameState.pendingRoll.type === 'CHALLENGE' && !['ACTIVE', 'CHALLENGER'].includes(targetRoll)) return false;
        let appliedValue = modValue;
        if (player.leader?.effect_id === 'LEADER_GUARDIAN') appliedValue += appliedValue > 0 ? 1 : -1;
        player.hand.splice(index, 1);
        gameState.discardPile.push(card);
        registerCardPlayed(card);
        triggerCrownedSerpent(gameState, io);
        if (gameState.pendingRoll.type === 'CHALLENGE') {
            if (targetRoll === 'ACTIVE') gameState.pendingRoll.activeModifiers = (gameState.pendingRoll.activeModifiers || 0) + appliedValue;
            else gameState.pendingRoll.challengerModifiers = (gameState.pendingRoll.challengerModifiers || 0) + appliedValue;
            const roll = gameState.pendingRoll;
            io.emit('dice_roll_pending', {
                isChallenge: true, type: 'CHALLENGE',
                activeId: roll.activeId, activeName: getPlayerName(gameState, roll.activeId),
                activeRoll1: roll.activeRoll1, activeRoll2: roll.activeRoll2, activeBreakdown: roll.activeBreakdown,
                activeTotal: roll.activeBase, activeModifierTotal: roll.activeModifiers,
                activeFinalTotal: roll.activeBase + (roll.activeModifiers || 0),
                challengerId: roll.challengerId, challengerName: getPlayerName(gameState, roll.challengerId),
                challengerRoll1: roll.challengerRoll1, challengerRoll2: roll.challengerRoll2, challengerBreakdown: roll.challengerBreakdown,
                challengerTotal: roll.challengerBase, challengerModifierTotal: roll.challengerModifiers,
                challengerFinalTotal: roll.challengerBase + (roll.challengerModifiers || 0), reason: 'for a CHALLENGE!'
            });
        } else {
            gameState.pendingRoll.modifierTotal = (gameState.pendingRoll.modifierTotal || 0) + appliedValue;
            gameState.pendingRoll.currentRoll += appliedValue;
            const rollingPlayerId = gameState.pendingRoll.rollerId;
            const rollingPlayer = gameState.players[rollingPlayerId];
            if (playerId !== rollingPlayerId && appliedValue < 0
                && rollingPlayer?.slainMonsters?.some(monster => monster.effect_id === 'MONSTER_ABYSS_QUEEN')) {
                gameState.pendingRoll.currentRoll += 1;
                gameState.pendingRoll.modifierTotal += 1;
                io.emit('message', `Abyss Queen grants +1 to ${getPlayerName(gameState, rollingPlayerId)}'s roll against the opponent's modifier!`);
            }
            const roll = gameState.pendingRoll;
            io.emit('dice_roll_pending', {
                rollerId: roll.rollerId, rollerName: getPlayerName(gameState, roll.rollerId),
                roll1: roll.roll1, roll2: roll.roll2, passiveBonus: roll.passiveBonus,
                breakdown: roll.breakdown, modifierTotal: roll.modifierTotal,
                finalTotal: roll.currentRoll, total: roll.currentRoll,
                reason: roll.type === 'ATTACK' ? 'to attack a monster' : 'for a skill'
            });
        }
        gameState.passedModifiers = [];
        gameState.pendingAction = null;
        gameState.state = 'WAITING_FOR_MODIFIERS';
        startModifierTimer();
        io.emit('message', `${getPlayerName(gameState, playerId)} discarded a card to play ${card.name} for ${appliedValue >= 0 ? '+' : ''}${appliedValue}.`);
        return true;
    }

    socket.on('submit_minus_four_retrieval', ({ cardId } = {}) => {
        const action = gameState.pendingAction;
        if (gameState.state !== 'WAITING_FOR_MODIFIER_RETRIEVAL' || !action
            || action.type !== 'MODIFIER_MINUS_FOUR_RETRIEVAL' || action.playerToChoose !== socket.id) return;
        const cardIndex = gameState.discardPile.findIndex(card => card.id === cardId);
        if (cardIndex === -1) return;
        const [card] = gameState.discardPile.splice(cardIndex, 1);
        gameState.players[socket.id].hand.push(card);
        io.emit('message', `${getPlayerName(gameState, socket.id)} retrieved ${card.name} with Modifier -4.`);

        action.queue.shift();
        if (action.queue.length > 0 && gameState.discardPile.length > 0) {
            action.playerToChoose = action.queue[0];
            io.emit('message', `${getPlayerName(gameState, action.playerToChoose)} may now retrieve a card with Modifier -4.`);
            broadcastState();
            return;
        }

        gameState.pendingRoll.minusFourRetrievalsProcessed = true;
        gameState.discardPile.push(...(gameState.pendingRoll.heldMinusFourCards || []));
        gameState.pendingRoll.heldMinusFourCards = [];
        gameState.pendingAction = null;
        gameState.state = 'WAITING_FOR_MODIFIERS';
        resolvePendingRoll();
    });

    socket.on('use_noble_shaman', (data = {}) => {
        if (gameState.state !== 'WAITING_FOR_MODIFIERS' || !gameState.pendingRoll) return;
        const player = gameState.players[socket.id];
        if (!player || !player.leader || player.leader.effect_id !== 'LEADER_DRUID' || player.usedNobleShamanThisTurn) return;

        if (gameState.pendingRoll.type === 'CHALLENGE') {
            if (!['ACTIVE', 'CHALLENGER'].includes(data.targetRoll)) return;
            if (data.targetRoll === 'ACTIVE') gameState.pendingRoll.activeModifiers = (gameState.pendingRoll.activeModifiers || 0) - 1;
            else gameState.pendingRoll.challengerModifiers = (gameState.pendingRoll.challengerModifiers || 0) - 1;
        } else {
            gameState.pendingRoll.modifierTotal = (gameState.pendingRoll.modifierTotal || 0) - 1;
            gameState.pendingRoll.currentRoll -= 1;
        }
        player.usedNobleShamanThisTurn = true;
        gameState.passedModifiers = [];
        io.emit('message', `${getPlayerName(gameState, socket.id)} used The Noble Shaman to give -1 to a roll.`);
        if (gameState.pendingRoll.type === 'CHALLENGE') {
            const roll = gameState.pendingRoll;
            io.emit('dice_roll_pending', {
                isChallenge: true, type: 'CHALLENGE',
                activeId: roll.activeId, activeName: getPlayerName(gameState, roll.activeId),
                activeRoll1: roll.activeRoll1, activeRoll2: roll.activeRoll2, activeBreakdown: roll.activeBreakdown,
                activeTotal: roll.activeBase, activeModifierTotal: roll.activeModifiers,
                activeFinalTotal: roll.activeBase + (roll.activeModifiers || 0),
                challengerId: roll.challengerId, challengerName: getPlayerName(gameState, roll.challengerId),
                challengerRoll1: roll.challengerRoll1, challengerRoll2: roll.challengerRoll2, challengerBreakdown: roll.challengerBreakdown,
                challengerTotal: roll.challengerBase, challengerModifierTotal: roll.challengerModifiers,
                challengerFinalTotal: roll.challengerBase + (roll.challengerModifiers || 0),
                reason: 'for a CHALLENGE!'
            });
        } else {
            const roll = gameState.pendingRoll;
            io.emit('dice_roll_pending', {
                rollerId: roll.rollerId, rollerName: getPlayerName(gameState, roll.rollerId),
                roll1: roll.roll1, roll2: roll.roll2, passiveBonus: roll.passiveBonus,
                breakdown: roll.breakdown, modifierTotal: roll.modifierTotal,
                finalTotal: roll.currentRoll, total: roll.currentRoll,
                reason: roll.type === 'ATTACK' ? 'to attack a monster' : 'for a skill'
            });
        }
        startModifierTimer();
        broadcastState();
    });

    socket.on('use_biggest_ring_ever', () => {
        const roll = gameState.pendingRoll;
        if (gameState.state !== 'WAITING_FOR_MODIFIERS' || !roll || roll.type !== 'HERO_SKILL'
            || roll.rollerId !== socket.id || roll.biggestRingUsed
            || (gameState.passedModifiers || []).includes(socket.id)) return;
        const player = gameState.players[socket.id];
        const hero = player?.party?.find(card => card.id === roll.targetHeroId);
        if (!hero || !hasEquippedEffect(hero, 'ITEM_BIGGEST_RING')) return;
        roll.biggestRingUsed = true;
        if (modifierTimer) clearTimeout(modifierTimer);
        gameState.state = 'WAITING_FOR_VARIABLE_DISCARD';
        gameState.pendingAction = {
            type: 'BIGGEST_RING_DISCARD', playerToChoose: socket.id, originalActor: socket.id,
            maxAmount: Math.min(3, player.hand.length), optional: true
        };
        io.emit('message', `${getPlayerName(gameState, socket.id)} may discard up to 3 cards for Biggest Ring Ever.`);
        broadcastState();
    });

    socket.on('submit_modifier_action', (data, acknowledgement) => {
        const reply = payload => {
            if (typeof acknowledgement === 'function') acknowledgement(payload);
        };
        if (gameState.state !== 'WAITING_FOR_MODIFIERS') {
            reply({ ok: false, reason: 'Modifier phase is no longer active.' });
            return;
        }
        if (!gameState.pendingRoll || !gameState.players[socket.id]) {
            reply({ ok: false, reason: 'Player or roll is unavailable.' });
            return;
        }

        const activeTurnPlayer = gameState.players[gameState.activePlayerSocketId];
        if (data.action === 'PLAY' && activeTurnPlayer?.stagguardActive && socket.id !== gameState.activePlayerSocketId) {
            reply({ ok: false, reason: 'Stagguard prevents other players from playing Modifiers this turn.' });
            return;
        }
        if (data.action === 'PLAY' && activeTurnPlayer?.blocksOpponentModifiersThisTurn
            && socket.id !== gameState.activePlayerSocketId) {
            reply({ ok: false, reason: 'Shadow Saint prevents other players from playing Modifiers this turn.' });
            return;
        }

        // Ensure the array exists
        if (!gameState.passedModifiers) gameState.passedModifiers = [];

        // 2. Process the modifier if they played one
        if (data.action === 'PLAY') {
            const player = gameState.players[socket.id];
            const cardId = data.cardId;
            const cardIndex = player.hand.findIndex(c => c.id === cardId);
            if (cardIndex !== -1) {
                const card = player.hand[cardIndex];
                if (card.type === 'Modifier Card') {

                // The player explicitly chooses which value to apply (a "+1/-3" card
                // can be played as +1 OR -3, on any roll — even a minus on your own).
                // Validate the chosen value against the card's allowed values; fall
                // back to the sole value for single-value cards (+4 / -4).
                let allowed = gameState.pendingRoll.type === 'ATTACK' && Array.isArray(card.attack_modifier_values)
                    ? card.attack_modifier_values
                    : (Array.isArray(card.modifier_values) ? card.modifier_values : []);
                if (allowed.length === 0) {
                    const match = card.name.match(/([+-]?\d+)/g);
                    if (match) allowed = match.map(Number);
                }
                let modValue;
                if (typeof data.modValue === 'number' && allowed.includes(data.modValue)) {
                    modValue = data.modValue;
                } else if (allowed.length === 1) {
                    modValue = allowed[0];
                } else {
                    // No valid choice supplied — refuse rather than guess a sign.
                    return;
                }

                if (card.discard_on_play) {
                    if (player.hand.length < 2) {
                        reply({ ok: false, reason: `${card.name} requires another card to discard.` });
                        return;
                    }
                    if (gameState.pendingRoll.type === 'CHALLENGE' && !['ACTIVE', 'CHALLENGER'].includes(data.targetRoll)) return;
                    if (modifierTimer) clearTimeout(modifierTimer);
                    gameState.state = 'WAITING_FOR_DISCARD_PENALTY';
                    gameState.pendingAction = {
                        type: 'MODIFIER_DISCARD_COST', playerToChoose: socket.id,
                        originalActor: socket.id, amount: 1, excludeCardId: card.id,
                        nextAction: {
                            type: 'COMPLETE_DISCARD_COST_MODIFIER', playerId: socket.id,
                            cardId: card.id, modValue, targetRoll: data.targetRoll || null
                        }
                    };
                    io.emit('message', `${getPlayerName(gameState, socket.id)} must discard a card to play ${card.name}.`);
                    broadcastState();
                    return;
                }

                registerCardPlayed(card);
                if (player.leader && player.leader.effect_id === 'LEADER_GUARDIAN') {
                    if (modValue > 0) modValue += 1; else if (modValue < 0) modValue -= 1;
                }
                player.hand.splice(cardIndex, 1);
                if (card.discard_hand_on_play) {
                    gameState.discardPile.push(...player.hand.splice(0));
                    io.emit('message', `${getPlayerName(gameState, socket.id)} discarded their hand to play ${card.name}.`);
                }
                if (card.effect_id === 'MOD_MINUS_4_RETRIEVE_BELOW_2') {
                    if (!gameState.pendingRoll.heldMinusFourCards) gameState.pendingRoll.heldMinusFourCards = [];
                    gameState.pendingRoll.heldMinusFourCards.push(card);
                } else {
                    gameState.discardPile.push(card);
                }

                if (!gameState.pendingRoll.playedExpansionModifiers) gameState.pendingRoll.playedExpansionModifiers = [];
                if (['MOD_1_1_DRAW_2', 'MOD_2_1_DRAW_1', 'MOD_PLUS_4_DRAW_ABOVE_12', 'MOD_MINUS_4_RETRIEVE_BELOW_2'].includes(card.effect_id)) {
                    gameState.pendingRoll.playedExpansionModifiers.push({
                        playerId: socket.id,
                        effectId: card.effect_id,
                        drawCount: card.draw_after_resolution || 0,
                        targetRoll: data.targetRoll || null
                    });
                }

                // Crowned Serpent: every owner draws a card each time ANY player
                // plays a Modifier (auto — it's a pure benefit). Includes the player
                // who just played it ("including you").
                triggerCrownedSerpent(gameState, io);

                if (gameState.pendingRoll.type === 'CHALLENGE') {
                    if (data.targetRoll === 'ACTIVE') gameState.pendingRoll.activeModifiers = (gameState.pendingRoll.activeModifiers || 0) + modValue;
                    else gameState.pendingRoll.challengerModifiers = (gameState.pendingRoll.challengerModifiers || 0) + modValue;
                    
                    const aFinal = gameState.pendingRoll.activeBase + (gameState.pendingRoll.activeModifiers || 0);
                    const cFinal = gameState.pendingRoll.challengerBase + (gameState.pendingRoll.challengerModifiers || 0);
                    
                    io.emit('dice_roll_pending', {
                        isChallenge: true, type: 'CHALLENGE',
                        activeId: gameState.pendingRoll.activeId, activeName: getPlayerName(gameState, gameState.pendingRoll.activeId),
                        activeRoll1: gameState.pendingRoll.activeRoll1, activeRoll2: gameState.pendingRoll.activeRoll2, activeBreakdown: gameState.pendingRoll.activeBreakdown,
                        activeTotal: gameState.pendingRoll.activeBase, activeModifierTotal: gameState.pendingRoll.activeModifiers, activeFinalTotal: aFinal,
                        challengerId: gameState.pendingRoll.challengerId, challengerName: getPlayerName(gameState, gameState.pendingRoll.challengerId),
                        challengerRoll1: gameState.pendingRoll.challengerRoll1, challengerRoll2: gameState.pendingRoll.challengerRoll2, challengerBreakdown: gameState.pendingRoll.challengerBreakdown,
                        challengerTotal: gameState.pendingRoll.challengerBase, challengerModifierTotal: gameState.pendingRoll.challengerModifiers, challengerFinalTotal: cFinal,
                        reason: 'for a CHALLENGE!'
                    });
                } else {
                    gameState.pendingRoll.modifierTotal = (gameState.pendingRoll.modifierTotal || 0) + modValue;
                    gameState.pendingRoll.currentRoll += modValue;
                    
                    // ABYSS QUEEN LOGIC — offsets an OPPONENT's *harmful* modifier on
                    // the roller. Now that players choose the sign, only fire it when
                    // the opponent actually played a negative value (a friendly +N from
                    // an opponent shouldn't also hand out a bonus +1).
                    const rollingPlayerId = gameState.pendingRoll.rollerId;
                    if (socket.id !== rollingPlayerId && modValue < 0) {
                        const rollingPlayer = gameState.players[rollingPlayerId];
                        if (rollingPlayer && rollingPlayer.slainMonsters && rollingPlayer.slainMonsters.some(m => m.effect_id === 'MONSTER_ABYSS_QUEEN')) {
                            gameState.pendingRoll.currentRoll += 1;
                            gameState.pendingRoll.modifierTotal += 1;
                            io.emit('message', `Abyss Queen grants +1 to ${getPlayerName(gameState, rollingPlayerId)}'s roll against the opponent's modifier!`);
                        }
                    }

                    io.emit('dice_roll_pending', {
                        rollerId: gameState.pendingRoll.rollerId, rollerName: getPlayerName(gameState, gameState.pendingRoll.rollerId),
                        roll1: gameState.pendingRoll.roll1, roll2: gameState.pendingRoll.roll2, passiveBonus: gameState.pendingRoll.passiveBonus,
                        breakdown: gameState.pendingRoll.breakdown,
                        modifierTotal: gameState.pendingRoll.modifierTotal, finalTotal: gameState.pendingRoll.currentRoll, total: gameState.pendingRoll.currentRoll,
                        reason: gameState.pendingRoll.type === 'ATTACK' ? 'to attack a monster' : 'for a skill'
                    });
                }
                gameState.passedModifiers = [];
                startModifierTimer();
                }
            }
        } else if (data.action === 'PASS') {
            // Add player if not already passed
            if (!gameState.passedModifiers.includes(socket.id)) {
                gameState.passedModifiers.push(socket.id);
            }
            reply({ ok: true });
        }

        // Seats in the reconnect grace period cannot respond and must not force
        // the connected players to wait for the full modifier timer.
        const connectedPlayerIds = Object.keys(gameState.players)
            .filter(playerId => io.sockets.sockets.has(playerId));
        const everyonePassed = connectedPlayerIds.length > 0
            && connectedPlayerIds.every(playerId => gameState.passedModifiers.includes(playerId));

        if (everyonePassed) {

            // End the phase
            gameState.passedModifiers = []; // Reset for future rolls
            if (modifierTimer) clearTimeout(modifierTimer);
            
            resolvePendingRoll(); 
        } else {
            // Tell the frontend to update UI for the waiting player. Must use
            // broadcastState() — a raw io.emit('gameStateUpdate', gameState) omits
            // the per-socket `me` field (blanking each client's myId) and leaks
            // every hand.
            broadcastState();
        }
    });

    
    socket.on('play_from_hand', (data) => {
        if (gameState.state !== 'WAITING_FOR_HAND_SELECTION') return;
        if (socket.id !== gameState.pendingAction.playerToChoose) return;
        const player = gameState.players[socket.id];
        if (!player) return;

        if (data.cancel && (gameState.pendingAction.optional || !player.hand.some(c => gameState.pendingAction.allowedTypes.includes(c.type)))) {
            io.emit('message', `${getPlayerName(gameState, player.id)} declined to play a card.`);
            if (gameState.pendingAction.expansionFreePlay) gameState.freePlayQueue = null;
            resetToPlayingState();
            broadcastState();
            return;
        }

        const cardIndex = player.hand.findIndex(c => c.id === data.cardId);
        if (cardIndex !== -1) {
            const card = player.hand[cardIndex];
            const allowedIds = gameState.pendingAction.allowedCardIds;
            if (gameState.pendingAction.allowedTypes.includes(card.type)
                && (!allowedIds || allowedIds.includes(card.id))) {
                // Capture follow-up draw count, then clear the PLAY_FROM_HAND action.
                // It has been consumed; leaving it set makes resolvePendingCard mistake
                // it for a Magic follow-up (forcing PLAYING and clobbering a Hero's
                // skill-roll prompt — Hook / Quick Draw / Fuzzy Cheeks).
                const thenDraw = gameState.pendingAction.thenDraw || 0;
                if (gameState.pendingAction.expansionFreePlay && gameState.freePlayQueue) {
                    gameState.freePlayQueue.remaining -= 1;
                    if (gameState.freePlayQueue.remaining <= 0) gameState.freePlayQueue = null;
                }
                gameState.pendingAction = null;
                player.hand.splice(cardIndex, 1);
                triggerPlayedCardMonsterPassives(socket.id, card);
                gameState.pendingCard = card;

                if (thenDraw && queueLumberingDrawSequence(gameState, player, thenDraw, {
                    type: 'START_CARD_CHALLENGE', playerId: socket.id, card,
                    targetPlayerId: data.targetPlayerId, targetHeroId: data.targetHeroId
                }, 'immediate play effect')) {
                    gameState.pendingCard = null;
                    gameState.state = 'PLAYING';
                    broadcastState();
                    return;
                }
                if (thenDraw && gameState.mainDeck.length > 0) {
                    drawCardsWithPassives(gameState, io, thenDraw, player);
                    io.emit('message', `${getPlayerName(gameState, player.id)} drew ${thenDraw} extra card(s)!`);
                }

                gameState.pendingChallenge = {
                    rollerId: socket.id,
                    card: gameState.pendingCard,
                    // Items played from a "draw then MAY play" prompt (Quick Draw /
                    // Hook) still need an equip target, or resolvePendingCard sends
                    // the item straight to the discard pile instead of equipping it.
                    targetPlayerId: data.targetPlayerId,
                    targetHeroId: data.targetHeroId,
                    passedPlayers: []
                };

                // Iron Resolve: skip the challenge phase for this player's cards.
                if (player.cannotBeChallenged) {
                    io.emit('message', `${getPlayerName(gameState, socket.id)}'s ${gameState.pendingCard.name} cannot be challenged (Iron Resolve)!`);
                    resolvePendingCard();
                } else {
                    gameState.state = 'WAITING_FOR_CHALLENGES';
                    io.emit('challenge_pending', {
                        rollerId: socket.id,
                        rollerName: `${getPlayerName(gameState, socket.id)}`,
                        card: gameState.pendingCard
                    });
                    broadcastState();
                }
            } else {
                 io.emit('message', `You must select a ${gameState.pendingAction.allowedTypes.join(' or ')}.`);
            }
        }
    });
socket.on('resolve_immediate_play', (data) => {
        if (gameState.state !== 'WAITING_FOR_IMMEDIATE_PLAY') return;
        if (socket.id !== gameState.pendingAction.playerToChoose) return;
        const player = gameState.players[socket.id];
        if (!player || !gameState.pendingCard) return;
        
        // Snowball: drawing a second card is part of choosing to PLAY the drawn
        // Magic card. Read it before clearing the choice action.
        const thenDraw = (gameState.pendingAction && gameState.pendingAction.thenDraw) || 0;

        if (data.playNow === true) {
            if (prepareImmediateItemPlay(gameState, socket.id)) {
                broadcastState();
                return;
            }
            // Clear the IMMEDIATE_PLAY_CHOICE so it can't linger past resolution.
            gameState.pendingAction = null;

            if (thenDraw > 0 && queueLumberingDrawSequence(gameState, player, thenDraw, {
                type: 'START_CARD_CHALLENGE', playerId: socket.id,
                card: gameState.pendingCard
            }, 'Snowball')) {
                gameState.pendingCard = null;
                gameState.state = 'PLAYING';
                broadcastState();
                return;
            }
            if (thenDraw > 0) {
                drawCardsWithPassives(gameState, io, thenDraw, player);
                io.emit('message', `${getPlayerName(gameState, socket.id)} drew ${thenDraw} card(s) from Snowball!`);
            }

            gameState.state = 'WAITING_FOR_CHALLENGES';
            gameState.pendingChallenge = {
                rollerId: socket.id,
                card: gameState.pendingCard,
                passedPlayers: []
            };
            io.emit('challenge_pending', {
                rollerId: socket.id,
                rollerName: `${getPlayerName(gameState, socket.id)}`,
                card: gameState.pendingCard
            });
        } else {
            player.hand.push(gameState.pendingCard);
            resetToPlayingState();
        }

        gameState.pendingCard = null;
        broadcastState();
    });

    socket.on('submit_penalty_sacrifice', (data) => {
        if (gameState.state !== 'WAITING_FOR_SACRIFICE') return;
        const player = gameState.players[socket.id];
        if (!player || socket.id !== gameState.pendingAction.playerToChoose) return;

        const tHeroIndex = player.party.findIndex(h => h.id === data.targetHeroId);
        if (tHeroIndex !== -1) {
            const targetHero = player.party[tHeroIndex];
            const pendingAction = gameState.pendingAction;
            const pendingSkillId = pendingAction.skillId;
            let didSacrifice = false;
            const decoy = equippedItems(targetHero).find(item => item.effect_id === 'ITEM_DECOY');
            if (consumeDecoyDoll(targetHero, 'SACRIFICE')) {
                didSacrifice = true;
                if (decoy) recordSacrificeEvent(gameState, player, decoy, { isHero: false });
                io.emit('message', `${getPlayerName(gameState, socket.id)} discarded Decoy Doll instead of sacrificing ${targetHero.name}!`);
            } else if (player.maegistyActive) {
                const items = equippedItems(targetHero);
                player.party.splice(tHeroIndex, 1);
                targetHero.equippedItem = null;
                targetHero.equippedItem2 = null;
                player.hand.push(targetHero, ...items);
                io.emit('message', `${targetHero.name} and its equipped Items returned to ${getPlayerName(gameState, socket.id)}'s hand due to Maegisty.`);
            } else {
                player.party.splice(tHeroIndex, 1);
                const removedItems = ['equippedItem', 'equippedItem2']
                    .filter(slot => targetHero[slot])
                    .map(slot => ({ slot, card: targetHero[slot] }));
                removedItems.forEach(entry => gameState.discardPile.push(entry.card));
                targetHero.equippedItem = null;
                targetHero.equippedItem2 = null;
                gameState.discardPile.push(targetHero);
                didSacrifice = true;
                recordSacrificeEvent(gameState, player, targetHero, {
                    isHero: true, removedItems,
                    initiatorId: player.silentShieldActive ? socket.id : null
                });
                io.emit('message', `${getPlayerName(gameState, socket.id)} sacrificed their ${targetHero.name}!`);
            }
            if (pendingAction.type === 'DRAGONS_BILE_SACRIFICE') {
                if (!pendingAction.nextAction
                    || !queueGobletReroll(pendingAction.originalActor, pendingAction.nextAction.heroId)) {
                    resetToPlayingState();
                }
                broadcastState();
                return;
            } else if (pendingAction.type === 'LIGHTNING_LABRYS_SACRIFICE') {
                queueLightningLabrysPlayerChoice(gameState, pendingAction.originalActor, pendingAction.remainingChoices);
                if (pendingAction.remainingChoices > 0) {
                    io.emit('message', `${getPlayerName(gameState, pendingAction.originalActor)} must choose the next player for Lightning Labrys.`);
                }
                broadcastState();
                return;
            } else if (pendingAction.type === 'ORACON_SACRIFICE') {
                resetToPlayingState();
                io.emit('message', `${getPlayerName(gameState, socket.id)} completed Oracon's sacrifice.`);
            } else if (pendingSkillId === 'SKILL_DOE_FALLOW') {
                resetToPlayingState();
                const amount = Math.max(0, 7 - player.hand.length);
                dealCards(amount, player.id, 'Doe Fallow');
                io.emit('message', `${getPlayerName(gameState, socket.id)} drew ${amount} card(s) to reach 7 cards with Doe Fallow.`);
            } else if (pendingSkillId === 'SKILL_MAJESTELK') {
                gameState.state = 'WAITING_FOR_MAJESTELK_CHOICE';
                gameState.pendingAction = { type: 'MAJESTELK_CHOICE', playerToChoose: socket.id, originalActor: socket.id };
                broadcastState();
                return;
            } else {
                resetToPlayingState();
            }
            broadcastState();
        }
    });

    socket.on('choose_majestelk_modifier', ({ value }) => {
        if (gameState.state !== 'WAITING_FOR_MAJESTELK_CHOICE' || gameState.pendingAction?.playerToChoose !== socket.id) return;
        if (![5, -5].includes(value)) return;
        const player = gameState.players[socket.id];
        player.untilNextTurnRollBonus = value;
        io.emit('message', `${getPlayerName(gameState, socket.id)} chose ${value > 0 ? '+' : ''}${value} with Majestelk until the start of their next turn.`);
        resetToPlayingState();
        broadcastState();
    });

    socket.on('resolve_dragalter_choice', ({ cardId, value } = {}) => {
        const action = gameState.pendingAction;
        if (gameState.state !== 'WAITING_FOR_DRAGALTER_CHOICE'
            || action?.type !== 'DRAGALTER_MODIFIER' || action.playerToChoose !== socket.id
            || !action.allowedCardIds?.includes(cardId)) return;
        const player = gameState.players[socket.id];
        const index = player?.hand?.findIndex(card => card.id === cardId && card.type === 'Modifier Card') ?? -1;
        if (index === -1) return;
        const modifier = player.hand[index];
        const allowed = Array.isArray(modifier.modifier_values) ? modifier.modifier_values : [];
        if (!allowed.includes(value)) return;
        player.hand.splice(index, 1);
        gameState.discardPile.push(modifier);
        player.rollBonus = (player.rollBonus || 0) + value;
        (player.rollBonusSources = player.rollBonusSources || []).push({ source: 'Dragalter', value });
        resetToPlayingState();
        io.emit('message', `${getPlayerName(gameState, socket.id)} discarded ${modifier.name}; Dragalter applies ${value >= 0 ? '+' : ''}${value} to all of their rolls for the rest of this turn.`);
        broadcastState();
    });

    socket.on('resolve_fearless_flame_choice', ({ use } = {}) => {
        const action = gameState.pendingAction;
        if (gameState.state !== 'WAITING_FOR_DISCARD_PENALTY'
            || action?.type !== 'FEARLESS_FLAME_DISCARD' || action.playerToChoose !== socket.id) return;
        if (use === true) return;
        finishFearlessFlameChoice(false);
        broadcastState();
    });

    socket.on('resolve_smok_choice', ({ cardId } = {}) => {
        const action = gameState.pendingAction;
        if (gameState.state !== 'WAITING_FOR_SMOK_CHOICE' || action?.type !== 'SMOK_REVEAL'
            || action.playerToChoose !== socket.id) return;
        const player = gameState.players[socket.id];
        if (cardId) {
            const card = player?.hand?.find(entry => entry.id === cardId && entry.type === 'Magic Card');
            if (!card || !action.allowedCardIds?.includes(card.id)) return;
            player.ap = (player.ap || 0) + 1;
            io.emit('card_revealed', { playerId: socket.id, playerName: getPlayerName(gameState, socket.id), card, source: 'Smok' });
            io.emit('message', `${getPlayerName(gameState, socket.id)} revealed ${card.name} with Smok and gained 1 extra action point this turn.`);
        } else {
            io.emit('message', `${getPlayerName(gameState, socket.id)} declined to reveal a Magic card for Smok.`);
        }
        resetToPlayingState();
        broadcastState();
    });

    socket.on('resolve_mirroryu_choice', ({ heroId } = {}) => {
        const action = gameState.pendingAction;
        if (gameState.state !== 'WAITING_FOR_MIRRORYU_CHOICE' || action?.type !== 'MIRRORYU_HERO'
            || action.playerToChoose !== socket.id || !action.allowedHeroIds?.includes(heroId)) return;
        const player = gameState.players[socket.id];
        const hero = player?.party?.find(card => card.id === heroId && card.skill_id);
        if (!hero || hero.id === action.sourceHeroId || hasEquippedEffect(hero, 'ITEM_SEALING_KEY')) return;
        gameState.state = 'WAITING_TO_ROLL';
        gameState.pendingAction = null;
        gameState.pendingRoll = {
            type: 'HERO_SKILL', rollerId: socket.id, targetHeroId: hero.id,
            roll1: 0, roll2: 0, passiveBonus: 0, modifierTotal: 0,
            baseRoll: 0, currentRoll: 0, passedPlayers: [], apSpent: 0,
            mirroryuBonus: 3, mirroryuFreeRoll: true
        };
        io.emit('message', `${getPlayerName(gameState, socket.id)} chose ${hero.name}; Mirroryu grants +3 to its immediate skill roll.`);
        broadcastState();
    });

    socket.on('resolve_luut_choice', ({ itemId, heroId } = {}) => {
        const action = gameState.pendingAction;
        if (gameState.state !== 'WAITING_FOR_LUUT_CHOICE' || !action || action.playerToChoose !== socket.id) return;
        const player = gameState.players[socket.id];
        if (action.type === 'LUUT_ITEM') {
            const candidate = action.availableItems?.find(entry => entry.itemId === itemId);
            if (!candidate) return;
            gameState.pendingAction = { ...action, type: 'LUUT_DESTINATION', selectedItem: candidate };
            io.emit('message', `${getPlayerName(gameState, socket.id)} selected an Item with Luut and must choose a Hero to equip it to.`);
            broadcastState();
            return;
        }
        if (action.type !== 'LUUT_DESTINATION' || !action.destinationHeroIds?.includes(heroId)) return;
        const destination = player?.party?.find(card => card.id === heroId);
        const selected = action.selectedItem;
        const owner = selected && gameState.players[selected.ownerId];
        const sourceHero = owner?.party?.find(card => card.id === selected.heroId);
        const slot = ['equippedItem', 'equippedItem2'].find(key => sourceHero?.[key]?.id === selected.itemId);
        const targetSlot = ['equippedItem', 'equippedItem2'].slice(0, destination?.item_slots || 1)
            .find(key => destination && !destination[key]);
        if (!slot || !targetSlot) return;
        const item = sourceHero[slot];
        sourceHero[slot] = null;
        destination[targetSlot] = item;
        resetToPlayingState();
        io.emit('message', `${getPlayerName(gameState, socket.id)} stole ${item.name} with Luut and equipped it to ${destination.name}.`);
        broadcastState();
    });

    socket.on('choose_roaryal_guard_class', ({ className } = {}) => {
        const action = gameState.pendingAction;
        if (gameState.state !== 'WAITING_FOR_CLASS_SELECTION' || action?.type !== 'ROARYAL_GUARD_CLASS'
            || action.playerToChoose !== socket.id || !CLASSES.includes(className)) return;

        let returned = 0;
        Object.values(gameState.players).forEach(owner => {
            for (let index = owner.party.length - 1; index >= 0; index--) {
                const hero = owner.party[index];
                if (effectiveHeroClass(hero) !== className) continue;
                owner.party.splice(index, 1);
                const items = equippedItems(hero);
                hero.equippedItem = null;
                hero.equippedItem2 = null;
                owner.hand.push(hero, ...items);
                returned += 1;
            }
        });
        io.emit('message', `${getPlayerName(gameState, socket.id)} chose ${className} with Roaryal Guard and returned ${returned} Hero${returned === 1 ? '' : 'es'} to their owners' hands.`);
        resetToPlayingState();
        broadcastState();
    });

    socket.on('resolve_dragon_wasp_choice', ({ use } = {}) => {
        const action = gameState.pendingAction;
        if (gameState.state !== 'WAITING_FOR_DRAGON_WASP_CHOICE'
            || action?.type !== 'DRAGON_WASP_REPLACEMENT'
            || action.playerToChoose !== socket.id) return;
        const player = gameState.players[socket.id];
        const trigger = action.trigger;
        if (!player || !trigger) return;
        if (use === true && player.hand.length >= 2) {
            gameState.state = 'WAITING_FOR_DISCARD_PENALTY';
            gameState.pendingAction = {
                type: 'DRAGON_WASP_DISCARD', playerToChoose: socket.id,
                originalActor: socket.id, amount: 2,
                nextAction: { type: 'COMPLETE_DRAGON_WASP_REPLACEMENT', trigger }
            };
            io.emit('message', `${getPlayerName(gameState, socket.id)} chose to discard 2 cards with Dragon Wasp.`);
        } else {
            queueCommittedHeroRemovalTriggers(gameState, player, trigger.hero, {
                ...trigger, isHero: true
            });
            resetToPlayingState();
            resumeExpansionChoices();
        }
        broadcastState();
    });

    socket.on('resolve_lumbering_demon_draw', ({ use } = {}) => {
        const action = gameState.pendingAction;
        const sequence = gameState.pendingLumberingDraws?.[0];
        if (gameState.state !== 'WAITING_FOR_LUMBERING_DEMON_CHOICE'
            || action?.type !== 'LUMBERING_DEMON_DRAW'
            || action.playerToChoose !== socket.id || sequence?.playerId !== socket.id) return;
        const player = gameState.players[socket.id];
        if (!player) return;
        gameState.pendingAction = null;
        if (use === true) {
            const drawn = drawCardsWithoutPassives(gameState, io, 2, player);
            if (drawn.length > 0 && player.hand.length > 0) {
                gameState.state = 'WAITING_FOR_DISCARD_PENALTY';
                gameState.pendingAction = {
                    type: 'LUMBERING_DEMON_DISCARD', playerToChoose: socket.id,
                    originalActor: socket.id, amount: 1,
                    nextAction: { type: 'COMPLETE_LUMBERING_DEMON_DRAW', drawn }
                };
                io.emit('message', `${getPlayerName(gameState, socket.id)} replaced one draw with Lumbering Demon and must discard a card.`);
            } else {
                completeLumberingDrawStep(sequence, drawn);
                resetToPlayingState();
                resumeExpansionChoices();
            }
        } else {
            const drawn = drawCardsWithoutPassives(gameState, io, 1, player);
            completeLumberingDrawStep(sequence, drawn);
            resetToPlayingState();
            resumeExpansionChoices();
        }
        broadcastState();
    });

    socket.on('resolve_goblet_reroll', ({ use } = {}) => {
        const action = gameState.pendingAction;
        if (gameState.state !== 'WAITING_FOR_GOBLET_REROLL' || action?.type !== 'GOBLET_REROLL'
            || action.playerToChoose !== socket.id) return;
        const player = gameState.players[socket.id];
        const hero = player?.party?.find(card => card.id === action.heroId);
        if (use !== true || !hero) {
            resetToPlayingState();
            broadcastState();
            return;
        }
        const slot = ['equippedItem', 'equippedItem2']
            .find(key => hero[key]?.effect_id === 'ITEM_GOBLET_CAFFEINATION');
        if (!slot) return;
        const goblet = hero[slot];
        hero[slot] = null;
        gameState.discardPile.push(goblet);
        recordSacrificeEvent(gameState, player, goblet, { isHero: false });
        gameState.state = 'WAITING_TO_ROLL';
        gameState.pendingAction = null;
        gameState.pendingRoll = {
            type: 'HERO_SKILL', rollerId: socket.id, targetHeroId: hero.id,
            roll1: 0, roll2: 0, passiveBonus: 0, modifierTotal: 0,
            baseRoll: 0, currentRoll: 0, passedPlayers: [], apSpent: 0,
            gobletReroll: true
        };
        io.emit('message', `${getPlayerName(gameState, socket.id)} sacrificed Goblet of Caffeination and may immediately reroll ${hero.name}'s skill for 0 AP.`);
        broadcastState();
    });

    socket.on('resolve_wandering_behemoth_draw', ({ use } = {}) => {
        const action = gameState.pendingAction;
        if (gameState.state !== 'WAITING_FOR_MONSTER_TRIGGER_CHOICE'
            || action?.type !== 'MONSTER_OPTIONAL_DRAW' || action.playerToChoose !== socket.id) return;
        const source = action.source;
        resetToPlayingState();
        if (use === true) {
            dealCards(1, socket.id, source);
            io.emit('message', `${getPlayerName(gameState, socket.id)} drew a card with ${source}.`);
        }
        broadcastState();
    });

    socket.on('resolve_calamity_mongrel_choice', ({ use } = {}) => {
        const action = gameState.pendingAction;
        if (gameState.state !== 'WAITING_FOR_CALAMITY_MONGREL_CHOICE'
            || action?.type !== 'CALAMITY_MONGREL_REPLACE' || action.playerToChoose !== socket.id) return;
        const player = gameState.players[socket.id];
        const index = player?.hand?.findIndex(card => card.id === action.cardId && card.type === 'Challenge Card') ?? -1;
        resetToPlayingState();
        if (use === true && index !== -1) {
            const challenge = player.hand.splice(index, 1)[0];
            gameState.discardPile.push(challenge);
            const queued = queueLumberingDrawSequence(gameState, player, 2, null, 'Calamity Mongrel');
            if (!queued) drawCardsWithPassives(gameState, io, 2, player);
            io.emit('message', `${getPlayerName(gameState, socket.id)} discarded ${challenge.name} with Calamity Mongrel and drew 2 cards.`);
        } else {
            io.emit('message', `${getPlayerName(gameState, socket.id)} kept the Challenge card drawn with Calamity Mongrel.`);
        }
        broadcastState();
    });

    socket.on('resolve_end_turn_monster_effect', ({ use } = {}) => {
        const action = gameState.pendingAction;
        if (gameState.state !== 'WAITING_FOR_END_TURN_CHOICE'
            || action?.type !== 'END_TURN_MONSTER_CHOICE' || action.playerToChoose !== socket.id) return;
        const effect = action.effect;
        resetToPlayingState();
        if (use !== true) {
            advanceEndTurnMonsterEffect();
            broadcastState();
            return;
        }
        if (effect === 'GORETELODONT_DRAW') {
            const queued = queueLumberingDrawSequence(
                gameState, gameState.players[socket.id], 3,
                { type: 'ADVANCE_END_TURN_MONSTER_EFFECT' }, 'Goretelodont'
            );
            if (!queued) drawCardsWithPassives(gameState, io, 3, gameState.players[socket.id]);
            io.emit('message', `${getPlayerName(gameState, socket.id)} drew 3 cards with Goretelodont.`);
            if (!queued && gameState.state === 'PLAYING' && !gameState.pendingAction && !gameState.pendingCard) {
                advanceEndTurnMonsterEffect();
            }
        } else if (effect === 'CLAWED_NIGHTMARE_PULL') {
            const hasTarget = Object.entries(gameState.players)
                .some(([id, player]) => id !== socket.id && player.hand.length > 0 && player.connected !== false);
            if (hasTarget) {
                gameState.state = 'WAITING_FOR_SKILL_TARGET';
                gameState.pendingAction = {
                    type: 'END_CLAWED_NIGHTMARE_PLAYER', playerToChoose: socket.id,
                    originalActor: socket.id
                };
            } else {
                advanceEndTurnMonsterEffect();
            }
        } else if (effect === 'SCAVENGER_GRIFFIN_STEAL') {
            if (hasStealOrDestroyTarget(socket.id, 'STEAL')) {
                gameState.state = 'PLAYING';
                gameState.pendingAction = {
                    type: 'STEAL', playerToChoose: socket.id, originalActor: socket.id,
                    endTurnContinuation: true
                };
            } else {
                advanceEndTurnMonsterEffect();
            }
        }
        broadcastState();
    });

    socket.on('submit_penalty_discard', (data) => {
        const player = gameState.players[socket.id];
        if (!player) return;

        const { cardIds } = data; // Expect an array of card IDs

        if (gameState.state === 'WAITING_FOR_DISCARD_PENALTY') {
            if (socket.id !== gameState.pendingAction.playerToChoose) return;
            if (!cardIds || !Array.isArray(cardIds) || cardIds.length !== gameState.pendingAction.amount) return;

            const uniqueIds = [...new Set(cardIds)];
            if (uniqueIds.length !== cardIds.length) return;
            const allowedTypes = gameState.pendingAction.allowedTypes;
            const excludedCardId = gameState.pendingAction.excludeCardId;
            if (!uniqueIds.every(cardId => player.hand.some(card => card.id === cardId
                && card.id !== excludedCardId
                && (!allowedTypes || allowedTypes.includes(card.type))))) return;

            for (const cardId of cardIds) {
                const cardIndex = player.hand.findIndex(c => c.id === cardId);
                if (cardIndex !== -1) {
                    const card = player.hand.splice(cardIndex, 1)[0];
                    gameState.discardPile.push(card);
                }
            }
            
            io.emit('message', `${getPlayerName(gameState, socket.id)} discarded ${cardIds.length} card(s)!`);
            if (gameState.pendingAction.type === 'FEARLESS_FLAME_DISCARD') {
                finishFearlessFlameChoice(true);
                broadcastState();
                return;
            }
            const nextAction = gameState.pendingAction.nextAction;
            if (nextAction?.type === 'EGG_OF_FORTUNE_PULLS') {
                const actor = gameState.players[nextAction.playerId];
                let pulled = 0;
                if (actor) {
                    gameState.playerOrder.forEach(targetId => {
                        if (targetId === actor.id) return;
                        const target = gameState.players[targetId];
                        if (!target || target.hand.length === 0) return;
                        const index = Math.floor(Math.random() * target.hand.length);
                        actor.hand.push(target.hand.splice(index, 1)[0]);
                        pulled += 1;
                    });
                }
                resetToPlayingState();
                io.emit('message', `${getPlayerName(gameState, nextAction.playerId)} pulled ${pulled} card${pulled === 1 ? '' : 's'} from other players with Egg of Fortune.`);
                broadcastState();
                return;
            }
            if (nextAction?.type === 'COMPLETE_DISCARD_COST_MODIFIER') {
                completeDiscardCostModifier(nextAction);
                broadcastState();
                return;
            }
            if (nextAction?.type === 'COMPLETE_LUMBERING_DEMON_DRAW') {
                const sequence = gameState.pendingLumberingDraws?.[0];
                completeLumberingDrawStep(sequence, nextAction.drawn || []);
                resetToPlayingState();
                resumeExpansionChoices();
                broadcastState();
                return;
            }
            if (nextAction?.type === 'COMPLETE_DRAGON_WASP_REPLACEMENT') {
                const restored = restoreDragonWaspHero(nextAction.trigger);
                resetToPlayingState();
                io.emit('message', restored
                    ? `${getPlayerName(gameState, socket.id)} discarded 2 cards with Dragon Wasp, so ${nextAction.trigger.hero.name} remains in their Party.`
                    : `Dragon Wasp could not restore the Hero.`);
                resumeExpansionChoices();
                broadcastState();
                return;
            }
            resetToPlayingState();
            broadcastState();
        } else if (gameState.state === 'WAITING_FOR_MULTIPLE_DISCARDS') {
            const pAction = gameState.pendingAction;
            if (!pAction.targets.includes(socket.id)) return;
            if (pAction.completed.includes(socket.id)) return;

            if (!cardIds || !Array.isArray(cardIds) || cardIds.length !== pAction.amount) return;

            for (const cardId of cardIds) {
                const cardIndex = player.hand.findIndex(c => c.id === cardId);
                if (cardIndex !== -1) {
                    const card = player.hand.splice(cardIndex, 1)[0];
                    if (pAction.type === 'POOL_DISCARD_AND_CHOOSE') {
                        pAction.pooledCards.push(card);
                    } else {
                        gameState.discardPile.push(card);
                    }
                }
            }

            pAction.completed.push(socket.id);
            io.emit('message', `${getPlayerName(gameState, socket.id)} discarded ${cardIds.length} card(s)!`);

            if (pAction.completed.length === pAction.targets.length) {
                if (pAction.type === 'POOL_DISCARD_AND_CHOOSE') {
                    resetToPlayingState();
                    pAction.type = 'CHOOSE_FROM_POOL';
                    pAction.playerToChoose = pAction.originalActor;
                    io.emit('message', `All targets discarded! ${getPlayerName(gameState, pAction.originalActor)} must now choose a card from the pool.`);
                } else {
                    resetToPlayingState();
                    io.emit('message', `All targets have discarded!`);
                }
            }
            broadcastState();
        } else if (gameState.state === 'WAITING_FOR_VARIABLE_DISCARD') {
            const pAction = gameState.pendingAction;
            if (!pAction) return;
            if (socket.id !== pAction.originalActor) return;
            if (!cardIds || !Array.isArray(cardIds) || cardIds.length > pAction.maxAmount
                || new Set(cardIds).size !== cardIds.length) return;

            let discardedCount = 0;
            for (const cardId of cardIds) {
                const cardIndex = player.hand.findIndex(c => c.id === cardId);
                if (cardIndex !== -1) {
                    const card = player.hand.splice(cardIndex, 1)[0];
                    gameState.discardPile.push(card);
                    discardedCount++;
                }
            }

            io.emit('message', `${getPlayerName(gameState, socket.id)} discarded ${discardedCount} card(s)!`);

            if (pAction.type === 'BIGGEST_RING_DISCARD') {
                const bonus = discardedCount * 2;
                gameState.pendingRoll.currentRoll += bonus;
                (gameState.pendingRoll.breakdown = gameState.pendingRoll.breakdown || []).push({
                    source: 'Biggest Ring Ever', value: bonus
                });
                gameState.state = 'WAITING_FOR_MODIFIERS';
                gameState.pendingAction = null;
                io.emit('message', `${getPlayerName(gameState, socket.id)} added +${bonus} with Biggest Ring Ever.`);
                io.emit('dice_roll_pending', {
                    rollerId: gameState.pendingRoll.rollerId,
                    rollerName: getPlayerName(gameState, gameState.pendingRoll.rollerId),
                    roll1: gameState.pendingRoll.roll1, roll2: gameState.pendingRoll.roll2,
                    passiveBonus: gameState.pendingRoll.passiveBonus,
                    breakdown: gameState.pendingRoll.breakdown,
                    modifierTotal: gameState.pendingRoll.modifierTotal,
                    finalTotal: gameState.pendingRoll.currentRoll,
                    total: gameState.pendingRoll.currentRoll,
                    reason: 'for a skill'
                });
                startModifierTimer();
            } else if (discardedCount > 0 && pAction.type === 'LIGHTNING_LABRYS_DISCARD') {
                queueLightningLabrysPlayerChoice(gameState, socket.id, discardedCount);
                io.emit('message', `${getPlayerName(gameState, socket.id)} must choose ${discardedCount} player${discardedCount === 1 ? '' : 's'} for Lightning Labrys, one at a time.`);
            } else if (discardedCount > 0 && pAction.type === 'VARIABLE_DISCARD_TO_DESTROY') {
                resetToPlayingState();
                // Cap to the number of destroyable opponent heroes so we never ask
                // for more DESTROY targets than exist (Qi Bear soft-locked when the
                // opponent had no heroes).
                const destroyAmt = Math.min(discardedCount, countDestroyableOpponentHeroes(socket.id));
                if (destroyAmt > 0) {
                    gameState.pendingAction = {
                        type: 'DESTROY',
                        playerToChoose: socket.id,
                        amount: destroyAmt,
                        originalActor: socket.id
                    };
                    io.emit('message', `${getPlayerName(gameState, socket.id)} may now DESTROY ${destroyAmt} Hero(es)!`);
                } else {
                    io.emit('message', `No opponent Heroes available to destroy — the effect fizzles.`);
                }
            } else {
                resetToPlayingState();
            }
            broadcastState();
        }
    });

/* --- CHALLENGE PHASE --- */
    socket.on('play_challenge', (cardId) => {
        if (gameState.state !== 'WAITING_FOR_CHALLENGES') return;
        if (!gameState.pendingChallenge) return;
        if (socket.id === gameState.pendingChallenge.rollerId) return;

        const challenger = gameState.players[socket.id];
        const cardIndex = challenger.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return;

        const challengeCard = challenger.hand.splice(cardIndex, 1)[0];
        if (challengeCard.type !== 'Challenge Card') {
            challenger.hand.splice(cardIndex, 0, challengeCard);
            return;
        }
        if (challengeCard.required_class && !playerHasEffectiveClass(challenger, challengeCard.required_class)) {
            challenger.hand.splice(cardIndex, 0, challengeCard);
            io.to(socket.id).emit('message', `You need a ${challengeCard.required_class} in your Party to play this Challenge.`);
            return;
        }
        registerCardPlayed(challengeCard);
        gameState.discardPile.push(challengeCard);
        triggerPlayedCardMonsterPassives(socket.id, challengeCard);

        // Bloodwing: "Each time another player CHALLENGES you, that player must
        // DISCARD a card." The challenged player (the one who played the disputed
        // card) is the Bloodwing owner; the challenger pays a card for challenging.
        const challenged = gameState.players[gameState.pendingChallenge.rollerId];
        if (challenged && challenged.slainMonsters
            && challenged.slainMonsters.some(m => m.effect_id === 'MONSTER_BLOODWING')
            && challenger.hand.length > 0) {
            const dIdx = Math.floor(Math.random() * challenger.hand.length);
            const dropped = challenger.hand.splice(dIdx, 1)[0];
            gameState.discardPile.push(dropped);
            io.emit('message', `${getPlayerName(gameState, socket.id)} must discard a card for challenging ${getPlayerName(gameState, challenged.id)} (Bloodwing)!`);
        }

        // Transition to Dual-Roll State
        clearChallengeTimer();
        gameState.state = 'WAITING_TO_ROLL_CHALLENGE';
        gameState.pendingRoll = {
            type: 'CHALLENGE',
            activeId: gameState.pendingChallenge.rollerId,
            challengerId: socket.id,
            cardInDispute: gameState.pendingChallenge.card,
            activeRolled: false,
            challengerRolled: false,
            activeBase: 0,
            challengerBase: 0,
            activeModifiers: 0,
            challengerModifiers: 0,
            challengerCardBonus: challengeCard.challenge_bonus || 0,
            challengerCardName: challengeCard.name,
            passedPlayers: []
        };
        broadcastState();
    });

    socket.on('pass_challenge', () => {
        if (gameState.state !== 'WAITING_FOR_CHALLENGES') return;
        if (!gameState.pendingChallenge) return;
        if (socket.id === gameState.pendingChallenge.rollerId) return;
        
        if (!gameState.pendingChallenge.passedPlayers.includes(socket.id)) {
            gameState.pendingChallenge.passedPlayers.push(socket.id);
        }

        if (!settleUnchallengedCardIfComplete()) {
            broadcastState();
        }
    });

    // Decline an OPTIONAL pending action (the card said "you MAY ..."). Only the
    // chosen player can skip, and only when the action is flagged optional.
    socket.on('skip_optional_action', () => {
        const pa = gameState.pendingAction;
        if (!pa || !pa.optional) return;
        if (pa.playerToChoose !== socket.id) return;
        gameState.pendingAction = null;
        resetToPlayingState();
        io.emit('message', `${getPlayerName(gameState, socket.id)} declined the optional effect.`);
        broadcastState();
    });

    socket.on('target_selected', (targetId) => {
        if (gameState.state !== 'PLAYING') return;
        if (!gameState.pendingAction) return;

        const pAction = gameState.pendingAction;
        if (pAction.playerToChoose !== socket.id) return;

        const player = gameState.players[socket.id];

        if (pAction.type === 'FREE_SLAY') {
            if (!gameState.activeMonsters.some(monster => monster.id === targetId)) return;
            gameState.pendingAction = null;
            const monster = slayFaceUpMonster(socket.id, targetId, 'SKILL_VICIOUS_WILDCAT');
            if (!monster) return;
            gameState.forcedEndTurnPlayerId = socket.id;
            const winResult = checkWinCondition();
            if (winResult) {
                handleGameOver(winResult);
            } else if (gameState.state === 'PLAYING' && !gameState.pendingAction && !gameState.pendingCard) {
                gameState.forcedEndTurnPlayerId = null;
                beginEndTurn(socket.id);
            }
            broadcastState();
            return;
        }

        if (pAction.type === 'FREE_ATTACK') {
            const monster = gameState.activeMonsters.find(card => card.id === targetId);
            if (!monster || !meetsMonsterRequirements(player, monster.requirement)) return;
            const cost = monster.attack_cost;
            if (cost?.count > 0) {
                if (!canPayMonsterAttackCost(player, monster)) {
                    io.to(socket.id).emit('message', `You need ${cost.count} ${cost.discard === 'ANY' ? '' : cost.discard + ' '}card${cost.count === 1 ? '' : 's'} to attack ${monster.name}.`);
                    return;
                }
                gameState.pendingAction = {
                    type: 'DISCARD', playerToChoose: socket.id, originalActor: socket.id,
                    amount: cost.count, allowedTypes: attackCostAllowedTypes(cost),
                    nextAction: { type: 'START_FREE_MONSTER_ATTACK', monsterId: monster.id, playerId: socket.id }
                };
                io.emit('message', `${getPlayerName(gameState, socket.id)} must pay ${monster.name}'s discard cost before the free attack.`);
            } else {
                gameState.pendingAction = null;
                startMonsterAttackRoll(socket.id, monster.id, { freeAttack: true });
                io.emit('message', `${getPlayerName(gameState, socket.id)} selected ${monster.name} for Big Buckley's free attack.`);
            }
            broadcastState();
            return;
        }
        
        if (pAction.type === 'DISCARD') {
            const cardIndex = player.hand.findIndex(c => c.id === targetId);
            if (cardIndex !== -1) {
                if (pAction.allowedTypes && !pAction.allowedTypes.includes(player.hand[cardIndex].type)) return;
                const card = player.hand.splice(cardIndex, 1)[0];
                gameState.discardPile.push(card);
                pAction.amount -= 1;
                
                io.emit('message', `Player discarded ${card.name}.`);

                if (pAction.amount <= 0 || player.hand.length === 0) {
                    if (pAction.nextAction) {
                        const next = pAction.nextAction;
                        if (next.type === 'EXECUTE_SKILL_IMMEDIATE') {
                            gameState.pendingAction = null;
                            executeSkill(gameState, io, next.skillId, next.rollerId, next.heroId, null);
                            resetToPlayingState();
                        } else if (next.type === 'START_CHALLENGE') {
                            gameState.state = 'WAITING_TO_ROLL_CHALLENGE';
                            gameState.pendingAction = null;
                            gameState.pendingRoll = next.challengeData;
                            io.emit('challenge_accepted', gameState.pendingRoll);
                        } else if (next.type === 'START_SEQUENTIAL_DISCARD') {
                            const targets = (next.targets || []).filter(id => gameState.players[id]?.hand?.length > 0);
                            gameState.pendingAction = null;
                            if (targets.length > 0) {
                                gameState.state = 'WAITING_FOR_GLOBAL_ACTION';
                                gameState.pendingGlobalAction = {
                                    type: 'SEQUENTIAL_DISCARD', initiatorId: next.originalActor,
                                    pendingPlayerIds: [targets[0]], remainingPlayerIds: targets.slice(1),
                                    amount: next.amount,
                                    remainingForCurrent: Math.min(next.amount, gameState.players[targets[0]].hand.length)
                                };
                                io.emit('global_action_requested', gameState.pendingGlobalAction);
                            } else {
                                resetToPlayingState();
                            }
                        } else if (next.type === 'APPLY_SHADOW_SAINT') {
                            const actor = gameState.players[next.originalActor];
                            gameState.pendingAction = null;
                            if (actor) {
                                actor.blocksOpponentModifiersThisTurn = true;
                                io.emit('message', `${getPlayerName(gameState, actor.id)} prevents every other player from playing Modifiers until the end of the turn.`);
                            }
                            resetToPlayingState();
                        } else if (next.type === 'START_MONSTER_ATTACK' || next.type === 'START_FREE_MONSTER_ATTACK') {
                            gameState.pendingAction = null;
                            if (!startMonsterAttackRoll(next.playerId, next.monsterId, { freeAttack: next.type === 'START_FREE_MONSTER_ATTACK' })) {
                                resetToPlayingState();
                                io.emit('message', `The Monster attack could not start after its cost was paid.`);
                            }
                        } else if ((next.type === 'STEAL' || next.type === 'DESTROY') && !hasStealOrDestroyTarget(socket.id, next.type)) {
                            // No legal Hero to steal/destroy — don't strand the actor
                            // with an unfulfillable pending action after they've paid
                            // the discard cost (e.g. Entangling Trap when no opponent
                            // has a Hero). Skip the step and hand the turn back.
                            gameState.pendingAction = null;
                            io.emit('message', `No valid Hero to ${next.type === 'STEAL' ? 'steal' : 'destroy'} — that part of the effect is skipped.`);
                            resetToPlayingState();
                        } else {
                            gameState.pendingAction = next;
                            if (['SKILL_TARGET_HERO', 'SKILL_TARGET_PLAYER', 'SKILL_TARGET_SELF_ITEM', 'SKILL_TARGET_MULTI'].includes(next.type)) {
                                gameState.state = 'WAITING_FOR_SKILL_TARGET';
                            } else if (['STEAL', 'DESTROY', 'EXCHANGE_STEP_1'].includes(next.type)) {
                                gameState.state = 'PLAYING';
                            }
                        }
                    } else {
                        gameState.pendingAction = null;
                        resetToPlayingState();
                    }
                }
            }
        } else if (pAction.type === 'STEAL' || pAction.type === 'DESTROY') {
            // Find which player has this hero
            for (const pId in gameState.players) {
                const p = gameState.players[pId];
                const heroIndex = p.party.findIndex(h => h.id === targetId);
                if (heroIndex !== -1) {
                    if (pAction.type === 'STEAL' && (pId === pAction.originalActor || p.cannotBeStolen)) return;
                    const hero = p.party[heroIndex];

                    if (pAction.type === 'DESTROY') {
                        const targetHasTerratuga = p.slainMonsters && p.slainMonsters.some(m => m.effect_id === 'MONSTER_TERRATUGA');
                        if (targetHasTerratuga) {
                            io.emit('message', `This player's Heroes cannot be destroyed!`);
                            gameState.pendingAction = null;
                            break;
                        }
                    }

                    // Decoy Doll absorbs sacrifice/destroy only. It does not block steals.
                    if (consumeDecoyDoll(hero, pAction.type)) {
                        io.emit('message', `${hero.name}'s Decoy Doll was destroyed instead — the Hero survives!`);
                    } else {
                        p.party.splice(heroIndex, 1);

                        if (pAction.type === 'STEAL') {
                            const thief = gameState.players[pAction.originalActor];
                            thief.party.push(hero);
                            triggerCursedGlove(gameState, p, thief);
                            io.emit('message', `Stole ${hero.name}!`);
                        } else if (pAction.type === 'DESTROY') {
                            const removedItems = ['equippedItem', 'equippedItem2']
                                .filter(slot => hero[slot])
                                .map(slot => ({ slot, card: hero[slot] }));
                            const items = removedItems.map(entry => entry.card);
                            hero.equippedItem = null;
                            hero.equippedItem2 = null;
                            if (p.maegistyActive) {
                                p.hand.push(hero, ...items);
                                io.emit('message', `${hero.name} and its Items returned to ${getPlayerName(gameState, p.id)}'s hand due to Maegisty.`);
                            } else {
                                gameState.discardPile.push(hero, ...items);
                                recordDestroyEvent(gameState, p, hero, {
                                    removedItems,
                                    initiatorId: gameState.players[pAction.originalActor]?.silentShieldActive
                                        ? pAction.originalActor : null
                                });
                                io.emit('message', `Destroyed ${hero.name}!`);
                            }
                        }
                    }

                    // Multi-destroy (Qi Bear: one Hero per discarded card). Keep the
                    // DESTROY action alive until the count is used up OR no destroyable
                    // opponent heroes remain — otherwise just clear it.
                    if (pAction.type === 'DESTROY' && (pAction.amount || 1) > 1 && countDestroyableOpponentHeroes(pAction.originalActor || socket.id) > 0) {
                        pAction.amount -= 1;
                        io.emit('message', `${pAction.amount} more Hero(es) to destroy.`);
                    } else {
                        gameState.pendingAction = null;
                    }
                    break;
                }
            }
            if (pAction.endTurnContinuation && !gameState.pendingAction) {
                resetToPlayingState();
                advanceEndTurnMonsterEffect();
            }
        } else if (pAction.type === 'EXCHANGE_STEP_1') {
            let targetOpponentId = null;
            let targetHero = null;
            for (const pId in gameState.players) {
                if (pId === socket.id) continue;
                const p = gameState.players[pId];
                const heroIndex = p.party.findIndex(h => h.id === targetId);
                if (heroIndex !== -1) {
                    targetOpponentId = pId;
                    targetHero = p.party[heroIndex];
                    break;
                }
            }
            if (targetOpponentId && targetHero) {
                gameState.pendingAction.type = 'EXCHANGE_STEP_2';
                gameState.pendingAction.targetOpponentId = targetOpponentId;
                gameState.pendingAction.targetHeroToSteal = targetHero;
                io.emit('message', `${getPlayerName(gameState, player.id)} selected ${targetHero.name} to steal. Now select one of your own Heroes to give away!`);
            }
        } else if (pAction.type === 'EXCHANGE_STEP_2') {
            const heroIndex = player.party.findIndex(h => h.id === targetId);
            if (heroIndex !== -1) {
                const myHeroToGive = player.party.splice(heroIndex, 1)[0];
                const tp = gameState.players[pAction.targetOpponentId];
                
                let swapped = false;
                if (tp) {
                    const targetHeroIndex = tp.party.findIndex(h => h.id === pAction.targetHeroToSteal.id);
                    if (targetHeroIndex !== -1) {
                        const targetHeroToSteal = tp.party[targetHeroIndex];
                        tp.party.splice(targetHeroIndex, 1);
                        player.party.push(targetHeroToSteal);
                        triggerCursedGlove(gameState, tp, player);
                        tp.party.push(myHeroToGive);
                        io.emit('message', `${getPlayerName(gameState, player.id)} exchanged ${myHeroToGive.name} for ${targetHeroToSteal.name}!`);
                        swapped = true;
                    }
                }
                if (!swapped) {
                    // Return the player's own Hero we tentatively removed.
                    player.party.push(myHeroToGive);
                }
                gameState.pendingAction = null;
            }
        } else if (pAction.type === 'RETURN_ITEM') {
            const returned = returnEquippedItemToOwner(gameState, targetId);
            if (returned) {
                io.emit('message', `${getPlayerName(gameState, returned.owner.id)} got ${returned.item.name} back in their hand!`);
                // The caster still receives the separate draw named by the spell.
                dealCards(1, player.id, 'Winds of Change');
            }
            gameState.pendingAction = null;
        } else if (pAction.type === 'FORCE_DISCARD_TARGET' || pAction.type === 'CONDITIONAL_PULL' || pAction.type === 'PUMA_PULL' || pAction.type === 'LOOK_AND_PULL') {
            const tp = gameState.players[targetId];
            if (tp && targetId !== socket.id) {
                if (pAction.type === 'FORCE_DISCARD_TARGET') {
                    if (tp.hand.length === 0) {
                        io.emit('message', `${getPlayerName(gameState, tp.id)} has no cards to discard!`);
                        gameState.pendingAction = null;
                    } else {
                        const actualAmount = Math.min(pAction.amount, tp.hand.length);
                        gameState.state = 'WAITING_FOR_DISCARD_PENALTY';
                        gameState.pendingAction = {
                            type: 'DISCARD',
                            playerToChoose: targetId,
                            amount: actualAmount,
                            originalActor: pAction.originalActor
                        };
                        io.emit('message', `${getPlayerName(gameState, socket.id)} forced ${getPlayerName(gameState, targetId)} to discard ${actualAmount} card(s)!`);
                    }
                } else if (pAction.type === 'CONDITIONAL_PULL') {
                    if (tp.hand.length === 0) {
                        io.emit('message', `${getPlayerName(gameState, tp.id)} has no cards to pull!`);
                        gameState.pendingAction = null;
                    } else {
                        const randomIndex = Math.floor(Math.random() * tp.hand.length);
                        const pulledCard = tp.hand.splice(randomIndex, 1)[0];
                        io.emit('message', `${getPlayerName(gameState, socket.id)} pulled a card from ${getPlayerName(gameState, targetId)}!`);

                        const conditionTypes = pAction.conditionTypes || [pAction.conditionType];
                        if (conditionTypes.includes(pulledCard.type)) {
                            const matchedType = pulledCard.type;
                            if (pAction.actionOnSuccess === 'PLAY_IMMEDIATELY') {
                                io.emit('message', `The pulled card was a ${matchedType}! They may play it immediately!`);
                                gameState.state = 'WAITING_FOR_IMMEDIATE_PLAY';
                                gameState.pendingCard = pulledCard;
                                gameState.pendingAction = { playerToChoose: socket.id, type: 'IMMEDIATE_PLAY', originalActor: socket.id };
                                broadcastState();
                                return;
                            } else {
                                player.hand.push(pulledCard);
                                io.emit('message', `The pulled card was a ${matchedType}! They get to pull another card!`);
                                if (tp.hand.length > 0) {
                                    const randomIndex2 = Math.floor(Math.random() * tp.hand.length);
                                    const pulledCard2 = tp.hand.splice(randomIndex2, 1)[0];
                                    player.hand.push(pulledCard2);
                                    io.emit('message', `${getPlayerName(gameState, socket.id)} pulled a second card from ${getPlayerName(gameState, targetId)}!`);
                                }
                            }
                        } else {
                            player.hand.push(pulledCard);
                        }
                        gameState.pendingAction = null;
                    }
                } else if (pAction.type === 'PUMA_PULL') {
                    if (tp.hand.length > 0) {
                        for (let i = 0; i < 2; i++) {
                            if (tp.hand.length === 0) break;
                            const rIndex = Math.floor(Math.random() * tp.hand.length);
                            player.hand.push(tp.hand.splice(rIndex, 1)[0]);
                        }
                        io.emit('message', `${getPlayerName(gameState, player.id)} pulled cards from ${getPlayerName(gameState, tp.id)}'s hand!`);
                        if (gameState.mainDeck.length > 0) {
                            dealCards(1, tp.id, 'Plundering Puma');
                            io.emit('message', `${getPlayerName(gameState, tp.id)} drew a card!`);
                        }
                    } else {
                        io.emit('message', `${getPlayerName(gameState, tp.id)} had no cards to pull!`);
                    }
                    gameState.pendingAction = null;
                } else if (pAction.type === 'LOOK_AND_PULL') {
                    if (tp.hand.length > 0) {
                        const rIndex = Math.floor(Math.random() * tp.hand.length);
                        const pulledCard = tp.hand.splice(rIndex, 1)[0];
                        player.hand.push(pulledCard);
                        markButtonsFreePlay(player, pulledCard);
                        io.emit('message', `${getPlayerName(gameState, player.id)} pulled a card from ${getPlayerName(gameState, tp.id)}'s hand!`);
                    } else {
                        io.emit('message', `${getPlayerName(gameState, tp.id)} had no cards to pull!`);
                    }
                    gameState.pendingAction = null;
                }
            }
        } else if (pAction.type === 'CHOOSE_FROM_POOL') {
            const cardIndex = pAction.pooledCards.findIndex(c => c.id === targetId);
            if (cardIndex !== -1) {
                const card = pAction.pooledCards.splice(cardIndex, 1)[0];
                player.hand.push(card);
                
                // Any remaining cards go to discard pile
                pAction.pooledCards.forEach(c => gameState.discardPile.push(c));
                
                io.emit('message', `${getPlayerName(gameState, socket.id)} chose ${card.name} from the pool!`);
                gameState.pendingAction = null;
            }
        }


        const winner = checkWinCondition();
        if (winner) {
            handleGameOver(winner);
        }

        broadcastState();
    });

    socket.on('draw_card_action', () => {
        if (gameState.state !== 'PLAYING') return;
        if (socket.id !== gameState.activePlayerSocketId) return;
        if (gameState.pendingAction) return;

        const player = gameState.players[socket.id];
        if (player.ap < 1) return;

        player.ap -= 1;
        dealCards(1, socket.id);

        broadcastState();
    });

    socket.on('use_muscipula_rex', () => {
        if (gameState.state !== 'PLAYING' || socket.id !== gameState.activePlayerSocketId) return;
        const player = gameState.players[socket.id];
        if (!player || player.usedMuscipulaRexThisTurn
            || !(player.slainMonsters || []).some(monster => monster.effect_id === 'MONSTER_MUSCIPULA_REX')) return;
        player.usedMuscipulaRexThisTurn = true;
        dealCards(1, player.id, 'Muscipula Rex');
        const message = `${getPlayerName(gameState, player.id)} used Muscipula Rex and drew a card without spending an action point.`;
        io.emit('monster_effect_triggered', { monsterId: 'card_139', monsterName: 'Muscipula Rex', ownerId: player.id, message });
        io.emit('message', message);
        broadcastState();
    });

    socket.on('discard_and_draw_five_action', () => {
        if (gameState.state !== 'PLAYING') return;
        if (socket.id !== gameState.activePlayerSocketId) return;
        if (gameState.pendingAction) return;

        const player = gameState.players[socket.id];
        if (player.ap !== 3) return;

        player.ap = 0;

        while (player.hand.length > 0) {
            gameState.discardPile.push(player.hand.pop());
        }

        dealCards(5, socket.id);

        broadcastState();
    });



    socket.on('use_leader_skill', (targetData) => {
        if (gameState.state !== 'PLAYING') return;
        if (socket.id !== gameState.activePlayerSocketId) return;

        const player = gameState.players[socket.id];
        if (!player || !player.leader) return;

        if (player.leader.effect_id === 'LEADER_THIEF') {
            if (player.usedLeaderSkillThisTurn) {
                io.to(socket.id).emit('message', "You have already used your leader skill this turn!");
                return;
            }
            if (player.ap < 1) {
                io.to(socket.id).emit('message', "Not enough AP to use leader skill!");
                return;
            }

            if (!targetData || !targetData.targetPlayerId) return;
            const targetPlayer = gameState.players[targetData.targetPlayerId];
            if (!targetPlayer || targetPlayer.hand.length === 0) {
                io.to(socket.id).emit('message', "Opponent has no cards in hand!");
                return;
            }

            player.ap -= 1;
            player.usedLeaderSkillThisTurn = true;

            const randomIdx = Math.floor(Math.random() * targetPlayer.hand.length);
            const stolenCard = targetPlayer.hand.splice(randomIdx, 1)[0];
            player.hand.push(stolenCard);

            io.emit('message', `The Shadow Claw (Thief) stole a card from ${getPlayerName(gameState, targetData.targetPlayerId)}!`);
            broadcastState();
        } else if (player.leader.effect_id === 'LEADER_NECROMANCER') {
            if (player.usedLeaderSkillThisTurn || player.ap < 2 || gameState.discardPile.length === 0) return;
            player.ap -= 2;
            player.usedLeaderSkillThisTurn = true;
            gameState.state = 'WAITING_FOR_SKILL_TARGET';
            gameState.pendingAction = {
                type: 'SKILL_TARGET_DISCARD',
                originalActor: socket.id,
                playerToChoose: socket.id,
                skillId: 'LEADER_NECROMANCER',
                heroId: null
            };
            io.emit('message', `${getPlayerName(gameState, socket.id)} used The Gnawing Dread and is choosing a card from the discard pile.`);
            broadcastState();
        }
    });

    socket.on('end_turn', () => {
        if (gameState.state !== 'PLAYING') {
            return;
        }
        if (socket.id !== gameState.activePlayerSocketId) {
            return;
        }
        if (gameState.pendingAction) {
            return; // Prevent ending turn while targeting
        }

        beginEndTurn(socket.id);
        broadcastState();
    });

/* --- CONNECTION --- */
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        reconnectManager.disconnect(socket.id);
    });
});

function startGame() {
    loadCards(); console.log(`[DEBUG] After loadCards, mainDeck size: ${gameState.mainDeck.length}`);
    clearRexMajorChoices(gameState);
    resetToPlayingState();
    gameState.waitingForInput = false;
    gameState.pendingRoll = null;
    gameState.pendingChallenge = null;
    gameState.pendingGlobalAction = null;
    gameState.pendingPassiveDraws = [];
    gameState.pendingMonsterTriggers = [];
    gameState.pendingLumberingDraws = [];
    gameState.pendingDeferredDrawPassives = [];
    gameState.pendingEndTurnEffects = null;
    gameState.pendingShamanagaSacrifice = null;
    gameState.pendingSmokReveal = null;
    if (modifierTimer) clearTimeout(modifierTimer);
    clearChallengeTimer();

    gameState.playerOrder.forEach(id => {
        dealCards(5, id);
    });

    spawnMonsters();

    // Randomly select one player as the active player (or default to Player 1)
    gameState.activePlayerSocketId = gameState.playerOrder[0];
    gameState.players[gameState.activePlayerSocketId].ap = 3;

}

// Only start the HTTP server when run directly (`node server.js`). When required
// by unit tests we just want access to the pure rule functions below.
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Server listening on port ${PORT} (bound to 0.0.0.0)`);
        // Load initial data just to be ready
        loadCards(); console.log(`[DEBUG] After loadCards, mainDeck size: ${gameState.mainDeck.length}`);
    });
}

// Exposed for unit tests (test/server_rules.test.js). These are the passive-rule
// functions not covered by the skill_engine matrix.
module.exports = {
    calculateRollDetails,
    isHeroSkillRollSuccessful,
    meetsMonsterRequirements,
    checkWinCondition,
    loadCards,
    spawnMonsters,
    gameState,
    removePlayerAndResetMatch,
    isValidItemEquipTarget,
    clearUntilNextTurnProtections,
    playerHasEffectiveClass,
    RECONNECT_GRACE_MS,
    CHALLENGE_TIMEOUT_MS,
    getConnectedChallengeOpponentIds,
    haveAllConnectedChallengeOpponentsPassed,
    queueLightningLabrysPlayerChoice,
    queueLightningLabrysSacrifice,
    queuePassiveDraw,
    triggerPlayedCardMonsterPassives,
    attackCostAllowedTypes,
    canPayMonsterAttackCost,
    eligibleEndTurnMonsterEffects,
    restoreDragonWaspHero,
    completeLumberingDrawStep,
    resolveLumberingContinuation,
    resetGameForNextMatch,
};
