# Berserkers, Necromancers, and Monster Expansion implementation spec

Sources audited on 2026-07-17:

- Unstable Games Wiki: Berserkers & Necromancers cards, inventory, and expansion instructions.
- Unstable Games Wiki: Monster Expansion cards and individual card rulings.

The physical additions contain 48 cards and 46 unique names. Berserkers &
Necromancers contains 35 physical cards (33 unique names; Lightning Labrys and
Mass Sacrifice each have two copies). Monster Expansion contains 13 unique
Monster cards. With this class expansion, the official class victory remains
seven different classes, including the Party Leader.

## Berserkers & Necromancers

| Card | Type / copies | Roll or requirement | Effect and implementation timing |
| --- | --- | --- | --- |
| The Gnawing Dread | Necromancer Leader / 1 | Own turn; 2 AP; once per turn | Choose any card in discard and add it to hand. Active, optional. |
| The Raging Manticore | Berserker Leader / 1 | After owner slays | Draw two, sequentially. Triggered mandatory benefit. |
| Doombringer | Monster / 1 | Necromancer + Hero; 4- discard hand; 8+ slay | After owner sacrifices any card, owner may retrieve a card from discard. Each sacrifice is a separate trigger. |
| Reptilian Ripper | Monster / 1 | Berserker + Hero; 6- sacrifice 2 Heroes; 7+ slay | Owner gets +2 on every attack roll. |
| Bark Hexer | Necromancer Hero / 1 | 7+ | Discard one card as a required cost; every other player discards two or as many as possible. |
| Beholden Retriever | Necromancer Hero / 1 | 5+ | Sacrifice a Hero as required cost; retrieve a Hero or Item and play it immediately for 0 AP through the normal challenge/equip flow. |
| Bone Collector | Necromancer Hero / 1 | 7+ | Sacrifice an equipped Item as required cost; retrieve a Hero and play it immediately for 0 AP. |
| Boston Terror | Necromancer Hero / 1 | 7+ | Choose a player. They may choose one hand card to give; if they decline, actor may retrieve up to two discard cards. |
| Grim Pupper | Necromancer Hero / 1 | 8+ | Every player, including actor, sacrifices one Party card; each player chooses their own card. |
| Hollow Husk | Necromancer Hero / 1 | 6+ | Privately inspect another hand, choose a Magic if present, take it, then optionally play it immediately for 0 AP. |
| Perfect Vessel | Necromancer Hero / 1 | 4+ | Sacrifice this Hero, then steal a legal opponent Hero. Steal protection still applies. |
| Shadow Saint | Necromancer Hero / 1 | 5+ | Discard a Modifier as required cost; other players cannot play Modifiers until end of actor turn. |
| Annihilator | Berserker Hero / 1 | 6+ | Retrieve a Challenge from discard. |
| Brawling Spirit | Berserker Hero / 1 | 9+ | Every player with more than three Party cards sacrifices one card; each chooses their own. |
| Gruesome Gladiator | Berserker Hero, 2 slots / 1 | 10+ | Privately inspect each other hand in seat order and take one chosen card from each. |
| Meowntain | Berserker Hero, 2 slots / 1 | 6+ | Sacrifice one Party card as required cost; +5 to all actor rolls through end of turn. |
| Rabid Beast | Berserker Hero, 2 slots / 1 | 6+ | Choose and sacrifice any number of own Party cards, then destroy the same number of legal opponent Party cards. Zero is legal. |
| Roaryal Guard | Berserker Hero / 1 | 9+ | Choose one effective class; return every Hero of that class and all equipped Items to respective owners' hands. |
| Vicious Wildcat | Berserker Hero, 2 slots / 1 | 12+ | Choose and slay any face-up Monster without another attack roll, trigger slay effects, refill display, then end turn. |
| Unbridled Fury | Berserker Hero / 1 | 8+ | Destroy a legal Hero. If its effective class at destruction was Berserker, gain one AP for this turn. |
| Berserker Mask | Item / 1 | Equip rules | Replaces equipped Hero's effective class with Berserker. Only one Mask per Hero. |
| Biggest Ring Ever | Item / 1 | During equipped Hero skill roll | Owner may discard 0-3 hand cards; +2 per discarded card to that roll. |
| Goblet of Caffeination | Item / 1 | After equipped Hero skill fails | Owner may sacrifice Goblet and immediately reroll that same effect for 0 AP. |
| Necromancer Mask | Item / 1 | Equip rules | Replaces equipped Hero's effective class with Necromancer. Only one Mask per Hero. |
| Silver Lining | Item / 1 | After equipped Hero skill fails | Mandatory +2 to all owner rolls for remainder of turn; separate failures stack. |
| Dragon's Bile | Cursed Item / 1 | After equipped Hero skill fails | Owner must sacrifice a Hero if possible. |
| Soulbound Grimoire | Cursed Item / 1 | Skill activation | Normal activation costs 2 AP; a free immediate activation remains free. |
| Modifier +2/-2 | Modifier / 1 | Any roll | Choose +2/-2 normally; on attack it is +4 instead. Guardian Leader still adjusts the played value. |
| Modifier +7 | Modifier / 1 | Any roll | Discard remaining hand as required play cost; add +7. Empty remaining hand is legal. |
| Lightning Labrys | Magic / 2 | On resolution | Discard 0-3 hand cards, then for each discard choose any player; that player chooses and sacrifices one Hero if possible. Resolve sequentially. |
| Mass Sacrifice | Magic / 2 | On resolution | Discard remaining hand, then draw five sequentially. Empty remaining hand is legal. |
| Berserker Challenge | Challenge / 1 | Effective Berserker in Party | Normal Challenge with +3 to challenger's roll. |
| Necromancer Challenge | Challenge / 1 | Effective Necromancer in Party | Normal Challenge with +3 to challenger's roll. |

