const fs = require('fs');

// 1. Patch server.js
let server = fs.readFileSync('server.js', 'utf8');

server = server.replace(
    /if \(\['SKILL_TARGET_HERO', 'SKILL_TARGET_PLAYER', 'SKILL_TARGET_SELF_ITEM', 'SKILL_TARGET_MULTI'\]\.includes\(next\.type\)\) \{\n\s*gameState\.state = 'WAITING_FOR_SKILL_TARGET';\n\s*\}/,
    "if (['SKILL_TARGET_HERO', 'SKILL_TARGET_PLAYER', 'SKILL_TARGET_SELF_ITEM', 'SKILL_TARGET_MULTI'].includes(next.type)) {\n                                gameState.state = 'WAITING_FOR_SKILL_TARGET';\n                            } else if (['STEAL', 'DESTROY', 'EXCHANGE_STEP_1'].includes(next.type)) {\n                                gameState.state = 'PLAYING';\n                            }"
);

fs.writeFileSync('server.js', server);
console.log('Patched server.js');

// 2. Patch skill_engine.js
let skill = fs.readFileSync('skill_engine.js', 'utf8');

const oldDestructive = `case 'MAGIC_DESTRUCTIVE':
            if (player.hand.length > 0) {
                gameState.pendingAction = {
                    type: 'DISCARD',
                    playerToChoose: playerId,
                    amount: 1,
                    originalActor: playerId
                };
            }
            if (targetData && targetData.targetPlayerId && targetData.targetHeroId) {
                const tp = gameState.players[targetData.targetPlayerId];
                const targetHasTerratuga = tp && tp.slainMonsters && tp.slainMonsters.some(m => m.effect_id === 'MONSTER_TERRATUGA');
                if (targetHasTerratuga) {
                    actionMessage = \`\${player.id.substring(0, 4)} discarded a card but \${tp.id.substring(0, 4)}'s Hero is protected by Terratuga!\`;
                } else if (tp && !tp.cannotBeDestroyed) {
                    const tHeroIndex = tp.party.findIndex(h => h.id === targetData.targetHeroId);
                    if (tHeroIndex !== -1) {
                        let destroyMsg = resolveDestroyAction(gameState, playerId, targetData.targetPlayerId, targetData.targetHeroId);
                        actionMessage = \`\${player.id.substring(0, 4)} discarded a card and \${destroyMsg}\`;
                    }
                } else {
                    actionMessage = \`\${player.id.substring(0, 4)} discarded a card but the Hero could not be destroyed.\`;
                }
            } else {
                actionMessage = \`\${player.id.substring(0, 4)} discarded a card.\`;
            }
            break;`;

const newDestructive = `case 'MAGIC_DESTRUCTIVE':
            if (player.hand.length > 0) {
                gameState.pendingAction = {
                    type: 'DISCARD',
                    playerToChoose: playerId,
                    amount: 1,
                    originalActor: playerId,
                    nextAction: {
                        type: 'DESTROY',
                        originalActor: playerId
                    }
                };
                actionMessage = \`\${player.id.substring(0, 4)} cast Destructive Spell! Waiting for them to discard 1 card.\`;
            } else {
                gameState.pendingAction = {
                    type: 'DESTROY',
                    originalActor: playerId
                };
                actionMessage = \`\${player.id.substring(0, 4)} cast Destructive Spell with an empty hand! Waiting to select a Hero to destroy.\`;
            }
            break;`;

skill = skill.replace(oldDestructive, newDestructive);
fs.writeFileSync('skill_engine.js', skill);
console.log('Patched skill_engine.js');

// 3. Patch public/app.js
let app = fs.readFileSync('public/app.js', 'utf8');

app = app.replace(
    /const TARGETING_SKILLS = \['DESTROY_HERO', 'STEAL_HERO', 'MAGIC_DESTRUCTIVE', 'SKILL_MEOWZIO', 'SKILL_SHURIKITTY', 'SKILL_TIPSY_TOOTIE'\];/,
    "const TARGETING_SKILLS = ['DESTROY_HERO', 'STEAL_HERO', 'SKILL_MEOWZIO', 'SKILL_SHURIKITTY', 'SKILL_TIPSY_TOOTIE'];"
);

fs.writeFileSync('public/app.js', app);
console.log('Patched public/app.js');
