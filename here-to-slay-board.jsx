import { useState, useEffect } from "react";

/* ══════════════════════════════════════════════════════════
   HERE TO SLAY — full board mockup
   Layout: real digital-game layout (party slots top in 2 rows,
   monsters across the top, Party Leader large center-bottom,
   hand on a wooden tray, AP coin + deck/discard bottom).
   World: original "Twilight Forest" palette (indigo→peach,
   glowing mushrooms). Kawaii cards with chunky outlines.
   Modals: dice roll, monster attack, challenge, leader pick,
   card zoom, slain reward, discard&redraw, win, turn banner.
   ══════════════════════════════════════════════════════════ */

/* ─── Palette ─── */
const P = {
  skyTop: "#2a1f4e", skyMid: "#5a3d7a", skyLow: "#c97a8e", skyGlow: "#f0b07a",
  wood: "#6b4a2e", woodLite: "#8a6440", woodDark: "#3e2a18",
  card: "#fdf6e8", cardEdge: "#e8d5b0", ink: "#3a2a1e",
  gold: "#e8b84a", goldDeep: "#a87818",
  roll: "#4a90d9", rollDeep: "#2a5a9a",
  leader: "#e8607a", leaderDeep: "#a83a52",
  mush: "#8ad9c0",
};

const CLASS = {
  fighter:   { c: "#e05a4a", icon: "🔨", label: "Fighter" },
  bard:      { c: "#e89a3a", icon: "🎵", label: "Bard" },
  guardian:  { c: "#e8c84a", icon: "🛡", label: "Guardian" },
  ranger:    { c: "#5ab85a", icon: "🏹", label: "Ranger" },
  thief:     { c: "#4a90d9", icon: "🗡", label: "Thief" },
  wizard:    { c: "#9a5ad9", icon: "✦", label: "Wizard" },
};

/* ─── Initial data ─── */
const LEADERS = [
  { id: "L1", name: "Big Berry", class: "fighter", ability: "On kill, restore HP to self and allies in the row.", emoji: "🐻" },
  { id: "L2", name: "The Fox", class: "ranger", ability: "Draw an extra card at the start of your turn.", emoji: "🦊" },
  { id: "L3", name: "Lord Cinder", class: "wizard", ability: "Your Magic cards cost 1 less action point.", emoji: "🐉" },
];

const START_PARTY = [
  { id: "h1", name: "Bear Claw", class: "fighter", roll: 8, ability: "Roll: deal damage to a hero. Steal a card.", emoji: "🐻", item: "Sharp Fox" },
  { id: "h2", name: "Tipsy Tootie", class: "bard", roll: 7, ability: "Roll: each other player discards a card.", emoji: "🐿", item: null },
  { id: "h3", name: "Wiggles", class: "wizard", roll: 7, ability: "Roll: steal a hero from another player.", emoji: "🐰", item: null },
];

const START_HAND = [
  { id: "c1", type: "Hero", name: "Shurikitty", class: "thief", roll: 9, text: "Roll 9+: DESTROY a Hero. Keep its equipped Item.", emoji: "🐱" },
  { id: "c2", type: "Item", name: "Decoy Doll", class: null, text: "Equip. The first time this hero is destroyed, it survives.", emoji: "🎎" },
  { id: "c3", type: "Magic", name: "Forced Exchange", class: null, text: "Steal a hero. Give one of yours in return.", emoji: "🔮" },
  { id: "c4", type: "Hero", name: "Lookie Rookie", class: "ranger", roll: 6, text: "Roll 6+: Search the discard pile for an Item; add to hand.", emoji: "🦊" },
  { id: "c5", type: "Modifier", name: "+3 / -2", class: null, text: "Play on any roll. Add +3 or -2.", emoji: "🎲" },
  { id: "c6", type: "Challenge", name: "Not So Fast", class: null, text: "Challenge a card being played. Both roll — high wins.", emoji: "✋" },
];

const MONSTERS = [
  { id: "m1", name: "Dragon Hoard", roll: 8, req: "2+ Fighters", reward: "Roll to steal a card on a kill.", penalty: "Sacrifice a Hero.", emoji: "🐲" },
  { id: "m2", name: "Corrupted Sapling", roll: 7, req: "2+ different classes", reward: "Draw a card each turn.", penalty: "Discard 2 cards.", emoji: "🌱" },
  { id: "m3", name: "Mega Slime", roll: 10, req: "1+ Wizard", reward: "+1 action point per turn.", penalty: "Discard your hand.", emoji: "🟢" },
];

const OPP = [
  { id: "o1", name: "Mira", emoji: "🦝", party: 4, slain: 1, hand: 3, leader: "🦊" },
  { id: "o2", name: "Drek", emoji: "🐗", party: 6, slain: 0, hand: 5, leader: "🐉" },
  { id: "o3", name: "Kai", emoji: "🦉", party: 2, slain: 2, hand: 4, leader: "🐻" },
];

const faces = ["⚀","⚁","⚂","⚃","⚄","⚅"];

/* ════════════ small pieces ════════════ */

function Coin({ n, label, color = P.gold, deep = P.goldDeep, size = 30 }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{
        width: size, height: size, borderRadius: "50%",
        background: `radial-gradient(circle at 35% 28%, #fff, ${color} 55%, ${deep})`,
        border: "2px solid rgba(0,0,0,.25)",
        boxShadow: "0 2px 4px rgba(0,0,0,.4), inset 0 1px 2px rgba(255,255,255,.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 900, color: "#fff", fontSize: size * 0.46,
        textShadow: `0 1px 1px ${deep}`, fontFamily: "Georgia, serif",
      }}>{n}</div>
      {label && <div style={{ fontSize: ".42rem", color: "#f0e0c0", letterSpacing: 1, marginTop: 1, textTransform: "uppercase" }}>{label}</div>}
    </div>
  );
}

