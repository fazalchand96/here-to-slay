'use strict';

// Unit tests for the passive-rule functions in server.js — the LEADER_*/MONSTER_*/
// ITEM_*/CURSE_* roll modifiers, monster attack requirements, and win conditions.
// These are NOT covered by the skill_engine matrix (which tests active skills).
//
// server.js only starts the HTTP server when run directly (require.main === module),
// so requiring it here just gives us the pure functions.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    calculateRollDetails,
    meetsMonsterRequirements,
    checkWinCondition,
    isValidItemEquipTarget,
    clearUntilNextTurnProtections,
    playerHasEffectiveClass,
    loadCards,
    gameState
} = require('../server');

// ---------------------------------------------------------------------------
// Tiny factories
// ---------------------------------------------------------------------------
const leader = (effect_id, cls, name = effect_id) => ({ effect_id, class: cls, name, type: 'Party Leader' });
const monster = (effect_id, name = effect_id) => ({ effect_id, name, type: 'Monster Card' });
const heroOf = (cls, extra = {}) => ({ type: 'Hero Card', class: cls, name: cls, ...extra });
const item = (effect_id, name = effect_id) => ({ effect_id, name, type: 'Item Card' });
const pl = (extra = {}) => ({ leader: null, party: [], slainMonsters: [], ...extra });

test('Calming Voice and Mighty Blade protections expire at the start of the owner next turn', () => {
    const player = pl({ cannotBeStolen: true, cannotBeDestroyed: true });
    clearUntilNextTurnProtections(player);
    assert.equal(player.cannotBeStolen, false);
    assert.equal(player.cannotBeDestroyed, false);
});

test('Items and Cursed Items may target Heroes belonging to either player', () => {
    const state = {
        players: {
            alice: pl({ party: [heroOf('Fighter', { id: 'alice-hero' })] }),
            bob: pl({ party: [heroOf('Wizard', { id: 'bob-hero' })] })
        }
    };

    assert.equal(isValidItemEquipTarget(state, 'alice', 'alice-hero'), true);
    assert.equal(isValidItemEquipTarget(state, 'bob', 'bob-hero'), true);
    assert.equal(isValidItemEquipTarget(state, 'bob', 'missing-hero'), false);
    assert.equal(isValidItemEquipTarget(state, 'missing-player', 'alice-hero'), false);
});

test('class-gated Challenges accept leaders and Heroes wearing the matching Mask', () => {
    assert.equal(playerHasEffectiveClass(pl({ leader: leader('LEADER_DRUID', 'Druid') }), 'Druid'), true);
    assert.equal(playerHasEffectiveClass(pl({ party: [heroOf('Wizard', { equippedItem: { ...item('ITEM_MASK', 'Warrior Mask'), class: 'Warrior' } })] }), 'Warrior'), true);
    assert.equal(playerHasEffectiveClass(pl({ party: [heroOf('Wizard')] }), 'Druid'), false);
});

// ===========================================================================
// calculateRollDetails — passive roll bonuses
// ===========================================================================

test('calculateRollDetails returns the base roll with no modifiers', () => {
    const { total, breakdown } = calculateRollDetails(pl(), 7, 'HERO_SKILL');
    assert.equal(total, 7);
    assert.equal(breakdown[0].source, 'Base Dice');
    assert.equal(breakdown.length, 1);
});

test('LEADER_BARD gives +1 on a hero skill but not on an attack', () => {
    const p = pl({ leader: leader('LEADER_BARD', 'Bard') });
    assert.equal(calculateRollDetails(p, 5, 'HERO_SKILL').total, 6);
    assert.equal(calculateRollDetails(p, 5, 'ATTACK').total, 5);
});

test('LEADER_RANGER gives +1 only on an attack', () => {
    const p = pl({ leader: leader('LEADER_RANGER', 'Ranger') });
    assert.equal(calculateRollDetails(p, 5, 'ATTACK').total, 6);
    assert.equal(calculateRollDetails(p, 5, 'HERO_SKILL').total, 5);
});

test('LEADER_FIGHTER gives +2 only on a challenge', () => {
    const p = pl({ leader: leader('LEADER_FIGHTER', 'Fighter') });
    assert.equal(calculateRollDetails(p, 5, 'CHALLENGE').total, 7);
    assert.equal(calculateRollDetails(p, 5, 'ATTACK').total, 5);
});

test('LEADER_WARRIOR adds +1 for every equipped regular or Cursed Item', () => {
    const p = pl({
        leader: leader('LEADER_WARRIOR', 'Warrior', 'The Piercing Howl'),
        party: [
            heroOf('Warrior', { equippedItem: item('ITEM_RING') }),
            heroOf('Druid', { equippedItem: { ...item('CURSE_KEY'), type: 'Cursed Item Card' } })
        ]
    });
    const result = calculateRollDetails(p, 5, 'ATTACK');
    assert.equal(result.total, 7);
    assert.deepEqual(result.breakdown.at(-1), { source: 'The Piercing Howl', value: 2 });
});

