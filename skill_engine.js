const SAFE_MODE = false;

// Decoy Doll (ITEM_DECOY): if the equipped Hero would be sacrificed or destroyed,
// discard the Doll instead. It does not protect against stealing.
function consumeDecoyDoll(gameState, targetHero, action = 'DESTROY') {
    if (action === 'STEAL') return false;
    if (targetHero && targetHero.equippedItem && targetHero.equippedItem.effect_id === 'ITEM_DECOY') {
        gameState.discardPile.push(targetHero.equippedItem);
        targetHero.equippedItem = null;
        return true;
    }
    return false;
}

function hasOpponentHeroTarget(gameState, actorId, action = 'DESTROY') {
    return Object.entries(gameState.players || {}).some(([id, player]) => {
        if (id === actorId || !player) return false;
        if (!(player.party || []).some(card => card && card.type === 'Hero Card')) return false;
        if (action === 'STEAL') return !player.cannotBeStolen;
        if (player.cannotBeDestroyed) return false;
        return !(player.slainMonsters || []).some(monster => monster.effect_id === 'MONSTER_TERRATUGA');
    });
}

// keepItem: Shurikitty's special — when an equipped Item would be discarded by the
// destroy, the initiator takes it into hand instead.
function resolveDestroyAction(gameState, initiatorId, targetPlayerId, targetHeroId, keepItem = false) {
    const initiator = gameState.players[initiatorId];
    const targetPlayer = gameState.players[targetPlayerId];
    if (!initiator || !targetPlayer) return '';

    // Whole-party destroy protection (Mighty Blade / Terratuga). Centralised here so
    // every destroy path honours it (DESTROY_HERO/Fluffy also guard before calling;
    // Shurikitty/Whiskers/Serious Grey previously did NOT and bypassed protection).
    const protectedByBlade = targetPlayer.cannotBeDestroyed;
    const protectedByTerratuga = targetPlayer.slainMonsters
        && targetPlayer.slainMonsters.some(m => m.effect_id === 'MONSTER_TERRATUGA');
    if (protectedByBlade || protectedByTerratuga) {
        return `${initiatorId.substring(0, 4)} tried to destroy ${targetPlayerId.substring(0, 4)}'s Hero, but it is protected by ${protectedByBlade ? 'Mighty Blade' : 'Terratuga'}!`;
    }

    const tHeroIndex = targetPlayer.party.findIndex(h => h.id === targetHeroId);
    if (tHeroIndex === -1) return '';

    const targetHero = targetPlayer.party[tHeroIndex];
    let actionMessage = '';

    // Decoy Doll absorbs the destroy before Sabretooth can convert it.
    if (consumeDecoyDoll(gameState, targetHero)) {
        return `${initiatorId.substring(0, 4)} hit ${targetPlayerId.substring(0, 4)}'s ${targetHero.name}, but Decoy Doll was destroyed instead — the Hero survives!`;
    }

    const hasSabretooth = initiator.slainMonsters && initiator.slainMonsters.some(m => m.effect_id === 'MONSTER_CORRUPTED_SABRETOOTH');

    if (hasSabretooth) {
        targetPlayer.party.splice(tHeroIndex, 1);
        targetHero.usedSkillThisTurn = false;
        initiator.party.push(targetHero);
        actionMessage = `Corrupted Sabretooth turned a Destroy into a Steal! ${initiatorId.substring(0, 4)} STOLE ${targetPlayerId.substring(0, 4)}'s ${targetHero.name}!`;
    } else {
        let itemNote = '';
        if (targetHero.equippedItem) {
            if (keepItem) {
                initiator.hand.push(targetHero.equippedItem);
                itemNote = ` ${initiatorId.substring(0, 4)} took the equipped ${targetHero.equippedItem.name}!`;
            } else {
                gameState.discardPile.push(targetHero.equippedItem);
            }
            targetHero.equippedItem = null;
        }
        targetPlayer.party.splice(tHeroIndex, 1);
        gameState.discardPile.push(targetHero);
        actionMessage = `${initiatorId.substring(0, 4)} DESTROYED ${targetPlayerId.substring(0, 4)}'s ${targetHero.name}!${itemNote}`;

        const hasDracos = targetPlayer.slainMonsters && targetPlayer.slainMonsters.some(m => m.effect_id === 'MONSTER_DRACOS');
        if (hasDracos) {
            actionMessage += ` However, ${targetPlayerId.substring(0, 4)} drew a card due to Dracos!`;
            if (gameState.mainDeck.length > 0) targetPlayer.hand.push(gameState.mainDeck.pop());
        }
    }
    return actionMessage;
}

