# Here to Slay — Session Handoff

Self-contained state so a new chat can continue **without** this conversation's
history. Read this, then verify against the live code (it may have moved on).
**Everything below is uncommitted working-tree changes. Nothing is committed yet.**

Written 2026-07-10, ~16:50.

---

## TL;DR — what this session did

1. **Aligned both board orientations** to the carved premium-tavern background art
   (landscape + portrait), with the draw/discard piles rendered as real **2.5D
   card stacks**.
2. Built an in-game **alignment editor** (`?align=1`) — drag/resize/rotate/tilt
   zones, copies the CSS.
3. Generated **full cartoon card art** for all 137 cards via Codex's image tool,
   compressed to WebP, wired into **every** view (board, hand, inspector, modals).
4. Redesigned the **card frames**: 8 distinct per-type frames + per-class crest
   badges (leaders now show their class; the 👑 crown was removed).
5. Codex separately did a **rules/card-data audit** — fixed real bugs and
   reconciled `cards.json` against the official wiki.

`npm test` → **113/113**. Cache is `hts-v39` in `public/sw.js`.

---

## ⚠️ Loose ends to deal with FIRST in the new chat

- **Multiple stray `node server.js` processes are running** (saw 4-5 on ports
  3000/3100). Kill them all and start ONE clean:
  ```bash
  # find PIDs on 3000/3100 and Stop-Process them, then:
  npm start                 # game server, port 3000
  ```
  My screenshot workflow used a **second** server on **port 3100** (so it never
  collided with the game server or a bot sim). That's a convention, not a
  requirement.

- **A background frame-generation loop is still running** (`scripts/frame-run-loop.sh`,
  waiting on Codex image quota — resets **7:44 PM**). It writes to
  `public/assets/skin/frames/v2/` + `public/assets/skin/icons/crest-v2/` but does
  NOT auto-install. Decide: let it finish and install the hand-painted frames, or
  kill it and keep the current derived ones (see "Frames" below).

- **Commit split still pending.** Intended as (a) the premium skin + art, (b) the
  unrelated `cards.json`/wiki data changes. See "Files" at the bottom.

---

## The image pipeline (Codex generates art; I compress + wire)

**Key discovery:** Codex CAN generate images (built-in `image_gen` tool), but:
- It has a **~15-min execution window** per task → only ~11 images/run. Must be
  relaunched in a loop.
- Image generation is **quota-limited** (separate from text). On "usage limit" it
  must WAIT for reset, not spin.

### Card art — DONE (136/136 cards)
- Art lives in `public/assets/skin/cards/art/<card_id>.png` (full-size, ~2.5 MB).
- **`scripts/compress-art.js`** → `art-web/<card_id>.webp` (512×768, ~70 KB). This
  is what the game loads. 270 MB → 7.6 MB total.
- **`scripts/dedupe-art.js`** — `cards.json` has 41 exact duplicates (14× Challenge,
  9× Modifier +2/-2, etc.). This copies one illustration to its duplicates instead
  of regenerating. Duplicates verified byte-identical.
- **`scripts/art-todo.js`** — emits `scripts/art-todo.txt`: one representative per
  (type,name), each hero line stamped `ANIMAL=<x>` from the class map.
- **`scripts/art-run-loop.sh`** — the quota-aware driver (relaunch, wait on quota,
  dedupe+compress each batch). Use this pattern to regenerate any card.

### Art rules (locked in, in the prompts):
- **Style:** flat vector cartoon, Here-to-Slay / Unstable Games look — bold even
  outlines, chibi proportions, flat cel fills, radial swirl + sparkle background.
  NO painterly/realistic/cinematic. (An earlier PAINTERLY set was rejected and
  archived to `public/assets/skin/cards/art_v1_painterly/`.)
- **CLASS decides the hero's animal, NEVER the card name.** This is the #1 trap
  (e.g. "Bullseye" is a Ranger → **fox**, not a bull; "Lucky Bucky" is a Bard →
  **squirrel**, not a buck). Map:
  | Fighter | Bard | Guardian | Ranger | Thief | Wizard |
  |---|---|---|---|---|---|
  | bear | squirrel | unicorn | fox | cat | rabbit |
  - Monsters = original cartoon creatures (not the 6 class animals).
  - Items = the object; Magic/Challenge/Modifier = an action scene of the effect.

