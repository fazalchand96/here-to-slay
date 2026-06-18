const fs = require('fs');

// --- skill_engine.js ---
let skillEngine = fs.readFileSync('skill_engine.js', 'utf8');

// Insert new cases before 'DRAW_CARD'
const drawCardIndex = skillEngine.indexOf("case 'DRAW_CARD':");
const missingSkills = `
        case 'SKILL_WILDSHOT':
            drawCards(3, player);
            gameState.state = 'PLAYING';
            gameState.pendingAction = { type: 'DISCARD', playerToChoose: rollerId, amount: 1, originalActor: rollerId };
            actionMessage = \`\${player.id.substring(0, 4)} drew 3 cards and must discard 1!\`;
            break;
        case 'SKILL_GREEDY_CHEEKS':
            let greedyTargets = Object.keys(gameState.players).filter(pId => pId !== rollerId && gameState.players[pId].hand.length > 0);
            if (greedyTargets.length > 0) {
                gameState.state = 'WAITING_FOR_GLOBAL_ACTION';
                gameState.pendingGlobalAction = { type: 'MULTI_GIVE', initiatorId: rollerId, pendingPlayerIds: greedyTargets, submittedCards: [] };
                io.emit('global_action_requested', gameState.pendingGlobalAction);
                actionMessage = \`Greedy Cheeks forces opponents to give a card to \${player.id.substring(0, 4)}!\`;
            } else { actionMessage = \`Opponents have no cards!\`; }
            break;
        case 'SKILL_FUZZY_CHEEKS':
            drawCards(1, player);
            gameState.state = 'WAITING_FOR_HAND_SELECTION';
            gameState.pendingAction = { type: 'PLAY_FROM_HAND', allowedTypes: ['Hero Card'], playerToChoose: rollerId, originalActor: rollerId };
            actionMessage = \`\${player.id.substring(0, 4)} drew a card and may play a Hero!\`;
            break;
        case 'SKILL_HOOK':
            drawCards(1, player);
            gameState.state = 'WAITING_FOR_HAND_SELECTION';
            gameState.pendingAction = { type: 'PLAY_FROM_HAND', allowedTypes: ['Item Card'], playerToChoose: rollerId, originalActor: rollerId };
            actionMessage = \`\${player.id.substring(0, 4)} drew a card and may play an Item!\`;
            break;
        case 'SKILL_QUICK_DRAW':
            drawCards(2, player);
            gameState.state = 'WAITING_FOR_HAND_SELECTION';
            gameState.pendingAction = { type: 'PLAY_FROM_HAND', allowedTypes: ['Item Card'], playerToChoose: rollerId, originalActor: rollerId, optional: true };
            actionMessage = \`\${player.id.substring(0, 4)} drew 2 cards and may optionally play an Item!\`;
            break;
        case 'SKILL_SNOWBALL':
            drawCards(1, player);
            gameState.state = 'WAITING_FOR_HAND_SELECTION';
            gameState.pendingAction = { type: 'PLAY_FROM_HAND', allowedTypes: ['Magic Card'], playerToChoose: rollerId, originalActor: rollerId, thenDraw: 1, optional: true };
            actionMessage = \`\${player.id.substring(0, 4)} drew a card and may play a Magic card to draw another!\`;
            break;
`;
skillEngine = skillEngine.substring(0, drawCardIndex) + missingSkills + skillEngine.substring(drawCardIndex);

