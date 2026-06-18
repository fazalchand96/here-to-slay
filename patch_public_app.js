const fs = require('fs');
let app = fs.readFileSync('public/app.js', 'utf8');

// 1. Add WAITING_FOR_HAND_SELECTION and LOOK_AND_PULL to target banner
const bannerInsertion = `
        if (state === 'WAITING_FOR_HAND_SELECTION') {
            document.getElementById('target-mode-banner').classList.remove('hidden');
            if (myId === gameState.pendingAction?.playerToChoose) {
                document.getElementById('target-mode-text').innerText = 'SELECT A CARD FROM YOUR HAND TO PLAY';
                if (gameState.pendingAction?.optional) {
                    document.getElementById('target-mode-text').innerText += ' (OR CANCEL)';
                }
            } else {
                document.getElementById('target-mode-text').innerText = 'WAITING FOR OPPONENT TO SELECT A CARD...';
            }
        } else if (state === 'PLAYING' && gameState.pendingAction?.type === 'LOOK_AND_PULL') {
            document.getElementById('target-mode-banner').classList.remove('hidden');
            if (myId === gameState.pendingAction?.playerToChoose) {
                document.getElementById('target-mode-text').innerText = 'SELECT AN OPPONENT TO PULL A CARD FROM!';
            } else {
                document.getElementById('target-mode-text').innerText = 'WAITING FOR OPPONENT TO SELECT A TARGET...';
            }
        } else if (state === 'PLAYING' && gameState.pendingAction?.type === 'PUMA_PULL') {
            document.getElementById('target-mode-banner').classList.remove('hidden');
            if (myId === gameState.pendingAction?.playerToChoose) {
                document.getElementById('target-mode-text').innerText = 'SELECT AN OPPONENT TO PULL 2 CARDS FROM!';
            } else {
                document.getElementById('target-mode-text').innerText = 'WAITING FOR OPPONENT TO SELECT A TARGET...';
            }
        } else `;

app = app.replace(/if \(state === 'WAITING_FOR_CHALLENGES'\)/, bannerInsertion.trim() + " if (state === 'WAITING_FOR_CHALLENGES')");

// 2. Add playCard intercept
app = app.replace(
    /function playCard\(id\) \{/,
    "function playCard(id) {\n    if (latestGameState && latestGameState.state === 'WAITING_FOR_HAND_SELECTION') {\n        socket.emit('play_from_hand', { cardId: id });\n        closeInspectorModal();\n        return;\n    }"
);

// 3. Add LOOK_AND_PULL and PUMA_PULL to click handler
app = app.replace(
    /else if \(currentPendingAction\.type === 'CONDITIONAL_PULL'\) \{/,
    "else if (currentPendingAction.type === 'CONDITIONAL_PULL' || currentPendingAction.type === 'PUMA_PULL' || currentPendingAction.type === 'LOOK_AND_PULL') {"
);

app = app.replace(
    /\} else if \(myTargetMode && currentPendingAction && \(currentPendingAction\.type === 'FORCE_DISCARD_TARGET' \|\| currentPendingAction\.type === 'CONDITIONAL_PULL'\)\) \{/,
    "} else if (myTargetMode && currentPendingAction && (currentPendingAction.type === 'FORCE_DISCARD_TARGET' || currentPendingAction.type === 'CONDITIONAL_PULL' || currentPendingAction.type === 'PUMA_PULL' || currentPendingAction.type === 'LOOK_AND_PULL')) {"
);

fs.writeFileSync('public/app.js', app);
console.log('Patched public/app.js');
