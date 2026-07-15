const SAFE_MODE = false;
const { getPlayerName } = require('./player_utils');

function maskClass(item) {
    if (!item || item.effect_id !== 'ITEM_MASK') return null;
    if (item.class) return item.class;
    const match = /^(\w+)\s+Mask$/.exec(item.name || '');
    return match ? match[1] : null;
}

function effectiveHeroClass(hero) {
    if (!hero) return null;
    return (hero.equippedItem && maskClass(hero.equippedItem)) || hero.class;
}

// Put cards drawn by an effect through the slain-monster draw passives. This is
// shared by Hero skills, Magic effects, and the server's normal draw action so
// Orthus/Rex Major do not depend on which code path produced the draw.
function drawCardsWithPassives(gameState, io, count, player) {
    const drawn = [];
    const hasRex = (player.slainMonsters || []).some(m => m.effect_id === 'MONSTER_REX_MAJOR');
    const hasOrthus = (player.slainMonsters || []).some(m => m.effect_id === 'MONSTER_ORTHUS');

    const receive = (card) => {
        if (!card) return;
        if (hasOrthus && card.type === 'Magic Card' && !gameState.pendingCard) {
            gameState.state = 'WAITING_FOR_IMMEDIATE_PLAY';
            gameState.pendingCard = card;
            gameState.pendingAction = {
                playerToChoose: player.id,
                type: 'IMMEDIATE_PLAY',
                originalActor: player.id,
                source: 'MONSTER_ORTHUS'
            };
        } else {
            player.hand.push(card);
        }
    };

    const drawOne = () => {
        if (gameState.mainDeck.length === 0) return;
        const card = gameState.mainDeck.pop();
        drawn.push(card);
        receive(card);
        if (hasRex && card.type === 'Modifier Card') {
            if (io && io.emit) io.emit('rex_major_reveal', {
                playerId: player.id,
                playerName: getPlayerName(gameState, player.id),
                card
            });
            if (io && io.emit) io.emit('message', `${getPlayerName(gameState, player.id)} revealed a Modifier due to Rex Major and drew another card!`);
            drawOne();
        }
    };

    for (let i = 0; i < count; i++) {
        drawOne();
    }
    return drawn;
}

function triggerCrownedSerpent(gameState, io) {
    Object.values(gameState.players || {}).forEach(player => {
        if ((player.slainMonsters || []).some(m => m.effect_id === 'MONSTER_CROWNED_SERPENT') && gameState.mainDeck.length > 0) {
            drawCardsWithPassives(gameState, io, 1, player);
        }
    });
}

function prepareImmediateItemPlay(gameState, playerId) {
    const player = gameState.players && gameState.players[playerId];
    const item = gameState.pendingCard;
    if (!player || !item || !['Item Card', 'Cursed Item Card'].includes(item.type)) return false;
    player.hand.push(item);
    gameState.pendingCard = null;
    gameState.state = 'WAITING_FOR_HAND_SELECTION';
    gameState.pendingAction = {
        type: 'PLAY_FROM_HAND', allowedTypes: [item.type], allowedCardIds: [item.id],
        playerToChoose: playerId, originalActor: playerId
    };
    return true;
}

function markButtonsFreePlay(player, pulledCard) {
    if (!player || !pulledCard || pulledCard.type !== 'Magic Card') return false;
    pulledCard.freePlay = true;
    return true;
}

function returnEquippedItemToOwner(gameState, heroId) {
    for (const owner of Object.values(gameState.players || {})) {
        const hero = (owner.party || []).find(h => h.id === heroId);
        if (hero && hero.equippedItem) {
            const item = hero.equippedItem;
            owner.hand.push(item);
            hero.equippedItem = null;
            return { owner, item };
        }
    }
    return null;
}

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

