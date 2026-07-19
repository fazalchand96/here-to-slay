const SAFE_MODE = false;
const { getPlayerName } = require('./player_utils');

const rexChoiceTimers = new Map();
const rexRevealHolds = new Map();
const rexRevealTimers = new Map();
let rexChoiceSequence = 0;

function activateNextRexMajorChoice(gameState, io, playerId) {
    if (!gameState.pendingRexChoices) gameState.pendingRexChoices = [];
    if (gameState.pendingRexChoices.some(choice => choice.playerId === playerId && choice.status === 'ACTIVE')) return;

    const holdUntil = rexRevealHolds.get(playerId) || 0;
    if (holdUntil > Date.now()) return;

    const choice = gameState.pendingRexChoices.find(entry => entry.playerId === playerId && entry.status === 'QUEUED');
    if (!choice) return;
    choice.status = 'ACTIVE';
    choice.expiresAt = Date.now() + 3000;
    io.to(playerId).emit('rex_major_choice', {
        choiceId: choice.id,
        card: choice.card,
        durationMs: 3000
    });

    const timer = setTimeout(() => {
        const index = (gameState.pendingRexChoices || []).findIndex(entry => entry.id === choice.id && entry.status === 'ACTIVE');
        if (index === -1) return;
        gameState.pendingRexChoices.splice(index, 1);
        rexChoiceTimers.delete(choice.id);
        io.to(playerId).emit('rex_major_choice_closed', { choiceId: choice.id });
        activateNextRexMajorChoice(gameState, io, playerId);
    }, 3000);
    timer.unref?.();
    rexChoiceTimers.set(choice.id, timer);
}

function queueRexMajorChoice(gameState, io, player, card) {
    if (!io?.to || !player || !card) return;
    if (!gameState.pendingRexChoices) gameState.pendingRexChoices = [];
    const choice = {
        id: `rex_${Date.now()}_${++rexChoiceSequence}`,
        playerId: player.id,
        cardId: card.id,
        card,
        status: 'QUEUED',
        expiresAt: null
    };
    gameState.pendingRexChoices.push(choice);
    activateNextRexMajorChoice(gameState, io, player.id);
}

function resolveRexMajorChoice(gameState, io, playerId, choiceId, reveal) {
    const choices = gameState.pendingRexChoices || [];
    const index = choices.findIndex(choice => choice.id === choiceId && choice.playerId === playerId && choice.status === 'ACTIVE');
    if (index === -1) return { ok: false };
    const choice = choices[index];
    if (choice.expiresAt < Date.now()) {
        clearTimeout(rexChoiceTimers.get(choice.id));
        rexChoiceTimers.delete(choice.id);
        choices.splice(index, 1);
        io.to(playerId).emit('rex_major_choice_closed', { choiceId });
        activateNextRexMajorChoice(gameState, io, playerId);
        return { ok: false };
    }

    clearTimeout(rexChoiceTimers.get(choice.id));
    rexChoiceTimers.delete(choice.id);
    choices.splice(index, 1);
    io.to(playerId).emit('rex_major_choice_closed', { choiceId });

    const player = gameState.players[playerId];
    const card = player?.hand?.find(handCard => handCard.id === choice.cardId && handCard.type === 'Modifier Card');
    if (!reveal || !card) {
        activateNextRexMajorChoice(gameState, io, playerId);
        return { ok: true, revealed: false };
    }

    rexRevealHolds.set(playerId, Date.now() + 2600);
    io.emit('rex_major_reveal', {
        playerId,
        playerName: getPlayerName(gameState, playerId),
        card
    });
    io.emit('message', `${getPlayerName(gameState, playerId)} revealed ${card.name} due to Rex Major and draws another card!`);
    const drawResult = drawCardsForEffect(gameState, io, 1, player, null, 'Rex Major');

    const holdTimer = setTimeout(() => {
        rexRevealHolds.delete(playerId);
        rexRevealTimers.delete(playerId);
        activateNextRexMajorChoice(gameState, io, playerId);
    }, 2600);
    holdTimer.unref?.();
    rexRevealTimers.set(playerId, holdTimer);
    return { ok: true, revealed: true, card, drawn: drawResult.drawn, lumberingQueued: drawResult.queued };
}

function clearRexMajorChoices(gameState) {
    (gameState.pendingRexChoices || []).forEach(choice => {
        clearTimeout(rexChoiceTimers.get(choice.id));
        rexChoiceTimers.delete(choice.id);
    });
    gameState.pendingRexChoices = [];
    for (const timer of rexRevealTimers.values()) clearTimeout(timer);
    rexRevealHolds.clear();
    rexRevealTimers.clear();
}

function maskClass(item) {
    if (!item || item.effect_id !== 'ITEM_MASK') return null;
    if (item.class) return item.class;
    const match = /^(\w+)\s+Mask$/.exec(item.name || '');
    return match ? match[1] : null;
}

function effectiveHeroClass(hero) {
    if (!hero) return null;
    const mask = [hero.equippedItem, hero.equippedItem2].find(item => maskClass(item));
    return (mask && maskClass(mask)) || hero.class;
}

function equippedItems(hero) {
    return [hero && hero.equippedItem, hero && hero.equippedItem2].filter(Boolean);
}

function partyCardCount(player) {
    return (player?.party || []).reduce((count, hero) => count + 1 + equippedItems(hero).length, 0);
}

function hasPartySacrificeTarget(player, allowedTarget = 'ANY_PARTY_CARD') {
    const heroes = player?.party || [];
    if (allowedTarget === 'HERO_ONLY') return heroes.some(card => card.type === 'Hero Card');
    if (allowedTarget === 'ITEM_ONLY') return heroes.some(hero => equippedItems(hero).length > 0);
    return partyCardCount(player) > 0;
}

function startSequentialPartySacrifice(gameState, io, initiatorId, playerIds, options = {}) {
    const allowedTarget = options.allowedTarget || 'ANY_PARTY_CARD';
    const queue = (playerIds || []).filter(id => hasPartySacrificeTarget(gameState.players?.[id], allowedTarget));
    if (queue.length === 0) return false;
    gameState.state = 'WAITING_FOR_GLOBAL_ACTION';
    gameState.pendingGlobalAction = {
        type: 'SEQUENTIAL_PARTY_SACRIFICE',
        initiatorId,
        pendingPlayerIds: [queue[0]],
        remainingPlayerIds: queue.slice(1),
        allowedTarget,
        afterResolution: options.afterResolution || null
    };
    io.emit('global_action_requested', gameState.pendingGlobalAction);
    return true;
}

function hasEquippedEffect(hero, effectId) {
    return equippedItems(hero).some(item => item.effect_id === effectId);
}

function refundTemporalHourglass(hero, player, apSpent) {
    if (!apSpent || !player || !hasEquippedEffect(hero, 'ITEM_TEMPORAL_HOURGLASS')) return false;
    player.ap += 1;
    return true;
}

