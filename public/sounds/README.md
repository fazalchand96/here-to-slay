# Here To Slay Audio Assets

Audio is manifest-driven from `public/audio_manifest.js`.

Drop generated ElevenLabs assets into these folders:

- `sfx/` for short game sounds such as `roll.mp3`, `card_drop.mp3`, `monster_slay.mp3`.
- `voices/<leader-card-id>/` for Party Leader voice lines, for example `voices/card_136/steal_01.mp3`.
- `music/` for `lobby_loop.mp3` and `game_loop.mp3`.

Production direction:

- Voices are short English one-liners, usually 1-2 seconds.
- Voice lines are random and cooldown-controlled in `app.js`; do not make every action speak.
- Music should be warm, playful chibi fantasy with soft strings, woodwinds, light percussion, and magical accents.
- Keep final files small. The first ElevenLabs batch uses `.mp3` because the API returns it directly.
