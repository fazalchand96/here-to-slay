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
    isHeroSkillRollSuccessful,
    meetsMonsterRequirements,
    checkWinCondition,
    isValidItemEquipTarget,
    clearUntilNextTurnProtections,
    playerHasEffectiveClass,
    getConnectedChallengeOpponentIds,
    haveAllConnectedChallengeOpponentsPassed,
    queueLightningLabrysPlayerChoice,
    queueLightningLabrysSacrifice,
    triggerPlayedCardMonsterPassives,
    attackCostAllowedTypes,
    canPayMonsterAttackCost,
    eligibleEndTurnMonsterEffects,
    restoreDragonWaspHero,
    completeLumberingDrawStep,
    resolveLumberingContinuation,
    CHALLENGE_TIMEOUT_MS,
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

test('Lightning Labrys queues each player choice and lets the chosen player select the sacrifice', () => {
    const state = {
        state: 'PLAYING',
        players: {
            alice: pl({ id: 'alice', connected: true }),
            bob: pl({ id: 'bob', connected: true, party: [heroOf('Bard', { id: 'bob-hero' })] })
        },
        pendingAction: null
    };

    assert.equal(queueLightningLabrysPlayerChoice(state, 'alice', 2), true);
    assert.deepEqual(state.pendingAction, {
        type: 'LIGHTNING_LABRYS_PLAYER', playerToChoose: 'alice', originalActor: 'alice',
        remainingChoices: 2, allowSelf: true
    });
    assert.equal(queueLightningLabrysSacrifice(state, 'bob'), true);
    assert.deepEqual(state.pendingAction, {
        type: 'LIGHTNING_LABRYS_SACRIFICE', playerToChoose: 'bob', originalActor: 'alice',
        remainingChoices: 1
    });
});

test('Lightning Labrys consumes a choice without stalling when the selected player has no Hero', () => {
    const state = {
        state: 'WAITING_FOR_SKILL_TARGET',
        players: {
            alice: pl({ id: 'alice', connected: true }),
            bob: pl({ id: 'bob', connected: true })
        },
        pendingAction: {
            type: 'LIGHTNING_LABRYS_PLAYER', playerToChoose: 'alice', originalActor: 'alice',
            remainingChoices: 1, allowSelf: true
        }
    };

    assert.equal(queueLightningLabrysSacrifice(state, 'bob'), 'NO_HERO');
    assert.equal(state.state, 'PLAYING');
    assert.equal(state.pendingAction, null);
});

test('Dragon Wasp restoration returns the exact Hero and both original Item slots', () => {
    const hero = { id: 'hero', name: 'Hero', type: 'Hero Card', equippedItem: null, equippedItem2: null };
    const itemOne = { id: 'item-one', type: 'Item Card' };
    const itemTwo = { id: 'item-two', type: 'Cursed Item Card' };
    gameState.players = {
        owner: { id: 'owner', hand: [], party: [], slainMonsters: [] },
        thief: { id: 'thief', hand: [itemOne], party: [], slainMonsters: [] }
    };
    gameState.discardPile = [hero, itemTwo, { id: 'unrelated' }];

    assert.equal(restoreDragonWaspHero({
        playerId: 'owner', hero,
        removedItems: [
            { slot: 'equippedItem', card: itemOne },
            { slot: 'equippedItem2', card: itemTwo }
        ]
    }), true);
    assert.deepEqual(gameState.players.owner.party, [hero]);
    assert.equal(hero.equippedItem, itemOne);
    assert.equal(hero.equippedItem2, itemTwo);
    assert.deepEqual(gameState.players.thief.hand, []);
    assert.deepEqual(gameState.discardPile, [{ id: 'unrelated' }]);
});

test('Lumbering Demon completes one replacement before applying Quick Draw continuation', () => {
    const itemCard = { id: 'drawn-item', type: 'Item Card' };
    const otherCard = { id: 'drawn-other', type: 'Challenge Card' };
    gameState.players = {
        owner: { id: 'owner', hand: [itemCard, otherCard], party: [], slainMonsters: [] }
    };
    gameState.pendingDeferredDrawPassives = [];
    gameState.state = 'PLAYING';
    gameState.pendingAction = null;
    const sequence = {
        playerId: 'owner', remaining: 1, source: 'Quick Draw',
        drawnCardIds: [], drawnCards: [],
        continuation: { type: 'QUICK_DRAW', playerId: 'owner' }
    };

    completeLumberingDrawStep(sequence, [itemCard, otherCard]);
    assert.equal(sequence.remaining, 0);
    assert.deepEqual(sequence.drawnCardIds, ['drawn-item', 'drawn-other']);
    resolveLumberingContinuation(sequence);
    assert.equal(gameState.state, 'WAITING_FOR_HAND_SELECTION');
    assert.deepEqual(gameState.pendingAction.allowedCardIds, ['drawn-item']);
    assert.equal(gameState.pendingAction.optional, true);
});

