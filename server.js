const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createReconnectManager, RECONNECT_GRACE_MS } = require('./reconnect');
const fs = require('fs');
const path = require('path');
const { resolveSkill } = require('./card_effects');
const {
    executeSkill, executeMagic, hasOpponentHeroTarget, getTargetingSkillPlan, drawCardsWithPassives,
    triggerCrownedSerpent, prepareImmediateItemPlay, markButtonsFreePlay,
    returnEquippedItemToOwner
} = require('./skill_engine');
const ALL_CARDS = require('./cards.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    pingInterval: 25_000,
    pingTimeout: 60_000,
});

app.use(express.static(path.join(__dirname, 'public')));

function getPlayerName(gameState, id) {
    if (!gameState || !gameState.players || !gameState.players[id]) {
        return 'Player ' + id.substring(0, 4);
    }
    const p = gameState.players[id];
    return p.name && p.name !== 'Player' ? p.name : 'Player ' + id.substring(0, 4);
}
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

const CLASSES = ['Fighter', 'Bard', 'Guardian', 'Ranger', 'Thief', 'Wizard'];

const TARGETING_SKILLS = ['DESTROY_HERO', 'STEAL_HERO', 'MAGIC_DESTRUCTIVE', 'SKILL_MEOWZIO', 'SKILL_SHURIKITTY', 'SKILL_TIPSY_TOOTIE', 'SKILL_WHISKERS', 'SKILL_WIGGLES', 'SKILL_SERIOUS_GREY'];
// Skills whose executeSkill consumes targetData and resolves immediately (single
// player pick). Buttons/Plundering Puma/Sly Pickings/Lucky Bucky are NOT here:
// their executeSkill sets up its own pull-targeting (LOOK_AND_PULL/PUMA_PULL/
// CONDITIONAL_PULL), so listing them here caused a double player-selection that
// soft-locked (you picked once, then had no clickable opponent for the pull).
const PLAYER_TARGETING_SKILLS = ['PULL_CARD', 'SKILL_HEAVY_BEAR', 'TRADE_HANDS', 'SKILL_SHARP_FOX', 'SKILL_SILENT_SHADOW', 'SKILL_SLIPPERY_PAWS', 'SKILL_HOPPER'];
const DISCARD_TARGETING_SKILLS = ['SKILL_GUIDING_LIGHT', 'SKILL_RADIANT_HORN', 'SKILL_LOOKIE_ROOKIE', 'SKILL_BUN_BUN', 'MAGIC_CALL_FALLEN'];
const SELF_ITEM_TARGETING_SKILLS = ['SKILL_HOLY_CURSELIFTER'];
const MULTI_TARGETING_SKILLS = ['SKILL_FLUFFY'];

let PARTY_LEADERS = [];
let trackedCardsPlayed = [];

function registerCardPlayed(card) {
    if (!card) return;
    const playableTypes = ['Hero Card', 'Item Card', 'Cursed Item Card', 'Modifier Card', 'Magic Card', 'Challenge Card'];
    if (!playableTypes.includes(card.type)) return;
    if (card.id && !trackedCardsPlayed.includes(card.id)) {
        trackedCardsPlayed.push(card.id);
    }
}

// Card ids that have generated illustration art on disk (art-web/<id>.webp,
// produced by scripts/compress-art.js). Cards with art get `artUrl` and the
// client renders it edge-to-edge in the frame window; cards without it fall back
// to the old `imageUrl` card scan, which has to be zoom-cropped instead.
function loadGeneratedArtIds() {
    const dir = path.join(__dirname, 'public', 'assets', 'skin', 'cards', 'art-web');
    try {
        return new Set(
            fs.readdirSync(dir)
                .filter(f => f.endsWith('.webp'))
                .map(f => f.slice(0, -'.webp'.length))
        );
    } catch {
        return new Set();   // art not generated yet
    }
}

