'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    executeSkill, executeMagic, getTargetingSkillPlan, partyCardCount,
    recordSacrificeEvent, recordDestroyEvent, recordFailedSkillEvent,
    drawCardsWithoutPassives, applyDrawnCardPassives, queueLumberingDrawSequence
} = require('../skill_engine');

function makeIo() {
    const emits = [];
    return {
        emits,
        emit: (event, payload) => emits.push({ event, payload }),
        to: id => ({ emit: (event, payload) => emits.push({ event, to: id, payload }) })
    };
}

const hero = (id, name, className, skillId, extra = {}) => ({
    id, name, class: className, type: 'Hero Card', skill_id: skillId, ...extra
});

function stateWith(actorHero, opponentHero = null) {
    return {
        state: 'PLAYING',
        mainDeck: [],
        discardPile: [],
        players: {
            actor: { id: 'actor', name: 'Actor', ap: 1, hand: [], party: [actorHero], slainMonsters: [] },
            target: { id: 'target', name: 'Target', hand: [], party: opponentHero ? [opponentHero] : [], slainMonsters: [] }
        }
    };
}

test('Perfect Vessel plans a steal and sacrifices itself before stealing', () => {
    const vessel = hero('vessel', 'Perfect Vessel', 'Necromancer', 'SKILL_PERFECT_VESSEL');
    const target = hero('target-hero', 'Target Hero', 'Bard', 'NONE');
    const state = stateWith(vessel, target);
    assert.equal(getTargetingSkillPlan(state, 'actor', 'SKILL_PERFECT_VESSEL').targetAction, 'STEAL');

    executeSkill(state, makeIo(), vessel.skill_id, 'actor', vessel.id, {
        targetPlayerId: 'target', targetHeroId: target.id
    });

    assert.deepEqual(state.players.actor.party.map(card => card.id), [target.id]);
    assert.equal(state.players.target.party.length, 0);
    assert.equal(state.discardPile.some(card => card.id === vessel.id), true);
});

test('Unbridled Fury grants one AP only when it destroys an effective Berserker', () => {
    const fury = hero('fury', 'Unbridled Fury', 'Berserker', 'SKILL_UNBRIDLED_FURY');
    const masked = hero('masked', 'Masked Hero', 'Wizard', 'NONE', {
        equippedItem: { id: 'mask', name: 'Berserker Mask', type: 'Item Card', effect_id: 'ITEM_MASK', class: 'Berserker' }
    });
    const state = stateWith(fury, masked);
    executeSkill(state, makeIo(), fury.skill_id, 'actor', fury.id, {
        targetPlayerId: 'target', targetHeroId: masked.id
    });
    assert.equal(state.players.actor.ap, 2);
    assert.equal(state.players.target.party.length, 0);
});

test('Annihilator retrieves only a Challenge card from the discard pile', () => {
    const annihilator = hero('annihilator', 'Annihilator', 'Berserker', 'SKILL_ANNIHILATOR');
    const challenge = { id: 'challenge', name: 'Challenge', type: 'Challenge Card' };
    const state = stateWith(annihilator);
    state.discardPile.push(challenge, { id: 'magic', name: 'Magic', type: 'Magic Card' });
    executeSkill(state, makeIo(), annihilator.skill_id, 'actor', annihilator.id, { targetCardId: challenge.id });
    assert.equal(state.players.actor.hand[0].id, challenge.id);
    assert.equal(state.discardPile.some(card => card.id === challenge.id), false);
});

test('Hollow Husk privately offers only Magic cards from the chosen hand', () => {
    const husk = hero('husk', 'Hollow Husk', 'Necromancer', 'SKILL_HOLLOW_HUSK');
    const state = stateWith(husk);
    state.players.target.hand = [
        { id: 'magic', name: 'Magic', type: 'Magic Card' },
        { id: 'hero', name: 'Hero', type: 'Hero Card' }
    ];
    const io = makeIo();
    executeSkill(state, io, husk.skill_id, 'actor', husk.id, { targetPlayerId: 'target' });
    const peek = io.emits.find(entry => entry.event === 'peek_cards');
    assert.equal(peek.to, 'actor');
    assert.deepEqual(peek.payload.cards.map(card => card.id), ['magic']);
    assert.deepEqual(state.pendingPeek.allowedCardIds, ['magic']);
});

test('Mass Sacrifice discards the remaining hand and draws five cards one by one', () => {
    const state = stateWith(hero('caster', 'Caster', 'Necromancer', 'NONE'));
    state.players.actor.hand = [{ id: 'old-1' }, { id: 'old-2' }];
    state.mainDeck = Array.from({ length: 5 }, (_, index) => ({
        id: `draw-${index}`, name: `Draw ${index}`, type: 'Hero Card'
    }));
    executeMagic(state, makeIo(), 'MAGIC_MASS_SACRIFICE', 'actor');
    assert.equal(state.players.actor.hand.length, 5);
    assert.deepEqual(state.discardPile.map(card => card.id), ['old-1', 'old-2']);
    assert.equal(state.mainDeck.length, 0);
});

