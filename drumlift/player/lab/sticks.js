// The real drummer's sticks. The suit captured the hands, not the sticks, so they come
// from the MIDI: at each note the stick tip is on the piece and the stick is rigid in
// the hand. So we look for the fixed vector (in hand space) that makes the tips of all
// strokes on a piece land on one point, and, along with it, which hand played each note.

const CYMBALS = new Set(["hihat", "ride", "crash"]);
// typical x (m) of each piece on a right-handed kit: decides who takes what in a pair
const SIDE = { hihat: -0.47, crash: -0.46, snare: -0.15, tom1: -0.03, tom2: 0.27, floor: 0.52, ride: 0.74 };
export const HAND_ID = ["RightHand", "LeftHand"]; // 0 = right, 1 = left
const LEN = [0.26, 0.44]; // plausible length from hand to tip (m)

const instOf = (n) => n.inst || n.piece;

// rotation of v by quaternion q = [x, y, z, w] (or by its conjugate)
function rotate(q, o, v, out, inverse = false) {
  const x = q[o], y = q[o + 1], z = q[o + 2], w = q[o + 3];
  const s = inverse ? -1 : 1;
  const qx = x * s, qy = y * s, qz = z * s;
  const tx = 2 * (qy * v[2] - qz * v[1]), ty = 2 * (qz * v[0] - qx * v[2]), tz = 2 * (qx * v[1] - qy * v[0]);
  out[0] = v[0] + w * tx + (qy * tz - qz * ty);
  out[1] = v[1] + w * ty + (qz * tx - qx * tz);
  out[2] = v[2] + w * tz + (qx * ty - qy * tx);
  return out;
}

/**
 * @param S the real drummer's samples (real.js: { fps, n, pos, quat })
 * @param notes song.json notes ({ t, piece, inst?, vel }); the kick stays out
 * @returns { d: [right vector, left vector] in hand space, strokes, pads, spread }
 */