test('Lumbering Demon preserves Pan Chucks Challenge detection across both replacement draws', () => {
    gameState.players = {
        owner: { id: 'owner', hand: [], party: [], slainMonsters: [] },
        target: { id: 'target', hand: [], party: [{ id: 'target-hero', type: 'Hero Card' }], slainMonsters: [] }
    };
    gameState.state = 'PLAYING';
    gameState.pendingAction = null;
    resolveLumberingContinuation({
        playerId: 'owner',
        drawnCards: [{ id: 'ordinary', type: 'Magic Card' }, { id: 'challenge', type: 'Challenge Card' }],
        continuation: { type: 'PAN_CHUCKS', playerId: 'owner' }
    });
    assert.equal(gameState.pendingAction.type, 'DESTROY');
    assert.equal(gameState.pendingAction.optional, true);
});

test('Monster play triggers queue one draw for Challenge, Magic, and Item cards', () => {
    const previousPlayers = gameState.players;
    const previousQueue = gameState.pendingPassiveDraws;
    gameState.players = {
        owner: pl({
            id: 'owner',
            slainMonsters: [
                monster('MONSTER_POSSESSED_PLUSH'),
                monster('MONSTER_VOLTCLAW_LION'),
                monster('MONSTER_WICKED_SEA_SERPENT')
            ]
        })
    };
    gameState.pendingPassiveDraws = [];
    triggerPlayedCardMonsterPassives('owner', { id: 'challenge', type: 'Challenge Card' });
    triggerPlayedCardMonsterPassives('owner', { id: 'magic', type: 'Magic Card' });
    triggerPlayedCardMonsterPassives('owner', { id: 'curse', type: 'Cursed Item Card' });
    assert.deepEqual(gameState.pendingPassiveDraws.map(entry => entry.source), [
        'Possessed Plush', 'Voltclaw Lion', 'Wicked Sea Serpent'
    ]);
    gameState.players = previousPlayers;
    gameState.pendingPassiveDraws = previousQueue;
});

test('Monster attack costs accept the exact printed discard categories', () => {
    assert.equal(attackCostAllowedTypes({ discard: 'ANY', count: 2 }), null);
    assert.deepEqual(attackCostAllowedTypes({ discard: 'Challenge Card', count: 1 }), ['Challenge Card']);
    assert.deepEqual(attackCostAllowedTypes({ discard: 'Magic Card', count: 1 }), ['Magic Card']);
    assert.deepEqual(attackCostAllowedTypes({ discard: 'Item Card', count: 1, include_cursed: true }), [
        'Item Card', 'Cursed Item Card'
    ]);
});

test('Voltclaw Lion requires a Magic card for normal and free attacks', () => {
    const voltclaw = { attack_cost: { discard: 'Magic Card', count: 1 } };
    assert.equal(canPayMonsterAttackCost({ hand: [] }, voltclaw), false);
    assert.equal(canPayMonsterAttackCost({ hand: [{ type: 'Modifier Card' }] }, voltclaw), false);
    assert.equal(canPayMonsterAttackCost({ hand: [{ type: 'Magic Card' }] }, voltclaw), true);
});

test('empty-hand end-turn Monster effects are queued in deterministic order', () => {
    const player = pl({
        hand: [],
        slainMonsters: [
            monster('MONSTER_SCAVENGER_GRIFFIN'),
            monster('MONSTER_GORETELODONT'),
            monster('MONSTER_CLAWED_NIGHTMARE')
        ]
    });
    assert.deepEqual(eligibleEndTurnMonsterEffects(player), [
        'CLAWED_NIGHTMARE_PULL', 'GORETELODONT_DRAW', 'SCAVENGER_GRIFFIN_STEAL'
    ]);
    player.hand.push({ id: 'card' });
    assert.deepEqual(eligibleEndTurnMonsterEffects(player), []);
});

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
    assert.equal(playerHasEffectiveClass(pl({ leader: leader('LEADER_NECROMANCER', 'Necromancer') }), 'Necromancer'), true);
    assert.equal(playerHasEffectiveClass(pl({ party: [heroOf('Bard', { equippedItem: { ...item('ITEM_MASK', 'Berserker Mask'), class: 'Berserker' } })] }), 'Berserker'), true);
});