test('Lightning Labrys starts an optional discard of at most three cards', () => {
    const state = stateWith(hero('caster', 'Caster', 'Necromancer', 'NONE'));
    state.players.actor.hand = Array.from({ length: 5 }, (_, index) => ({ id: `hand-${index}` }));
    executeMagic(state, makeIo(), 'MAGIC_LIGHTNING_LABRYS', 'actor');
    assert.equal(state.state, 'WAITING_FOR_VARIABLE_DISCARD');
    assert.deepEqual(state.pendingAction, {
        type: 'LIGHTNING_LABRYS_DISCARD',
        playerToChoose: 'actor',
        originalActor: 'actor',
        maxAmount: 3,
        optional: true
    });
});

test('Bark Hexer requires its own discard before queued opponents discard up to two', () => {
    const hexer = hero('hexer', 'Bark Hexer', 'Necromancer', 'SKILL_BARK_HEXER');
    const state = stateWith(hexer);
    state.players.actor.hand = [{ id: 'cost', type: 'Magic Card' }];
    state.players.target.hand = [{ id: 'one' }];
    executeSkill(state, makeIo(), hexer.skill_id, 'actor', hexer.id);
    assert.equal(state.pendingAction.type, 'DISCARD');
    assert.equal(state.pendingAction.amount, 1);
    assert.deepEqual(state.pendingAction.nextAction, {
        type: 'START_SEQUENTIAL_DISCARD', targets: ['target'], amount: 2, originalActor: 'actor'
    });
});

test('Shadow Saint accepts only a Modifier cost and queues the turn-long lock', () => {
    const saint = hero('saint', 'Shadow Saint', 'Necromancer', 'SKILL_SHADOW_SAINT');
    const state = stateWith(saint);
    state.players.actor.hand = [{ id: 'modifier', type: 'Modifier Card' }, { id: 'hero', type: 'Hero Card' }];
    executeSkill(state, makeIo(), saint.skill_id, 'actor', saint.id);
    assert.deepEqual(state.pendingAction.allowedTypes, ['Modifier Card']);
    assert.equal(state.pendingAction.nextAction.type, 'APPLY_SHADOW_SAINT');
});

test('Party-card counting includes Heroes and both equipped Item slots', () => {
    const player = stateWith(hero('hero', 'Hero', 'Berserker', 'NONE', {
        equippedItem: { id: 'item-1', type: 'Item Card' },
        equippedItem2: { id: 'item-2', type: 'Cursed Item Card' }
    })).players.actor;
    assert.equal(partyCardCount(player), 3);
});

test('Grim Pupper and Brawling Spirit queue deterministic Party-card sacrifices', () => {
    const grim = hero('grim', 'Grim Pupper', 'Necromancer', 'SKILL_GRIM_PUPPER');
    const state = stateWith(grim, hero('target-hero', 'Target', 'Bard', 'NONE'));
    state.playerOrder = ['actor', 'target'];
    executeSkill(state, makeIo(), grim.skill_id, 'actor', grim.id);
    assert.equal(state.pendingGlobalAction.type, 'SEQUENTIAL_PARTY_SACRIFICE');
    assert.deepEqual(state.pendingGlobalAction.pendingPlayerIds, ['actor']);
    assert.deepEqual(state.pendingGlobalAction.remainingPlayerIds, ['target']);

    const brawler = hero('brawler', 'Brawling Spirit', 'Berserker', 'SKILL_BRAWLING_SPIRIT');
    const brawlState = stateWith(brawler);
    brawlState.players.actor.party.push(
        hero('h2', 'H2', 'Bard', 'NONE'), hero('h3', 'H3', 'Wizard', 'NONE'), hero('h4', 'H4', 'Ranger', 'NONE')
    );
    executeSkill(brawlState, makeIo(), brawler.skill_id, 'actor', brawler.id);
    assert.deepEqual(brawlState.pendingGlobalAction.pendingPlayerIds, ['actor']);
});

test('Meowntain queues one sacrifice before its +5 continuation', () => {
    const meowntain = hero('meowntain', 'Meowntain', 'Berserker', 'SKILL_MEOWNTAIN');
    const state = stateWith(meowntain);
    executeSkill(state, makeIo(), meowntain.skill_id, 'actor', meowntain.id);
    assert.equal(state.pendingGlobalAction.afterResolution.type, 'MEOWNTAIN_BONUS');
    assert.deepEqual(state.pendingGlobalAction.pendingPlayerIds, ['actor']);
});