// Decide how a deferred Hero skill should begin resolving. Most targeting skills
// are a single Hero-target clause, but the AND cards must be allowed to continue
// when only their independent non-primary clause can resolve.
function getTargetingSkillPlan(gameState, actorId, skillId) {
    const canSteal = hasOpponentHeroTarget(gameState, actorId, 'STEAL');
    const canDestroy = hasOpponentHeroTarget(gameState, actorId, 'DESTROY');

    if (skillId === 'SKILL_SERIOUS_GREY') {
        return canDestroy
            ? { type: 'SKILL_TARGET_HERO', targetAction: 'DESTROY' }
            : { type: 'EXECUTE_SKILL_IMMEDIATE', skippedClause: 'DESTROY' };
    }

    if (skillId === 'SKILL_WHISKERS') {
        if (canSteal) return { type: 'SKILL_TARGET_HERO', targetAction: 'STEAL' };
        if (canDestroy) return { type: 'DESTROY', skippedClause: 'STEAL' };
        return null;
    }

    if (skillId === 'SKILL_MEOWZIO') {
        if (canSteal) return { type: 'SKILL_TARGET_HERO', targetAction: 'STEAL' };
        const canPull = Object.entries(gameState.players || {}).some(([id, opponent]) =>
            id !== actorId && opponent && (opponent.hand || []).length > 0);
        if (canPull) return { type: 'SKILL_TARGET_PLAYER', skippedClause: 'STEAL' };
        return null;
    }

    const stealSkills = ['STEAL_HERO', 'SKILL_TIPSY_TOOTIE', 'SKILL_WIGGLES'];
    const targetAction = stealSkills.includes(skillId) ? 'STEAL' : 'DESTROY';
    return hasOpponentHeroTarget(gameState, actorId, targetAction)
        ? { type: 'SKILL_TARGET_HERO', targetAction }
        : null;
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
        return `${getPlayerName(gameState, initiatorId)} tried to destroy ${getPlayerName(gameState, targetPlayerId)}'s Hero, but it is protected by ${protectedByBlade ? 'Mighty Blade' : 'Terratuga'}!`;
    }

    const tHeroIndex = targetPlayer.party.findIndex(h => h.id === targetHeroId);
    if (tHeroIndex === -1) return '';

    const targetHero = targetPlayer.party[tHeroIndex];
    let actionMessage = '';

    // Decoy Doll absorbs the destroy before Sabretooth can convert it.
    if (consumeDecoyDoll(gameState, targetHero)) {
        return `${getPlayerName(gameState, initiatorId)} hit ${getPlayerName(gameState, targetPlayerId)}'s ${targetHero.name}, but Decoy Doll was destroyed instead — the Hero survives!`;
    }

    const hasSabretooth = initiator.slainMonsters && initiator.slainMonsters.some(m => m.effect_id === 'MONSTER_CORRUPTED_SABRETOOTH');

    if (hasSabretooth) {
        targetPlayer.party.splice(tHeroIndex, 1);
        targetHero.usedSkillThisTurn = false;
        initiator.party.push(targetHero);
        actionMessage = `Corrupted Sabretooth turned a Destroy into a Steal! ${getPlayerName(gameState, initiatorId)} STOLE ${getPlayerName(gameState, targetPlayerId)}'s ${targetHero.name}!`;
    } else {
        let itemNote = '';
        if (targetHero.equippedItem) {
            if (keepItem) {
                initiator.hand.push(targetHero.equippedItem);
                itemNote = ` ${getPlayerName(gameState, initiatorId)} took the equipped ${targetHero.equippedItem.name}!`;
            } else {
                gameState.discardPile.push(targetHero.equippedItem);
            }
            targetHero.equippedItem = null;
        }
        targetPlayer.party.splice(tHeroIndex, 1);
        gameState.discardPile.push(targetHero);
        actionMessage = `${getPlayerName(gameState, initiatorId)} DESTROYED ${getPlayerName(gameState, targetPlayerId)}'s ${targetHero.name}!${itemNote}`;

        const hasDracos = targetPlayer.slainMonsters && targetPlayer.slainMonsters.some(m => m.effect_id === 'MONSTER_DRACOS');
        if (hasDracos) {
            actionMessage += ` However, ${getPlayerName(gameState, targetPlayerId)} drew a card due to Dracos!`;
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
    let actionMessage = `${getPlayerName(gameState, player.id)} successfully used ${heroName}'s skill!`;

    // Helper to draw cards securely
    const drawCards = (num, p) => drawCardsWithPassives(gameState, io, num, p);

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
                actionMessage = `${getPlayerName(gameState, player.id)} forces ${getPlayerName(gameState, tp.id)} to discard ${amt} card(s)!`;
            } else {
                gameState.state = 'PLAYING';
                gameState.pendingAction = null;
                actionMessage = `${tp ? getPlayerName(gameState, tp.id) : 'The target'} has no cards to discard!`;
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
            actionMessage = `${getPlayerName(gameState, player.id)} is choosing a player to pull a card from!`;
            break;

        case 'SKILL_FURY_KNUCKLE':
            gameState.state = 'PLAYING';
            gameState.pendingAction = {
                type: 'CONDITIONAL_PULL',
                conditionType: 'Challenge Card',
                playerToChoose: rollerId,
                originalActor: rollerId
            };
            actionMessage = `${getPlayerName(gameState, player.id)} is choosing a player to pull a card from!`;
            break;

        case 'SKILL_TOUGH_TEDDY':
            let teddyTargets = [];
            Object.keys(gameState.players).forEach(pId => {
                const p = gameState.players[pId];
                const hasFighter = p.leader?.class === 'Fighter'
                    || p.party.some(c => effectiveHeroClass(c) === 'Fighter');
                if (pId !== rollerId && hasFighter && p.hand.length > 0) {
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
            const drawn = drawCards(2, player);
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
                actionMessage = `${getPlayerName(gameState, player.id)} drew a Challenge via Pan Chucks — they MAY destroy a Hero (or skip).`;
            } else if (drewChallenge) {
                actionMessage = `${getPlayerName(gameState, player.id)} drew a Challenge via Pan Chucks, but there are no Heroes to destroy.`;
            } else if (drawn.length > 0) {
                actionMessage = `${getPlayerName(gameState, player.id)} drew ${drawn.length} card(s) via Pan Chucks, but no Challenge cards.`;
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
                actionMessage = `${getPlayerName(gameState, player.id)} can discard up to ${maxDiscard} card(s) to destroy that many Heroes.`;
            } else if (destroyableOpp === 0) {
                actionMessage = `${getPlayerName(gameState, player.id)} used Qi Bear, but there are no opponent Heroes to destroy.`;
            } else {
                actionMessage = `${getPlayerName(gameState, player.id)} has no cards to discard for Qi Bear!`;
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
            actionMessage = `${getPlayerName(gameState, player.id)} drew 3 cards and must discard 1!`;
            break;
        case 'SKILL_GREEDY_CHEEKS':
            let greedyTargets = Object.keys(gameState.players).filter(pId => pId !== rollerId && gameState.players[pId].hand.length > 0);
            if (greedyTargets.length > 0) {
                gameState.state = 'WAITING_FOR_GLOBAL_ACTION';
                gameState.pendingGlobalAction = { type: 'MULTI_GIVE', initiatorId: rollerId, pendingPlayerIds: greedyTargets, submittedCards: [] };
                io.emit('global_action_requested', gameState.pendingGlobalAction);
                actionMessage = `Greedy Cheeks forces opponents to give a card to ${getPlayerName(gameState, player.id)}!`;
            } else { actionMessage = `Opponents have no cards!`; }
            break;
        case 'SKILL_FUZZY_CHEEKS':
            drawCards(1, player);
            if (player.hand.some(card => card.type === 'Hero Card')) {
                gameState.state = 'WAITING_FOR_HAND_SELECTION';
                gameState.pendingAction = { type: 'PLAY_FROM_HAND', allowedTypes: ['Hero Card'], playerToChoose: rollerId, originalActor: rollerId };
                actionMessage = `${getPlayerName(gameState, player.id)} drew a card and must play a Hero!`;
            } else {
                actionMessage = `${getPlayerName(gameState, player.id)} drew a card, but has no Hero to play.`;
            }
            break;
        case 'SKILL_HOOK':
            if (player.hand.some(c => ['Item Card', 'Cursed Item Card'].includes(c.type))) {
                gameState.state = 'WAITING_FOR_HAND_SELECTION';
                gameState.pendingAction = { type: 'PLAY_FROM_HAND', allowedTypes: ['Item Card', 'Cursed Item Card'], playerToChoose: rollerId, originalActor: rollerId, thenDraw: 1 };
                actionMessage = `${getPlayerName(gameState, player.id)} must play an Item from hand, then draw a card!`;
            } else {
                drawCards(1, player);
                actionMessage = `${getPlayerName(gameState, player.id)} had no Item to play with Hook, so they drew a card.`;
            }
            break;
        case 'SKILL_QUICK_DRAW': {
            // "DRAW 2 cards. If at least one of those cards is an item card, you may
            // play one of them immediately." The play option is conditional on one of
            // the TWO DRAWN cards being an Item — not on Items already in hand.
            const qdDrawn = drawCards(2, player);
            const drawnItems = qdDrawn.filter(c => ['Item Card', 'Cursed Item Card'].includes(c.type));
            if (drawnItems.length > 0) {
                gameState.state = 'WAITING_FOR_HAND_SELECTION';
                gameState.pendingAction = {
                    type: 'PLAY_FROM_HAND',
                    allowedTypes: ['Item Card', 'Cursed Item Card'],
                    allowedCardIds: drawnItems.map(card => card.id),
                    playerToChoose: rollerId,
                    originalActor: rollerId,
                    optional: true
                };
                actionMessage = `${getPlayerName(gameState, player.id)} drew 2 cards and may play an Item immediately!`;
            } else {
                actionMessage = `${getPlayerName(gameState, player.id)} drew 2 cards with Quick Draw — no Item drawn, so nothing more happens.`;
            }
            break;
        }
        case 'SKILL_SNOWBALL':
            // "DRAW a card. If it is a Magic card, you may play it immediately and
            // DRAW a second card." The offer is conditional on the DRAWN card being
            // Magic — not on any Magic already in hand.
            if (gameState.mainDeck.length > 0) {
                const snowballCard = drawCards(1, player)[0];
                if (snowballCard.type === 'Magic Card') {
                    const heldIndex = player.hand.findIndex(c => c.id === snowballCard.id);
                    if (heldIndex !== -1) player.hand.splice(heldIndex, 1);
                    gameState.state = 'WAITING_FOR_IMMEDIATE_PLAY';
                    gameState.pendingCard = snowballCard;
                    gameState.pendingAction = { type: 'IMMEDIATE_PLAY_CHOICE', playerToChoose: rollerId, thenDraw: 1 };
                    actionMessage = `${getPlayerName(gameState, player.id)} drew a Magic card with Snowball and may play it immediately (then draw another)!`;
                } else {
                    actionMessage = `${getPlayerName(gameState, player.id)} drew a card with Snowball — not a Magic card, so nothing more happens.`;
                }
            } else {
                actionMessage = `The deck is empty!`;
            }
            break;
case 'DRAW_CARD':
            drawCards(1, player);
            actionMessage = `${getPlayerName(gameState, player.id)} used ${heroName}'s skill to draw a card.`;
            break;
        case 'DRAW_2_CARDS':
            drawCards(2, player);
            actionMessage = `${getPlayerName(gameState, player.id)} used ${heroName}'s skill to draw 2 cards.`;
            break;
        case 'DRAW_AND_PLAY':
            if (gameState.mainDeck.length > 0) {
                const drawnCard = drawCards(1, player)[0];
                if (drawnCard.type === 'Hero Card') {
                    const heldIndex = player.hand.findIndex(c => c.id === drawnCard.id);
                    if (heldIndex !== -1) player.hand.splice(heldIndex, 1);
                    gameState.state = 'WAITING_FOR_IMMEDIATE_PLAY';
                    gameState.pendingCard = drawnCard;
                    gameState.pendingAction = {
                        type: 'IMMEDIATE_PLAY_CHOICE',
                        playerToChoose: rollerId
                    };
                    actionMessage = `${getPlayerName(gameState, player.id)} drew a Hero and can play it immediately!`;
                } else {
                    actionMessage = `${getPlayerName(gameState, player.id)} drew a card.`;
                }
            } else {
                actionMessage = `The deck is empty!`;
            }
            break;
        case 'SKILL_NAPPING_NIBBLES':
            actionMessage = `${getPlayerName(gameState, player.id)} used ${heroName}'s skill. It did absolutely nothing!`;
            break;
        case 'SKILL_CALMING_VOICE':
            // "Hero cards in your Party cannot be stolen until your next turn." - Requires lingering state.
            player.cannotBeStolen = true; // In a full implementation, we reset this on turn start.
            actionMessage = `${getPlayerName(gameState, player.id)}'s Heroes cannot be stolen until their next turn!`;
            break;
        case 'SKILL_IRON_RESOLVE':
            player.cannotBeChallenged = true;
            actionMessage = `${getPlayerName(gameState, player.id)}'s cards cannot be challenged for the rest of their turn!`;
            break;
        case 'SKILL_MIGHTY_BLADE':
            player.cannotBeDestroyed = true;
            actionMessage = `${getPlayerName(gameState, player.id)}'s Heroes cannot be destroyed until their next turn!`;
            break;
        case 'SKILL_VIBRANT_GLOW':
            player.rollBonus = (player.rollBonus || 0) + 5;
            (player.rollBonusSources = player.rollBonusSources || []).push({ source: 'Vibrant Glow', value: 5 });
            actionMessage = `${getPlayerName(gameState, player.id)} gained +5 to all rolls this turn!`;
            break;
        case 'SKILL_WISE_SHIELD':
            player.rollBonus = (player.rollBonus || 0) + 3;
            (player.rollBonusSources = player.rollBonusSources || []).push({ source: 'Wise Shield', value: 3 });
            actionMessage = `${getPlayerName(gameState, player.id)} gained +3 to all rolls this turn!`;
            break;
        case 'SKILL_WILY_RED':
            while(player.hand.length < 7 && gameState.mainDeck.length > 0) {
                drawCards(1, player);
            }
            actionMessage = `${getPlayerName(gameState, player.id)} drew cards until they had 7 in their hand!`;
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
                actionMessage = `${getPlayerName(gameState, player.id)}'s ${heroName} forced all other players to sacrifice a Hero!`;
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
            actionMessage = `${getPlayerName(gameState, player.id)} stole a random card from everyone's hand!`;
            break;
        case 'SKILL_SMOOTH_MIMIMEOW':
            Object.values(gameState.players).forEach(p => {
                if (p.id !== rollerId && p.party.some(h => effectiveHeroClass(h) === 'Thief') && p.hand.length > 0) {
                    const randIndex = Math.floor(Math.random() * p.hand.length);
                    player.hand.push(p.hand.splice(randIndex, 1)[0]);
                }
            });
            actionMessage = `${getPlayerName(gameState, player.id)} pulled a card from everyone with a Thief in their party!`;
            break;

        // --- 2. Opponent Hero Target ---
        
        case 'SKILL_MEOWZIO':
            // Card: "Choose a player. STEAL a Hero from that player and pull a card
            // from that player's hand." NOT a destroy, and the ROLLER pulls a card
            // (does not discard). Respect Calming Voice (cannotBeStolen).
            if (targetData && targetData.targetPlayerId) {
                const tp = gameState.players[targetData.targetPlayerId];
                if (tp) {
                    let msg = `${getPlayerName(gameState, player.id)} used Meowzio on ${getPlayerName(gameState, tp.id)}`;
                    const tHeroIndex = tp.cannotBeStolen || !targetData.targetHeroId
                        ? -1
                        : tp.party.findIndex(h => h.id === targetData.targetHeroId);
                    if (tHeroIndex >= 0) {
                        const targetHero = tp.party[tHeroIndex];
                        tp.party.splice(tHeroIndex, 1);
                        targetHero.usedSkillThisTurn = false;
                        player.party.push(targetHero);
                        msg += `, STEALING ${targetHero.name}`;
                    } else {
                        msg += `; the STEAL clause had no legal target`;
                    }
                    if (tp.hand.length > 0) {
                        const randIndex = Math.floor(Math.random() * tp.hand.length);
                        player.hand.push(tp.hand.splice(randIndex, 1)[0]);
                        msg += ` and pulling a card from their hand!`;
                    } else {
                        msg += ` (they had no cards in hand to pull).`;
                    }
                    actionMessage = msg;
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
                    actionMessage = `${getPlayerName(gameState, player.id)} tried to use Whiskers, but ${getPlayerName(gameState, tp.id)}'s Heroes are protected from stealing!`;
                } else if (tp) {
                    const tHeroIndex = tp.party.findIndex(h => h.id === targetData.targetHeroId);
                    if (tHeroIndex !== -1) {
                        const targetHero = tp.party[tHeroIndex];
                        tp.party.splice(tHeroIndex, 1);
                        targetHero.usedSkillThisTurn = false;
                        player.party.push(targetHero);
                        actionMessage = `${getPlayerName(gameState, player.id)} used Whiskers to STEAL ${targetHero.name} from ${getPlayerName(gameState, tp.id)}`;
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
            if (!targetData || !targetData.targetHeroId) {
                actionMessage = `${getPlayerName(gameState, player.id)} used Whiskers, but there was no Hero to STEAL.`;
                if (hasOpponentHeroTarget(gameState, rollerId, 'DESTROY')) {
                    gameState.state = 'PLAYING';
                    gameState.pendingAction = { type: 'DESTROY', playerToChoose: rollerId, originalActor: rollerId };
                    actionMessage += ` Choose a Hero to DESTROY.`;
                } else {
                    actionMessage += ` There was also no Hero to DESTROY.`;
                }
            }
            break;
        case 'SKILL_SERIOUS_GREY':
            // "DESTROY a Hero AND DRAW a card." The draw is unconditional (not gated on
            // the destroyed Hero having had an Item).
            if (targetData && targetData.targetPlayerId && targetData.targetHeroId) {
                actionMessage = resolveDestroyAction(gameState, rollerId, targetData.targetPlayerId, targetData.targetHeroId);
            } else {
                actionMessage = `${getPlayerName(gameState, player.id)} used Serious Grey, but there was no Hero to DESTROY.`;
            }
            drawCards(1, player);
            actionMessage += ` Serious Grey still drew a card.`;
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
                            actionMessage = `${getPlayerName(gameState, player.id)} used Wiggles to STEAL ${targetHero.name}, but it is sealed (Sealing Key) and cannot be used!`;
                        } else {
                            gameState.state = 'WAITING_TO_ROLL';
                            gameState.pendingRoll = {
                                type: 'HERO_SKILL',
                                rollerId: rollerId,
                                targetHeroId: targetHero.id,
                                roll1: 0, roll2: 0, passiveBonus: 0, modifierTotal: 0,
                                baseRoll: 0, currentRoll: 0, passedPlayers: []
                            };
                            actionMessage = `${getPlayerName(gameState, player.id)} used Wiggles to STEAL ${targetHero.name} — now roll to use its effect immediately!`;
                        }
                    }
                } else if (tp) {
                    actionMessage = `${getPlayerName(gameState, tp.id)}'s Hero is protected from stealing!`;
                }
            }
            break;
        case 'SKILL_PLUNDERING_PUMA':
            gameState.state = 'PLAYING';
            gameState.pendingAction = { type: 'PUMA_PULL', playerToChoose: rollerId, originalActor: rollerId };
            actionMessage = `${getPlayerName(gameState, player.id)} is choosing a player to pull 2 cards from!`;
            break;
        case 'SKILL_SLY_PICKINGS':
            gameState.state = 'PLAYING';
            gameState.pendingAction = { type: 'CONDITIONAL_PULL', conditionTypes: ['Item Card', 'Cursed Item Card'], actionOnSuccess: 'PLAY_IMMEDIATELY', playerToChoose: rollerId, originalActor: rollerId };
            actionMessage = `${getPlayerName(gameState, player.id)} is choosing a player to pull a card from!`;
            break;
        case 'SKILL_BUTTONS':
            gameState.state = 'PLAYING';
            gameState.pendingAction = { type: 'LOOK_AND_PULL', playerToChoose: rollerId, originalActor: rollerId };
            actionMessage = `${getPlayerName(gameState, player.id)} is choosing a player to look at their hand!`;
            break;
        case 'SKILL_LUCKY_BUCKY':
            gameState.state = 'PLAYING';
            gameState.pendingAction = { type: 'CONDITIONAL_PULL', conditionType: 'Hero Card', actionOnSuccess: 'PLAY_IMMEDIATELY', playerToChoose: rollerId, originalActor: rollerId };
            actionMessage = `${getPlayerName(gameState, player.id)} is choosing a player to pull a card from!`;
            break;
case 'DESTROY_HERO':
            if (targetData && targetData.targetPlayerId && targetData.targetHeroId) {
                const tp = gameState.players[targetData.targetPlayerId];
                const targetHasTerratuga = tp && tp.slainMonsters && tp.slainMonsters.some(m => m.effect_id === 'MONSTER_TERRATUGA');
                if (targetHasTerratuga) {
                    actionMessage = `${getPlayerName(gameState, player.id)} tried to destroy ${getPlayerName(gameState, tp.id)}'s Hero, but they are protected by Terratuga!`;
                } else if (tp && !tp.cannotBeDestroyed) {
                    const tHeroIndex = tp.party.findIndex(h => h.id === targetData.targetHeroId);
                    if (tHeroIndex !== -1) {
                        actionMessage = resolveDestroyAction(gameState, rollerId, targetData.targetPlayerId, targetData.targetHeroId);
                    }
                } else if (tp && tp.cannotBeDestroyed) {
                     actionMessage = `${getPlayerName(gameState, player.id)} tried to destroy ${getPlayerName(gameState, tp.id)}'s Hero, but they are protected by Mighty Blade!`;
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
                        actionMessage = `${getPlayerName(gameState, player.id)} STOLE ${targetHero.name} from ${getPlayerName(gameState, tp.id)}!`;
                    }
                } else if (tp && tp.cannotBeStolen) {
                     actionMessage = `${getPlayerName(gameState, player.id)} tried to steal ${getPlayerName(gameState, tp.id)}'s Hero, but they are protected by Calming Voice!`;
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
                    actionMessage = `${getPlayerName(gameState, player.id)} pulled a card from ${getPlayerName(gameState, tp.id)}'s hand!`;
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
                    actionMessage = `${getPlayerName(gameState, player.id)} traded hands with ${getPlayerName(gameState, tp.id)}!`;
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
                    const tpName = getPlayerName(gameState, tp.id);
                    io.to(rollerId).emit('peek_cards', {
                        cards: tp.hand,
                        skillId: 'SKILL_SHARP_FOX',
                        viewOnly: true,
                        title: `${tpName}'s hand (${tp.hand.length} card${tp.hand.length === 1 ? '' : 's'})`,
                    });
                    actionMessage = `${getPlayerName(gameState, player.id)} looked at ${getPlayerName(gameState, tp.id)}'s hand!`;
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
                    const tpName = getPlayerName(gameState, tp.id);
                    io.to(rollerId).emit('peek_cards', {
                        cards: tp.hand,
                        skillId: 'SKILL_SILENT_SHADOW',
                        title: `Choose a card from ${tpName}'s hand`,
                    });
                    actionMessage = `${getPlayerName(gameState, player.id)} is looking at ${getPlayerName(gameState, tp.id)}'s hand to take a card!`;
                } else if (tp) {
                    actionMessage = `${getPlayerName(gameState, tp.id)} has no cards for ${getPlayerName(gameState, player.id)} to take!`;
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
                    const tpName = getPlayerName(gameState, tp.id);
                    io.to(rollerId).emit('peek_cards', {
                        cards: pulled,
                        skillId: 'SKILL_SLIPPERY_PAWS',
                        title: `Pulled ${pulled.length} from ${tpName} — discard one`,
                        subtitle: 'Choose one of these cards to discard.',
                        actionLabel: 'Discard',
                    });
                    actionMessage = `${getPlayerName(gameState, player.id)} pulled ${pulled.length} card(s) from ${getPlayerName(gameState, tp.id)} and must discard one!`;
                } else if (tp) {
                    actionMessage = `${getPlayerName(gameState, tp.id)} has no cards for ${getPlayerName(gameState, player.id)} to pull!`;
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
                    actionMessage = `${getPlayerName(gameState, player.id)} forces ${getPlayerName(gameState, tp.id)} to sacrifice a Hero!`;
                } else {
                    gameState.state = 'PLAYING';
                    gameState.pendingAction = null;
                    actionMessage = `${tp ? getPlayerName(gameState, tp.id) : 'The target'} has no Heroes to sacrifice!`;
                }
            }
            break;

        // --- 4. Self/Item Target ---
        case 'SKILL_HOLY_CURSELIFTER':
            if (targetData && targetData.targetHeroId) {
                const h = player.party.find(x => x.id === targetData.targetHeroId);
                if (h && h.equippedItem?.type === 'Cursed Item Card') {
                    const item = h.equippedItem;
                    h.equippedItem = null;
                    player.hand.push(item);
                    actionMessage = `${getPlayerName(gameState, player.id)} returned ${item.name} to their hand!`;
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
                    const card = gameState.discardPile[cardIndex];
                    const validTypes = {
                        SKILL_GUIDING_LIGHT: ['Hero Card'],
                        SKILL_RADIANT_HORN: ['Modifier Card'],
                        SKILL_LOOKIE_ROOKIE: ['Item Card', 'Cursed Item Card'],
                        SKILL_BUN_BUN: ['Magic Card']
                    }[skillId];
                    if (validTypes.includes(card.type)) {
                        gameState.discardPile.splice(cardIndex, 1);
                        player.hand.push(card);
                        actionMessage = `${getPlayerName(gameState, player.id)} retrieved ${card.name} from the discard pile!`;
                    } else {
                        actionMessage = `${card.name} is not a valid card for ${heroName} to retrieve.`;
                    }
                }
            }
            break;

        // --- 6. Deck Peeking ---
        case 'SKILL_BULLSEYE':
            if (gameState.mainDeck.length > 0) {
                const peekCards = gameState.mainDeck.slice(-3).reverse(); // top 3 cards
                gameState.pendingPeek = {
                    rollerId,
                    skillId: 'SKILL_BULLSEYE',
                    stage: 'CHOOSE_CARD',
                    allowedCardIds: peekCards.map(card => card.id)
                };
                // Emit only to the roller
                io.to(rollerId).emit('peek_cards', {
                    cards: peekCards,
                    skillId: 'SKILL_BULLSEYE',
                    keepOpenAfterSelect: peekCards.length > 2
                });
                actionMessage = `${getPlayerName(gameState, player.id)} is looking at the top 3 cards...`;
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
                actionMessage = `${getPlayerName(gameState, player.id)} forced all other players to discard! Waiting for choices...`;
            } else {
                actionMessage = `${getPlayerName(gameState, player.id)} used ${heroName}'s skill, but no one has cards to discard!`;
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
                actionMessage = `${getPlayerName(gameState, player.id)} used ${heroName} to DESTROY ${destroyedCount} Hero(es)!`;
            } else {
                actionMessage = `${getPlayerName(gameState, player.id)} used ${heroName}'s skill, but no valid targets were selected.`;
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

                        actionMessage = `${getPlayerName(gameState, player.id)} swapped Tipsy Tootie for ${targetHero.name} from ${getPlayerName(gameState, tp.id)}!`;
                    }
                } else if (tp && tp.cannotBeStolen) {
                    actionMessage = `${getPlayerName(gameState, player.id)} tried to steal from ${getPlayerName(gameState, tp.id)}, but they are protected!`;
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
    let actionMessage = `${getPlayerName(gameState, player.id)} successfully cast a spell!`;

    const drawCards = (num, p) => drawCardsWithPassives(gameState, io, num, p);

    switch(effectId) {
        case 'MAGIC_CALL_FALLEN':
            if (targetData && targetData.targetCardId) {
                const cardIndex = gameState.discardPile.findIndex(c => c.id === targetData.targetCardId);
                if (cardIndex !== -1) {
                    const card = gameState.discardPile.splice(cardIndex, 1)[0];
                    player.hand.push(card);
                    actionMessage = `${getPlayerName(gameState, player.id)} retrieved ${card.name} from the discard pile!`;
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
                actionMessage = `${getPlayerName(gameState, player.id)} drew 3 cards and must now discard 1.`;
            } else {
                actionMessage = `${getPlayerName(gameState, player.id)} drew 3 cards!`;
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
                actionMessage = `${getPlayerName(gameState, player.id)} cast Destructive Spell! Waiting for them to discard 1 card.`;
            } else {
                gameState.pendingAction = {
                    type: 'DESTROY',
                    playerToChoose: playerId,
                    originalActor: playerId
                };
                actionMessage = `${getPlayerName(gameState, player.id)} cast Destructive Spell with an empty hand! Waiting to select a Hero to destroy.`;
            }
            break;

        case 'MAGIC_ENCHANTED':
            player.magicRollBonus = (player.magicRollBonus || 0) + 2;
            actionMessage = `${getPlayerName(gameState, player.id)} gained +2 to all rolls until the end of their turn!`;
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
                actionMessage = `${getPlayerName(gameState, player.id)} cast Entangling Trap! Waiting for them to discard ${discardAmount} card(s).`;
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
                    actionMessage = `${getPlayerName(gameState, player.id)} cast Entangling Trap with an empty hand! Waiting to select a Hero to steal.`;
                } else {
                    gameState.pendingAction = null;
                    actionMessage = `${getPlayerName(gameState, player.id)} cast Entangling Trap, but there are no Heroes to steal.`;
                }
            }
            break;

        case 'MAGIC_EXCHANGE':
            gameState.pendingAction = {
                type: 'EXCHANGE_STEP_1',
                playerToChoose: playerId,
                originalActor: playerId
            };
            actionMessage = `${getPlayerName(gameState, player.id)} cast Forced Exchange! Waiting to select an opponent's Hero to steal.`;
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
            actionMessage = `${getPlayerName(gameState, player.id)} cast Forceful Winds! ${itemsReturned} equipped Items returned to hands.`;
            break;

        case 'MAGIC_WINDS_CHANGE': {
            // Guard: with no equipped item anywhere, RETURN_ITEM has no legal
            // target and no skip — the game soft-locks. Fizzle instead.
            const anyEquipped = Object.values(gameState.players)
                .some(p => (p.party || []).some(h => h && h.equippedItem));
            if (!anyEquipped) {
                actionMessage = `${getPlayerName(gameState, player.id)} cast Winds of Change, but no Items are equipped — the spell fizzles.`;
                break;
            }
            gameState.pendingAction = {
                type: 'RETURN_ITEM',
                playerToChoose: playerId,
                amount: 1,
                originalActor: playerId
            };
            actionMessage = `${getPlayerName(gameState, player.id)} cast Winds of Change! Select an equipped item to return to your hand.`;
            break;
        }
    }
    
    io.emit('rollResult', { player: playerId, roll: 0, message: actionMessage });
    return { success: true, message: actionMessage };
}

module.exports = {
    executeSkill,
    executeMagic,
    hasOpponentHeroTarget,
    getTargetingSkillPlan,
    effectiveHeroClass,
    drawCardsWithPassives,
    triggerCrownedSerpent,
    prepareImmediateItemPlay,
    markButtonsFreePlay,
    returnEquippedItemToOwner
};
