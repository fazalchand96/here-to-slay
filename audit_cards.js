const fs = require('fs');
const path = require('path');

const cardsPath = path.join(__dirname, 'cards.json');
const cards = JSON.parse(fs.readFileSync(cardsPath, 'utf8'));

// Classification mappings based on name substrings
const getClass = (name) => {
    const lower = name.toLowerCase();
    
    const fighters = ['axe', 'bear', 'chucks', 'teddy', 'knuckle'];
    const bards = ['cheeks', 'dee', 'nibbles', 'tootie', 'peanut', 'dealer', 'bucky'];
    const guardians = ['voice', 'light', 'curselifter', 'resolve', 'blade', 'horn', 'glow', 'shield'];
    const rangers = ['eye', 'hook', 'rookie', 'draw', 'grey', 'fox', 'wildshot', 'red', 'bullseye'];
    const thieves = ['napper', 'meowzio', 'puma', 'shurikitty', 'shadow', 'paws', 'pickings', 'mimimeow'];
    const wizards = ['bun', 'buttons', 'fluffy', 'hopper', 'snowball', 'spooky', 'whiskers', 'wiggles'];

    if (fighters.some(f => lower.includes(f))) return 'Fighter';
    if (bards.some(b => lower.includes(b))) return 'Bard';
    if (guardians.some(g => lower.includes(g))) return 'Guardian';
    if (rangers.some(r => lower.includes(r))) return 'Ranger';
    if (thieves.some(t => lower.includes(t))) return 'Thief';
    if (wizards.some(w => lower.includes(w))) return 'Wizard';

    return 'UnknownClass';
};

const getSkillId = (effect, name) => {
    const e = effect.toLowerCase();
    if (e.includes('destroy a hero')) return 'DESTROY_HERO';
    if (e.includes('trade hands')) return 'TRADE_HANDS';
    if (e.includes('draw a card and play')) return 'DRAW_AND_PLAY';
    if (e.includes('each other player must give you a card')) return 'STEAL_FROM_ALL';
    if (e.includes('pull a card from another player')) return 'PULL_CARD';
    if (e.includes('draw 2 cards')) return 'DRAW_2_CARDS';
    if (e.includes('draw a card')) return 'DRAW_CARD';
    if (e.includes('discard a card')) return 'DISCARD_CARD';
    if (e.includes('steal a hero')) return 'STEAL_HERO';
    
    // Default fallback to unique ID
    return 'SKILL_' + name.toUpperCase().replace(/[^A-Z]/g, '_');
};

cards.forEach(card => {
    if (card.type === 'Hero Card') {
        // Assign Class
        card.class = getClass(card.name);

        // Assign Roll Requirement
        if (card.requirement && card.requirement !== 'None') {
            const numMatch = card.requirement.match(/(\d+)/);
            if (numMatch) {
                card.roll_requirement = parseInt(numMatch[1], 10);
            } else {
                card.roll_requirement = 0;
            }
        } else {
            card.roll_requirement = 0;
        }

        // Assign Skill ID
        card.skill_id = getSkillId(card.effect, card.name);
    }
});

fs.writeFileSync(cardsPath, JSON.stringify(cards, null, 2));
console.log('Successfully audited and updated cards.json');
