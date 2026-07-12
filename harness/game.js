// Runs ONE full 6-player game through real mobile-browser UI and returns a
// verdict. Streak-breaking detectors (per GOAL_ANIMATION_AND_TESTING.md):
//   1. server crash / uncaught exception
//   2. client console error / pageerror
//   3. softlock (no state progress despite the harness acting)
//   4. wrong win detection
//   5. hand/state desync (rendered DOM vs the state that client received)
// Cosmetic issues are logged separately and never fail the run.

const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('@playwright/test');
const brain = require('./brain');
const driver = require('./driver');

const REPO = path.join(__dirname, '..');
const VIEWPORTS = {
    landscape: { width: 844, height: 390 },
    portrait: { width: 412, height: 870 },
};
const SOFTLOCK_MS = 120000;   // no observable progress for 2 min => softlock
// Generous backstop only — long games are legal (the 2-min no-progress
// watchdog catches real softlocks); a 6p game can honestly run 30-45 min.
const GAME_CAP_MS = 60 * 60 * 1000;
const TICK_MS = 150;
const TICK_JITTER_MS = 50;

function effectiveHeroClass(hero) {
    if (!hero) return null;
    const item = hero.equippedItem;
    if (item && item.effect_id === 'ITEM_MASK') {
        if (item.class) return item.class;
        const m = /^(\w+)\s+Mask$/.exec(item.name || '');
        if (m) return m[1];
    }
    return hero.class;
}

function winStats(player) {
    if (!player) return { monsters: 0, uniqueClasses: 0 };
    const monsters = player.slainMonsters ? player.slainMonsters.length : 0;
    const classes = new Set();
    if (player.leader && player.leader.class) classes.add(player.leader.class);
    (player.party || []).forEach(c => {
        const cls = effectiveHeroClass(c);
        if (cls) classes.add(cls);
    });
    return { monsters, uniqueClasses: classes.size };
}

function startServer(port, log) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['server.js'], {
            cwd: REPO,
            env: { ...process.env, PORT: String(port) },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const info = { child, crashed: null, stderrTail: [], stdoutTail: [] };
        let ready = false;
        child.stdout.on('data', d => {
            const s = d.toString();
            info.stdoutTail.push(s);
            if (info.stdoutTail.length > 400) info.stdoutTail.shift();
            if (!ready && s.includes('Server listening')) { ready = true; resolve(info); }
        });
        child.stderr.on('data', d => {
            const s = d.toString();
            info.stderrTail.push(s);
            if (info.stderrTail.length > 100) info.stderrTail.shift();
        });
        child.on('exit', (code, signal) => {
            if (!info.killedByHarness) {
                info.crashed = { code, signal, stderr: info.stderrTail.join('').slice(-4000) };
                if (!ready) reject(new Error(`server exited before ready: ${code}`));
            }
        });
        setTimeout(() => { if (!ready) { child.kill(); reject(new Error('server never became ready')); } }, 15000);
    });
}

// Injected once per page: record every gameStateUpdate + freeze the GAMEOVER snapshot
// (the server auto-resets to LOBBY ~5s after game over, so it must be captured live).
async function installStateHook(page) {
    await page.waitForFunction(() => window._socket && window._socket.connected, null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => {
        if (window.__hooked) return;
        window.__hooked = true;
        window.__updates = 0;
        window._socket.on('gameStateUpdate', s => {
            window.__hstate = s;
            window.__updates++;
            window.__myId = s.me || window._socket.id;
            if (s.state === 'GAMEOVER' && !window.__gameover) {
                window.__gameover = JSON.parse(JSON.stringify(s));
            }
        });
    });
}

async function readState(page) {
    return page.evaluate(() => ({
        state: window.__hstate || null,
        myId: window.__myId || null,
        gameover: window.__gameover || null,
        updates: window.__updates || 0,
    })).catch(() => null);
}