### How art is wired into the client
- **Server** (`server.js`, `loadCards()` + the `ALL_CARDS.forEach`): any card with
  `art-web/<id>.webp` on disk gets a **`card.artUrl`** field. The server reads the
  folder **at startup**, so **restart the server when new art lands.**
- **Client** (`public/app.js`): helpers **`cardArt(card)`** (returns artUrl ||
  imageUrl) and **`artClass(card)`** (returns ` has-art`). ALL ~15 render sites go
  through these — board, hand, leader slot, inspector modal, discard viewer,
  opponent modal, challenge/modifier displays, equipped-item thumbs, roster
  avatars, slain-monster icons.
- **CSS** (`public/style.css`): `.has-art` → art fills the frame window
  edge-to-edge (`cover`), instead of the zoom-crop that existed only to dig art
  out of the old watermarked wiki scans. **This retires the whole per-card
  `ART_CROP` tuning problem.**
  - GOTCHA that bit me: a rule `#player-party .card-img, #player-hand .card-img …`
    (~line 3852) pins `background-size: contain !important` + a dark backdrop with
    ID specificity, which **letterboxed** the art (black bars). Overridden by a
    matching-specificity `.has-art` block. If art looks letterboxed again, that
    rule is why.

---

## Frames + class crests (the last thing worked on)

**Problem the user raised:** hero/leader/monster/magic/item/modifier/challenge
cards looked too alike; and a Party Leader didn't show WHICH class it leads.

**Current live state (interim, no quota needed):**
- **8 frames** in `public/assets/skin/frames/*.png` — was 6. Leader & Cursed Item
  now have their OWN frames (previously borrowed: leader used a card *back*
  `back-leader.png` which has no art window; cursed reused the item frame).
  - `leader.png` / `cursed.png` are **derived** by tinting hero/item frames
    (`scripts/frames-derive.js`). NOTE: hue-rotation turns the leader **pink** (it
    shifts the parchment too) — use luminance-preserving **`.tint()`**, already
    done. These are placeholders until Codex's set lands.
- **6 class crests** in `public/assets/skin/icons/crest-v2/<class>.png` —
  **cropped from the actual card art** (`scripts/crests-from-art.js`): each class's
  animal head, circle-masked, ringed in the class colour. Better than generated
  icons (guaranteed style match). These are GOOD — keep them even after Codex's
  frames land.
- **Leader shows its class:** `.card.card-leader::after` overlays the class crest
  onto the frame's medallion. Requires the card to have a `class-<slug>` CSS class
  (renderCard adds it; the lobby leader card was patched to add it too).
- **👑 crown removed** — it was `.card.card-leader::before { content: '👑' }`,
  nothing to do with the frame.

**Two real bugs fixed here:**
- No card had EVER shown a class crest — the `--class-crest` var renders in
  `.card-class::before`, but `.card-class` is `display:none` in the frame template.
- **Bard was mapped to the Guardian crest** (indistinguishable). Old crest set had
  no Bard at all + a stray "shadow" for Thief. New `crest-v2` set fixes both.

**Pending (blocked on quota):** Codex is generating a proper **hand-painted** 8-frame
set + 6 crests → `frames/v2/` + `icons/crest-v2/`. Prompt: `scripts/frame-prompt.txt`
(leader medallion must be an EMPTY circle, no crown; crests are the class animals).
When 14/14 assets exist, run **`node scripts/frames-install.js`** — it downsamples
frames to 364×558, rounds corners, circle-masks crests, and **backs up current
frames to `frames/v1_backup/`**. Then bump `CACHE_VERSION`.

---

## Board alignment + the 2.5D deck (DONE)

- Both orientations are absolutely-positioned onto the carved background art. The
  authoritative blocks are appended at the END of `public/style.css`:
  "BOARD ALIGNED TO THE CARVED BACKGROUND (landscape)" and "(portrait)".
- **Draw/discard = real 2.5D stacks.** `#main-deck` has 3 stepped card-back layer
  `<i>` children (see index.html); `#discard-pile` gets `::before/::after` stack
  layers only when it holds a card (`:has(.card:not(.empty-slot))`). The board art
  already paints the deck stack, so the card is placed ON it and sized to fill.
