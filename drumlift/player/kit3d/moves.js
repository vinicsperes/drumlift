// Library of a real drummer's strokes (MMIP database, CC BY-NC-SA 4.0, built by
// tools/mmip_moves.py). Each segment is one hand's motion between two consecutive notes,
// described against the straight path between the two strike poses: how far the wrist
// leaves that path (in the hand's heading frame), how much the hand turns (in its own
// space) and how far the elbow opens. The residual is zero at each end, so it fits any
// pair of strike poses, ours included. Segments are compressed with PCA, per hand.
//
// No DOM: runs in the Worker that builds the performance.

const decode = (b64, Type) => {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Type(bytes.buffer);
};

let cache = null;

/** Load and decode the library (once per page or Worker). */
export function loadMoves(url) {
  if (!cache) {
    cache = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.json();
    }).then(parseMoves);
  }
  return cache;
}

/** Library from the already read JSON. */
export function parseMoves(json) {
  const N = json.samples, C = json.channels.length;
  const hands = {};
  for (const [h, d] of Object.entries(json.hands)) {
    const K = d.coefScale.length;
    const raw = decode(d.coef, Int16Array);
    const coef = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) coef[i] = raw[i] * d.coefScale[i % K];
    const f = Object.fromEntries(Object.entries(d.feat).map(([k, v]) => [k, decode(v, k === "a" || k === "b" || k === "va" || k === "vb" ? Uint8Array : Uint16Array)]));
    const n = d.n;
    // per piece pair (a -> b): segment indices, for quick search
    const byPair = new Map();
    for (let i = 0; i < n; i++) {
      const key = f.a[i] * 16 + f.b[i];
      if (!byPair.has(key)) byPair.set(key, []);
      byPair.get(key).push(i);
    }
    hands[h] = {
      n, K, coef, basis: decode(d.basis, Float32Array), mean: decode(d.mean, Float32Array), scale: d.scale,
      a: f.a, b: f.b, g: f.g, va: f.va, vb: f.vb, gp: f.gp, gn: f.gn, beat: f.beat, byPair, swivel: d.swivel,
    };
  }
  let body = null;
  if (json.body) {
    const b = json.body, C2 = b.outputs;
    const raw = decode(b.clips, Int8Array), clips = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) clips[i] = raw[i] * b.clipScale[i % C2];
    body = {
      joints: b.joints, lags: b.lags, highpass: b.highpass, W: decode(b.W, Float32Array), inputs: b.inputs, outputs: C2,
      spb: b.spb, clipBeats: b.clipBeats, n: b.n, clips, clipLen: (b.clipBeats + 1) * b.spb,
      beat: decode(b.clipFeat.beat, Uint16Array), dens: decode(b.clipFeat.dens, Uint8Array), kick: decode(b.clipFeat.kick, Uint8Array),
    };
  }
  return { N, C, warp: json.warp, insts: json.insts, gap: json.gap, hands, body, credit: json.credit };
}

/** Residual curve (N x C, Float32Array) of segment i of hand h. */
export function curveOf(lib, h, i, out = new Float32Array(lib.N * lib.C)) {
  const H = lib.hands[h], K = H.K, D = lib.N * lib.C;
  for (let j = 0; j < D; j++) {
    let v = H.mean[j];
    for (let k = 0; k < K; k++) v += H.coef[i * K + k] * H.basis[k * D + j];
    out[j] = v * H.scale[j % lib.C];
  }
  // the ends are the strike poses: zero residual, even after compression
  const C = lib.C;
  for (let c = 0; c < C; c++) {
    const v0 = out[c], v1 = out[(lib.N - 1) * C + c];
    for (let k = 0; k < lib.N; k++) {
      const s = k / (lib.N - 1);
      out[k * C + c] -= v0 * (1 - s) + v1 * s;
    }
  }
  return out;
}

const DRUMS = new Set(["snare", "tom1", "tom2", "floor"]);
const group = (inst) => (DRUMS.has(inst) ? 0 : 1);

/**
 * Best segments for one of our strokes: same hand, same piece pair (or same type),
 * similar interval, similar strength. Returns indices in order.
 * q = { a, b (piece names), g, va, vb, gp, gn, beat (s) }
 */
export function matchMoves(lib, h, q, k = 6) {
  const H = lib.hands[h];
  const ia = lib.insts.indexOf(q.a), ib = lib.insts.indexOf(q.b);
  const same = q.a === q.b;
  let cands = H.byPair.get(ia * 16 + ib) || [];
  if (cands.length < 8) {
    // no exact pair: another pair of the same type (same piece x change; drum x cymbal)
    cands = cands.slice();
    for (const [key, list] of H.byPair) {
      const a = lib.insts[key >> 4], b = lib.insts[key & 15];
      if ((a === b) !== same || group(a) !== group(q.a) || group(b) !== group(q.b)) continue;
      if (key !== ia * 16 + ib) cands.push(...list);
    }
  }
  if (!cands.length) return [];
  const lg = Math.log(q.g), lgp = Math.log(Math.max(0.07, q.gp)), lgn = Math.log(Math.max(0.07, q.gn)), lbeat = Math.log(q.beat);
  const best = [];
  for (const i of cands) {
    let d = 4 * Math.abs(Math.log(H.g[i] / 1000) - lg);
    d += 1.6 * Math.abs(H.vb[i] / 255 - q.vb) + 0.7 * Math.abs(H.va[i] / 255 - q.va);
    d += 0.5 * Math.min(1, Math.abs(Math.log(Math.max(70, H.gp[i]) / 1000) - lgp));
    d += 0.5 * Math.min(1, Math.abs(Math.log(Math.max(70, H.gn[i]) / 1000) - lgn));
    d += 0.4 * Math.abs(Math.log(H.beat[i] / 1000) - lbeat);
    if (H.a[i] !== ia) d += 0.8;
    if (H.b[i] !== ib) d += 0.8;
    if (best.length < k || d < best[best.length - 1][0]) {
      best.push([d, i]);
      best.sort((x, y) => x[0] - y[0]);
      if (best.length > k) best.pop();
    }
  }
  return best;
}

/** Normalized time u (0..1) -> position s (0..1) in the samples (inverse of the warp). */
export function unwarp(u, w) {
  let s = u;
  for (let k = 0; k < 5; k++) {
    const f = s - (w * Math.sin(2 * Math.PI * s)) / (2 * Math.PI) - u;
    s -= f / (1 - w * Math.cos(2 * Math.PI * s));
  }
  return Math.min(1, Math.max(0, s));
}
