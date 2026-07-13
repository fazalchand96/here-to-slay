'use strict';

// Unit tests for skill_engine.js — runnable with `node --test`.
// No external test framework required (uses the built-in node:test runner).

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    executeSkill, executeMagic, hasOpponentHeroTarget, getTargetingSkillPlan, drawCardsWithPassives,
    triggerCrownedSerpent, prepareImmediateItemPlay, markButtonsFreePlay,
    returnEquippedItemToOwner
} = require('../skill_engine');

// ---------------------------------------------------------------------------
// Test helpers / factories
// ---------------------------------------------------------------------------

// Minimal Socket.IO double. Records every emit so tests can assert on the
// messages the engine broadcasts, and supports the `io.to(id).emit(...)` form.
function makeIo() {
    const emits = [];
    const io = {
        emit: (event, payload) => emits.push({ event, payload }),
        to: (id) => ({ emit: (event, payload) => emits.push({ event, to: id, payload }) }),
    };
    io.emits = emits;
    io.lastMessage = () => {
        const m = [...emits].reverse().find((e) => e.event === 'message');
        return m && m.payload;
    };
    io.find = (event) => emits.find((e) => e.event === event);
    return io;
}

let cardSeq = 0;
function card(name, type, extra = {}) {
    cardSeq += 1;
    return { id: extra.id || `card_${cardSeq}`, name, type, ...extra };
}

let heroSeq = 0;
function hero(name, extra = {}) {
    heroSeq += 1;
    return {
        id: extra.id || `hero_${heroSeq}`,
        name,
        type: 'Hero Card',
        class: extra.class || 'Fighter',
        equippedItem: extra.equippedItem || null,
        ...extra,
    };
}

function player(id, extra = {}) {
    return {
        id,
        hand: extra.hand || [],
        party: extra.party || [],
        slainMonsters: extra.slainMonsters || [],
        cannotBeStolen: false,
        cannotBeDestroyed: false,
        cannotBeChallenged: false,
        ...extra,
    };
}

function makeState(players, extra = {}) {
    const map = {};
    players.forEach((p) => { map[p.id] = p; });
    return {
        state: 'PLAYING',
        players: map,
        mainDeck: extra.mainDeck || [],
        discardPile: extra.discardPile || [],
        pendingAction: null,
        pendingGlobalAction: null,
        pendingCard: null,
        ...extra,
    };
}

// Run `fn` with Math.random pinned to `value`, then restore.
function withRandom(value, fn) {
    const orig = Math.random;
    Math.random = () => value;
    try {
        return fn();
    } finally {
        Math.random = orig;
    }
}

// ---------------------------------------------------------------------------
// Self-buff skills
// ---------------------------------------------------------------------------

test('deferred Hero targeting reports no target when opponents have no Heroes', () => {
    const gs = makeState([player('alice', { party: [hero('Caster')] }), player('bob')]);
    assert.equal(hasOpponentHeroTarget(gs, 'alice', 'DESTROY'), false);
    assert.equal(hasOpponentHeroTarget(gs, 'alice', 'STEAL'), false);
});

test('deferred Hero targeting respects steal/destroy protections', () => {
    const target = player('bob', { party: [hero('Target')], cannotBeStolen: true });
    const gs = makeState([player('alice'), target]);
    assert.equal(hasOpponentHeroTarget(gs, 'alice', 'STEAL'), false);
    assert.equal(hasOpponentHeroTarget(gs, 'alice', 'DESTROY'), true);
    target.cannotBeDestroyed = true;
    assert.equal(hasOpponentHeroTarget(gs, 'alice', 'DESTROY'), false);
});

test('deferred AND-skill plans keep an independently legal clause', () => {
    const protectedHero = hero('Protected', { id: 'protected' });
    const bob = player('bob', { party: [protectedHero], cannotBeStolen: true });
    const gs = makeState([player('alice'), bob]);

    assert.deepEqual(getTargetingSkillPlan(gs, 'alice', 'SKILL_WHISKERS'), {
        type: 'DESTROY', skippedClause: 'STEAL'
    });

    bob.party = [];
    bob.hand = [card('pullable', 'Item Card')];
    assert.deepEqual(getTargetingSkillPlan(gs, 'alice', 'SKILL_MEOWZIO'), {
        type: 'SKILL_TARGET_PLAYER', skippedClause: 'STEAL'
    });
    assert.deepEqual(getTargetingSkillPlan(gs, 'alice', 'SKILL_SERIOUS_GREY'), {
        type: 'EXECUTE_SKILL_IMMEDIATE', skippedClause: 'DESTROY'
    });
});

test('SKILL_VIBRANT_GLOW grants +5 roll bonus', () => {
    const p = player('alice', { party: [hero('Vibrant Glow', { id: 'vg' })] });
    const gs = makeState([p]);
    executeSkill(gs, makeIo(), 'SKILL_VIBRANT_GLOW', 'alice', 'vg', null);
    assert.equal(p.rollBonus, 5);
});

test('SKILL_WISE_SHIELD grants +3 and stacks onto existing bonus', () => {
    const p = player('alice', { party: [hero('Wise Shield', { id: 'ws' })], rollBonus: 2 });
    const gs = makeState([p]);
    executeSkill(gs, makeIo(), 'SKILL_WISE_SHIELD', 'alice', 'ws', null);
    assert.equal(p.rollBonus, 5);
});

test('SKILL_WILY_RED draws until the hand holds 7 cards', () => {
    const deck = Array.from({ length: 10 }, (_, i) => card(`d${i}`, 'Hero Card'));
    const p = player('alice', { hand: [card('a', 'Hero Card'), card('b', 'Hero Card')], party: [hero('Wily Red', { id: 'wr' })] });
    const gs = makeState([p], { mainDeck: deck });
    executeSkill(gs, makeIo(), 'SKILL_WILY_RED', 'alice', 'wr', null);
    assert.equal(p.hand.length, 7);
    assert.equal(gs.mainDeck.length, 5);
});

test('SKILL_WILY_RED stops gracefully when the deck runs dry', () => {
    const p = player('alice', { hand: [], party: [hero('Wily Red', { id: 'wr' })] });
    const gs = makeState([p], { mainDeck: [card('x', 'Hero Card')] });
    executeSkill(gs, makeIo(), 'SKILL_WILY_RED', 'alice', 'wr', null);
    assert.equal(p.hand.length, 1);
    assert.equal(gs.mainDeck.length, 0);
});

test('SKILL_NAPPING_NIBBLES does nothing but reports a message', () => {
    const p = player('alice', { party: [hero('Napping Nibbles', { id: 'nn' })] });
    const gs = makeState([p]);
    const io = makeIo();
    executeSkill(gs, io, 'SKILL_NAPPING_NIBBLES', 'alice', 'nn', null);
    assert.match(io.lastMessage(), /absolutely nothing/);
});

// ---------------------------------------------------------------------------
// Draw skills
// ---------------------------------------------------------------------------

test('DRAW_2_CARDS draws exactly two cards from the deck', () => {
    const deck = [card('a', 'Hero Card'), card('b', 'Hero Card'), card('c', 'Hero Card')];
    const p = player('alice', { party: [hero('Peanut', { id: 'pn' })] });
    const gs = makeState([p], { mainDeck: deck });
    executeSkill(gs, makeIo(), 'DRAW_2_CARDS', 'alice', 'pn', null);
    assert.equal(p.hand.length, 2);
    assert.equal(gs.mainDeck.length, 1);
});

test('DRAW_AND_PLAY offers immediate play when a Hero is drawn', () => {
    const heroCard = card('Drawn Hero', 'Hero Card');
    const p = player('alice', { party: [hero('Mellow Dee', { id: 'md' })] });
    const gs = makeState([p], { mainDeck: [heroCard] }); // pop() takes the last element
    executeSkill(gs, makeIo(), 'DRAW_AND_PLAY', 'alice', 'md', null);
    assert.equal(gs.state, 'WAITING_FOR_IMMEDIATE_PLAY');
    assert.equal(gs.pendingCard, heroCard);
    assert.equal(p.hand.length, 0);
});