test('challenge quorum ignores opponents who are temporarily disconnected', () => {
    const state = {
        players: {
            demi: { connected: true },
            observer: { connected: true },
            jimi: { connected: false },
        },
        pendingChallenge: {
            rollerId: 'demi',
            card: { id: 'slippery-paws', name: 'Slippery Paws' },
            passedPlayers: ['observer'],
        },
    };

    assert.deepEqual(getConnectedChallengeOpponentIds(state, ['demi', 'observer']), ['observer']);
    assert.equal(haveAllConnectedChallengeOpponentsPassed(state, ['demi', 'observer']), true);
});

test('challenge quorum keeps waiting for every connected opponent', () => {
    const state = {
        players: {
            demi: { connected: true },
            observer: { connected: true },
            jimi: { connected: true },
        },
        pendingChallenge: {
            rollerId: 'demi',
            card: { id: 'slippery-paws', name: 'Slippery Paws' },
            passedPlayers: ['observer'],
        },
    };

    assert.deepEqual(
        getConnectedChallengeOpponentIds(state, ['demi', 'observer', 'jimi']),
        ['observer', 'jimi']
    );
    assert.equal(haveAllConnectedChallengeOpponentsPassed(state, ['demi', 'observer', 'jimi']), false);
    state.pendingChallenge.passedPlayers.push('jimi');
    assert.equal(haveAllConnectedChallengeOpponentsPassed(state, ['demi', 'observer', 'jimi']), true);
    assert.equal(CHALLENGE_TIMEOUT_MS, 15_000);
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

test('Druid skills use low-roll requirements while Warrior skills use high-roll requirements', () => {
    assert.equal(isHeroSkillRollSuccessful({ rollType: 'LOW_ROLL', roll_requirement: 7 }, 6), true);
    assert.equal(isHeroSkillRollSuccessful({ rollType: 'LOW_ROLL', roll_requirement: 7 }, 8), false);
    assert.equal(isHeroSkillRollSuccessful({ rollType: 'HIGH_ROLL', roll_requirement: 7 }, 8), true);
    assert.equal(isHeroSkillRollSuccessful({ rollType: 'HIGH_ROLL', roll_requirement: 7 }, 6), false);
});

test('Critical Fang affects attacks only and Majestelk affects every roll until next turn', () => {
    const player = pl({ attackRollBonus: 4, untilNextTurnRollBonus: -5 });
    assert.equal(calculateRollDetails(player, 8, 'ATTACK').total, 7);
    assert.equal(calculateRollDetails(player, 8, 'HERO_SKILL').total, 3);
    clearUntilNextTurnProtections(player);
    assert.equal(player.untilNextTurnRollBonus, 0);
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

test('new slain monsters apply their printed attack bonuses only to attacks', () => {
    const p = pl({
        slainMonsters: [
            monster('MONSTER_ANCIENT_MEGASHARK', 'Ancient Megashark'),
            monster('MONSTER_REPTILIAN_RIPPER', 'Reptilian Ripper')
        ]
    });
    const attack = calculateRollDetails(p, 6, 'ATTACK');
    assert.equal(attack.total, 9);
    assert.deepEqual(attack.breakdown.slice(-2), [
        { source: 'Ancient Megashark', value: 1 },
        { source: 'Reptilian Ripper', value: 2 }
    ]);
    assert.equal(calculateRollDetails(p, 6, 'HERO_SKILL').total, 6);
});

test('Saffyre Phoenix and Wandering Behemoth add bonuses for additional Heroes', () => {
    const p = pl({ party: [heroOf('Fighter'), heroOf('Bard'), heroOf('Wizard')] });
    const phoenix = { name: 'Saffyre Phoenix', attack_bonus_per_additional_hero: 2 };
    const behemoth = { name: 'Wandering Behemoth', attack_bonus_per_additional_hero: 1 };
    assert.equal(calculateRollDetails(p, 4, 'ATTACK', phoenix).total, 8);
    assert.equal(calculateRollDetails(p, 4, 'ATTACK', behemoth).total, 6);
    assert.equal(calculateRollDetails(p, 4, 'HERO_SKILL', phoenix).total, 4);
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

test('Even Bigger Ring adds +4 to its equipped Hero skill roll', () => {
    setBoard([{
        party: [heroOf('Fighter', {
            id: 'ring-hero',
            equippedItem: { effect_id: 'ITEM_EVEN_BIGGER_RING', name: 'Even Bigger Ring' },
        })],
    }]);
    const hero = gameState.players.p0.party[0];
    const result = calculateRollDetails(gameState.players.p0, 7, 'HERO_SKILL', hero);
    assert.equal(result.total, 11);
    assert.deepEqual(result.breakdown.at(-1), { source: 'Even Bigger Ring', value: 4 });
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

test('slaying 3 monsters does not win', () => {
    setBoard([{ slainMonsters: [monster('M1'), monster('M2'), monster('M3')] }]);
    assert.equal(checkWinCondition(), null);
});

test('slaying 4 monsters wins', () => {
    setBoard([{ slainMonsters: [monster('M1'), monster('M2'), monster('M3'), monster('M4')] }]);
    const res = checkWinCondition();
    assert.equal(res.winnerId, 'p0');
    assert.match(res.reason, /4 monsters/);
});

test('Venomous Gemini counts as two slain Monsters', () => {
    setBoard([{ slainMonsters: [
        { ...monster('MONSTER_VENOMOUS_GEMINI'), slain_value: 2 },
        monster('M2'),
        monster('M3')
    ] }]);
    const res = checkWinCondition();
    assert.equal(res.winnerId, 'p0');
    assert.match(res.reason, /4 monsters/);
});

test('assembling 9 different classes (leader + party) wins with expansion Heroes live', () => {
    setBoard([{
        leader: leader('LEADER_WIZARD', 'Wizard'),
        party: [
            heroOf('Fighter'), heroOf('Bard'), heroOf('Guardian'),
            heroOf('Ranger'), heroOf('Thief'), heroOf('Druid'),
            heroOf('Warrior'), heroOf('Sorcerer'),
        ],
    }]);
    const res = checkWinCondition();
    assert.equal(res.winnerId, 'p0');
    assert.match(res.reason, /9 classes/);
});

test('duplicate classes do NOT count toward the 9-class win', () => {
    setBoard([{
        leader: leader('LEADER_FIGHTER', 'Fighter'),
        party: [heroOf('Fighter'), heroOf('Fighter'), heroOf('Bard'), heroOf('Thief'), heroOf('Ranger')],
    }]);
    // Distinct classes: Fighter, Bard, Thief, Ranger = 4 < 9
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

test('a Mask can complete the 9-class win by changing a duplicate class', () => {
    // Leader Fighter + seven other classes + a second Fighter wearing a
    // Sorcerer Mask -> the masked hero counts as Sorcerer -> 9 classes.
    setBoard([{
        leader: leader('LEADER_FIGHTER', 'Fighter'),
        party: [
            heroOf('Bard'), heroOf('Guardian'), heroOf('Ranger'), heroOf('Thief'), heroOf('Druid'),
            heroOf('Wizard'), heroOf('Warrior'),
            heroOf('Fighter', { equippedItem: { ...item('ITEM_MASK', 'Sorcerer Mask'), class: 'Sorcerer' } }),
        ],
    }]);
    const res = checkWinCondition();
    assert.equal(res && res.winnerId, 'p0');
    assert.match(res.reason, /9 classes/);
});

test('only expansion cards with full card art enter live decks', () => {
    loadCards();
    const liveCards = [
        ...gameState.availableLeaders,
        ...gameState.monsterDeck,
        ...gameState.mainDeck,
    ];
    const liveExpansionCards = liveCards.filter(card => card.expansion === 'Warrior & Druid');

    assert.equal(liveExpansionCards.length, 35);
    assert.ok(liveExpansionCards.every(card => card.fullCardArtUrl));
    assert.deepEqual(
        [...new Set(liveExpansionCards.map(card => card.type))].sort(),
        ['Challenge Card', 'Cursed Item Card', 'Hero Card', 'Item Card', 'Magic Card', 'Modifier Card', 'Monster Card', 'Party Leader']
    );
    assert.deepEqual(
        liveExpansionCards
            .filter(card => card.type === 'Magic Card')
            .map(card => card.name)
            .sort(),
        ['Beast Call', 'Rapid Refresh']
    );
    assert.equal(liveExpansionCards.filter(card => card.type === 'Hero Card').length, 16);
    assert.ok(liveExpansionCards.filter(card => card.type === 'Hero Card').every(card => card.fullCardArtUrl));
    assert.deepEqual(
        liveExpansionCards
            .filter(card => ['Item Card', 'Cursed Item Card'].includes(card.type))
            .map(card => card.name)
            .sort(),
        ['Bottomless Bag', 'Cursed Glove', 'Druid Mask', 'Even Bigger Ring', 'Soul Tether', 'Temporal Hourglass', 'Warrior Mask']
    );
    assert.deepEqual(
        liveExpansionCards.filter(card => card.type === 'Challenge Card').map(card => card.name).sort(),
        ['Druid Challenge', 'Warrior Challenge']
    );
});
