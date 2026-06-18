/**
 * card_effects.js
 * Handles the mechanical resolution of Hero skills.
 */

function resolveSkill(card, rollTotal, gameState, playerSocketId, dealCardsFunc) {
    // Parse the threshold, e.g., "7+" -> 7
    let threshold = 12; // default high so it fails if parse error
    if (card.requirement && card.requirement !== 'None') {
        const match = card.requirement.match(/(\d+)/);
        if (match) {
            threshold = parseInt(match[1], 10);
        }
    }

    if (rollTotal >= threshold) {
        // Success
        let effectMessage = `Effect resolved: ${card.effect}`;

        const heroTargetingSkills = ['DESTROY_HERO', 'STEAL_HERO', 'MAGIC_DESTRUCTIVE', 'SKILL_MEOWZIO', 'SKILL_SHURIKITTY', 'SKILL_TIPSY_TOOTIE'];
        const playerTargetingSkills = ['PULL_CARD', 'TRADE_HANDS', 'SKILL_SHARP_FOX', 'SKILL_SILENT_SHADOW', 'SKILL_SLIPPERY_PAWS', 'SKILL_HOPPER', 'SKILL_PLUNDERING_PUMA', 'SKILL_SLY_PICKINGS'];

        if (heroTargetingSkills.includes(card.skill_id)) {
            gameState.pendingAction = {
                type: 'CHOOSE_STEAL_TARGET', // standard UI trigger for Hero clicking
                playerToChoose: playerSocketId,
                skillId: card.skill_id,
                effectSource: card.name
            };
            return { success: true, message: `${card.name} resolved! Select a target Hero on the board.`, pending: true };
        }

        if (playerTargetingSkills.includes(card.skill_id)) {
            gameState.pendingAction = {
                type: 'CHOOSE_PULL_PLAYER_TARGET', // standard UI trigger for Player clicking
                playerToChoose: playerSocketId,
                skillId: card.skill_id,
                effectSource: card.name
            };
            return { success: true, message: `${card.name} resolved! Select a target Player.`, pending: true };
        }

        // Hardcoded Proof of Concept Cases
        if (card.name === 'Peanut') {
            // "DRAW 2 cards."
            dealCardsFunc(2, playerSocketId);
            effectMessage = 'Peanut resolved! You drew 2 cards.';
        } else if (card.name === 'Heavy Bear') {
            const opponentId = gameState.playerOrder.find(id => id !== playerSocketId);
            if (opponentId && gameState.players[opponentId].hand.length > 0) {
                gameState.pendingAction = { type: 'DISCARD', playerToChoose: opponentId, amount: 2, originalActor: playerSocketId };
                effectMessage = 'Heavy Bear resolved! Waiting for opponent to discard 2 cards.';
            } else {
                effectMessage = 'Heavy Bear resolved! Opponent has no cards to discard.';
            }
        }

        return { success: true, message: effectMessage };
    } else {
        return { success: false, message: 'Skill roll failed.' };
    }
}

function resolveMagic(card, gameState, playerSocketId, dealCardsFunc) {
    let effectMessage = `Magic cast: ${card.name}`; 

    if (card.name === 'Forceful Winds') {
        let itemsReturned = 0;
        gameState.playerOrder.forEach(pId => {
            const player = gameState.players[pId];
            if (player && player.party) {
                player.party.forEach(hero => {
                    if (hero.equippedItem) {
                        player.hand.push(hero.equippedItem);
                        hero.equippedItem = null;
                        itemsReturned++;
                    }
                });
            }
        });
        effectMessage = `Forceful Winds cast! Returned ${itemsReturned} equipped item card(s) to their owners' hands.`;
    }

    return { success: true, message: effectMessage };
}

module.exports = {
    resolveSkill,
    resolveMagic
};