test('DRAW_AND_PLAY just keeps a non-Hero card', () => {
    const itemCard = card('Some Item', 'Item Card');
    const p = player('alice', { party: [hero('Mellow Dee', { id: 'md' })] });
    const gs = makeState([p], { mainDeck: [itemCard] });
    executeSkill(gs, makeIo(), 'DRAW_AND_PLAY', 'alice', 'md', null);
    assert.equal(gs.state, 'PLAYING');
    assert.deepEqual(p.hand, [itemCard]);
});

// ---------------------------------------------------------------------------
// Destroy / steal with protection edge cases
// ---------------------------------------------------------------------------

test('DESTROY_HERO removes the hero and its item to the discard pile', () => {
    const item = card('Sword', 'Item Card');
    const victim = hero('Victim', { id: 'v1', equippedItem: item });
    const bob = player('bob', { party: [victim] });
    const alice = player('alice', { party: [hero('Bad Axe', { id: 'ba' })] });
    const gs = makeState([alice, bob]);
    executeSkill(gs, makeIo(), 'DESTROY_HERO', 'alice', 'ba', { targetPlayerId: 'bob', targetHeroId: 'v1' });
    assert.equal(bob.party.length, 0);
    assert.ok(gs.discardPile.includes(victim));
    assert.ok(gs.discardPile.includes(item));
});

test('DESTROY_HERO is blocked by Terratuga', () => {
    const victim = hero('Victim', { id: 'v1' });
    const bob = player('bob', { party: [victim], slainMonsters: [{ effect_id: 'MONSTER_TERRATUGA' }] });
    const alice = player('alice');
    const gs = makeState([alice, bob]);
    const io = makeIo();
    executeSkill(gs, io, 'DESTROY_HERO', 'alice', 'ba', { targetPlayerId: 'bob', targetHeroId: 'v1' });
    assert.equal(bob.party.length, 1);
    assert.match(io.lastMessage(), /protected by Terratuga/);
});

test('DESTROY_HERO is blocked by Mighty Blade (cannotBeDestroyed)', () => {
    const victim = hero('Victim', { id: 'v1' });
    const bob = player('bob', { party: [victim], cannotBeDestroyed: true });
    const alice = player('alice');
    const gs = makeState([alice, bob]);
    const io = makeIo();
    executeSkill(gs, io, 'DESTROY_HERO', 'alice', 'ba', { targetPlayerId: 'bob', targetHeroId: 'v1' });
    assert.equal(bob.party.length, 1);
    assert.match(io.lastMessage(), /Mighty Blade/);
});

test('Corrupted Sabretooth converts a destroy into a steal', () => {
    const victim = hero('Victim', { id: 'v1' });
    const bob = player('bob', { party: [victim] });
    const alice = player('alice', { slainMonsters: [{ effect_id: 'MONSTER_CORRUPTED_SABRETOOTH' }] });
    const gs = makeState([alice, bob]);
    const io = makeIo();
    executeSkill(gs, io, 'DESTROY_HERO', 'alice', 'ba', { targetPlayerId: 'bob', targetHeroId: 'v1' });
    assert.equal(bob.party.length, 0);
    assert.ok(alice.party.includes(victim));
    assert.match(io.lastMessage(), /STOLE/);
});

test('Dracos lets the victim draw a card after a destroy', () => {
    const victim = hero('Victim', { id: 'v1' });
    const bob = player('bob', { party: [victim], slainMonsters: [{ effect_id: 'MONSTER_DRACOS' }] });
    const alice = player('alice');
    const gs = makeState([alice, bob], { mainDeck: [card('comp', 'Hero Card')] });
    executeSkill(gs, makeIo(), 'DESTROY_HERO', 'alice', 'ba', { targetPlayerId: 'bob', targetHeroId: 'v1' });
    assert.equal(bob.hand.length, 1);
});

test('STEAL_HERO moves the hero into the thief party', () => {
    const target = hero('Target', { id: 't1' });
    const bob = player('bob', { party: [target] });
    const alice = player('alice');
    const gs = makeState([alice, bob]);
    executeSkill(gs, makeIo(), 'STEAL_HERO', 'alice', 'kn', { targetPlayerId: 'bob', targetHeroId: 't1' });
    assert.equal(bob.party.length, 0);
    assert.ok(alice.party.includes(target));
});

// --- Decoy Doll (ITEM_DECOY): sacrifice the Doll instead of losing the Hero ---
test('Decoy Doll absorbs a DESTROY — the Hero survives and the Doll is discarded', () => {
    const doll = card('Decoy Doll', 'Item Card', { effect_id: 'ITEM_DECOY' });
    const victim = hero('Victim', { id: 'v1', equippedItem: doll });
    const bob = player('bob', { party: [victim] });
    const alice = player('alice', { party: [hero('Bad Axe', { id: 'ba' })] });
    const gs = makeState([alice, bob]);
    executeSkill(gs, makeIo(), 'DESTROY_HERO', 'alice', 'ba', { targetPlayerId: 'bob', targetHeroId: 'v1' });
    assert.equal(bob.party.length, 1);          // hero survived
    assert.equal(victim.equippedItem, null);    // doll consumed
    assert.ok(gs.discardPile.includes(doll));   // doll discarded
});

test('Decoy Doll does not absorb a STEAL', () => {
    const doll = card('Decoy Doll', 'Item Card', { effect_id: 'ITEM_DECOY' });
    const target = hero('Target', { id: 't1', equippedItem: doll });
    const bob = player('bob', { party: [target] });
    const alice = player('alice');
    const gs = makeState([alice, bob]);
    executeSkill(gs, makeIo(), 'STEAL_HERO', 'alice', 'kn', { targetPlayerId: 'bob', targetHeroId: 't1' });
    assert.equal(bob.party.length, 0);
    assert.ok(alice.party.includes(target));
    assert.equal(target.equippedItem, doll);
    assert.ok(!gs.discardPile.includes(doll));
});

test('Meowzio: Decoy Doll does not stop the steal or card pull', () => {
    const doll = card('Decoy Doll', 'Item Card', { effect_id: 'ITEM_DECOY' });
    const victim = hero('Victim', { id: 'v1', equippedItem: doll });
    const bob = player('bob', { party: [victim], hand: [card('x', 'Item Card')] });
    const alice = player('alice', { party: [hero('Meowzio', { id: 'mz' })] });
    const gs = makeState([alice, bob]);
    executeSkill(gs, makeIo(), 'SKILL_MEOWZIO', 'alice', 'mz', { targetPlayerId: 'bob', targetHeroId: 'v1' });
    assert.equal(bob.party.length, 0);
    assert.ok(alice.party.includes(victim));
    assert.equal(alice.hand.length, 1);   // the pull still happened
    assert.equal(bob.hand.length, 0);
});

test('STEAL_HERO is blocked by Calming Voice (cannotBeStolen)', () => {
    const target = hero('Target', { id: 't1' });
    const bob = player('bob', { party: [target], cannotBeStolen: true });
    const alice = player('alice');
    const gs = makeState([alice, bob]);
    const io = makeIo();
    executeSkill(gs, io, 'STEAL_HERO', 'alice', 'kn', { targetPlayerId: 'bob', targetHeroId: 't1' });
    assert.equal(bob.party.length, 1);
    assert.match(io.lastMessage(), /Calming Voice/);
});

// ---------------------------------------------------------------------------
// Hand interaction skills
// ---------------------------------------------------------------------------

test('PULL_CARD pulls a second card when the first is a Hero', () => {
    const heroCard = card('Pulled Hero', 'Hero Card');
    const otherCard = card('Pulled Other', 'Item Card');
    const bob = player('bob', { hand: [heroCard, otherCard] });
    const alice = player('alice');
    const gs = makeState([alice, bob]);
    // random=0 -> always pull index 0; first pull is the Hero, triggering a second pull.
    withRandom(0, () => {
        executeSkill(gs, makeIo(), 'PULL_CARD', 'alice', 'h', { targetPlayerId: 'bob' });
    });
    assert.equal(bob.hand.length, 0);
    assert.equal(alice.hand.length, 2);
});

test('PULL_CARD pulls only one card when the first is not a Hero', () => {
    const bob = player('bob', { hand: [card('Item', 'Item Card'), card('Item2', 'Item Card')] });
    const alice = player('alice');
    const gs = makeState([alice, bob]);
    withRandom(0, () => {
        executeSkill(gs, makeIo(), 'PULL_CARD', 'alice', 'h', { targetPlayerId: 'bob' });
    });
    assert.equal(alice.hand.length, 1);
    assert.equal(bob.hand.length, 1);
});

