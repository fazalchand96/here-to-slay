const fs = require('fs');
let css = fs.readFileSync('public/style.css', 'utf8');

// Replace old #game-board
css = css.replace(/#game-board \{[\s\S]*?\}/, `.app-container {
    display: grid;
    grid-template-columns: 1fr 350px;
    height: 100vh;
    overflow: hidden;
    gap: 20px;
}

#game-board {
    display: grid;
    grid-template-rows: 150px 200px 1fr; /* Opponents, Main Board, Player Area */
    grid-template-areas:
        "opponents"
        "center-board"
        "player-area";
    width: 100%;
    height: 100%;
    overflow-y: auto;
    padding: 20px;
    box-sizing: border-box;
}

.opponent-status-bar { grid-area: opponents; }
.middle-row { grid-area: center-board; }
.bottom-row { grid-area: player-area; display: flex; flex-direction: column; }
.player-zones { flex: 1; display: flex; flex-direction: column; }
.party-zone { flex: 1; min-height: 200px; }
.hand-zone { height: 200px; position: relative; }

#player-hand {
    display: flex;
    justify-content: center;
    align-items: flex-end;
    position: relative;
    height: 100%;
    width: 100%;
}
#player-hand .card {
    position: absolute;
    bottom: 10px;
    transform-origin: bottom center;
    transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), z-index 0s;
}
#player-hand .card:hover {
    transform: translateY(-40px) scale(1.15) rotate(0deg) !important;
    z-index: 1000 !important;
}
`);

fs.writeFileSync('public/style.css', css);
console.log('Successfully updated style.css');
