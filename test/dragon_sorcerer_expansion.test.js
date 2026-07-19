'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const cards = require('../cards.json');
const {
    executeSkill, executeMagic, drawCardsWithPassives, effectiveHeroClass
} = require('../skill_engine');
const { meetsMonsterRequirements, playerHasEffectiveClass } = require('../server');

let sequence = 0;
const card = (name, type, extra = {}) => ({ id: extra.id || `ds_${++sequence}`, name, type, ...extra });
const hero = (name, extra = {}) => card(name, 'Hero Card', {
    class: 'Sorcerer', equippedItem: null, equippedItem2: null, ...extra
});
const player = (id, extra = {}) => ({
    id, name: id, hand: [], party: [], slainMonsters: [], ap: 3,
    cannotBeStolen: false, cannotBeDestroyed: false, ...extra
});
const state = (players, extra = {}) => ({
    state: 'PLAYING', players: Object.fromEntries(players.map(entry => [entry.id, entry])),
    playerOrder: players.map(entry => entry.id), mainDeck: [], discardPile: [],
    pendingAction: null, pendingCard: null, pendingGlobalAction: null, ...extra
});
const io = () => {
    const events = [];
    return {
        events,
        emit: (event, payload) => events.push({ event, payload }),
        to: target => ({ emit: (event, payload) => events.push({ event, payload, target }) })
    };
};

test('Dragon Sorcerer contains all 16 official unique cards and card types', () => {
    const expansion = cards.filter(entry => entry.expansion === 'Dragon Sorcerer');
    assert.equal(expansion.length, 16);
    assert.equal(new Set(expansion.map(entry => entry.id)).size, 16);
    assert.deepEqual(
        Object.fromEntries([...new Set(expansion.map(entry => entry.type))].sort().map(type =>
            [type, expansion.filter(entry => entry.type === type).length])),
        {
            'Challenge Card': 1, 'Hero Card': 9, 'Item Card': 1, 'Magic Card': 1,
            'Modifier Card': 2, 'Monster Card': 1, 'Party Leader': 1
        }
    );
});

test('Dragon Sorcerer printed requirements, bonuses, and discard costs match the official deck', () => {
    const byName = name => cards.find(entry => entry.name === name);
    assert.equal(byName('The Fearless Flame').effect_id, 'LEADER_SORCERER');
    assert.equal(byName('The Fearless Flame').class, 'Sorcerer');

    const monster = byName('Calamity Mongrel');
    assert.equal(monster.requirement, '1 Sorcerer, 1 Hero');
    assert.equal(monster.penaltyRoll, 4);
    assert.equal(monster.slayRoll, 8);

    assert.deepEqual(byName('Modifier +6').modifier_values, [6]);
    assert.equal(byName('Modifier +6').discard_on_play, 1);
    assert.deepEqual(byName('Modifier -6').modifier_values, [-6]);
    assert.equal(byName('Modifier -6').discard_on_play, 1);

    const challenge = byName('Sorcerer Challenge');
    assert.equal(challenge.required_class, 'Sorcerer');
    assert.equal(challenge.challenge_bonus, 3);
});

test('Sorcerer requirements accept the leader and a Hero wearing Sorcerer Mask', () => {
    const leaderPlayer = player('leader', {
        leader: card('The Fearless Flame', 'Party Leader', { class: 'Sorcerer', effect_id: 'LEADER_SORCERER' }),
        party: [hero('Any Hero', { class: 'Fighter' })]
    });
    assert.equal(meetsMonsterRequirements(leaderPlayer, '1 Sorcerer, 1 Hero'), true);

    const mask = card('Sorcerer Mask', 'Item Card', { effect_id: 'ITEM_MASK', class: 'Sorcerer' });
    const maskedPlayer = player('masked', {
        party: [hero('Masked Fighter', { class: 'Fighter', equippedItem: mask })]
    });
    assert.equal(playerHasEffectiveClass(maskedPlayer, 'Sorcerer'), true);
    assert.equal(meetsMonsterRequirements(maskedPlayer, '1 Sorcerer, 1 Hero'), true);
});

