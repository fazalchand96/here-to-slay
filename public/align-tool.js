/* ===========================================================================
 * Board alignment tool  —  dev-only, loaded ONLY with ?align=1 (or Ctrl+Shift+A)
 *
 * Drag / resize / rotate / tilt the board zones straight in the running game,
 * then copy the CSS it produces and paste it into style.css. Values are written
 * as inline `!important` styles so they beat the stylesheet while you tweak.
 *
 * left/top are expressed as % of the element's OFFSET PARENT (which is how the
 * real rules are written — e.g. #main-deck is positioned inside .deck-area, not
 * the board), width/height in px, plus rotate(Z), rotateX(tilt) and perspective.
 *
 * Tweaks persist in localStorage so a reload keeps your work-in-progress.
 * =========================================================================== */
(function () {
  'use strict';
  if (window.__alignTool) return;

  const STORE = 'hts-align-v1';
  const SNAP = 0.1;                       // % rounding for left/top

  // Each target maps to the selector its real rule uses, per orientation, so the
  // exported CSS can be pasted straight over the existing block.
  const TARGETS = [
    { key: 'main-deck',    label: 'Draw pile',      sel: '#main-deck',        centered: true,
      css: { landscape: 'body.landscape #board-center .deck-area > #main-deck',
             portrait:  '#game-board.portrait #board-center .deck-area > #main-deck' } },
    { key: 'discard-pile', label: 'Discard pile',   sel: '#discard-pile',     centered: true,
      css: { landscape: 'body.landscape #board-center .deck-area > #discard-pile',
             portrait:  '#game-board.portrait #board-center .deck-area > #discard-pile' } },
    { key: 'deck-area',    label: 'Deck area (box)', sel: '.deck-area',       centered: false,
      css: { landscape: 'body.landscape #board-center .deck-area',
             portrait:  '#game-board.portrait #board-center .deck-area' } },
    { key: 'ap-gems',      label: 'AP gems',        sel: '#ap-gems',          centered: false,
      css: { landscape: 'body.landscape #ap-gems', portrait: '#game-board.portrait #ap-gems' } },
    { key: 'leader-slot',  label: 'Party leader',   sel: '#leader-slot',      centered: false,
      css: { landscape: 'body.landscape #leader-slot', portrait: '#game-board.portrait #leader-slot' } },
    { key: 'monsters-area', label: 'Monsters panel', sel: '.monsters-area',   centered: false,
      css: { landscape: 'body.landscape .monsters-area',
             portrait:  '#game-board.portrait #board-center .monsters-area' } },
    { key: 'party-zone',   label: 'Party panel',    sel: '#party-zone',       centered: false,
      css: { landscape: 'body.landscape #party-zone', portrait: '#game-board.portrait #party-zone' } },
    { key: 'hand-zone',    label: 'Hand tray',      sel: '#hand-zone',        centered: false,
      css: { landscape: 'body.landscape #hand-zone', portrait: '#game-board.portrait #hand-zone' } },
    { key: 'opponents-bar', label: 'Opponents bar', sel: '#opponents-bar',    centered: false,
      css: { landscape: 'body.landscape #opponents-bar', portrait: '#game-board.portrait #opponents-bar' } },
    { key: 'win-tracker',  label: 'Win tracker',    sel: '#player-win-tracker', centered: false,
      css: { landscape: 'body.landscape #player-win-tracker', portrait: '#game-board.portrait #player-win-tracker' } },
    { key: 'controls',     label: 'Action buttons', sel: '#player-controls',  centered: false,
      css: { landscape: 'body.landscape #player-controls', portrait: '#game-board.portrait #player-controls' } },
  ];

  const round = (n, s = SNAP) => Math.round(n / s) * s;
  const fmt = (n) => (Math.round(n * 100) / 100).toString();
  const orientation = () =>
    document.getElementById('game-board')?.classList.contains('portrait') ? 'portrait' : 'landscape';

  const el = (t) => document.querySelector(t.sel);
  const state = JSON.parse(localStorage.getItem(STORE) || '{}');
  const save = () => localStorage.setItem(STORE, JSON.stringify(state));
  const slot = (t) => (state[orientation()] ||= {})[t.key];

  /* --- read the element's live geometry into a state object ----------------
     The tool can load while the game is still in the lobby, where the board
     zones are display:none — offsetWidth is 0 and offsetParent is null, which
     would measure as NaN/0 and then get applied (and cached) as a zero-size
     element. Refuse to measure anything that isn't actually laid out; callers
     retry once it is. */
  const laidOut = (e) => e && e.offsetParent && e.offsetWidth > 0 && e.offsetHeight > 0
    && e.offsetParent.clientWidth > 0 && e.offsetParent.clientHeight > 0;

  const valid = (s) => !!s && Number.isFinite(s.left) && Number.isFinite(s.top)
    && s.width > 0 && s.height > 0;

  function measure(t) {
    const e = el(t);
    if (!laidOut(e)) return null;
    const p = e.offsetParent;
    return {
      left: round((e.offsetLeft / p.clientWidth) * 100),
      top: round((e.offsetTop / p.clientHeight) * 100),
      width: Math.round(e.offsetWidth),
      height: Math.round(e.offsetHeight),
      rotate: 0, tiltX: 0, persp: 600,
    };
  }

  // Returns a usable state, or null while the element isn't on screen yet.
  function ensure(t) {
    const o = (state[orientation()] ||= {});
    if (valid(o[t.key])) return o[t.key];
    const m = measure(t);
    if (m) o[t.key] = m; else delete o[t.key];
    return o[t.key] || null;
  }

  // Drop anything a previous (buggy or stale) session persisted as invalid.
  for (const or of Object.keys(state)) {
    for (const k of Object.keys(state[or] || {})) if (!valid(state[or][k])) delete state[or][k];
  }
  save();

  function transformOf(t, s) {
    let tf = '';
    if (t.centered) tf += 'translate(-50%, -50%) ';
    if (s.persp && (s.tiltX || 0) !== 0) tf += `perspective(${s.persp}px) `;
    if (s.tiltX) tf += `rotateX(${fmt(s.tiltX)}deg) `;
    if (s.rotate) tf += `rotate(${fmt(s.rotate)}deg)`;
    return tf.trim() || 'none';
  }

  function apply(t) {
    const e = el(t), s = slot(t);
    if (!e || !valid(s)) return;          // never write NaN/0 onto the board
    const S = (k, v) => e.style.setProperty(k, v, 'important');
    S('position', 'absolute');
    S('left', fmt(s.left) + '%');
    S('top', fmt(s.top) + '%');
    S('right', 'auto');
    S('bottom', 'auto');
    S('width', s.width + 'px');
    S('height', s.height + 'px');
    S('transform', transformOf(t, s));
    drawSel();
  }

  function applyAll() { TARGETS.forEach((t) => { if (valid(slot(t))) apply(t); }); }

  /* --- selection outline + resize handle ----------------------------------- */
  const outline = document.createElement('div');
  const handle = document.createElement('div');
  outline.id = '__align-outline';
  handle.id = '__align-handle';
  let current = TARGETS[0];

  function drawSel() {
    const e = el(current);
    if (!e) { outline.style.display = 'none'; handle.style.display = 'none'; return; }
    const r = e.getBoundingClientRect();
    outline.style.display = handle.style.display = 'block';
    Object.assign(outline.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    Object.assign(handle.style, { left: r.right - 7 + 'px', top: r.bottom - 7 + 'px' });
  }

  /* --- grid overlay --------------------------------------------------------- */
  let grid = null;
  function toggleGrid(on) {
    if (grid) { grid.remove(); grid = null; }
    if (!on) return;
    const board = document.getElementById('game-board');
    grid = document.createElement('div');
    grid.id = '__align-grid';
    for (let p = 0; p <= 100; p += 5) {
      const bold = p % 10 === 0;
      for (const axis of ['v', 'h']) {
        const l = document.createElement('div');
        l.className = 'gl' + (bold ? ' b' : '');
        if (axis === 'v') Object.assign(l.style, { left: p + '%', top: 0, width: '1px', height: '100%' });
        else Object.assign(l.style, { top: p + '%', left: 0, height: '1px', width: '100%' });
        grid.appendChild(l);
      }
    }
    board.appendChild(grid);
  }

  /* --- CSS export ----------------------------------------------------------- */
  function cssFor(t) {
    const s = slot(t);
    if (!valid(s)) return `/* ${t.label}: not on screen yet — start a game, then reselect. */`;
    const o = orientation();
    return `${t.css[o]} {\n` +
      `    left: ${fmt(s.left)}% !important; top: ${fmt(s.top)}% !important;\n` +
      `    width: ${s.width}px !important; height: ${s.height}px !important;\n` +
      `    transform: ${transformOf(t, s)} !important;\n` +
      (t.centered ? `    transform-origin: center 60% !important;\n` : '') +
      `}`;
  }
  const cssAll = () => TARGETS.filter((t) => valid(slot(t))).map(cssFor).join('\n\n');

  /* --- panel ---------------------------------------------------------------- */
  const panel = document.createElement('div');
  panel.id = '__align-panel';
  panel.innerHTML = `
    <header>Align tool <span id="__a-or"></span><button id="__a-close">×</button></header>
    <label>Element
      <select id="__a-target">${TARGETS.map((t, i) => `<option value="${i}">${t.label}</option>`).join('')}</select>
    </label>
    <div class="row"><label>left %<input id="__a-left" type="number" step="0.1"></label>
                     <label>top %<input id="__a-top" type="number" step="0.1"></label></div>
    <div class="row"><label>width px<input id="__a-w" type="number" step="1"></label>
                     <label>height px<input id="__a-h" type="number" step="1"></label></div>
    <label>rotate <span id="__a-rv">0</span>°<input id="__a-rot" type="range" min="-30" max="30" step="0.5"></label>
    <label>tilt (rotateX) <span id="__a-tv">0</span>°<input id="__a-tilt" type="range" min="-30" max="30" step="0.5"></label>
    <label>perspective <span id="__a-pv">600</span>px<input id="__a-persp" type="range" min="200" max="1600" step="20"></label>
    <div class="row">
      <button id="__a-grid">Grid</button>
      <button id="__a-reset">Reset this</button>
      <button id="__a-resetall">Reset all</button>
    </div>
    <div class="row">
      <button id="__a-copy" class="pri">Copy CSS (this)</button>
      <button id="__a-copyall" class="pri">Copy CSS (all)</button>
    </div>
    <textarea id="__a-out" readonly rows="6"></textarea>
    <small>Drag element to move · arrows nudge (Shift ×10) · corner handle resizes</small>`;

  const style = document.createElement('style');
  style.textContent = `
    /* Landscape phones are only ~390px tall, so the panel must scroll rather than
       run off-screen; the header stays pinned so it's always draggable. */
    /* Docked right by default: the deck/discard/leader all live in the left
       column, and a panel sitting on them would eat their mousedown. Draggable. */
    #__align-panel{position:fixed;z-index:2147483647;top:8px;right:8px;width:250px;background:#14100c;
      color:#f2e2b4;font:11px/1.35 system-ui,sans-serif;border:1px solid #6b4d1f;border-radius:8px;
      padding:8px;box-shadow:0 8px 28px rgba(0,0,0,.6);
      max-height:calc(100vh - 16px);overflow-y:auto;overscroll-behavior:contain}
    #__align-panel header{position:sticky;top:-8px;background:#14100c;padding:2px 0;
      display:flex;align-items:center;gap:6px;font-weight:700;margin-bottom:6px;cursor:move}
    #__align-panel header span{font-weight:400;opacity:.6;font-size:10px}
    #__align-panel header button{margin-left:auto;background:none;border:0;color:#f2e2b4;font-size:15px;cursor:pointer}
    #__align-panel label{display:block;margin:4px 0;opacity:.9}
    #__align-panel .row{display:flex;gap:6px}
    #__align-panel .row label,#__align-panel .row button{flex:1}
    #__align-panel input,#__align-panel select,#__align-panel textarea{width:100%;box-sizing:border-box;
      background:#241b12;color:#ffe9b8;border:1px solid #6b4d1f;border-radius:4px;padding:3px}
    #__align-panel input[type=range]{padding:0}
    #__align-panel button{background:#33261a;color:#f2e2b4;border:1px solid #6b4d1f;border-radius:4px;
      padding:4px;cursor:pointer;font-size:11px}
    #__align-panel button.pri{background:#7a5a1e}
    #__align-panel textarea{font-family:ui-monospace,monospace;font-size:10px;margin-top:6px}
    #__align-panel small{display:block;margin-top:5px;opacity:.55;font-size:10px}
    #__align-outline{position:fixed;z-index:2147483646;border:1px dashed #35e2ff;pointer-events:none;display:none}
    #__align-handle{position:fixed;z-index:2147483647;width:14px;height:14px;background:#35e2ff;border-radius:3px;
      cursor:nwse-resize;display:none}
    #__align-grid{position:absolute;inset:0;z-index:999;pointer-events:none}
    #__align-grid .gl{position:absolute;background:rgba(0,255,255,.30)}
    #__align-grid .gl.b{background:rgba(255,0,180,.55)}`;

  /* --- wiring --------------------------------------------------------------- */
  const $ = (id) => panel.querySelector(id);
  function syncInputs() {
    const s = ensure(current);
    $('#__a-or').textContent = '(' + orientation() + ')';
    const ready = valid(s);
    panel.querySelectorAll('input,#__a-copy,#__a-copyall').forEach((n) => { n.disabled = !ready; });
    if (!ready) { $('#__a-out').value = cssFor(current); drawSel(); return; }
    $('#__a-left').value = fmt(s.left); $('#__a-top').value = fmt(s.top);
    $('#__a-w').value = s.width;        $('#__a-h').value = s.height;
    $('#__a-rot').value = s.rotate;     $('#__a-rv').textContent = fmt(s.rotate);
    $('#__a-tilt').value = s.tiltX;     $('#__a-tv').textContent = fmt(s.tiltX);
    $('#__a-persp').value = s.persp;    $('#__a-pv').textContent = s.persp;
    $('#__a-out').value = cssFor(current);
    drawSel();
  }
  function commit() { apply(current); save(); $('#__a-out').value = cssFor(current); }

  function bindNum(id, key, isInt) {
    $(id).addEventListener('input', (e) => {
      const s = ensure(current);
      if (!valid(s)) return;
      s[key] = isInt ? parseInt(e.target.value, 10) || 0 : parseFloat(e.target.value) || 0;
      commit();
    });
  }
  function bindRange(id, key, out) {
    $(id).addEventListener('input', (e) => {
      const s = ensure(current);
      if (!valid(s)) return;
      s[key] = parseFloat(e.target.value);
      $(out).textContent = fmt(s[key]);
      commit();
    });
  }

  function init() {
    document.head.appendChild(style);
    document.body.append(panel, outline, handle);
    // The tool is only meaningful once the board is on screen. Stay fully hidden
    // during the lobby, or the panel sits on top of ROLL FOR LEADER / START.
    panel.style.display = 'none';

    $('#__a-target').addEventListener('change', (e) => { current = TARGETS[+e.target.value]; syncInputs(); });
    bindNum('#__a-left', 'left'); bindNum('#__a-top', 'top');
    bindNum('#__a-w', 'width', true); bindNum('#__a-h', 'height', true);
    bindRange('#__a-rot', 'rotate', '#__a-rv');
    bindRange('#__a-tilt', 'tiltX', '#__a-tv');
    bindRange('#__a-persp', 'persp', '#__a-pv');

    let gridOn = false;
    $('#__a-grid').addEventListener('click', () => { gridOn = !gridOn; toggleGrid(gridOn); });
    $('#__a-close').addEventListener('click', () => { panel.remove(); outline.remove(); handle.remove(); toggleGrid(false); window.__alignTool = false; });
    $('#__a-reset').addEventListener('click', () => {
      delete state[orientation()][current.key];
      const e = el(current); if (e) e.removeAttribute('style');
      save(); syncInputs();
    });
    $('#__a-resetall').addEventListener('click', () => {
      TARGETS.forEach((t) => { const e = el(t); if (e) e.removeAttribute('style'); });
      state[orientation()] = {}; save(); syncInputs();
    });
    const copy = (txt) => navigator.clipboard.writeText(txt).then(
      () => { $('#__a-out').value = txt; }, () => { $('#__a-out').value = txt; });
    $('#__a-copy').addEventListener('click', () => copy(cssFor(current)));
    $('#__a-copyall').addEventListener('click', () => copy(cssAll()));

    // drag the panel itself
    let pd = null;
    panel.querySelector('header').addEventListener('mousedown', (e) => {
      pd = { x: e.clientX - panel.offsetLeft, y: e.clientY - panel.offsetTop }; e.preventDefault();
    });

    // drag / resize the selected element
    let drag = null;
    handle.addEventListener('mousedown', (e) => {
      const s = ensure(current); if (!valid(s)) return;
      drag = { mode: 'size', x: e.clientX, y: e.clientY, s: { ...s } };
      e.preventDefault(); e.stopPropagation();
    });
    document.addEventListener('mousedown', (e) => {
      if (panel.contains(e.target) || e.target === handle) return;
      const hit = TARGETS.find((t) => { const n = el(t); return n && n.contains(e.target); });
      if (!hit) return;
      current = hit;
      $('#__a-target').value = TARGETS.indexOf(hit);
      syncInputs();
      const s = ensure(current); if (!valid(s)) return;
      drag = { mode: 'move', x: e.clientX, y: e.clientY, s: { ...s } };
      e.preventDefault(); e.stopPropagation();
    }, true);

    document.addEventListener('mousemove', (e) => {
      if (pd) { panel.style.left = e.clientX - pd.x + 'px'; panel.style.top = e.clientY - pd.y + 'px'; return; }
      if (!drag) return;
      const node = el(current);
      const p = node.offsetParent || document.getElementById('game-board');
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      const s = ensure(current);
      if (drag.mode === 'move') {
        s.left = round(drag.s.left + (dx / p.clientWidth) * 100);
        s.top = round(drag.s.top + (dy / p.clientHeight) * 100);
      } else {
        s.width = Math.max(8, Math.round(drag.s.width + dx));
        s.height = Math.max(8, Math.round(drag.s.height + dy));
      }
      apply(current); syncInputs();
    });
    document.addEventListener('mouseup', () => { if (drag) save(); drag = null; pd = null; });

    // arrow-key nudge
    document.addEventListener('keydown', (e) => {
      if (panel.contains(document.activeElement)) return;
      const map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (!map[e.key]) return;
      const node = el(current); if (!laidOut(node)) return;
      const p = node.offsetParent;
      const step = e.shiftKey ? 10 : 1;
      const s = ensure(current); if (!valid(s)) return;
      s.left = round(s.left + (map[e.key][0] * step / p.clientWidth) * 100);
      s.top = round(s.top + (map[e.key][1] * step / p.clientHeight) * 100);
      apply(current); syncInputs(); save(); e.preventDefault();
    });

    window.addEventListener('resize', () => { applyAll(); drawSel(); });

    // The board re-renders constantly and starts hidden (lobby). Keep the outline
    // glued on, and pick up the geometry the moment the zones become laid out.
    let wasReady = false;
    setInterval(() => {
      const boardUp = TARGETS.some((t) => laidOut(el(t)));
      panel.style.display = boardUp ? '' : 'none';
      if (!boardUp) { outline.style.display = handle.style.display = 'none'; return; }
      const ready = valid(ensure(current));
      if (ready && !wasReady) syncInputs();   // first time this zone exists
      wasReady = ready;
      drawSel();
    }, 400);

    applyAll();
    syncInputs();
    console.log('[align] ready — drag elements, then Copy CSS.');
  }

  window.__alignTool = true;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
