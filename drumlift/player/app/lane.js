// Note lane: upcoming notes come from the right to the "now" line, one row per piece,
// with the hand playing each (R/L, the same logic as the 3D drummer) and the bars marked.
// Dragging marks a loop; clicking jumps there; clicking a piece's name mutes it
// (Shift+click: solo).
// Drawn on a 2D canvas each frame, from the song's time.

import { clamp, lowerBound } from "./util.js";

const ORDER = ["crash", "ride", "hihat", "snare", "tom", "kick"];
const LABEL = { crash: "CR", ride: "RD", hihat: "HH", snare: "SD", tom: "T", kick: "BD" };
const CYMBAL = new Set(["crash", "ride", "hihat"]);
const ROW_H = 20, HEAD = 18, FOOT = 6, LABEL_W = 46, NOW = 0.22;
const POP = 0.2; // s of a note's "pop" as it crosses the now line

export function createLane(canvas, { grid, getTime, getLoop, getMuted = () => new Set(), onSeek, onLoopSelect, onLabel }) {
  const g = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1;
  let notes = [], rows = [], colors = null;
  let drag = null;

  /** Height the lane needs for these pieces. */
  const heightFor = (n) => HEAD + Math.max(1, n) * ROW_H + FOOT;

  function setNotes(list) {
    notes = list
      .map((n) => ({ ...n, beat: n.step / grid.subdiv }))
      .sort((a, b) => a.step - b.step);
    const used = new Set(notes.map((n) => n.piece));
    rows = ORDER.filter((p) => used.has(p));
    canvas.style.height = `${heightFor(rows.length)}px`;
  }

  function setColors(c) { colors = c; }

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }

  // scale: beats per pixel, by width (phones see fewer bars)
  const ppb = () => clamp(W / 14, 58, 118);
  const x0 = () => Math.max(LABEL_W + 30, W * NOW);
  const beatAtX = (x, now) => now + (x - x0()) / ppb();
  const rowY = (piece) => HEAD + rows.indexOf(piece) * ROW_H + ROW_H / 2;

  function drawNote(n, x, y, alpha, pop) {
    const c = colors.piece[n.piece];
    const r = (n.ghost ? 3.2 : 6) * (1 + 0.55 * pop);
    g.globalAlpha = alpha * (n.conf !== undefined && n.conf < 0.4 ? 0.55 : 1);
    if (pop > 0) {
      g.fillStyle = c;
      g.globalAlpha = 0.18 * pop;
      g.beginPath();
      g.arc(x, y, r * 2.2, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = alpha;
    }
    if (CYMBAL.has(n.piece)) {
      const k = r * 0.95;
      g.strokeStyle = c;
      g.lineWidth = n.piece === "crash" ? 2.6 : 2.2;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(x - k, y - k); g.lineTo(x + k, y + k);
      g.moveTo(x + k, y - k); g.lineTo(x - k, y + k);
      g.stroke();
      if (n.piece === "crash") {
        g.lineWidth = 1.4;
        g.beginPath();
        g.arc(x, y, k * 1.45, 0, Math.PI * 2);
        g.stroke();
      }
    } else if (n.ghost) {
      g.strokeStyle = c;
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.stroke();
    } else {
      g.fillStyle = c;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    // hand: R or L, small, in the limb's color
    if (n.limb === "MD" || n.limb === "ME") {
      g.globalAlpha = alpha;
      g.fillStyle = colors.limb[n.limb];
      g.font = "700 9px ui-monospace, Menlo, monospace";
      g.textBaseline = "middle";
      g.fillText(n.limb === "MD" ? "R" : "L", x + 8.5, y - 6);
    }
  }

  function draw(t) {
    if (!colors || !W) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const now = grid.timeToBeat(t);
    const p = ppb(), ox = x0();
    const muted = getMuted();
    const b0 = beatAtX(LABEL_W, now), b1 = beatAtX(W, now);
    const xb = (beat) => ox + (beat - now) * p;

    // piece rows
    g.globalAlpha = 1;
    g.fillStyle = colors.hair;
    for (let i = 1; i < rows.length; i++) g.fillRect(LABEL_W, HEAD + i * ROW_H, W - LABEL_W, 1);

    // loop
    const loop = getLoop();
    if (loop.on) {
      const xa = xb(loop.a * grid.bpb), xe = xb((loop.b + 1) * grid.bpb);
      g.fillStyle = colors.loop;
      g.fillRect(Math.max(LABEL_W, xa), 0, Math.max(0, Math.min(W, xe) - Math.max(LABEL_W, xa)), H);
    }
    if (drag?.moved) {
      const [a, b] = dragBars();
      const xa = xb(a * grid.bpb), xe = xb((b + 1) * grid.bpb);
      g.fillStyle = colors.loop;
      g.fillRect(xa, 0, xe - xa, H);
    }

    // beats and bars
    g.font = "500 10px ui-monospace, Menlo, monospace";
    g.textBaseline = "middle";
    for (let k = Math.floor(b0); k <= Math.ceil(b1); k++) {
      const x = Math.round(xb(k)) + 0.5;
      if (x < LABEL_W) continue;
      const bar = k % grid.bpb === 0;
      g.fillStyle = bar ? colors.bar : colors.beat;
      g.fillRect(x - 0.5, bar ? 4 : HEAD, 1, H - (bar ? 4 : HEAD) - FOOT + 2);
      if (bar && k >= 0) {
        g.fillStyle = colors.muted;
        g.fillText(String(k / grid.bpb + 1), x + 4, HEAD / 2 + 1);
      }
    }

    // visible notes (by step, already in order)
    const i0 = lowerBound(notes, Math.floor(b0 * grid.subdiv) - 1, (n) => n.step);
    for (let i = i0; i < notes.length; i++) {
      const n = notes[i];
      if (n.beat > b1 + 0.2) break;
      const x = xb(n.beat);
      if (x < LABEL_W - 8) continue;
      const age = t - n.t;
      const past = n.beat < now;
      const alpha = past ? clamp(1 - (now - n.beat) * 0.55, 0.28, 1) : 1;
      const off = muted.has(n.piece);
      const pop = !off && age >= 0 && age < POP ? 1 - age / POP : 0;
      drawNote(n, x, rowY(n.piece), off ? alpha * 0.22 : alpha, pop);
    }
    g.globalAlpha = 1;

    // now line
    g.fillStyle = colors.now;
    g.fillRect(Math.round(ox) - 1, 2, 2, H - 4);
    g.beginPath();
    g.moveTo(ox - 5, 1); g.lineTo(ox + 5, 1); g.lineTo(ox, 7);
    g.fill();

    // piece labels over a gradient (notes fade behind them)
    const grad = g.createLinearGradient(0, 0, LABEL_W + 18, 0);
    grad.addColorStop(0, colors.card);
    grad.addColorStop(0.7, colors.card);
    grad.addColorStop(1, colors.cardClear);
    g.fillStyle = grad;
    g.fillRect(0, 0, LABEL_W + 18, H);
    g.font = "600 10.5px ui-monospace, Menlo, monospace";
    rows.forEach((piece, i) => {
      const y = HEAD + i * ROW_H + ROW_H / 2, off = muted.has(piece);
      g.globalAlpha = off ? 0.35 : 1;
      g.fillStyle = colors.piece[piece];
      g.beginPath();
      g.arc(12, y, 3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = colors.muted;
      g.fillText(LABEL[piece], 20, y + 0.5);
      if (off) g.fillRect(19, y, 17, 1);
    });
    g.globalAlpha = 1;
  }

  // ---------- click and drag ----------
  function dragBars() {
    const now = drag.now;
    const a = Math.floor(beatAtX(drag.x0, now) / grid.bpb), b = Math.floor(beatAtX(drag.x1, now) / grid.bpb);
    return [clamp(Math.min(a, b), 0, grid.nBars - 1), clamp(Math.max(a, b), 0, grid.nBars - 1)];
  }
  canvas.addEventListener("pointerdown", (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < LABEL_W && onLabel) {
      const piece = rows[Math.floor((y - HEAD) / ROW_H)];
      if (piece) onLabel(piece, e.shiftKey);
      return;
    }
    drag = { x0: e.clientX - r.left, x1: e.clientX - r.left, moved: false, now: grid.timeToBeat(getTime()) };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const r = canvas.getBoundingClientRect();
    drag.x1 = e.clientX - r.left;
    if (Math.abs(drag.x1 - drag.x0) > 6) drag.moved = true;
  });
  const end = (e) => {
    if (!drag) return;
    if (drag.moved) {
      const [a, b] = dragBars();
      onLoopSelect(a, b);
    } else if (e.type === "pointerup") {
      // jump to the start of the clicked beat
      const beat = Math.floor(beatAtX(drag.x0, drag.now));
      onSeek(grid.beatTime(beat) - 0.03);
    }
    drag = null;
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  return { draw, resize, setNotes, setColors, heightFor, get rows() { return rows; } };
}
