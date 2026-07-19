const test = require('node:test');
const assert = require('node:assert/strict');
const cards = require('../cards.json');

const classExpansion = cards.filter(card => card.expansion === 'Berserkers & Necromancers');
const monsterExpansion = cards.filter(card => card.expansion === 'Monster Expansion');

test('Berserkers & Necromancers contains all 35 physical cards', () => {
    assert.equal(classExpansion.length, 35);
    assert.deepEqual(
        classExpansion.map(card => card.id),
        Array.from({ length: 35 }, (_, index) => `card_${173 + index}`)
    );
    assert.equal(classExpansion.filter(card => card.name === 'Lightning Labrys').length, 2);
    assert.equal(classExpansion.filter(card => card.name === 'Mass Sacrifice').length, 2);
    assert.equal(new Set(classExpansion.map(card => card.name)).size, 33);
});

test('Berserkers & Necromancers has the official card-type distribution', () => {
    const count = type => classExpansion.filter(card => card.type === type).length;
    assert.deepEqual({
        leaders: count('Party Leader'),
        monsters: count('Monster Card'),
        heroes: count('Hero Card'),
        items: count('Item Card'),
        cursedItems: count('Cursed Item Card'),
        modifiers: count('Modifier Card'),
        magic: count('Magic Card'),
        challenges: count('Challenge Card')
    }, {
        leaders: 2,
        monsters: 2,
        heroes: 16,
        items: 5,
        cursedItems: 2,
        modifiers: 2,
        magic: 4,
        challenges: 2
    });
});

test('the four printed Berserkers have two Item slots', () => {
    assert.deepEqual(
        classExpansion.filter(card => card.item_slots === 2).map(card => card.name).sort(),
        ['Gruesome Gladiator', 'Meowntain', 'Rabid Beast', 'Vicious Wildcat']
    );
});

test('class masks and class challenges declare their effective classes', () => {
    const byName = name => classExpansion.find(card => card.name === name);
    assert.equal(byName('Berserker Mask').class, 'Berserker');
    assert.equal(byName('Necromancer Mask').class, 'Necromancer');
    assert.equal(byName('Berserker Challenge').required_class, 'Berserker');
    assert.equal(byName('Necromancer Challenge').required_class, 'Necromancer');
    assert.equal(byName('Berserker Challenge').challenge_bonus, 3);
    assert.equal(byName('Necromancer Challenge').challenge_bonus, 3);
});

test('Monster Expansion contains all 13 unique physical monsters', () => {
    assert.equal(monsterExpansion.length, 13);
    assert.equal(new Set(monsterExpansion.map(card => card.name)).size, 13);
    assert.deepEqual(
        monsterExpansion.map(card => card.id),
        Array.from({ length: 13 }, (_, index) => `card_${208 + index}`)
    );
    assert.ok(monsterExpansion.every(card => card.type === 'Monster Card'));
    assert.ok(monsterExpansion.every(card => card.effect_id?.startsWith('MONSTER_')));
});

test('Monster discard requirements are distinct from failed-roll penalties', () => {
    const byName = name => cards.find(card => card.name === name);
    const doombringer = byName('Doombringer');
    assert.equal(doombringer.attack_cost, undefined);
    assert.equal(doombringer.penaltyAction, 'DISCARD_HAND');

    const requiredDiscards = {
        'Ancient Megashark': ['ANY', 1],
        'Dragon Wasp': ['ANY', 2],
        'Possessed Plush': ['Challenge Card', 1],
        'Voltclaw Lion': ['Magic Card', 1],
        'Wicked Sea Serpent': ['Item Card', 1]
    };
    for (const [name, [discard, count]] of Object.entries(requiredDiscards)) {
        const monster = byName(name);
        assert.equal(monster.attack_cost.discard, discard);
        assert.equal(monster.attack_cost.count, count);
        assert.equal(monster.penaltyAction, 'SACRIFICE_HERO');
    }
});

test('all repository card IDs remain unique after both expansions', () => {
    assert.equal(new Set(cards.map(card => card.id)).size, cards.length);
});
