const fs = require('fs');
let js = fs.readFileSync('public/app.js', 'utf8');

// Update renderCard signature
js = js.replace('function renderCard(card, isMine = false, inHand = false, isMonster = false, isMyTurn = false) {', 'function renderCard(card, isMine = false, inHand = false, isMonster = false, isMyTurn = false, inlineStyle = "") {');

// Inject inlineStyle into the top level card div
js = js.replace('        <div class="card ${card.type === \'Hero Card\' ? \'hero-card\' : \'\'} ${glowClass}" \n             onclick="selectCard(\'${card.id}\')" ${contextAttr}>', '        <div class="card ${card.type === \'Hero Card\' ? \'hero-card\' : \'\'} ${glowClass}" \n             onclick="selectCard(\'${card.id}\')" ${contextAttr} style="${inlineStyle}">');

// Replace playerHand.innerHTML = me.hand.map(...).join('');
const oldHandLogic = "playerHand.innerHTML = me.hand.map(c => renderCard(c, true, true, false, isMyTurn)).join('');";
const newHandLogic = `
    const totalCards = me.hand.length;
    const middleIndex = (totalCards - 1) / 2;
    const spreadFactor = 30; // Horizontal spacing between cards
    const angleFactor = 6; // Degrees of rotation per card

    let handHTML = '';
    me.hand.forEach((c, index) => {
        const offset = index - middleIndex;
        const rotation = offset * angleFactor;
        const xTranslate = offset * spreadFactor;
        const yTranslate = Math.abs(offset) * 3; // Push outer cards slightly down
        const zIndex = index;
        
        const inlineStyle = \`transform: translateX(\${xTranslate}px) translateY(\${yTranslate}px) rotate(\${rotation}deg); z-index: \${zIndex};\`;
        handHTML += renderCard(c, true, true, false, isMyTurn, inlineStyle);
    });
    playerHand.innerHTML = handHTML;
`;
js = js.replace(oldHandLogic, newHandLogic.trim());

fs.writeFileSync('public/app.js', js);
console.log('Successfully updated dynamic fan logic in app.js');