function discardHeroWithItems(gameState, hero) {
    equippedItems(hero).forEach(item => gameState.discardPile.push(item));
    hero.equippedItem = null;
    hero.equippedItem2 = null;
    gameState.discardPile.push(hero);
}

function triggerCursedGlove(gameState, formerOwner, thief) {
    if (!formerOwner || !thief) return [];
    const moved = [];
    for (let index = formerOwner.party.length - 1; index >= 0; index--) {
        const hero = formerOwner.party[index];
        if (!hasEquippedEffect(hero, 'CURSE_GLOVE')) continue;
        formerOwner.party.splice(index, 1);
        hero.usedSkillThisTurn = false;
        thief.party.push(hero);
        moved.push(hero);
    }
    return moved;
}

function triggerSoulTethers(gameState, owner) {
    if (!owner) return [];
    const sacrificed = [];
    for (let index = owner.party.length - 1; index >= 0; index--) {
        const hero = owner.party[index];
        if (!hasEquippedEffect(hero, 'CURSE_SOUL_TETHER')) continue;
        owner.party.splice(index, 1);
        if (owner.maegistyActive) {
            const items = equippedItems(hero);
            hero.equippedItem = null;
            hero.equippedItem2 = null;
            owner.hand.push(hero, ...items);
        } else {
            const removedItems = ['equippedItem', 'equippedItem2']
                .filter(slot => hero[slot])
                .map(slot => ({ slot, card: hero[slot] }));
            discardHeroWithItems(gameState, hero);
            recordSacrificeEvent(gameState, owner, hero, { isHero: true, removedItems });
        }
        sacrificed.push(hero);
    }
    return sacrificed;
}

function queueMonsterTrigger(gameState, trigger) {
    if (!gameState.pendingMonsterTriggers) gameState.pendingMonsterTriggers = [];
    gameState.pendingMonsterTriggers.push(trigger);
}

function queueCommittedHeroRemovalTriggers(gameState, owner, card, {
    eventType,
    isHero = false,
    initiatorId = null
} = {}) {
    if (!owner || !card) return;
    const slain = owner.slainMonsters || [];
    if (isHero) {
        triggerSoulTethers(gameState, owner);
        if (initiatorId && gameState.players?.[initiatorId]?.silentShieldActive) {
            gameState.pendingSilentShieldActorId = initiatorId;
        }
        if (eventType === 'DESTROY'
            && slain.some(monster => monster.effect_id === 'MONSTER_DRACOS')) {
            drawCardsForEffect(gameState, null, 1, owner, null, 'Dracos');
        }
    }
    if (eventType === 'SACRIFICE') {
        Object.values(gameState.players || {}).forEach(feralOwner => {
            if ((feralOwner.slainMonsters || []).some(monster => monster.effect_id === 'MONSTER_FERAL_DRAGON')) {
                queueMonsterTrigger(gameState, {
                    type: 'FERAL_DRAGON_DRAW', playerId: feralOwner.id,
                    sacrificingPlayerId: owner.id, sourceCardId: card.id
                });
            }
        });
        if (slain.some(monster => monster.effect_id === 'MONSTER_DOOMBRINGER')) {
            queueMonsterTrigger(gameState, { type: 'DOOMBRINGER_RETRIEVE', playerId: owner.id, sourceCardId: card.id });
        }
        if (isHero && slain.some(monster => monster.effect_id === 'MONSTER_WANDERING_BEHEMOTH')) {
            queueMonsterTrigger(gameState, { type: 'WANDERING_BEHEMOTH_DRAW', playerId: owner.id, sourceCardId: card.id });
        }
    }
    if (isHero && slain.some(monster => monster.effect_id === 'MONSTER_SAFFYRE_PHOENIX')) {
        queueMonsterTrigger(gameState, { type: 'SAFFYRE_PHOENIX_PLAY', playerId: owner.id, sourceCardId: card.id });
    }
}

function queueHeroRemovalEvent(gameState, owner, hero, {
    eventType,
    removedItems = [],
    initiatorId = null
} = {}) {
    if (!owner || !hero) return false;
    const hasDragonWasp = (owner.slainMonsters || [])
        .some(monster => monster.effect_id === 'MONSTER_DRAGON_WASP');
    if (hasDragonWasp && (owner.hand || []).length >= 2) {
        queueMonsterTrigger(gameState, {
            type: 'DRAGON_WASP_REPLACEMENT', playerId: owner.id,
            sourceCardId: hero.id, hero, removedItems, eventType, initiatorId
        });
        return true;
    }
    queueCommittedHeroRemovalTriggers(gameState, owner, hero, {
        eventType, isHero: true, initiatorId
    });
    return false;
}

function recordSacrificeEvent(gameState, owner, card, {
    isHero = false,
    removedItems = [],
    initiatorId = null
} = {}) {
    if (!owner || !card) return false;
    if (isHero) {
        return queueHeroRemovalEvent(gameState, owner, card, {
            eventType: 'SACRIFICE', removedItems, initiatorId
        });
    }
    queueCommittedHeroRemovalTriggers(gameState, owner, card, {
        eventType: 'SACRIFICE', isHero: false, initiatorId
    });
    return false;
}

function recordDestroyEvent(gameState, owner, hero, options = {}) {
    return queueHeroRemovalEvent(gameState, owner, hero, {
        eventType: 'DESTROY', ...options
    });
}

function recordFailedSkillEvent(gameState, owner, hero) {
    if (!owner || !hero) return;
    if ((owner.slainMonsters || []).some(monster => monster.effect_id === 'MONSTER_REEF_RIPPER')) {
        queueMonsterTrigger(gameState, { type: 'REEF_RIPPER_DRAW', playerId: owner.id, sourceCardId: hero.id });
    }
}

function rebuildMainDeckIfNeeded(gameState, io) {
    if (gameState.mainDeck.length > 0 || gameState.discardPile.length === 0) return;
    gameState.mainDeck.push(...gameState.discardPile.splice(0));
    for (let i = gameState.mainDeck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [gameState.mainDeck[i], gameState.mainDeck[j]] = [gameState.mainDeck[j], gameState.mainDeck[i]];
    }
    if (io?.emit) io.emit('message', 'The main deck was empty, so the discard pile was shuffled into a fresh deck.');
}

function drawCardsWithoutPassives(gameState, io, count, player) {
    const drawn = [];
    for (let i = 0; i < count; i++) {
        rebuildMainDeckIfNeeded(gameState, io);
        if (gameState.mainDeck.length === 0) break;
        const card = gameState.mainDeck.pop();
        player.hand.push(card);
        drawn.push(card);
    }
    return drawn;
}