function loadCards() {
    const rawData = fs.readFileSync(path.join(__dirname, 'cards.json'), 'utf-8');
    const cards = JSON.parse(rawData);
    const artIds = loadGeneratedArtIds();

    // ALL_CARDS is a separate raw require of cards.json used for by-id lookups
    // (skill targets, debug injection, card inspection), so it needs artUrl too —
    // otherwise cards reached through those paths render the old wiki scan.
    ALL_CARDS.forEach(c => {
        if (artIds.has(c.id)) c.artUrl = `assets/skin/cards/art-web/${c.id}.webp`;
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

        if (artIds.has(card.id)) {
            card.artUrl = `assets/skin/cards/art-web/${card.id}.webp`;
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

    shuffle(gameState.mainDeck);
    shuffle(gameState.monsterDeck);
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function dealCards(count, playerSocketId) {
    const player = gameState.players[playerSocketId];
    if (count === 1 && gameState.state === 'PLAYING') {
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
    return (hero.equippedItem && maskClass(hero.equippedItem)) || hero.class;
}

// Decoy Doll (ITEM_DECOY): sacrifice the Doll to save the Hero from sacrifice/destroy.
// Auto-applied (always the better choice). Returns true if it absorbed the effect.
function consumeDecoyDoll(targetHero, action = 'DESTROY') {
    if (action === 'STEAL') return false;
    if (targetHero && targetHero.equippedItem && targetHero.equippedItem.effect_id === 'ITEM_DECOY') {
        gameState.discardPile.push(targetHero.equippedItem);
        targetHero.equippedItem = null;
        return true;
    }
    return false;
}

function checkWinCondition() {
    for (const socketId of gameState.playerOrder) {
        const p = gameState.players[socketId];

        // Condition 1: Slay 3 Monsters
        if (p.slainMonsters.length >= 3) {
            return { winnerId: p.id, reason: 'slayed 3 monsters' };
        }

        // Condition 2: 6 Different Classes in Party
        const classes = new Set();
        if (p.leader) classes.add(p.leader.class);
        p.party.forEach(hero => {
            const cls = effectiveHeroClass(hero);
            if (cls) classes.add(cls);
        });

        if (classes.size >= 6) {
            return { winnerId: p.id, reason: 'assembled 6 classes' };
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

    console.log(`\n[SIMULATION PROGRESS] Unique cards tested so far: ${trackedCardsPlayed.length} out of 115.`);
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
    gameState.activePlayerSocketId = null;
    gameState.winner = null;

    // Reset individual player stats but keep connections and order
    for (const playerId of gameState.playerOrder) {
        const player = gameState.players[playerId];
        if (player) {
            player.hand = [];
            player.party = [];
            player.slainMonsters = [];
            player.leader = null;
            player.ap = 0;
            player.hasSelectedLeader = false;
            player.hasRerolledLeader = false;
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
    gameState.state = 'PLAYING';
    gameState.pendingAction = null;
    gameState.pendingCard = null;
    gameState.challengePhase = false;
    gameState.modifierPhase = false;
    gameState.pendingChallenge = null;
}

function broadcastState() {
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
            winner: playerState.winner,
            me: socket.id,
            availableLeaders: (gameState.availableLeaders && gameState.availableLeaders.length > 0) ? gameState.availableLeaders : PARTY_LEADERS // Send for selection
        });
    });
}

function resolvePendingCard() {
    try {
        if (!gameState.pendingChallenge) return;

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
                    if (targetHero.equippedItem) {
                        gameState.discardPile.push(targetHero.equippedItem);
                    }
                    targetHero.equippedItem = card;
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
        });
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

    // 4. Check Global Item Effects (None currently modify rolls globally)

    // 5. Check Target-Specific Equipped Items
    if (context === 'HERO_SKILL' && targetCard && targetCard.equippedItem) {
        const item = targetCard.equippedItem;
        if (item.effect_id === 'ITEM_RING') {
            total += 2;
            breakdown.push({ source: item.name, value: 2 });
        } else if (item.effect_id === 'CURSE_SNAKE') {
            total -= 2;
            breakdown.push({ source: item.name, value: -2 });
        }
    }

    return { total, breakdown };
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

    if (passiveBonus !== 0 && type !== 'CHALLENGE') {
        io.emit('message', `[Passive/Magic Modifier] ${getPlayerName(gameState, player.id)} had a ${passiveBonus > 0 ? '+' : ''}${passiveBonus} passive bonus! Final roll: ${finalRoll}`);
    }

    if (type === 'HERO_SKILL') {
        const heroId = gameState.pendingRoll.targetHeroId;
        const hero = player.party.find(c => c.id === heroId);
        if (hero) {
            // Strictly enforce usage flag whether roll succeeds or fails
            hero.usedSkillThisTurn = true;
            
            if (finalRoll >= hero.roll_requirement) {
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
                            heroId: hero.id
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
                        gameState.state = 'WAITING_FOR_SKILL_TARGET';
                        gameState.pendingAction = {
                            type: 'SKILL_TARGET_MULTI',
                            originalActor: rollerId,
                            skillId: hero.skill_id,
                            heroId: hero.id
                        };
                        io.emit('message', `${getPlayerName(gameState, player.id)} successfully rolled for ${hero.name}! Waiting for them to select targets...`);
                        broadcastState();
                    } else if (DISCARD_TARGETING_SKILLS.includes(hero.skill_id) && gameState.discardPile.length > 0) {
                        gameState.state = 'WAITING_FOR_SKILL_TARGET';
                        gameState.pendingAction = {
                            type: 'SKILL_TARGET_DISCARD',
                            originalActor: rollerId,
                            skillId: hero.skill_id,
                            heroId: hero.id
                        };
                        io.emit('message', `${getPlayerName(gameState, player.id)} successfully rolled for ${hero.name}! Waiting for them to search the discard pile...`);
                        broadcastState();
                    } else {
                        // No targeting required, execute immediately!
                        executeSkill(gameState, io, hero.skill_id, rollerId, heroId, null);
                    }
                }
            } else {
                io.emit('message', `${getPlayerName(gameState, player.id)}'s skill roll for ${hero.name} failed! (Needed ${hero.roll_requirement}+, rolled ${finalRoll})`);
                
                // Check for Particularly Rusty Coin
                if (hero.equippedItem && hero.equippedItem.effect_id === 'ITEM_COIN_RUSTY') {
                    io.emit('message', `Particularly Rusty Coin allows ${getPlayerName(gameState, player.id)} to draw a card because the roll failed!`);
                    dealCards(1, rollerId);
                }

                io.emit('rollResult', { player: rollerId, roll: finalRoll, message: "Skill Roll Failed." });
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
                
                if (penaltyAction === 'SACRIFICE_HERO') {
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

// Apply the pre-reconnect disconnect fallback. Mid-match this deliberately
// keeps the remaining sockets in the lobby, but clears every per-match field and
// every board/pending-action field so a fresh match cannot inherit stale cards.
function removePlayerAndResetMatch(socketId) {
    if (!gameState.players[socketId]) return;
    const name = getPlayerName(gameState, socketId) || socketId.substring(0, 4);

    delete gameState.players[socketId];
    gameState.playerOrder = gameState.playerOrder.filter(id => id !== socketId);

    const clearBoard = () => {
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
        broadcastState();
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
        gameState.availableLeaders.push(oldLeader);

        if (gameState.availableLeaders.length > 0) {
            const randomIndex = Math.floor(Math.random() * gameState.availableLeaders.length);
            const chosenLeader = gameState.availableLeaders.splice(randomIndex, 1)[0];
            player.leader = chosenLeader;
            player.hasRerolledLeader = true;
            broadcastState();
        }
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
        if (card) { gameState.mainDeck.push({ ...card }); broadcastState(); }
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

        if (!isFree) player.ap -= 1;
        player.hand.splice(cardIndex, 1);
        
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
        if (hero.usedSkillThisTurn) {
            return;
        }
        // Sealing Key (CURSE_KEY): the equipped Hero cannot use its effect at all.
        if (hero.equippedItem && hero.equippedItem.effect_id === 'CURSE_KEY') {
            io.to(socket.id).emit('message', `${hero.name} is sealed by ${hero.equippedItem.name} and cannot use its effect!`);
            return;
        }

        if (!isFree) {
            if (player.ap < 1) {
                return;
            }
            player.ap -= 1;
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
            passedPlayers: []
        };

        broadcastState();
    });

    socket.on('submit_skill_target', (targetData) => {
        if (gameState.state !== 'WAITING_FOR_SKILL_TARGET') return;
        if (socket.id !== gameState.activePlayerSocketId) return;
        if (!gameState.pendingAction) return;

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

        // Reset state
        resetToPlayingState();
        executeSkill(gameState, io, skillId, rollerId, heroId, targetData);
        broadcastState();
    });

    socket.on('select_peek_card', ({ cardId, skillId }) => {
        if (gameState.state !== 'PLAYING') return;
        const player = gameState.players[socket.id];
        if (!player) return;

        // Verify the user was peeking from BULLSEYE (top 3 cards)
        if (skillId === 'SKILL_BULLSEYE') {
            const cardIndex = gameState.mainDeck.findIndex(c => c.id === cardId);
            if (cardIndex !== -1) {
                // Technically Bullseye says: Look at top 3, add 1, return other 2 to top in any order.
                // In our implementation, we'll just extract the chosen one from the top 3 and leave the other 2.
                const chosenCard = gameState.mainDeck.splice(cardIndex, 1)[0];
                player.hand.push(chosenCard);
                io.emit('message', `${getPlayerName(gameState, player.id)} selected a card from the deck using Bullseye's skill.`);
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

    socket.on('submit_global_action', (data) => {
        if (!gameState.pendingGlobalAction) return;
        const ga = gameState.pendingGlobalAction;
        const player = gameState.players[socket.id];
        
        if (!ga.pendingPlayerIds.includes(socket.id)) return;

        if (ga.type === 'MULTI_SACRIFICE') {
            const heroIndex = player.party.findIndex(h => h.id === data.targetHeroId);
            if (heroIndex === -1) return; // not a hero this player owns — ignore
            const sacrificed = player.party[heroIndex];
            if (consumeDecoyDoll(sacrificed, 'SACRIFICE')) {
                io.emit('message', `${getPlayerName(gameState, player.id)} discarded Decoy Doll instead of sacrificing ${sacrificed.name}.`);
            } else {
                player.party.splice(heroIndex, 1);
                if (sacrificed.equippedItem) {
                    gameState.discardPile.push(sacrificed.equippedItem);
                    sacrificed.equippedItem = null;
                }
                gameState.discardPile.push(sacrificed);
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
        
        player.ap -= 2;

        gameState.state = 'WAITING_TO_ROLL';
        gameState.pendingRoll = {
            type: 'ATTACK',
            rollerId: socket.id,
            targetId: monster.id,
            roll1: 0,
            roll2: 0,
            passiveBonus: 0,
            modifierTotal: 0,
            baseRoll: 0,
            currentRoll: 0,
            passedPlayers: []
        };

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
            startModifierTimer();
            broadcastState();
        } 
        // NEW LOGIC FOR DUAL CHALLENGE ROLLS
        else if (gameState.state === 'WAITING_TO_ROLL_CHALLENGE') {
            const pRoll = gameState.pendingRoll;
            let rolled = false;
            
            if (socket.id === pRoll.activeId && !pRoll.activeRolled) {
                pRoll.activeBase = Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + 1;
                const p = gameState.players[pRoll.activeId];
                if (p && p.leader && p.leader.effect_id === 'LEADER_FIGHTER') pRoll.activeBase += 2;
                if (p && p.slainMonsters && p.slainMonsters.some(m => m.effect_id === 'MONSTER_TITAN_WYVERN')) pRoll.activeBase += 1;
                pRoll.activeRolled = true;
                rolled = true;
            } else if (socket.id === pRoll.challengerId && !pRoll.challengerRolled) {
                pRoll.challengerBase = Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + 1;
                const p = gameState.players[pRoll.challengerId];
                if (p && p.leader && p.leader.effect_id === 'LEADER_FIGHTER') pRoll.challengerBase += 2;
                if (p && p.slainMonsters && p.slainMonsters.some(m => m.effect_id === 'MONSTER_TITAN_WYVERN')) pRoll.challengerBase += 1;
                pRoll.challengerRolled = true;
                rolled = true;
            }

            if (rolled && pRoll.activeRolled && pRoll.challengerRolled) {
                gameState.state = 'WAITING_FOR_MODIFIERS';
                gameState.passedModifiers = [];
                io.emit('dice_roll_pending', {
                    isChallenge: true, type: 'CHALLENGE',
                    activeId: pRoll.activeId, activeName: getPlayerName(gameState, pRoll.activeId),
                    activeTotal: pRoll.activeBase, activeModifierTotal: 0, activeFinalTotal: pRoll.activeBase,
                    challengerId: pRoll.challengerId, challengerName: getPlayerName(gameState, pRoll.challengerId),
                    challengerTotal: pRoll.challengerBase, challengerModifierTotal: 0, challengerFinalTotal: pRoll.challengerBase,
                    reason: 'for a CHALLENGE!'
                });
                startModifierTimer();
            }
            broadcastState();
        }
    });

/* --- MODIFIER / DICE PHASE --- */
    socket.on('submit_modifier_action', (data) => {
        if (gameState.state !== 'WAITING_FOR_MODIFIERS') return;
        if (!gameState.pendingRoll) return;

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
                    registerCardPlayed(card);

                // The player explicitly chooses which value to apply (a "+1/-3" card
                // can be played as +1 OR -3, on any roll — even a minus on your own).
                // Validate the chosen value against the card's allowed values; fall
                // back to the sole value for single-value cards (+4 / -4).
                let allowed = Array.isArray(card.modifier_values) ? card.modifier_values : [];
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

                if (player.leader && player.leader.effect_id === 'LEADER_GUARDIAN') {
                    if (modValue > 0) modValue += 1; else if (modValue < 0) modValue -= 1;
                }
                player.hand.splice(cardIndex, 1);
                gameState.discardPile.push(card);

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
                        activeTotal: gameState.pendingRoll.activeBase, activeModifierTotal: gameState.pendingRoll.activeModifiers, activeFinalTotal: aFinal,
                        challengerId: gameState.pendingRoll.challengerId, challengerName: getPlayerName(gameState, gameState.pendingRoll.challengerId),
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
        }

        // Check if ALL connected players have passed
        if (gameState.passedModifiers.length >= Object.keys(gameState.players).length) {

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
                gameState.pendingAction = null;
                player.hand.splice(cardIndex, 1);
                gameState.pendingCard = card;

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
            if (consumeDecoyDoll(targetHero, 'SACRIFICE')) {
                io.emit('message', `${getPlayerName(gameState, socket.id)} discarded Decoy Doll instead of sacrificing ${targetHero.name}!`);
            } else {
                if (targetHero.equippedItem) {
                    gameState.discardPile.push(targetHero.equippedItem);
                    targetHero.equippedItem = null;
                }
                player.party.splice(tHeroIndex, 1);
                gameState.discardPile.push(targetHero);
                io.emit('message', `${getPlayerName(gameState, socket.id)} sacrificed their ${targetHero.name} as a penalty!`);
            }
            
            resetToPlayingState();
            broadcastState();
        }
    });

    socket.on('submit_penalty_discard', (data) => {
        const player = gameState.players[socket.id];
        if (!player) return;

        const { cardIds } = data; // Expect an array of card IDs

        if (gameState.state === 'WAITING_FOR_DISCARD_PENALTY') {
            if (socket.id !== gameState.pendingAction.playerToChoose) return;
            if (!cardIds || !Array.isArray(cardIds) || cardIds.length !== gameState.pendingAction.amount) return;

            for (const cardId of cardIds) {
                const cardIndex = player.hand.findIndex(c => c.id === cardId);
                if (cardIndex !== -1) {
                    const card = player.hand.splice(cardIndex, 1)[0];
                    gameState.discardPile.push(card);
                }
            }
            
            io.emit('message', `${getPlayerName(gameState, socket.id)} discarded ${cardIds.length} card(s)!`);
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
            if (socket.id !== pAction.originalActor) return;
            if (!cardIds || !Array.isArray(cardIds) || cardIds.length > pAction.maxAmount) return;

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

            if (discardedCount > 0 && pAction.type === 'VARIABLE_DISCARD_TO_DESTROY') {
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
        registerCardPlayed(challengeCard);
        gameState.discardPile.push(challengeCard);

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

        if (gameState.pendingChallenge.passedPlayers.length >= Object.keys(gameState.players).length - 1) {
            io.emit('challenge_resolved', { message: `${gameState.pendingChallenge.card.name} was not challenged and resolves normally.` });
            resolvePendingCard();
        } else {
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
        
        if (pAction.type === 'DISCARD') {
            const cardIndex = player.hand.findIndex(c => c.id === targetId);
            if (cardIndex !== -1) {
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
                            gameState.players[pAction.originalActor].party.push(hero);
                            io.emit('message', `Stole ${hero.name}!`);
                        } else if (pAction.type === 'DESTROY') {
                            gameState.discardPile.push(hero);
                            if (hero.equippedItem) {
                                gameState.discardPile.push(hero.equippedItem);
                            }
                            io.emit('message', `Destroyed ${hero.name}!`);

                            const hasDracos = p.slainMonsters && p.slainMonsters.some(m => m.effect_id === 'MONSTER_DRACOS');
                            if (hasDracos) {
                                io.emit('message', `${getPlayerName(gameState, p.id)}'s Hero was destroyed, but they draw a card due to Dracos!`);
                                if (gameState.mainDeck.length > 0) p.hand.push(gameState.mainDeck.pop());
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
                drawCardsWithPassives(gameState, io, 1, player);
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

                        if (pulledCard.type === pAction.conditionType) {
                            if (pAction.actionOnSuccess === 'PLAY_IMMEDIATELY') {
                                io.emit('message', `The pulled card was a ${pAction.conditionType}! They may play it immediately!`);
                                gameState.state = 'WAITING_FOR_IMMEDIATE_PLAY';
                                gameState.pendingCard = pulledCard;
                                gameState.pendingAction = { playerToChoose: socket.id, type: 'IMMEDIATE_PLAY', originalActor: socket.id };
                                broadcastState();
                                return;
                            } else {
                                player.hand.push(pulledCard);
                                io.emit('message', `The pulled card was a ${pAction.conditionType}! They get to pull another card!`);
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
                            tp.hand.push(gameState.mainDeck.pop());
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

        // Pass turn
        const currentIndex = gameState.playerOrder.indexOf(gameState.activePlayerSocketId);
        const nextIndex = (currentIndex + 1) % gameState.playerOrder.length;
        gameState.activePlayerSocketId = gameState.playerOrder[nextIndex];
        
        // FORCE CLEAN STATE FOR NEW TURN
        resetToPlayingState();
        gameState.pendingRoll = null;
        gameState.pendingChallenge = null;
        gameState.pendingGlobalAction = null;
        gameState.pendingAction = null;
        gameState.waitingForInput = false;
        if (modifierTimer) clearTimeout(modifierTimer);
        
        // Reset AP and draw a card for the new player
        const currentPlayer = gameState.players[socket.id];
        currentPlayer.magicRollBonus = 0; // Clear at end of turn
        currentPlayer.rollBonus = 0;      // Wise Shield / Vibrant Glow expire at end of turn
        currentPlayer.rollBonusSources = [];
        currentPlayer.cannotBeChallenged = false; // Iron Resolve lasts only this turn
        currentPlayer.usedLeaderSkillThisTurn = false;
        
        const nextPlayer = gameState.players[gameState.activePlayerSocketId];
        nextPlayer.usedLeaderSkillThisTurn = false;
        let baseAP = 3;
        if (nextPlayer.slainMonsters && nextPlayer.slainMonsters.some(m => m.effect_id === 'MONSTER_MEGA_SLIME')) {
            baseAP = 4;
        }
        nextPlayer.ap = baseAP;

        // Force reset usedSkillThisTurn for ALL players just to be absolutely safe
        for (const pId in gameState.players) {
            gameState.players[pId].party.forEach(c => {
                if (c.type === 'Hero Card') c.usedSkillThisTurn = false;
            });
        }
        
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
    resetToPlayingState();
    gameState.waitingForInput = false;
    gameState.pendingRoll = null;
    gameState.pendingChallenge = null;
    gameState.pendingGlobalAction = null;
    if (modifierTimer) clearTimeout(modifierTimer);

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
    meetsMonsterRequirements,
    checkWinCondition,
    loadCards,
    spawnMonsters,
    gameState,
    removePlayerAndResetMatch,
    RECONNECT_GRACE_MS,
};
