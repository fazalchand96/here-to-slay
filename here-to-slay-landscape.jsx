import { useState } from "react";

/* ══════════════════════════════════════════════════════════
   HERE TO SLAY — LANDSCAPE board mockup
   Native horizontal layout (matches the real digital game):
   • thin opponent strip top-left, win-track top-right
   • monsters across the top-center
   • your party row mid
   • wooden hand tray along the bottom, leader raised center
   • deck / discard / AP live on the LEFT & RIGHT rails
   World: original "Twilight Forest" palette. All modals shared.
   Designed to fit a landscape phone WITHOUT vertical scroll.
   ══════════════════════════════════════════════════════════ */

const P = {
  skyTop: "#2a1f4e", skyMid: "#5a3d7a", skyLow: "#c97a8e", skyGlow: "#f0b07a",
  wood: "#6b4a2e", woodLite: "#8a6440", woodDark: "#3e2a18",
  card: "#fdf6e8", ink: "#3a2a1e",
  gold: "#e8b84a", goldDeep: "#a87818",
  roll: "#4a90d9", rollDeep: "#2a5a9a",
  leader: "#e8607a", leaderDeep: "#a83a52",
  mush: "#8ad9c0",
};

const CLASS = {
  fighter:  { c: "#e05a4a", icon: "🔨", label: "Fighter" },
  bard:     { c: "#e89a3a", icon: "🎵", label: "Bard" },
  guardian: { c: "#e8c84a", icon: "🛡", label: "Guardian" },
  ranger:   { c: "#5ab85a", icon: "🏹", label: "Ranger" },
  thief:    { c: "#4a90d9", icon: "🗡", label: "Thief" },
  wizard:   { c: "#9a5ad9", icon: "✦", label: "Wizard" },
};

const LEADERS = [
  { id: "L1", name: "Big Berry", class: "fighter", ability: "On kill, restore HP to self and allies in the row.", emoji: "🐻" },
  { id: "L2", name: "The Fox", class: "ranger", ability: "Draw an extra card at the start of your turn.", emoji: "🦊" },
  { id: "L3", name: "Lord Cinder", class: "wizard", ability: "Your Magic cards cost 1 less action point.", emoji: "🐉" },
];

const START_PARTY = [
  { id: "h1", name: "Bear Claw", class: "fighter", roll: 8, ability: "Roll: deal damage to a hero. Steal a card.", emoji: "🐻", item: "Sharp Fox" },
  { id: "h2", name: "Tipsy Tootie", class: "bard", roll: 7, ability: "Roll: each other player discards a card.", emoji: "🐿", item: null },
  { id: "h3", name: "Wiggles", class: "wizard", roll: 7, ability: "Roll: steal a hero from another player.", emoji: "🐰", item: null },
  { id: "h4", name: "Plundering Puma", class: "thief", roll: 6, ability: "Roll: steal a card from any player's hand.", emoji: "🐆", item: null },
];

const START_HAND = [
  { id: "c1", type: "Hero", name: "Shurikitty", class: "thief", roll: 9, text: "Roll 9+: DESTROY a Hero. Keep its Item.", emoji: "🐱" },
  { id: "c2", type: "Item", name: "Decoy Doll", class: null, text: "Equip. Survives first destruction.", emoji: "🎎" },
  { id: "c3", type: "Magic", name: "Forced Exchange", class: null, text: "Steal a hero, give one back.", emoji: "🔮" },
  { id: "c4", type: "Hero", name: "Lookie Rookie", class: "ranger", roll: 6, text: "Roll 6+: take an Item from discard.", emoji: "🦊" },
  { id: "c5", type: "Modifier", name: "+3 / -2", class: null, text: "Add +3 or -2 to any roll.", emoji: "🎲" },
  { id: "c6", type: "Challenge", name: "Not So Fast", class: null, text: "Challenge a card. Both roll.", emoji: "✋" },
  { id: "c7", type: "Item", name: "Curse of the Snake", class: null, text: "Equip enemy. -1 to their rolls.", emoji: "🐍" },
];

const MONSTERS = [
  { id: "m1", name: "Dragon Hoard", roll: 8, req: "2+ Fighters", reward: "Steal a card on a kill.", penalty: "Sacrifice a Hero.", emoji: "🐲" },
  { id: "m2", name: "Corrupted Sapling", roll: 7, req: "2+ classes", reward: "Draw a card each turn.", penalty: "Discard 2 cards.", emoji: "🌱" },
  { id: "m3", name: "Mega Slime", roll: 10, req: "1+ Wizard", reward: "+1 action point/turn.", penalty: "Discard your hand.", emoji: "🟢" },
];

const OPP = [
  { id: "o1", name: "Mira", emoji: "🦝", party: 4, slain: 1, hand: 3, leader: "🦊" },
  { id: "o2", name: "Drek", emoji: "🐗", party: 6, slain: 0, hand: 5, leader: "🐉" },
  { id: "o3", name: "Kai", emoji: "🦉", party: 2, slain: 2, hand: 4, leader: "🐻" },
];

