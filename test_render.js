const fs = require('fs');

const appJs = fs.readFileSync('public/app.js', 'utf8');

// Extract renderCard
const renderCardMatch = appJs.match(/function renderCard[\s\S]*?^}/m);
if (!renderCardMatch) throw new Error('renderCard not found');

// Eval renderCard (with some mocks)
const isTargetMode = false;
const myTargetMode = false;
const currentPendingAction = null;
const isSkillTargeting = false;
const isMultiTargeting = false;
const isSelfItemTargeting = false;
const isLocalTargeting = false;
const latestGameState = { state: 'PLAYING', players: { '1': {} } };
const myId = '1';
const meetsMonsterRequirements = () => true;

// Expose these globally for the eval
global.isTargetMode = isTargetMode;
global.myTargetMode = myTargetMode;
global.currentPendingAction = currentPendingAction;
global.isSkillTargeting = isSkillTargeting;
global.isMultiTargeting = isMultiTargeting;
global.isSelfItemTargeting = isSelfItemTargeting;
global.isLocalTargeting = isLocalTargeting;
global.latestGameState = latestGameState;
global.myId = myId;
global.meetsMonsterRequirements = meetsMonsterRequirements;
global.window = { globalActiveHeroId: null };

eval(renderCardMatch[0]);

const cards = JSON.parse(fs.readFileSync('cards.json', 'utf8'));
const hand = cards.filter(c => c.type !== 'Party Leader' && c.type !== 'Monster Card' && c.type !== 'Unknown').slice(0, 5);

console.log(hand.map(c => renderCard(c, true, true, false, true)).join(''));
