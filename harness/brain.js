// Decision "brain" for the mobile-UI test harness.
// Ported from bot.js: same legal-move heuristics, but PURE — it never touches a
// socket. Given the latest gameStateUpdate snapshot for one player it returns a
// declarative decision object; harness/driver.js actuates it through real UI
// taps in a Playwright mobile viewport.

// Mirrors meetsMonsterRequirements in bot.js / server.js.
function meetsMonsterRequirements(playerData, reqString) {
    if (!reqString || reqString === 'None' || reqString === '') return true;

    let availableClasses = [];
    if (playerData.leader && playerData.leader.class) {
        availableClasses.push(playerData.leader.class);
    }
    let heroCount = 0;
    if (playerData.party && Array.isArray(playerData.party)) {
        playerData.party.forEach(card => {
            if (card.type === 'Hero Card') {
                heroCount++;
                if (card.class) availableClasses.push(card.class);
            }
        });
    }

    const conditions = reqString.split(',').map(s => s.trim());
    for (let cond of conditions) {
        const match = cond.match(/(\d+)\s+(.+)/);
        if (!match) continue;
        const requiredCount = parseInt(match[1], 10);
        let requiredType = match[2];
        if (requiredType === 'Heroes') requiredType = 'Hero';
        if (requiredType === 'Hero') {
            if (heroCount < requiredCount) return false;
        } else {
            const classCount = availableClasses.filter(c => c === requiredType).length;
            if (classCount < requiredCount) return false;
        }
    }
    return true;
}

// Mulberry32 — deterministic per-game RNG so failures replay.
function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Target choice for pendingAction states — mirrors selectTargetForPendingAction.
function selectTargetForPendingAction(data, myId, rng) {
    const pAction = data.pendingAction;
    if (!pAction || pAction.playerToChoose !== myId) return null;

    if (pAction.type === 'DISCARD') {
        const p = data.players[myId];
        // location 'hand' scopes the driver's tap to #player-hand — duplicate
        // card ids exist across the deck, so an unscoped [data-id] match can
        // hit another copy (e.g. the discard pile's top card).
        if (p && p.hand && p.hand.length > 0) return { kind: 'card', id: p.hand[0].id, location: 'hand' };
    } else if (['FORCE_DISCARD_TARGET', 'CONDITIONAL_PULL', 'PUMA_PULL', 'LOOK_AND_PULL', 'SKILL_TARGET_PLAYER', 'STEAL_FROM_ALL', 'TRADE_HANDS'].includes(pAction.type)) {
        const opponentIds = data.playerOrder.filter(id => id !== myId);
        if (opponentIds.length > 0) return { kind: 'player', id: opponentIds[Math.floor(rng() * opponentIds.length)] };
    } else if (['DESTROY', 'STEAL', 'EXCHANGE_STEP_1', 'SKILL_TARGET_HERO'].includes(pAction.type)) {
        const opponentIds = data.playerOrder.filter(id => id !== myId);
        const opponentHeroes = [];
        opponentIds.forEach(oid => {
            const p = data.players[oid];
            if (p && p.party) p.party.forEach(h => opponentHeroes.push({ id: h.id, owner: oid }));
        });
        if (opponentHeroes.length > 0) {
            const pick = opponentHeroes[Math.floor(rng() * opponentHeroes.length)];
            return { kind: 'card', id: pick.id, owner: pick.owner };
        }
    } else if (pAction.type === 'EXCHANGE_STEP_2') {
        const p = data.players[myId];
        if (p && p.party && p.party.length > 0) return { kind: 'card', id: p.party[Math.floor(rng() * p.party.length)].id, owner: myId };
    } else if (pAction.type === 'RETURN_ITEM' || pAction.type === 'SKILL_TARGET_SELF_ITEM') {
        const heroesWithItems = [];
        data.playerOrder.forEach(id => {
            const p = data.players[id];
            if (p && p.party) p.party.forEach(h => { if (h.equippedItem) heroesWithItems.push({ id: h.id, owner: id }); });
        });
        if (heroesWithItems.length > 0) {
            const pick = heroesWithItems[Math.floor(rng() * heroesWithItems.length)];
            return { kind: 'card', id: pick.id, owner: pick.owner };
        }
    }
    return null;
}

