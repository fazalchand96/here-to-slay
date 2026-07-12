# Here to Slay

Real-time multiplayer implementation of the "Here to Slay" card game. Node/Socket.IO
authoritative server, vanilla-JS PWA client. See `CLAUDE.md` for the codebase map.

## Language

**Definition of Done (DoD)**:
A checklist of independently-verifiable criteria that make a `/goal`-style task
complete. Framed once at the start of a goal, then checked off one at a time —
never left as a vague "make it better."

**Fable 5 gate**:
The review checkpoint where Fable 5 judges a specialist's (e.g. Codex's) work,
submitted as screenshots, as PASS or FAIL with specific critique. A criterion in
a Definition of Done only counts as met once Fable 5 returns PASS on it.
_Avoid_: sign-off, approval (too generic — this specifically means the
screenshot-based agent-to-agent review loop).

**Streak**:
A count of consecutive clean full playthroughs in the mobile test harness. Any
streak-breaking bug (crash, console error, softlock, wrong win detection, hand/state
desync) resets the count to 0 — a fix does not let the count resume from where it
broke.

**Class animation**:
An animation authored once per class (Fighter/Bard/Guardian/Ranger/Thief/Wizard)
and reused across every hero card of that class, rather than a bespoke animation
per unique card. Mirrors the existing card-art convention where CLASS (not card
name) decides the hero's animal.