// Target skills (insert before case 'DESTROY_HERO')
const destroyHeroIndex = skillEngine.indexOf("case 'DESTROY_HERO':");
const targetSkills = `
        case 'SKILL_MEOWZIO':
            if (targetData && targetData.targetPlayerId && targetData.targetHeroId) {
                actionMessage = resolveDestroyAction(gameState, rollerId, targetData.targetPlayerId, targetData.targetHeroId);
                gameState.state = 'PLAYING';
                gameState.pendingAction = { type: 'DISCARD', playerToChoose: rollerId, amount: 2, originalActor: rollerId };
                actionMessage += \` Meowzio forces them to discard 2 cards!\`;
            }
            break;
        case 'SKILL_SHURIKITTY':
        case 'SKILL_WHISKERS':
            if (targetData && targetData.targetPlayerId && targetData.targetHeroId) {
                actionMessage = resolveDestroyAction(gameState, rollerId, targetData.targetPlayerId, targetData.targetHeroId);
            }
            break;
        case 'SKILL_SERIOUS_GREY':
            if (targetData && targetData.targetPlayerId && targetData.targetHeroId) {
                const tp = gameState.players[targetData.targetPlayerId];
                const targetHero = tp ? tp.party.find(h => h.id === targetData.targetHeroId) : null;
                const hasItem = targetHero && targetHero.equippedItem;
                actionMessage = resolveDestroyAction(gameState, rollerId, targetData.targetPlayerId, targetData.targetHeroId);
                if (hasItem && !actionMessage.includes("protected by")) {
                    drawCards(1, player);
                    actionMessage += \` Serious Grey drew a card because the Hero had an Item!\`;
                }
            }
            break;
        case 'SKILL_WIGGLES':
            if (targetData && targetData.targetPlayerId && targetData.targetHeroId) {
                const tp = gameState.players[targetData.targetPlayerId];
                if (tp && !tp.cannotBeStolen) {
                    const tHeroIndex = tp.party.findIndex(h => h.id === targetData.targetHeroId);
                    if (tHeroIndex !== -1) {
                        const targetHero = tp.party.splice(tHeroIndex, 1)[0];
                        player.party.push(targetHero);
                        gameState.state = 'PLAYING';
                        gameState.pendingAction = { type: 'DISCARD', playerToChoose: rollerId, amount: 1, originalActor: rollerId };
                        actionMessage = \`\${player.id.substring(0, 4)} STOLE \${targetHero.name} and must discard a card!\`;
                    }
                } else if (tp) {
                    actionMessage = \`\${tp.id.substring(0, 4)}'s Hero is protected from stealing!\`;
                }
            }
            break;
        case 'SKILL_PLUNDERING_PUMA':
            gameState.state = 'PLAYING';
            gameState.pendingAction = { type: 'PUMA_PULL', playerToChoose: rollerId, originalActor: rollerId };
            actionMessage = \`\${player.id.substring(0, 4)} is choosing a player to pull 2 cards from!\`;
            break;
        case 'SKILL_SLY_PICKINGS':
            gameState.state = 'PLAYING';
            gameState.pendingAction = { type: 'CONDITIONAL_PULL', conditionType: 'Item Card', actionOnSuccess: 'PLAY_IMMEDIATELY', playerToChoose: rollerId, originalActor: rollerId };
            actionMessage = \`\${player.id.substring(0, 4)} is choosing a player to pull a card from!\`;
            break;
        case 'SKILL_BUTTONS':
            gameState.state = 'PLAYING';
            gameState.pendingAction = { type: 'LOOK_AND_PULL', playerToChoose: rollerId, originalActor: rollerId };
            actionMessage = \`\${player.id.substring(0, 4)} is choosing a player to look at their hand!\`;
            break;
        case 'SKILL_LUCKY_BUCKY':
            gameState.state = 'PLAYING';
            gameState.pendingAction = { type: 'CONDITIONAL_PULL', conditionType: 'Hero Card', actionOnSuccess: 'PLAY_IMMEDIATELY', playerToChoose: rollerId, originalActor: rollerId };
            actionMessage = \`\${player.id.substring(0, 4)} is choosing a player to pull a card from!\`;
            break;
`;
skillEngine = skillEngine.substring(0, destroyHeroIndex) + targetSkills + skillEngine.substring(destroyHeroIndex);
fs.writeFileSync('skill_engine.js', skillEngine);
console.log('Patched skill_engine.js');
