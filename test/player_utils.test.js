'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getPlayerName } = require('../player_utils');

test('getPlayerName resolves chosen names and uses the socket-prefix fallback', () => {
    const gameState = {
        players: {
            'socket-alice': { name: 'Alice' },
            'socket-unnamed': { name: 'Player' },
        },
    };

    assert.equal(getPlayerName(gameState, 'socket-alice'), 'Alice');
    assert.equal(getPlayerName(gameState, 'socket-unnamed'), 'Player sock');
    assert.equal(getPlayerName(gameState, 'socket-missing'), 'Player sock');
});