test('Beholden Retriever requires a Hero sacrifice then queues the exact retrieved card for free play', () => {
    const retriever = hero('retriever', 'Beholden Retriever', 'Necromancer', 'SKILL_BEHOLDEN_RETRIEVER');
    const state = stateWith(retriever);
    executeSkill(state, makeIo(), retriever.skill_id, 'actor', retriever.id);
    assert.equal(state.pendingGlobalAction.allowedTarget, 'HERO_ONLY');
    assert.equal(state.pendingGlobalAction.afterResolution.type, 'DISCARD_RETRIEVAL');

    const found = { id: 'found-item', name: 'Found Item', type: 'Item Card' };
    state.discardPile.push(found);
    executeSkill(state, makeIo(), retriever.skill_id, 'actor', retriever.id, { targetCardId: found.id });
    assert.deepEqual(state.pendingAction.allowedCardIds, [found.id]);
    assert.equal(state.pendingAction.expansionFreePlay, true);
    assert.equal(state.players.actor.hand.some(card => card.id === found.id), true);
});

test('Bone Collector requires an equipped Item and retrieves only a Hero for immediate free play', () => {
    const collector = hero('collector', 'Bone Collector', 'Necromancer', 'SKILL_BONE_COLLECTOR', {
        equippedItem: { id: 'cost-item', type: 'Item Card' }
    });
    const state = stateWith(collector);
    executeSkill(state, makeIo(), collector.skill_id, 'actor', collector.id);
    assert.equal(state.pendingGlobalAction.allowedTarget, 'ITEM_ONLY');
    assert.deepEqual(state.pendingGlobalAction.afterResolution.allowedTypes, ['Hero Card']);

    const found = hero('found-hero', 'Found Hero', 'Bard', 'NONE');
    state.discardPile.push(found);
    executeSkill(state, makeIo(), collector.skill_id, 'actor', collector.id, { targetCardId: found.id });
    assert.deepEqual(state.pendingAction.allowedCardIds, [found.id]);
    assert.equal(state.pendingAction.expansionFreePlay, true);
});

test('Boston Terror lets the chosen opponent give one card or decline', () => {
    const terror = hero('terror', 'Boston Terror', 'Necromancer', 'SKILL_BOSTON_TERROR');
    const state = stateWith(terror);
    state.players.target.hand = [{ id: 'gift', type: 'Magic Card' }];
    executeSkill(state, makeIo(), terror.skill_id, 'actor', terror.id, { targetPlayerId: 'target' });
    assert.equal(state.state, 'WAITING_FOR_GLOBAL_ACTION');
    assert.deepEqual(state.pendingGlobalAction, {
        type: 'BOSTON_TERROR_GIVE', initiatorId: 'actor', pendingPlayerIds: ['target']
    });
});

test('Roaryal Guard queues a reconstructable class choice', () => {
    const guard = hero('guard', 'Roaryal Guard', 'Berserker', 'SKILL_ROARYAL_GUARD');
    const state = stateWith(guard);
    executeSkill(state, makeIo(), guard.skill_id, 'actor', guard.id);
    assert.equal(state.state, 'WAITING_FOR_CLASS_SELECTION');
    assert.deepEqual(state.pendingAction, {
        type: 'ROARYAL_GUARD_CLASS', playerToChoose: 'actor', originalActor: 'actor'
    });
});

test('Vicious Wildcat queues a free face-up Monster slay', () => {
    const wildcat = hero('wildcat', 'Vicious Wildcat', 'Berserker', 'SKILL_VICIOUS_WILDCAT');
    const state = stateWith(wildcat);
    state.activeMonsters = [{ id: 'monster', name: 'Monster', type: 'Monster Card' }];
    executeSkill(state, makeIo(), wildcat.skill_id, 'actor', wildcat.id);
    assert.deepEqual(state.pendingAction, {
        type: 'FREE_SLAY', playerToChoose: 'actor', originalActor: 'actor'
    });
});

test('Rabid Beast queues a variable Party-card sacrifice with a zero-card option', () => {
    const rabid = hero('rabid', 'Rabid Beast', 'Berserker', 'SKILL_RABID_BEAST');
    const state = stateWith(rabid);
    executeSkill(state, makeIo(), rabid.skill_id, 'actor', rabid.id);
    assert.equal(state.state, 'WAITING_FOR_GLOBAL_ACTION');
    assert.deepEqual(state.pendingGlobalAction, {
        type: 'VARIABLE_PARTY_SACRIFICE', initiatorId: 'actor',
        pendingPlayerIds: ['actor'], sacrificedCount: 0
    });
});

