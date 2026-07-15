const test = require('node:test');
const assert = require('node:assert/strict');
const cards = require('../cards.json');

const expansionCards = cards.filter(card => card.expansion === 'Warrior & Druid');

test('Warrior & Druid expansion contains all 35 physical cards with unique IDs', () => {
    assert.equal(expansionCards.length, 35);
    assert.equal(new Set(cards.map(card => card.id)).size, cards.length);
    assert.deepEqual(
        expansionCards.map(card => card.id),
        Array.from({ length: 35 }, (_, index) => `card_${138 + index}`)
    );
});

test('Warrior & Druid expansion has the expected card-type distribution', () => {
    const counts = Object.fromEntries(
        [...new Set(expansionCards.map(card => card.type))]
            .map(type => [type, expansionCards.filter(card => card.type === type).length])
    );
    assert.deepEqual(counts, {
        'Monster Card': 2,
        'Hero Card': 16,
        'Item Card': 5,
        'Cursed Item Card': 2,
        'Modifier Card': 4,
        'Magic Card': 2,
        'Challenge Card': 2,
        'Party Leader': 2
    });
});

test('all Druid Heroes use low rolls and all Warrior Heroes use high rolls', () => {
    const druids = expansionCards.filter(card => card.type === 'Hero Card' && card.class === 'Druid');
    const warriors = expansionCards.filter(card => card.type === 'Hero Card' && card.class === 'Warrior');
    assert.equal(druids.length, 8);
    assert.equal(warriors.length, 8);
    assert.ok(druids.every(card => card.rollType === 'LOW_ROLL' && card.requirement.endsWith('-')));
    assert.ok(warriors.every(card => card.rollType === 'HIGH_ROLL' && card.requirement.endsWith('+')));
});

test('only the four printed double-slot Warriors have two Item slots', () => {
    const doubleSlotNames = expansionCards
        .filter(card => card.item_slots === 2)
        .map(card => card.name)
        .sort();
    assert.deepEqual(doubleSlotNames, [
        'Agile Dagger',
        'Critical Fang',
        'Looting Lupo',
        'Tenacious Timber'
    ]);
});

test('expansion names and behavior IDs are present before art generation', () => {
    for (const card of expansionCards) {
        assert.ok(card.name);
        assert.ok(card.effect);
        assert.ok(card.effect_id || card.skill_id);
        assert.equal(card.imageUrl, '');
    }
});