const faces = ["⚀","⚁","⚂","⚃","⚄","⚅"];

/* ─── shared mini pieces ─── */
function RollBadge({ n, size = 22 }) {
  return (
    <div style={{
      position: "absolute", top: -6, right: -6, zIndex: 4,
      width: size, height: size, borderRadius: "50%",
      background: `radial-gradient(circle at 35% 28%, #bfe0ff, ${P.roll} 55%, ${P.rollDeep})`,
      border: "2px solid #fff", boxShadow: "0 2px 4px rgba(0,0,0,.4)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 900, color: "#fff", fontSize: size * 0.5,
      fontFamily: "Georgia, serif", textShadow: `0 1px 1px ${P.rollDeep}`,
    }}>{n}</div>
  );
}

function PartyCard({ h, onClick, w = 62 }) {
  const cl = CLASS[h.class];
  return (
    <div onClick={onClick} style={{ width: w, position: "relative", cursor: "pointer", flexShrink: 0,
      transition: "transform .15s" }}
      onMouseEnter={e => e.currentTarget.style.transform = "translateY(-3px)"}
      onMouseLeave={e => e.currentTarget.style.transform = "translateY(0)"}>
      <RollBadge n={h.roll} size={18} />
      <div style={{ borderRadius: 8, padding: 2, background: `linear-gradient(180deg,${P.woodLite},${P.woodDark})`,
        boxShadow: "0 2px 4px rgba(0,0,0,.4)" }}>
        <div style={{ background: P.card, borderRadius: 6, overflow: "hidden", border: `2px solid ${cl.c}` }}>
          <div style={{ height: 34, background: `linear-gradient(160deg,${cl.c}33,${cl.c}11)`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.4rem", position: "relative" }}>
            {h.emoji}
            <div style={{ position: "absolute", top: 1, left: 1, fontSize: ".55rem" }}>{cl.icon}</div>
          </div>
          <div style={{ padding: "2px", textAlign: "center" }}>
            <div style={{ fontSize: ".42rem", fontWeight: 800, color: P.ink, lineHeight: 1 }}>{h.name}</div>
            {h.item && <div style={{ fontSize: ".34rem", color: P.goldDeep, background: "#f5e6c0", borderRadius: 3, padding: "0 2px", marginTop: 1 }}>🗡 {h.item}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptySlot({ w = 62 }) {
  return <div style={{ width: w, height: 62, flexShrink: 0, borderRadius: 8,
    border: "2px dashed rgba(255,255,255,.3)", background: "rgba(255,255,255,.06)",
    display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,.4)", fontSize: "1.1rem" }}>+</div>;
}

function HandCard({ c, selected, onClick }) {
  const cl = c.class ? CLASS[c.class] : null;
  const tint = cl ? cl.c : { Item: "#c79a4a", Magic: "#9a5ad9", Modifier: "#5aa8b8", Challenge: "#e07a4a" }[c.type] || "#888";
  return (
    <div onClick={onClick} style={{ width: 60, flexShrink: 0, cursor: "pointer", position: "relative",
      transform: selected ? "translateY(-16px) scale(1.08)" : "translateY(0)",
      transition: "transform .2s cubic-bezier(.34,1.56,.64,1)",
      filter: selected ? "drop-shadow(0 8px 12px rgba(0,0,0,.5))" : "none" }}>
      {c.roll && <RollBadge n={c.roll} size={17} />}
      <div style={{ borderRadius: 8, padding: 2, background: `linear-gradient(180deg,${P.woodLite},${P.woodDark})`,
        boxShadow: "0 2px 4px rgba(0,0,0,.4)" }}>
        <div style={{ background: P.card, borderRadius: 6, overflow: "hidden", border: `2px solid ${tint}` }}>
          <div style={{ fontSize: ".34rem", fontWeight: 800, color: "#fff", background: tint,
            textAlign: "center", padding: "1px 0", textTransform: "uppercase" }}>{c.type}</div>
          <div style={{ height: 30, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.3rem", background: `${tint}18` }}>{c.emoji}</div>
          <div style={{ padding: "1px 2px 3px" }}>
            <div style={{ fontSize: ".42rem", fontWeight: 800, color: P.ink, textAlign: "center", lineHeight: 1 }}>{c.name}</div>
            <div style={{ fontSize: ".32rem", color: "#6a5a48", textAlign: "center", lineHeight: 1.15, marginTop: 1 }}>{c.text}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MonsterCard({ m, onClick }) {
  return (
    <div onClick={onClick} style={{ width: 72, flexShrink: 0, cursor: "pointer", position: "relative" }}>
      <RollBadge n={m.roll} size={18} />
      <div style={{ borderRadius: 8, padding: 2, background: `linear-gradient(180deg,${P.woodLite},${P.woodDark})`,
        boxShadow: "0 2px 4px rgba(0,0,0,.4)" }}>
        <div style={{ background: "#2e2440", borderRadius: 6, overflow: "hidden", border: "2px solid #e0607a" }}>
          <div style={{ height: 32, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.4rem",
            background: "radial-gradient(circle,#5a3a6a,#2e2440)" }}>{m.emoji}</div>
          <div style={{ padding: "2px", textAlign: "center" }}>
            <div style={{ fontSize: ".42rem", fontWeight: 800, color: "#fff", lineHeight: 1 }}>{m.name}</div>
            <div style={{ fontSize: ".34rem", color: "#ffc0c8" }}>{m.req}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── modal shell (shared) ─── */
function Modal({ children, onClose, accent = P.gold }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(10,6,20,.72)",
      backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, animation: "fade .2s ease" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 360, maxHeight: "92vh", overflowY: "auto",
        borderRadius: 18, padding: 4, background: `linear-gradient(180deg,${P.woodLite},${P.woodDark})`,
        boxShadow: `0 20px 50px rgba(0,0,0,.7), 0 0 0 2px ${accent}55`, animation: "pop .25s cubic-bezier(.34,1.56,.64,1)" }}>
        <div style={{ background: "linear-gradient(180deg,#fffaf0,#f3e6cc)", borderRadius: 14, overflow: "hidden" }}>{children}</div>
      </div>
    </div>
  );
}
function ModalHead({ title, accent }) {
  return <div style={{ background: `linear-gradient(180deg,${accent},${accent}cc)`, padding: "10px 14px", textAlign: "center" }}>
    <div style={{ fontSize: ".92rem", fontWeight: 900, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,.4)" }}>{title}</div></div>;
}
function Btn({ children, onClick, primary, accent = P.gold, disabled }) {
  return <button onClick={onClick} disabled={disabled} style={{ border: "none", borderRadius: 10, padding: "9px 16px",
    cursor: disabled ? "default" : "pointer", fontSize: ".76rem", fontWeight: 800, fontFamily: "Georgia, serif",
    color: primary ? "#fff" : P.ink, background: disabled ? "#cbb896" : primary ? `linear-gradient(180deg,${accent},${accent}bb)` : "#e8d5b0",
    boxShadow: disabled ? "none" : "0 3px 0 rgba(0,0,0,.2)" }}>{children}</button>;
}
function Dice({ value, rolling, big }) {
  return <div style={{ fontSize: big ? "3rem" : "2.2rem", lineHeight: 1, color: P.ink,
    filter: rolling ? "blur(1.4px)" : "none" }}>{value ? faces[value - 1] : "🎲"}</div>;
}

/* side rail piece */
function RailPile({ label, n, dim, onClick }) {
  return (
    <div onClick={onClick} style={{ textAlign: "center", cursor: "pointer" }}>
      <div style={{ width: 34, height: 46, borderRadius: 6, margin: "0 auto",
        background: dim ? "#4a3a28" : `linear-gradient(160deg,${P.skyMid},${P.skyTop})`,
        border: `2px solid ${P.gold}`, boxShadow: "0 2px 4px rgba(0,0,0,.4)",
        display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: ".75rem", fontWeight: 800 }}>{n}</div>
      <div style={{ fontSize: ".4rem", color: "#f0e0c0", marginTop: 2, letterSpacing: .5 }}>{label}</div>
    </div>
  );
}

/* ════════════ APP ════════════ */
export default function HereToSlayLandscape() {
  const [leader, setLeader] = useState(LEADERS[0]);
  const [showLeaderPick, setShowLeaderPick] = useState(true);
  const [party, setParty] = useState(START_PARTY);
  const [hand, setHand] = useState(START_HAND);
  const [ap, setAp] = useState(3);
  const [slain, setSlain] = useState(1);
  const [selHand, setSelHand] = useState(null);
  const [modal, setModal] = useState(null);
  const [modalData, setModalData] = useState({});
  const [d1, setD1] = useState(null);
  const [d2, setD2] = useState(null);
  const [rolling, setRolling] = useState(false);
  const [rollOutcome, setRollOutcome] = useState(null);
  const [oppRoll, setOppRoll] = useState(null);

  const total = (d1 || 0) + (d2 || 0);

  const rollTwo = (target, isChallenge = false) => {
    setRolling(true); setRollOutcome(null); setD1(null); setD2(null); setOppRoll(null);
    let n = 0;
    const iv = setInterval(() => {
      setD1(Math.ceil(Math.random()*6)); setD2(Math.ceil(Math.random()*6));
      if (isChallenge) setOppRoll(Math.ceil(Math.random()*12));
      n++;
      if (n >= 12) {
        clearInterval(iv);
        const a = Math.ceil(Math.random()*6), b = Math.ceil(Math.random()*6);
        setD1(a); setD2(b); setRolling(false);
        const sum = a + b;
        if (isChallenge) { const opp = Math.ceil(Math.random()*6)+Math.ceil(Math.random()*6); setOppRoll(opp); setRollOutcome(sum >= opp ? "win":"lose"); }
        else setRollOutcome(sum >= target ? "win":"lose");
      }
    }, 70);
  };

  const openHeroRoll = (h) => { setModalData({ name: h.name, target: h.roll, ability: h.ability }); setD1(null); setD2(null); setRollOutcome(null); setModal("roll"); };
  const openAttack = (m) => { if (ap < 2) return; setModalData({ ...m }); setD1(null); setD2(null); setRollOutcome(null); setModal("attack"); };
  const confirmAttackWin = () => { setAp(a => Math.max(0, a-2)); setSlain(s => s+1); setModal("reward"); };
  const playSelected = () => {
    if (!selHand || ap < 1) return;
    const card = hand.find(c => c.id === selHand);
    if (card.type === "Hero") setParty(p => [...p, { ...card, item: null }]);
    setHand(h => h.filter(c => c.id !== selHand)); setAp(a => a-1); setSelHand(null);
    if (card.type === "Hero") openHeroRoll(card);
  };

  const fullPartyClasses = new Set(party.map(p => p.class)).size;

  return (
    <div style={{ width: "100%", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#0a0614", fontFamily: "Georgia, serif", padding: 8 }}>
      <style>{`
        @keyframes fade{from{opacity:0}to{opacity:1}}
        @keyframes pop{from{transform:scale(.85);opacity:0}to{transform:scale(1);opacity:1}}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
        ::-webkit-scrollbar{height:0;width:0}
      `}</style>

      {/* 16:9 landscape stage */}
      <div style={{ position: "relative", width: "100%", maxWidth: 820, aspectRatio: "16 / 9",
        borderRadius: 16, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,.6)",
        background: `linear-gradient(180deg,${P.skyTop} 0%,${P.skyMid} 45%,${P.skyLow} 74%,${P.skyGlow} 92%)`,
        display: "flex", flexDirection: "column" }}>

        {/* forest silhouette */}
        <svg viewBox="0 0 820 200" style={{ position: "absolute", top: "32%", left: 0, width: "100%", opacity: .5 }}>
          <path d="M0 200 L0 110 L60 70 L120 110 L180 55 L240 110 L300 80 L360 120 L420 60 L480 110 L540 85 L600 120 L660 65 L720 110 L780 90 L820 120 L820 200 Z" fill="#2a1f4e" />
        </svg>
        {[[40,"22%",P.mush],[760,"30%","#e89ad0"],[120,"58%","#e89ad0"],[700,"54%",P.mush]].map(([x,y,c],i)=>(
          <div key={i} style={{ position:"absolute", left:x, top:y, fontSize:".9rem", filter:`drop-shadow(0 0 6px ${c})`, opacity:.7, animation:"float 4s ease-in-out infinite" }}>🍄</div>
        ))}

        {/* ═══ TOP STRIP: opponents (left) + win track (right) ═══ */}
        <div style={{ position: "relative", zIndex: 5, display: "flex", justifyContent: "space-between",
          alignItems: "flex-start", padding: "6px 8px 0" }}>
          <div style={{ display: "flex", gap: 5 }}>
            {OPP.map((o, i) => (
              <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 4,
                background: i === 0 ? "rgba(232,184,74,.25)" : "rgba(0,0,0,.3)",
                border: i === 0 ? "1px solid #e8b84a" : "1px solid rgba(255,255,255,.12)",
                borderRadius: 12, padding: "2px 7px 2px 2px" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "rgba(255,255,255,.12)",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: ".8rem", position: "relative" }}>
                  {o.emoji}<span style={{ position: "absolute", bottom: -2, right: -3, fontSize: ".45rem" }}>{o.leader}</span>
                </div>
                <div>
                  <div style={{ fontSize: ".48rem", color: "#fff", fontWeight: 700, lineHeight: 1 }}>{o.name}</div>
                  <div style={{ fontSize: ".38rem", color: "#d0c0e0" }}>👥{o.party} ✦{o.slain} 🂠{o.hand}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ background: "rgba(0,0,0,.3)", borderRadius: 10, padding: "3px 9px", textAlign: "center" }}>
              <div style={{ fontSize: ".38rem", color: "#d0c0e0", letterSpacing: 1.5, textTransform: "uppercase" }}>Slain to Win</div>
              <div style={{ fontSize: ".8rem" }}>{[0,1,2].map(i => <span key={i} style={{ color: i < slain ? "#ffd96a" : "rgba(255,255,255,.2)", textShadow: i < slain ? "0 0 5px #ffd96a":"none" }}>✦</span>)}</div>
            </div>
            <button onClick={() => setModal("menu")} style={{ background: "rgba(0,0,0,.3)", border: "none", borderRadius: 8,
              color: "#fff", padding: "5px 9px", fontSize: ".85rem", cursor: "pointer" }}>☰</button>
          </div>
        </div>

        {/* ═══ MONSTERS (top-center) ═══ */}
        <div style={{ position: "relative", zIndex: 5, textAlign: "center", paddingTop: 4 }}>
          <div style={{ fontSize: ".4rem", letterSpacing: 2, color: "rgba(255,255,255,.7)", textTransform: "uppercase", textShadow: "0 1px 2px #000" }}>Monsters · 2 AP to attack</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", paddingTop: 4 }}>
            {MONSTERS.map(m => <MonsterCard key={m.id} m={m} onClick={() => openAttack(m)} />)}
          </div>
        </div>

        {/* ═══ MIDDLE: left rail + party + right rail ═══ */}
        <div style={{ position: "relative", zIndex: 5, flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px" }}>
          {/* LEFT RAIL: deck + discard */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "rgba(0,0,0,.22)", borderRadius: 12, padding: "8px 7px" }}>
            <RailPile label="Deck" n={32} onClick={() => { if (ap>=1) setAp(a=>a-1); }} />
            <RailPile label="Discard" n={7} dim onClick={() => setModal("discardview")} />
          </div>

          {/* PARTY */}
          <div style={{ textAlign: "center", flex: 1 }}>
            <div style={{ fontSize: ".4rem", letterSpacing: 2, color: "rgba(255,255,255,.7)", textTransform: "uppercase", textShadow: "0 1px 2px #000", marginBottom: 4 }}>
              Your Party · {fullPartyClasses}/6 classes
            </div>
            <div style={{ display: "flex", gap: 7, justifyContent: "center", flexWrap: "wrap" }}>
              {party.map(h => <PartyCard key={h.id} h={h} onClick={() => openHeroRoll(h)} />)}
              {[...Array(Math.max(0, 6 - party.length))].map((_, i) => <EmptySlot key={i} />)}
            </div>
          </div>

          {/* RIGHT RAIL: AP + redraw */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center", background: "rgba(0,0,0,.22)", borderRadius: 12, padding: "8px 7px" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: ".38rem", color: "#f0e0c0", letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 }}>Actions</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {[1,2,3].map(i => (
                  <div key={i} style={{ width: 22, height: 22, borderRadius: "50%", margin: "0 auto",
                    background: ap >= i ? `radial-gradient(circle at 35% 28%,#fff,${P.gold} 55%,${P.goldDeep})` : "rgba(255,255,255,.1)",
                    border: ap >= i ? "2px solid #ffe9a8" : "2px solid rgba(255,255,255,.2)",
                    boxShadow: ap >= i ? `0 0 8px ${P.gold}88` : "none", transition: "all .3s" }} />
                ))}
              </div>
            </div>
            <button onClick={() => ap>=3 && setModal("redraw")} style={{ background: ap>=3 ? "rgba(232,184,74,.25)":"rgba(0,0,0,.25)",
              border: "1px solid rgba(232,184,74,.4)", borderRadius: 8, color: "#f0e0c0", fontSize: ".4rem", padding: "4px 5px", cursor: "pointer", lineHeight: 1.2 }}>Redraw<br/>3 AP</button>
          </div>
        </div>

        {/* ═══ BOTTOM TRAY: leader (raised) + hand ═══ */}
        <div style={{ position: "relative", zIndex: 6,
          background: `linear-gradient(180deg,${P.woodLite} 0%,${P.wood} 30%,${P.woodDark} 100%)`,
          borderTop: `3px solid ${P.gold}`, boxShadow: "0 -5px 18px rgba(0,0,0,.5)",
          padding: "4px 10px 8px", borderRadius: "16px 16px 0 0",
          display: "flex", alignItems: "center", gap: 10 }}>

          {/* leader, raised */}
          <div style={{ marginTop: -28, flexShrink: 0 }}>
            <div onClick={() => { setModalData(leader); setModal("zoom"); }} style={{ cursor: "pointer", animation: "float 5s ease-in-out infinite" }}>
              <LeaderCard leader={leader} />
            </div>
          </div>

          {/* hand */}
          <div style={{ flex: 1, overflow: "hidden" }}>
            <div style={{ fontSize: ".38rem", letterSpacing: 1.5, color: "#f0e0c0", textTransform: "uppercase", marginBottom: 2 }}>Your Hand · {hand.length}</div>
            <div style={{ display: "flex", gap: 5, overflowX: "auto", paddingTop: 14, paddingBottom: 2 }}>
              {hand.map(c => <HandCard key={c.id} c={c} selected={selHand === c.id} onClick={() => setSelHand(selHand === c.id ? null : c.id)} />)}
            </div>
          </div>

          {/* action buttons stacked */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5, flexShrink: 0, width: 80 }}>
            <TrayBtn label={selHand ? "Play · 1 AP" : "Select card"} primary enabled={!!selHand && ap >= 1} onClick={playSelected} />
            <TrayBtn label="View" enabled={!!selHand} onClick={() => { setModalData(hand.find(c=>c.id===selHand)); setModal("zoom"); }} />
            <TrayBtn label="End Turn" enabled onClick={() => setAp(3)} />
          </div>
        </div>

        {/* ════ MODALS (shared) ════ */}
        {showLeaderPick && (
          <Modal accent={P.leader} onClose={() => {}}>
            <ModalHead title="Choose Your Party Leader" accent={P.leader} />
            <div style={{ padding: 14 }}>
              <p style={{ fontSize: ".58rem", color: "#6a5a48", textAlign: "center", marginTop: 0, marginBottom: 10 }}>
                Your leader stays all game and grants a passive. They don't count toward your 6 classes.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {LEADERS.map(L => { const cl = CLASS[L.class]; return (
                  <div key={L.id} onClick={() => { setLeader(L); setShowLeaderPick(false); }} style={{ display: "flex", gap: 9, alignItems: "center",
                    cursor: "pointer", background: "#fff", border: `2px solid ${cl.c}`, borderRadius: 10, padding: 7 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 8, flexShrink: 0, background: `linear-gradient(160deg,${cl.c}33,${cl.c}11)`,
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.6rem" }}>{L.emoji}</div>
                    <div><div style={{ fontSize: ".74rem", fontWeight: 800, color: P.ink }}>{L.name} <span style={{ fontSize: ".5rem", color: cl.c }}>{cl.icon} {cl.label}</span></div>
                      <div style={{ fontSize: ".54rem", color: "#6a5a48", lineHeight: 1.25 }}>{L.ability}</div></div>
                  </div> ); })}
              </div>
            </div>
          </Modal>
        )}

        {modal === "roll" && (
          <Modal accent={P.roll} onClose={() => setModal(null)}>
            <ModalHead title={`${modalData.name} — Roll ${modalData.target}+`} accent={P.roll} />
            <div style={{ padding: 16, textAlign: "center" }}>
              <p style={{ fontSize: ".58rem", color: "#6a5a48", marginTop: 0, marginBottom: 12 }}>{modalData.ability}</p>
              <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 6 }}><Dice value={d1} rolling={rolling} big /><Dice value={d2} rolling={rolling} big /></div>
              <div style={{ fontSize: ".85rem", fontWeight: 800, color: P.ink, marginBottom: 4 }}>{d1 ? `Total: ${total}` : "—"}</div>
              {rollOutcome && <div style={{ fontSize: "1rem", fontWeight: 900, marginBottom: 10, color: rollOutcome === "win" ? "#3aa83a":"#c0392b" }}>{rollOutcome === "win" ? "✅ Success!" : "❌ Failed"}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                {!rollOutcome ? <Btn primary accent={P.roll} onClick={() => rollTwo(modalData.target)} disabled={rolling}>{rolling ? "Rolling…":"🎲 Roll 2 Dice"}</Btn> : <Btn onClick={() => setModal(null)}>Close</Btn>}
                {!rollOutcome && <Btn onClick={() => setModal(null)}>Cancel</Btn>}
              </div>
            </div>
          </Modal>
        )}

        {modal === "attack" && (
          <Modal accent={P.leader} onClose={() => setModal(null)}>
            <ModalHead title={`Attack: ${modalData.name}`} accent={P.leader} />
            <div style={{ padding: 16, textAlign: "center" }}>
              <div style={{ fontSize: "2.6rem", marginBottom: 4 }}>{modalData.emoji}</div>
              <div style={{ fontSize: ".54rem", color: "#6a5a48" }}>Requires: {modalData.req}</div>
              <div style={{ fontSize: ".54rem", color: "#3aa83a" }}>🏆 {modalData.reward}</div>
              <div style={{ fontSize: ".54rem", color: "#c0392b", marginBottom: 10 }}>💀 {modalData.penalty}</div>
              <div style={{ fontSize: ".66rem", fontWeight: 800, color: P.rollDeep, marginBottom: 8 }}>Roll {modalData.roll}+ to slay</div>
              <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 6 }}><Dice value={d1} rolling={rolling} big /><Dice value={d2} rolling={rolling} big /></div>
              <div style={{ fontSize: ".85rem", fontWeight: 800, color: P.ink, marginBottom: 6 }}>{d1 ? `Total: ${total}` : "—"}</div>
              {rollOutcome && <div style={{ fontSize: "1rem", fontWeight: 900, marginBottom: 8, color: rollOutcome === "win" ? "#3aa83a":"#c0392b" }}>{rollOutcome === "win" ? "⚔️ SLAIN!" : "💀 It fights back!"}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                {!rollOutcome ? <Btn primary accent={P.leader} onClick={() => rollTwo(modalData.roll)} disabled={rolling}>{rolling ? "Rolling…":"🎲 Roll to Slay"}</Btn>
                  : rollOutcome === "win" ? <Btn primary accent="#3aa83a" onClick={confirmAttackWin}>Claim Reward →</Btn>
                  : <Btn primary accent="#c0392b" onClick={() => setModal(null)}>Accept Fate</Btn>}
              </div>
            </div>
          </Modal>
        )}

        {modal === "reward" && (
          <Modal accent="#3aa83a" onClose={() => setModal(null)}>
            <ModalHead title="Monster Slain!" accent="#3aa83a" />
            <div style={{ padding: 18, textAlign: "center" }}>
              <div style={{ fontSize: "3rem" }}>{modalData.emoji}</div>
              <div style={{ fontSize: ".88rem", fontWeight: 800, color: P.ink, marginBottom: 8 }}>{modalData.name} joins your party</div>
              <div style={{ background: "#eafaea", border: "2px solid #3aa83a", borderRadius: 10, padding: 8, marginBottom: 12 }}>
                <div style={{ fontSize: ".44rem", color: "#2a7a2a", letterSpacing: 1, textTransform: "uppercase", marginBottom: 2 }}>Permanent Reward</div>
                <div style={{ fontSize: ".62rem", color: P.ink }}>{modalData.reward}</div></div>
              <div style={{ fontSize: ".62rem", color: "#6a5a48", marginBottom: 10 }}>You've slain <b>{slain}</b> of 3 monsters.</div>
              <Btn primary accent="#3aa83a" onClick={() => { if (slain >= 3) setModal("win"); else setModal(null); }}>{slain >= 3 ? "🎉 See Victory":"Continue"}</Btn>
            </div>
          </Modal>
        )}

        {modal === "challenge" && (
          <Modal accent="#e07a4a" onClose={() => setModal(null)}>
            <ModalHead title="⚡ Challenge!" accent="#e07a4a" />
            <div style={{ padding: 16, textAlign: "center" }}>
              <p style={{ fontSize: ".58rem", color: "#6a5a48", marginTop: 0, marginBottom: 12 }}><b>Drek</b> challenged your card. Both roll — highest wins. Loser's card is discarded.</p>
              <div style={{ display: "flex", justifyContent: "space-around", marginBottom: 10 }}>
                <div><div style={{ fontSize: ".46rem", color: P.roll, fontWeight: 800, marginBottom: 3 }}>YOU</div>
                  <div style={{ display: "flex", gap: 5, justifyContent: "center" }}><Dice value={d1} rolling={rolling} /><Dice value={d2} rolling={rolling} /></div>
                  <div style={{ fontSize: ".74rem", fontWeight: 800, color: P.ink, marginTop: 2 }}>{d1 ? total : "—"}</div></div>
                <div style={{ fontSize: "1.2rem", alignSelf: "center", color: "#c0392b" }}>VS</div>
                <div><div style={{ fontSize: ".46rem", color: "#c0392b", fontWeight: 800, marginBottom: 3 }}>DREK</div>
                  <div style={{ fontSize: "1.9rem", color: P.ink, filter: rolling ? "blur(1.4px)":"none" }}>🎲</div>
                  <div style={{ fontSize: ".74rem", fontWeight: 800, color: P.ink, marginTop: 2 }}>{oppRoll ?? "—"}</div></div>
              </div>
              {rollOutcome && <div style={{ fontSize: "1rem", fontWeight: 900, marginBottom: 8, color: rollOutcome === "win" ? "#3aa83a":"#c0392b" }}>{rollOutcome === "win" ? "✅ Card resolves!" : "❌ Card discarded."}</div>}
              {!rollOutcome ? <Btn primary accent="#e07a4a" onClick={() => rollTwo(0, true)} disabled={rolling}>{rolling ? "Rolling…":"🎲 Roll Off"}</Btn> : <Btn onClick={() => setModal(null)}>Close</Btn>}
            </div>
          </Modal>
        )}

        {modal === "zoom" && modalData && (
          <Modal accent={P.gold} onClose={() => setModal(null)}>
            <div style={{ padding: 16, textAlign: "center" }}>
              {(() => { const isLeader = !!modalData.ability && !modalData.type; const cl = modalData.class ? CLASS[modalData.class] : null; const tint = cl ? cl.c : P.gold;
                return (<>
                  <div style={{ display: "inline-block", borderRadius: 14, padding: 4, background: `linear-gradient(180deg,${P.woodLite},${P.woodDark})` }}>
                    <div style={{ width: 160, background: P.card, borderRadius: 10, overflow: "hidden", border: `3px solid ${tint}` }}>
                      <div style={{ fontSize: ".5rem", fontWeight: 800, color: "#fff", background: tint, padding: "2px 0", textTransform: "uppercase", letterSpacing: 1 }}>{isLeader ? "Party Leader" : modalData.type}</div>
                      <div style={{ height: 88, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "3.4rem", background: `${tint}20` }}>{modalData.emoji}</div>
                      <div style={{ padding: 9 }}>
                        <div style={{ fontSize: ".82rem", fontWeight: 900, color: P.ink, marginBottom: 3 }}>{modalData.name}</div>
                        {cl && <div style={{ fontSize: ".5rem", color: tint, fontWeight: 700, marginBottom: 5 }}>{cl.icon} {cl.label}</div>}
                        <div style={{ fontSize: ".58rem", color: "#5a4a38", lineHeight: 1.35 }}>{modalData.ability || modalData.text}</div></div>
                    </div></div>
                  <div style={{ marginTop: 12 }}><Btn onClick={() => setModal(null)}>Close</Btn></div>
                </>); })()}
            </div>
          </Modal>
        )}

        {modal === "redraw" && (
          <Modal accent={P.gold} onClose={() => setModal(null)}>
            <ModalHead title="Discard & Redraw" accent={P.gold} />
            <div style={{ padding: 16, textAlign: "center" }}>
              <p style={{ fontSize: ".62rem", color: "#6a5a48", marginTop: 0 }}>Spend <b>all 3 AP</b> to discard your hand and draw 5 fresh cards. Ends your turn.</p>
              <div style={{ fontSize: "1.6rem", margin: "6px 0" }}>🂠➡️🂡🂢🂣🂤🂥</div>
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                <Btn primary onClick={() => { setHand(START_HAND.slice(0,5).map((c)=>({...c,id:c.id+"r"}))); setAp(0); setModal(null); setSelHand(null); }}>Discard & Draw 5</Btn>
                <Btn onClick={() => setModal(null)}>Cancel</Btn></div>
            </div>
          </Modal>
        )}

        {modal === "discardview" && (
          <Modal accent={P.gold} onClose={() => setModal(null)}>
            <ModalHead title="Discard Pile · 7" accent={P.gold} />
            <div style={{ padding: 14 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, justifyContent: "center" }}>
                {["🐺","🦄","🗡","🔮","🐱","🎵","🛡"].map((e,i)=>(<div key={i} style={{ width: 44, height: 56, background: P.card, borderRadius: 6, border: "2px solid #e8d5b0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.4rem" }}>{e}</div>))}
              </div>
              <div style={{ textAlign: "center", marginTop: 12 }}><Btn onClick={() => setModal(null)}>Close</Btn></div>
            </div>
          </Modal>
        )}

        {modal === "menu" && (
          <Modal accent={P.skyMid} onClose={() => setModal(null)}>
            <ModalHead title="Game Menu" accent={P.skyMid} />
            <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 7 }}>
              <Btn primary accent={P.skyMid} onClick={() => setModal("challenge")}>⚡ Simulate a Challenge</Btn>
              <Btn onClick={() => setModal("win")}>🎉 Preview Victory</Btn>
              <Btn onClick={() => { setShowLeaderPick(true); setModal(null); }}>👑 Re-pick Leader</Btn>
              <Btn onClick={() => setModal(null)}>Resume</Btn>
            </div>
          </Modal>
        )}

        {modal === "win" && (
          <Modal accent={P.gold} onClose={() => setModal(null)}>
            <div style={{ padding: 22, textAlign: "center", background: `linear-gradient(180deg,#fff,${P.skyGlow}44)` }}>
              <div style={{ fontSize: "3rem" }}>🏆</div>
              <div style={{ fontSize: "1.4rem", fontWeight: 900, color: P.goldDeep, marginBottom: 4 }}>Victory!</div>
              <div style={{ fontSize: ".66rem", color: "#6a5a48", marginBottom: 14 }}>You slayed 3 monsters and won. Your party of cuddly killers reigns over the Twilight Forest.</div>
              <Btn primary onClick={() => { setSlain(1); setModal(null); }}>Play Again</Btn>
            </div>
          </Modal>
        )}
      </div>
    </div>
  );
}

function LeaderCard({ leader }) {
  if (!leader) return <div style={{ width: 80, height: 50, borderRadius: 10, border: "2px dashed #f0e0c0", display: "flex", alignItems: "center", justifyContent: "center", color: "#f0e0c0", fontSize: ".5rem", background: "rgba(0,0,0,.2)" }}>Pick Leader</div>;
  const cl = CLASS[leader.class];
  return (
    <div style={{ borderRadius: 12, padding: 3, background: `linear-gradient(180deg,${P.gold},${P.goldDeep})`, boxShadow: "0 5px 14px rgba(0,0,0,.5)" }}>
      <div style={{ width: 92, background: P.card, borderRadius: 9, overflow: "hidden", border: `3px solid ${P.leader}` }}>
        <div style={{ height: 44, background: `linear-gradient(160deg,${cl.c}33,${cl.c}11)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2rem", position: "relative" }}>
          {leader.emoji}<div style={{ position: "absolute", top: 2, left: 3, fontSize: ".6rem" }}>👑</div></div>
        <div style={{ padding: "2px 3px 4px", textAlign: "center" }}>
          <div style={{ fontSize: ".52rem", fontWeight: 900, color: P.ink, lineHeight: 1 }}>{leader.name}</div>
          <div style={{ fontSize: ".34rem", color: "#6a5a48", lineHeight: 1.15, marginTop: 1 }}>{leader.ability}</div></div>
      </div>
    </div>
  );
}

function TrayBtn({ label, onClick, primary, enabled }) {
  return <button onClick={enabled ? onClick : undefined} style={{ border: "none", borderRadius: 8, cursor: enabled ? "pointer":"default",
    padding: "7px 4px", fontSize: ".52rem", fontWeight: 800, fontFamily: "Georgia, serif", lineHeight: 1.1,
    color: enabled ? (primary ? "#fff":P.woodDark) : "rgba(255,255,255,.4)",
    background: enabled ? (primary ? `linear-gradient(180deg,${P.gold},${P.goldDeep})`:"#e8d5b0") : "rgba(0,0,0,.25)",
    boxShadow: enabled ? "0 2px 0 rgba(0,0,0,.3)":"none" }}>{label}</button>;
}
