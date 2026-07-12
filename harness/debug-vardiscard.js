// Isolated reproduction of the WAITING_FOR_VARIABLE_DISCARD softlock.
// Stages Qi Bear's "discard up to 3 -> destroy" via real socket flow, then runs
// the driver's DISCARD_PENALTY steps with full DOM + socket-emit tracing.
const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');
const brain = require('./brain');
const driver = require('./driver');

const PORT = 3400;
const REPO = path.join(__dirname, '..');

async function rollLeader(page, name) {
    await page.fill('#player-name-input', name);
    await page.getByText('ROLL FOR LEADER').click();
    await page.locator('#player-name-input').waitFor({ state: 'hidden', timeout: 10000 });
}

(async () => {
    const server = spawn(process.execPath, ['server.js'], {
        cwd: REPO, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((res, rej) => {
        server.stdout.on('data', d => { if (d.toString().includes('Server listening')) res(); });
        setTimeout(() => rej(new Error('server timeout')), 10000);
    });

    const browser = await chromium.launch();
    const opts = { viewport: { width: 844, height: 390 }, hasTouch: true, serviceWorkers: 'block' };
    const c1 = await browser.newContext(opts);
    const c2 = await browser.newContext(opts);
    const host = await c1.newPage();
    const guest = await c2.newPage();
    host.on('console', m => { if (m.type() === 'error') console.log('[host console.error]', m.text()); });
    host.on('pageerror', e => console.log('[host pageerror]', e.message));

    await host.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'domcontentloaded' });
    await guest.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'domcontentloaded' });
    await rollLeader(host, 'HostPlayer');
    await rollLeader(guest, 'GuestPlayer');
    await host.locator('#start-game-btn').waitFor({ state: 'visible', timeout: 10000 });
    await host.click('#start-game-btn', { force: true });
    await host.locator('#app-container').waitFor({ state: 'visible', timeout: 12000 });

    // Trace every socket emit from the host page.
    await host.evaluate(() => {
        const orig = window._socket.emit.bind(window._socket);
        window.__emits = [];
        window._socket.emit = (ev, ...args) => {
            window.__emits.push({ t: Date.now(), ev, args: JSON.parse(JSON.stringify(args || [])) });
            return orig(ev, ...args);
        };
        window._socket.on('gameStateUpdate', s => { window.__hstate = s; window.__myId = s.me || window._socket.id; });
    });

    // Stage: Qi Bear (card_022) in host party; in-party skill use costs AP
    // (isFree:false — the free path is only for the just-played prompt).
    await host.evaluate(() => window._socket.emit('debug_inject_to_party', { cardId: 'card_022' }));
    // Qi Bear caps the discard to destroyable OPPONENT heroes — give the guest one.
    await guest.evaluate(() => window._socket.emit('debug_inject_to_party', { cardId: 'card_016' }));
    await host.waitForTimeout(300);
    await host.evaluate(() => window._socket.emit('use_hero_skill', { cardId: 'card_022', isFree: false }));
    const st1 = await host.waitForFunction(() => window.__hstate && ['WAITING_TO_ROLL', 'WAITING_FOR_MODIFIERS'].includes(window.__hstate.state), null, { timeout: 8000 })
        .then(() => true).catch(() => false);
    if (!st1) {
        console.log('skill did not reach roll; state =', await host.evaluate(() => window.__hstate?.state));
        await browser.close(); server.kill(); process.exit(2);
    }
    if (await host.evaluate(() => window.__hstate.state === 'WAITING_TO_ROLL')) {
        await host.evaluate(() => window._socket.emit('execute_roll'));
    }
    await host.waitForFunction(() => window.__hstate && window.__hstate.state === 'WAITING_FOR_MODIFIERS', null, { timeout: 8000 }).catch(() => {});
    for (const pg of [host, guest]) {
        await pg.evaluate(() => { window._socket.emit('pass_modifiers'); window._socket.emit('submit_modifier_action', { action: 'PASS' }); }).catch(() => {});
    }

    // Wait for the variable-discard state (modifier timer auto-resolves in 15s worst case).
    await host.waitForFunction(() => window.__hstate && window.__hstate.state === 'WAITING_FOR_VARIABLE_DISCARD', null, { timeout: 25000 })
        .catch(async () => {
            const s = await host.evaluate(() => window.__hstate && window.__hstate.state);
            console.log('did not reach VARIABLE_DISCARD; state =', s, '(roll may have failed — rerun)');
            await browser.close(); server.kill(); process.exit(2);
        });

    console.log('=== reached WAITING_FOR_VARIABLE_DISCARD ===');
    const dump = async (label) => {
        const d = await host.evaluate(() => ({
            state: window.__hstate.state,
            pending: window.__hstate.pendingAction,
            bannerVisible: !!document.querySelector('#target-banner:not(.hidden)'),
            bannerHtml: (document.getElementById('target-banner-text') || {}).innerHTML || '',
            inspectorOpen: !!document.querySelector('#inspector-modal:not(.hidden)'),
            inspectorButtons: [...document.querySelectorAll('#inspector-modal-actions button')].map(b => b.innerText),
            handCards: [...document.querySelectorAll('#player-hand .card')].map(c => ({ id: c.dataset.id, cls: c.className.slice(0, 60) })),
            emits: window.__emits.slice(-5),
        }));
        console.log(`--- ${label} ---`);
        console.log(JSON.stringify(d, null, 1).slice(0, 3000));
    };

    await dump('before driver');

    // Run the exact harness decision + perform.
    const snap = await host.evaluate(() => ({ state: window.__hstate, myId: window.__myId }));
    const decision = brain.decide(snap.state, snap.myId, brain.makeRng(1), {});
    console.log('decision =', JSON.stringify(decision));
    const t0 = Date.now();
    const ok = await driver.perform(host, decision, { name: 'HOST', rng: brain.makeRng(2) });
    console.log(`perform -> ${ok} in ${Date.now() - t0}ms`);

    await host.waitForTimeout(1000);
    await dump('after driver');

    // Probe: does the inline onclick global even exist? Then DOM-click it raw.
    const probe = await host.evaluate(() => {
        const btn = document.querySelector('#target-banner button');
        return {
            fnType: typeof window.submitPenaltyDiscard,
            btnText: btn && btn.innerText,
            onclickAttr: btn && btn.getAttribute('onclick'),
            bannerPointerEvents: getComputedStyle(document.getElementById('target-banner')).pointerEvents,
            btnPointerEvents: btn ? getComputedStyle(btn).pointerEvents : null,
        };
    });
    console.log('PROBE:', JSON.stringify(probe));
    await host.evaluate(() => { const b = document.querySelector('#target-banner button'); if (b) b.click(); });
    await host.waitForTimeout(800);
    console.log('AFTER RAW DOM CLICK:', JSON.stringify(await host.evaluate(() => ({
        state: window.__hstate.state,
        lastEmits: window.__emits.slice(-2).map(e => e.ev),
    }))));
    const finalState = await host.evaluate(() => window.__hstate.state);
    console.log('FINAL STATE:', finalState);

    await browser.close(); server.kill();
})();
