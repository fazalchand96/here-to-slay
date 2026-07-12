// Emit the list of cards that actually need an illustration generated.
//
// One representative per (type, name) group — duplicates (14x "Challenge",
// 9x "Modifier +2/-2", ...) are filled afterwards by scripts/dedupe-art.js, so
// the image model never generates the same subject twice.
//
//   node scripts/art-todo.js            # write scripts/art-todo.txt
//   node scripts/art-todo.js --count    # just print how many remain

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ART = path.join(ROOT, 'public', 'assets', 'skin', 'cards', 'art');
const OUT = path.join(__dirname, 'art-todo.txt');

const CLASS_ANIMAL = {
  Fighter: 'bear', Bard: 'squirrel', Guardian: 'unicorn',
  Ranger: 'fox', Thief: 'cat', Wizard: 'rabbit',
};

const cards = require(path.join(ROOT, 'cards.json'));
const has = (id) => fs.existsSync(path.join(ART, `${id}.png`));

const groups = new Map();
for (const c of cards) {
  if (!c.id || c.type === 'Rule Card' || c.type === 'Unknown') continue;
  const k = `${c.type} ${c.name}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(c);
}

const todo = [];
for (const [, group] of groups) {
  if (group.some((c) => has(c.id))) continue;      // group already covered
  const rep = group[0];
  const animal = CLASS_ANIMAL[rep.class];
  const animalNote = animal ? `  ANIMAL=${animal}` : '';
  const cls = rep.class ? `  class=${rep.class}` : '';
  todo.push(`${rep.id} | ${rep.type}${cls}${animalNote} | ${rep.name} | ${(rep.effect || '').replace(/\s+/g, ' ').slice(0, 120)}`);
}

if (process.argv.includes('--count')) {
  console.log(todo.length);
} else {
  fs.writeFileSync(OUT, todo.join('\n') + '\n');
  console.log(`${todo.length} unique subject(s) still need art -> ${path.relative(ROOT, OUT)}`);
}