function applyDrawnCardPassives(gameState, io, player, card) {
    if (!player || !card) return;
    const hasRex = (player.slainMonsters || []).some(m => m.effect_id === 'MONSTER_REX_MAJOR');
    const hasOrthus = (player.slainMonsters || []).some(m => m.effect_id === 'MONSTER_ORTHUS');
    const hasCalamityMongrel = (player.slainMonsters || []).some(m => m.effect_id === 'MONSTER_CALAMITY_MONGREL');
    if (hasCalamityMongrel && card.type === 'Challenge Card') {
        if (!gameState.pendingMonsterTriggers) gameState.pendingMonsterTriggers = [];
        gameState.pendingMonsterTriggers.push({
            type: 'CALAMITY_MONGREL_REPLACE', playerId: player.id, cardId: card.id
        });
    }
    if (hasOrthus && card.type === 'Magic Card' && !gameState.pendingCard) {
        const handIndex = player.hand.findIndex(candidate => candidate.id === card.id);
        if (handIndex !== -1) player.hand.splice(handIndex, 1);
        const discardIndex = gameState.discardPile.findIndex(candidate => candidate.id === card.id);
        if (discardIndex !== -1) gameState.discardPile.splice(discardIndex, 1);
        gameState.state = 'WAITING_FOR_IMMEDIATE_PLAY';
        gameState.pendingCard = card;
        gameState.pendingAction = {
            playerToChoose: player.id,
            type: 'IMMEDIATE_PLAY',
            originalActor: player.id,
            source: 'MONSTER_ORTHUS'
        };
    }
    if (hasRex && card.type === 'Modifier Card') queueRexMajorChoice(gameState, io, player, card);
}

// Put cards drawn by an effect through the slain-monster draw passives. This is
// shared by Hero skills, Magic effects, and the server's normal draw action so
// Orthus/Rex Major do not depend on which code path produced the draw.
function drawCardsWithPassives(gameState, io, count, player) {
    const drawn = drawCardsWithoutPassives(gameState, io, count, player);
    drawn.forEach(card => applyDrawnCardPassives(gameState, io, player, card));
    return drawn;
}

function queueLumberingDrawSequence(gameState, player, count, continuation = null, source = 'card effect') {
    if (!player || count <= 0 || !(player.slainMonsters || [])
        .some(monster => monster.effect_id === 'MONSTER_LUMBERING_DEMON')) return false;
    if (!gameState.pendingLumberingDraws) gameState.pendingLumberingDraws = [];
    gameState.pendingLumberingDraws.push({
        playerId: player.id, remaining: count, continuation, source,
        drawnCardIds: [], drawnCards: []
    });
    return true;
}

function drawCardsForEffect(gameState, io, count, player, continuation = null, source = 'card effect') {
    if (queueLumberingDrawSequence(gameState, player, count, continuation, source)) {
        return { queued: true, drawn: [] };
    }
    return { queued: false, drawn: drawCardsWithPassives(gameState, io, count, player) };
}

