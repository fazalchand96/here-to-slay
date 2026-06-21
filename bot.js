const io = require('socket.io-client');
const randomId = Math.floor(1000 + Math.random() * 9000);
const botName = process.argv[2] || `TestBot_${randomId}`;
const SERVER_URL = process.argv[3] || 'http://localhost:3000';

console.log(`[${botName}] Connecting to server at ${SERVER_URL}...`);
const socket = io(SERVER_URL);

// State tracking variables
let latestPlayersState = null;
let isThinking = false;
let lastChallengeId = null;
let lastRollSignature = null;
let passedThisRoll = false;
let hasDecidedReroll = false;
let hasStartedGame = false;
let latestData = null; // last full gameStateUpdate, used by the self-recovery tick below

// Helper to determine if a player meets a monster's class/hero requirements
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
                if (card.class) availableClasses.push(card.class);
            }
        });
    }

    // 2. Parse the requirement string
    const conditions = reqString.split(',').map(s => s.trim());
    for (let cond of conditions) {
        const match = cond.match(/(\d+)\s+(.+)/);
        if (!match) continue;
        
        const requiredCount = parseInt(match[1], 10);
        let requiredType = match[2];
        
        if (requiredType === 'Heroes') requiredType = 'Hero';

        if (requiredType === 'Hero') {
            if (heroCount < requiredCount) return false;
        } else {
            const classCount = availableClasses.filter(c => c === requiredType).length;
            if (classCount < requiredCount) return false;
        }
    }

    return true;
}

// Selects target ID for pending actions (discards, steals, return item, etc.)
function selectTargetForPendingAction(data) {
    const pAction = data.pendingAction;
    if (!pAction || pAction.playerToChoose !== socket.id) return null;

    if (pAction.type === 'DISCARD') {
        const p = data.players[socket.id];
        if (p && p.hand && p.hand.length > 0) {
            return p.hand[0].id;
        }
    }
    else if (['FORCE_DISCARD_TARGET', 'CONDITIONAL_PULL', 'PUMA_PULL', 'LOOK_AND_PULL', 'SKILL_TARGET_PLAYER', 'STEAL_FROM_ALL', 'TRADE_HANDS'].includes(pAction.type)) {
        const opponentIds = data.playerOrder.filter(id => id !== socket.id);
        if (opponentIds.length > 0) {
            return opponentIds[Math.floor(Math.random() * opponentIds.length)];
        }
    }
    else if (['DESTROY', 'STEAL', 'EXCHANGE_STEP_1', 'SKILL_TARGET_HERO'].includes(pAction.type)) {
        const opponentIds = data.playerOrder.filter(id => id !== socket.id);
        const opponentHeroes = [];
        opponentIds.forEach(oid => {
            const p = data.players[oid];
            if (p && p.party) {
                p.party.forEach(h => opponentHeroes.push(h.id));
            }
        });
        if (opponentHeroes.length > 0) {
            return opponentHeroes[Math.floor(Math.random() * opponentHeroes.length)];
        }
    }
    else if (pAction.type === 'EXCHANGE_STEP_2') {
        const p = data.players[socket.id];
        if (p && p.party && p.party.length > 0) {
            return p.party[Math.floor(Math.random() * p.party.length)].id;
        }
    }
    else if (pAction.type === 'RETURN_ITEM' || pAction.type === 'SKILL_TARGET_SELF_ITEM') {
        const heroesWithItems = [];
        data.playerOrder.forEach(id => {
            const p = data.players[id];
            if (p && p.party) {
                p.party.forEach(h => {
                    if (h.equippedItem) {
                        heroesWithItems.push(h.id);
                    }
                });
            }
        });
        if (heroesWithItems.length > 0) {
            return heroesWithItems[Math.floor(Math.random() * heroesWithItems.length)];
        }
    }
    return null;
}

