const fs = require('fs');

const cardsJsonPath = 'cards.json';
const cards = JSON.parse(fs.readFileSync(cardsJsonPath, 'utf8'));

const patchData = {
    // Magic Cards
    "Call to the Fallen": { description: "Search the discard pile for a Hero card and add it to your hand.", effect_id: "MAGIC_CALL_FALLEN" },
    "Critical Boost": { description: "Draw 3 cards. Discard 1 card.", effect_id: "MAGIC_CRIT_BOOST" },
    "Destructive Spell": { description: "DISCARD a card, then DESTROY a Hero card.", effect_id: "MAGIC_DESTRUCTIVE" },
    "Enchanted Spell": { description: "+2 to all of your rolls until the end of your turn.", effect_id: "MAGIC_ENCHANTED" },
    "Entangling Trap": { description: "DISCARD 2 cards, then STEAL a Hero card.", effect_id: "MAGIC_ENTANGLING" },
    "Forced Exchange": { description: "Choose a Hero card in another player's party. STEAL that Hero card and move a Hero card from your party to that player's party.", effect_id: "MAGIC_EXCHANGE" },
    "Forceful Winds": { description: "Return every equipped Item card to its respective player's hand.", effect_id: "MAGIC_WINDS_FORCE" },
    "Winds of Change": { description: "Return an Item card equipped to a Hero card to your hand, then DRAW a card.", effect_id: "MAGIC_WINDS_CHANGE" },

    // Items & Cursed Items
    "Bard Mask": { description: "Equipped Hero card is considered that class instead of its original class.", effect_id: "ITEM_MASK" },
    "Fighter Mask": { description: "Equipped Hero card is considered that class instead of its original class.", effect_id: "ITEM_MASK" },
    "Guardian Mask": { description: "Equipped Hero card is considered that class instead of its original class.", effect_id: "ITEM_MASK" },
    "Ranger Mask": { description: "Equipped Hero card is considered that class instead of its original class.", effect_id: "ITEM_MASK" },
    "Thief Mask": { description: "Equipped Hero card is considered that class instead of its original class.", effect_id: "ITEM_MASK" },
    "Wizard Mask": { description: "Equipped Hero card is considered that class instead of its original class.", effect_id: "ITEM_MASK" },
    "Decoy Doll": { description: "If this Hero card would be destroyed or stolen, you may DESTROY Decoy Doll instead.", effect_id: "ITEM_DECOY" },
    "Particularly Rusty Coin": { description: "+1 to all of your rolls.", effect_id: "ITEM_COIN_RUSTY" },
    "Really Big Ring": { description: "+2 to all of your rolls.", effect_id: "ITEM_RING" },
    "Curse of the Snake's Eyes": { description: "Each time you roll to use the equipped Hero card's effect, -2 to your roll.", effect_id: "CURSE_SNAKE" },
    "Sealing Key": { description: "Equipped Hero card cannot use its effect.", effect_id: "CURSE_KEY" },
    "Suspiciously Shiny Coin": { description: "If you successfully roll to use the equipped Hero card's effect, DISCARD a card.", effect_id: "CURSE_COIN_SHINY" },

    // Modifiers
    "Modifier +1/-3": { description: "+1 or -3 to that roll.", effect_id: "MOD_1_3", modifier_values: [1, -3] },
    "Modifier +2/-2": { description: "+2 or -2 to that roll.", effect_id: "MOD_2_2", modifier_values: [2, -2] },
    "Modifier +3/-1": { description: "+3 or -1 to that roll.", effect_id: "MOD_3_1", modifier_values: [3, -1] },
    "Modifier +4": { description: "+4 to that roll.", effect_id: "MOD_4", modifier_values: [4] },
    "Modifier -4": { description: "-4 to that roll.", effect_id: "MOD_MINUS_4", modifier_values: [-4] }
};

let patchedCount = 0;

for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (patchData[card.name]) {
        const patch = patchData[card.name];
        card.description = patch.description;
        card.effect = patch.description;
        card.effect_id = patch.effect_id;
        if (patch.modifier_values) {
            card.modifier_values = patch.modifier_values;
        }
        patchedCount++;
    }
}

fs.writeFileSync(cardsJsonPath, JSON.stringify(cards, null, 2));
console.log(`Successfully patched ${patchedCount} cards in cards.json!`);