// DOM-vs-received-state consistency for one page. Returns a mismatch string or null.
async function checkDesync(page) {
    return page.evaluate(() => {
        const s = window.__hstate;
        const me = window.__myId;
        if (!s || !me || !s.players || !s.players[me]) return null;
        if (s.state === 'LOBBY' || s.state === 'GAMEOVER') return null;
        const my = s.players[me];
        // Category-5 canary: the server must NEVER mask a player's own hand.
        const hiddenOwn = (my.hand || []).filter(c => c && c.type === 'Hidden').length;
        if (hiddenOwn > 0) return `own hand contains ${hiddenOwn} Hidden card(s) — server mismasking`;
        const handEls = [...document.querySelectorAll('#player-hand .card[data-id]')];
        const handDom = handEls.length;
        const handState = (my.hand || []).length;
        if (handDom !== handState) {
            // Enrich: which id(s) are in the DOM but not in state, and what marks
            // the extra element (animation/ghost class, visibility). Distinguishes
            // a real orphaned card from a transient mid-render sample.
            const stateIds = new Set((my.hand || []).map(c => c.id));
            const domIds = handEls.map(e => e.dataset.id);
            const extra = handEls.filter(e => !stateIds.has(e.dataset.id))
                .map(e => `${e.dataset.id}[${e.className.replace(/\s+/g, '.').slice(0, 70)}|vis=${getComputedStyle(e).visibility}|op=${getComputedStyle(e).opacity}]`);
            const missing = [...stateIds].filter(id => !domIds.includes(id));
            return `hand DOM=${handDom} state=${handState} | extraDom=${JSON.stringify(extra)} | missingFromDom=${JSON.stringify(missing)} | animActive=${document.body.className.match(/\S*strike\S*|\S*anim\S*/g) || 'none'}`;
        }
        const partyDom = document.querySelectorAll('#player-party .card[data-id]').length;
        const partyState = (my.party || []).length;
        if (partyDom !== partyState) return `party DOM=${partyDom} state=${partyState}`;
        return null;
    }).catch(() => null);
}

