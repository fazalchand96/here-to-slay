# Here To Slay Audio Assets

Audio is manifest-driven from `public/audio_manifest.js`.

Party Leader character profiles, Voice Design prompts, and the complete event
line list live in `PARTY_LEADER_VOICE_BIBLE.md`.

Drop generated ElevenLabs assets into these folders:

- `sfx/` for short game sounds such as `roll.mp3`, `card_drop.mp3`, `monster_slay.mp3`.
- `voices/<leader-card-id>/` for Party Leader voice lines, for example `voices/card_136/steal_01.mp3`.
- `music/` for `lobby_loop.mp3` and `game_loop.mp3`.

Production direction:

- Voices are short English one-liners, usually 1-2 seconds.
- Voice lines are random and cooldown-controlled in `app.js`; do not make every action speak.
- Music should be warm, playful chibi fantasy with soft strings, woodwinds, light percussion, and magical accents.
- Keep final files small. The first ElevenLabs batch uses `.mp3` because the API returns it directly.

## Premium signature pack v1

The core in-game actions use mastered 48 kHz stereo WAV files generated with
ElevenLabs Sound Effects and finished with `scripts/master-premium-sfx.py`:

- `card_drop.wav` — tactile illustrated card on worn wood;
- `roll.wav` — two weighty resin dice on wood;
- `success.wav` — restrained brass and crystalline success accent;
- `destroy.wav` — wood impact, magical fracture and card disintegration;
- `steal.wav` — leather/card lift, reverse suction and metal glint;
- `sacrifice.wav` — chain pull, ritual thump, inward embers and muted bell.

All prompts share the same direction: premium dark-fantasy tabletop, tactile,
short, clean on phone speakers, no voices, no music, no arcade bleeps, and no
long cinematic tails. The mastering pass removes generator padding, applies a
35 Hz high-pass, short edge fades, restrained transient compression where
needed, and peak-normalizes to -1 dBFS.