test('TRADE_HANDS swaps the two players hands', () => {
    const aliceHand = [card('a1', 'Hero Card')];
    const bobHand = [card('b1', 'Item Card'), card('b2', 'Item Card')];
    const alice = player('alice', { hand: aliceHand });
    const bob = player('bob', { hand: bobHand });
    const gs = makeState([alice, bob]);
    executeSkill(gs, makeIo(), 'TRADE_HANDS', 'alice', 'dd', { targetPlayerId: 'bob' });
    assert.deepEqual(alice.hand, bobHand);
    assert.deepEqual(bob.hand, aliceHand);
});

test('SKILL_QI_BEAR caps the discard to min(3, hand, destroyable opponent heroes)', () => {
    const alice = player('alice', { hand: [card('a', 'Hero Card'), card('b', 'Hero Card')], party: [hero('Qi Bear', { id: 'qb' })] });
    const bob = player('bob', { party: [hero('B1', { id: 'b1' }), hero('B2', { id: 'b2' }), hero('B3', { id: 'b3' })] });
    const gs = makeState([alice, bob]);
    executeSkill(gs, makeIo(), 'SKILL_QI_BEAR', 'alice', 'qb', null);
    assert.equal(gs.state, 'WAITING_FOR_VARIABLE_DISCARD');
    assert.equal(gs.pendingAction.type, 'VARIABLE_DISCARD_TO_DESTROY');
    assert.equal(gs.pendingAction.maxAmount, 2); // min(3, hand=2, oppHeroes=3)
});

test('SKILL_QI_BEAR is limited by the number of destroyable opponent heroes', () => {
    const alice = player('alice', { hand: [card('a', 'Hero Card'), card('b', 'Hero Card'), card('c', 'Hero Card')], party: [hero('Qi Bear', { id: 'qb' })] });
    const bob = player('bob', { party: [hero('Only One', { id: 'b1' })] });
    const gs = makeState([alice, bob]);
    executeSkill(gs, makeIo(), 'SKILL_QI_BEAR', 'alice', 'qb', null);
    assert.equal(gs.pendingAction.maxAmount, 1); // min(3, hand=3, oppHeroes=1)
});

test('SKILL_QI_BEAR does NOT prompt a discard when there are no opponent heroes', () => {
    const alice = player('alice', { hand: [card('a', 'Hero Card'), card('b', 'Hero Card')], party: [hero('Qi Bear', { id: 'qb' })] });
    const bob = player('bob', { party: [] });
    const gs = makeState([alice, bob]);
    executeSkill(gs, makeIo(), 'SKILL_QI_BEAR', 'alice', 'qb', null);
    assert.notEqual(gs.state, 'WAITING_FOR_VARIABLE_DISCARD');
    assert.equal(gs.pendingAction, null);
    assert.equal(alice.hand.length, 2); // kept their cards
});

test('SKILL_HOPPER hands the choice to the target (WAITING_FOR_SACRIFICE), removing nothing yet', () => {
    const keep = hero('Keep', { id: 'k1' });
    const other = hero('Other', { id: 's1', equippedItem: card('Item', 'Item Card') });
    const bob = player('bob', { party: [keep, other] });
    const alice = player('alice');
    const gs = makeState([alice, bob]);
    executeSkill(gs, makeIo(), 'SKILL_HOPPER', 'alice', 'hp', { targetPlayerId: 'bob' });
    // The TARGET chooses which Hero to sacrifice — nothing is removed by the engine.
    assert.equal(gs.state, 'WAITING_FOR_SACRIFICE');
    assert.equal(gs.pendingAction.type, 'PENALTY');
    assert.equal(gs.pendingAction.playerToChoose, 'bob');
    assert.equal(gs.pendingAction.originalActor, 'alice');
    assert.equal(bob.party.length, 2);
    assert.equal(gs.discardPile.length, 0);
});

test('SKILL_HOPPER no-ops back to PLAYING when the target has no Heroes', () => {
    const bob = player('bob', { party: [] });
    const alice = player('alice');
    const gs = makeState([alice, bob]);
    executeSkill(gs, makeIo(), 'SKILL_HOPPER', 'alice', 'hp', { targetPlayerId: 'bob' });
    assert.equal(gs.state, 'PLAYING');
    assert.equal(gs.pendingAction, null);
});

test('SKILL_GUIDING_LIGHT retrieves a card from the discard pile', () => {
    const buried = card('Buried Hero', 'Hero Card', { id: 'buried' });
    const p = player('alice', { party: [hero('Guiding Light', { id: 'gl' })] });
    const gs = makeState([p], { discardPile: [card('other', 'Item Card'), buried] });
    executeSkill(gs, makeIo(), 'SKILL_GUIDING_LIGHT', 'alice', 'gl', { targetCardId: 'buried' });
    assert.ok(p.hand.includes(buried));
    assert.equal(gs.discardPile.length, 1);
});

// ---------------------------------------------------------------------------
// Regression: Spooky used the wrong case label and fell through to default.
// ---------------------------------------------------------------------------

test('SKILL_SPOOKY is recognized and queues a global sacrifice', () => {
    const bob = player('bob', { party: [hero('Bob Hero', { id: 'bh' })] });
    const alice = player('alice', { party: [hero('Spooky', { id: 'sp' })] });
    const gs = makeState([alice, bob]);
    const io = makeIo();
    executeSkill(gs, io, 'SKILL_SPOOKY', 'alice', 'sp', null);
    assert.equal(gs.state, 'WAITING_FOR_GLOBAL_ACTION');
    assert.equal(gs.pendingGlobalAction.type, 'MULTI_SACRIFICE');
    assert.doesNotMatch(io.lastMessage() || '', /Unrecognized/);
});

test('Unknown skill ids report an "Unrecognized" message', () => {
    const p = player('alice', { party: [hero('Mystery', { id: 'm1' })] });
    const gs = makeState([p]);
    const io = makeIo();
    executeSkill(gs, io, 'SKILL_DOES_NOT_EXIST', 'alice', 'm1', null);
    assert.match(io.lastMessage(), /Unrecognized skill/);
});

test('Using a skill marks the hero as having used it this turn', () => {
    const h = hero('Vibrant Glow', { id: 'vg' });
    const p = player('alice', { party: [h] });
    const gs = makeState([p]);
    executeSkill(gs, makeIo(), 'SKILL_VIBRANT_GLOW', 'alice', 'vg', null);
    assert.equal(h.usedSkillThisTurn, true);
});

// ---------------------------------------------------------------------------
// Magic effects
// ---------------------------------------------------------------------------

test('MAGIC_ENCHANTED grants +2 magic roll bonus and reports success', () => {
    const p = player('alice');
    const gs = makeState([p]);
    const res = executeMagic(gs, makeIo(), 'MAGIC_ENCHANTED', 'alice', null);
    assert.equal(p.magicRollBonus, 2);
    assert.equal(res.success, true);
});

test('MAGIC_CRIT_BOOST draws 3 cards and queues a discard', () => {
    const deck = [card('a', 'Hero Card'), card('b', 'Hero Card'), card('c', 'Hero Card')];
    const p = player('alice');
    const gs = makeState([p], { mainDeck: deck });
    executeMagic(gs, makeIo(), 'MAGIC_CRIT_BOOST', 'alice', null);
    assert.equal(p.hand.length, 3);
    assert.equal(gs.pendingAction.type, 'DISCARD');
    assert.equal(gs.pendingAction.amount, 1);
});

test('MAGIC_WINDS_FORCE returns every equipped item to its owner hand', () => {
    const item1 = card('Sword', 'Item Card');
    const item2 = card('Shield', 'Item Card');
    const alice = player('alice', { party: [hero('A', { id: 'a1', equippedItem: item1 })] });
    const bob = player('bob', { party: [hero('B', { id: 'b1', equippedItem: item2 })] });
    const gs = makeState([alice, bob]);
    executeMagic(gs, makeIo(), 'MAGIC_WINDS_FORCE', 'alice', null);
    assert.equal(alice.party[0].equippedItem, null);
    assert.equal(bob.party[0].equippedItem, null);
    assert.ok(alice.hand.includes(item1));
    assert.ok(bob.hand.includes(item2));
});