function triggerCrownedSerpent(gameState, io) {
    Object.values(gameState.players || {}).forEach(player => {
        if ((player.slainMonsters || []).some(m => m.effect_id === 'MONSTER_CROWNED_SERPENT') && gameState.mainDeck.length > 0) {
            drawCardsForEffect(gameState, io, 1, player, null, 'Crowned Serpent');
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
    const slot = ['equippedItem', 'equippedItem2']
        .find(key => targetHero && targetHero[key] && targetHero[key].effect_id === 'ITEM_DECOY');
    if (slot) {
        gameState.discardPile.push(targetHero[slot]);
        targetHero[slot] = null;
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

    const stealSkills = ['STEAL_HERO', 'SKILL_TIPSY_TOOTIE', 'SKILL_WIGGLES', 'SKILL_PERFECT_VESSEL'];
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
        triggerCursedGlove(gameState, targetPlayer, initiator);
        actionMessage = `Corrupted Sabretooth turned a Destroy into a Steal! ${getPlayerName(gameState, initiatorId)} STOLE ${getPlayerName(gameState, targetPlayerId)}'s ${targetHero.name}!`;
    } else {
        let itemNote = '';
        const removedItems = ['equippedItem', 'equippedItem2']
            .filter(slot => targetHero[slot])
            .map(slot => ({ slot, card: targetHero[slot] }));
        const items = removedItems.map(entry => entry.card);
        if (targetPlayer.maegistyActive) {
            targetPlayer.party.splice(tHeroIndex, 1);
            targetHero.equippedItem = null;
            targetHero.equippedItem2 = null;
            targetPlayer.hand.push(targetHero, ...items);
            return `${targetHero.name} and its equipped Items returned to ${getPlayerName(gameState, targetPlayerId)}'s hand due to Maegisty!`;
        }
        items.forEach(item => keepItem ? initiator.hand.push(item) : gameState.discardPile.push(item));
        if (keepItem && items.length) itemNote = ` ${getPlayerName(gameState, initiatorId)} took ${items.length} equipped Item${items.length === 1 ? '' : 's'}!`;
        targetHero.equippedItem = null;
        targetHero.equippedItem2 = null;
        targetPlayer.party.splice(tHeroIndex, 1);
        gameState.discardPile.push(targetHero);
        recordDestroyEvent(gameState, targetPlayer, targetHero, {
            removedItems,
            initiatorId: initiator.silentShieldActive ? initiatorId : null
        });
        actionMessage = `${getPlayerName(gameState, initiatorId)} DESTROYED ${getPlayerName(gameState, targetPlayerId)}'s ${targetHero.name}!${itemNote}`;
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

    // The roll has already resolved before this function runs. Start from the
    // normal action state; multi-step effects below replace it with their own
    // explicit waiting state. This also prevents immediate skills from leaving
    // the game stranded in the expired modifier window.
    if (gameState.state === 'WAITING_FOR_MODIFIERS') gameState.state = 'PLAYING';

    // Helper to draw cards securely
    const drawCards = (num, p) => drawCardsWithPassives(gameState, io, num, p);
    const drawEffect = (num, p, continuation, source = heroName) =>
        drawCardsForEffect(gameState, io, num, p, continuation, source);

    switch(skillId) {
        // --- DRAGON SORCERER EXPANSION ---
        case 'SKILL_DRAGALTER': {
            const modifiers = player.hand.filter(card => card.type === 'Modifier Card');
            if (modifiers.length > 0) {
                gameState.state = 'WAITING_FOR_DRAGALTER_CHOICE';
                gameState.pendingAction = {
                    type: 'DRAGALTER_MODIFIER', playerToChoose: rollerId,
                    originalActor: rollerId, allowedCardIds: modifiers.map(card => card.id)
                };
                actionMessage = `${getPlayerName(gameState, player.id)} must choose a Modifier to discard for Dragalter.`;
            } else {
                actionMessage = `${getPlayerName(gameState, player.id)} has no Modifier to discard for Dragalter.`;
            }
            break;
        }
        case 'SKILL_DYSTORTIVERN': {
            const target = targetData?.targetPlayerId && gameState.players[targetData.targetPlayerId];
            if (target && target.id !== rollerId && player.leader && target.leader) {
                [player.leader, target.leader] = [target.leader, player.leader];
                actionMessage = `${getPlayerName(gameState, player.id)} traded Party Leaders with ${getPlayerName(gameState, target.id)} using Dystortivern.`;
            } else {
                actionMessage = `Dystortivern could not trade Party Leaders.`;
            }
            break;
        }
        case 'SKILL_EXTRAGA': {
            let returned = 0;
            Object.values(gameState.players || {}).forEach(owner => {
                for (let index = owner.party.length - 1; index >= 0; index--) {
                    const otherHero = owner.party[index];
                    if (otherHero.id === heroId || effectiveHeroClass(otherHero) !== 'Sorcerer') continue;
                    owner.party.splice(index, 1);
                    const items = equippedItems(otherHero);
                    otherHero.equippedItem = null;
                    otherHero.equippedItem2 = null;
                    otherHero.usedSkillThisTurn = false;
                    owner.hand.push(otherHero, ...items);
                    returned += 1;
                }
            });
            actionMessage = `${getPlayerName(gameState, player.id)} returned ${returned} other Sorcerer${returned === 1 ? '' : 's'} to their owners' hands with Extraga.`;
            break;
        }
        case 'SKILL_LUUT': {
            const equipped = [];
            Object.entries(gameState.players || {}).forEach(([ownerId, owner]) => {
                if (ownerId === rollerId) return;
                (owner.party || []).forEach(targetHero => equippedItems(targetHero)
                    .filter(item => item.type === 'Item Card')
                    .forEach(item => {
                    equipped.push({ ownerId, heroId: targetHero.id, itemId: item.id });
                }));
            });
            const destinations = (player.party || []).filter(targetHero => equippedItems(targetHero).length < (targetHero.item_slots || 1));
            if (equipped.length > 0 && destinations.length > 0) {
                gameState.state = 'WAITING_FOR_LUUT_CHOICE';
                gameState.pendingAction = {
                    type: 'LUUT_ITEM', playerToChoose: rollerId, originalActor: rollerId,
                    availableItems: equipped, destinationHeroIds: destinations.map(card => card.id)
                };
                actionMessage = `${getPlayerName(gameState, player.id)} must choose an equipped Item to steal with Luut.`;
            } else {
                actionMessage = `Luut has no legal Item and destination Hero combination.`;
            }
            break;
        }
        case 'SKILL_MIRRORYU': {
            const targets = (player.party || []).filter(card => card.id !== heroId && card.skill_id && !hasEquippedEffect(card, 'ITEM_SEALING_KEY'));
            if (targets.length > 0) {
                gameState.state = 'WAITING_FOR_MIRRORYU_CHOICE';
                gameState.pendingAction = {
                    type: 'MIRRORYU_HERO', playerToChoose: rollerId, originalActor: rollerId,
                    sourceHeroId: heroId, allowedHeroIds: targets.map(card => card.id)
                };
                actionMessage = `${getPlayerName(gameState, player.id)} must choose another Hero for Mirroryu.`;
            } else {
                actionMessage = `Mirroryu has no other Hero effect to copy.`;
            }
            break;
        }
        case 'SKILL_ORACON': {
            const target = targetData?.targetPlayerId && gameState.players[targetData.targetPlayerId];
            if (target && target.id !== rollerId && target.hand.length > 0) {
                const pulled = target.hand.splice(Math.floor(Math.random() * target.hand.length), 1)[0];
                player.hand.push(pulled);
                if (pulled.type === 'Modifier Card' && target.party.some(card => card.type === 'Hero Card')) {
                    gameState.state = 'WAITING_FOR_SACRIFICE';
                    gameState.pendingAction = {
                        type: 'ORACON_SACRIFICE', playerToChoose: target.id,
                        originalActor: rollerId, skillId
                    };
                }
                actionMessage = `${getPlayerName(gameState, player.id)} pulled a card from ${getPlayerName(gameState, target.id)} with Oracon${pulled.type === 'Modifier Card' ? '; it was a Modifier' : ''}.`;
            } else {
                actionMessage = `Oracon had no card to pull.`;
            }
            break;
        }
        case 'SKILL_RENOVERN': {
            const index = gameState.discardPile.findIndex(card => card.id === targetData?.targetCardId && card.type === 'Item Card');
            if (index !== -1) {
                const item = gameState.discardPile.splice(index, 1)[0];
                player.hand.push(item);
                gameState.state = 'WAITING_FOR_HAND_SELECTION';
                gameState.pendingAction = {
                    type: 'PLAY_FROM_HAND', allowedTypes: ['Item Card'], allowedCardIds: [item.id],
                    playerToChoose: rollerId, originalActor: rollerId, expansionFreePlay: true,
                    mandatory: true, source: heroName
                };
                actionMessage = `${getPlayerName(gameState, player.id)} retrieved ${item.name} and must play it immediately with Renovern.`;
            } else {
                actionMessage = `Renovern found no Item card to play.`;
            }
            break;
        }
        case 'SKILL_SHAMANAGA': {
            const index = gameState.discardPile.findIndex(card => card.id === targetData?.targetCardId && card.type === 'Hero Card');
            if (index !== -1) {
                const summoned = gameState.discardPile.splice(index, 1)[0];
                summoned.usedSkillThisTurn = false;
                player.party.push(summoned);
                gameState.pendingShamanagaSacrifice = { playerId: rollerId, heroId: summoned.id };
                gameState.state = 'WAITING_TO_ROLL';
                gameState.pendingAction = null;
                gameState.pendingRoll = {
                    type: 'HERO_SKILL', rollerId, targetHeroId: summoned.id,
                    roll1: 0, roll2: 0, passiveBonus: 0, modifierTotal: 0,
                    baseRoll: 0, currentRoll: 0, passedPlayers: [], apSpent: 0,
                    shamanagaFreeRoll: true
                };
                actionMessage = `${getPlayerName(gameState, player.id)} brought ${summoned.name} into their Party and must roll its effect immediately with Shamanaga.`;
            } else {
                actionMessage = `Shamanaga found no Hero card in the discard pile.`;
            }
            break;
        }
        case 'SKILL_SMOK': {
            const result = drawEffect(2, player, { type: 'SMOK_REVEAL', playerId: rollerId }, 'Smok');
            if (!result.queued) {
                const magicCards = result.drawn.filter(card => card.type === 'Magic Card');
                if (magicCards.length > 0) {
                    gameState.pendingSmokReveal = {
                        playerId: rollerId, allowedCardIds: magicCards.map(card => card.id)
                    };
                }
            }
            actionMessage = `${getPlayerName(gameState, player.id)} drew 2 cards with Smok${gameState.pendingSmokReveal ? ' and may reveal a Magic card' : ''}.`;
            break;
        }
        // --- WARRIOR & DRUID EXPANSION ---
        case 'SKILL_BIG_BUCKLEY':
            gameState.state = 'PLAYING';
            gameState.pendingAction = {
                type: 'FREE_ATTACK',
                playerToChoose: rollerId,
                originalActor: rollerId,
                optional: true
            };
            actionMessage = `${getPlayerName(gameState, player.id)} may attack a Monster for free with Big Buckley.`;
            break;
        case 'SKILL_BUCK_OMENS': {
            const target = targetData?.targetPlayerId && gameState.players[targetData.targetPlayerId];
            const heroes = (target?.hand || []).filter(card => card.type === 'Hero Card');
            if (target && heroes.length) {
                gameState.pendingPeek = { rollerId, targetPlayerId: target.id, skillId, allowedCardIds: heroes.map(card => card.id) };
                io.to(rollerId).emit('peek_cards', { cards: heroes, skillId, title: `Bring a Hero from ${getPlayerName(gameState, target.id)}'s hand`, actionLabel: 'Bring To Party' });
                actionMessage = `${getPlayerName(gameState, player.id)} is choosing a Hero with Buck Omens.`;
            } else actionMessage = `${target ? getPlayerName(gameState, target.id) : 'That player'} has no Hero cards for Buck Omens.`;
            break;
        }
        case 'SKILL_DOE_FALLOW':
        case 'SKILL_MAJESTELK':
            if (player.party.some(card => card.type === 'Hero Card')) {
                gameState.state = 'WAITING_FOR_SACRIFICE';
                gameState.pendingAction = { type: 'DRUID_SKILL_SACRIFICE', playerToChoose: rollerId, originalActor: rollerId, skillId };
                actionMessage = `${getPlayerName(gameState, player.id)} must sacrifice a Hero for ${heroName}.`;
            }
            break;
        case 'SKILL_GLOWING_ANTLER':
            gameState.freePlayQueue = { playerId: rollerId, remaining: 2, allowedTypes: ['Magic Card'], source: heroName };
            actionMessage = `${getPlayerName(gameState, player.id)} may play up to 2 Magic cards immediately.`;
            break;
        case 'SKILL_MAEGISTY':
            player.maegistyActive = true;
            actionMessage = `${getPlayerName(gameState, player.id)}'s Heroes and their Items return to hand instead of being sacrificed or destroyed until their next turn.`;
            break;
        case 'SKILL_MAGUS_MOOSE':
        case 'SKILL_SILENT_SHIELD_RETRIEVE': {
            const index = gameState.discardPile.findIndex(card => card.id === targetData?.targetCardId && card.type === 'Hero Card');
            if (index !== -1) {
                const card = gameState.discardPile.splice(index, 1)[0];
                player.hand.push(card);
                if (skillId === 'SKILL_MAGUS_MOOSE') {
                    gameState.freePlayQueue = { playerId: rollerId, remaining: 1, allowedTypes: ['Hero Card'], allowedCardIds: [card.id], source: heroName, mandatory: true };
                }
                actionMessage = `${getPlayerName(gameState, player.id)} retrieved ${card.name} from the discard pile.`;
            }
            break;
        }
        case 'SKILL_STAGGUARD':
            player.stagguardActive = true;
            actionMessage = `Only ${getPlayerName(gameState, player.id)} may play Modifiers for the rest of this turn.`;
            break;
        case 'SKILL_AGILE_DAGGER':
            gameState.freePlayQueue = { playerId: rollerId, remaining: 2, allowedTypes: ['Item Card', 'Cursed Item Card'], source: heroName };
            actionMessage = `${getPlayerName(gameState, player.id)} may play up to 2 Item cards immediately.`;
            break;
        case 'SKILL_BLINDING_BLADE': {
            const target = targetData?.targetPlayerId && gameState.players[targetData.targetPlayerId];
            let moved = 0;
            (target?.party || []).forEach(targetHero => {
                equippedItems(targetHero).forEach(item => { player.hand.push(item); moved++; });
                targetHero.equippedItem = null;
                targetHero.equippedItem2 = null;
            });
            actionMessage = `${getPlayerName(gameState, player.id)} took ${moved} equipped Item${moved === 1 ? '' : 's'} from ${target ? getPlayerName(gameState, target.id) : 'the target'}.`;
            break;
        }
        case 'SKILL_CRITICAL_FANG':
            player.attackRollBonus = (player.attackRollBonus || 0) + 4;
            actionMessage = `${getPlayerName(gameState, player.id)} gets +4 on attack rolls for the rest of this turn.`;
            break;
        case 'SKILL_HARDENED_HUNTER': {
            const amount = Object.entries(gameState.players).reduce((sum, [id, other]) => sum + (id === rollerId ? 0 : (other.slainMonsters || []).length), 0);
            drawEffect(amount, player, null);
            actionMessage = `${getPlayerName(gameState, player.id)} drew ${amount} card(s), one for each opponent's slain Monster.`;
            break;
        }
        case 'SKILL_LOOTING_LUPO': {
            const amount = (player.party || []).reduce((sum, partyHero) => sum + equippedItems(partyHero).length, 0);
            drawEffect(amount, player, null);
            actionMessage = `${getPlayerName(gameState, player.id)} drew ${amount} card(s), one for each equipped Item in their party.`;
            break;
        }
        case 'SKILL_SILENT_SHIELD':
            player.silentShieldActive = true;
            actionMessage = `${getPlayerName(gameState, player.id)} may retrieve a Hero after each Hero they sacrifice or destroy this turn.`;
            break;
        case 'SKILL_TENACIOUS_TIMBER': {
            const limit = (player.slainMonsters || []).length;
            const selected = [...new Set(targetData?.targetHeroIds || [])].slice(0, limit);
            let stolen = 0;
            selected.forEach(targetHeroId => {
                for (const [targetId, target] of Object.entries(gameState.players)) {
                    if (targetId === rollerId || target.cannotBeStolen) continue;
                    const index = target.party.findIndex(card => card.id === targetHeroId && card.type === 'Hero Card');
                    if (index === -1) continue;
                    const card = target.party.splice(index, 1)[0];
                    card.usedSkillThisTurn = false;
                    player.party.push(card);
                    triggerCursedGlove(gameState, target, player);
                    stolen++;
                    break;
                }
            });
            actionMessage = `${getPlayerName(gameState, player.id)} stole ${stolen} Hero${stolen === 1 ? '' : 'es'} with Tenacious Timber.`;
            break;
        }
        case 'SKILL_WOLFGANG_PACK': {
            const bonus = Math.max(0, (player.party || []).filter(card => card.type === 'Hero Card' && card.id !== heroId).length);
            player.rollBonus = (player.rollBonus || 0) + bonus;
            player.rollBonusSources = [...(player.rollBonusSources || []), { source: heroName, value: bonus }];
            actionMessage = `${getPlayerName(gameState, player.id)} gets +${bonus} on all rolls for the rest of this turn.`;
            break;
        }
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
            const drawResult = drawEffect(2, player, { type: 'PAN_CHUCKS', playerId: rollerId });
            if (drawResult.queued) {
                actionMessage = `${getPlayerName(gameState, player.id)} is resolving Pan Chucks one draw at a time with Lumbering Demon.`;
                break;
            }
            const drawn = drawResult.drawn;
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
            if (!drawEffect(3, player, { type: 'DISCARD_ONE', playerId: rollerId }, heroName).queued) {
                gameState.state = 'PLAYING';
                gameState.pendingAction = { type: 'DISCARD', playerToChoose: rollerId, amount: 1, originalActor: rollerId };
            }
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
            if (drawEffect(1, player, { type: 'FUZZY_CHEEKS', playerId: rollerId }, heroName).queued) {
                actionMessage = `${getPlayerName(gameState, player.id)} is resolving Fuzzy Cheeks with Lumbering Demon.`;
                break;
            }
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
                drawEffect(1, player, null, heroName);
                actionMessage = `${getPlayerName(gameState, player.id)} had no Item to play with Hook, so they drew a card.`;
            }
            break;
        case 'SKILL_QUICK_DRAW': {
            // "DRAW 2 cards. If at least one of those cards is an item card, you may
            // play one of them immediately." The play option is conditional on one of
            // the TWO DRAWN cards being an Item — not on Items already in hand.
            const drawResult = drawEffect(2, player, { type: 'QUICK_DRAW', playerId: rollerId }, heroName);
            if (drawResult.queued) {
                actionMessage = `${getPlayerName(gameState, player.id)} is resolving Quick Draw with Lumbering Demon.`;
                break;
            }
            const qdDrawn = drawResult.drawn;
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
                const drawResult = drawEffect(1, player, { type: 'SNOWBALL', playerId: rollerId }, heroName);
                if (drawResult.queued) {
                    actionMessage = `${getPlayerName(gameState, player.id)} is resolving Snowball with Lumbering Demon.`;
                    break;
                }
                const snowballCard = drawResult.drawn[0];
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
            drawEffect(1, player, null, heroName);
            actionMessage = `${getPlayerName(gameState, player.id)} used ${heroName}'s skill to draw a card.`;
            break;
        case 'DRAW_2_CARDS':
            drawEffect(2, player, null, heroName);
            actionMessage = `${getPlayerName(gameState, player.id)} used ${heroName}'s skill to draw 2 cards.`;
            break;
        case 'DRAW_AND_PLAY':
            if (gameState.mainDeck.length > 0) {
                const drawResult = drawEffect(1, player, { type: 'DRAW_AND_PLAY', playerId: rollerId }, heroName);
                if (drawResult.queued) {
                    actionMessage = `${getPlayerName(gameState, player.id)} is resolving ${heroName} with Lumbering Demon.`;
                    break;
                }
                const drawnCard = drawResult.drawn[0];
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
        case 'SKILL_BARK_HEXER': {
            if (player.hand.length === 0) {
                actionMessage = `${getPlayerName(gameState, player.id)} cannot pay Bark Hexer's discard cost.`;
                break;
            }
            const targets = (gameState.playerOrder || Object.keys(gameState.players))
                .filter(id => id !== rollerId && gameState.players[id]?.hand?.length > 0);
            gameState.pendingAction = {
                type: 'DISCARD', playerToChoose: rollerId, originalActor: rollerId,
                amount: 1,
                nextAction: { type: 'START_SEQUENTIAL_DISCARD', targets, amount: 2, originalActor: rollerId }
            };
            actionMessage = `${getPlayerName(gameState, player.id)} must discard a card to activate Bark Hexer.`;
            break;
        }
        case 'SKILL_SHADOW_SAINT': {
            if (!player.hand.some(card => card.type === 'Modifier Card')) {
                actionMessage = `${getPlayerName(gameState, player.id)} has no Modifier to discard for Shadow Saint.`;
                break;
            }
            gameState.pendingAction = {
                type: 'DISCARD', playerToChoose: rollerId, originalActor: rollerId,
                amount: 1, allowedTypes: ['Modifier Card'],
                nextAction: { type: 'APPLY_SHADOW_SAINT', originalActor: rollerId }
            };
            actionMessage = `${getPlayerName(gameState, player.id)} must discard a Modifier to activate Shadow Saint.`;
            break;
        }
        case 'SKILL_MEOWNTAIN': {
            if (startSequentialPartySacrifice(gameState, io, rollerId, [rollerId], {
                afterResolution: { type: 'MEOWNTAIN_BONUS', playerId: rollerId }
            })) {
                actionMessage = `${getPlayerName(gameState, player.id)} must sacrifice a Party card to gain +5 to all rolls this turn.`;
            } else {
                actionMessage = `${getPlayerName(gameState, player.id)} has no Party card to sacrifice for Meowntain.`;
            }
            break;
        }
        case 'SKILL_GRIM_PUPPER': {
            const targets = (gameState.playerOrder || Object.keys(gameState.players))
                .filter(id => partyCardCount(gameState.players[id]) > 0);
            if (startSequentialPartySacrifice(gameState, io, rollerId, targets)) {
                actionMessage = `Grim Pupper makes every player sacrifice one Party card in seat order.`;
            } else {
                actionMessage = `No player has a Party card to sacrifice for Grim Pupper.`;
            }
            break;
        }
        case 'SKILL_BRAWLING_SPIRIT': {
            const targets = (gameState.playerOrder || Object.keys(gameState.players))
                .filter(id => partyCardCount(gameState.players[id]) > 3);
            if (startSequentialPartySacrifice(gameState, io, rollerId, targets)) {
                actionMessage = `Brawling Spirit makes each player with more than 3 Party cards sacrifice one in seat order.`;
            } else {
                actionMessage = `No player has more than 3 Party cards for Brawling Spirit.`;
            }
            break;
        }
        case 'SKILL_BEHOLDEN_RETRIEVER': {
            if (targetData?.targetCardId) {
                const index = gameState.discardPile.findIndex(card => card.id === targetData.targetCardId
                    && ['Hero Card', 'Item Card'].includes(card.type));
                if (index === -1) {
                    actionMessage = `The selected card is not a Hero or Item for Beholden Retriever.`;
                    break;
                }
                const card = gameState.discardPile.splice(index, 1)[0];
                player.hand.push(card);
                gameState.state = 'WAITING_FOR_HAND_SELECTION';
                gameState.pendingAction = {
                    type: 'PLAY_FROM_HAND', allowedTypes: [card.type], allowedCardIds: [card.id],
                    playerToChoose: rollerId, originalActor: rollerId,
                    optional: false, expansionFreePlay: true
                };
                actionMessage = `${getPlayerName(gameState, player.id)} retrieved ${card.name} with Beholden Retriever and must play it immediately for 0 AP.`;
            } else if (startSequentialPartySacrifice(gameState, io, rollerId, [rollerId], {
                allowedTarget: 'HERO_ONLY',
                afterResolution: { type: 'DISCARD_RETRIEVAL', playerId: rollerId, skillId: 'SKILL_BEHOLDEN_RETRIEVER', allowedTypes: ['Hero Card', 'Item Card'] }
            })) {
                actionMessage = `${getPlayerName(gameState, player.id)} must sacrifice a Hero for Beholden Retriever.`;
            } else {
                actionMessage = `${getPlayerName(gameState, player.id)} has no Hero to sacrifice for Beholden Retriever.`;
            }
            break;
        }
        case 'SKILL_BONE_COLLECTOR': {
            if (targetData?.targetCardId) {
                const index = gameState.discardPile.findIndex(card => card.id === targetData.targetCardId && card.type === 'Hero Card');
                if (index === -1) {
                    actionMessage = `The selected card is not a Hero for Bone Collector.`;
                    break;
                }
                const card = gameState.discardPile.splice(index, 1)[0];
                player.hand.push(card);
                gameState.state = 'WAITING_FOR_HAND_SELECTION';
                gameState.pendingAction = {
                    type: 'PLAY_FROM_HAND', allowedTypes: ['Hero Card'], allowedCardIds: [card.id],
                    playerToChoose: rollerId, originalActor: rollerId,
                    optional: false, expansionFreePlay: true
                };
                actionMessage = `${getPlayerName(gameState, player.id)} retrieved ${card.name} with Bone Collector and must play it immediately for 0 AP.`;
            } else if (startSequentialPartySacrifice(gameState, io, rollerId, [rollerId], {
                allowedTarget: 'ITEM_ONLY',
                afterResolution: { type: 'DISCARD_RETRIEVAL', playerId: rollerId, skillId: 'SKILL_BONE_COLLECTOR', allowedTypes: ['Hero Card'] }
            })) {
                actionMessage = `${getPlayerName(gameState, player.id)} must sacrifice an equipped Item for Bone Collector.`;
            } else {
                actionMessage = `${getPlayerName(gameState, player.id)} has no equipped Item to sacrifice for Bone Collector.`;
            }
            break;
        }
        case 'SKILL_ROARYAL_GUARD':
            gameState.state = 'WAITING_FOR_CLASS_SELECTION';
            gameState.pendingAction = {
                type: 'ROARYAL_GUARD_CLASS', playerToChoose: rollerId, originalActor: rollerId
            };
            actionMessage = `${getPlayerName(gameState, player.id)} must choose a class for Roaryal Guard.`;
            break;
        case 'SKILL_VICIOUS_WILDCAT':
            if ((gameState.activeMonsters || []).length > 0) {
                gameState.state = 'PLAYING';
                gameState.pendingAction = {
                    type: 'FREE_SLAY', playerToChoose: rollerId, originalActor: rollerId
                };
                actionMessage = `${getPlayerName(gameState, player.id)} may choose any face-up Monster to slay with Vicious Wildcat.`;
            } else {
                actionMessage = `There is no face-up Monster for Vicious Wildcat to slay.`;
            }
            break;
        case 'SKILL_GRUESOME_GLADIATOR': {
            const targets = (gameState.playerOrder || Object.keys(gameState.players))
                .filter(id => id !== rollerId && gameState.players[id]?.hand?.length > 0);
            if (targets.length > 0) {
                gameState.state = 'WAITING_FOR_SKILL_TARGET';
                gameState.pendingAction = {
                    type: 'GRUESOME_GLADIATOR_HAND', playerToChoose: rollerId, originalActor: rollerId,
                    targetPlayerId: targets[0], remainingPlayerIds: targets.slice(1)
                };
                actionMessage = `${getPlayerName(gameState, player.id)} is choosing one card from each other player's hand in seat order.`;
            } else {
                actionMessage = `No opponent has a card for Gruesome Gladiator to take.`;
            }
            break;
        }
        case 'SKILL_RABID_BEAST':
            gameState.state = 'WAITING_FOR_GLOBAL_ACTION';
            gameState.pendingGlobalAction = {
                type: 'VARIABLE_PARTY_SACRIFICE', initiatorId: rollerId,
                pendingPlayerIds: [rollerId], sacrificedCount: 0
            };
            io.emit('global_action_requested', gameState.pendingGlobalAction);
            actionMessage = `${getPlayerName(gameState, player.id)} may sacrifice any number of Party cards with Rabid Beast.`;
            break;
        case 'SKILL_WISE_SHIELD':
            player.rollBonus = (player.rollBonus || 0) + 3;
            (player.rollBonusSources = player.rollBonusSources || []).push({ source: 'Wise Shield', value: 3 });
            actionMessage = `${getPlayerName(gameState, player.id)} gained +3 to all rolls this turn!`;
            break;
        case 'SKILL_WILY_RED':
            drawEffect(Math.max(0, 7 - player.hand.length), player, null, heroName);
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
                        triggerCursedGlove(gameState, tp, player);
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
                        triggerCursedGlove(gameState, tp, player);
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
            drawEffect(1, player, null, heroName);
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
                        triggerCursedGlove(gameState, tp, player);
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
                        triggerCursedGlove(gameState, tp, player);
                        actionMessage = `${getPlayerName(gameState, player.id)} STOLE ${targetHero.name} from ${getPlayerName(gameState, tp.id)}!`;
                    }
                } else if (tp && tp.cannotBeStolen) {
                     actionMessage = `${getPlayerName(gameState, player.id)} tried to steal ${getPlayerName(gameState, tp.id)}'s Hero, but they are protected by Calming Voice!`;
                }
            }
            break;
        case 'SKILL_PERFECT_VESSEL':
            if (targetData?.targetPlayerId && targetData?.targetHeroId) {
                const vesselIndex = player.party.findIndex(card => card.id === heroId);
                const tp = gameState.players[targetData.targetPlayerId];
                const targetIndex = tp && !tp.cannotBeStolen
                    ? tp.party.findIndex(card => card.id === targetData.targetHeroId)
                    : -1;
                if (vesselIndex !== -1 && targetIndex !== -1) {
                    const vessel = player.party.splice(vesselIndex, 1)[0];
                    const removedItems = ['equippedItem', 'equippedItem2']
                        .filter(slot => vessel[slot])
                        .map(slot => ({ slot, card: vessel[slot] }));
                    discardHeroWithItems(gameState, vessel);
                    recordSacrificeEvent(gameState, player, vessel, { isHero: true, removedItems });
                    const stolen = tp.party.splice(targetIndex, 1)[0];
                    stolen.usedSkillThisTurn = false;
                    player.party.push(stolen);
                    triggerCursedGlove(gameState, tp, player);
                    actionMessage = `${getPlayerName(gameState, player.id)} sacrificed Perfect Vessel and stole ${stolen.name}.`;
                }
            }
            break;
        case 'SKILL_UNBRIDLED_FURY':
            if (targetData?.targetPlayerId && targetData?.targetHeroId) {
                const tp = gameState.players[targetData.targetPlayerId];
                const targetHero = (tp?.party || []).find(card => card.id === targetData.targetHeroId);
                const wasBerserker = effectiveHeroClass(targetHero) === 'Berserker';
                actionMessage = resolveDestroyAction(gameState, rollerId, targetData.targetPlayerId, targetData.targetHeroId);
                if (wasBerserker && actionMessage.includes('DESTROYED')) {
                    player.ap += 1;
                    actionMessage += ` ${getPlayerName(gameState, player.id)} gained 1 extra action point.`;
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
        case 'SKILL_HOLLOW_HUSK':
            if (targetData && targetData.targetPlayerId) {
                const tp = gameState.players[targetData.targetPlayerId];
                const magicCards = (tp?.hand || []).filter(card => card.type === 'Magic Card');
                if (tp && magicCards.length > 0) {
                    gameState.pendingPeek = {
                        rollerId,
                        targetPlayerId: tp.id,
                        skillId: 'SKILL_HOLLOW_HUSK',
                        allowedCardIds: magicCards.map(card => card.id)
                    };
                    io.to(rollerId).emit('peek_cards', {
                        cards: magicCards,
                        skillId: 'SKILL_HOLLOW_HUSK',
                        title: `Choose a Magic card from ${getPlayerName(gameState, tp.id)}'s hand`,
                        actionLabel: 'Take Magic'
                    });
                    actionMessage = `${getPlayerName(gameState, player.id)} is choosing a Magic card with Hollow Husk.`;
                } else if (tp) {
                    actionMessage = `${getPlayerName(gameState, tp.id)} has no Magic cards for Hollow Husk.`;
                }
            }
            break;
        case 'SKILL_BOSTON_TERROR':
            if (targetData?.targetPlayerId && targetData.targetPlayerId !== rollerId) {
                const target = gameState.players[targetData.targetPlayerId];
                if (target) {
                    gameState.state = 'WAITING_FOR_GLOBAL_ACTION';
                    gameState.pendingGlobalAction = {
                        type: 'BOSTON_TERROR_GIVE', initiatorId: rollerId,
                        pendingPlayerIds: [target.id]
                    };
                    io.emit('global_action_requested', gameState.pendingGlobalAction);
                    actionMessage = `${getPlayerName(gameState, target.id)} may give a card to ${getPlayerName(gameState, player.id)} for Boston Terror.`;
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
        case 'SKILL_ANNIHILATOR':
        case 'LEADER_NECROMANCER':
            if (targetData && targetData.targetCardId) {
                const cardIndex = gameState.discardPile.findIndex(c => c.id === targetData.targetCardId);
                if (cardIndex !== -1) {
                    const card = gameState.discardPile[cardIndex];
                    const validTypes = {
                        SKILL_GUIDING_LIGHT: ['Hero Card'],
                        SKILL_RADIANT_HORN: ['Modifier Card'],
                        SKILL_LOOKIE_ROOKIE: ['Item Card', 'Cursed Item Card'],
                        SKILL_BUN_BUN: ['Magic Card'],
                        SKILL_ANNIHILATOR: ['Challenge Card'],
                        LEADER_NECROMANCER: ['Monster Card', 'Party Leader', 'Hero Card', 'Item Card', 'Cursed Item Card', 'Magic Card', 'Modifier Card', 'Challenge Card']
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
                        triggerCursedGlove(gameState, tp, player);

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
    const drawEffect = (num, p, continuation, source = 'Magic card') =>
        drawCardsForEffect(gameState, io, num, p, continuation, source);

    switch(effectId) {
        case 'MAGIC_EGG_OF_FORTUNE':
            if (player.hand.length > 0) {
                gameState.state = 'WAITING_FOR_DISCARD_PENALTY';
                gameState.pendingAction = {
                    type: 'EGG_OF_FORTUNE_DISCARD', playerToChoose: playerId,
                    originalActor: playerId, amount: 1,
                    nextAction: { type: 'EGG_OF_FORTUNE_PULLS', playerId }
                };
                actionMessage = `${getPlayerName(gameState, player.id)} must discard a card before Egg of Fortune pulls from every opponent.`;
            } else {
                actionMessage = `${getPlayerName(gameState, player.id)} had no card to discard, so Egg of Fortune ended without pulling cards.`;
            }
            break;
        case 'MAGIC_MASS_SACRIFICE': {
            const discarded = player.hand.splice(0);
            gameState.discardPile.push(...discarded);
            drawEffect(5, player, null, 'Mass Sacrifice');
            actionMessage = `${getPlayerName(gameState, player.id)} discarded their hand and drew 5 cards with Mass Sacrifice.`;
            break;
        }
        case 'MAGIC_LIGHTNING_LABRYS':
            gameState.state = 'WAITING_FOR_VARIABLE_DISCARD';
            gameState.pendingAction = {
                type: 'LIGHTNING_LABRYS_DISCARD',
                playerToChoose: playerId,
                originalActor: playerId,
                maxAmount: Math.min(3, player.hand.length),
                optional: true
            };
            actionMessage = `${getPlayerName(gameState, player.id)} may discard up to 3 cards for Lightning Labrys.`;
            break;
        case 'MAGIC_BEAST_CALL': {
            const faceUp = gameState.activeMonsters.splice(0);
            gameState.monsterDeck.unshift(...faceUp);
            while (gameState.activeMonsters.length < 3 && gameState.monsterDeck.length > 0) {
                gameState.activeMonsters.push(gameState.monsterDeck.pop());
            }
            player.ap = (player.ap || 0) + 1;
            actionMessage = `${getPlayerName(gameState, player.id)} cast Beast Call, replaced the face-up Monsters, and gained 1 extra action point this turn.`;
            break;
        }

        case 'MAGIC_RAPID_REFRESH': {
            const discardedCount = player.hand.length;
            gameState.discardPile.push(...player.hand.splice(0));
            drawEffect(4, player, null, 'Rapid Refresh');
            actionMessage = `${getPlayerName(gameState, player.id)} cast Rapid Refresh, discarded ${discardedCount} card(s), and drew 4 cards.`;
            break;
        }

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
            const drawResult = drawEffect(3, player, { type: 'DISCARD_ONE', playerId }, 'Critical Boost');
            if (!drawResult.queued && player.hand.length > 0) {
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
    drawCardsWithoutPassives,
    applyDrawnCardPassives,
    queueLumberingDrawSequence,
    drawCardsForEffect,
    triggerCrownedSerpent,
    prepareImmediateItemPlay,
    markButtonsFreePlay,
    returnEquippedItemToOwner,
    equippedItems,
    partyCardCount,
    hasPartySacrificeTarget,
    hasEquippedEffect,
    refundTemporalHourglass,
    triggerCursedGlove,
    triggerSoulTethers,
    queueCommittedHeroRemovalTriggers,
    recordSacrificeEvent,
    recordDestroyEvent,
    recordFailedSkillEvent,
    resolveRexMajorChoice,
    clearRexMajorChoices
};
