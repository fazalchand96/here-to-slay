const fs = require('fs');
let data = JSON.parse(fs.readFileSync('cards.json', 'utf8'));
let count = 0;
data.forEach(c => {
  if (c.effect_id === 'CURSE_SNAKE') {
    c.effect = "Each time you roll to use the equipped Hero card's effect, -2 to your roll.";
    c.description = "Each time you roll to use the equipped Hero card's effect, -2 to your roll.";
    count++;
  }
  if (c.effect_id === 'CURSE_COIN_SHINY') {
    c.effect = "If you successfully roll to use the equipped Hero card's effect, DISCARD a card.";
    c.description = "If you successfully roll to use the equipped Hero card's effect, DISCARD a card.";
    count++;
  }
});
fs.writeFileSync('cards.json', JSON.stringify(data, null, 2));
console.log('Updated ' + count + ' cards.');