test('MAGIC_CALL_FALLEN retrieves a specific card from the discard pile', () => {
    const buried = card('Fallen Hero', 'Hero Card', { id: 'fallen' });
    const p = player('alice');
    const gs = makeState([p], { discardPile: [buried] });
    executeMagic(gs, makeIo(), 'MAGIC_CALL_FALLEN', 'alice', { targetCardId: 'fallen' });
    assert.ok(p.hand.includes(buried));
    assert.equal(gs.discardPile.length, 0);
});

test('MAGIC_ENTANGLING with an empty hand skips straight to the steal step', () => {
    const alice = player('alice', { hand: [] });
    const bob = player('bob', { party: [hero('Victim', { id: 'v1' })] }); // a hero to steal
    const gs = makeState([alice, bob]);
    executeMagic(gs, makeIo(), 'MAGIC_ENTANGLING', 'alice', null);
    assert.equal(gs.pendingAction.type, 'STEAL');
});

test('MAGIC_EXCHANGE queues an EXCHANGE_STEP_1 targeting action', () => {
    const p = player('alice');
    const gs = makeState([p]);
    executeMagic(gs, makeIo(), 'MAGIC_EXCHANGE', 'alice', null);
    assert.equal(gs.pendingAction.type, 'EXCHANGE_STEP_1');
    assert.equal(gs.pendingAction.playerToChoose, 'alice');
});

test('MAGIC_WINDS_CHANGE queues a RETURN_ITEM action when an item is equipped', () => {
    const equipped = hero('Bearer', { equippedItem: card('Ring', 'Item Card') });
    const p = player('alice', { party: [equipped] });
    const gs = makeState([p]);
    executeMagic(gs, makeIo(), 'MAGIC_WINDS_CHANGE', 'alice', null);
    assert.equal(gs.pendingAction.type, 'RETURN_ITEM');
});

test('MAGIC_WINDS_CHANGE fizzles (no pendingAction) when nothing is equipped', () => {
    // Regression: it used to queue RETURN_ITEM with no legal target and no
    // skip, soft-locking the game (found by the mobile-UI harness).
    const p = player('alice', { party: [hero('Bare')] });
    const gs = makeState([p]);
    const io = makeIo();
    executeMagic(gs, io, 'MAGIC_WINDS_CHANGE', 'alice', null);
    assert.equal(gs.pendingAction, null);
    assert.match(String(io.find('rollResult').payload.message), /fizzles/);
});

test('MAGIC_DESTRUCTIVE with cards queues discard-then-destroy', () => {
    const p = player('alice', { hand: [card('x', 'Item Card')] });
    const gs = makeState([p]);
    executeMagic(gs, makeIo(), 'MAGIC_DESTRUCTIVE', 'alice', null);
    assert.equal(gs.pendingAction.type, 'DISCARD');
    assert.equal(gs.pendingAction.nextAction.type, 'DESTROY');
});

test('MAGIC_DESTRUCTIVE with an empty hand skips straight to destroy', () => {
    const p = player('alice', { hand: [] });
    const gs = makeState([p]);
    executeMagic(gs, makeIo(), 'MAGIC_DESTRUCTIVE', 'alice', null);
    assert.equal(gs.pendingAction.type, 'DESTROY');
    assert.equal(gs.pendingAction.playerToChoose, 'alice'); // caster must be the chooser
});

// --- Pan Chucks: "DRAW 2; if a Challenge appears you MAY destroy a Hero" ---
test('SKILL_PAN_CHUCKS offers an OPTIONAL destroy when a Challenge is drawn and an opponent hero exists', () => {
    const challenge = card('Challenge', 'Challenge Card');
    const filler = card('Filler', 'Item Card');
    const alice = player('alice', { party: [hero('Pan Chucks', { id: 'pc' })] });
    const bob = player('bob', { party: [hero('Victim', { id: 'v1' })] });
    const gs = makeState([alice, bob], { mainDeck: [filler, challenge] }); // pop() -> challenge first
    executeSkill(gs, makeIo(), 'SKILL_PAN_CHUCKS', 'alice', 'pc', null);
    assert.equal(gs.pendingAction.type, 'DESTROY');
    assert.equal(gs.pendingAction.optional, true);
    assert.equal(gs.pendingAction.playerToChoose, 'alice');
    assert.equal(alice.hand.length, 2);
});

test('SKILL_PAN_CHUCKS does NOT offer destroy when no opponent hero exists (no soft-lock)', () => {
    const alice = player('alice', { party: [hero('Pan Chucks', { id: 'pc' })] });
    const bob = player('bob', { party: [] });
    const gs = makeState([alice, bob], { mainDeck: [card('c1', 'Challenge Card'), card('c2', 'Challenge Card')] });
    executeSkill(gs, makeIo(), 'SKILL_PAN_CHUCKS', 'alice', 'pc', null);
    assert.equal(gs.pendingAction, null);
    assert.equal(alice.hand.length, 2);
});

test('SKILL_PAN_CHUCKS does nothing extra when no Challenge is drawn', () => {
    const alice = player('alice', { party: [hero('Pan Chucks', { id: 'pc' })] });
    const bob = player('bob', { party: [hero('Victim', { id: 'v1' })] });
    const gs = makeState([alice, bob], { mainDeck: [card('i1', 'Item Card'), card('m1', 'Magic Card')] });
    executeSkill(gs, makeIo(), 'SKILL_PAN_CHUCKS', 'alice', 'pc', null);
    assert.equal(gs.pendingAction, null);
    assert.equal(alice.hand.length, 2);
});

// ===========================================================================
// PER-CARD MATRIX: every remaining executeSkill case + edge branches
// ===========================================================================

// --- Lingering protection / buff flags ---
test('SKILL_CALMING_VOICE sets cannotBeStolen on the caster', () => {
    const p = player('alice', { party: [hero('Calming Voice', { id: 'cv' })] });
    const gs = makeState([p]);
    executeSkill(gs, makeIo(), 'SKILL_CALMING_VOICE', 'alice', 'cv', null);
    assert.equal(p.cannotBeStolen, true);
});

test('SKILL_IRON_RESOLVE sets cannotBeChallenged on the caster', () => {
    const p = player('alice', { party: [hero('Iron Resolve', { id: 'ir' })] });
    const gs = makeState([p]);
    executeSkill(gs, makeIo(), 'SKILL_IRON_RESOLVE', 'alice', 'ir', null);
    assert.equal(p.cannotBeChallenged, true);
});

test('SKILL_MIGHTY_BLADE sets cannotBeDestroyed on the caster', () => {
    const p = player('alice', { party: [hero('Mighty Blade', { id: 'mb' })] });
    const gs = makeState([p]);
    executeSkill(gs, makeIo(), 'SKILL_MIGHTY_BLADE', 'alice', 'mb', null);
    assert.equal(p.cannotBeDestroyed, true);
});

// --- Draw + optional play-from-hand ---
test('SKILL_FUZZY_CHEEKS draws 1 and opens an OPTIONAL hero play-from-hand', () => {
    const p = player('alice', { party: [hero('Fuzzy Cheeks', { id: 'fc' })] });
    const gs = makeState([p], { mainDeck: [card('d', 'Item Card')] });
    executeSkill(gs, makeIo(), 'SKILL_FUZZY_CHEEKS', 'alice', 'fc', null);
    assert.equal(p.hand.length, 1);
    assert.equal(gs.state, 'WAITING_FOR_HAND_SELECTION');
    assert.deepEqual(gs.pendingAction.allowedTypes, ['Hero Card']);
    assert.equal(gs.pendingAction.optional, true);
});

test('SKILL_HOOK opens item play-from-hand before drawing', () => {
    const item = card('sword', 'Item Card');
    const p = player('alice', { party: [hero('Hook', { id: 'hk' })], hand: [item] });
    const gs = makeState([p], { mainDeck: [card('d', 'Hero Card')] });
    executeSkill(gs, makeIo(), 'SKILL_HOOK', 'alice', 'hk', null);
    assert.equal(p.hand.length, 1);
    assert.deepEqual(gs.pendingAction.allowedTypes, ['Item Card']);
    assert.equal(gs.pendingAction.thenDraw, 1);
    assert.equal(gs.pendingAction.optional, undefined);
});

