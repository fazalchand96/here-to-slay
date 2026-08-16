'use strict';

const { test, expect } = require('../helpers/fixtures');

const SIGNATURE_SOUNDS = {
    card_drop: [0.45, 0.75],
    open: [0.45, 0.55],
    confirm: [0.45, 0.55],
    draw: [0.45, 0.55],
    attack: [0.45, 0.55],
    skill: [0.45, 0.55],
    magic: [0.45, 0.55],
    challenge: [0.45, 0.55],
    modifier: [0.45, 0.55],
    target: [0.45, 0.55],
    equip: [0.45, 0.55],
    timer_warning: [0.45, 0.55],
    timer_urgent: [0.45, 0.55],
    turn: [0.45, 0.55],
    error: [0.45, 0.55],
    join: [0.45, 0.55],
    roll: [0.7, 1.0],
    success: [0.85, 1.15],
    destroy: [0.85, 1.15],
    steal: [1.25, 1.65],
    sacrifice: [0.85, 1.15],
};

const SHADOW_CLAW_VOICES = [
    'intro_01',
    'card_played_01',
    'card_played_02',
    'success_01',
    'success_02',
    'failure_01',
    'failure_02',
    'steal_01',
    'steal_02',
    'victim_01',
];
const CHARISMATIC_SONG_VOICES = [
    'intro_01',
    'card_played_01',
    'card_played_02',
    'success_01',
    'success_02',
    'failure_01',
    'failure_02',
    'challenge_01',
    'sacrifice_01',
];
const FIST_OF_REASON_VOICES = [
    'intro_01',
    'card_played_01',
    'card_played_02',
    'success_01',
    'success_02',
    'failure_01',
    'failure_02',
    'challenge_01',
    'destroy_01',
];
const PROTECTING_HORN_VOICES = [
    'intro_01',
    'card_played_01',
    'card_played_02',
    'success_01',
    'success_02',
    'failure_01',
    'failure_02',
    'modifier_01',
    'victim_01',
];
const DIVINE_ARROW_VOICES = [
    'intro_01',
    'card_played_01',
    'card_played_02',
    'success_01',
    'success_02',
    'failure_01',
    'failure_02',
    'attack_01',
    'monster_slayed_01',
];

test('premium close sound and selected background music decode on mobile', async ({ page }) => {
    await page.goto('/');

    const decoded = await page.evaluate(async () => {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const context = new AudioContextClass();
        const assets = {
            close: '/sounds/sfx/close.mp3',
            music: '/sounds/music/fantasy_rpg_exploration_v2.mp3',
        };
        const results = {};
        for (const [name, url] of Object.entries(assets)) {
            const response = await fetch(url);
            const audioBuffer = await context.decodeAudioData(await response.arrayBuffer());
            results[name] = {
                ok: response.ok,
                type: response.headers.get('content-type'),
                duration: audioBuffer.duration,
                channels: audioBuffer.numberOfChannels,
            };
        }
        await context.close();
        return results;
    });

    expect(decoded.close.ok).toBe(true);
    expect(decoded.close.type).toContain('audio/mpeg');
    expect(decoded.close.duration).toBeGreaterThanOrEqual(0.4);
    expect(decoded.close.duration).toBeLessThanOrEqual(0.7);
    expect(decoded.music.ok).toBe(true);
    expect(decoded.music.type).toContain('audio/mpeg');
    expect(decoded.music.duration).toBeGreaterThan(195);
    expect(decoded.music.duration).toBeLessThan(210);
    expect(decoded.music.channels).toBeGreaterThanOrEqual(1);
});

test('The Fearless Flame approved intro decodes correctly in the mobile browser', async ({ page }) => {
    await page.goto('/');

    const decoded = await page.evaluate(async () => {
        const response = await fetch('/sounds/voices/card_221/intro_01.mp3');
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const context = new AudioContextClass();
        const audioBuffer = await context.decodeAudioData(await response.arrayBuffer());
        await context.close();
        return {
            ok: response.ok,
            type: response.headers.get('content-type'),
            duration: audioBuffer.duration,
            channels: audioBuffer.numberOfChannels,
        };
    });

    expect(decoded.ok).toBe(true);
    expect(decoded.type).toContain('audio/mpeg');
    expect(decoded.channels).toBeGreaterThanOrEqual(1);
    expect(decoded.duration).toBeGreaterThan(1);
    expect(decoded.duration).toBeLessThan(8);
});

test('premium signature WAVs decode correctly in the mobile browser', async ({ page }) => {
    await page.goto('/');

    const decoded = await page.evaluate(async names => {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const context = new AudioContextClass();
        const results = {};
        for (const name of names) {
            const response = await fetch(`/sounds/sfx/${name}.wav`);
            const audioBuffer = await context.decodeAudioData(await response.arrayBuffer());
            results[name] = {
                ok: response.ok,
                type: response.headers.get('content-type'),
                duration: audioBuffer.duration,
                sampleRate: audioBuffer.sampleRate,
                channels: audioBuffer.numberOfChannels,
            };
        }
        await context.close();
        return results;
    }, Object.keys(SIGNATURE_SOUNDS));

    for (const [name, [minimum, maximum]] of Object.entries(SIGNATURE_SOUNDS)) {
        expect(decoded[name].ok, `${name} should load`).toBe(true);
        expect(decoded[name].type).toContain('audio/wav');
        expect(decoded[name].sampleRate).toBe(48_000);
        expect(decoded[name].channels).toBe(2);
        expect(decoded[name].duration).toBeGreaterThanOrEqual(minimum);
        expect(decoded[name].duration).toBeLessThanOrEqual(maximum);
    }
});

