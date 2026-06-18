const io = require('socket.io-client');
const socket = io('http://localhost:3000');

socket.on('connect', () => {
    console.log('Connected!');
    setTimeout(() => {
        socket.emit('start_game_debug');
    }, 1000);
});

socket.on('gameStateUpdate', (data) => {
    if (data.state === 'PLAYING') {
        console.log('--- gameStateUpdate (PLAYING) ---');
        console.log('Me:', data.me);
        console.log('My Hand Size:', data.players[data.me].hand.length);
        console.log('Active Monsters:', data.activeMonsters.length);
        console.log('AP:', data.players[data.me].ap);
        process.exit(0);
    }
});