test('SKILL_QUICK_DRAW opens an optional item play-from-hand when a DRAWN card is an Item', () => {
    const p = player('alice', { party: [hero('Quick Draw', { id: 'qd' })] });
    const gs = makeState([p], { mainDeck: [card('a', 'Hero Card'), card('sword', 'Item Card')] });
    executeSkill(gs, makeIo(), 'SKILL_QUICK_DRAW', 'alice', 'qd', null);
    assert.equal(p.hand.length, 2);
    assert.deepEqual(gs.pendingAction.allowedTypes, ['Item Card']);
    assert.equal(gs.pendingAction.optional, true);
});

test('SKILL_QUICK_DRAW just draws 2 (no play option) when neither drawn card is an Item', () => {
    const p = player('alice', { party: [hero('Quick Draw', { id: 'qd' })] });
    const gs = makeState([p], { mainDeck: [card('a', 'Hero Card'), card('b', 'Hero Card')] });
    executeSkill(gs, makeIo(), 'SKILL_QUICK_DRAW', 'alice', 'qd', null);
    assert.equal(p.hand.length, 2);
    assert.equal(gs.pendingAction, null);
});

test('SKILL_SNOWBALL offers immediate play (then draw) only when the DRAWN card is Magic', () => {
    const magic = card('A Spell', 'Magic Card');
    const p = player('alice', { party: [hero('Snowball', { id: 'sb' })] });
    const gs = makeState([p], { mainDeck: [magic] }); // pop() draws this
    executeSkill(gs, makeIo(), 'SKILL_SNOWBALL', 'alice', 'sb', null);
    assert.equal(gs.state, 'WAITING_FOR_IMMEDIATE_PLAY');
    assert.equal(gs.pendingCard, magic);
    assert.equal(gs.pendingAction.type, 'IMMEDIATE_PLAY_CHOICE');
    assert.equal(gs.pendingAction.thenDraw, 1);
    assert.equal(p.hand.length, 0); // not in hand yet — it's the pending immediate-play card
});

test('SKILL_SNOWBALL just keeps the card when the draw is not Magic (no play offer)', () => {
    const item = card('An Item', 'Item Card');
    const p = player('alice', { party: [hero('Snowball', { id: 'sb' })] });
    const gs = makeState([p], { mainDeck: [item] });
    executeSkill(gs, makeIo(), 'SKILL_SNOWBALL', 'alice', 'sb', null);
    assert.notEqual(gs.state, 'WAITING_FOR_IMMEDIATE_PLAY');
    assert.equal(gs.pendingAction, null);
    assert.deepEqual(p.hand, [item]);
});

test('SKILL_WILDSHOT draws 3 and forces a discard of 1', () => {
    const deck = [card('a', 'Hero Card'), card('b', 'Hero Card'), card('c', 'Hero Card')];
    const p = player('alice', { party: [hero('Wildshot', { id: 'ws' })] });
    const gs = makeState([p], { mainDeck: deck });
    executeSkill(gs, makeIo(), 'SKILL_WILDSHOT', 'alice', 'ws', null);
    assert.equal(p.hand.length, 3);
    assert.equal(gs.pendingAction.type, 'DISCARD');
    assert.equal(gs.pendingAction.amount, 1);
});

// --- Pan Chucks ---
test('SKILL_PAN_CHUCKS draws 2 and unlocks an OPTIONAL DESTROY when a Challenge is drawn', () => {
    const alice = player('alice', { party: [hero('Pan Chucks', { id: 'pc' })] });
    const bob = player('bob', { party: [hero('Victim', { id: 'v1' })] }); // a hero to destroy
    const gs = makeState([alice, bob], { mainDeck: [card('a', 'Hero Card'), card('c', 'Challenge Card')] });
    executeSkill(gs, makeIo(), 'SKILL_PAN_CHUCKS', 'alice', 'pc', null);
    assert.equal(alice.hand.length, 2);
    assert.equal(gs.pendingAction.type, 'DESTROY');
    assert.equal(gs.pendingAction.optional, true);
});

test('SKILL_PAN_CHUCKS draws 2 with no DESTROY when no Challenge appears', () => {
    const p = player('alice', { party: [hero('Pan Chucks', { id: 'pc' })] });
    const gs = makeState([p], { mainDeck: [card('a', 'Hero Card'), card('b', 'Item Card')] });
    executeSkill(gs, makeIo(), 'SKILL_PAN_CHUCKS', 'alice', 'pc', null);
    assert.equal(p.hand.length, 2);
    assert.equal(gs.pendingAction, null);
});

// --- Deferred pending-action setters ---
test('SKILL_HEAVY_BEAR consumes the chosen target → discard penalty (no double-selection)', () => {
    const p = player('alice', { party: [hero('Heavy Bear', { id: 'hb' })] });
    const bob = player('bob', { hand: [card('x', 'Item Card'), card('y', 'Magic Card'), card('z', 'Hero Card')] });
    const gs = makeState([p, bob]);
    executeSkill(gs, makeIo(), 'SKILL_HEAVY_BEAR', 'alice', 'hb', { targetPlayerId: 'bob' });
    assert.equal(gs.state, 'WAITING_FOR_DISCARD_PENALTY');
    assert.equal(gs.pendingAction.type, 'DISCARD');
    assert.equal(gs.pendingAction.playerToChoose, 'bob');
    assert.equal(gs.pendingAction.amount, 2);
    assert.equal(gs.pendingAction.originalActor, 'alice');
});

test('SKILL_HEAVY_BEAR caps discard amount at the target hand size', () => {
    const p = player('alice', { party: [hero('Heavy Bear', { id: 'hb' })] });
    const bob = player('bob', { hand: [card('x', 'Item Card')] });
    const gs = makeState([p, bob]);
    executeSkill(gs, makeIo(), 'SKILL_HEAVY_BEAR', 'alice', 'hb', { targetPlayerId: 'bob' });
    assert.equal(gs.pendingAction.amount, 1);
});

test('SKILL_HEAVY_BEAR no-ops back to PLAYING when target has no cards', () => {
    const p = player('alice', { party: [hero('Heavy Bear', { id: 'hb' })] });
    const bob = player('bob', { hand: [] });
    const gs = makeState([p, bob]);
    executeSkill(gs, makeIo(), 'SKILL_HEAVY_BEAR', 'alice', 'hb', { targetPlayerId: 'bob' });
    assert.equal(gs.state, 'PLAYING');
    assert.equal(gs.pendingAction, null);
});

test('SKILL_BEAR_CLAW queues a CONDITIONAL_PULL for a Hero', () => {
    const p = player('alice', { party: [hero('Bear Claw', { id: 'bc' })] });
    const gs = makeState([p]);
    executeSkill(gs, makeIo(), 'SKILL_BEAR_CLAW', 'alice', 'bc', null);
    assert.equal(gs.pendingAction.type, 'CONDITIONAL_PULL');
    assert.equal(gs.pendingAction.conditionType, 'Hero Card');
});

test('SKILL_FURY_KNUCKLE queues a CONDITIONAL_PULL for a Challenge', () => {
    const p = player('alice', { party: [hero('Fury Knuckle', { id: 'fk' })] });
    const gs = makeState([p]);
    executeSkill(gs, makeIo(), 'SKILL_FURY_KNUCKLE', 'alice', 'fk', null);
    assert.equal(gs.pendingAction.conditionType, 'Challenge Card');
});

test('SKILL_PLUNDERING_PUMA queues a PUMA_PULL', () => {
    const p = player('alice', { party: [hero('Plundering Puma', { id: 'pp' })] });
    const gs = makeState([p]);
    executeSkill(gs, makeIo(), 'SKILL_PLUNDERING_PUMA', 'alice', 'pp', null);
    assert.equal(gs.pendingAction.type, 'PUMA_PULL');
});

test('SKILL_SLY_PICKINGS queues a CONDITIONAL_PULL Item with play-immediately', () => {
    const p = player('alice', { party: [hero('Sly Pickings', { id: 'sp' })] });
    const gs = makeState([p]);
    executeSkill(gs, makeIo(), 'SKILL_SLY_PICKINGS', 'alice', 'sp', null);
    assert.equal(gs.pendingAction.conditionType, 'Item Card');
    assert.equal(gs.pendingAction.actionOnSuccess, 'PLAY_IMMEDIATELY');
});

