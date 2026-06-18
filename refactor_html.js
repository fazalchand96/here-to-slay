const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

const panelRegex = /<!-- Card Info Panel \(Right Sidebar\) -->[\s\S]*?<\/div>\s*<\/div>\s*(?=<!-- Victory Modal)/;
const panelMatch = html.match(panelRegex);

if (panelMatch) {
    const panelHTML = panelMatch[0];
    html = html.replace(panelRegex, '');
    
    // rename #game-board to #app-container, and put #game-board inside it
    html = html.replace('<!-- Game Board -->\r\n    <div id="game-board" class="hidden">', '<!-- Main App Container -->\n    <div id="app-container" class="app-container hidden">\n    <!-- Game Board -->\n    <div id="game-board" class="game-board">');
    
    // close app-container before Dice Overlay and insert panelHTML
    html = html.replace('<!-- Dice Overlay -->', '    ' + panelHTML + '\n    </div>\n\n    <!-- Dice Overlay -->');
    
    fs.writeFileSync('public/index.html', html);
    console.log('Successfully restructured index.html');
} else {
    console.log('Failed to match panel HTML');
}