function executeSkill(gameState, io, skillId, rollerId, heroId, targetData) {
    if (SAFE_MODE) {
        console.log('Safe Mode active: Skill execution bypassed.');
        return { success: false, message: 'Skills are currently disabled.' };
    }
    const player = gameState.players[rollerId];
    if (!player) return;

    const hero = player.party.find(h => h.id === heroId);
    const heroName = hero ? hero.name : 'Unknown Hero';

    if (hero) {
        hero.usedSkillThisTurn = true;
    }

    console.log(`Executing skill ${skillId} for hero ${heroName} by player ${rollerId}`);
    let actionMessage = `${player.id.substring(0, 4)} successfully used ${heroName}'s skill!`;

    // Helper to draw cards securely
    const drawCards = (num, p) => {
        for(let i=0; i<num; i++) {
            if(gameState.mainDeck.length > 0) p.hand.push(gameState.mainDeck.pop());
        }
    };

    switch(skillId) {
        // --- FIGHTER CLASS SKILLS ---
        case 'SKILL_HEAVY_BEAR': {
            // The target player was already chosen via SKILL_TARGET_PLAYER (Heavy Bear
            // is in PLAYER_TARGETING_SKILLS). Consume that target directly — do NOT
            // open a second selection, or the caster gets asked to pick twice and the
            // flow soft-locks.
            const tp = targetData && targetData.targetPlayerId ? gameState.players[targetData.targetPlayerId] : null;
            if (tp && tp.hand.length > 0) {
                const amt = Math.min(2, tp.hand.length);
                gameState.state = 'WAITING_FOR_DISCARD_PENALTY';
                gameState.pendingAction = {
                    type: 'DISCARD',
                    playerToChoose: targetData.targetPlayerId,
                    amount: amt,
                    originalActor: rollerId
                };
                actionMessage = `${player.id.substring(0, 4)} forces ${tp.id.substring(0, 4)} to discard ${amt} card(s)!`;
            } else {
                gameState.state = 'PLAYING';
                gameState.pendingAction = null;
                actionMessage = `${tp ? tp.id.substring(0, 4) : 'The target'} has no cards to discard!`;
            }
            break;
        }

        case 'SKILL_BEAR_CLAW':
            gameState.state = 'PLAYING';
            gameState.pendingAction = {
                type: 'CONDITIONAL_PULL',
                conditionType: 'Hero Card',
                playerToChoose: rollerId,
                originalActor: rollerId
            };
            actionMessage = `${player.id.substring(0, 4)} is choosing a player to pull a card from!`;
            break;

        case 'SKILL_FURY_KNUCKLE':
            gameState.state = 'PLAYING';
            gameState.pendingAction = {
                type: 'CONDITIONAL_PULL',
                conditionType: 'Challenge Card',
                playerToChoose: rollerId,
                originalActor: rollerId
            };
            actionMessage = `${player.id.substring(0, 4)} is choosing a player to pull a card from!`;
            break;

        case 'SKILL_TOUGH_TEDDY':
            let teddyTargets = [];
            Object.keys(gameState.players).forEach(pId => {
                const p = gameState.players[pId];
                if (pId !== rollerId && p.party.some(c => c.class === 'Fighter') && p.hand.length > 0) {
                    teddyTargets.push(pId);
                }
            });
            if (teddyTargets.length > 0) {
                gameState.state = 'WAITING_FOR_MULTIPLE_DISCARDS';
                gameState.pendingAction = {
                    type: 'GLOBAL_CONDITIONAL_DISCARD',
                    amount: 1,
                    targets: teddyTargets,
                    completed: [],
                    originalActor: rollerId
                };
                actionMessage = `Tough Teddy forces opponents with Fighters to discard a card!`;
            } else {
                actionMessage = `Tough Teddy triggered, but no opponents have Fighters with cards in hand.`;
            }
            break;

        case 'SKILL_PAN_CHUCKS': {
            // "DRAW 2 cards. If at least one is a Challenge card, you MAY reveal it,
            // then DESTROY a Hero." The destroy is OPTIONAL (skippable) and only
            // offered when a Challenge was drawn AND a destroyable Hero exists.
            const drawn = [];
            for (let i = 0; i < 2 && gameState.mainDeck.length > 0; i++) {
                const c = gameState.mainDeck.pop();
                player.hand.push(c);
                drawn.push(c);
            }
            const drewChallenge = drawn.some(c => c.type === 'Challenge Card');
            let canDestroy = false;
            for (const pid in gameState.players) {
                if (pid === rollerId) continue;
                const op = gameState.players[pid];
                if (!op || op.cannotBeDestroyed) continue;
                if (op.slainMonsters && op.slainMonsters.some(m => m.effect_id === 'MONSTER_TERRATUGA')) continue;
                if ((op.party || []).some(h => h.type === 'Hero Card')) { canDestroy = true; break; }
            }
            if (drewChallenge && canDestroy) {
                gameState.state = 'PLAYING';
                gameState.pendingAction = {
                    type: 'DESTROY',
                    playerToChoose: rollerId,
                    originalActor: rollerId,
                    optional: true
                };
                actionMessage = `${player.id.substring(0, 4)} drew a Challenge via Pan Chucks — they MAY destroy a Hero (or skip).`;
            } else if (drewChallenge) {
                actionMessage = `${player.id.substring(0, 4)} drew a Challenge via Pan Chucks, but there are no Heroes to destroy.`;
            } else if (drawn.length > 0) {
                actionMessage = `${player.id.substring(0, 4)} drew ${drawn.length} card(s) via Pan Chucks, but no Challenge cards.`;
            } else {
                actionMessage = `The deck is empty — Pan Chucks drew nothing.`;
            }
            break;
        }

        case 'SKILL_QI_BEAR': {
            // "DISCARD up to 3 cards. For each card discarded, DESTROY a Hero." The
            // discard is the COST of destroying — so cap it to the number of
            // destroyable OPPONENT heroes (you can't destroy more than exist, and
            // shouldn't pay cards for nothing). If there are none, the skill does
            // nothing and you keep your cards.
            let destroyableOpp = 0;
            for (const pid in gameState.players) {
                if (pid === rollerId) continue;
                const op = gameState.players[pid];
                if (!op || op.cannotBeDestroyed) continue;
                if (op.slainMonsters && op.slainMonsters.some(m => m.effect_id === 'MONSTER_TERRATUGA')) continue;
                destroyableOpp += (op.party || []).filter(h => h.type === 'Hero Card').length;
            }
            const maxDiscard = Math.min(3, player.hand.length, destroyableOpp);
            if (maxDiscard > 0) {
                gameState.state = 'WAITING_FOR_VARIABLE_DISCARD';
                gameState.pendingAction = {
                    type: 'VARIABLE_DISCARD_TO_DESTROY',
                    maxAmount: maxDiscard,
                    playerToChoose: rollerId,
                    originalActor: rollerId
                };
                actionMessage = `${player.id.substring(0, 4)} can discard up to ${maxDiscard} card(s) to destroy that many Heroes.`;
            } else if (destroyableOpp === 0) {
                actionMessage = `${player.id.substring(0, 4)} used Qi Bear, but there are no opponent Heroes to destroy.`;
            } else {
                actionMessage = `${player.id.substring(0, 4)} has no cards to discard for Qi Bear!`;
            }
            break;
        }

        case 'SKILL_BEARY_WISE':
            let wiseTargets = [];
            Object.keys(gameState.players).forEach(pId => {
                if (pId !== rollerId && gameState.players[pId].hand.length > 0) {
                    wiseTargets.push(pId);
                }
            });
            if (wiseTargets.length > 0) {
                gameState.state = 'WAITING_FOR_GLOBAL_ACTION';
                gameState.pendingGlobalAction = { type: 'MULTI_DISCARD_AND_CHOOSE', initiatorId: rollerId, pendingPlayerIds: wiseTargets, submittedCards: [] };
                io.emit('global_action_requested', gameState.pendingGlobalAction);
                actionMessage = `Beary Wise forces opponents to discard into a pool!`;
            } else {
                actionMessage = `Opponents have no cards in hand for Beary Wise.`;
            }
            break;

        // --- 1. No Target / Self Buffs ---
        
        case 'SKILL_WILDSHOT':
            drawCards(3, player);
            gameState.state = 'PLAYING';
            gameState.pendingAction = { type: 'DISCARD', playerToChoose: rollerId, amount: 1, originalActor: rollerId };
            actionMessage = `${player.id.substring(0, 4)} drew 3 cards and must discard 1!`;
            break;
        case 'SKILL_GREEDY_CHEEKS':
            let greedyTargets = Object.keys(gameState.players).filter(pId => pId !== rollerId && gameState.players[pId].hand.length > 0);
            if (greedyTargets.length > 0) {
                gameState.state = 'WAITING_FOR_GLOBAL_ACTION';
                gameState.pendingGlobalAction = { type: 'MULTI_GIVE', initiatorId: rollerId, pendingPlayerIds: greedyTargets, submittedCards: [] };
                io.emit('global_action_requested', gameState.pendingGlobalAction);
                actionMessage = `Greedy Cheeks forces opponents to give a card to ${player.id.substring(0, 4)}!`;
            } else { actionMessage = `Opponents have no cards!`; }
            break;
        case 'SKILL_FUZZY_CHEEKS':
            drawCards(1, player);
            gameState.state = 'WAITING_FOR_HAND_SELECTION';
            gameState.pendingAction = { type: 'PLAY_FROM_HAND', allowedTypes: ['Hero Card'], playerToChoose: rollerId, originalActor: rollerId, optional: true };
            actionMessage = `${player.id.substring(0, 4)} drew a card and may play a Hero!`;
            break;
        case 'SKILL_HOOK':
            if (player.hand.some(c => c.type === 'Item Card')) {
                gameState.state = 'WAITING_FOR_HAND_SELECTION';
                gameState.pendingAction = { type: 'PLAY_FROM_HAND', allowedTypes: ['Item Card'], playerToChoose: rollerId, originalActor: rollerId, thenDraw: 1 };
                actionMessage = `${player.id.substring(0, 4)} must play an Item from hand, then draw a card!`;
            } else {
                drawCards(1, player);
                actionMessage = `${player.id.substring(0, 4)} had no Item to play with Hook, so they drew a card.`;
            }
            break;
        case 'SKILL_QUICK_DRAW': {
            // "DRAW 2 cards. If at least one of those cards is an item card, you may
            // play one of them immediately." The play option is conditional on one of
            // the TWO DRAWN cards being an Item — not on Items already in hand.
            const qdDrawn = [];
            for (let i = 0; i < 2 && gameState.mainDeck.length > 0; i++) {
                const c = gameState.mainDeck.pop();
                player.hand.push(c);
                qdDrawn.push(c);
            }
            if (qdDrawn.some(c => c.type === 'Item Card')) {
                gameState.state = 'WAITING_FOR_HAND_SELECTION';
                gameState.pendingAction = { type: 'PLAY_FROM_HAND', allowedTypes: ['Item Card'], playerToChoose: rollerId, originalActor: rollerId, optional: true };
                actionMessage = `${player.id.substring(0, 4)} drew 2 cards and may play an Item immediately!`;
            } else {
                actionMessage = `${player.id.substring(0, 4)} drew 2 cards with Quick Draw — no Item drawn, so nothing more happens.`;
            }
            break;
        }
        case 'SKILL_SNOWBALL':
            // "DRAW a card. If it is a Magic card, you may play it immediately and
            // DRAW a second card." The offer is conditional on the DRAWN card being
            // Magic — not on any Magic already in hand.
            if (gameState.mainDeck.length > 0) {
                const snowballCard = gameState.mainDeck.pop();
                if (snowballCard.type === 'Magic Card') {
                    gameState.state = 'WAITING_FOR_IMMEDIATE_PLAY';
                    gameState.pendingCard = snowballCard;
                    gameState.pendingAction = { type: 'IMMEDIATE_PLAY_CHOICE', playerToChoose: rollerId, thenDraw: 1 };
                    actionMessage = `${player.id.substring(0, 4)} drew a Magic card with Snowball and may play it immediately (then draw another)!`;
                } else {
                    player.hand.push(snowballCard);
                    actionMessage = `${player.id.substring(0, 4)} drew a card with Snowball — not a Magic card, so nothing more happens.`;
                }
            } else {
                actionMessage = `The deck is empty!`;
            }
            break;
case 'DRAW_CARD':
            drawCards(1, player);
            actionMessage = `${player.id.substring(0, 4)} used ${heroName}'s skill to draw a card.`;
            break;
        case 'DRAW_2_CARDS':
            drawCards(2, player);
            actionMessage = `${player.id.substring(0, 4)} used ${heroName}'s skill to draw 2 cards.`;
            break;
        case 'DRAW_AND_PLAY':
            if (gameState.mainDeck.length > 0) {
                const drawnCard = gameState.mainDeck.pop();
                if (drawnCard.type === 'Hero Card') {
                    gameState.state = 'WAITING_FOR_IMMEDIATE_PLAY';
                    gameState.pendingCard = drawnCard;
                    gameState.pendingAction = {
                        type: 'IMMEDIATE_PLAY_CHOICE',
                        playerToChoose: rollerId
                    };
                    actionMessage = `${player.id.substring(0, 4)} drew a Hero and can play it immediately!`;
                } else {
                    player.hand.push(drawnCard);
                    actionMessage = `${player.id.substring(0, 4)} drew a card.`;
                }
            } else {
                actionMessage = `The deck is empty!`;
            }
            break;
        case 'SKILL_NAPPING_NIBBLES':
            actionMessage = `${player.id.substring(0, 4)} used ${heroName}'s skill. It did absolutely nothing!`;
            break;
        case 'SKILL_CALMING_VOICE':
            // "Hero cards in your Party cannot be stolen until your next turn." - Requires lingering state.
            player.cannotBeStolen = true; // In a full implementation, we reset this on turn start.
            actionMessage = `${player.id.substring(0, 4)}'s Heroes cannot be stolen until their next turn!`;
            break;
        case 'SKILL_IRON_RESOLVE':
            player.cannotBeChallenged = true;
            actionMessage = `${player.id.substring(0, 4)}'s cards cannot be challenged for the rest of their turn!`;
            break;
        case 'SKILL_MIGHTY_BLADE':
            player.cannotBeDestroyed = true;
            actionMessage = `${player.id.substring(0, 4)}'s Heroes cannot be destroyed until their next turn!`;
            break;
        case 'SKILL_VIBRANT_GLOW':
            player.rollBonus = (player.rollBonus || 0) + 5;
            (player.rollBonusSources = player.rollBonusSources || []).push({ source: 'Vibrant Glow', value: 5 });
            actionMessage = `${player.id.substring(0, 4)} gained +5 to all rolls this turn!`;
            break;
        case 'SKILL_WISE_SHIELD':
            player.rollBonus = (player.rollBonus || 0) + 3;
            (player.rollBonusSources = player.rollBonusSources || []).push({ source: 'Wise Shield', value: 3 });
            actionMessage = `${player.id.substring(0, 4)} gained +3 to all rolls this turn!`;
            break;
        case 'SKILL_WILY_RED':
            while(player.hand.length < 7 && gameState.mainDeck.length > 0) {
                player.hand.push(gameState.mainDeck.pop());
            }
            actionMessage = `${player.id.substring(0, 4)} drew cards until they had 7 in their hand!`;
            break;
        case 'SKILL_SPOOKY':
            let spookyTargets = [];
            Object.keys(gameState.players).forEach(pId => {
                if (pId !== rollerId && gameState.players[pId].party.length > 0) {
                    spookyTargets.push(pId);
                }
            });
            if (spookyTargets.length > 0) {
                gameState.state = 'WAITING_FOR_GLOBAL_ACTION';
                gameState.pendingGlobalAction = { type: 'MULTI_SACRIFICE', initiatorId: rollerId, pendingPlayerIds: spookyTargets };
                io.emit('global_action_requested', gameState.pendingGlobalAction);
                actionMessage = `${player.id.substring(0, 4)}'s ${heroName} forced all other players to sacrifice a Hero!`;
            } else {
                actionMessage = `Opponents have no Heroes to sacrifice!`;
            }
            break;
        case 'STEAL_FROM_ALL':
            Object.values(gameState.players).forEach(p => {
                if (p.id !== rollerId && p.hand.length > 0) {
                    const randIndex = Math.floor(Math.random() * p.hand.length);
                    player.hand.push(p.hand.splice(randIndex, 1)[0]);
                }
            });
            actionMessage = `${player.id.substring(0, 4)} stole a random card from everyone's hand!`;
            break;
        case 'SKILL_SMOOTH_MIMIMEOW':
            Object.values(gameState.players).forEach(p => {
                if (p.id !== rollerId && p.party.some(h => h.class === 'Thief') && p.hand.length > 0) {
                    const randIndex = Math.floor(Math.random() * p.hand.length);
                    player.hand.push(p.hand.splice(randIndex, 1)[0]);
                }
            });
            actionMessage = `${player.id.substring(0, 4)} pulled a card from everyone with a Thief in their party!`;
            break;

        // --- 2. Opponent Hero Target ---
        
        case 'SKILL_MEOWZIO':
            // Card: "Choose a player. STEAL a Hero from that player and pull a card
            // from that player's hand." NOT a destroy, and the ROLLER pulls a card
            // (does not discard). Respect Calming Voice (cannotBeStolen).
            if (targetData && targetData.targetPlayerId && targetData.targetHeroId) {
                const tp = gameState.players[targetData.targetPlayerId];
                if (tp && tp.cannotBeStolen) {
                    actionMessage = `${player.id.substring(0, 4)} tried to use Meowzio, but ${tp.id.substring(0, 4)}'s Heroes are protected from stealing!`;
                } else if (tp) {
                    const tHeroIndex = tp.party.findIndex(h => h.id === targetData.targetHeroId);
                    if (tHeroIndex !== -1) {
                        const targetHero = tp.party[tHeroIndex];
                        tp.party.splice(tHeroIndex, 1);
                        targetHero.usedSkillThisTurn = false;
                        player.party.push(targetHero);
                        let msg = `${player.id.substring(0, 4)} used Meowzio to STEAL ${targetHero.name} from ${tp.id.substring(0, 4)}`;
                        if (tp.hand.length > 0) {
                            const randIndex = Math.floor(Math.random() * tp.hand.length);
                            const pulled = tp.hand.splice(randIndex, 1)[0];
                            player.hand.push(pulled);
                            msg += ` and pulled a card from their hand!`;
                        } else {
                            msg += ` (they had no cards in hand to pull).`;
                        }
                        actionMessage = msg;
                    }
                }
            }
            break;
        case 'SKILL_SHURIKITTY':
            // "DESTROY a Hero. If it had an Item equipped, add that Item to YOUR hand
            // instead of discarding it." keepItem=true routes the Item to the roller.
            if (targetData && targetData.targetPlayerId && targetData.targetHeroId) {
                actionMessage = resolveDestroyAction(gameState, rollerId, targetData.targetPlayerId, targetData.targetHeroId, true);
            }
            break;
        case 'SKILL_WHISKERS':
            // "STEAL a Hero card AND DESTROY a Hero card." The single targeted Hero is
            // STOLEN; then a second DESTROY target is chosen via the pending-action
            // flow (if any destroyable opponent Hero remains).
            if (targetData && targetData.targetPlayerId && targetData.targetHeroId) {
                const tp = gameState.players[targetData.targetPlayerId];
                if (tp && tp.cannotBeStolen) {
                    actionMessage = `${player.id.substring(0, 4)} tried to use Whiskers, but ${tp.id.substring(0, 4)}'s Heroes are protected from stealing!`;
                } else if (tp) {
                    const tHeroIndex = tp.party.findIndex(h => h.id === targetData.targetHeroId);
                    if (tHeroIndex !== -1) {
                        const targetHero = tp.party[tHeroIndex];
                        tp.party.splice(tHeroIndex, 1);
                        targetHero.usedSkillThisTurn = false;
                        player.party.push(targetHero);
                        actionMessage = `${player.id.substring(0, 4)} used Whiskers to STEAL ${targetHero.name} from ${tp.id.substring(0, 4)}`;
                    }
                }
                // Now set up the DESTROY half against a second Hero, if one exists.
                let canDestroy = false;
                for (const pid in gameState.players) {
                    if (pid === rollerId) continue;
                    const op = gameState.players[pid];
                    if (!op || op.cannotBeDestroyed) continue;
                    if (op.slainMonsters && op.slainMonsters.some(m => m.effect_id === 'MONSTER_TERRATUGA')) continue;
                    if ((op.party || []).some(h => h.type === 'Hero Card')) { canDestroy = true; break; }
                }
                if (canDestroy) {
                    gameState.state = 'PLAYING';
                    gameState.pendingAction = { type: 'DESTROY', playerToChoose: rollerId, originalActor: rollerId };
                    actionMessage += ` — now choose a Hero to DESTROY.`;
                } else {
                    actionMessage += ` (no Hero left to destroy).`;
                }
            }
            break;
        case 'SKILL_SERIOUS_GREY':
            // "DESTROY a Hero AND DRAW a card." The draw is unconditional (not gated on
            // the destroyed Hero having had an Item).
            if (targetData && targetData.targetPlayerId && targetData.targetHeroId) {
                actionMessage = resolveDestroyAction(gameState, rollerId, targetData.targetPlayerId, targetData.targetHeroId);
                drawCards(1, player);
                actionMessage += ` Serious Grey also drew a card.`;
            }
            break;
        case 'SKILL_WIGGLES':
            if (targetData && targetData.targetPlayerId && targetData.targetHeroId) {
                const tp = gameState.players[targetData.targetPlayerId];
                if (tp && !tp.cannotBeStolen) {
                    const tHeroIndex = tp.party.findIndex(h => h.id === targetData.targetHeroId);
                    if (tHeroIndex !== -1) {
                        const targetHero = tp.party[tHeroIndex];
                        tp.party.splice(tHeroIndex, 1);
                        targetHero.usedSkillThisTurn = false;
                        player.party.push(targetHero);
                        // "...and roll to use its effect immediately." Set up a FREE
                        // HERO_SKILL roll for the stolen Hero, exactly as the normal
                        // use_hero_skill flow would. The roller then triggers
                        // execute_roll; on success the stolen Hero's own skill
                        // resolves (with deferred targeting if it needs a target).
                        // Sealing Key (CURSE_KEY) still forbids using the effect.
                        if (targetHero.equippedItem && targetHero.equippedItem.effect_id === 'CURSE_KEY') {
                            actionMessage = `${player.id.substring(0, 4)} used Wiggles to STEAL ${targetHero.name}, but it is sealed (Sealing Key) and cannot be used!`;
                        } else {
                            gameState.state = 'WAITING_TO_ROLL';
                            gameState.pendingRoll = {
                                type: 'HERO_SKILL',
                                rollerId: rollerId,
                                targetHeroId: targetHero.id,
                                roll1: 0, roll2: 0, passiveBonus: 0, modifierTotal: 0,
                                baseRoll: 0, currentRoll: 0, passedPlayers: []
                            };
                            actionMessage = `${player.id.substring(0, 4)} used Wiggles to STEAL ${targetHero.name} — now roll to use its effect immediately!`;
                        }
                    }
                } else if (tp) {
                    actionMessage = `${tp.id.substring(0, 4)}'s Hero is protected from stealing!`;
                }
            }
            break;
        case 'SKILL_PLUNDERING_PUMA':
            gameState.state = 'PLAYING';
            gameState.pendingAction = { type: 'PUMA_PULL', playerToChoose: rollerId, originalActor: rollerId };
            actionMessage = `${player.id.substring(0, 4)} is choosing a player to pull 2 cards from!`;
            break;
        case 'SKILL_SLY_PICKINGS':
            gameState.state = 'PLAYING';
            gameState.pendingAction = { type: 'CONDITIONAL_PULL', conditionType: 'Item Card', actionOnSuccess: 'PLAY_IMMEDIATELY', playerToChoose: rollerId, originalActor: rollerId };
            actionMessage = `${player.id.substring(0, 4)} is choosing a player to pull a card from!`;
            break;
        case 'SKILL_BUTTONS':
            gameState.state = 'PLAYING';
            gameState.pendingAction = { type: 'LOOK_AND_PULL', playerToChoose: rollerId, originalActor: rollerId };
            actionMessage = `${player.id.substring(0, 4)} is choosing a player to look at their hand!`;
            break;
        case 'SKILL_LUCKY_BUCKY':
            gameState.state = 'PLAYING';
            gameState.pendingAction = { type: 'CONDITIONAL_PULL', conditionType: 'Hero Card', actionOnSuccess: 'PLAY_IMMEDIATELY', playerToChoose: rollerId, originalActor: rollerId };
            actionMessage = `${player.id.substring(0, 4)} is choosing a player to pull a card from!`;
            break;
case 'DESTROY_HERO':
            if (targetData && targetData.targetPlayerId && targetData.targetHeroId) {
                const tp = gameState.players[targetData.targetPlayerId];
                const targetHasTerratuga = tp && tp.slainMonsters && tp.slainMonsters.some(m => m.effect_id === 'MONSTER_TERRATUGA');
                if (targetHasTerratuga) {
                    actionMessage = `${player.id.substring(0, 4)} tried to destroy ${tp.id.substring(0, 4)}'s Hero, but they are protected by Terratuga!`;
                } else if (tp && !tp.cannotBeDestroyed) {
                    const tHeroIndex = tp.party.findIndex(h => h.id === targetData.targetHeroId);
                    if (tHeroIndex !== -1) {
                        actionMessage = resolveDestroyAction(gameState, rollerId, targetData.targetPlayerId, targetData.targetHeroId);
                    }
                } else if (tp && tp.cannotBeDestroyed) {
                     actionMessage = `${player.id.substring(0, 4)} tried to destroy ${tp.id.substring(0, 4)}'s Hero, but they are protected by Mighty Blade!`;
                }
            }
            break;
        case 'STEAL_HERO':
            if (targetData && targetData.targetPlayerId && targetData.targetHeroId) {
                const tp = gameState.players[targetData.targetPlayerId];
                if (tp && !tp.cannotBeStolen) {
                    const tHeroIndex = tp.party.findIndex(h => h.id === targetData.targetHeroId);
                    if (tHeroIndex !== -1) {
                        const targetHero = tp.party[tHeroIndex];
                        tp.party.splice(tHeroIndex, 1);
                        player.party.push(targetHero);
                        actionMessage = `${player.id.substring(0, 4)} STOLE ${targetHero.name} from ${tp.id.substring(0, 4)}!`;
                    }
                } else if (tp && tp.cannotBeStolen) {
                     actionMessage = `${player.id.substring(0, 4)} tried to steal ${tp.id.substring(0, 4)}'s Hero, but they are protected by Calming Voice!`;
                }
            }
            break;

        // --- 3. Opponent Player Target ---
        case 'PULL_CARD':
            if (targetData && targetData.targetPlayerId) {
                const tp = gameState.players[targetData.targetPlayerId];
                if (tp && tp.hand.length > 0) {
                    const randIndex = Math.floor(Math.random() * tp.hand.length);
                    const pulled = tp.hand.splice(randIndex, 1)[0];
                    player.hand.push(pulled);
                    actionMessage = `${player.id.substring(0, 4)} pulled a card from ${tp.id.substring(0, 4)}'s hand!`;
                    if (pulled.type === 'Hero Card' && tp.hand.length > 0) {
                        const randIndex2 = Math.floor(Math.random() * tp.hand.length);
                        player.hand.push(tp.hand.splice(randIndex2, 1)[0]);
                        actionMessage += ` It was a Hero, so they pulled a second card!`;
                    }
                }
            }
            break;
        // (Removed: a duplicate, unreachable `case 'SKILL_HEAVY_BEAR'` lived here.
        //  The live case above sets a FORCE_DISCARD_TARGET pending action.)
        case 'TRADE_HANDS':
            if (targetData && targetData.targetPlayerId) {
                const tp = gameState.players[targetData.targetPlayerId];
                if (tp) {
                    const temp = player.hand;
                    player.hand = tp.hand;
                    tp.hand = temp;
                    actionMessage = `${player.id.substring(0, 4)} traded hands with ${tp.id.substring(0, 4)}!`;
                }
            }
            break;
        case 'SKILL_SHARP_FOX':
            // Card: "Look at another player's hand." Information ONLY — Sharp Fox
            // steals nothing. Privately reveal the target's hand to the roller via a
            // view-only peek modal; the rest of the table sees only that a look happened.
            if (targetData && targetData.targetPlayerId) {
                const tp = gameState.players[targetData.targetPlayerId];
                if (tp) {
                    const tpName = tp.name || tp.id.substring(0, 4);
                    io.to(rollerId).emit('peek_cards', {
                        cards: tp.hand,
                        skillId: 'SKILL_SHARP_FOX',
                        viewOnly: true,
                        title: `${tpName}'s hand (${tp.hand.length} card${tp.hand.length === 1 ? '' : 's'})`,
                    });
                    actionMessage = `${player.id.substring(0, 4)} looked at ${tp.id.substring(0, 4)}'s hand!`;
                }
            }
            break;
        case 'SKILL_SILENT_SHADOW':
            // Card: "Look at another player's hand. Choose a card and add it to your
            // hand." Reveal the target's hand to the roller WITH selection enabled;
            // the chosen card is pulled from that exact player in select_peek_card.
            if (targetData && targetData.targetPlayerId) {
                const tp = gameState.players[targetData.targetPlayerId];
                if (tp && tp.hand.length > 0) {
                    gameState.pendingPeek = {
                        rollerId: rollerId,
                        targetPlayerId: targetData.targetPlayerId,
                        skillId: 'SKILL_SILENT_SHADOW',
                    };
                    const tpName = tp.name || tp.id.substring(0, 4);
                    io.to(rollerId).emit('peek_cards', {
                        cards: tp.hand,
                        skillId: 'SKILL_SILENT_SHADOW',
                        title: `Choose a card from ${tpName}'s hand`,
                    });
                    actionMessage = `${player.id.substring(0, 4)} is looking at ${tp.id.substring(0, 4)}'s hand to take a card!`;
                } else if (tp) {
                    actionMessage = `${tp.id.substring(0, 4)} has no cards for ${player.id.substring(0, 4)} to take!`;
                }
            }
            break;
        case 'SKILL_SLIPPERY_PAWS':
            // Card: "Pull 2 cards from another player's hand, then DISCARD one of
            // THOSE cards." Pull 2 at random into the roller's hand, then make them
            // discard one of exactly those two (not any hand card). Net: roller +1,
            // target -2. Reuses the peek modal in "discard one" mode.
            if (targetData && targetData.targetPlayerId) {
                const tp = gameState.players[targetData.targetPlayerId];
                if (tp && tp.hand.length > 0) {
                    const pulled = [];
                    for (let i = 0; i < 2; i++) {
                        if (tp.hand.length > 0) {
                            const randIndex = Math.floor(Math.random() * tp.hand.length);
                            const c = tp.hand.splice(randIndex, 1)[0];
                            player.hand.push(c);
                            pulled.push(c);
                        }
                    }
                    gameState.pendingPeek = {
                        rollerId: rollerId,
                        skillId: 'SKILL_SLIPPERY_PAWS',
                        allowedCardIds: pulled.map(c => c.id),
                    };
                    const tpName = tp.name || tp.id.substring(0, 4);
                    io.to(rollerId).emit('peek_cards', {
                        cards: pulled,
                        skillId: 'SKILL_SLIPPERY_PAWS',
                        title: `Pulled ${pulled.length} from ${tpName} — discard one`,
                        subtitle: 'Choose one of these cards to discard.',
                        actionLabel: 'Discard',
                    });
                    actionMessage = `${player.id.substring(0, 4)} pulled ${pulled.length} card(s) from ${tp.id.substring(0, 4)} and must discard one!`;
                } else if (tp) {
                    actionMessage = `${tp.id.substring(0, 4)} has no cards for ${player.id.substring(0, 4)} to pull!`;
                }
            }
            break;
        case 'SKILL_HOPPER':
             if (targetData && targetData.targetPlayerId) {
                const tp = gameState.players[targetData.targetPlayerId];
                if (tp && tp.party.length > 0) {
                    // "That player must SACRIFICE a Hero card." — the TARGET chooses
                    // which hero to give up, not whoever happens to be last in the
                    // party. Hand control to them via WAITING_FOR_SACRIFICE.
                    gameState.state = 'WAITING_FOR_SACRIFICE';
                    gameState.pendingAction = {
                        type: 'PENALTY',
                        amount: 1,
                        playerToChoose: targetData.targetPlayerId,
                        originalActor: rollerId
                    };
                    actionMessage = `${player.id.substring(0, 4)} forces ${tp.id.substring(0, 4)} to sacrifice a Hero!`;
                } else {
                    gameState.state = 'PLAYING';
                    gameState.pendingAction = null;
                    actionMessage = `${tp ? tp.id.substring(0, 4) : 'The target'} has no Heroes to sacrifice!`;
                }
            }
            break;

        // --- 4. Self/Item Target ---
        case 'SKILL_HOLY_CURSELIFTER':
            if (targetData && targetData.targetHeroId) {
                const h = player.party.find(x => x.id === targetData.targetHeroId);
                if (h && h.equippedItem) {
                    const item = h.equippedItem;
                    h.equippedItem = null;
                    player.hand.push(item);
                    actionMessage = `${player.id.substring(0, 4)} returned ${item.name} to their hand!`;
                }
            }
            break;

        // --- 5. Discard Pile Search ---
        case 'SKILL_GUIDING_LIGHT':
        case 'SKILL_RADIANT_HORN':
        case 'SKILL_LOOKIE_ROOKIE':
        case 'SKILL_BUN_BUN':
            if (targetData && targetData.targetCardId) {
                const cardIndex = gameState.discardPile.findIndex(c => c.id === targetData.targetCardId);
                if (cardIndex !== -1) {
                    const card = gameState.discardPile.splice(cardIndex, 1)[0];
                    player.hand.push(card);
                    actionMessage = `${player.id.substring(0, 4)} retrieved ${card.name} from the discard pile!`;
                }
            }
            break;

        // --- 6. Deck Peeking ---
        case 'SKILL_BULLSEYE':
            if (gameState.mainDeck.length > 0) {
                const peekCards = gameState.mainDeck.slice(-3).reverse(); // top 3 cards
                // Emit only to the roller
                io.to(rollerId).emit('peek_cards', { cards: peekCards, skillId: 'SKILL_BULLSEYE' });
                actionMessage = `${player.id.substring(0, 4)} is looking at the top 3 cards...`;
            } else {
                actionMessage = `The deck is empty!`;
            }
            break;

        // --- 7. Multi-player Async & Multi-Target ---
        case 'DISCARD_CARD': {
            const pendingPlayerIds = Object.keys(gameState.players)
                .filter(id => id !== rollerId && gameState.players[id].hand.length > 0);

            if (pendingPlayerIds.length > 0) {
                gameState.pendingGlobalAction = {
                    type: 'MULTI_DISCARD',
                    initiatorId: rollerId,
                    pendingPlayerIds: pendingPlayerIds,
                    submittedCards: []
                };
                gameState.state = 'WAITING_FOR_GLOBAL_ACTION';
                pendingPlayerIds.forEach(id => {
                    io.to(id).emit('global_action_requested', {
                        type: 'MULTI_DISCARD',
                        hand: gameState.players[id].hand
                    });
                });
                actionMessage = `${player.id.substring(0, 4)} forced all other players to discard! Waiting for choices...`;
            } else {
                actionMessage = `${player.id.substring(0, 4)} used ${heroName}'s skill, but no one has cards to discard!`;
            }
            break;
        }
        case 'SKILL_FLUFFY': {
            if (targetData && targetData.targetHeroIds && targetData.targetHeroIds.length > 0) {
                let destroyedCount = 0;
                targetData.targetHeroIds.forEach(targetId => {
                    for (const pid in gameState.players) {
                        const tp = gameState.players[pid];
                        const targetHasTerratuga = tp && tp.slainMonsters && tp.slainMonsters.some(m => m.effect_id === 'MONSTER_TERRATUGA');
                        if (targetHasTerratuga) continue;
                        if (tp && !tp.cannotBeDestroyed) {
                            const tHeroIndex = tp.party.findIndex(h => h.id === targetId);
                            if (tHeroIndex !== -1) {
                                let destroyMsg = resolveDestroyAction(gameState, rollerId, pid, targetId);
                                actionMessage += ` and ${destroyMsg}`;
                                destroyedCount++;
                            }
                        }
                    }
                });
                actionMessage = `${player.id.substring(0, 4)} used ${heroName} to DESTROY ${destroyedCount} Hero(es)!`;
            } else {
                actionMessage = `${player.id.substring(0, 4)} used ${heroName}'s skill, but no valid targets were selected.`;
            }
            break;
        }

        case 'SKILL_TIPSY_TOOTIE':
            if (targetData && targetData.targetPlayerId && targetData.targetHeroId) {
                const tp = gameState.players[targetData.targetPlayerId];
                if (tp && !tp.cannotBeStolen) {
                    const tHeroIndex = tp.party.findIndex(h => h.id === targetData.targetHeroId);
                    if (tHeroIndex !== -1) {
                        const targetHero = tp.party[tHeroIndex];
                        // 1. Steal the target hero
                        tp.party.splice(tHeroIndex, 1);
                        player.party.push(targetHero);

                        // 2. Move Tipsy Tootie to their party
                        const tipsyIndex = player.party.findIndex(h => h.name === 'Tipsy Tootie');
                        if (tipsyIndex !== -1) {
                            const tipsy = player.party.splice(tipsyIndex, 1)[0];
                            tp.party.push(tipsy);
                        }

                        actionMessage = `${player.id.substring(0, 4)} swapped Tipsy Tootie for ${targetHero.name} from ${tp.id.substring(0, 4)}!`;
                    }
                } else if (tp && tp.cannotBeStolen) {
                    actionMessage = `${player.id.substring(0, 4)} tried to steal from ${tp.id.substring(0, 4)}, but they are protected!`;
                }
            }
            break;

        default:
            actionMessage = `Unrecognized skill ${skillId}.`;
            break;
    }

    io.emit('message', actionMessage);
}
function executeMagic(gameState, io, effectId, playerId, targetData) {
    const player = gameState.players[playerId];
    if (!player) return;

    console.log(`Executing magic ${effectId} by player ${playerId}`);
    let actionMessage = `${player.id.substring(0, 4)} successfully cast a spell!`;

    const drawCards = (num, p) => {
        for(let i=0; i<num; i++) {
            if(gameState.mainDeck.length > 0) p.hand.push(gameState.mainDeck.pop());
        }
    };

    switch(effectId) {
        case 'MAGIC_CALL_FALLEN':
            if (targetData && targetData.targetCardId) {
                const cardIndex = gameState.discardPile.findIndex(c => c.id === targetData.targetCardId);
                if (cardIndex !== -1) {
                    const card = gameState.discardPile.splice(cardIndex, 1)[0];
                    player.hand.push(card);
                    actionMessage = `${player.id.substring(0, 4)} retrieved ${card.name} from the discard pile!`;
                }
            }
            break;
            
        case 'MAGIC_CRIT_BOOST':
            drawCards(3, player);
            if (player.hand.length > 0) {
                gameState.pendingAction = {
                    type: 'DISCARD',
                    playerToChoose: playerId,
                    amount: 1,
                    originalActor: playerId
                };
                actionMessage = `${player.id.substring(0, 4)} drew 3 cards and must now discard 1.`;
            } else {
                actionMessage = `${player.id.substring(0, 4)} drew 3 cards!`;
            }
            break;

        case 'MAGIC_DESTRUCTIVE':
            if (player.hand.length > 0) {
                gameState.pendingAction = {
                    type: 'DISCARD',
                    playerToChoose: playerId,
                    amount: 1,
                    originalActor: playerId,
                    nextAction: {
                        type: 'DESTROY',
                        // playerToChoose is required or the client can't tell the
                        // caster it's their turn to pick a Hero to destroy (it would
                        // sit on "WAITING FOR OPPONENT..." forever).
                        playerToChoose: playerId,
                        originalActor: playerId
                    }
                };
                actionMessage = `${player.id.substring(0, 4)} cast Destructive Spell! Waiting for them to discard 1 card.`;
            } else {
                gameState.pendingAction = {
                    type: 'DESTROY',
                    playerToChoose: playerId,
                    originalActor: playerId
                };
                actionMessage = `${player.id.substring(0, 4)} cast Destructive Spell with an empty hand! Waiting to select a Hero to destroy.`;
            }
            break;

        case 'MAGIC_ENCHANTED':
            player.magicRollBonus = (player.magicRollBonus || 0) + 2;
            actionMessage = `${player.id.substring(0, 4)} gained +2 to all rolls until the end of their turn!`;
            break;

        case 'MAGIC_ENTANGLING':
            const discardAmount = Math.min(2, player.hand.length);

            if (discardAmount > 0) {
                gameState.pendingAction = {
                    type: 'DISCARD',
                    playerToChoose: playerId,
                    amount: discardAmount,
                    originalActor: playerId,
                    nextAction: {
                        type: 'STEAL',
                        playerToChoose: playerId,
                        originalActor: playerId
                    }
                };
                actionMessage = `${player.id.substring(0, 4)} cast Entangling Trap! Waiting for them to discard ${discardAmount} card(s).`;
            } else {
                // No cards to discard — go straight to the steal, but only if there's
                // actually a Hero to steal; otherwise skip so we don't soft-lock.
                const canSteal = Object.keys(gameState.players).some(pid => {
                    if (pid === playerId) return false;
                    const op = gameState.players[pid];
                    return op && !op.cannotBeStolen && op.party && op.party.some(h => h.type === 'Hero Card');
                });
                if (canSteal) {
                    gameState.pendingAction = {
                        type: 'STEAL',
                        playerToChoose: playerId,
                        originalActor: playerId
                    };
                    actionMessage = `${player.id.substring(0, 4)} cast Entangling Trap with an empty hand! Waiting to select a Hero to steal.`;
                } else {
                    gameState.pendingAction = null;
                    actionMessage = `${player.id.substring(0, 4)} cast Entangling Trap, but there are no Heroes to steal.`;
                }
            }
            break;

        case 'MAGIC_EXCHANGE':
            gameState.pendingAction = {
                type: 'EXCHANGE_STEP_1',
                playerToChoose: playerId,
                originalActor: playerId
            };
            actionMessage = `${player.id.substring(0, 4)} cast Forced Exchange! Waiting to select an opponent's Hero to steal.`;
            break;

        case 'MAGIC_WINDS_FORCE':
            let itemsReturned = 0;
            for (const pId in gameState.players) {
                const p = gameState.players[pId];
                p.party.forEach(h => {
                    if (h.equippedItem) {
                        p.hand.push(h.equippedItem);
                        h.equippedItem = null;
                        itemsReturned++;
                    }
                });
            }
            actionMessage = `${player.id.substring(0, 4)} cast Forceful Winds! ${itemsReturned} equipped Items returned to hands.`;
            break;

        case 'MAGIC_WINDS_CHANGE': {
            // Guard: with no equipped item anywhere, RETURN_ITEM has no legal
            // target and no skip — the game soft-locks. Fizzle instead.
            const anyEquipped = Object.values(gameState.players)
                .some(p => (p.party || []).some(h => h && h.equippedItem));
            if (!anyEquipped) {
                actionMessage = `${player.id.substring(0, 4)} cast Winds of Change, but no Items are equipped — the spell fizzles.`;
                break;
            }
            gameState.pendingAction = {
                type: 'RETURN_ITEM',
                playerToChoose: playerId,
                amount: 1,
                originalActor: playerId
            };
            actionMessage = `${player.id.substring(0, 4)} cast Winds of Change! Select an equipped item to return to your hand.`;
            break;
        }
    }
    
    io.emit('rollResult', { player: playerId, roll: 0, message: actionMessage });
    return { success: true, message: actionMessage };
}

module.exports = {
    executeSkill,
    executeMagic,
    hasOpponentHeroTarget
};