test('MONSTER_ANURAN_CAULDRON gives +1 in any context', () => {
    const p = pl({ slainMonsters: [monster('MONSTER_ANURAN_CAULDRON')] });
    assert.equal(calculateRollDetails(p, 4, 'ATTACK').total, 5);
    assert.equal(calculateRollDetails(p, 4, 'HERO_SKILL').total, 5);
});

test('MONSTER_DARK_DRAGON_KING gives +1 on a hero skill only', () => {
    const p = pl({ slainMonsters: [monster('MONSTER_DARK_DRAGON_KING')] });
    assert.equal(calculateRollDetails(p, 4, 'HERO_SKILL').total, 5);
    assert.equal(calculateRollDetails(p, 4, 'ATTACK').total, 4);
});

test('MONSTER_TITAN_WYVERN gives +1 on a challenge only', () => {
    const p = pl({ slainMonsters: [monster('MONSTER_TITAN_WYVERN')] });
    assert.equal(calculateRollDetails(p, 4, 'CHALLENGE').total, 5);
    assert.equal(calculateRollDetails(p, 4, 'HERO_SKILL').total, 4);
});

test('magicRollBonus is added to the roll', () => {
    const p = pl({ magicRollBonus: 2 });
    assert.equal(calculateRollDetails(p, 6, 'ATTACK').total, 8);
});

// Regression: Wise Shield (+3) / Vibrant Glow (+5) set player.rollBonus, which
// was never read by calculateRollDetails — so the buff silently did nothing.
test('rollBonus (Wise Shield/Vibrant Glow) is added to the roll in every context', () => {
    const p = pl({ rollBonus: 3 });
    assert.equal(calculateRollDetails(p, 5, 'ATTACK').total, 8);
    assert.equal(calculateRollDetails(p, 5, 'HERO_SKILL').total, 8);
    assert.equal(calculateRollDetails(p, 5, 'CHALLENGE').total, 8);
});

test('ITEM_RING on the target hero adds +2 to a hero skill roll', () => {
    const target = heroOf('Fighter', { equippedItem: item('ITEM_RING') });
    assert.equal(calculateRollDetails(pl(), 5, 'HERO_SKILL', target).total, 7);
});

test('CURSE_SNAKE on the target hero subtracts 2 from a hero skill roll', () => {
    const target = heroOf('Fighter', { equippedItem: item('CURSE_SNAKE') });
    assert.equal(calculateRollDetails(pl(), 5, 'HERO_SKILL', target).total, 3);
});

test('equipped-item modifiers only apply in the HERO_SKILL context', () => {
    const target = heroOf('Fighter', { equippedItem: item('ITEM_RING') });
    assert.equal(calculateRollDetails(pl(), 5, 'ATTACK', target).total, 5);
});

test('passive bonuses stack (leader + slain monster + magic)', () => {
    const p = pl({
        leader: leader('LEADER_BARD', 'Bard'),
        slainMonsters: [monster('MONSTER_DARK_DRAGON_KING')],
        magicRollBonus: 2,
    });
    // base 5 + Bard 1 + Dark Dragon King 1 + magic 2 = 9
    assert.equal(calculateRollDetails(p, 5, 'HERO_SKILL').total, 9);
});

// ===========================================================================
// meetsMonsterRequirements
// ===========================================================================

test('no/empty/None requirement is always met', () => {
    assert.equal(meetsMonsterRequirements(pl(), ''), true);
    assert.equal(meetsMonsterRequirements(pl(), 'None'), true);
    assert.equal(meetsMonsterRequirements(pl(), null), true);
});

test('"1 Hero" needs at least one party hero', () => {
    assert.equal(meetsMonsterRequirements(pl(), '1 Hero'), false);
    assert.equal(meetsMonsterRequirements(pl({ party: [heroOf('Bard')] }), '1 Hero'), true);
});

test('"3 Heroes" counts party heroes (plural normalized)', () => {
    const two = pl({ party: [heroOf('Bard'), heroOf('Fighter')] });
    const three = pl({ party: [heroOf('Bard'), heroOf('Fighter'), heroOf('Thief')] });
    assert.equal(meetsMonsterRequirements(two, '3 Heroes'), false);
    assert.equal(meetsMonsterRequirements(three, '3 Heroes'), true);
});

test('the leader satisfies a class requirement but does not count as a Hero', () => {
    // Leader is a Fighter; no party heroes.
    const p = pl({ leader: leader('LEADER_FIGHTER', 'Fighter') });
    assert.equal(meetsMonsterRequirements(p, '1 Fighter'), true);   // leader's class counts
    assert.equal(meetsMonsterRequirements(p, '1 Hero'), false);     // leader is not a Hero
});