// Main-turn action — mirrors executeTurnAction's 40/30/30 split.
function decideTurnAction(data, player, myId, rng) {
    const attackableMonsters = (data.activeMonsters || []).filter(m => meetsMonsterRequirements(player, m.requirement));
    const playableCards = (player.hand || []).filter(c => c.type === 'Hero Card' || c.type === 'Magic Card');
    const r = rng();

    if (r < 0.4 && player.ap >= 2 && attackableMonsters.length > 0) {
        const m = attackableMonsters[Math.floor(rng() * attackableMonsters.length)];
        return { type: 'ATTACK', monsterId: m.id, monsterName: m.name };
    }
    if (r < 0.7 && player.ap >= 1 && playableCards.length > 0) {
        const c = playableCards[Math.floor(rng() * playableCards.length)];
        return { type: 'PLAY_CARD', cardId: c.id, cardName: c.name, cardType: c.type };
    }
    if (player.ap >= 1) {
        // Prefer draw; fall back to playing a card if the deck action is unavailable.
        return { type: 'DRAW', fallback: playableCards.length > 0 ? { type: 'PLAY_CARD', cardId: playableCards[0].id, cardName: playableCards[0].name, cardType: playableCards[0].type } : null };
    }
    return { type: 'END_TURN' };
}

// The full decision table. Returns null when this player has nothing to do.
// `memory` is per-player persistent scratch (mirrors bot.js's hasDecidedReroll
// flag — without it the reroll branch would shadow the host's START_GAME check
// forever once a player decides to keep their leader).
function decide(data, myId, rng, memory = {}) {
    if (!data || !data.players || !myId) return null;
    const player = data.players[myId];
    if (!player) return null;

    if (data.state === 'GAMEOVER') return { type: 'GAMEOVER' };

    if (data.state === 'LOBBY') {
        if (!player.leader && !player.hasSelectedLeader) return { type: 'ROLL_LEADER' };
        if (player.leader && !player.hasRerolledLeader && !memory.decidedReroll) {
            memory.decidedReroll = true;
            return rng() < 0.5 ? { type: 'REROLL_LEADER' } : { type: 'KEEP_LEADER' };
        }
        if (data.playerOrder && data.playerOrder[0] === myId) {
            const allReady = data.playerOrder.every(id => data.players[id] && data.players[id].hasSelectedLeader);
            if (allReady && data.playerOrder.length >= 2) return { type: 'START_GAME' };
        }
        return null;
    }

    if (data.state === 'PLAYING') {
        const isMyTurn = (data.activePlayerSocketId === myId || data.activePlayer === myId);
        if (data.pendingAction && data.pendingAction.playerToChoose === myId) {
            const target = selectTargetForPendingAction(data, myId, rng);
            return target ? { type: 'SELECT_TARGET', target, pendingType: data.pendingAction.type } : { type: 'NO_TARGET', pendingType: data.pendingAction.type };
        }
        if (isMyTurn && !data.pendingAction) {
            if (player.ap === 0) return { type: 'END_TURN' };
            return decideTurnAction(data, player, myId, rng);
        }
        return null;
    }

    if (data.state === 'WAITING_FOR_SKILL_TARGET') {
        const isMyTurn = (data.activePlayerSocketId === myId || data.activePlayer === myId);
        if (!isMyTurn || !data.pendingAction) return null;
        const type = data.pendingAction.type;
        if (type === 'SKILL_TARGET_HERO') {
            for (const oid of data.playerOrder.filter(id => id !== myId)) {
                const op = data.players[oid];
                if (op && op.party && op.party.length > 0) {
                    return { type: 'SKILL_TARGET_CARD', targetHeroId: op.party[0].id, targetPlayerId: oid };
                }
            }
            return { type: 'SKILL_TARGET_CANCEL' };
        }
        if (type === 'SKILL_TARGET_PLAYER') {
            const opponents = data.playerOrder.filter(id => id !== myId);
            if (opponents.length > 0) return { type: 'SKILL_TARGET_PLAYER', targetPlayerId: opponents[Math.floor(rng() * opponents.length)] };
            return { type: 'SKILL_TARGET_CANCEL' };
        }
        if (type === 'SKILL_TARGET_SELF_ITEM') {
            const heroWithItem = (player.party || []).find(h => h.equippedItem);
            if (heroWithItem) return { type: 'SKILL_TARGET_CARD', targetHeroId: heroWithItem.id, targetPlayerId: myId };
            return { type: 'SKILL_TARGET_CANCEL' };
        }
        if (type === 'SKILL_TARGET_DISCARD') {
            // Discard-pile picker modal (Guiding Light, Call to the Fallen, etc.).
            return { type: 'SKILL_TARGET_DISCARD' };
        }
        if (type === 'SKILL_TARGET_MULTI') {
            const targets = [];
            data.playerOrder.filter(id => id !== myId).forEach(oid => {
                const op = data.players[oid];
                if (op && op.party) op.party.forEach(h => targets.push({ id: h.id, owner: oid }));
            });
            return { type: 'SKILL_TARGET_MULTI', targets: targets.slice(0, 2) };
        }
        return { type: 'SKILL_TARGET_CANCEL' };
    }

    if (data.state === 'WAITING_FOR_HAND_SELECTION') {
        if (data.pendingAction && data.pendingAction.playerToChoose === myId) {
            const allowedTypes = data.pendingAction.allowedTypes || [];
            const validCards = (player.hand || []).filter(c => allowedTypes.includes(c.type));
            if (validCards.length > 0) {
                const c = validCards[Math.floor(rng() * validCards.length)];
                const decision = { type: 'HAND_SELECT', cardId: c.id, cardName: c.name, cardType: c.type };
                if (c.type === 'Item Card' || c.type === 'Cursed Item Card') {
                    // Items enter equip-targeting after "Play This Card": pick a hero
                    // now (own party first; items may equip to ANY board hero).
                    if (player.party && player.party.length > 0) {
                        decision.equipTarget = { id: player.party[0].id, owner: myId };
                    } else {
                        for (const oid of data.playerOrder.filter(id => id !== myId)) {
                            const op = data.players[oid];
                            if (op && op.party && op.party.length > 0) {
                                decision.equipTarget = { id: op.party[0].id, owner: oid };
                                break;
                            }
                        }
                    }
                    // No hero anywhere -> the equip cannot resolve; skip instead.
                    if (!decision.equipTarget) return { type: 'HAND_SKIP' };
                }
                return decision;
            }
            return { type: 'HAND_SKIP' };
        }
        return null;
    }

    if (data.state === 'WAITING_FOR_CHALLENGES') {
        if (data.pendingChallenge && data.pendingChallenge.rollerId !== myId) {
            if ((data.pendingChallenge.passedPlayers || []).includes(myId)) return null;
            const challengeCards = (player.hand || []).filter(c => c.type === 'Challenge Card');
            if (rng() < 0.5 && challengeCards.length > 0) {
                const c = challengeCards[Math.floor(rng() * challengeCards.length)];
                return { type: 'CHALLENGE_PLAY', cardId: c.id };
            }
            return { type: 'CHALLENGE_PASS' };
        }
        return null;
    }

    if (data.state === 'WAITING_TO_ROLL') {
        if (data.pendingRoll && data.pendingRoll.rollerId === myId) return { type: 'ROLL' };
        return null;
    }

    if (data.state === 'WAITING_TO_ROLL_CHALLENGE') {
        if (data.pendingRoll) {
            const myTurnToRoll = (data.pendingRoll.activeId === myId && !data.pendingRoll.activeRolled) ||
                (data.pendingRoll.challengerId === myId && !data.pendingRoll.challengerRolled);
            if (myTurnToRoll) return { type: 'ROLL' };
        }
        return null;
    }

    if (data.state === 'WAITING_FOR_MODIFIERS') {
        const pr = data.pendingRoll || {};
        const phaseKey = [pr.type, pr.rollerId, pr.currentRoll, pr.modifierTotal,
            pr.activeId, pr.challengerId, pr.activeModifiers, pr.challengerModifiers].join(':');
        if (memory.modifierPhaseKey !== phaseKey) {
            memory.modifierPhaseKey = phaseKey;
            memory.modifierResponded = false;
        }
        // Modifier acknowledgements live at gameState.passedModifiers.
        if ((data.passedModifiers || []).includes(myId) || memory.modifierResponded) return null;
        const modifierCards = (player.hand || []).filter(c => c.type === 'Modifier Card');
        if (rng() < 0.3 && modifierCards.length > 0) {
            const c = modifierCards[Math.floor(rng() * modifierCards.length)];
            memory.modifierResponded = true;
            return { type: 'MODIFIER_PLAY', cardId: c.id, cardName: c.name };
        }
        memory.modifierResponded = true;
        return { type: 'MODIFIER_PASS' };
    }

    if (['WAITING_FOR_DISCARD_PENALTY', 'WAITING_FOR_MULTIPLE_DISCARDS', 'WAITING_FOR_VARIABLE_DISCARD'].includes(data.state)) {
        const pAction = data.pendingAction;
        if (!pAction) return null;
        let mustAct = false;
        if (data.state === 'WAITING_FOR_DISCARD_PENALTY') mustAct = pAction.playerToChoose === myId;
        else if (data.state === 'WAITING_FOR_MULTIPLE_DISCARDS') {
            mustAct = Array.isArray(pAction.targets) && pAction.targets.includes(myId) &&
                !(Array.isArray(pAction.completed) && pAction.completed.includes(myId));
        } else if (data.state === 'WAITING_FOR_VARIABLE_DISCARD') mustAct = pAction.originalActor === myId;
        if (!mustAct) return null;
        const requiredCount = pAction.amount || pAction.maxAmount || 1;
        const cardIds = (player.hand || []).slice(0, requiredCount).map(c => c.id);
        return { type: 'DISCARD_PENALTY', cardIds };
    }

    if (data.state === 'WAITING_FOR_SACRIFICE') {
        if (data.pendingAction && data.pendingAction.playerToChoose === myId) {
            if (player.party && player.party.length > 0) {
                return { type: 'SACRIFICE', heroId: player.party[0].id, heroName: player.party[0].name };
            }
        }
        return null;
    }

    if (data.state === 'WAITING_FOR_IMMEDIATE_PLAY') {
        if (data.pendingAction && data.pendingAction.playerToChoose === myId) return { type: 'IMMEDIATE_PLAY' };
        return null;
    }

    if (data.state === 'WAITING_FOR_GLOBAL_ACTION' && data.pendingGlobalAction) {
        const ga = data.pendingGlobalAction;
        if (ga.pendingPlayerIds && ga.pendingPlayerIds.includes(myId)) {
            if (ga.type === 'MULTI_DISCARD' || ga.type === 'MULTI_DISCARD_AND_CHOOSE' || ga.type === 'MULTI_GIVE') {
                if (player.hand && player.hand.length > 0) return { type: 'GLOBAL_CARD', cardId: player.hand[0].id, gaType: ga.type };
            } else if (ga.type === 'MULTI_SACRIFICE') {
                if (player.party && player.party.length > 0) return { type: 'GLOBAL_SACRIFICE', heroId: player.party[0].id };
            }
            return null;
        }
        if (ga.initiatorId === myId && ga.awaitingChoice && ga.submittedCards && ga.submittedCards.length > 0 && ga.type === 'MULTI_DISCARD_AND_CHOOSE') {
            return { type: 'GLOBAL_RESOLVE', cardId: ga.submittedCards[0].id };
        }
        return null;
    }

    return null;
}

module.exports = { decide, meetsMonsterRequirements, makeRng, selectTargetForPendingAction };
