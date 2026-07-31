window.HTS_AUDIO_MANIFEST = {
    version: 'audio-v2',
    volumes: {
        master: 0.82,
        sfx: 0.74,
        voice: 0.9,
        music: 0.34
    },
    defaults: {
        globalVoiceCooldownMs: 4200,
        leaderVoiceCooldownMs: 10000,
        voiceChance: 0.18
    },
    music: {
        lobby: {
            src: '/sounds/music/lobby_loop.mp3',
            volume: 0.32,
            loop: true
        },
        game: {
            src: '/sounds/music/game_loop.mp3',
            volume: 0.28,
            loop: true
        }
    },
    sfx: {
        tap: { src: '/sounds/sfx/tap.mp3', volume: 0.26 },
        open: { src: '/sounds/sfx/open.mp3', volume: 0.42 },
        close: { src: '/sounds/sfx/close.mp3', volume: 0.34 },
        confirm: { src: '/sounds/sfx/confirm.mp3', volume: 0.5 },
        cardDrop: { src: '/sounds/sfx/card_drop.mp3', volume: 0.58 },
        draw: { src: '/sounds/sfx/draw.mp3', volume: 0.48 },
        dice: { src: '/sounds/sfx/roll.mp3', volume: 0.62 },
        roll: { src: '/sounds/sfx/roll.mp3', volume: 0.62 },
        attack: { src: '/sounds/sfx/attack.mp3', volume: 0.66 },
        slash: { src: '/sounds/sfx/attack.mp3', volume: 0.66 },
        skill: { src: '/sounds/sfx/skill.mp3', volume: 0.54 },
        magic: { src: '/sounds/sfx/magic.mp3', volume: 0.56 },
        challenge: { src: '/sounds/sfx/challenge.mp3', volume: 0.68 },
        modifier: { src: '/sounds/sfx/modifier.mp3', volume: 0.48 },
        target: { src: '/sounds/sfx/target.mp3', volume: 0.36 },
        coin: { src: '/sounds/sfx/monster_slay.mp3', volume: 0.72 },
        monsterSlay: { src: '/sounds/sfx/monster_slay.mp3', volume: 0.72 },
        steal: { src: '/sounds/sfx/steal.mp3', volume: 0.58 },
        destroy: { src: '/sounds/sfx/destroy.mp3', volume: 0.66 },
        sacrifice: { src: '/sounds/sfx/sacrifice.mp3', volume: 0.58 },
        equip: { src: '/sounds/sfx/equip.mp3', volume: 0.52 },
        timerWarning: { src: '/sounds/sfx/timer_warning.mp3', volume: 0.48 },
        timerUrgent: { src: '/sounds/sfx/timer_urgent.mp3', volume: 0.56 },
        turn: { src: '/sounds/sfx/turn.mp3', volume: 0.5 },
        error: { src: '/sounds/sfx/error.mp3', volume: 0.5 },
        join: { src: '/sounds/sfx/join.mp3', volume: 0.42 },
        win: { src: '/sounds/sfx/victory.mp3', volume: 0.78 },
        lose: { src: '/sounds/sfx/defeat.mp3', volume: 0.66 }
    },
    leaders: {
        card_132: {
            className: 'Bard',
            name: 'The Charismatic Song',
            casting: 'charming theatrical warm lightly musical voice, playful stage confidence',
            introText: 'I am the Bard. Let the song of battle begin!',
            voice: {
                intro: ['/sounds/voices/card_132/intro_01.mp3'],
                card_played: ['/sounds/voices/card_132/card_played_01.mp3', '/sounds/voices/card_132/card_played_02.mp3'],
                success: ['/sounds/voices/card_132/success_01.mp3', '/sounds/voices/card_132/success_02.mp3'],
                failure: ['/sounds/voices/card_132/failure_01.mp3', '/sounds/voices/card_132/failure_02.mp3'],
                challenge: ['/sounds/voices/card_132/challenge_01.mp3'],
                sacrifice: ['/sounds/voices/card_132/sacrifice_01.mp3']
            }
        },
        card_133: {
            className: 'Fighter',
            name: 'The Fist of Reason',
            casting: 'confident dry direct sturdy brawler voice, blunt but not angry',
            introText: 'I am the Fighter. Strength settles every argument.',
            voice: {
                intro: ['/sounds/voices/card_133/intro_01.mp3'],
                card_played: ['/sounds/voices/card_133/card_played_01.mp3', '/sounds/voices/card_133/card_played_02.mp3'],
                success: ['/sounds/voices/card_133/success_01.mp3', '/sounds/voices/card_133/success_02.mp3'],
                failure: ['/sounds/voices/card_133/failure_01.mp3', '/sounds/voices/card_133/failure_02.mp3'],
                challenge: ['/sounds/voices/card_133/challenge_01.mp3'],
                destroy: ['/sounds/voices/card_133/destroy_01.mp3']
            }
        },
        card_134: {
            className: 'Guardian',
            name: 'The Protecting Horn',
            casting: 'calm noble protective deep reliable voice, gentle authority',
            introText: 'I am the Guardian. None shall pass my watch.',
            voice: {
                intro: ['/sounds/voices/card_134/intro_01.mp3'],
                card_played: ['/sounds/voices/card_134/card_played_01.mp3', '/sounds/voices/card_134/card_played_02.mp3'],
                success: ['/sounds/voices/card_134/success_01.mp3', '/sounds/voices/card_134/success_02.mp3'],
                failure: ['/sounds/voices/card_134/failure_01.mp3', '/sounds/voices/card_134/failure_02.mp3'],
                modifier: ['/sounds/voices/card_134/modifier_01.mp3'],
                victim: ['/sounds/voices/card_134/victim_01.mp3']
            }
        },
        card_135: {
            className: 'Ranger',
            name: 'The Divine Arrow',
            casting: 'focused precise calm scout voice, quiet confidence and sharp aim',
            introText: 'I am the Ranger. My aim never wavers.',
            voice: {
                intro: ['/sounds/voices/card_135/intro_01.mp3'],
                card_played: ['/sounds/voices/card_135/card_played_01.mp3', '/sounds/voices/card_135/card_played_02.mp3'],
                success: ['/sounds/voices/card_135/success_01.mp3', '/sounds/voices/card_135/success_02.mp3'],
                failure: ['/sounds/voices/card_135/failure_01.mp3', '/sounds/voices/card_135/failure_02.mp3'],
                attack: ['/sounds/voices/card_135/attack_01.mp3'],
                monster_slayed: ['/sounds/voices/card_135/monster_slayed_01.mp3']
            }
        },
        card_136: {
            className: 'Thief',
            name: 'The Shadow Claw',
            casting: 'sly whispering playful arrogant rogue voice, quick and sneaky',
            introText: "I am the Thief. What's yours is already mine.",
            voice: {
                intro: ['/sounds/voices/card_136/intro_01.mp3'],
                card_played: ['/sounds/voices/card_136/card_played_01.mp3', '/sounds/voices/card_136/card_played_02.mp3'],
                success: ['/sounds/voices/card_136/success_01.mp3', '/sounds/voices/card_136/success_02.mp3'],
                failure: ['/sounds/voices/card_136/failure_01.mp3', '/sounds/voices/card_136/failure_02.mp3'],
                steal: ['/sounds/voices/card_136/steal_01.mp3', '/sounds/voices/card_136/steal_02.mp3'],
                victim: ['/sounds/voices/card_136/victim_01.mp3']
            }
        },
        card_137: {
            className: 'Wizard',
            name: 'The Cloaked Sage',
            casting: 'mysterious wise slightly eccentric mage voice, bright magical curiosity',
            introText: 'I am the Wizard. Power beyond your reckoning.',
            voice: {
                intro: ['/sounds/voices/card_137/intro_01.mp3'],
                card_played: ['/sounds/voices/card_137/card_played_01.mp3', '/sounds/voices/card_137/card_played_02.mp3'],
                success: ['/sounds/voices/card_137/success_01.mp3', '/sounds/voices/card_137/success_02.mp3'],
                failure: ['/sounds/voices/card_137/failure_01.mp3', '/sounds/voices/card_137/failure_02.mp3'],
                magic: ['/sounds/voices/card_137/magic_01.mp3'],
                draw: ['/sounds/voices/card_137/draw_01.mp3']
            }
        },
        card_171: {
            className: 'Druid',
            name: 'The Noble Shaman',
            casting: 'soft spiritual nature-wise voice, old soul with warm restraint',
            introText: 'I am the Druid. Balance bends every fate.',
            voice: {
                intro: ['/sounds/voices/card_171/intro_01.mp3'],
                card_played: ['/sounds/voices/card_171/card_played_01.mp3', '/sounds/voices/card_171/card_played_02.mp3'],
                success: ['/sounds/voices/card_171/success_01.mp3', '/sounds/voices/card_171/success_02.mp3'],
                failure: ['/sounds/voices/card_171/failure_01.mp3', '/sounds/voices/card_171/failure_02.mp3'],
                modifier: ['/sounds/voices/card_171/modifier_01.mp3'],
                sacrifice: ['/sounds/voices/card_171/sacrifice_01.mp3']
            }
        },
        card_172: {
            className: 'Warrior',
            name: 'The Piercing Howl',
            casting: 'loud brave battle-cry voice, heroic momentum and steel confidence',
            introText: 'I am the Warrior. Arm me well and watch them fall.',
            voice: {
                intro: ['/sounds/voices/card_172/intro_01.mp3'],
                card_played: ['/sounds/voices/card_172/card_played_01.mp3', '/sounds/voices/card_172/card_played_02.mp3'],
                success: ['/sounds/voices/card_172/success_01.mp3', '/sounds/voices/card_172/success_02.mp3'],
                failure: ['/sounds/voices/card_172/failure_01.mp3', '/sounds/voices/card_172/failure_02.mp3'],
                equip: ['/sounds/voices/card_172/equip_01.mp3'],
                attack: ['/sounds/voices/card_172/attack_01.mp3']
            }
        },
        card_173: {
            className: 'Necromancer',
            name: 'The Gnawing Dread',
            casting: 'dark dry sinister but playful voice, theatrical shadow magic without horror',
            introText: 'I am the Necromancer. Nothing useful stays buried.',
            voice: {
                intro: ['/sounds/voices/card_173/intro_01.mp3'],
                card_played: ['/sounds/voices/card_173/card_played_01.mp3', '/sounds/voices/card_173/card_played_02.mp3'],
                success: ['/sounds/voices/card_173/success_01.mp3', '/sounds/voices/card_173/success_02.mp3'],
                failure: ['/sounds/voices/card_173/failure_01.mp3', '/sounds/voices/card_173/failure_02.mp3'],
                sacrifice: ['/sounds/voices/card_173/sacrifice_01.mp3'],
                discard: ['/sounds/voices/card_173/discard_01.mp3']
            }
        },
        card_174: {
            className: 'Berserker',
            name: 'The Raging Manticore',
            casting: 'wild excited explosive tiny powerhouse voice, joyful chaos and big hits',
            introText: 'I am the Berserker. Point me at trouble.',
            voice: {
                intro: ['/sounds/voices/card_174/intro_01.mp3'],
                card_played: ['/sounds/voices/card_174/card_played_01.mp3', '/sounds/voices/card_174/card_played_02.mp3'],
                success: ['/sounds/voices/card_174/success_01.mp3', '/sounds/voices/card_174/success_02.mp3'],
                failure: ['/sounds/voices/card_174/failure_01.mp3', '/sounds/voices/card_174/failure_02.mp3'],
                attack: ['/sounds/voices/card_174/attack_01.mp3'],
                monster_slayed: ['/sounds/voices/card_174/monster_slayed_01.mp3']
            }
        },
        card_221: {
            className: 'Sorcerer',
            name: 'The Fearless Flame',
            casting: 'fiery dramatic impulsive magical voice, bright arrogance and risky confidence',
            introText: 'I am the Sorcerer. A little fire fixes everything.',
            voice: {
                intro: ['/sounds/voices/card_221/intro_01.mp3'],
                card_played: ['/sounds/voices/card_221/card_played_01.mp3', '/sounds/voices/card_221/card_played_02.mp3'],
                success: ['/sounds/voices/card_221/success_01.mp3', '/sounds/voices/card_221/success_02.mp3'],
                failure: ['/sounds/voices/card_221/failure_01.mp3', '/sounds/voices/card_221/failure_02.mp3'],
                discard: ['/sounds/voices/card_221/discard_01.mp3'],
                modifier: ['/sounds/voices/card_221/modifier_01.mp3']
            }
        }
    },
    events: {
        leader_selected: { voiceEvent: 'intro', chance: 1, priority: 90, globalCooldownMs: 1800, leaderCooldownMs: 1800 },
        card_played: { sfx: 'cardDrop', voiceEvent: 'card_played', chance: 0.16, priority: 30 },
        magic_played: { sfx: 'magic', voiceEvent: 'magic', chance: 0.24, priority: 42 },
        item_equipped: { sfx: 'equip', voiceEvent: 'equip', chance: 0.2, priority: 35 },
        challenge_started: { sfx: 'challenge', voiceEvent: 'challenge', chance: 0.28, priority: 48 },
        modifier_played: { sfx: 'modifier', voiceEvent: 'modifier', chance: 0.18, priority: 36 },
        roll_started: { sfx: 'roll', voiceEvent: 'attack', chance: 0.12, priority: 28 },
        roll_success: { voiceEvent: 'success', chance: 0.22, priority: 40 },
        roll_failed: { voiceEvent: 'failure', chance: 0.2, priority: 38 },
        monster_slayed: { sfx: 'monsterSlay', voiceEvent: 'monster_slayed', chance: 0.58, priority: 72 },
        hero_stolen: { sfx: 'steal', voiceEvent: 'steal', victimVoiceEvent: 'victim', chance: 0.48, victimChance: 0.24, priority: 70 },
        hero_destroyed: { sfx: 'destroy', voiceEvent: 'destroy', victimVoiceEvent: 'victim', chance: 0.44, victimChance: 0.26, priority: 68 },
        sacrifice: { sfx: 'sacrifice', voiceEvent: 'sacrifice', chance: 0.34, priority: 55 },
        draw: { sfx: 'draw', voiceEvent: 'draw', chance: 0.1, priority: 22 },
        timer_warning: { sfx: 'timerWarning', chance: 0, priority: 20 },
        timer_urgent: { sfx: 'timerUrgent', chance: 0, priority: 24 },
        win: { sfx: 'win', voiceEvent: 'success', chance: 0.9, priority: 100 },
        lose: { sfx: 'lose', voiceEvent: 'failure', chance: 0.72, priority: 95 }
    },
    productionNotes: {
        musicPrompt: 'whimsical hand-crafted fantasy animation score, warm orchestral chibi adventure, gentle woodwinds, soft strings, light percussion, magical playful mood, seamless loop',
        sfxDirection: 'premium tactile board-game fantasy sounds, short, crisp, soft transients, no cheap synth bleeps',
        voiceDirection: 'short English one-liners, 1 to 2 seconds, expressive but not loud, characterful chibi fantasy leaders'
    }
};