## Monster Expansion

| Card | Attack condition | Slain effect / special rule |
| --- | --- | --- |
| Ancient Megashark | Hero + discard any card; 6- sacrifice Hero; 9+ slay | +1 to owner's attack rolls. |
| Clawed Nightmare | Bard + Thief + Hero; 6- sacrifice Hero; 9+ slay | At end of owner's turn with empty hand, owner may choose a player and pull two random cards. |
| Dragon Wasp | Hero + discard two; 6- sacrifice Hero; 7+ slay | When an owned Hero would be sacrificed or destroyed, owner may discard two hand cards instead. |
| Goretelodont | Guardian + Ranger + Hero; 6- sacrifice Hero; 9+ slay | At end of owner's turn with empty hand, owner may draw three sequentially. |
| Lumbering Demon | Two Heroes; 5- sacrifice Hero; 8+ slay | Each single draw may be replaced by draw two then discard one. The replacement cannot trigger itself; finish it before later triggers. |
| Possessed Plush | Hero + discard Challenge; 4- sacrifice Hero; 7+ slay | Each time owner plays a Challenge, draw one. |
| Reef Ripper | Hero; 6- slay; 9+ sacrifice Hero | Reversed attack thresholds. After a failed owned Hero skill, owner may draw one. |
| Saffyre Phoenix | Hero; 8- sacrifice Hero; 13+ slay; +2 per additional Hero | After an owned Hero is sacrificed or destroyed, owner may immediately play a Hero for 0 AP. |
| Scavenger Griffin | Fighter + Wizard + Hero; 6- sacrifice Hero; 9+ slay | At end of owner's turn with empty hand, owner may steal a legal Hero. |
| Venomous Gemini | Five Heroes; 6- sacrifice Hero; 7+ slay | Counts as two slain Monsters for counters and victory. |
| Voltclaw Lion | Hero + discard Magic; 4- sacrifice Hero; 7+ slay | Each time owner plays Magic, draw one. |
| Wandering Behemoth | Hero; 6- sacrifice Hero; 7+ slay; +1 per additional Hero | After an owned Hero is sacrificed, owner may draw one. |
| Wicked Sea Serpent | Hero + discard regular or Cursed Item; 4- sacrifice Hero; 7+ slay | Each time owner plays a regular or Cursed Item, draw one. |

## Cross-cutting invariants

- Party Leaders satisfy class requirements but never generic Hero requirements.
- Masks replace, rather than add to, a Hero's effective class.
- Sacrifice, destroy, steal, discard, bring, retrieve, draw, play, and slay remain distinct events.
- Every draw is processed individually through draw passives and deck recycling.
- Optional triggers require a visible skip path; mandatory costs must complete before their payoff.
- Target protection, two-slot capacity, one-Mask-per-Hero, and challenge legality are validated server-side.
- Pending decisions are represented in authoritative game state so reconnecting clients reconstruct them.
- No card enters a live deck until its finished full-card runtime asset exists.