// Executes a turn action randomly: 40% attack, 30% play Hero/Magic card, 30% draw card
function executeTurnAction(data, player) {
    const attackableMonsters = (data.activeMonsters || []).filter(m => meetsMonsterRequirements(player, m.requirement));
    const playableCards = (player.hand || []).filter(c => c.type === 'Hero Card' || c.type === 'Magic Card');

    console.log(`[${botName}] Hand: ${player.hand ? player.hand.length : 0} cards, AP: ${player.ap}`);
    console.log(`[${botName}] Available attackable monsters: ${attackableMonsters.length}, Playable cards: ${playableCards.length}`);

    const r = Math.random();

    // 40% chance to attack (costs 2 AP)
    if (r < 0.4 && player.ap >= 2 && attackableMonsters.length > 0) {
        const targetMonster = attackableMonsters[Math.floor(Math.random() * attackableMonsters.length)];
        console.log(`[${botName}] Turn: Attacking monster '${targetMonster.name}'...`);
        socket.emit('attackMonster', targetMonster.id);
    }
    // 30% chance to play Hero/Magic card (costs 1 AP)
    else if (r < 0.7 && player.ap >= 1 && playableCards.length > 0) {
        const targetCard = playableCards[Math.floor(Math.random() * playableCards.length)];
        console.log(`[${botName}] Turn: Playing card '${targetCard.name}'...`);
        socket.emit('playCard', targetCard.id);
        socket.emit('playCard', { cardId: targetCard.id, isFree: false });
    }
    // 30% chance to draw card (costs 1 AP) or fallback
    else if (player.ap >= 1) {
        console.log(`[${botName}] Turn: Drawing a card...`);
        socket.emit('draw_card_action');
        socket.emit('drawCard');
    }
    // Fallback if conditions above aren't met but AP > 0
    else {
        if (playableCards.length > 0 && player.ap >= 1) {
            const targetCard = playableCards[Math.floor(Math.random() * playableCards.length)];
            console.log(`[${botName}] Fallback: Playing card '${targetCard.name}'...`);
            socket.emit('playCard', targetCard.id);
            socket.emit('playCard', { cardId: targetCard.id, isFree: false });
        } else if (player.ap >= 1) {
            console.log(`[${botName}] Fallback: Drawing a card...`);
            socket.emit('draw_card_action');
            socket.emit('drawCard');
        } else {
            console.log(`[${botName}] Fallback: Ending turn.`);
            socket.emit('end_turn');
            socket.emit('endTurn');
        }
    }
}

socket.on('connect', () => {
    console.log(`[${botName}] Connected! Socket ID: ${socket.id}`);
    console.log(`[${botName}] Setting player name to '${botName}'...`);
    socket.emit('set_player_name', botName);
});