- Portrait deck/discard are centred in their carved squares by explicit % (the two
  cards have different natural widths, so flex `space-*` couldn't centre both).
- AP gems sit on the green side rail, rotated to follow its perspective lean.

### The alignment editor — `public/align-tool.js`
- Loads ONLY with **`?align=1`** in the URL or **Ctrl+Shift+A**. Fully inert in
  normal play (verified: 0 nodes without the flag). Appears once the board is up.
- Drag to move, corner handle resizes, arrows nudge (Shift ×10), sliders for
  rotate / rotateX tilt / perspective, Grid toggle (5%/10% overlay), **Copy CSS
  (this/all)** — outputs paste-ready rules with the correct selector per
  orientation. Persists in localStorage. Reset this / Reset all to bail.
- Editable zones: draw pile, discard, deck area, AP gems, leader, monsters panel,
  party panel, hand tray, opponents bar, win tracker, action buttons.

---

## Codex rules/card-data audit (DONE — separate concern from the skin)

Reconciled `cards.json` vs the official wiki scrape (`wiki_card_compare.json`,
`scrape_wiki_compare.ps1`). Real bugs fixed in `skill_engine.js`/`server.js`:
- **Decoy Doll** was wrongly blocking *steals* — now only absorbs sacrifice/destroy.
- **Forced Exchange** no longer lets Decoy Doll block the steal half.
- **Hook** now plays an Item from the existing hand before drawing.
Data fixes: Rex Major rolls 9→8 / 6→4, Winds of Change wording (owner's hand),
class Mask text, Challenge text, card quantities, etc.
Left for a human: wiki says **The Charismatic Song** is class *Guardian* but its
`LEADER_BARD` key says Bard — kept as **Bard** (scrape looks wrong).

---

## Dev commands / conventions

```bash
npm start                       # game server on port 3000 (0.0.0.0)
npm test                        # unit tests — keep the test/**/*.test.js glob!
node scripts/compress-art.js    # PNG art -> art-web webp (skips up-to-date)
node scripts/dedupe-art.js      # copy art to duplicate cards
node scripts/frames-install.js  # install frames/v2 + crest-v2 as live (backs up)
node scripts/frames-derive.js --force   # regen interim leader/cursed frames
```
- Screenshots: `screenshots/cap-both.js` (CAP_PORT, OUT_L/OUT_P envs, 2× scale),
  `cap-measure.js` (adds a % grid; CAP_W/CAP_H for orientation),
  `cap-portrait.js` (CAP_PARTY to stage specific cards). All target a server on
  **port 3100** by default.
- No `sharp` originally; it was `npm install`ed this session (in package.json now)
  and is used by all the art/frame scripts.
- **Bump `CACHE_VERSION` in `public/sw.js` on every client change** (HTML/JS/CSS).
  Currently **`hts-v39`**. The SW precache list was updated to the 8 frames +
  crest-v2 (a single missing precached asset makes `cache.addAll` reject wholesale).
- LAN test URL for phone: `http://192.168.42.51:3000` (bound to 0.0.0.0).

---

## Files (for the commit split)

**Skin/art/frames (commit A):** `public/style.css`, `public/app.js`,
`public/index.html`, `public/sw.js`, `public/align-tool.js`, `server.js`
(the `artUrl` wiring only), `public/assets/**` (art-web, frames, crest-v2),
`scripts/**`, `screenshots/cap-*.js` + `verify-*.js`, `package.json`/lock (sharp).

**Card data / rules (commit B — keep separate):** `cards.json`, `skill_engine.js`,
`test/skill_engine.test.js`, `scrape_wiki_compare.ps1`, `wiki_card_compare.json`.

**Don't commit / clean up:** `public/assets/skin/cards/art/*.png` (270 MB
raw — the `art-web/` webp is what ships; consider gitignoring the raw dir),
`art_v1_painterly/` (rejected painterly set — delete if unwanted),
`frames/v1_backup/` (created on frames-install).

---

## Known non-blocking issues (flagged, not fixed)

- Inspector rules text scrolls inside a `#inspector-modal-description { max-height:
  15vh }` box on short landscape screens — pre-existing, unrelated to the art.
- Raw card-art PNGs (270 MB) shouldn't go in git.
