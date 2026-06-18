const fs = require('fs');
let js = fs.readFileSync('public/app.js', 'utf8');

js = js.replace("const gameBoard = document.getElementById('game-board');", "const gameBoard = document.getElementById('game-board');\nconst appContainer = document.getElementById('app-container');");
js = js.replace(/gameBoard\.classList/g, "appContainer.classList");

fs.writeFileSync('public/app.js', js);
console.log('Successfully updated app.js container toggles');
