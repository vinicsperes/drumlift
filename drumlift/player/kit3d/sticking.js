// Who plays what. Right-handed rules, written for common grooves:
//   PD = kick; PE stays on the hi-hat pedal (it doesn't invent notes).
//   Same step: cymbal + snare/tom -> MD on the cymbal; snare + tom -> ME on the snare.
//   Alone: cymbal -> MD (ME if MD has no time, except on the ride); snare -> ME,
//   alternating R-L-R-L in fast runs; toms alternate within a fill.

const CYMBALS = new Set(["crash", "ride", "hihat"]);
const DRUMS = new Set(["snare", "tom"]);
const PRIORITY = { crash: 0, ride: 1, hihat: 2, snare: 3, tom: 4 };

export const FAST_CYMBAL = 0.09; // s: MD doesn't repeat a cymbal faster than this
export const FAST_DRUM = 0.18;   // s: below this the snare alternates hands

const other = (limb) => (limb === "MD" ? "ME" : "MD");
// At slow tempos a sixteenth exceeds FAST_DRUM, but a sixteenth-note fill is R-L-R-L
// at any tempo.
const fastDrum = (clock, t) => Math.max(FAST_DRUM, (clock.beatLen(t) / 4) * 1.1);

// With 3 or more hand notes: the most important cymbal and the most important drum
// (if any); otherwise, the first two in the order cymbal > snare > tom.
function pickTwo(hand) {
  const cym = hand.filter((n) => CYMBALS.has(n.piece));
  const drum = hand.filter((n) => DRUMS.has(n.piece));
  return cym.length && drum.length ? [cym[0], drum[0]] : hand.slice(0, 2);
}

function assignPair(a, b) {
  // a comes first in order of importance
  const ca = CYMBALS.has(a.piece), cb = CYMBALS.has(b.piece);
  if (ca && b.inst === "floor" && a.piece !== "ride") {
    // Left cymbal + floor tom: crossing both arms won't work; each hand on its side.
    a.limb = "ME"; b.limb = "MD";
  } else if (ca && cb) {
    // Two cymbals: MD takes the ride (on the right); otherwise the higher priority one.
    const right = b.piece === "ride" ? b : a;
    right.limb = "MD";
    (right === a ? b : a).limb = "ME";
  } else if (ca) {
    a.limb = "MD"; b.limb = "ME";      // cymbal + snare/tom: right-handed cross
  } else {
    a.limb = "ME"; b.limb = "MD";      // snare + tom: ME on the snare, MD on the tom
  }
}

function assignSingle(g, prev, next, last, clock) {
  const n = g.single;
  if (CYMBALS.has(n.piece)) {
    // The ride is too far from ME: MD plays the double stroke even with no room.
    n.limb = n.t - last.MD < FAST_CYMBAL && n.piece !== "ride" ? "ME" : "MD";
    return;
  }
  const fast = fastDrum(clock, n.t);
  const prevDrum = prev?.single && DRUMS.has(prev.single.piece) ? prev.single : null;
  if (prevDrum) {
    const gap = n.t - prevDrum.t;
    // Keep alternating: a fast run, or a tom within a fill (up to 1 beat).
    if (gap < fast || (n.piece === "tom" && gap <= clock.beatLen(prevDrum.t) * 1.05)) {
      n.limb = other(prevDrum.limb);
      return;
    }
  }
  if (n.piece === "tom") {
    // Start of a fill: the hand that has been free longest (tie -> MD).
    n.limb = last.ME < last.MD ? "ME" : "MD";
    return;
  }
  // Snare opening a fast run: start with the right (R-L-R-L).
  const nextDrum = next?.single && DRUMS.has(next.single.piece) ? next.single : null;
  if (nextDrum && nextDrum.t - n.t < fast && n.t - last.MD >= FAST_CYMBAL) {
    n.limb = "MD";
    return;
  }
  // Snare alone: ME, unless ME just played and MD is free. With both busy, ME plays
  // the double stroke and MD stays on the cymbal.
  n.limb = n.t - last.ME < fast && n.t - last.MD >= fast ? "MD" : "ME";
}

/** Set `limb` on each note of the groups (null = no limb plays). */
export function assignSticking(groups, clock) {
  const handGroups = [];
  for (const g of groups) {
    const seen = new Map();
    for (const n of g.notes) {
      if (n.piece === "kick") {
        if (!seen.has("kick")) { n.limb = "PD"; seen.set("kick", n); }
        continue;
      }
      const dup = seen.get(n.piece);
      if (!dup || n.vel > dup.vel) seen.set(n.piece, n);
    }
    let hand = [...seen.values()].filter((n) => n.piece !== "kick")
      .sort((a, b) => PRIORITY[a.piece] - PRIORITY[b.piece]);
    if (hand.length > 2) hand = pickTwo(hand);
    if (!hand.length) continue;
    handGroups.push({
      t: Math.min(...hand.map((n) => n.t)),
      notes: hand,
      single: hand.length === 1 ? hand[0] : null,
    });
  }

  const last = { MD: -Infinity, ME: -Infinity };
  for (let i = 0; i < handGroups.length; i++) {
    const g = handGroups[i];
    if (g.single) assignSingle(g, handGroups[i - 1], handGroups[i + 1], last, clock);
    else assignPair(g.notes[0], g.notes[1]);
    for (const n of g.notes) last[n.limb] = Math.max(last[n.limb], n.t);
  }
}