function handleGameState(data) {
    latestPlayersState = data.players;
    latestData = data;
    const myId = data.me || socket.id;
    if (!myId || !data.players) return;

    if (data.state === 'GAMEOVER') {
        console.log(`[${botName}] Match ended! Winner is ${data.winner === myId ? 'ME!' : (data.winner || 'Unknown')}. Clearing local state...`);
        latestPlayersState = null;
        isThinking = false;
        lastChallengeId = null;
        lastRollSignature = null;
        passedThisRoll = false;
        hasDecidedReroll = false;
        hasStartedGame = false;
        return;
    }

    const player = data.players[myId];
    if (!player) return;

    // Reset lobby states if we move to playing
    if (data.state !== 'LOBBY') {
        hasDecidedReroll = false;
        hasStartedGame = false;
    }

    const delay = Math.floor(Math.random() * 300) + 200; // 200-500ms delay

    // --- LOBBY STATE AUTOMATION ---
    if (data.state === 'LOBBY') {
        if (!player.leader && !player.hasSelectedLeader) {
            if (!isThinking) {
                isThinking = true;
                setTimeout(() => {
                    console.log(`[${botName}] Lobby: Rolling for a Party Leader...`);
                    socket.emit('roll_leader');
                    isThinking = false;
                }, delay);
            }
        } else if (player.leader && !player.hasRerolledLeader && !hasDecidedReroll) {
            hasDecidedReroll = true;
            if (!isThinking) {
                isThinking = true;
                setTimeout(() => {
                    const shouldReroll = Math.random() < 0.5;
                    if (shouldReroll) {
                        console.log(`[${botName}] Lobby: Decided to reroll leader '${player.leader.name}'!`);
                        socket.emit('reroll_leader');
                    } else {
                        console.log(`[${botName}] Lobby: Keeping leader '${player.leader.name}'.`);
                    }
                    isThinking = false;
                }, delay);
            }
        }

        // Host check: First socket in playerOrder emits start_game when all players are ready
        if (data.playerOrder && data.playerOrder[0] === myId && !hasStartedGame) {
            const allReady = data.playerOrder.every(id => data.players[id] && data.players[id].hasSelectedLeader);
            if (allReady && data.playerOrder.length >= 2) {
                hasStartedGame = true;
                setTimeout(() => {
                    console.log(`[${botName}] Host: All players ready. Emitting 'start_game'...`);
                    socket.emit('start_game');
                }, delay);
            }
        }
        return;
    }

    // --- PLAYING STATE AUTOMATION ---
    if (data.state === 'PLAYING') {
        const isMyTurn = (data.activePlayerSocketId === myId || data.activePlayer === myId);

        // Handle targeting when card effects or rules prompt us to choose
        if (data.pendingAction && data.pendingAction.playerToChoose === myId) {
            if (!isThinking) {
                isThinking = true;
                setTimeout(() => {
                    const targetId = selectTargetForPendingAction(data);
                    if (targetId) {
                        console.log(`[${botName}] Pending Action (${data.pendingAction.type}): Selecting target '${targetId}'...`);
                        socket.emit('target_selected', targetId);
                    } else {
                        console.log(`[${botName}] Pending Action (${data.pendingAction.type}): No valid target found.`);
                    }
                    isThinking = false;
                }, delay);
            }
            return;
        }

        // Normal Turn Logic
        if (isMyTurn && !data.pendingAction) {
            if (player.ap === 0) {
                if (!isThinking) {
                    isThinking = true;
                    setTimeout(() => {
                        console.log(`[${botName}] AP is 0. Ending turn.`);
                        socket.emit('end_turn');
                        socket.emit('endTurn');
                        isThinking = false;
                    }, delay);
                }
            } else if (player.ap > 0) {
                if (!isThinking) {
                    isThinking = true;
                    setTimeout(() => {
                        executeTurnAction(data, player);
                        isThinking = false;
                    }, delay);
                }
            }
        }
    }

    // --- SKILL TARGET SELECTION PHASE AUTOMATION ---
    if (data.state === 'WAITING_FOR_SKILL_TARGET') {
        const isMyTurn = (data.activePlayerSocketId === myId || data.activePlayer === myId);
        if (isMyTurn && data.pendingAction) {
            if (!isThinking) {
                isThinking = true;
                setTimeout(() => {
                    const type = data.pendingAction.type;
                    let targetData = {};

                    if (type === 'SKILL_TARGET_HERO') {
                        const opponents = data.playerOrder.filter(id => id !== myId);
                        for (const oid of opponents) {
                            const op = data.players[oid];
                            if (op && op.party && op.party.length > 0) {
                                targetData.targetPlayerId = oid;
                                targetData.targetHeroId = op.party[0].id;
                                break;
                            }
                        }
                    } else if (type === 'SKILL_TARGET_PLAYER') {
                        const opponents = data.playerOrder.filter(id => id !== myId);
                        if (opponents.length > 0) {
                            targetData.targetPlayerId = opponents[Math.floor(Math.random() * opponents.length)];
                        }
                    } else if (type === 'SKILL_TARGET_SELF_ITEM') {
                        if (player.party) {
                            const heroWithItem = player.party.find(h => h.equippedItem);
                            if (heroWithItem) {
                                targetData.targetHeroId = heroWithItem.id;
                            }
                        }
                    } else if (type === 'SKILL_TARGET_MULTI') {
                        const targetHeroIds = [];
                        const opponents = data.playerOrder.filter(id => id !== myId);
                        opponents.forEach(oid => {
                            const op = data.players[oid];
                            if (op && op.party) {
                                op.party.forEach(h => targetHeroIds.push(h.id));
                            }
                        });
                        targetData.targetHeroIds = targetHeroIds.slice(0, 2);
                    }

                    console.log(`[${botName}] WAITING_FOR_SKILL_TARGET (${type}): Emitting submit_skill_target with data:`, targetData);
                    socket.emit('submit_skill_target', targetData);
                    isThinking = false;
                }, 500); // 500ms delay
            }
        }
    }

    // --- HAND SELECTION PHASE AUTOMATION ---
    if (data.state === 'WAITING_FOR_HAND_SELECTION') {
        if (data.pendingAction && data.pendingAction.playerToChoose === myId) {
            if (!isThinking) {
                isThinking = true;
                setTimeout(() => {
                    const allowedTypes = data.pendingAction.allowedTypes || [];
                    const validCards = (player.hand || []).filter(c => allowedTypes.includes(c.type));
                    
                    if (validCards.length > 0) {
                        const chosenCard = validCards[Math.floor(Math.random() * validCards.length)];
                        console.log(`[${botName}] WAITING_FOR_HAND_SELECTION: Playing card '${chosenCard.name}'...`);
                        socket.emit('play_from_hand', { cardId: chosenCard.id });
                    } else {
                        console.log(`[${botName}] WAITING_FOR_HAND_SELECTION: No valid cards of type ${allowedTypes.join(', ')}. Canceling.`);
                        socket.emit('play_from_hand', { cancel: true });
                    }
                    isThinking = false;
                }, 500); // 500ms delay
            }
        }
        return;
    }

    // --- REACTION PHASE AUTOMATION ---

    // 1. Challenge Phase
    if (data.state === 'WAITING_FOR_CHALLENGES') {
        if (data.pendingChallenge && data.pendingChallenge.rollerId !== myId) {
            const challengeId = data.pendingChallenge.card.id;
            if (challengeId !== lastChallengeId) {
                lastChallengeId = challengeId;
                if (!isThinking) {
                    isThinking = true;
                    setTimeout(() => {
                        const challengeCards = (player.hand || []).filter(c => c.type === 'Challenge Card');
                        const shouldChallenge = Math.random() < 0.5 && challengeCards.length > 0;
                        if (shouldChallenge) {
                            const chosenCard = challengeCards[Math.floor(Math.random() * challengeCards.length)];
                            console.log(`[${botName}] Challenge phase: Challenging '${data.pendingChallenge.card.name}' with '${chosenCard.name}'...`);
                            socket.emit('play_challenge', chosenCard.id);
                        } else {
                            console.log(`[${botName}] Challenge phase: Passing challenge for '${data.pendingChallenge.card.name}'`);
                            socket.emit('pass_challenge');
                        }
                        isThinking = false;
                    }, delay);
                }
            }
        }
        return;
    }

    // 2. Manual Roll Request
    if (data.state === 'WAITING_TO_ROLL') {
        if (data.pendingRoll && data.pendingRoll.rollerId === myId) {
            if (!isThinking) {
                isThinking = true;
                setTimeout(() => {
                    console.log(`[${botName}] Roll required: Rolling dice...`);
                    socket.emit('execute_roll');
                    isThinking = false;
                }, delay);
            }
        }
        return;
    }

    // 3. Challenge Duel Roll Request
    if (data.state === 'WAITING_TO_ROLL_CHALLENGE') {
        if (data.pendingRoll) {
            const isMyTurnToRoll = (data.pendingRoll.activeId === myId && !data.pendingRoll.activeRolled) ||
                                 (data.pendingRoll.challengerId === myId && !data.pendingRoll.challengerRolled);
            if (isMyTurnToRoll) {
                if (!isThinking) {
                    isThinking = true;
                    setTimeout(() => {
                        console.log(`[${botName}] Challenge roll required: Rolling dice...`);
                        socket.emit('execute_roll');
                        isThinking = false;
                    }, delay);
                }
            }
        }
        return;
    }

    // 4. Discard Penalties
    if (data.state === 'WAITING_FOR_DISCARD_PENALTY' || data.state === 'WAITING_FOR_MULTIPLE_DISCARDS' || data.state === 'WAITING_FOR_VARIABLE_DISCARD') {
        const pAction = data.pendingAction;
        if (pAction) {
            // Each discard state tracks "who must act" with a different field on pendingAction:
            //   WAITING_FOR_DISCARD_PENALTY  -> playerToChoose (single player)
            //   WAITING_FOR_MULTIPLE_DISCARDS-> targets[] / completed[] (everyone targeted)
            //   WAITING_FOR_VARIABLE_DISCARD -> originalActor (the player who triggered it)
            let mustAct = false;
            if (data.state === 'WAITING_FOR_DISCARD_PENALTY') {
                mustAct = pAction.playerToChoose === myId;
            } else if (data.state === 'WAITING_FOR_MULTIPLE_DISCARDS') {
                mustAct = Array.isArray(pAction.targets) && pAction.targets.includes(myId) &&
                          !(Array.isArray(pAction.completed) && pAction.completed.includes(myId));
            } else if (data.state === 'WAITING_FOR_VARIABLE_DISCARD') {
                mustAct = pAction.originalActor === myId;
            }

            if (mustAct && !isThinking) {
                isThinking = true;
                setTimeout(() => {
                    const requiredCount = pAction.amount || pAction.maxAmount || 1;
                    const cardIds = (player.hand || []).slice(0, requiredCount).map(c => c.id);
                    console.log(`[${botName}] Discard required (${data.state}): Submitting discard of ${cardIds.length} card(s)...`);
                    socket.emit('submit_penalty_discard', { cardIds });
                    isThinking = false;
                }, delay);
            }
        }
        return;
    }

    // 5. Sacrifice Penalties
    if (data.state === 'WAITING_FOR_SACRIFICE') {
        if (data.pendingAction && data.pendingAction.playerToChoose === myId) {
            if (!isThinking) {
                isThinking = true;
                setTimeout(() => {
                    if (player.party && player.party.length > 0) {
                        const chosenHero = player.party[0];
                        console.log(`[${botName}] Sacrifice required: Sacrificing hero '${chosenHero.name}'...`);
                        socket.emit('submit_penalty_sacrifice', { targetHeroId: chosenHero.id });
                    }
                    isThinking = false;
                }, delay);
            }
        }
        return;
    }

    // 6. Draw/Play Immediate Choice
    if (data.state === 'WAITING_FOR_IMMEDIATE_PLAY') {
        if (data.pendingAction && data.pendingAction.playerToChoose === myId) {
            if (!isThinking) {
                isThinking = true;
                setTimeout(() => {
                    console.log(`[${botName}] Immediate play choice: Emitting resolve_immediate_play...`);
                    socket.emit('resolve_immediate_play', { playNow: true });
                    isThinking = false;
                }, delay);
            }
        }
        return;
    }

    // 7. Global Actions Discard / Sacrifice
    if (data.state === 'WAITING_FOR_GLOBAL_ACTION' && data.pendingGlobalAction) {
        const ga = data.pendingGlobalAction;
        if (ga.pendingPlayerIds && ga.pendingPlayerIds.includes(myId)) {
            if (!isThinking) {
                isThinking = true;
                setTimeout(() => {
                    if (ga.type === 'MULTI_DISCARD' || ga.type === 'MULTI_DISCARD_AND_CHOOSE' || ga.type === 'MULTI_GIVE') {
                        if (player.hand && player.hand.length > 0) {
                            const chosenCard = player.hand[0];
                            console.log(`[${botName}] Global Action: Submitting card '${chosenCard.name}'...`);
                            socket.emit('submit_global_action', { cardId: chosenCard.id });
                        }
                    } else if (ga.type === 'MULTI_SACRIFICE') {
                        if (player.party && player.party.length > 0) {
                            const chosenHero = player.party[0];
                            console.log(`[${botName}] Global Action: Sacrificing hero '${chosenHero.name}'...`);
                            socket.emit('submit_global_action', { targetHeroId: chosenHero.id });
                        }
                    }
                    isThinking = false;
                }, delay);
            }
        }
        // Initiator resolving MULTI_DISCARD_AND_CHOOSE choice pool
        if (ga.initiatorId === myId && ga.awaitingChoice && ga.submittedCards && ga.submittedCards.length > 0 && ga.type === 'MULTI_DISCARD_AND_CHOOSE') {
            if (!isThinking) {
                isThinking = true;
                setTimeout(() => {
                    const chosen = ga.submittedCards[0];
                    console.log(`[${botName}] Global Action Resolve: Selecting pool card '${chosen.name}'...`);
                    socket.emit('resolve_global_action', { cardId: chosen.id });
                    isThinking = false;
                }, delay);
            }
        }
        return;
    }
}