test('SKILL_BUTTONS queues a LOOK_AND_PULL', () => {
    const p = player('alice', { party: [hero('Buttons', { id: 'bt' })] });
    const gs = makeState([p]);
    executeSkill(gs, makeIo(), 'SKILL_BUTTONS', 'alice', 'bt', null);
    assert.equal(gs.pendingAction.type, 'LOOK_AND_PULL');
});

test('SKILL_LUCKY_BUCKY queues a CONDITIONAL_PULL Hero with play-immediately', () => {
    const p = player('alice', { party: [hero('Lucky Bucky', { id: 'lb' })] });
    const gs = makeState([p]);
    executeSkill(gs, makeIo(), 'SKILL_LUCKY_BUCKY', 'alice', 'lb', null);
    assert.equal(gs.pendingAction.conditionType, 'Hero Card');
    assert.equal(gs.pendingAction.actionOnSuccess, 'PLAY_IMMEDIATELY');
});

// --- Global actions (with empty edge cases) ---
test('SKILL_TOUGH_TEDDY targets only opponents who have a Fighter and cards', () => {
    const bob = player('bob', { party: [hero('BobFighter', { id: 'bf', class: 'Fighter' })], hand: [card('h', 'Item Card')] });
    const carol = player('carol', { party: [hero('CarolWiz', { id: 'cw', class: 'Wizard' })], hand: [card('h2', 'Item Card')] });
    const alice = player('alice', { party: [hero('Tough Teddy', { id: 'tt' })] });
    const gs = makeState([alice, bob, carol]);
    executeSkill(gs, makeIo(), 'SKILL_TOUGH_TEDDY', 'alice', 'tt', null);
    assert.equal(gs.state, 'WAITING_FOR_MULTIPLE_DISCARDS');
    assert.deepEqual(gs.pendingAction.targets, ['bob']);
});

test('SKILL_TOUGH_TEDDY does nothing when no opponent has a Fighter with cards', () => {
    const bob = player('bob', { party: [hero('BobWiz', { id: 'bw', class: 'Wizard' })], hand: [card('h', 'Item Card')] });
    const alice = player('alice', { party: [hero('Tough Teddy', { id: 'tt' })] });
    const gs = makeState([alice, bob]);
    executeSkill(gs, makeIo(), 'SKILL_TOUGH_TEDDY', 'alice', 'tt', null);
    assert.notEqual(gs.state, 'WAITING_FOR_MULTIPLE_DISCARDS');
});

test('SKILL_BEARY_WISE queues a MULTI_DISCARD_AND_CHOOSE global action', () => {
    const bob = player('bob', { hand: [card('h', 'Item Card')] });
    const alice = player('alice', { party: [hero('Beary Wise', { id: 'bw' })] });
    const gs = makeState([alice, bob]);
    const io = makeIo();
    executeSkill(gs, io, 'SKILL_BEARY_WISE', 'alice', 'bw', null);
    assert.equal(gs.pendingGlobalAction.type, 'MULTI_DISCARD_AND_CHOOSE');
    assert.deepEqual(gs.pendingGlobalAction.pendingPlayerIds, ['bob']);
    assert.ok(io.find('global_action_requested'));
});

test('SKILL_GREEDY_CHEEKS queues a MULTI_GIVE global action', () => {
    const bob = player('bob', { hand: [card('h', 'Item Card')] });
    const alice = player('alice', { party: [hero('Greedy Cheeks', { id: 'gc' })] });
    const gs = makeState([alice, bob]);
    executeSkill(gs, makeIo(), 'SKILL_GREEDY_CHEEKS', 'alice', 'gc', null);
    assert.equal(gs.pendingGlobalAction.type, 'MULTI_GIVE');
});

test('SKILL_GREEDY_CHEEKS no-ops when opponents have empty hands', () => {
    const bob = player('bob', { hand: [] });
    const alice = player('alice', { party: [hero('Greedy Cheeks', { id: 'gc' })] });
    const gs = makeState([alice, bob]);
    executeSkill(gs, makeIo(), 'SKILL_GREEDY_CHEEKS', 'alice', 'gc', null);
    assert.equal(gs.pendingGlobalAction, null);
});

// --- Destroy / steal variants ---
test('SKILL_MEOWZIO steals a hero and pulls a card from that player', () => {
    const victim = hero('Victim', { id: 'v1' });
    const bob = player('bob', { party: [victim], hand: [card('x', 'Item Card')] });
    const alice = player('alice', { party: [hero('Meowzio', { id: 'mz' })] });
    const gs = makeState([alice, bob]);
    executeSkill(gs, makeIo(), 'SKILL_MEOWZIO', 'alice', 'mz', { targetPlayerId: 'bob', targetHeroId: 'v1' });
    assert.ok(alice.party.includes(victim)); // stolen, not destroyed
    assert.equal(bob.party.length, 0);
    assert.equal(alice.hand.length, 1);       // pulled a card from bob
    assert.equal(bob.hand.length, 0);
});

test('SKILL_MEOWZIO pulls from the chosen player when no Hero can be stolen', () => {
    const bob = player('bob', { hand: [card('x', 'Item Card')] });
    const alice = player('alice', { party: [hero('Meowzio', { id: 'mz' })] });
    const gs = makeState([alice, bob]);
    const io = makeIo();
    executeSkill(gs, io, 'SKILL_MEOWZIO', 'alice', 'mz', { targetPlayerId: 'bob' });
    assert.equal(alice.hand.length, 1);
    assert.equal(bob.hand.length, 0);
    assert.match(io.lastMessage(), /STEAL clause had no legal target/);
});

test('SKILL_WHISKERS steals the targeted hero, then queues a DESTROY for a second', () => {
    const stolen = hero('Stolen', { id: 'v1' });
    const other = hero('Other', { id: 'v2' });
    const bob = player('bob', { party: [stolen, other] });
    const alice = player('alice', { party: [hero('Whiskers', { id: 'wh' })] });
    const gs = makeState([alice, bob]);
    executeSkill(gs, makeIo(), 'SKILL_WHISKERS', 'alice', 'wh', { targetPlayerId: 'bob', targetHeroId: 'v1' });
    // v1 is STOLEN (not discarded) into alice's party...
    assert.ok(alice.party.includes(stolen));
    assert.ok(!gs.discardPile.includes(stolen));
    // ...and a DESTROY of the second hero is queued (bob still has v2).
    assert.equal(gs.pendingAction.type, 'DESTROY');
    assert.equal(gs.pendingAction.playerToChoose, 'alice');
});

test('SKILL_WHISKERS with no second hero leaves no pending destroy', () => {
    const stolen = hero('Stolen', { id: 'v1' });
    const bob = player('bob', { party: [stolen] });
    const alice = player('alice', { party: [hero('Whiskers', { id: 'wh' })] });
    const gs = makeState([alice, bob]);
    executeSkill(gs, makeIo(), 'SKILL_WHISKERS', 'alice', 'wh', { targetPlayerId: 'bob', targetHeroId: 'v1' });
    assert.ok(alice.party.includes(stolen));
    assert.equal(gs.pendingAction, null);
});

test('SKILL_WHISKERS queues DESTROY when STEAL has no legal target', () => {
    const victim = hero('Destroyable only', { id: 'v1' });
    const bob = player('bob', { party: [victim], cannotBeStolen: true });
    const alice = player('alice', { party: [hero('Whiskers', { id: 'wh' })] });
    const gs = makeState([alice, bob]);
    const io = makeIo();
    executeSkill(gs, io, 'SKILL_WHISKERS', 'alice', 'wh', null);
    assert.equal(gs.pendingAction.type, 'DESTROY');
    assert.equal(gs.pendingAction.playerToChoose, 'alice');
    assert.equal(bob.party.length, 1);
    assert.match(io.lastMessage(), /no Hero to STEAL/i);
});

test('SKILL_WHISKERS resolves STEAL when DESTROY has no legal target', () => {
    const victim = hero('Stealable only', { id: 'v1' });
    const bob = player('bob', { party: [victim], cannotBeDestroyed: true });
    const alice = player('alice', { party: [hero('Whiskers', { id: 'wh' })] });
    const gs = makeState([alice, bob]);
    executeSkill(gs, makeIo(), 'SKILL_WHISKERS', 'alice', 'wh', {
        targetPlayerId: 'bob', targetHeroId: 'v1'
    });
    assert.ok(alice.party.includes(victim));
    assert.equal(gs.pendingAction, null);
});

