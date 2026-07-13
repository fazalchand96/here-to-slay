'use strict';

function getPlayerName(gameState, id) {
    const fallback = 'Player ' + String(id || '').substring(0, 4);
    if (!gameState || !gameState.players || !gameState.players[id]) {
        return fallback;
    }
    const player = gameState.players[id];
    return player.name && player.name !== 'Player' ? player.name : fallback;
}

module.exports = { getPlayerName };