function RollBadge({ n }) {
  return (
    <div style={{
      position: "absolute", top: -7, right: -7, zIndex: 4,
      width: 24, height: 24, borderRadius: "50%",
      background: `radial-gradient(circle at 35% 28%, #bfe0ff, ${P.roll} 55%, ${P.rollDeep})`,
      border: "2px solid #fff",
      boxShadow: "0 2px 4px rgba(0,0,0,.4)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 900, color: "#fff", fontSize: ".66rem",
      fontFamily: "Georgia, serif", textShadow: `0 1px 1px ${P.rollDeep}`,
    }}>{n}</div>
  );
}

/* mini party card (kawaii, light, wooden edge) */
function PartyCard({ h, onClick }) {
  const cl = CLASS[h.class];
  return (
    <div onClick={onClick} style={{
      width: 78, position: "relative", cursor: "pointer",
      transition: "transform .15s", flexShrink: 0,
    }}
      onMouseEnter={e => e.currentTarget.style.transform = "translateY(-4px)"}
      onMouseLeave={e => e.currentTarget.style.transform = "translateY(0)"}>
      <RollBadge n={h.roll} />
      <div style={{
        borderRadius: 10, padding: 3,
        background: `linear-gradient(180deg,${P.woodLite},${P.woodDark})`,
        boxShadow: "0 3px 6px rgba(0,0,0,.4)",
      }}>
        <div style={{
          background: P.card, borderRadius: 8, overflow: "hidden",
          border: `2px solid ${cl.c}`,
        }}>
          <div style={{
            height: 46, background: `linear-gradient(160deg,${cl.c}33,${cl.c}11)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "1.8rem", position: "relative",
          }}>
            {h.emoji}
            <div style={{ position: "absolute", top: 2, left: 2, fontSize: ".7rem" }}>{cl.icon}</div>
          </div>
          <div style={{ padding: "3px 3px 4px", textAlign: "center" }}>
            <div style={{ fontSize: ".52rem", fontWeight: 800, color: P.ink, lineHeight: 1 }}>{h.name}</div>
            {h.item && (
              <div style={{ fontSize: ".4rem", color: P.goldDeep, marginTop: 2,
                background: "#f5e6c0", borderRadius: 4, padding: "1px 2px" }}>🗡 {h.item}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptySlot() {
  return (
    <div style={{
      width: 78, height: 92, flexShrink: 0, borderRadius: 10,
      border: "2px dashed rgba(255,255,255,.3)",
      background: "rgba(255,255,255,.06)",
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "rgba(255,255,255,.4)", fontSize: "1.4rem",
    }}>+</div>
  );
}

/* hand card */
function HandCard({ c, selected, onClick }) {
  const cl = c.class ? CLASS[c.class] : null;
  const tint = cl ? cl.c : {
    Item: "#c79a4a", Magic: "#9a5ad9", Modifier: "#5aa8b8", Challenge: "#e07a4a",
  }[c.type] || "#888";
  return (
    <div onClick={onClick} style={{
      width: 76, flexShrink: 0, cursor: "pointer",
      transform: selected ? "translateY(-22px) scale(1.08)" : "translateY(0)",
      transition: "transform .2s cubic-bezier(.34,1.56,.64,1)",
      position: "relative",
      filter: selected ? "drop-shadow(0 10px 14px rgba(0,0,0,.5))" : "none",
    }}>
      {c.roll && <RollBadge n={c.roll} />}
      <div style={{
        borderRadius: 10, padding: 3,
        background: `linear-gradient(180deg,${P.woodLite},${P.woodDark})`,
        boxShadow: "0 3px 6px rgba(0,0,0,.4)",
      }}>
        <div style={{ background: P.card, borderRadius: 8, overflow: "hidden", border: `2px solid ${tint}` }}>
          <div style={{ fontSize: ".4rem", fontWeight: 800, color: "#fff", background: tint,
            textAlign: "center", letterSpacing: .5, padding: "1px 0", textTransform: "uppercase" }}>{c.type}</div>
          <div style={{ height: 40, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "1.7rem", background: `${tint}18` }}>{c.emoji}</div>
          <div style={{ padding: "2px 3px 4px" }}>
            <div style={{ fontSize: ".5rem", fontWeight: 800, color: P.ink, textAlign: "center", lineHeight: 1, marginBottom: 2 }}>{c.name}</div>
            <div style={{ fontSize: ".4rem", color: "#6a5a48", textAlign: "center", lineHeight: 1.2 }}>{c.text}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* monster card (top row) */
function MonsterCard({ m, active, onClick }) {
  return (
    <div onClick={onClick} style={{ width: 92, flexShrink: 0, cursor: "pointer", position: "relative" }}>
      <RollBadge n={m.roll} />
      <div style={{
        borderRadius: 10, padding: 3,
        background: active
          ? "linear-gradient(180deg,#ffd96a,#c79a18)"
          : `linear-gradient(180deg,${P.woodLite},${P.woodDark})`,
        boxShadow: active ? "0 0 14px #ffd96a, 0 3px 6px rgba(0,0,0,.4)" : "0 3px 6px rgba(0,0,0,.4)",
        transition: "all .2s",
      }}>
        <div style={{ background: "#2e2440", borderRadius: 8, overflow: "hidden", border: "2px solid #e0607a" }}>
          <div style={{ height: 42, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "1.8rem", background: "radial-gradient(circle,#5a3a6a,#2e2440)" }}>{m.emoji}</div>
          <div style={{ padding: "3px 3px 4px", textAlign: "center" }}>
            <div style={{ fontSize: ".5rem", fontWeight: 800, color: "#fff", lineHeight: 1 }}>{m.name}</div>
            <div style={{ fontSize: ".4rem", color: "#ffc0c8", marginTop: 1 }}>Needs: {m.req}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* opponent strip pill */
function OppPill({ o, active }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
      background: active ? "rgba(232,184,74,.25)" : "rgba(0,0,0,.28)",
      border: active ? "1px solid #e8b84a" : "1px solid rgba(255,255,255,.12)",
      borderRadius: 16, padding: "3px 8px 3px 3px",
    }}>
      <div style={{ width: 24, height: 24, borderRadius: "50%", background: "rgba(255,255,255,.12)",
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: ".9rem", position: "relative" }}>
        {o.emoji}
        <span style={{ position: "absolute", bottom: -2, right: -3, fontSize: ".5rem" }}>{o.leader}</span>
      </div>
      <div>
        <div style={{ fontSize: ".56rem", color: "#fff", fontWeight: 700, lineHeight: 1 }}>{o.name}</div>
        <div style={{ fontSize: ".44rem", color: "#d0c0e0" }}>👥{o.party} ✦{o.slain} 🂠{o.hand}</div>
      </div>
    </div>
  );
}

/* ════════════ MODAL SHELL ════════════ */
function Modal({ children, onClose, accent = P.gold }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(10,6,20,.72)", backdropFilter: "blur(3px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      animation: "fade .2s ease",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", maxWidth: 340, borderRadius: 20, padding: 4,
        background: `linear-gradient(180deg,${P.woodLite},${P.woodDark})`,
        boxShadow: `0 20px 50px rgba(0,0,0,.7), 0 0 0 2px ${accent}55`,
        animation: "pop .25s cubic-bezier(.34,1.56,.64,1)",
      }}>
        <div style={{ background: "linear-gradient(180deg,#fffaf0,#f3e6cc)", borderRadius: 16, overflow: "hidden" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function ModalHead({ title, accent }) {
  return (
    <div style={{ background: `linear-gradient(180deg,${accent},${accent}cc)`, padding: "12px 16px", textAlign: "center" }}>
      <div style={{ fontSize: "1rem", fontWeight: 900, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,.4)", letterSpacing: .5 }}>{title}</div>
    </div>
  );
}

function Btn({ children, onClick, primary, accent = P.gold, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      border: "none", borderRadius: 12, padding: "11px 18px", cursor: disabled ? "default" : "pointer",
      fontSize: ".82rem", fontWeight: 800, fontFamily: "Georgia, serif", letterSpacing: .3,
      color: primary ? "#fff" : P.ink,
      background: disabled ? "#cbb896" : primary ? `linear-gradient(180deg,${accent},${accent}bb)` : "#e8d5b0",
      boxShadow: disabled ? "none" : "0 3px 0 rgba(0,0,0,.2), inset 0 1px 1px rgba(255,255,255,.4)",
      transition: "all .12s",
    }}>{children}</button>
  );
}

/* dice block used by several modals */
function Dice({ value, rolling, big }) {
  return (
    <div style={{
      fontSize: big ? "3.6rem" : "2.6rem", lineHeight: 1,
      color: P.ink, filter: rolling ? "blur(1.4px)" : "none",
      transition: "filter .1s",
    }}>{value ? faces[value - 1] : "🎲"}</div>
  );
}

/* ════════════════════════ APP ════════════════════════ */
export default function HereToSlayBoard() {
  const [leader, setLeader] = useState(null);          // chosen party leader
  const [showLeaderPick, setShowLeaderPick] = useState(true);
  const [party, setParty] = useState(START_PARTY);
  const [hand, setHand] = useState(START_HAND);
  const [ap, setAp] = useState(3);
  const [slain, setSlain] = useState(1);
  const [turnBanner, setTurnBanner] = useState(false);

  const [selHand, setSelHand] = useState(null);
  const [modal, setModal] = useState(null);            // 'roll' | 'attack' | 'challenge' | 'zoom' | 'reward' | 'redraw' | 'win'
  const [modalData, setModalData] = useState({});

  // dice state shared
  const [d1, setD1] = useState(null);
  const [d2, setD2] = useState(null);
  const [rolling, setRolling] = useState(false);
  const [rollOutcome, setRollOutcome] = useState(null); // 'win' | 'lose'
  const [oppRoll, setOppRoll] = useState(null);

  const rollTwo = (target, isChallenge = false) => {
    setRolling(true); setRollOutcome(null); setD1(null); setD2(null); setOppRoll(null);
    let n = 0;
    const iv = setInterval(() => {
      setD1(Math.ceil(Math.random() * 6));
      setD2(Math.ceil(Math.random() * 6));
      if (isChallenge) setOppRoll(Math.ceil(Math.random() * 12) + 0);
      n++;
      if (n >= 12) {
        clearInterval(iv);
        const a = Math.ceil(Math.random() * 6), b = Math.ceil(Math.random() * 6);
        setD1(a); setD2(b); setRolling(false);
        const sum = a + b;
        if (isChallenge) {
          const opp = Math.ceil(Math.random() * 6) + Math.ceil(Math.random() * 6);
          setOppRoll(opp);
          setRollOutcome(sum >= opp ? "win" : "lose");
        } else {
          setRollOutcome(sum >= target ? "win" : "lose");
        }
      }
    }, 70);
  };

  const total = (d1 || 0) + (d2 || 0);

  /* ─── actions ─── */
  const openHeroRoll = (h) => {
    setModalData({ kind: "hero", name: h.name, target: h.roll, ability: h.ability });
    setD1(null); setD2(null); setRollOutcome(null); setRolling(false);
    setModal("roll");
  };

  const openAttack = (m) => {
    if (ap < 2) { setTurnBanner(false); return; }
    setModalData({ ...m });
    setD1(null); setD2(null); setRollOutcome(null); setRolling(false);
    setModal("attack");
  };

  const confirmAttackWin = () => {
    setAp(a => Math.max(0, a - 2));
    setSlain(s => s + 1);
    setModalData(prev => ({ ...prev }));
    setModal("reward");
  };

  const playSelected = () => {
    if (!selHand || ap < 1) return;
    const card = hand.find(c => c.id === selHand);
    if (card.type === "Hero") {
      setParty(p => [...p, { ...card, item: null }]);
    }
    setHand(h => h.filter(c => c.id !== selHand));
    setAp(a => a - 1);
    setSelHand(null);
    // a hero auto-rolls when played
    if (card.type === "Hero") openHeroRoll(card);
  };

  const endTurn = () => {
    setAp(3); setSelHand(null);
    setTurnBanner(true);
    setTimeout(() => setTurnBanner(false), 1400);
  };

  /* ─── render ─── */
  const fullPartyClasses = new Set(party.map(p => p.class)).size;

  return (
    <div style={{
      maxWidth: 420, margin: "0 auto", minHeight: "100vh", position: "relative",
      fontFamily: "Georgia, serif", overflow: "hidden",
      background: `linear-gradient(180deg, ${P.skyTop} 0%, ${P.skyMid} 42%, ${P.skyLow} 72%, ${P.skyGlow} 90%)`,
    }}>
      <style>{`
        @keyframes fade {from{opacity:0}to{opacity:1}}
        @keyframes pop {from{transform:scale(.85);opacity:0}to{transform:scale(1);opacity:1}}
        @keyframes float {0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
        @keyframes bannerIn {0%{transform:translateY(-30px);opacity:0}20%,80%{transform:translateY(0);opacity:1}100%{transform:translateY(-30px);opacity:0}}
        ::-webkit-scrollbar{height:0}
      `}</style>

      {/* ── distant forest silhouette ── */}
      <svg viewBox="0 0 420 200" style={{ position: "absolute", top: 120, left: 0, width: "100%", opacity: .5 }}>
        <path d="M0 200 L0 120 L30 80 L60 120 L90 60 L120 120 L150 90 L180 130 L210 70 L240 120 L270 95 L300 130 L330 75 L360 120 L390 100 L420 130 L420 200 Z" fill="#2a1f4e" />
      </svg>
      {/* glowing mushrooms */}
      {[[20,250,P.mush],[380,300,"#e89ad0"],[40,420,"#e89ad0"],[392,470,P.mush]].map(([x,y,c],i)=>(
        <div key={i} style={{ position:"absolute", left:x, top:y, fontSize:"1rem", filter:`drop-shadow(0 0 6px ${c})`, opacity:.7, animation:"float 4s ease-in-out infinite" }}>🍄</div>
      ))}

      {/* ═══ TOP BAR ═══ */}
      <div style={{ position: "relative", zIndex: 5, padding: "8px 12px 4px",
        display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ background: "rgba(0,0,0,.3)", borderRadius: 12, padding: "4px 10px" }}>
          <div style={{ fontSize: ".44rem", color: "#d0c0e0", letterSpacing: 2, textTransform: "uppercase" }}>Slain to Win</div>
          <div style={{ fontSize: ".9rem" }}>
            {[0,1,2].map(i => <span key={i} style={{ color: i < slain ? "#ffd96a" : "rgba(255,255,255,.2)",
              textShadow: i < slain ? "0 0 6px #ffd96a" : "none" }}>✦</span>)}
          </div>
        </div>
        <button onClick={() => setModal("menu")} style={{ background: "rgba(0,0,0,.3)", border: "none",
          borderRadius: 10, color: "#fff", padding: "6px 10px", fontSize: ".9rem", cursor: "pointer" }}>☰</button>
      </div>

      {/* ═══ OPPONENTS ═══ */}
      <div style={{ position: "relative", zIndex: 5, padding: "2px 12px 6px",
        display: "flex", gap: 6, overflowX: "auto" }}>
        {OPP.map((o, i) => <OppPill key={o.id} o={o} active={i === 0} />)}
      </div>

      {/* ═══ MONSTERS ═══ */}
      <div style={{ position: "relative", zIndex: 5, padding: "2px 12px 8px" }}>
        <Label>Monsters · attack costs 2 AP</Label>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", paddingTop: 4 }}>
          {MONSTERS.map(m => <MonsterCard key={m.id} m={m} active={false} onClick={() => openAttack(m)} />)}
        </div>
      </div>

      {/* ═══ YOUR PARTY (2 rows) ═══ */}
      <div style={{ position: "relative", zIndex: 5, padding: "4px 12px 6px" }}>
        <Label>Your Party · {fullPartyClasses}/6 classes</Label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", paddingTop: 6 }}>
          {party.map(h => <PartyCard key={h.id} h={h} onClick={() => openHeroRoll(h)} />)}
          {[...Array(Math.max(0, 6 - party.length))].map((_, i) => <EmptySlot key={i} />)}
        </div>
      </div>

      {/* ═══ WOODEN TRAY (leader + hand + controls) ═══ */}
      <div style={{
        position: "relative", zIndex: 6, marginTop: 8,
        background: `linear-gradient(180deg,${P.woodLite} 0%,${P.wood} 30%,${P.woodDark} 100%)`,
        borderTop: `3px solid ${P.gold}`,
        boxShadow: "0 -6px 20px rgba(0,0,0,.5)",
        padding: "10px 12px 14px",
        borderRadius: "20px 20px 0 0",
      }}>
        {/* party leader, centered & raised */}
        <div style={{ display: "flex", justifyContent: "center", marginTop: -38, marginBottom: 6 }}>
          <div onClick={() => leader && setModalData(leader) || setModal("zoom")} style={{ cursor: "pointer", animation: "float 5s ease-in-out infinite" }}>
            <LeaderCard leader={leader} />
          </div>
        </div>

        {/* controls row: deck/discard + AP + buttons */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Pile label="Deck" n={32} onClick={() => { if (ap>=1){ setAp(a=>a-1);} }} />
            <Pile label="Discard" n={7} dim onClick={() => setModal("discardview")} />
          </div>
          <div style={{ display: "flex", gap: 7 }}>
            {[1,2,3].map(i => (
              <div key={i} style={{ opacity: ap >= i ? 1 : .3 }}>
                <Coin n="" label="" color={P.gold} deep={P.goldDeep} size={26} />
              </div>
            ))}
          </div>
          <button onClick={() => ap>=3 && setModal("redraw")} style={{
            background: ap>=3 ? "rgba(232,184,74,.25)" : "rgba(0,0,0,.25)",
            border: "1px solid rgba(232,184,74,.4)", borderRadius: 10,
            color: "#f0e0c0", fontSize: ".5rem", padding: "5px 7px", cursor: "pointer", lineHeight: 1.2,
          }}>Redraw<br/>Hand · 3</button>
        </div>

        {/* hand */}
        <Label light>Your Hand · {hand.length} cards</Label>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingTop: 22, paddingBottom: 4 }}>
          {hand.map(c => (
            <HandCard key={c.id} c={c} selected={selHand === c.id}
              onClick={() => setSelHand(selHand === c.id ? null : c.id)} />
          ))}
        </div>

        {/* action buttons */}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <TrayBtn label={selHand ? "Play Card · 1 AP" : "Select a card"} primary
            enabled={!!selHand && ap >= 1} onClick={playSelected} />
          <TrayBtn label="View Card" enabled={!!selHand}
            onClick={() => { setModalData(hand.find(c=>c.id===selHand)); setModal("zoom"); }} />
          <TrayBtn label="End Turn" enabled onClick={endTurn} />
        </div>
      </div>

      {/* ════════════ TURN BANNER ════════════ */}
      {turnBanner && (
        <div style={{ position: "fixed", top: "30%", left: 0, right: 0, zIndex: 90, textAlign: "center", pointerEvents: "none" }}>
          <div style={{ display: "inline-block", animation: "bannerIn 1.4s ease forwards",
            background: `linear-gradient(180deg,${P.skyMid},${P.skyTop})`, border: `2px solid ${P.gold}`,
            borderRadius: 14, padding: "14px 36px", boxShadow: "0 10px 30px rgba(0,0,0,.6)" }}>
            <div style={{ fontSize: ".5rem", color: P.gold, letterSpacing: 3, textTransform: "uppercase" }}>Now Playing</div>
            <div style={{ fontSize: "1.4rem", color: "#fff", fontWeight: 900 }}>Mira's Turn</div>
          </div>
        </div>
      )}

      {/* ════════════ MODALS ════════════ */}

      {/* LEADER PICK (start of game) */}
      {showLeaderPick && (
        <Modal accent={P.leader} onClose={() => {}}>
          <ModalHead title="Choose Your Party Leader" accent={P.leader} />
          <div style={{ padding: 16 }}>
            <p style={{ fontSize: ".62rem", color: "#6a5a48", textAlign: "center", marginTop: 0, marginBottom: 12 }}>
              Your leader stays all game and grants a passive ability. They don't count toward your 6 classes.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {LEADERS.map(L => {
                const cl = CLASS[L.class];
                return (
                  <div key={L.id} onClick={() => { setLeader(L); setShowLeaderPick(false); }} style={{
                    display: "flex", gap: 10, alignItems: "center", cursor: "pointer",
                    background: "#fff", border: `2px solid ${cl.c}`, borderRadius: 12, padding: 8,
                    boxShadow: "0 2px 4px rgba(0,0,0,.1)",
                  }}>
                    <div style={{ width: 46, height: 46, borderRadius: 10, flexShrink: 0,
                      background: `linear-gradient(160deg,${cl.c}33,${cl.c}11)`,
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.8rem" }}>{L.emoji}</div>
                    <div>
                      <div style={{ fontSize: ".8rem", fontWeight: 800, color: P.ink }}>{L.name} <span style={{ fontSize: ".55rem", color: cl.c }}>{cl.icon} {cl.label}</span></div>
                      <div style={{ fontSize: ".58rem", color: "#6a5a48", lineHeight: 1.3 }}>{L.ability}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Modal>
      )}

      {/* HERO ROLL */}
      {modal === "roll" && (
        <Modal accent={P.roll} onClose={() => setModal(null)}>
          <ModalHead title={`${modalData.name} — Roll ${modalData.target}+`} accent={P.roll} />
          <div style={{ padding: 18, textAlign: "center" }}>
            <p style={{ fontSize: ".62rem", color: "#6a5a48", marginTop: 0, marginBottom: 14, lineHeight: 1.4 }}>{modalData.ability}</p>
            <div style={{ display: "flex", gap: 14, justifyContent: "center", alignItems: "center", marginBottom: 8 }}>
              <Dice value={d1} rolling={rolling} big /><Dice value={d2} rolling={rolling} big />
            </div>
            <div style={{ fontSize: ".9rem", fontWeight: 800, color: P.ink, marginBottom: 4 }}>
              {d1 ? `Total: ${total}` : "—"}
            </div>
            {rollOutcome && (
              <div style={{ fontSize: "1.1rem", fontWeight: 900, marginBottom: 12,
                color: rollOutcome === "win" ? "#3aa83a" : "#c0392b" }}>
                {rollOutcome === "win" ? "✅ Success! Effect activates." : "❌ Failed — no effect."}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 6 }}>
              {!rollOutcome
                ? <Btn primary accent={P.roll} onClick={() => rollTwo(modalData.target)} disabled={rolling}>{rolling ? "Rolling…" : "🎲 Roll 2 Dice"}</Btn>
                : <Btn onClick={() => setModal(null)}>Close</Btn>}
              {!rollOutcome && <Btn onClick={() => setModal(null)}>Cancel</Btn>}
            </div>
          </div>
        </Modal>
      )}

      {/* MONSTER ATTACK */}
      {modal === "attack" && (
        <Modal accent={P.leader} onClose={() => setModal(null)}>
          <ModalHead title={`Attack: ${modalData.name}`} accent={P.leader} />
          <div style={{ padding: 18, textAlign: "center" }}>
            <div style={{ fontSize: "3rem", marginBottom: 4 }}>{modalData.emoji}</div>
            <div style={{ fontSize: ".58rem", color: "#6a5a48", marginBottom: 2 }}>Requires: {modalData.req}</div>
            <div style={{ fontSize: ".58rem", color: "#3aa83a", marginBottom: 2 }}>🏆 Slain: {modalData.reward}</div>
            <div style={{ fontSize: ".58rem", color: "#c0392b", marginBottom: 12 }}>💀 Fail: {modalData.penalty}</div>
            <div style={{ fontSize: ".7rem", fontWeight: 800, color: P.rollDeep, marginBottom: 10 }}>Roll {modalData.roll}+ to slay</div>
            <div style={{ display: "flex", gap: 14, justifyContent: "center", marginBottom: 8 }}>
              <Dice value={d1} rolling={rolling} big /><Dice value={d2} rolling={rolling} big />
            </div>
            <div style={{ fontSize: ".9rem", fontWeight: 800, color: P.ink, marginBottom: 6 }}>{d1 ? `Total: ${total}` : "—"}</div>
            {rollOutcome && (
              <div style={{ fontSize: "1.05rem", fontWeight: 900, marginBottom: 10,
                color: rollOutcome === "win" ? "#3aa83a" : "#c0392b" }}>
                {rollOutcome === "win" ? "⚔️ SLAIN!" : "💀 It fights back!"}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              {!rollOutcome
                ? <Btn primary accent={P.leader} onClick={() => rollTwo(modalData.roll)} disabled={rolling}>{rolling ? "Rolling…" : "🎲 Roll to Slay"}</Btn>
                : rollOutcome === "win"
                  ? <Btn primary accent="#3aa83a" onClick={confirmAttackWin}>Claim Reward →</Btn>
                  : <Btn accent="#c0392b" primary onClick={() => setModal(null)}>Accept Fate</Btn>}
            </div>
          </div>
        </Modal>
      )}

      {/* SLAIN REWARD */}
      {modal === "reward" && (
        <Modal accent="#3aa83a" onClose={() => setModal(null)}>
          <ModalHead title="Monster Slain!" accent="#3aa83a" />
          <div style={{ padding: 20, textAlign: "center" }}>
            <div style={{ fontSize: "3.4rem", marginBottom: 6 }}>{modalData.emoji}</div>
            <div style={{ fontSize: ".95rem", fontWeight: 800, color: P.ink, marginBottom: 8 }}>{modalData.name} joins your party</div>
            <div style={{ background: "#eafaea", border: "2px solid #3aa83a", borderRadius: 12, padding: 10, marginBottom: 14 }}>
              <div style={{ fontSize: ".5rem", color: "#2a7a2a", letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 }}>Permanent Reward</div>
              <div style={{ fontSize: ".68rem", color: P.ink }}>{modalData.reward}</div>
            </div>
            <div style={{ fontSize: ".7rem", color: "#6a5a48", marginBottom: 12 }}>
              You've slain <b>{slain}</b> of 3 monsters.
            </div>
            <Btn primary accent="#3aa83a" onClick={() => { if (slain >= 3) setModal("win"); else setModal(null); }}>
              {slain >= 3 ? "🎉 See Victory" : "Continue"}
            </Btn>
          </div>
        </Modal>
      )}

      {/* CHALLENGE */}
      {modal === "challenge" && (
        <Modal accent="#e07a4a" onClose={() => setModal(null)}>
          <ModalHead title="⚡ Challenge!" accent="#e07a4a" />
          <div style={{ padding: 18, textAlign: "center" }}>
            <p style={{ fontSize: ".62rem", color: "#6a5a48", marginTop: 0, marginBottom: 14 }}>
              <b>Drek</b> challenged your card. Both players roll — highest total wins. Loser's card is discarded.
            </p>
            <div style={{ display: "flex", justifyContent: "space-around", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: ".5rem", color: P.roll, fontWeight: 800, marginBottom: 4 }}>YOU</div>
                <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                  <Dice value={d1} rolling={rolling} /><Dice value={d2} rolling={rolling} />
                </div>
                <div style={{ fontSize: ".8rem", fontWeight: 800, color: P.ink, marginTop: 3 }}>{d1 ? total : "—"}</div>
              </div>
              <div style={{ fontSize: "1.4rem", alignSelf: "center", color: "#c0392b" }}>VS</div>
              <div>
                <div style={{ fontSize: ".5rem", color: "#c0392b", fontWeight: 800, marginBottom: 4 }}>DREK</div>
                <div style={{ fontSize: "2.2rem", color: P.ink, filter: rolling ? "blur(1.4px)" : "none" }}>🎲</div>
                <div style={{ fontSize: ".8rem", fontWeight: 800, color: P.ink, marginTop: 3 }}>{oppRoll ?? "—"}</div>
              </div>
            </div>
            {rollOutcome && (
              <div style={{ fontSize: "1.05rem", fontWeight: 900, marginBottom: 10,
                color: rollOutcome === "win" ? "#3aa83a" : "#c0392b" }}>
                {rollOutcome === "win" ? "✅ You win — card resolves!" : "❌ Challenged — card discarded."}
              </div>
            )}
            {!rollOutcome
              ? <Btn primary accent="#e07a4a" onClick={() => rollTwo(0, true)} disabled={rolling}>{rolling ? "Rolling…" : "🎲 Roll Off"}</Btn>
              : <Btn onClick={() => setModal(null)}>Close</Btn>}
          </div>
        </Modal>
      )}

      {/* CARD ZOOM */}
      {modal === "zoom" && modalData && (
        <Modal accent={P.gold} onClose={() => setModal(null)}>
          <div style={{ padding: 18, textAlign: "center" }}>
            {(() => {
              const isLeader = !!modalData.ability && !modalData.type;
              const cl = modalData.class ? CLASS[modalData.class] : null;
              const tint = cl ? cl.c : P.gold;
              return (
                <>
                  <div style={{ display: "inline-block", borderRadius: 16, padding: 4,
                    background: `linear-gradient(180deg,${P.woodLite},${P.woodDark})` }}>
                    <div style={{ width: 180, background: P.card, borderRadius: 12, overflow: "hidden", border: `3px solid ${tint}` }}>
                      <div style={{ fontSize: ".55rem", fontWeight: 800, color: "#fff", background: tint,
                        padding: "3px 0", textTransform: "uppercase", letterSpacing: 1 }}>
                        {isLeader ? "Party Leader" : modalData.type}
                      </div>
                      <div style={{ height: 100, display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "4rem", background: `${tint}20`, position: "relative" }}>
                        {modalData.emoji}
                        {modalData.roll && <div style={{ position: "absolute", top: 6, right: 6 }}><Coin n={modalData.roll} color={P.roll} deep={P.rollDeep} size={26} /></div>}
                      </div>
                      <div style={{ padding: 10 }}>
                        <div style={{ fontSize: ".9rem", fontWeight: 900, color: P.ink, marginBottom: 4 }}>{modalData.name}</div>
                        {cl && <div style={{ fontSize: ".55rem", color: tint, fontWeight: 700, marginBottom: 6 }}>{cl.icon} {cl.label}</div>}
                        <div style={{ fontSize: ".62rem", color: "#5a4a38", lineHeight: 1.4 }}>{modalData.ability || modalData.text}</div>
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop: 14 }}><Btn onClick={() => setModal(null)}>Close</Btn></div>
                </>
              );
            })()}
          </div>
        </Modal>
      )}

      {/* REDRAW (3 AP) */}
      {modal === "redraw" && (
        <Modal accent={P.gold} onClose={() => setModal(null)}>
          <ModalHead title="Discard & Redraw" accent={P.gold} />
          <div style={{ padding: 18, textAlign: "center" }}>
            <p style={{ fontSize: ".66rem", color: "#6a5a48", marginTop: 0 }}>
              Spend <b>all 3 action points</b> to discard your entire hand and draw 5 fresh cards. This ends your turn.
            </p>
            <div style={{ fontSize: "2rem", margin: "8px 0" }}>🂠➡️🂡🂢🂣🂤🂥</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 8 }}>
              <Btn primary onClick={() => { setHand(START_HAND.slice(0,5).map((c,i)=>({...c,id:c.id+"r"}))); setAp(0); setModal(null); setSelHand(null); }}>Discard & Draw 5</Btn>
              <Btn onClick={() => setModal(null)}>Cancel</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* DISCARD VIEW */}
      {modal === "discardview" && (
        <Modal accent={P.gold} onClose={() => setModal(null)}>
          <ModalHead title="Discard Pile · 7" accent={P.gold} />
          <div style={{ padding: 16 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
              {["🐺","🦄","🗡","🔮","🐱","🎵","🛡"].map((e,i)=>(
                <div key={i} style={{ width: 50, height: 64, background: P.card, borderRadius: 8,
                  border: "2px solid #e8d5b0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.6rem" }}>{e}</div>
              ))}
            </div>
            <div style={{ textAlign: "center", marginTop: 14 }}><Btn onClick={() => setModal(null)}>Close</Btn></div>
          </div>
        </Modal>
      )}

      {/* GAME MENU */}
      {modal === "menu" && (
        <Modal accent={P.skyMid} onClose={() => setModal(null)}>
          <ModalHead title="Game Menu" accent={P.skyMid} />
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <Btn primary accent={P.skyMid} onClick={() => setModal("challenge")}>⚡ Simulate a Challenge</Btn>
            <Btn onClick={() => setModal("win")}>🎉 Preview Victory Screen</Btn>
            <Btn onClick={() => { setShowLeaderPick(true); setModal(null); }}>👑 Re-pick Leader</Btn>
            <Btn onClick={() => setModal(null)}>Resume</Btn>
          </div>
        </Modal>
      )}

      {/* WIN */}
      {modal === "win" && (
        <Modal accent={P.gold} onClose={() => setModal(null)}>
          <div style={{ padding: 24, textAlign: "center", background: `linear-gradient(180deg,#fff,${P.skyGlow}44)` }}>
            <div style={{ fontSize: "3.6rem" }}>🏆</div>
            <div style={{ fontSize: "1.6rem", fontWeight: 900, color: P.goldDeep, marginBottom: 4 }}>Victory!</div>
            <div style={{ fontSize: ".72rem", color: "#6a5a48", marginBottom: 16 }}>
              You slayed 3 monsters and won the game. Your party of cuddly killers reigns over the Twilight Forest.
            </div>
            <Btn primary onClick={() => { setSlain(1); setModal(null); }}>Play Again</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* labels */
function Label({ children, light }) {
  return (
    <div style={{ fontSize: ".46rem", letterSpacing: 2, textTransform: "uppercase",
      color: light ? "#f0e0c0" : "rgba(255,255,255,.75)",
      textShadow: "0 1px 2px rgba(0,0,0,.5)", textAlign: "center" }}>{children}</div>
  );
}

function Pile({ label, n, dim, onClick }) {
  return (
    <div onClick={onClick} style={{ textAlign: "center", cursor: "pointer" }}>
      <div style={{
        width: 30, height: 40, borderRadius: 6,
        background: dim ? "#4a3a28" : `linear-gradient(160deg,${P.skyMid},${P.skyTop})`,
        border: `2px solid ${P.gold}`,
        boxShadow: "0 2px 4px rgba(0,0,0,.4)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", fontSize: ".7rem", fontWeight: 800,
      }}>{n}</div>
      <div style={{ fontSize: ".42rem", color: "#f0e0c0", marginTop: 1, letterSpacing: .5 }}>{label}</div>
    </div>
  );
}

function LeaderCard({ leader }) {
  if (!leader) {
    return (
      <div style={{ width: 96, height: 64, borderRadius: 12, border: "2px dashed #f0e0c0",
        display: "flex", alignItems: "center", justifyContent: "center", color: "#f0e0c0", fontSize: ".6rem", background: "rgba(0,0,0,.2)" }}>
        Pick Leader
      </div>
    );
  }
  const cl = CLASS[leader.class];
  return (
    <div style={{ position: "relative" }}>
      <div style={{ borderRadius: 14, padding: 3, background: `linear-gradient(180deg,${P.gold},${P.goldDeep})`,
        boxShadow: "0 6px 16px rgba(0,0,0,.5)" }}>
        <div style={{ width: 116, background: P.card, borderRadius: 11, overflow: "hidden", border: `3px solid ${P.leader}` }}>
          <div style={{ height: 56, background: `linear-gradient(160deg,${cl.c}33,${cl.c}11)`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2.4rem", position: "relative" }}>
            {leader.emoji}
            <div style={{ position: "absolute", top: 3, left: 4, fontSize: ".7rem" }}>👑</div>
          </div>
          <div style={{ padding: "3px 4px 5px", textAlign: "center" }}>
            <div style={{ fontSize: ".62rem", fontWeight: 900, color: P.ink, lineHeight: 1 }}>{leader.name}</div>
            <div style={{ fontSize: ".4rem", color: "#6a5a48", lineHeight: 1.2, marginTop: 2 }}>{leader.ability}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrayBtn({ label, onClick, primary, enabled }) {
  return (
    <button onClick={enabled ? onClick : undefined} style={{
      flex: 1, border: "none", borderRadius: 10, cursor: enabled ? "pointer" : "default",
      padding: "10px 4px", fontSize: ".62rem", fontWeight: 800, fontFamily: "Georgia, serif", lineHeight: 1.1,
      color: enabled ? (primary ? "#fff" : P.woodDark) : "rgba(255,255,255,.4)",
      background: enabled
        ? (primary ? `linear-gradient(180deg,${P.gold},${P.goldDeep})` : "#e8d5b0")
        : "rgba(0,0,0,.25)",
      boxShadow: enabled ? "0 3px 0 rgba(0,0,0,.3)" : "none",
      transition: "all .12s",
    }}>{label}</button>
  );
}
