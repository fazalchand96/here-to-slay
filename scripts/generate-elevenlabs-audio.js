#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const plan = require('./audio/elevenlabs-audio-plan');

const ROOT = path.resolve(__dirname, '..');
const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';

function loadDotEnv() {
    const envPath = path.join(ROOT, '.env');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const index = trimmed.indexOf('=');
        const key = trimmed.slice(0, index).trim();
        let value = trimmed.slice(index + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (key && process.env[key] === undefined) process.env[key] = value;
    }
}

function parseArgs(argv) {
    const args = {
        dryRun: false,
        force: false,
        voices: false,
        sfx: false,
        music: false,
        leader: '',
        limit: Infinity
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--dry-run') args.dryRun = true;
        else if (arg === '--force') args.force = true;
        else if (arg === '--all') args.voices = args.sfx = args.music = true;
        else if (arg === '--voices') args.voices = true;
        else if (arg === '--sfx') args.sfx = true;
        else if (arg === '--music') args.music = true;
        else if (arg === '--leader') args.leader = argv[++i] || '';
        else if (arg.startsWith('--leader=')) args.leader = arg.slice('--leader='.length);
        else if (arg === '--limit') args.limit = Number(argv[++i] || Infinity);
        else if (arg.startsWith('--limit=')) args.limit = Number(arg.slice('--limit='.length));
        else if (arg === '--help' || arg === '-h') args.help = true;
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!args.voices && !args.sfx && !args.music) args.voices = args.sfx = args.music = true;
    if (!Number.isFinite(args.limit) || args.limit <= 0) args.limit = Infinity;
    return args;
}

function printHelp() {
    console.log(`Generate Here To Slay audio with ElevenLabs.

Usage:
  npm run audio:plan
  npm run audio:generate -- --sfx --limit=3
  npm run audio:generate -- --voices --leader=card_136
  npm run audio:generate -- --music

Environment:
  ELEVENLABS_API_KEY=...
  ELEVENLABS_VOICE_CARD_136=...  # one per Party Leader

Flags:
  --dry-run       List work without calling ElevenLabs
  --all           Generate voices, SFX, and music
  --voices        Generate Party Leader voice files
  --sfx           Generate sound effects
  --music         Generate music loops
  --leader=<id>   Restrict voice generation to one leader, e.g. card_136
  --limit=<n>     Generate at most n files
  --force         Overwrite files that already exist
`);
}

function toAbs(file) {
    return path.resolve(ROOT, file);
}

function ensureDir(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
}

function publicVoiceFile(leaderId, lineId) {
    return `public/sounds/voices/${leaderId}/${lineId}.mp3`;
}

function voiceIdFor(leader) {
    return leader.voiceId || process.env[leader.voiceIdEnv || ''] || '';
}

function collectJobs(args) {
    const jobs = [];
    if (args.voices) {
        Object.entries(plan.leaders).forEach(([leaderId, leader]) => {
            if (args.leader && args.leader !== leaderId) return;
            Object.entries(leader.lines || {}).forEach(([lineId, text]) => {
                jobs.push({
                    kind: 'voice',
                    id: `${leaderId}:${lineId}`,
                    file: publicVoiceFile(leaderId, lineId),
                    text,
                    leaderId,
                    leaderName: leader.name,
                    casting: leader.casting,
                    voiceId: voiceIdFor(leader)
                });
            });
        });
    }
    if (args.sfx) {
        Object.entries(plan.sfx).forEach(([id, item]) => {
            jobs.push({
                kind: 'sfx',
                id,
                file: item.file,
                text: item.text,
                duration_seconds: item.duration_seconds,
                loop: item.loop === true,
                prompt_influence: item.prompt_influence ?? 0.45
            });
        });
    }
    if (args.music) {
        Object.entries(plan.music).forEach(([id, item]) => {
            jobs.push({
                kind: 'music',
                id,
                file: item.file,
                prompt: item.prompt,
                music_length_ms: item.music_length_ms,
                force_instrumental: item.force_instrumental !== false
            });
        });
    }
    return jobs;
}

async function postAudio(endpoint, apiKey, body, outputFormat) {
    const url = `${ELEVENLABS_BASE_URL}${endpoint}?output_format=${encodeURIComponent(outputFormat)}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
    }
    return Buffer.from(await response.arrayBuffer());
}

async function generateJob(job, apiKey) {
    if (job.kind === 'voice') {
        if (!job.voiceId) {
            throw new Error(`Missing voice id for ${job.leaderName}. Set ${plan.leaders[job.leaderId].voiceIdEnv} in .env.`);
        }
        return postAudio(`/text-to-speech/${encodeURIComponent(job.voiceId)}`, apiKey, {
            text: job.text,
            model_id: process.env.ELEVENLABS_TTS_MODEL || plan.textToSpeechModel,
            voice_settings: plan.voiceSettings
        }, plan.outputFormat);
    }
    if (job.kind === 'sfx') {
        return postAudio('/sound-generation', apiKey, {
            text: job.text,
            duration_seconds: job.duration_seconds,
            loop: job.loop,
            prompt_influence: job.prompt_influence,
            model_id: plan.soundEffectsModel
        }, plan.outputFormat);
    }
    if (job.kind === 'music') {
        return postAudio('/music', apiKey, {
            prompt: job.prompt,
            music_length_ms: job.music_length_ms,
            model_id: process.env.ELEVENLABS_MUSIC_MODEL || plan.musicModel,
            force_instrumental: job.force_instrumental
        }, plan.outputFormat);
    }
    throw new Error(`Unsupported job kind: ${job.kind}`);
}

function printPlan(jobs, args) {
    let planned = 0;
    let skippedExisting = 0;
    let missingVoiceIds = 0;
    jobs.forEach(job => {
        const abs = toAbs(job.file);
        const exists = fs.existsSync(abs);
        if (exists && !args.force) {
            skippedExisting += 1;
            return;
        }
        if (job.kind === 'voice' && !job.voiceId) missingVoiceIds += 1;
        planned += 1;
        const extra = job.kind === 'voice' ? ` (${job.leaderName})` : '';
        console.log(`[plan] ${job.kind.padEnd(5)} ${job.id}${extra} -> ${job.file}`);
    });
    console.log(`\nPlanned: ${planned}. Existing skipped: ${skippedExisting}. Missing voice IDs: ${missingVoiceIds}.`);
}

async function main() {
    loadDotEnv();
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return;
    }

    const jobs = collectJobs(args);
    printPlan(jobs, args);
    if (args.dryRun) return;

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error('Missing ELEVENLABS_API_KEY. Add it to .env or your shell environment.');

    let written = 0;
    for (const job of jobs) {
        if (written >= args.limit) break;
        const abs = toAbs(job.file);
        if (fs.existsSync(abs) && !args.force) continue;
        if (job.kind === 'voice' && !job.voiceId) {
            console.warn(`[skip] ${job.id}: missing ${plan.leaders[job.leaderId].voiceIdEnv}`);
            continue;
        }
        console.log(`[generate] ${job.kind} ${job.id}`);
        const audio = await generateJob(job, apiKey);
        ensureDir(abs);
        fs.writeFileSync(abs, audio);
        console.log(`[write] ${job.file} (${audio.length} bytes)`);
        written += 1;
    }
    console.log(`Done. Generated ${written} file(s).`);
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
