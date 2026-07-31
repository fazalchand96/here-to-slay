module.exports = {
    outputFormat: 'mp3_44100_128',
    textToSpeechModel: 'eleven_multilingual_v2',
    soundEffectsModel: 'eleven_text_to_sound_v2',
    musicModel: 'music_v2',
    voiceSettings: {
        stability: 0.42,
        similarity_boost: 0.78,
        style: 0.42,
        use_speaker_boost: true
    },
    leaders: {
        card_132: {
            name: 'The Charismatic Song',
            voiceIdEnv: 'ELEVENLABS_VOICE_CARD_132',
            casting: 'charming theatrical warm lightly musical bard, playful stage confidence',
            lines: {
                intro_01: 'I am the Bard. Let the song of battle begin!',
                card_played_01: 'A fine entrance, if I do say so.',
                card_played_02: 'Now the chorus gets interesting.',
                success_01: 'And the crowd goes wild.',
                success_02: 'Perfect timing, perfect drama.',
                failure_01: 'A sour note. We recover.',
                failure_02: 'Not my best verse.',
                challenge_01: 'Oh, a duet? Delightful.',
                sacrifice_01: 'Every ballad needs a tragic part.'
            }
        },
        card_133: {
            name: 'The Fist of Reason',
            voiceIdEnv: 'ELEVENLABS_VOICE_CARD_133',
            casting: 'confident dry direct sturdy fighter, blunt but not angry',
            lines: {
                intro_01: 'I am the Fighter. Strength settles every argument.',
                card_played_01: 'Simple plan. Hit harder.',
                card_played_02: 'That will do the job.',
                success_01: 'Reason prevails.',
                success_02: 'Told you it would work.',
                failure_01: 'Fine. Again, but harder.',
                failure_02: 'That was annoying.',
                challenge_01: 'You want to argue with me?',
                destroy_01: 'Problem removed.'
            }
        },
        card_134: {
            name: 'The Protecting Horn',
            voiceIdEnv: 'ELEVENLABS_VOICE_CARD_134',
            casting: 'calm noble protective guardian, deep reliable gentle authority',
            lines: {
                intro_01: 'I am the Guardian. None shall pass my watch.',
                card_played_01: 'Hold the line.',
                card_played_02: 'Stand behind me.',
                success_01: 'Protected, as promised.',
                success_02: 'The shield holds.',
                failure_01: 'Even walls can crack.',
                failure_02: 'Regroup. Stay close.',
                modifier_01: 'Let me steady that fate.',
                victim_01: 'You will answer for that.'
            }
        },
        card_135: {
            name: 'The Divine Arrow',
            voiceIdEnv: 'ELEVENLABS_VOICE_CARD_135',
            casting: 'focused precise calm ranger scout, quiet confidence and sharp aim',
            lines: {
                intro_01: 'I am the Ranger. My aim never wavers.',
                card_played_01: 'Eyes open.',
                card_played_02: 'I see the path.',
                success_01: 'Clean shot.',
                success_02: 'Exactly where I aimed.',
                failure_01: 'The wind shifted.',
                failure_02: 'I will adjust.',
                attack_01: 'Target marked.',
                monster_slayed_01: 'The beast is down.'
            }
        },
        card_136: {
            name: 'The Shadow Claw',
            voiceIdEnv: 'ELEVENLABS_VOICE_CARD_136',
            casting: 'sly whispering playful arrogant rogue, quick and sneaky',
            lines: {
                intro_01: "I am the Thief. What's yours is already mine.",
                card_played_01: 'Do not mind me.',
                card_played_02: 'A little misdirection.',
                success_01: 'Too easy.',
                success_02: 'You never saw me.',
                failure_01: 'That was a decoy. Obviously.',
                failure_02: 'I meant to do that quietly.',
                steal_01: 'I will be borrowing this.',
                steal_02: 'Finders keepers.',
                victim_01: 'Hey, I was using that.'
            }
        },
        card_137: {
            name: 'The Cloaked Sage',
            voiceIdEnv: 'ELEVENLABS_VOICE_CARD_137',
            casting: 'mysterious wise slightly eccentric wizard, bright magical curiosity',
            lines: {
                intro_01: 'I am the Wizard. Power beyond your reckoning.',
                card_played_01: 'Curious. Very curious.',
                card_played_02: 'A useful little spell.',
                success_01: 'As the runes suggested.',
                success_02: 'The math was never in doubt.',
                failure_01: 'The universe misread me.',
                failure_02: 'Unusual. Irritating, but unusual.',
                magic_01: 'Magic loves an audience.',
                draw_01: 'Knowledge finds me.'
            }
        },
        card_171: {
            name: 'The Noble Shaman',
            voiceIdEnv: 'ELEVENLABS_VOICE_CARD_171',
            casting: 'soft spiritual nature-wise druid, old soul with warm restraint',
            lines: {
                intro_01: 'I am the Druid. Balance bends every fate.',
                card_played_01: 'The roots remember.',
                card_played_02: 'Nature moves quietly.',
                success_01: 'Balance is restored.',
                success_02: 'The spirits agree.',
                failure_01: 'The forest says no.',
                failure_02: 'Even roots stumble.',
                modifier_01: 'A small bend in fate.',
                sacrifice_01: 'Return to the earth.'
            }
        },
        card_172: {
            name: 'The Piercing Howl',
            voiceIdEnv: 'ELEVENLABS_VOICE_CARD_172',
            casting: 'loud brave heroic warrior, battle cry energy and steel confidence',
            lines: {
                intro_01: 'I am the Warrior. Arm me well and watch them fall.',
                card_played_01: 'Forward!',
                card_played_02: 'Now we have momentum.',
                success_01: 'That is how it is done.',
                success_02: 'Another step toward glory.',
                failure_01: 'I am not finished.',
                failure_02: 'Again. Louder.',
                equip_01: 'Now that is a proper weapon.',
                attack_01: 'Charge!'
            }
        },
        card_173: {
            name: 'The Gnawing Dread',
            voiceIdEnv: 'ELEVENLABS_VOICE_CARD_173',
            casting: 'dark dry sinister but playful necromancer, theatrical shadow magic without horror',
            lines: {
                intro_01: 'I am the Necromancer. Nothing useful stays buried.',
                card_played_01: 'How deliciously unfortunate.',
                card_played_02: 'Let us disturb the quiet.',
                success_01: 'Back from the brink.',
                success_02: 'The grave was merely storage.',
                failure_01: 'Even doom has paperwork.',
                failure_02: 'That corpse was uncooperative.',
                sacrifice_01: 'A small price for darker doors.',
                discard_01: 'Nothing is truly gone.'
            }
        },
        card_174: {
            name: 'The Raging Manticore',
            voiceIdEnv: 'ELEVENLABS_VOICE_CARD_174',
            casting: 'wild excited explosive berserker, tiny powerhouse with joyful chaos',
            lines: {
                intro_01: 'I am the Berserker. Point me at trouble.',
                card_played_01: 'Yes! More chaos!',
                card_played_02: 'This is getting good.',
                success_01: 'Ha! Crushed it.',
                success_02: 'Again! Again!',
                failure_01: 'Who moved the target?',
                failure_02: 'I was warming up.',
                attack_01: 'I am going in!',
                monster_slayed_01: 'That felt amazing!'
            }
        },
        card_221: {
            name: 'The Fearless Flame',
            voiceIdEnv: 'ELEVENLABS_VOICE_CARD_221',
            casting: 'fiery dramatic impulsive sorcerer, bright arrogance and risky confidence',
            lines: {
                intro_01: 'I am the Sorcerer. A little fire fixes everything.',
                card_played_01: 'Careful. This may sparkle.',
                card_played_02: 'I prefer dramatic solutions.',
                success_01: 'Burning bright.',
                success_02: 'Flawless. Slightly singed.',
                failure_01: 'That flame had opinions.',
                failure_02: 'Still stylish.',
                discard_01: 'Fuel for the fire.',
                modifier_01: 'Let us turn up the heat.'
            }
        }
    },
    sfx: {
        tap: { file: 'public/sounds/sfx/tap.mp3', duration_seconds: 0.5, text: 'Premium tactile fantasy board game button tap, tiny polished wooden click, soft magical sparkle, very short.' },
        open: { file: 'public/sounds/sfx/open.mp3', duration_seconds: 0.5, text: 'Premium fantasy UI panel opening, soft wood and parchment movement, gentle magical shimmer, short.' },
        close: { file: 'public/sounds/sfx/close.mp3', duration_seconds: 0.5, text: 'Premium fantasy UI panel closing, soft wooden latch and parchment fold, subtle and short.' },
        confirm: { file: 'public/sounds/sfx/confirm.mp3', duration_seconds: 0.55, text: 'Positive fantasy UI confirmation, polished tiny chime, warm satisfying button response, short.' },
        card_drop: { file: 'public/sounds/sfx/card_drop.mp3', duration_seconds: 0.55, text: 'Premium fantasy card placed on wooden tabletop, soft paper slap, subtle magical shimmer, short and crisp.' },
        draw: { file: 'public/sounds/sfx/draw.mp3', duration_seconds: 0.55, text: 'Fantasy card draw from deck, smooth paper slide, premium tactile foley, short.' },
        roll: { file: 'public/sounds/sfx/roll.mp3', duration_seconds: 1.2, text: 'Two dice rolling on a wooden fantasy game board, polished tactile sound, not cheap, resolves cleanly.' },
        challenge: { file: 'public/sounds/sfx/challenge.mp3', duration_seconds: 1.0, text: 'Short whimsical fantasy challenge sting, tiny shield clash, magical sparkle, playful tension.' },
        modifier: { file: 'public/sounds/sfx/modifier.mp3', duration_seconds: 0.7, text: 'Magic modifier card effect, quick bright whoosh, soft chime, premium fantasy UI sound.' },
        skill: { file: 'public/sounds/sfx/skill.mp3', duration_seconds: 0.75, text: 'Hero skill activated in a cute fantasy card game, bright magical flourish, premium but restrained.' },
        magic: { file: 'public/sounds/sfx/magic.mp3', duration_seconds: 0.9, text: 'Whimsical fantasy magic card cast, sparkling arcane whoosh, warm chimes, polished and short.' },
        target: { file: 'public/sounds/sfx/target.mp3', duration_seconds: 0.5, text: 'Target selected in a fantasy board game UI, small focused magical ping, short and clear.' },
        attack: { file: 'public/sounds/sfx/attack.mp3', duration_seconds: 0.9, text: 'Cute fantasy battle attack swoosh with impact, chibi adventure style, polished but not violent.' },
        monster_slay: { file: 'public/sounds/sfx/monster_slay.mp3', duration_seconds: 1.25, text: 'Joyful monster slay reward sting, whimsical fantasy sparkle and small heroic flourish.' },
        steal: { file: 'public/sounds/sfx/steal.mp3', duration_seconds: 0.75, text: 'Sneaky fantasy steal sound, soft whoosh, tiny mischievous chime, premium board game foley.' },
        destroy: { file: 'public/sounds/sfx/destroy.mp3', duration_seconds: 0.9, text: 'Fantasy card destroyed, dramatic but cute magical burst, soft impact, no harsh explosion.' },
        sacrifice: { file: 'public/sounds/sfx/sacrifice.mp3', duration_seconds: 1.0, text: 'Soft mystical sacrifice sound, warm low shimmer, gentle magical fade, fantasy board game.' },
        equip: { file: 'public/sounds/sfx/equip.mp3', duration_seconds: 0.65, text: 'Fantasy item equipped onto a card, tiny metal charm, leather and magic glint, premium and short.' },
        timer_warning: { file: 'public/sounds/sfx/timer_warning.mp3', duration_seconds: 0.5, text: 'Gentle urgent fantasy timer tick, small clock chime, not annoying, short.' },
        timer_urgent: { file: 'public/sounds/sfx/timer_urgent.mp3', duration_seconds: 0.5, text: 'Urgent but cute fantasy timer tick, brighter clock chime, short and clear.' },
        turn: { file: 'public/sounds/sfx/turn.mp3', duration_seconds: 0.7, text: 'Your turn notification in a whimsical fantasy card game, warm magical bell and soft wood tap.' },
        error: { file: 'public/sounds/sfx/error.mp3', duration_seconds: 0.5, text: 'Gentle invalid action sound for fantasy game UI, soft low chime, not harsh or annoying.' },
        join: { file: 'public/sounds/sfx/join.mp3', duration_seconds: 0.75, text: 'Player joins a cozy fantasy lobby, warm tavern bell, tiny magical sparkle, welcoming.' },
        victory: { file: 'public/sounds/sfx/victory.mp3', duration_seconds: 2.2, text: 'Short victory sting for whimsical fantasy card game, warm heroic chime, chibi adventure celebration.' },
        defeat: { file: 'public/sounds/sfx/defeat.mp3', duration_seconds: 1.8, text: 'Short playful defeat sting, soft comedic fantasy disappointment, warm and not harsh.' }
    },
    music: {
        lobby_loop: {
            file: 'public/sounds/music/lobby_loop.mp3',
            music_length_ms: 30000,
            prompt: 'Instrumental seamless loop for a cute fantasy card game lobby. Warm whimsical hand-crafted animation score, gentle woodwinds, soft strings, light marimba, tiny magical sparkles, cozy tavern energy, playful chibi adventure, no vocals, no famous artist imitation.'
        },
        game_loop: {
            file: 'public/sounds/music/game_loop.mp3',
            music_length_ms: 45000,
            prompt: 'Instrumental seamless loop for a whimsical fantasy tabletop card battle. Warm soft strings, gentle woodwinds, light percussion, magical chimes, playful chibi adventure mood, subtle enough to sit under dialogue and sound effects, no vocals, no famous artist imitation.'
        }
    }
};
