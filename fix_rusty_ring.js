const fs = require('fs');
let data = JSON.parse(fs.readFileSync('cards.json', 'utf8'));
let count = 0;
data.forEach(c => {
  if (c.effect_id === 'ITEM_COIN_RUSTY') {
    c.effect = "If you unsuccessfully roll to use the equipped Hero card's effect, DRAW a card.";
    c.description = "If you unsuccessfully roll to use the equipped Hero card's effect, DRAW a card.";
    count++;
  }
  if (c.effect_id === 'ITEM_RING') {
    c.effect = "Each time you roll to use the equipped Hero card's effect, +2 to your roll.";
    c.description = "Each time you roll to use the equipped Hero card's effect, +2 to your roll.";
    count++;
  }
});
fs.writeFileSync('cards.json', JSON.stringify(data, null, 2));
console.log('Updated ' + count + ' cards.');