test('SKILL_SERIOUS_GREY destroys a hero and ALWAYS draws a card', () => {
    const victim = hero('Victim', { id: 'v1' });
    const bob = player('bob', { party: [victim] });
    const alice = player('alice', { party: [hero('Serious Grey', { id: 'sg' })] });
    const gs = makeState([alice, bob], { mainDeck: [card('reward', 'Hero Card')] });
    executeSkill(gs, makeIo(), 'SKILL_SERIOUS_GREY', 'alice', 'sg', { targetPlayerId: 'bob', targetHeroId: 'v1' });
    assert.equal(bob.party.length, 0);
    assert.equal(alice.hand.length, 1); // draw is unconditional ("DESTROY ... AND DRAW")
});

test('SKILL_SERIOUS_GREY still draws when no destroy target exists', () => {
    const alice = player('alice', { party: [hero('Serious Grey', { id: 'sg' })] });
    const gs = makeState([alice, player('bob')], { mainDeck: [card('reward', 'Hero Card')] });
    const io = makeIo();
    executeSkill(gs, io, 'SKILL_SERIOUS_GREY', 'alice', 'sg', null);
    assert.equal(alice.hand.length, 1);
    assert.match(io.lastMessage(), /no Hero to DESTROY/);
    assert.match(io.lastMessage(), /still drew a card/);
});

test('SKILL_SHURIKITTY takes the destroyed hero\'s equipped item into hand', () => {
    const sword = card('Sword', 'Item Card');
    const victim = hero('Victim', { id: 'v1', equippedItem: sword });
    const bob = player('bob', { party: [victim] });
    const alice = player('alice', { party: [hero('Shurikitty', { id: 'sk' })] });
    const gs = makeState([alice, bob]);
    executeSkill(gs, makeIo(), 'SKILL_SHURIKITTY', 'alice', 'sk', { targetPlayerId: 'bob', targetHeroId: 'v1' });
    assert.equal(bob.party.length, 0);
    assert.ok(alice.hand.includes(sword));       // item goes to hand...
    assert.ok(!gs.discardPile.includes(sword));  // ...not the discard pile
    assert.ok(gs.discardPile.includes(victim));  // the hero itself is discarded
});

test('SKILL_WIGGLES steals a hero and queues a free roll to use its effect', () => {
    const target = hero('Target', { id: 't1' });
    const bob = player('bob', { party: [target] });
    const alice = player('alice', { party: [hero('Wiggles', { id: 'wg' })] });
    const gs = makeState([alice, bob]);
    executeSkill(gs, makeIo(), 'SKILL_WIGGLES', 'alice', 'wg', { targetPlayerId: 'bob', targetHeroId: 't1' });
    assert.ok(alice.party.includes(target));
    // No bogus discard — instead a free skill roll for the stolen hero is set up.
    assert.equal(gs.pendingAction, null);
    assert.equal(gs.state, 'WAITING_TO_ROLL');
    assert.equal(gs.pendingRoll.type, 'HERO_SKILL');
    assert.equal(gs.pendingRoll.targetHeroId, 't1');
    assert.equal(gs.pendingRoll.rollerId, 'alice');
});

test('SKILL_WIGGLES does not queue a roll for a Sealing-Key-sealed stolen hero', () => {
    const target = hero('Target', { id: 't1', equippedItem: card('Sealing Key', 'Cursed Item Card', { effect_id: 'CURSE_KEY' }) });
    const bob = player('bob', { party: [target] });
    const alice = player('alice', { party: [hero('Wiggles', { id: 'wg' })] });
    const gs = makeState([alice, bob]);
    executeSkill(gs, makeIo(), 'SKILL_WIGGLES', 'alice', 'wg', { targetPlayerId: 'bob', targetHeroId: 't1' });
    assert.ok(alice.party.includes(target));
    assert.notEqual(gs.state, 'WAITING_TO_ROLL');
    assert.ok(!gs.pendingRoll);
});

test('SKILL_WIGGLES is blocked by cannotBeStolen', () => {
    const target = hero('Target', { id: 't1' });
    const bob = player('bob', { party: [target], cannotBeStolen: true });
    const alice = player('alice', { party: [hero('Wiggles', { id: 'wg' })] });
    const gs = makeState([alice, bob]);
    executeSkill(gs, makeIo(), 'SKILL_WIGGLES', 'alice', 'wg', { targetPlayerId: 'bob', targetHeroId: 't1' });
    assert.equal(bob.party.length, 1);
    assert.equal(alice.party.length, 1); // only Wiggles, nothing stolen
});

test('SKILL_TIPSY_TOOTIE swaps itself for a stolen hero', () => {
    const target = hero('Target', { id: 't1' });
    const tipsy = hero('Tipsy Tootie', { id: 'tp' });
    const bob = player('bob', { party: [target] });
    const alice = player('alice', { party: [tipsy] });
    const gs = makeState([alice, bob]);
    executeSkill(gs, makeIo(), 'SKILL_TIPSY_TOOTIE', 'alice', 'tp', { targetPlayerId: 'bob', targetHeroId: 't1' });
    assert.ok(alice.party.includes(target));      // alice gained the stolen hero
    assert.ok(bob.party.includes(tipsy));         // bob received Tipsy Tootie
    assert.ok(!alice.party.includes(tipsy));
});

test('SKILL_FLUFFY destroys multiple targeted heroes, skipping protected ones', () => {
    const v1 = hero('V1', { id: 'v1' });
    const v2 = hero('V2', { id: 'v2' });
    const bob = player('bob', { party: [v1] });
    const carol = player('carol', { party: [v2], cannotBeDestroyed: true });
    const alice = player('alice', { party: [hero('Fluffy', { id: 'fl' })] });
    const gs = makeState([alice, bob, carol]);
    executeSkill(gs, makeIo(), 'SKILL_FLUFFY', 'alice', 'fl', { targetHeroIds: ['v1', 'v2'] });
    assert.equal(bob.party.length, 0);   // v1 destroyed
    assert.equal(carol.party.length, 1); // v2 protected
});

// --- Player-target pulls ---
test('SKILL_SLIPPERY_PAWS pulls 2 cards then offers to discard one of those two', () => {
    const bob = player('bob', { hand: [card('a', 'Item Card'), card('b', 'Item Card'), card('c', 'Item Card')] });
    const alice = player('alice', { party: [hero('Slippery Paws', { id: 'sp' })] });
    const gs = makeState([alice, bob]);
    withRandom(0, () => {
        executeSkill(gs, makeIo(), 'SKILL_SLIPPERY_PAWS', 'alice', 'sp', { targetPlayerId: 'bob' });
    });
    assert.equal(alice.hand.length, 2); // pulled 2
    assert.equal(bob.hand.length, 1);
    // The discard is restricted to exactly the two pulled cards (peek modal).
    assert.equal(gs.pendingPeek.skillId, 'SKILL_SLIPPERY_PAWS');
    assert.equal(gs.pendingPeek.allowedCardIds.length, 2);
});

test('SKILL_SMOOTH_MIMIMEOW pulls only from opponents who have a Thief', () => {
    const bob = player('bob', { party: [hero('BobThief', { id: 'bt', class: 'Thief' })], hand: [card('a', 'Item Card')] });
    const carol = player('carol', { party: [hero('CarolWiz', { id: 'cw', class: 'Wizard' })], hand: [card('b', 'Item Card')] });
    const alice = player('alice', { party: [hero('Smooth Mimimeow', { id: 'sm' })] });
    const gs = makeState([alice, bob, carol]);
    withRandom(0, () => {
        executeSkill(gs, makeIo(), 'SKILL_SMOOTH_MIMIMEOW', 'alice', 'sm', null);
    });
    assert.equal(alice.hand.length, 1); // only pulled from bob (Thief)
    assert.equal(bob.hand.length, 0);
    assert.equal(carol.hand.length, 1); // untouched
});

test('SKILL_SMOOTH_MIMIMEOW counts a Hero wearing a Thief Mask', () => {
    const masked = hero('BobWiz', {
        id: 'masked', class: 'Wizard',
        equippedItem: card('Thief Mask', 'Item Card', { effect_id: 'ITEM_MASK' })
    });
    const bob = player('bob', { party: [masked], hand: [card('loot', 'Item Card')] });
    const alice = player('alice', { party: [hero('Smooth Mimimeow', { id: 'sm' })] });
    const gs = makeState([alice, bob]);
    withRandom(0, () => executeSkill(gs, makeIo(), 'SKILL_SMOOTH_MIMIMEOW', 'alice', 'sm', null));
    assert.equal(alice.hand.length, 1);
    assert.equal(bob.hand.length, 0);
});