test('all 16 Dragon Sorcerer runtime card frames are optimized portrait WebP assets', async () => {
    const directoryByType = {
        'Party Leader': 'leader-fullgen-v1',
        'Monster Card': 'monster-fullgen-v1',
        'Hero Card': 'hero-fullgen-v1',
        'Item Card': 'item-fullgen-v1',
        'Modifier Card': 'modifier-fullgen-v1',
        'Magic Card': 'magic-fullgen-v1',
        'Challenge Card': 'challenge-fullgen-v1'
    };
    const expansion = cards.filter(entry => entry.expansion === 'Dragon Sorcerer');
    for (const entry of expansion) {
        const file = path.join(__dirname, '..', 'public', 'assets', 'skin', 'cards', directoryByType[entry.type], `${entry.id}.webp`);
        assert.equal(fs.existsSync(file), true, `${entry.name} is missing its full card frame`);
        const metadata = await sharp(file).metadata();
        assert.equal(metadata.format, 'webp');
        assert.equal(metadata.width, 1024);
        assert.equal(metadata.height, 1536);
    }
});

test('Sorcerer Mask replaces the equipped Hero class', () => {
    const masked = hero('Masked', {
        class: 'Fighter', equippedItem2: card('Sorcerer Mask', 'Item Card', { effect_id: 'ITEM_MASK', class: 'Sorcerer' })
    });
    assert.equal(effectiveHeroClass(masked), 'Sorcerer');
});

test('Dragalter queues an exact Modifier choice', () => {
    const modifier = card('Modifier +2/-2', 'Modifier Card', { modifier_values: [2, -2] });
    const caster = player('a', { hand: [modifier], party: [hero('Dragalter', { id: 'drag' })] });
    const game = state([caster]);
    executeSkill(game, io(), 'SKILL_DRAGALTER', 'a', 'drag');
    assert.equal(game.state, 'WAITING_FOR_DRAGALTER_CHOICE');
    assert.deepEqual(game.pendingAction.allowedCardIds, [modifier.id]);
});

test('Dystortivern trades Party Leaders with the chosen opponent', () => {
    const a = player('a', { leader: card('Flame', 'Party Leader'), party: [hero('Dystortivern', { id: 'dys' })] });
    const b = player('b', { leader: card('Other', 'Party Leader') });
    const game = state([a, b]);
    executeSkill(game, io(), 'SKILL_DYSTORTIVERN', 'a', 'dys', { targetPlayerId: 'b' });
    assert.equal(a.leader.name, 'Other');
    assert.equal(b.leader.name, 'Flame');
});

test('Extraga returns every other effective Sorcerer and its Items', () => {
    const mask = card('Sorcerer Mask', 'Item Card', { effect_id: 'ITEM_MASK', class: 'Sorcerer' });
    const a = player('a', { party: [hero('Extraga', { id: 'extra' }), hero('Other Sorcerer', { id: 'own' })] });
    const b = player('b', { party: [hero('Masked Fighter', { id: 'masked', class: 'Fighter', equippedItem: mask })] });
    const game = state([a, b]);
    executeSkill(game, io(), 'SKILL_EXTRAGA', 'a', 'extra');
    assert.deepEqual(a.party.map(entry => entry.id), ['extra']);
    assert.equal(a.hand.some(entry => entry.id === 'own'), true);
    assert.equal(b.party.length, 0);
    assert.equal(b.hand.some(entry => entry.id === mask.id), true);
});

test('Luut offers regular equipped Items and a legal destination', () => {
    const ring = card('Ring', 'Item Card');
    const a = player('a', { party: [hero('Luut', { id: 'luut' })] });
    const b = player('b', { party: [hero('Target', { equippedItem: ring })] });
    const game = state([a, b]);
    executeSkill(game, io(), 'SKILL_LUUT', 'a', 'luut');
    assert.equal(game.state, 'WAITING_FOR_LUUT_CHOICE');
    assert.equal(game.pendingAction.availableItems[0].itemId, ring.id);
});