export function inferSticks(S, notes, { rounds = 5 } = {}) {
  const strokes = notes
    .filter((n) => n.piece !== "kick")
    .map((n) => ({ t: n.t, piece: n.piece, inst: instOf(n), vel: n.vel, hand: -1, pair: false, i: 0 }))
    .sort((a, b) => a.t - b.t);
  const frame = (t) => Math.min(S.n - 1, Math.max(0, Math.round(t * S.fps)));
  for (const s of strokes) s.i = frame(s.t);
  const handY = (h, i) => S.pos[HAND_ID[h]][Math.min(S.n - 1, Math.max(0, i)) * 3 + 1];
  const dip = (h, i) => handY(h, i - Math.round(0.1 * S.fps)) - handY(h, i) + handY(h, i + Math.round(0.06 * S.fps)) - handY(h, i);

  // 1) starting hand: in a pair, the hi-hat and the rightmost piece go to the right;
  //    alone, the hand that dropped and rose around the note
  for (let k = 0; k < strokes.length;) {
    let e = k + 1;
    while (e < strokes.length && strokes[e].t - strokes[k].t < 0.025) e++;
    const g = strokes.slice(k, e);
    if (g.length >= 2) {
      const [a, b] = g;
      const aRight = a.inst === "hihat" || (b.inst !== "hihat" && (SIDE[a.inst] ?? 0) >= (SIDE[b.inst] ?? 0));
      a.hand = aRight ? 0 : 1;
      b.hand = aRight ? 1 : 0;
      for (const s of g) s.pair = true;
      for (const s of g.slice(2)) s.hand = -1; // a third simultaneous note stays out
    } else {
      g[0].hand = dip(0, g[0].i) >= dip(1, g[0].i) ? 0 : 1;
    }
    k = e;
  }

  // 2) initial stick: from the hand to the index knuckle, 36 cm long
  const d = [0, 1].map((h) => {
    const acc = [0, 0, 0], tmp = [0, 0, 0], v = [0, 0, 0];
    const hp = S.pos[HAND_ID[h]], fp = S.pos[HAND_ID[h].replace("Hand", "Finger2Proximal")];
    let cnt = 0;
    for (const s of strokes) {
      if (s.hand !== h) continue;
      const o = s.i * 3;
      v[0] = fp[o] - hp[o]; v[1] = fp[o + 1] - hp[o + 1]; v[2] = fp[o + 2] - hp[o + 2];
      rotate(S.quat[HAND_ID[h]], s.i * 4, v, tmp, true);
      const l = Math.hypot(...tmp) || 1;
      acc[0] += tmp[0] / l; acc[1] += tmp[1] / l; acc[2] += tmp[2] / l;
      cnt++;
    }
    const l = Math.hypot(...acc) || 1;
    return acc.map((x) => (x / l) * 0.36);
  });

  const tip = (h, i, out) => {
    rotate(S.quat[HAND_ID[h]], i * 4, d[h], out);
    const o = i * 3, p = S.pos[HAND_ID[h]];
    out[0] += p[o]; out[1] += p[o + 1]; out[2] += p[o + 2];
    return out;
  };
  const t0 = [0, 0, 0], t1 = [0, 0, 0];
  let pads = {};
  for (let round = 0; round < rounds; round++) {
    // centers: of each hand's tips on each piece, and the piece's (both hands)
    const sum = {}, sumH = [{}, {}];
    for (const s of strokes) {
      if (s.hand < 0) continue;
      tip(s.hand, s.i, t0);
      for (const box of [sum, sumH[s.hand]]) {
        const c = (box[s.inst] ||= [0, 0, 0, 0]);
        c[0] += t0[0]; c[1] += t0[1]; c[2] += t0[2]; c[3]++;
      }
    }
    const mean = (c) => [c[0] / c[3], c[1] / c[3], c[2] / c[3]];
    pads = Object.fromEntries(Object.entries(sum).map(([k, c]) => [k, mean(c)]));
    const padsH = sumH.map((box) => Object.fromEntries(Object.entries(box).map(([k, c]) => [k, mean(c)])));
    // stick: mean of R⁻¹ (center - hand), which minimizes the tips' spread
    for (const h of [0, 1]) {
      const acc = [0, 0, 0], v = [0, 0, 0];
      let cnt = 0;
      for (const s of strokes) {
        if (s.hand !== h) continue;
        const c = padsH[h][s.inst], o = s.i * 3, p = S.pos[HAND_ID[h]];
        v[0] = c[0] - p[o]; v[1] = c[1] - p[o + 1]; v[2] = c[2] - p[o + 2];
        rotate(S.quat[HAND_ID[h]], s.i * 4, v, t0, true);
        acc[0] += t0[0]; acc[1] += t0[1]; acc[2] += t0[2];
        cnt++;
      }
      if (!cnt) continue;
      const v2 = acc.map((x) => x / cnt), l = Math.hypot(...v2);
      const k = Math.min(LEN[1], Math.max(LEN[0], l)) / (l || 1);
      d[h] = v2.map((x) => x * k);
    }
    // reassign lone notes: the hand whose tip is closest to the piece
    for (const s of strokes) {
      if (s.pair || !pads[s.inst]) continue;
      const c = pads[s.inst];
      const e0 = Math.hypot(...tip(0, s.i, t0).map((x, a) => x - c[a]));
      const e1 = Math.hypot(...tip(1, s.i, t1).map((x, a) => x - c[a]));
      s.hand = e0 <= e1 ? 0 : 1;
    }
  }

  // final spread of the tips around each piece (cm): measures the inference
  const spread = {};
  for (const [k, c] of Object.entries(pads)) {
    let s2 = 0, cnt = 0;
    for (const s of strokes) {
      if (s.hand < 0 || s.inst !== k) continue;
      tip(s.hand, s.i, t0);
      s2 += (t0[0] - c[0]) ** 2 + (t0[1] - c[1]) ** 2 + (t0[2] - c[2]) ** 2;
      cnt++;
    }
    spread[k] = { cm: +(100 * Math.sqrt(s2 / Math.max(1, cnt))).toFixed(1), n: cnt };
  }
  return { d, strokes, pads, spread, tip };
}