test('Orthus offers a Magic card drawn by a Hero effect for immediate play', () => {
    const alice = player('alice', {
        party: [hero('Drawer', { id: 'drawer' })],
        slainMonsters: [{ effect_id: 'MONSTER_ORTHUS' }]
    });
    const magic = card('Spell', 'Magic Card');
    const gs = makeState([alice], { mainDeck: [magic] });
    executeSkill(gs, makeIo(), 'DRAW_CARD', 'alice', 'drawer', null);
    assert.equal(gs.state, 'WAITING_FOR_IMMEDIATE_PLAY');
    assert.equal(gs.pendingCard, magic);
    assert.equal(alice.hand.length, 0);
});

test('Rex Major grants an extra draw when a Magic effect draws a Modifier', () => {
    const alice = player('alice', { slainMonsters: [{ effect_id: 'MONSTER_REX_MAJOR' }] });
    const bonus = card('Bonus', 'Hero Card');
    const modifier = card('+2', 'Modifier Card');
    const gs = makeState([alice], { mainDeck: [bonus, modifier] });
    executeMagic(gs, makeIo(), 'MAGIC_CRIT_BOOST', 'alice', null);
    assert.ok(alice.hand.includes(modifier));
    assert.ok(alice.hand.includes(bonus));
});

test('Crowned Serpent owner draws when another player plays a Modifier', () => {
    const owner = player('owner', { slainMonsters: [{ effect_id: 'MONSTER_CROWNED_SERPENT' }] });
    const other = player('other');
    const gs = makeState([owner, other], { mainDeck: [card('reward', 'Hero Card')] });
    triggerCrownedSerpent(gs, makeIo());
    assert.equal(owner.hand.length, 1);
    assert.equal(other.hand.length, 0);
});

test('Sly Pickings immediate Item play moves the specific item into equip selection', () => {
    const alice = player('alice');
    const item = card('Stolen Item', 'Item Card');
    const gs = makeState([alice], { state: 'WAITING_FOR_IMMEDIATE_PLAY', pendingCard: item });
    assert.equal(prepareImmediateItemPlay(gs, 'alice'), true);
    assert.ok(alice.hand.includes(item));
    assert.equal(gs.state, 'WAITING_FOR_HAND_SELECTION');
    assert.deepEqual(gs.pendingAction.allowedCardIds, [item.id]);
    assert.ok(!gs.discardPile.includes(item));
});

test('Buttons marks only the pulled Magic card for a free play', () => {
    const alice = player('alice');
    const magic = card('Taken Spell', 'Magic Card');
    const other = card('Other Spell', 'Magic Card');
    alice.hand.push(magic, other);
    assert.equal(markButtonsFreePlay(alice, magic), true);
    assert.equal(magic.freePlay, true);
    assert.notEqual(other.freePlay, true);
});

test('Winds of Change returns an opponents equipped Item to that original owner', () => {
    const item = card('Owner Item', 'Item Card');
    const target = hero('Target', { id: 'target', equippedItem: item });
    const alice = player('alice');
    const bob = player('bob', { party: [target] });
    const gs = makeState([alice, bob]);
    const result = returnEquippedItemToOwner(gs, 'target');
    assert.equal(result.owner, bob);
    assert.ok(bob.hand.includes(item));
    assert.equal(alice.hand.length, 0);
    assert.equal(target.equippedItem, null);
});

test('SKILL_SHARP_FOX reveals the target hand but steals nothing', () => {
    const bob = player('bob', { hand: [card('a', 'Item Card')] });
    const alice = player('alice', { party: [hero('Sharp Fox', { id: 'sf' })] });
    const io = makeIo();
    const gs = makeState([alice, bob]);
    executeSkill(gs, io, 'SKILL_SHARP_FOX', 'alice', 'sf', { targetPlayerId: 'bob' });
    assert.equal(alice.hand.length, 0); // nothing taken
    assert.equal(bob.hand.length, 1);   // target keeps their card
    const peek = io.find('peek_cards');
    assert.ok(peek && peek.payload.viewOnly === true); // view-only reveal
});

test('SKILL_SILENT_SHADOW reveals the hand and waits for a choice (no auto-pull)', () => {
    const bob = player('bob', { hand: [card('a', 'Item Card')] });
    const alice = player('alice', { party: [hero('Silent Shadow', { id: 'ss' })] });
    const io = makeIo();
    const gs = makeState([alice, bob]);
    executeSkill(gs, io, 'SKILL_SILENT_SHADOW', 'alice', 'ss', { targetPlayerId: 'bob' });
    assert.equal(alice.hand.length, 0); // not pulled yet — player chooses
    assert.equal(bob.hand.length, 1);
    assert.equal(gs.pendingPeek.skillId, 'SKILL_SILENT_SHADOW');
    const peek = io.find('peek_cards');
    assert.ok(peek && peek.payload.skillId === 'SKILL_SILENT_SHADOW');
});

test('SKILL_SHURIKITTY destroys the targeted hero', () => {
    const victim = hero('Victim', { id: 'v1' });
    const bob = player('bob', { party: [victim] });
    const alice = player('alice', { party: [hero('Shurikitty', { id: 'sk' })] });
    const gs = makeState([alice, bob]);
    executeSkill(gs, makeIo(), 'SKILL_SHURIKITTY', 'alice', 'sk', { targetPlayerId: 'bob', targetHeroId: 'v1' });
    assert.equal(bob.party.length, 0);
    assert.ok(gs.discardPile.includes(victim));
});

// --- Self/item target ---
test('SKILL_HOLY_CURSELIFTER returns an equipped item from one of your heroes to hand', () => {
    const item = card('Cursed Coin', 'Cursed Item Card');
    const myHero = hero('MyHero', { id: 'mh', equippedItem: item });
    const alice = player('alice', { party: [myHero] });
    const gs = makeState([alice]);
    executeSkill(gs, makeIo(), 'SKILL_HOLY_CURSELIFTER', 'alice', 'hc', { targetHeroId: 'mh' });
    assert.equal(myHero.equippedItem, null);
    assert.ok(alice.hand.includes(item));
});

// --- Discard-pile search variants ---
for (const skillId of ['SKILL_RADIANT_HORN', 'SKILL_LOOKIE_ROOKIE', 'SKILL_BUN_BUN']) {
    test(`${skillId} retrieves the chosen card from the discard pile`, () => {
        const buried = card('Buried', 'Modifier Card', { id: 'buried' });
        const p = player('alice', { party: [hero('Searcher', { id: 'se' })] });
        const gs = makeState([p], { discardPile: [card('other', 'Item Card'), buried] });
        executeSkill(gs, makeIo(), skillId, 'alice', 'se', { targetCardId: 'buried' });
        assert.ok(p.hand.includes(buried));
        assert.equal(gs.discardPile.length, 1);
    });
}

// --- Deck peek ---
test('SKILL_BULLSEYE emits the top 3 cards privately to the roller', () => {
    const deck = [card('a', 'Hero Card'), card('b', 'Hero Card'), card('c', 'Hero Card'), card('d', 'Hero Card')];
    const p = player('alice', { party: [hero('Bullseye', { id: 'be' })] });
    const gs = makeState([p], { mainDeck: deck });
    const io = makeIo();
    executeSkill(gs, io, 'SKILL_BULLSEYE', 'alice', 'be', null);
    const peek = io.find('peek_cards');
    assert.ok(peek);
    assert.equal(peek.to, 'alice');
    assert.equal(peek.payload.cards.length, 3);
});

test('SKILL_BULLSEYE reports an empty deck gracefully', () => {
    const p = player('alice', { party: [hero('Bullseye', { id: 'be' })] });
    const gs = makeState([p], { mainDeck: [] });
    const io = makeIo();
    executeSkill(gs, io, 'SKILL_BULLSEYE', 'alice', 'be', null);
    assert.equal(io.find('peek_cards'), undefined);
    assert.match(io.lastMessage(), /deck is empty/i);
});