test('Mirroryu may choose an already-used other Hero but never itself', () => {
    const copy = hero('Copy Target', { id: 'copy', skill_id: 'DRAW_CARD', usedSkillThisTurn: true });
    const a = player('a', { party: [hero('Mirroryu', { id: 'mirror' }), copy] });
    const game = state([a]);
    executeSkill(game, io(), 'SKILL_MIRRORYU', 'a', 'mirror');
    assert.deepEqual(game.pendingAction.allowedHeroIds, ['copy']);
});

test('Oracon pulls a Modifier and makes its owner choose a Hero to sacrifice', () => {
    const a = player('a', { party: [hero('Oracon', { id: 'ora' })] });
    const b = player('b', { hand: [card('Modifier', 'Modifier Card')], party: [hero('Victim')] });
    const game = state([a, b]);
    executeSkill(game, io(), 'SKILL_ORACON', 'a', 'ora', { targetPlayerId: 'b' });
    assert.equal(a.hand[0].type, 'Modifier Card');
    assert.equal(game.pendingAction.type, 'ORACON_SACRIFICE');
    assert.equal(game.pendingAction.playerToChoose, 'b');
});

test('Renovern retrieves only a regular Item and queues that exact free play', () => {
    const item = card('Ring', 'Item Card');
    const a = player('a', { party: [hero('Renovern', { id: 'reno' })] });
    const game = state([a], { discardPile: [item] });
    executeSkill(game, io(), 'SKILL_RENOVERN', 'a', 'reno', { targetCardId: item.id });
    assert.equal(game.state, 'WAITING_FOR_HAND_SELECTION');
    assert.deepEqual(game.pendingAction.allowedCardIds, [item.id]);
});

test('Shamanaga brings the chosen Hero and queues its immediate free roll', () => {
    const fallen = hero('Fallen', { id: 'fallen', skill_id: 'DRAW_CARD', roll_requirement: 7 });
    const a = player('a', { party: [hero('Shamanaga', { id: 'sham' })] });
    const game = state([a], { discardPile: [fallen] });
    executeSkill(game, io(), 'SKILL_SHAMANAGA', 'a', 'sham', { targetCardId: fallen.id });
    assert.equal(game.state, 'WAITING_TO_ROLL');
    assert.equal(game.pendingRoll.targetHeroId, fallen.id);
    assert.equal(game.pendingShamanagaSacrifice.heroId, fallen.id);
});

test('Smok draws two one by one and offers only a newly drawn Magic to reveal', () => {
    const magic = card('Spell', 'Magic Card');
    const a = player('a', { party: [hero('Smok', { id: 'smok' })] });
    const game = state([a], { mainDeck: [magic, card('Other', 'Hero Card')] });
    executeSkill(game, io(), 'SKILL_SMOK', 'a', 'smok');
    assert.equal(a.hand.length, 2);
    assert.deepEqual(game.pendingSmokReveal.allowedCardIds, [magic.id]);
});

test('Egg of Fortune requires one discard before pulling from every opponent', () => {
    const a = player('a', { hand: [card('Cost', 'Hero Card')] });
    const game = state([a]);
    executeMagic(game, io(), 'MAGIC_EGG_OF_FORTUNE', 'a');
    assert.equal(game.state, 'WAITING_FOR_DISCARD_PENALTY');
    assert.equal(game.pendingAction.nextAction.type, 'EGG_OF_FORTUNE_PULLS');
});

test('Calamity Mongrel queues a private replacement choice for a drawn Challenge', () => {
    const challenge = card('Challenge', 'Challenge Card');
    const a = player('a', {
        slainMonsters: [card('Calamity Mongrel', 'Monster Card', { effect_id: 'MONSTER_CALAMITY_MONGREL' })]
    });
    const game = state([a], { mainDeck: [challenge], pendingMonsterTriggers: [] });
    drawCardsWithPassives(game, io(), 1, a);
    assert.equal(game.pendingMonsterTriggers[0].type, 'CALAMITY_MONGREL_REPLACE');
    assert.equal(game.pendingMonsterTriggers[0].cardId, challenge.id);
});