socket.on('gameStateUpdate', handleGameState);

// Self-recovery tick: the bot only acts in response to gameStateUpdate events, gated by
// the shared `isThinking` flag. If an update arrives while the bot is busy (e.g. a lobby
// reroll is still pending when the game starts), it gets skipped — and since no player
// acts, the server sends no further update, so the active bot would wait forever.
// Re-running the handler against the last known state on a timer breaks that deadlock.
// All action branches are guarded by `isThinking` and server-side state checks, so
// re-evaluating an unchanged state is idempotent.
setInterval(() => {
    if (latestData && !isThinking) {
        handleGameState(latestData);
    }
}, 1500);

// Modifier/Dice Roll Phase (Reacting to roll outcomes)
socket.on('dice_roll_pending', (data) => {
    const signature = `${data.rollerId || ''}-${data.reason || ''}-${data.finalTotal || data.activeFinalTotal || ''}`;
    if (signature !== lastRollSignature) {
        lastRollSignature = signature;
        passedThisRoll = false;
    }

    if (!passedThisRoll) {
        passedThisRoll = true;
        
        const myId = socket.id;
        const player = latestPlayersState ? latestPlayersState[myId] : null;
        const modifierCards = (player && player.hand) ? player.hand.filter(c => c.type === 'Modifier Card') : [];

        const shouldPlay = Math.random() < 0.3 && modifierCards.length > 0;
        const delay = Math.floor(Math.random() * 300) + 200; // 200-500ms

        setTimeout(() => {
            if (shouldPlay) {
                const chosenCard = modifierCards[Math.floor(Math.random() * modifierCards.length)];
                console.log(`[${botName}] Modifier phase: Playing modifier '${chosenCard.name}'...`);
                
                let targetRoll = 'ACTIVE';
                if (data.isChallenge) {
                    if (myId === data.challengerId) {
                        targetRoll = 'CHALLENGER';
                    } else if (myId !== data.activeId) {
                        targetRoll = Math.random() < 0.5 ? 'ACTIVE' : 'CHALLENGER';
                    }
                }

                // Players now choose the value (e.g. +1 vs -3). Pick by intent: boost
                // the roll the bot wants to win, hurt the one it wants to lose.
                const values = Array.isArray(chosenCard.modifier_values) ? chosenCard.modifier_values : [];
                let helpingSelf;
                if (data.isChallenge) {
                    const mySide = (myId === data.activeId) ? 'ACTIVE'
                                 : (myId === data.challengerId) ? 'CHALLENGER' : null;
                    helpingSelf = mySide ? (targetRoll === mySide) : false; // 3rd party: hinder whichever side
                } else {
                    helpingSelf = (myId === data.rollerId);
                }
                const modValue = (values.length > 1)
                    ? (helpingSelf ? Math.max(...values) : Math.min(...values))
                    : values[0];

                socket.emit('submit_modifier_action', { action: 'PLAY', cardId: chosenCard.id, targetRoll, modValue });
            } else {
                console.log(`[${botName}] Modifier phase: Passing modifiers.`);
                socket.emit('pass_modifiers');
                socket.emit('submit_modifier_action', { action: 'PASS' });
            }
        }, delay);
    }
});

// Prompt roll for hero skill triggers
socket.on('heroPlayedPrompt', (data) => {
    console.log(`[${botName}] Skill trigger prompt: Roll for hero '${data.cardName}'?`);
    const delay = Math.floor(Math.random() * 300) + 200; // 200-500ms
    setTimeout(() => {
        const shouldRoll = Math.random() < 0.8;
        if (shouldRoll) {
            console.log(`[${botName}] Decided to roll for hero '${data.cardName}'.`);
            socket.emit('use_hero_skill', { cardId: data.cardId, isFree: true });
        } else {
            console.log(`[${botName}] Decided to decline roll for hero '${data.cardName}'.`);
            socket.emit('decline_hero_skill');
        }
    }, delay);
});

socket.on('disconnect', () => {
    console.log(`[${botName}] Disconnected from server.`);
});

socket.on('connect_error', (error) => {
    console.error(`[${botName}] Connection error:`, error.message);
});
