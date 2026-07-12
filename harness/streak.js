// Streak runner: N consecutive clean games through the real mobile UI.
// A streak-breaking verdict stops the run immediately (the count only resets
// after a FIX, per the goal spec — resuming mid-count is not allowed, so the
// runner simply exits nonzero and reports).
//
// Usage:
//   node harness/streak.js --games 50 --lanes 2 --players 6 --orientation landscape [--port 3200] [--seed 12345] [--headed]
// Results stream to harness/results/<orientation>-<timestamp>.jsonl

const fs = require('fs');
const path = require('path');
const { runGame } = require('./game');

function arg(name, dflt) {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return dflt;
    const v = process.argv[i + 1];
    return v && !v.startsWith('--') ? v : true;
}

(async () => {
    const games = parseInt(arg('games', '50'), 10);
    const playerCount = parseInt(arg('players', '6'), 10);
    const orientation = arg('orientation', 'landscape');
    const port = parseInt(arg('port', '3200'), 10);
    const lanes = Math.max(1, parseInt(arg('lanes', '1'), 10));
    const baseSeed = parseInt(arg('seed', String(Date.now() % 2147483647)), 10);
    const headless = !process.argv.includes('--headed');

    const outDir = path.join(__dirname, 'results');
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outFile = path.join(outDir, `${orientation}-${playerCount}p-${stamp}.jsonl`);

    console.log(`[streak] ${games} games x ${playerCount}p ${orientation}, lanes=${lanes}, ports=${port}-${port + lanes - 1}, baseSeed=${baseSeed}, headless=${headless}`);
    console.log(`[streak] results -> ${outFile}`);

    let nextGame = 1;
    let cleanCount = 0;
    let streakBreaker = null;
    const laneCount = Math.min(lanes, games);
    const controllers = Array.from({ length: laneCount }, () => new AbortController());

    async function runLane(laneIndex) {
        const laneNumber = laneIndex + 1;
        while (!streakBreaker) {
            const g = nextGame++;
            if (g > games) return;
            const seed = (baseSeed + g * 104729) % 2147483647;
            const t0 = Date.now();
            console.log(`[lane ${laneNumber}] game ${g}/${games} starting on port ${port + laneIndex} (seed=${seed})...`);
            const verdict = await runGame({
                port: port + laneIndex, playerCount, orientation, seed, headless,
                gameIndex: g, lane: laneNumber, signal: controllers[laneIndex].signal,
            });
            verdict.lane = laneNumber;
            fs.appendFileSync(outFile, JSON.stringify(verdict) + '\n');
            const mins = ((Date.now() - t0) / 60000).toFixed(1);
            if (verdict.ok) {
                cleanCount++;
                console.log(`[lane ${laneNumber}] game ${g}/${games} CLEAN in ${mins}min — shared clean count ${cleanCount}/${games}; winner=${verdict.winner} (${verdict.winReason})`);
                continue;
            }
            if (verdict.breaker?.kind === 'aborted' && streakBreaker) return;
            if (!streakBreaker) {
                streakBreaker = { lane: laneNumber, game: g, verdict };
                console.error(`[lane ${laneNumber}] game ${g}/${games} STREAK BROKEN in ${mins}min`);
                console.error(`[streak] breaker: ${JSON.stringify(verdict.breaker, null, 2)}`);
                console.error(`[streak] last actions: ${JSON.stringify(verdict.actionsTail)}`);
                controllers.forEach((controller, i) => { if (i !== laneIndex) controller.abort(); });
            }
            return;
        }
    }

    await Promise.all(controllers.map((_, i) => runLane(i)));
    if (streakBreaker) {
        console.error(`[streak] stopped all lanes; breaker lane=${streakBreaker.lane}, game=${streakBreaker.game}`);
        process.exit(1);
    }
    console.log(`[streak] ALL ${games} GAMES CLEAN (${orientation}, ${playerCount}p)`);
    process.exit(0);
})();