async function runGame(opts) {
    const {
        port = 3200,
        playerCount = 6,
        orientation = 'landscape',
        seed = Date.now() % 2147483647,
        headless = true,
        gameIndex = 0,
        lane = 1,
        signal = null,
        log = () => {},
    } = opts;

    const verdict = {
        ok: false, breaker: null, cosmetic: [], winner: null, winReason: null,
        seed, orientation, playerCount, durationMs: 0, gameIndex,
    };
    const started = Date.now();
    const actionLog = [];
    const consoleErrors = [];

    let server;
    try {
        server = await startServer(port, log);
    } catch (e) {
        verdict.breaker = { kind: 'server-crash', detail: `failed to start: ${e.message}` };
        return verdict;
    }

    const browser = await chromium.launch({ headless });
    const pages = [];
    const contexts = [];
    let stopped = false;
    const stop = (breaker) => {
        if (breaker && !verdict.breaker) verdict.breaker = breaker;
        stopped = true;
    };
    const abortRun = () => stop({ kind: 'aborted', detail: 'cancelled because another lane broke the streak' });
    if (signal?.aborted) abortRun();
    signal?.addEventListener('abort', abortRun, { once: true });

    try {
        for (let i = 0; i < playerCount; i++) {
            const ctx = await browser.newContext({
                viewport: VIEWPORTS[orientation],
                hasTouch: true,
                serviceWorkers: 'block',
                deviceScaleFactor: 1,
            });
            contexts.push(ctx);
            const page = await ctx.newPage();
            const name = `P${i + 1}`;
            page.on('pageerror', err => {
                consoleErrors.push({ player: name, kind: 'pageerror', text: String(err && err.message || err) });
                stop({ kind: 'console-error', detail: `${name} pageerror: ${err.message}` });
            });
            page.on('console', msg => {
                if (msg.type() === 'error') {
                    const text = msg.text();
                    // Resource 404s are logged as console errors by Chromium; treat missing
                    // asset fetches as cosmetic, real JS errors as breakers.
                    if (/Failed to load resource/i.test(text)) {
                        verdict.cosmetic.push({ player: name, kind: 'resource-error', text: text.slice(0, 300) });
                    } else {
                        consoleErrors.push({ player: name, kind: 'console', text: text.slice(0, 500) });
                        stop({ kind: 'console-error', detail: `${name} console.error: ${text.slice(0, 500)}` });
                    }
                }
            });
            page.on('crash', () => stop({ kind: 'console-error', detail: `${name} page crashed` }));
            await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
            await installStateHook(page);
            pages.push({ page, name, rng: brain.makeRng(seed + i * 7919 + 1), memory: {}, busy: false, desyncStreak: 0, lastDesync: null });
        }

        // Per-player act loop + global watchdog.
        let lastProgressSig = '';
        let lastProgressAt = Date.now();
        let lastDesyncCheck = 0;

        const playerLoop = async (p) => {
            while (!stopped) {
                try {
                    if (p.busy) { await sleep(TICK_MS); continue; }
                    p.busy = true;
                    // Stranded overlays (inspector/peek/pool) block all taps — service them first.
                    await driver.handleStrayModals(p.page).catch(() => {});
                    // Modal prompts next (heroPlayedPrompt has no state of its own).
                    const prompted = await driver.handleSkillPrompt(p.page, p.rng);
                    if (!prompted) {
                        const snap = await readState(p.page);
                        if (snap && snap.state && snap.myId) {
                            const decision = brain.decide(snap.state, snap.myId, p.rng, p.memory);
                            if (decision) {
                                if (decision.type !== 'KEEP_LEADER' && decision.type !== 'GAMEOVER') {
                                    const entry = { t: Date.now() - started, p: p.name, d: decision.type, x: decision.cardName || decision.monsterName || decision.pendingType || '' };
                                    actionLog.push(entry);
                                    if (actionLog.length > 500) actionLog.shift();
                                    try {
                                        const ok = await driver.perform(p.page, decision, { name: p.name, rng: p.rng });
                                        entry.r = ok === false ? 'F' : 'ok';
                                    } catch (e) {
                                        entry.r = `ERR:${String(e && e.message || e).slice(0, 120)}`;
                                    }
                                    entry.ms = (Date.now() - started) - entry.t;
                                }
                            }
                        }
                    }
                } catch (e) {
                    // Individual action failures are normal races; the loop re-decides.
                } finally {
                    p.busy = false;
                }
                await sleep(TICK_MS + Math.floor(p.rng() * TICK_JITTER_MS));
            }
        };

        const loops = pages.map(playerLoop);

        // Watchdog / verdict loop.
        let lastHeartbeat = Date.now();
        while (!stopped) {
            await sleep(1000);

            if (Date.now() - lastHeartbeat > 30000) {
                lastHeartbeat = Date.now();
                const hb = await readState(pages[0].page);
                if (hb && hb.state) {
                    const s = hb.state;
                    const stats = (s.playerOrder || []).map(id => {
                        const p = s.players[id] || {};
                        return `${(p.hand || []).length}h/${(p.slainMonsters || []).length}m`;
                    }).join(' ');
                    console.log(`[lane ${lane} game ${gameIndex}] ${Math.round((Date.now() - started) / 1000)}s state=${s.state} active=${(s.playerOrder || []).indexOf(s.activePlayerSocketId) + 1} players=[${stats}]`);
                }
            }

            if (server.crashed) {
                stop({ kind: 'server-crash', detail: `exit code ${server.crashed.code}, stderr: ${server.crashed.stderr.slice(-1500)}` });
                break;
            }
            if (Date.now() - started > GAME_CAP_MS) {
                stop({ kind: 'softlock', detail: `game exceeded hard cap ${GAME_CAP_MS}ms` });
                break;
            }

            const snap = await readState(pages[0].page);
            if (snap && snap.gameover) {
                // Validate the win.
                const go = snap.gameover;
                const winnerId = go.winner;
                const w = winnerId ? winStats(go.players[winnerId]) : { monsters: 0, uniqueClasses: 0 };
                verdict.winner = winnerId;
                if (!winnerId || (w.monsters < 3 && w.uniqueClasses < 6)) {
                    stop({ kind: 'wrong-win', detail: `GAMEOVER with winner=${winnerId}, monsters=${w.monsters}, classes=${w.uniqueClasses}` });
                } else {
                    verdict.winReason = w.monsters >= 3 ? `${w.monsters} monsters` : `${w.uniqueClasses} classes`;
                    verdict.ok = true;
                    stop(null);
                }
                break;
            }

            // Missed-win check: someone already meets a win condition but game goes on.
            if (snap && snap.state && snap.state.state === 'PLAYING' && snap.state.players) {
                for (const pid of snap.state.playerOrder || []) {
                    const st = winStats(snap.state.players[pid]);
                    if (st.monsters >= 3 || st.uniqueClasses >= 6) {
                        // Give the server a grace period (win checks run on resolution).
                        if (!verdict._winPendingSince) verdict._winPendingSince = Date.now();
                        else if (Date.now() - verdict._winPendingSince > 30000) {
                            stop({ kind: 'wrong-win', detail: `player ${pid} meets win (${st.monsters}m/${st.uniqueClasses}c) for >30s without GAMEOVER` });
                        }
                    }
                }
            }

            // Progress signature: any change counts (state, active player, AP, hand sizes, pending ids).
            if (snap && snap.state) {
                const s = snap.state;
                const sig = JSON.stringify([
                    s.state, s.activePlayerSocketId, snap.updates,
                    (s.playerOrder || []).map(id => {
                        const p = s.players[id] || {};
                        return [p.ap, (p.hand || []).length, (p.party || []).length, (p.slainMonsters || []).length];
                    }),
                    s.pendingAction && s.pendingAction.type, s.pendingRoll && s.pendingRoll.rollerId,
                ]);
                if (sig !== lastProgressSig) { lastProgressSig = sig; lastProgressAt = Date.now(); }
                else if (Date.now() - lastProgressAt > SOFTLOCK_MS) {
                    stop({ kind: 'softlock', detail: `no progress for ${SOFTLOCK_MS}ms in state ${s.state}; lastActions=${JSON.stringify(actionLog.slice(-12))}` });
                    break;
                }
            }

            // Desync: require the same mismatch on two consecutive 5s checks.
            if (Date.now() - lastDesyncCheck > 5000) {
                lastDesyncCheck = Date.now();
                for (const p of pages) {
                    const mismatch = await checkDesync(p.page);
                    if (mismatch && mismatch === p.lastDesync) {
                        p.desyncStreak++;
                        if (p.desyncStreak >= 2) {
                            stop({ kind: 'desync', detail: `${p.name}: ${mismatch} (stable across checks)` });
                        }
                    } else {
                        p.desyncStreak = mismatch ? 1 : 0;
                    }
                    p.lastDesync = mismatch;
                }
            }
        }

        stopped = true;
        await Promise.allSettled(loops);

        // Diagnosis aid: freeze what every player saw at the moment of a breaker.
        if (verdict.breaker) {
            const fs = require('fs');
            const shotDir = path.join(__dirname, 'results', 'breaks');
            fs.mkdirSync(shotDir, { recursive: true });
            const tag = `${orientation}-g${gameIndex}-${verdict.breaker.kind}`;
            for (const p of pages) {
                await p.page.screenshot({ path: path.join(shotDir, `${tag}-${p.name}.png`) }).catch(() => {});
            }
            verdict.breakShots = path.join(shotDir, tag + '-*.png');
        }
    } catch (e) {
        if (!verdict.breaker) verdict.breaker = { kind: 'harness-error', detail: String(e && e.stack || e) };
    } finally {
        stopped = true;
        signal?.removeEventListener('abort', abortRun);
        for (const ctx of contexts) await ctx.close().catch(() => {});
        await browser.close().catch(() => {});
        if (server && server.child) {
            server.killedByHarness = true;
            server.child.kill();
        }
    }

    verdict.durationMs = Date.now() - started;
    verdict.consoleErrors = consoleErrors;
    verdict.actionsTail = actionLog.slice(-30);
    delete verdict._winPendingSince;
    return verdict;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { runGame, winStats };
