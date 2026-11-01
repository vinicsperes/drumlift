// The song's timeline: clean sorted notes, beat clock, toms spread over the kit and
// strokes per limb. All computed once when song.json arrives; the animation only does
// binary searches here.

import { assignSticking } from "./sticking.js";

export const PIECES = ["crash", "ride", "hihat", "snare", "tom", "kick"];
const PIECE_SET = new Set(PIECES);

// Physical pieces. The tab has only one tom class, but the kit has three.
export const INSTANCES = ["kick", "snare", "hihat", "tom1", "tom2", "floor", "crash", "ride"];
export const INSTANCE_PIECE = {
  kick: "kick", snare: "snare", hihat: "hihat",
  tom1: "tom", tom2: "tom", floor: "tom", crash: "crash", ride: "ride",
};
export const LIMBS = ["MD", "ME", "PD", "PE"];

// Order of importance when there are more notes than hands.
export const PRIORITY = { crash: 0, ride: 1, hihat: 2, snare: 3, tom: 4, kick: 5 };

const TOMS_HIGH_TO_LOW = ["tom1", "tom2", "floor"];
const TOM_INST = new Set(TOMS_HIGH_TO_LOW);

/** First index with key(arr[i]) > x. */
export function upperBound(arr, x, key = (v) => v.t) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (key(arr[m]) <= x) lo = m + 1; else hi = m;
  }
  return lo;
}

/** Index of the last element with time <= x, or -1. */
export const lastAtOrBefore = (arr, x, key) => upperBound(arr, x, key) - 1;

/** Beat clock: fractional position and local length of 1 beat. */
export function makeBeatClock(song) {
  const beats = (Array.isArray(song?.beats) ? song.beats : [])
    .filter(Number.isFinite).slice().sort((a, b) => a - b);
  const fallback = 60 / (Number.isFinite(song?.tempo) && song.tempo > 0 ? song.tempo : 120);
  if (beats.length < 2) {
    const b0 = beats[0] ?? 0;
    return { beatAt: (t) => (t - b0) / fallback, beatLen: () => fallback };
  }
  const n = beats.length;
  const seg = (t) => {
    if (t <= beats[0]) return 0;
    if (t >= beats[n - 1]) return n - 2;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (beats[m] <= t) lo = m; else hi = m; }
    return lo;
  };
  return {
    beatAt(t) {
      const i = seg(t), len = beats[i + 1] - beats[i] || fallback;
      return i + (t - beats[i]) / len;
    },
    beatLen(t) {
      const i = seg(t);
      return beats[i + 1] - beats[i] || fallback;
    },
  };
}

function cleanNotes(song) {
  const raw = Array.isArray(song?.notes) ? song.notes : [];
  const out = [];
  for (const n of raw) {
    if (!n || !PIECE_SET.has(n.piece) || !Number.isFinite(n.t)) continue;
    out.push({
      piece: n.piece,
      t: n.t,
      step: Number.isFinite(n.step) ? n.step : null,
      vel: Math.min(1, Math.max(0, Number.isFinite(n.vel) ? n.vel : 0.8)),
      ghost: !!n.ghost,
      // tom: the tab only says "tom"; if the note says which (MIDI), respect it
      inst: n.piece === "tom" ? (TOM_INST.has(n.inst) ? n.inst : null) : n.piece,
      limb: null,
    });
  }
  out.sort((a, b) => a.t - b.t || PRIORITY[a.piece] - PRIORITY[b.piece]);
  return out;
}

// Run of toms with up to 1 beat between notes: from highest to lowest.
// A lone tom goes to tom 2.
function assignToms(notes, clock) {
  const toms = notes.filter((n) => n.piece === "tom" && !n.inst);
  let start = 0;
  for (let i = 1; i <= toms.length; i++) {
    const brk = i === toms.length || toms[i].t - toms[i - 1].t > clock.beatLen(toms[i - 1].t) * 1.05;
    if (!brk) continue;
    const run = toms.slice(start, i), k = run.length;
    run.forEach((n, j) => { n.inst = k === 1 ? "tom2" : TOMS_HIGH_TO_LOW[Math.floor((j * 3) / k)]; });
    start = i;
  }
}

// Notes on the same step play together. Without `step`, groups those at the same instant.
function groupNotes(notes) {
  const byKey = new Map();
  for (const n of notes) {
    const key = n.step !== null ? `s${n.step}` : `t${Math.round(n.t * 200)}`;
    let g = byKey.get(key);
    if (!g) { g = { t: n.t, notes: [] }; byKey.set(key, g); }
    g.notes.push(n);
    if (n.t < g.t) g.t = n.t;
  }
  return [...byKey.values()].sort((a, b) => a.t - b.t);
}

/**
 * Preprocess song.json: returns the notes with physical piece (`inst`) and limb
 * (`limb`, or null if no limb plays), plus strokes per limb and per piece.
 */
export function prepareSong(song) {
  const clock = makeBeatClock(song);
  const notes = cleanNotes(song);
  assignToms(notes, clock);
  const groups = groupNotes(notes);
  assignSticking(groups, clock);

  const limbs = { MD: [], ME: [], PD: [], PE: [] };
  for (const n of notes) {
    if (!n.limb) continue;
    const list = limbs[n.limb], prev = list[list.length - 1];
    if (prev && Math.abs(prev.t - n.t) < 1e-6) continue; // same limb, same instant
    list.push({ t: n.t, inst: n.inst, vel: n.vel, ghost: n.ghost, piece: n.piece });
  }
  for (const k of LIMBS) limbs[k].sort((a, b) => a.t - b.t);

  const instHits = Object.fromEntries(INSTANCES.map((k) => [k, []]));
  for (const n of notes) instHits[n.inst].push({ t: n.t, vel: n.ghost ? 0.15 : n.vel, limb: n.limb });

  // hi-hat pedal notes (if the song has them, like the MMIP ones)
  const pedal = (Array.isArray(song?.pedal) ? song.pedal : []).filter(Number.isFinite).sort((a, b) => a - b);
  return { notes, groups, limbs, instHits, clock, pedal, duration: Number(song?.duration) || 0 };
}
