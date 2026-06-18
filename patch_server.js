const fs = require('fs');
let server = fs.readFileSync('server.js', 'utf8');

// 1. MULTI_GIVE logic
server = server.replace(
    /if \(ga\.type === 'MULTI_DISCARD' \|\| ga\.type === 'MULTI_DISCARD_AND_CHOOSE'\) \{/g,
    "if (ga.type === 'MULTI_DISCARD' || ga.type === 'MULTI_DISCARD_AND_CHOOSE' || ga.type === 'MULTI_GIVE') {"
);

server = server.replace(
    /io\.emit\('message', \`\$\{getPlayerName\(gameState, player\.id\)\} submitted their discard\.\`\);/g,
    "if (ga.type === 'MULTI_GIVE') { gameState.players[ga.initiatorId].hand.push(discarded); io.emit('message', `${getPlayerName(gameState, player.id)} gave a card to ${getPlayerName(gameState, ga.initiatorId)}.`); } else { io.emit('message', `${getPlayerName(gameState, player.id)} submitted their discard.`); }"
);

server = server.replace(
    /io\.emit\('message', \`Global action fully resolved!\`\);\n\s*resetToPlayingState\(\);/g,
    "if (ga.type === 'MULTI_GIVE') io.emit('message', `All cards collected for Greedy Cheeks!`); else io.emit('message', `Global action fully resolved!`);\n                resetToPlayingState();"
);

// 2. CONDITIONAL_PULL modification & PUMA_PULL
server = server.replace(
    /if \(pAction\.type === 'FORCE_DISCARD_TARGET' \|\| pAction\.type === 'CONDITIONAL_PULL'\) \{/g,
    "if (pAction.type === 'FORCE_DISCARD_TARGET' || pAction.type === 'CONDITIONAL_PULL' || pAction.type === 'PUMA_PULL' || pAction.type === 'LOOK_AND_PULL') {"
);

const oldConditionalPull = `} else if (pAction.type === 'CONDITIONAL_PULL') {
                    if (tp.hand.length > 0) {
                        const rIndex = Math.floor(Math.random() * tp.hand.length);
                        const pulledCard = tp.hand.splice(rIndex, 1)[0];
                        
                        io.emit('message', \`\${getPlayerName(gameState, player.id)} pulled a card from \${getPlayerName(gameState, tp.id)}'s hand!\`);
                        
                        if (pulledCard.type === pAction.conditionType) {
                            io.emit('message', \`It was a \${pAction.conditionType}! They pull a second card!\`);
                            player.hand.push(pulledCard);
                            if (tp.hand.length > 0) {
                                const rIndex2 = Math.floor(Math.random() * tp.hand.length);
                                const pulledCard2 = tp.hand.splice(rIndex2, 1)[0];
                                player.hand.push(pulledCard2);
                            }
                        } else {
                            player.hand.push(pulledCard);
                        }
                    } else {
                        io.emit('message', \`\${getPlayerName(gameState, tp.id)} had no cards to pull!\`);
                    }
                    gameState.pendingAction = null;
                }`;

const newPullLogic = `} else if (pAction.type === 'CONDITIONAL_PULL') {
                    if (tp.hand.length > 0) {
                        const rIndex = Math.floor(Math.random() * tp.hand.length);
                        const pulledCard = tp.hand.splice(rIndex, 1)[0];
                        io.emit('message', \`\${getPlayerName(gameState, player.id)} pulled a card from \${getPlayerName(gameState, tp.id)}'s hand!\`);
                        if (pulledCard.type === pAction.conditionType) {
                            if (pAction.actionOnSuccess === 'PLAY_IMMEDIATELY') {
                                io.emit('message', \`It was a \${pAction.conditionType}! They may play it immediately!\`);
                                gameState.state = 'WAITING_FOR_IMMEDIATE_PLAY';
                                gameState.pendingCard = pulledCard;
                                gameState.pendingAction = { playerToChoose: socket.id, type: 'IMMEDIATE_PLAY', originalActor: socket.id };
                                broadcastState();
                                return;
                            } else {
                                io.emit('message', \`It was a \${pAction.conditionType}! They pull a second card!\`);
                                player.hand.push(pulledCard);
                                if (tp.hand.length > 0) {
                                    const rIndex2 = Math.floor(Math.random() * tp.hand.length);
                                    const pulledCard2 = tp.hand.splice(rIndex2, 1)[0];
                                    player.hand.push(pulledCard2);
                                }
                            }
                        } else {
                            player.hand.push(pulledCard);
                        }
                    } else {
                        io.emit('message', \`\${getPlayerName(gameState, tp.id)} had no cards to pull!\`);
                    }
                    gameState.pendingAction = null;
                } else if (pAction.type === 'PUMA_PULL') {
                    if (tp.hand.length > 0) {
                        for(let i=0; i<2; i++) {
                            if (tp.hand.length === 0) break;
                            const rIndex = Math.floor(Math.random() * tp.hand.length);
                            player.hand.push(tp.hand.splice(rIndex, 1)[0]);
                        }
                        io.emit('message', \`\${getPlayerName(gameState, player.id)} pulled cards from \${getPlayerName(gameState, tp.id)}'s hand!\`);
                        if (gameState.mainDeck.length > 0) {
                            tp.hand.push(gameState.mainDeck.pop());
                            io.emit('message', \`\${getPlayerName(gameState, tp.id)} drew a card!\`);
                        }
                    } else {
                        io.emit('message', \`\${getPlayerName(gameState, tp.id)} had no cards to pull!\`);
                    }
                    gameState.pendingAction = null;
                } else if (pAction.type === 'LOOK_AND_PULL') {
                    if (tp.hand.length > 0) {
                        const rIndex = Math.floor(Math.random() * tp.hand.length);
                        const pulledCard = tp.hand.splice(rIndex, 1)[0];
                        player.hand.push(pulledCard);
                        io.emit('message', \`\${getPlayerName(gameState, player.id)} pulled a card from \${getPlayerName(gameState, tp.id)}'s hand!\`);
                    } else {
                        io.emit('message', \`\${getPlayerName(gameState, tp.id)} had no cards to pull!\`);
                    }
                    gameState.pendingAction = null;
                }`;

server = server.replace(oldConditionalPull, newPullLogic);

// 3. PLAY_FROM_HAND socket event (insert near resolve_immediate_play)
const resolveImmPlayIndex = server.indexOf("socket.on('resolve_immediate_play'");
const playFromHandEvent = `
    socket.on('play_from_hand', (data) => {
        if (gameState.state !== 'WAITING_FOR_HAND_SELECTION') return;
        if (socket.id !== gameState.pendingAction.playerToChoose) return;
        const player = gameState.players[socket.id];
        if (!player) return;

        if (data.cancel && gameState.pendingAction.optional) {
            io.emit('message', \`\${getPlayerName(gameState, player.id)} declined to play a card.\`);
            resetToPlayingState();
            broadcastState();
            return;
        }

        const cardIndex = player.hand.findIndex(c => c.id === data.cardId);
        if (cardIndex !== -1) {
            const card = player.hand[cardIndex];
            if (gameState.pendingAction.allowedTypes.includes(card.type)) {
                player.hand.splice(cardIndex, 1);
                gameState.pendingCard = card;
                
                if (gameState.pendingAction.thenDraw && gameState.mainDeck.length > 0) {
                    for(let i=0; i<gameState.pendingAction.thenDraw; i++) {
                        if(gameState.mainDeck.length > 0) player.hand.push(gameState.mainDeck.pop());
                    }
                    io.emit('message', \`\${getPlayerName(gameState, player.id)} drew \${gameState.pendingAction.thenDraw} extra card(s)!\`);
                }

                gameState.state = 'WAITING_FOR_CHALLENGES';
                gameState.pendingChallenge = {
                    rollerId: socket.id,
                    card: gameState.pendingCard,
                    passedPlayers: []
                };
                io.emit('challenge_pending', {
                    rollerId: socket.id,
                    rollerName: \`\${getPlayerName(gameState, socket.id)}\`,
                    card: gameState.pendingCard
                });
                broadcastState();
            } else {
                 io.emit('message', \`You must select a \${gameState.pendingAction.allowedTypes.join(' or ')}.\`);
            }
        }
    });
`;

server = server.substring(0, resolveImmPlayIndex) + playFromHandEvent + server.substring(resolveImmPlayIndex);

fs.writeFileSync('server.js', server);
console.log('Patched server.js');