test('Gruesome Gladiator queues each non-empty opponent hand in seat order', () => {
    const gladiator = hero('gladiator', 'Gruesome Gladiator', 'Berserker', 'SKILL_GRUESOME_GLADIATOR');
    const state = stateWith(gladiator);
    state.playerOrder = ['actor', 'target'];
    state.players.target.hand = [{ id: 'visible-choice', type: 'Hero Card' }];
    executeSkill(state, makeIo(), gladiator.skill_id, 'actor', gladiator.id);
    assert.deepEqual(state.pendingAction, {
        type: 'GRUESOME_GLADIATOR_HAND', playerToChoose: 'actor', originalActor: 'actor',
        targetPlayerId: 'target', remainingPlayerIds: []
    });
});

test('sacrifice and destroy events queue the correct Monster passives separately', () => {
    const state = stateWith(hero('source', 'Source', 'Berserker', 'NONE'));
    state.players.actor.slainMonsters = [
        { effect_id: 'MONSTER_DOOMBRINGER' },
        { effect_id: 'MONSTER_WANDERING_BEHEMOTH' },
        { effect_id: 'MONSTER_SAFFYRE_PHOENIX' }
    ];
    state.players.target.slainMonsters = [{ effect_id: 'MONSTER_FERAL_DRAGON' }];
    recordSacrificeEvent(state, state.players.actor, { id: 'lost-hero' }, { isHero: true });
    assert.deepEqual(state.pendingMonsterTriggers.map(trigger => trigger.type), [
        'FERAL_DRAGON_DRAW', 'DOOMBRINGER_RETRIEVE',
        'WANDERING_BEHEMOTH_DRAW', 'SAFFYRE_PHOENIX_PLAY'
    ]);

    state.pendingMonsterTriggers = [];
    recordDestroyEvent(state, state.players.actor, { id: 'destroyed-hero' });
    assert.deepEqual(state.pendingMonsterTriggers.map(trigger => trigger.type), ['SAFFYRE_PHOENIX_PLAY']);

    state.pendingMonsterTriggers = [];
    state.players.actor.slainMonsters.push({ effect_id: 'MONSTER_REEF_RIPPER' });
    recordFailedSkillEvent(state, state.players.actor, { id: 'failed-hero' });
    assert.deepEqual(state.pendingMonsterTriggers.map(trigger => trigger.type), ['REEF_RIPPER_DRAW']);
});

test('Dragon Wasp opens a replacement before sacrifice or destroy triggers commit', () => {
    const state = stateWith(hero('source', 'Source', 'Berserker', 'NONE'));
    const owner = state.players.actor;
    owner.hand = [{ id: 'cost-1' }, { id: 'cost-2' }];
    owner.slainMonsters = [
        { effect_id: 'MONSTER_DRAGON_WASP' },
        { effect_id: 'MONSTER_DOOMBRINGER' },
        { effect_id: 'MONSTER_SAFFYRE_PHOENIX' }
    ];
    const lostHero = { id: 'lost-hero', name: 'Lost Hero', type: 'Hero Card' };
    const item = { id: 'lost-item', name: 'Lost Item', type: 'Item Card' };

    assert.equal(recordDestroyEvent(state, owner, lostHero, {
        removedItems: [{ slot: 'equippedItem2', card: item }], initiatorId: 'target'
    }), true);
    assert.equal(state.pendingMonsterTriggers.length, 1);
    assert.deepEqual(state.pendingMonsterTriggers[0], {
        type: 'DRAGON_WASP_REPLACEMENT', playerId: 'actor',
        sourceCardId: 'lost-hero', hero: lostHero,
        removedItems: [{ slot: 'equippedItem2', card: item }],
        eventType: 'DESTROY', initiatorId: 'target'
    });
});

test('Lumbering Demon queues each draw and defers Rex and Orthus until replacement completes', () => {
    const state = stateWith(hero('source', 'Source', 'Berserker', 'NONE'));
    const owner = state.players.actor;
    owner.slainMonsters = [
        { effect_id: 'MONSTER_LUMBERING_DEMON' },
        { effect_id: 'MONSTER_REX_MAJOR' },
        { effect_id: 'MONSTER_ORTHUS' }
    ];
    const modifier = { id: 'modifier', type: 'Modifier Card' };
    const magic = { id: 'magic', type: 'Magic Card' };
    state.mainDeck = [magic, modifier];

    assert.equal(queueLumberingDrawSequence(state, owner, 2, null, 'test draw'), true);
    assert.equal(state.pendingLumberingDraws[0].remaining, 2);
    const drawn = drawCardsWithoutPassives(state, makeIo(), 2, owner);
    assert.deepEqual(drawn.map(card => card.id), ['modifier', 'magic']);
    assert.equal(state.pendingCard, undefined);
    assert.equal(state.pendingRexChoices, undefined);

    applyDrawnCardPassives(state, makeIo(), owner, modifier);
    assert.equal(state.pendingRexChoices.length, 1);
    applyDrawnCardPassives(state, makeIo(), owner, magic);
    assert.equal(state.pendingCard.id, 'magic');
    assert.equal(owner.hand.some(card => card.id === 'magic'), false);
});
