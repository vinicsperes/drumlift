// Full tab: the grid of all bars in a drawer over the stage, with the current column
// following the song. In edit mode, clicking a cell adds or removes the note (Alt+click
// on the snare = ghost note), Ctrl+Z undoes and Save rewrites tab.txt, drums.mid and the
// audio on the server.

import { $, fmt, toast } from "./util.js";

const GLYPH = { crash: "✕", ride: "×", hihat: "×", snare: "●", tom: "●", kick: "●" };
const GHOST = "•";

export function createSheet(root, { grid, state, getTime, onSeek, onChange, onSaved }) {
  const body = $(".sheet-body", root);
  const editBtn = $("[data-act=edit]", root), undoBtn = $("[data-act=undo]", root), saveBtn = $("[data-act=save]", root);
  let pieces = [];
  let barEls = [];
  let cur = { bar: -1, col: -1 };
  let editing = false, dirty = false, lastLine = null;
  const undo = [];

  const key = (piece, step) => `${piece}:${step}`;
  const isOpen = () => !root.hidden;

  function visiblePieces() {
    const used = new Set(state.notes.map((n) => n.piece));
    return state.song.pieces.filter((p) => p.used || editing || used.has(p.key));
  }
  function cellClass(n, piece, col) {
    let c = "c";
    if (Math.floor(col / grid.subdiv) % 2 === 1) c += " shade";
    if (n) {
      c += ` n p-${piece}`;
      if (n.conf < 0.4) c += " low";
      if (n.ghost) c += " ghost";
    }
    return c;
  }
  const glyph = (n, piece) => (n ? (n.ghost ? GHOST : GLYPH[piece]) : "·");

  function render() {
    if (!isOpen()) return;
    pieces = visiblePieces();
    const map = new Map(state.notes.map((n) => [key(n.piece, n.step), n]));
    const cw = 16, barW = grid.spb * cw + 1;
    const perLine = Math.max(1, Math.floor((body.clientWidth - 24 - 40) / barW));
    const count = state.song.count || "";
    const frag = document.createDocumentFragment();
    barEls = [];
    for (let start = 0; start < grid.nBars; start += perLine) {
      const line = document.createElement("div");
      line.className = "line";
      let labels = `<div class="labels"><div class="lab"></div>`;
      for (const p of pieces) labels += `<div class="lab"><i class="p-${p.key}"></i>${p.label}</div>`;
      line.innerHTML = labels + "</div>";
      for (let bar = start; bar < Math.min(grid.nBars, start + perLine); bar++) {
        const el = document.createElement("div");
        el.className = "bar";
        el.dataset.bar = bar;
        let html = `<div class="bar-head" data-bar="${bar}"><b>${bar + 1}</b><span>${fmt(grid.barTime(bar))}</span></div>`;
        html += `<div class="grid" style="grid-template-columns:repeat(${grid.spb},${cw}px)">`;
        for (let col = 0; col < grid.spb; col++) {
          html += `<div class="c cnt${Math.floor(col / grid.subdiv) % 2 ? " shade" : ""}">${count[col] || ""}</div>`;
        }
        for (const p of pieces) {
          for (let col = 0; col < grid.spb; col++) {
            const step = bar * grid.spb + col, n = map.get(key(p.key, step));
            html += `<div class="${cellClass(n, p.key, col)}" data-p="${p.key}" data-s="${step}">${glyph(n, p.key)}</div>`;
          }
        }
        el.innerHTML = html + "</div>";
        line.append(el);
        barEls[bar] = { el, line };
      }
      frag.append(line);
    }
    body.replaceChildren(frag);
    cur = { bar: -1, col: -1 };
    lastLine = null;
  }

  function columnCells(bar, col) {
    const b = barEls[bar];
    return b ? b.el.querySelectorAll(`.grid > .c:nth-child(${grid.spb}n + ${col + 1})`) : [];
  }
  /** The song's column now; scrolls the drawer to the current line while playing. */
  function update(t, playing) {
    if (!isOpen() || !barEls.length) return;
    const step = Math.floor(grid.timeToStep(t) + 0.15);
    const bar = Math.floor(step / grid.spb), col = step - bar * grid.spb;
    if (bar === cur.bar && col === cur.col) return;
    if (cur.bar >= 0) columnCells(cur.bar, cur.col).forEach((c) => c.classList.remove("play"));
    if (bar !== cur.bar) {
      barEls[cur.bar]?.el.classList.remove("current");
      barEls[bar]?.el.classList.add("current");
      const line = barEls[bar]?.line;
      if (line && line !== lastLine && playing) {
        const r = line.getBoundingClientRect(), br = body.getBoundingClientRect();
        if (r.top < br.top + 8 || r.bottom > br.bottom - 8) body.scrollBy({ top: r.top - br.top - 40, behavior: "smooth" });
      }
      lastLine = line;
    }
    if (bar >= 0 && bar < grid.nBars) columnCells(bar, col).forEach((c) => c.classList.add("play"));
    cur = { bar, col };
  }

  // ---------- editing ----------
  function refreshCell(piece, step) {
    const el = body.querySelector(`.c[data-p="${piece}"][data-s="${step}"]`);
    if (!el) return;
    const n = state.notes.find((x) => x.piece === piece && x.step === step);
    el.className = cellClass(n, piece, step % grid.spb);
    el.textContent = glyph(n, piece);
    if (step % grid.spb === cur.col && Math.floor(step / grid.spb) === cur.bar) el.classList.add("play");
  }
  function markDirty(d) {
    dirty = d;
    saveBtn.disabled = !d;
    undoBtn.disabled = !undo.length;
    saveBtn.textContent = d ? "Save •" : "Save";
  }
  function toggleNote(piece, step, ghost) {
    const notes = state.notes;
    const i = notes.findIndex((n) => n.piece === piece && n.step === step);
    let before = null;
    if (i >= 0) {
      before = notes[i];
      if (ghost && piece === "snare") notes[i] = { ...before, ghost: !before.ghost };
      else notes.splice(i, 1);
    } else {
      notes.push({ piece, step, vel: ghost ? 0.2 : 0.8, conf: 1, ghost: ghost && piece === "snare" });
      notes.sort((a, b) => a.step - b.step || (a.piece < b.piece ? -1 : 1));
    }
    undo.push({ piece, step, before });
    markDirty(true);
    refreshCell(piece, step);
    onChange();
  }
  function undoLast() {
    const u = undo.pop();
    if (!u) return;
    const notes = state.notes;
    const i = notes.findIndex((n) => n.piece === u.piece && n.step === u.step);
    if (i >= 0) notes.splice(i, 1);
    if (u.before) { notes.push(u.before); notes.sort((a, b) => a.step - b.step); }
    markDirty(undo.length > 0);
    refreshCell(u.piece, u.step);
    onChange();
  }
  async function save() {
    if (!dirty) return;
    saveBtn.disabled = true;
    saveBtn.textContent = "Salvando…";
    try {
      const res = await fetch("api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: state.notes.map(({ piece, step, vel, conf, ghost, t_raw }) => ({ piece, step, vel, conf, ghost, t_raw })),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const song = await res.json();
      undo.length = 0;
      markDirty(false);
      onSaved(song);
      render();
      toast("Saved: tab.txt, drums.mid and audio updated");
    } catch (e) {
      toast(`Could not save: ${e.message}`, 5000);
      markDirty(true);
    }
  }
  function setEditing(on) {
    editing = on;
    editBtn.classList.toggle("on", on);
    root.classList.toggle("editing", on);
    render();
    if (on) toast("Editing: click adds or removes a note · Alt+click on the snare = ghost note", 3500);
  }

  // ---------- events ----------
  body.addEventListener("click", (e) => {
    const cell = e.target.closest(".c[data-p]");
    if (cell && editing) { toggleNote(cell.dataset.p, +cell.dataset.s, e.altKey); return; }
    const barEl = e.target.closest(".bar");
    if (barEl) onSeek(grid.barTime(+barEl.dataset.bar) - 0.03, +barEl.dataset.bar, e.shiftKey);
  });
  editBtn.onclick = () => setEditing(!editing);
  undoBtn.onclick = undoLast;
  saveBtn.onclick = save;
  $("[data-act=close]", root).onclick = () => close();
  window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  let lastWidth = 0;
  new ResizeObserver(() => {
    const w = body.clientWidth;
    if (w && w !== lastWidth) { lastWidth = w; render(); }
  }).observe(body);

  function open() { root.hidden = false; document.body.classList.add("sheet-open"); render(); }
  function close() { root.hidden = true; document.body.classList.remove("sheet-open"); }
  markDirty(false);

  return {
    open, close, render, update, save, undo: undoLast,
    toggle() { isOpen() ? close() : open(); },
    toggleEdit() { if (isOpen()) setEditing(!editing); },
    get isOpen() { return isOpen(); },
    get dirty() { return dirty; },
  };
}
