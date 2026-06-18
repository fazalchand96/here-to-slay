const fs = require('fs');
const path = require('path');

const counts = {
  "The Charismatic Song": 1,
  "The Cloaked Sage": 1,
  "The Divine Arrow": 1,
  "The Fist of Reason": 1,
  "The Protecting Horn": 1,
  "The Shadow Claw": 1,
  "Anuran Cauldron": 1,
  "Artic Aries": 1,
  "Bloodwing": 1,
  "Orthus": 1,
  "Corrupted Sabretooth": 1,
  "Crowned Serpent": 1,
  "Abyss Queen": 1,
  "Dracos": 1,
  "Dark Dragon King": 1,
  "Malamammoth": 1,
  "Rex Major": 1,
  "Terratuga": 1,
  "Mega Slime": 1,
  "Titan Wyvern": 1,
  "Warworn Owlbear": 1,
  "Dodgy Dealer": 1,
  "Fuzzy Cheeks": 1,
  "Greedy Cheeks": 1,
  "Lucky Bucky": 1,
  "Mellow Dee": 1,
  "Napping Nibbles": 1,
  "Peanut": 1,
  "Tipsy Tootie": 1,
  "Bad Axe": 1,
  "Bear Claw": 1,
  "Beary Wise": 1,
  "Fury Knuckle": 1,
  "Heavy Bear": 1,
  "Pan Chucks": 1,
  "Qi Bear": 1,
  "Tough Teddy": 1,
  "Calming Voice": 1,
  "Guiding Light": 1,
  "Holy Curselifter": 1,
  "Iron Resolve": 1,
  "Mighty Blade": 1,
  "Radiant Horn": 1,
  "Vibrant Glow": 1,
  "Wise Shield": 1,
  "Bullseye": 1,
  "Hook": 1,
  "Lookie Rookie": 1,
  "Quick Draw": 1,
  "Serious Grey": 1,
  "Sharp Fox": 1,
  "Wildshot": 1,
  "Wily Red": 1,
  "Kit Napper": 1,
  "Meowzio": 1,
  "Plundering Puma": 1,
  "Shurikitty": 1,
  "Silent Shadow": 1,
  "Slippery Paws": 1,
  "Sly Pickings": 1,
  "Smooth Mimimeow": 1,
  "Bun Bun": 1,
  "Buttons": 1,
  "Fluffy": 1,
  "Hopper": 1,
  "Snowball": 1,
  "Spooky": 1,
  "Whiskers": 1,
  "Wiggles": 1,
  "Bard Mask": 1,
  "Decoy Doll": 1,
  "Fighter Mask": 1,
  "Guardian Mask": 1,
  "Particularly Rusty Coin": 2,
  "Ranger Mask": 1,
  "Really Big Ring": 2,
  "Thief Mask": 1,
  "Wizard Mask": 1,
  "Curse of the Snake's Eyes": 2,
  "Sealing Key": 1,
  "Suspiciously Shiny Coin": 1,
  "Modifier +1/-3": 4,
  "Modifier +2/-2": 9,
  "Modifier +3/-1": 4,
  "Modifier +4": 4,
  "Modifier -4": 4,
  "Call to the Fallen": 1,
  "Critical Boost": 2,
  "Destructive Spell": 2,
  "Enchanted Spell": 2,
  "Entangling Trap": 2,
  "Forced Exchange": 1,
  "Forceful Winds": 1,
  "Winds of Change": 2,
  "Challenge": 14
};

const PARTY_LEADERS = [
    { name: 'The Charismatic Song', type: 'Party Leader', class: 'Bard', effect: 'No effect', imageUrl: 'https://www.unstablegameswiki.com/images/thumb/9/98/HtS-Base-004-2E.png/200px-HtS-Base-004-2E.png' },
    { name: 'The Fist of Reason', type: 'Party Leader', class: 'Fighter', effect: 'No effect', imageUrl: 'https://www.unstablegameswiki.com/images/thumb/6/67/HtS-Base-007-2E.png/200px-HtS-Base-007-2E.png' },
    { name: 'The Protecting Horn', type: 'Party Leader', class: 'Guardian', effect: 'No effect', imageUrl: 'https://www.unstablegameswiki.com/images/thumb/f/f3/HtS-Base-008-2E.png/200px-HtS-Base-008-2E.png' },
    { name: 'The Divine Arrow', type: 'Party Leader', class: 'Ranger', effect: 'No effect', imageUrl: 'https://www.unstablegameswiki.com/images/thumb/6/69/HtS-Base-005-2E.png/200px-HtS-Base-005-2E.png' },
    { name: 'The Shadow Claw', type: 'Party Leader', class: 'Thief', effect: 'No effect', imageUrl: 'https://www.unstablegameswiki.com/images/thumb/7/79/HtS-Base-009-2E.png/200px-HtS-Base-009-2E.png' },
    { name: 'The Cloaked Sage', type: 'Party Leader', class: 'Wizard', effect: 'No effect', imageUrl: 'https://www.unstablegameswiki.com/images/thumb/9/98/HtS-Base-006-2E.png/200px-HtS-Base-006-2E.png' }
];

const cardsJsonPath = path.join(__dirname, 'cards.json');
const rawData = fs.readFileSync(cardsJsonPath, 'utf-8');
const originalCards = JSON.parse(rawData);

const combinedData = [...originalCards];

// Add party leaders if not present
PARTY_LEADERS.forEach(leader => {
    if (!combinedData.find(c => c.name === leader.name)) {
        combinedData.push(leader);
    }
});

let finalDeck = [];
let idCounter = 1;

combinedData.forEach(card => {
    let cardCount = counts[card.name];
    if (cardCount === undefined) {
        // Fallback or exact match check
        console.warn(`Warning: Count for ${card.name} not found in inventory list. Assuming 1.`);
        cardCount = 1;
    }

    for (let i = 0; i < cardCount; i++) {
        // Deep copy
        let duplicate = JSON.parse(JSON.stringify(card));
        
        // Remove any old id
        delete duplicate.id;

        // Assign standardized types
        if (duplicate.type === 'Unknown' && duplicate.name.startsWith('Modifier')) {
            duplicate.type = 'Modifier Card';
        } else if (duplicate.type === 'Unknown' && duplicate.name.includes('Challenge')) {
            duplicate.type = 'Challenge Card';
        } else if (duplicate.type === 'Unknown') {
            duplicate.type = 'Rule Card';
        }

        // Add correct slay/penalty rolls to monsters
        if (duplicate.type === 'Monster Card') {
            // we don't have the explicit values scraped easily, but previous server.js set it to 7/4 globally for testing. Let's keep it in the JSON for consistency with previous server logic.
            if (!duplicate.slayRoll) duplicate.slayRoll = 7;
            if (!duplicate.penaltyRoll) duplicate.penaltyRoll = 4;
        }

        // Add padded id
        duplicate.id = `card_${String(idCounter).padStart(3, '0')}`;
        
        finalDeck.push(duplicate);
        idCounter++;
    }
});

fs.writeFileSync(cardsJsonPath, JSON.stringify(finalDeck, null, 2), 'utf-8');
console.log(`Successfully generated cards.json with ${finalDeck.length} total cards.`);