test('"1 Fighter, 1 Hero" needs a Fighter class AND a party hero', () => {
    const fighterLeaderNoParty = pl({ leader: leader('LEADER_FIGHTER', 'Fighter') });
    assert.equal(meetsMonsterRequirements(fighterLeaderNoParty, '1 Fighter, 1 Hero'), false);

    const fighterHero = pl({ party: [heroOf('Fighter')] });
    assert.equal(meetsMonsterRequirements(fighterHero, '1 Fighter, 1 Hero'), true);
});

// ===========================================================================
// checkWinCondition (reads the module gameState)
// ===========================================================================

function setBoard(players) {
    gameState.players = {};
    gameState.playerOrder = [];
    players.forEach((p, i) => {
        const id = `p${i}`;
        gameState.players[id] = { id, leader: null, party: [], slainMonsters: [], ...p };
        gameState.playerOrder.push(id);
    });
}

test('no winner when nobody has met a condition', () => {
    setBoard([{ party: [heroOf('Bard')] }, { slainMonsters: [monster('M1')] }]);
    assert.equal(checkWinCondition(), null);
});

test('slaying 3 monsters wins', () => {
    setBoard([{ slainMonsters: [monster('M1'), monster('M2'), monster('M3')] }]);
    const res = checkWinCondition();
    assert.equal(res.winnerId, 'p0');
    assert.match(res.reason, /3 monsters/);
});

test('assembling 6 different classes (leader + party) wins until expansion Heroes go live', () => {
    setBoard([{
        leader: leader('LEADER_WIZARD', 'Wizard'),
        party: [heroOf('Fighter'), heroOf('Bard'), heroOf('Guardian'), heroOf('Ranger'), heroOf('Thief')],
    }]);
    const res = checkWinCondition();
    assert.equal(res.winnerId, 'p0');
    assert.match(res.reason, /6 classes/);
});

test('duplicate classes do NOT count toward the 6-class win', () => {
    setBoard([{
        leader: leader('LEADER_FIGHTER', 'Fighter'),
        party: [heroOf('Fighter'), heroOf('Fighter'), heroOf('Bard'), heroOf('Thief'), heroOf('Ranger')],
    }]);
    // Distinct classes: Fighter, Bard, Thief, Ranger = 4 < 6
    assert.equal(checkWinCondition(), null);
});

// ===========================================================================
// Masks (ITEM_MASK): equipped Hero counts as the Mask's class instead of its own
// ===========================================================================

test('a Mask makes the equipped Hero count as the Mask\'s class for requirements', () => {
    const fighterWithBardMask = pl({ party: [heroOf('Fighter', { equippedItem: item('ITEM_MASK', 'Bard Mask') })] });
    assert.equal(meetsMonsterRequirements(fighterWithBardMask, '1 Bard'), true);     // counts as Bard
    assert.equal(meetsMonsterRequirements(fighterWithBardMask, '1 Fighter'), false); // original class is replaced
});

test('a Mask can complete the 6-class win by changing a duplicate class', () => {
    // Leader Fighter + {Bard, Guardian, Ranger, Thief} + a second Fighter
    // wearing a Wizard Mask -> the masked hero counts as Wizard -> 6 classes.
    setBoard([{
        leader: leader('LEADER_FIGHTER', 'Fighter'),
        party: [
            heroOf('Bard'), heroOf('Guardian'), heroOf('Ranger'), heroOf('Thief'),
            heroOf('Fighter', { equippedItem: item('ITEM_MASK', 'Wizard Mask') }),
        ],
    }]);
    const res = checkWinCondition();
    assert.equal(res && res.winnerId, 'p0');
    assert.match(res.reason, /6 classes/);
});

test('only expansion cards with full card art enter live decks', () => {
    loadCards();
    const liveCards = [
        ...gameState.availableLeaders,
        ...gameState.monsterDeck,
        ...gameState.mainDeck,
    ];
    const liveExpansionCards = liveCards.filter(card => card.expansion === 'Warrior & Druid');

    assert.ok(liveExpansionCards.length > 0);
    assert.ok(liveExpansionCards.every(card => card.fullCardArtUrl));
    assert.deepEqual(
        [...new Set(liveExpansionCards.map(card => card.type))].sort(),
        ['Magic Card', 'Modifier Card', 'Monster Card', 'Party Leader']
    );
    assert.deepEqual(
        liveExpansionCards
            .filter(card => card.type === 'Magic Card')
            .map(card => card.name)
            .sort(),
        ['Beast Call', 'Rapid Refresh']
    );
    assert.equal(liveExpansionCards.some(card => card.type === 'Hero Card'), false);
    assert.equal(liveExpansionCards.some(card => card.type === 'Item Card'), false);
    assert.equal(liveExpansionCards.some(card => card.type === 'Cursed Item Card'), false);
    assert.equal(liveExpansionCards.some(card => card.type === 'Challenge Card'), false);
});