test('The Shadow Claw complete voice set decodes correctly in the mobile browser', async ({ page }) => {
    await page.goto('/');

    const decoded = await page.evaluate(async names => {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const context = new AudioContextClass();
        const results = {};
        for (const name of names) {
            const response = await fetch(`/sounds/voices/card_136/${name}.mp3`);
            const audioBuffer = await context.decodeAudioData(await response.arrayBuffer());
            results[name] = {
                ok: response.ok,
                type: response.headers.get('content-type'),
                duration: audioBuffer.duration,
                channels: audioBuffer.numberOfChannels,
            };
        }
        await context.close();
        return results;
    }, SHADOW_CLAW_VOICES);

    for (const name of SHADOW_CLAW_VOICES) {
        expect(decoded[name].ok, `${name} should load`).toBe(true);
        expect(decoded[name].type).toContain('audio/mpeg');
        expect(decoded[name].channels).toBeGreaterThanOrEqual(1);
        expect(decoded[name].duration).toBeGreaterThan(0.5);
        expect(decoded[name].duration).toBeLessThan(5);
    }
});

test('The Charismatic Song complete voice set decodes correctly in the mobile browser', async ({ page }) => {
    await page.goto('/');

    const decoded = await page.evaluate(async names => {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const context = new AudioContextClass();
        const results = {};
        for (const name of names) {
            const response = await fetch(`/sounds/voices/card_132/${name}.mp3`);
            const audioBuffer = await context.decodeAudioData(await response.arrayBuffer());
            results[name] = {
                ok: response.ok,
                type: response.headers.get('content-type'),
                duration: audioBuffer.duration,
                channels: audioBuffer.numberOfChannels,
            };
        }
        await context.close();
        return results;
    }, CHARISMATIC_SONG_VOICES);

    for (const name of CHARISMATIC_SONG_VOICES) {
        expect(decoded[name].ok, `${name} should load`).toBe(true);
        expect(decoded[name].type).toContain('audio/mpeg');
        expect(decoded[name].channels).toBeGreaterThanOrEqual(1);
        expect(decoded[name].duration).toBeGreaterThan(0.5);
        expect(decoded[name].duration).toBeLessThan(5);
    }
});

test('The Fist of Reason complete voice set decodes correctly in the mobile browser', async ({ page }) => {
    await page.goto('/');

    const decoded = await page.evaluate(async names => {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const context = new AudioContextClass();
        const results = {};
        for (const name of names) {
            const response = await fetch(`/sounds/voices/card_133/${name}.mp3`);
            const audioBuffer = await context.decodeAudioData(await response.arrayBuffer());
            results[name] = {
                ok: response.ok,
                type: response.headers.get('content-type'),
                duration: audioBuffer.duration,
                channels: audioBuffer.numberOfChannels,
            };
        }
        await context.close();
        return results;
    }, FIST_OF_REASON_VOICES);

    for (const name of FIST_OF_REASON_VOICES) {
        expect(decoded[name].ok, `${name} should load`).toBe(true);
        expect(decoded[name].type).toContain('audio/mpeg');
        expect(decoded[name].channels).toBeGreaterThanOrEqual(1);
        expect(decoded[name].duration).toBeGreaterThan(0.5);
        expect(decoded[name].duration).toBeLessThan(5);
    }
});

test('The Protecting Horn complete voice set decodes correctly in the mobile browser', async ({ page }) => {
    await page.goto('/');

    const decoded = await page.evaluate(async names => {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const context = new AudioContextClass();
        const results = {};
        for (const name of names) {
            const response = await fetch(`/sounds/voices/card_134/${name}.mp3`);
            const audioBuffer = await context.decodeAudioData(await response.arrayBuffer());
            results[name] = {
                ok: response.ok,
                type: response.headers.get('content-type'),
                duration: audioBuffer.duration,
                channels: audioBuffer.numberOfChannels,
            };
        }
        await context.close();
        return results;
    }, PROTECTING_HORN_VOICES);

    for (const name of PROTECTING_HORN_VOICES) {
        expect(decoded[name].ok, `${name} should load`).toBe(true);
        expect(decoded[name].type).toContain('audio/mpeg');
        expect(decoded[name].channels).toBeGreaterThanOrEqual(1);
        expect(decoded[name].duration).toBeGreaterThan(0.5);
        expect(decoded[name].duration).toBeLessThan(6);
    }
});

test('The Divine Arrow complete voice set decodes correctly in the mobile browser', async ({ page }) => {
    await page.goto('/');

    const decoded = await page.evaluate(async names => {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const context = new AudioContextClass();
        const results = {};
        for (const name of names) {
            const response = await fetch(`/sounds/voices/card_135/${name}.mp3`);
            const audioBuffer = await context.decodeAudioData(await response.arrayBuffer());
            results[name] = {
                ok: response.ok,
                type: response.headers.get('content-type'),
                duration: audioBuffer.duration,
                channels: audioBuffer.numberOfChannels,
            };
        }
        await context.close();
        return results;
    }, DIVINE_ARROW_VOICES);

    for (const name of DIVINE_ARROW_VOICES) {
        expect(decoded[name].ok, `${name} should load`).toBe(true);
        expect(decoded[name].type).toContain('audio/mpeg');
        expect(decoded[name].channels).toBeGreaterThanOrEqual(1);
        expect(decoded[name].duration).toBeGreaterThan(0.5);
        expect(decoded[name].duration).toBeLessThan(6);
    }
});
