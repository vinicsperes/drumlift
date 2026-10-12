// Performance "assada": quando a música abre, cada golpe de cada mão ganha o
// recorte de um baterista de verdade mais parecido com ele (mesma mão, mesmas
// peças, intervalo e força parecidos), escolhido uma vez e guardado. O player
// só lê o plano pelo tempo, então seek, loop e velocidade continuam perfeitos,
// e a busca pesada fica fora do quadro (num Worker).
//
// O plano é feito só de arrays (passa do Worker pra página sem cópia).

import { curveOf, matchMoves } from "./moves.js";

const HANDS = ["MD", "ME"];
const REPEAT_PENALTY = 0.25; // evita o mesmo recorte duas vezes seguidas

// Hash determinístico em [0, 1): a mesma música sai sempre igual.
const hash = (a, b) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Altura de preparação que cada força pede (a mesma curva do modelo procedural). */
const want = (vel) => 0.04 + 0.5 * vel ** 3;

/**
 * Monta o plano. Pra cada mão: t0/t1 de cada golpe coberto por um recorte e a
 * curva de resíduo dele (N x C amostras), já escalada pela força.
 * @param prep resultado de prepareSong
 * @param lib biblioteca (moves.js)
 */
export function buildPlan(prep, lib) {
  const t0 = performance.now();
  const N = lib.N, C = lib.C, D = N * C;
  const plan = { N, C, warp: lib.warp, hands: {}, stats: {} };
  const tmp = new Float32Array(D);
  for (const h of HANDS) {
    const hits = prep.limbs[h] || [];
    const t0s = [], t1s = [], as = [], bs = [], curves = [];
    let last = -1, used = 0;
    for (let k = 0; k + 1 < hits.length; k++) {
      const A = hits[k], B = hits[k + 1], g = B.t - A.t;
      if (g < lib.gap[0] || g > lib.gap[1] || !lib.insts.includes(A.inst) || !lib.insts.includes(B.inst)) continue;
      const q = {
        a: A.inst, b: B.inst, g, va: A.ghost ? 0.2 : A.vel, vb: B.ghost ? 0.2 : B.vel,
        gp: k ? A.t - hits[k - 1].t : lib.gap[1], gn: k + 2 < hits.length ? hits[k + 2].t - B.t : lib.gap[1],
        beat: prep.clock.beatLen(A.t),
      };
      const best = matchMoves(lib, h, q);
      if (!best.length) continue;
      // sorteio entre os melhores, com peso pra quem está mais perto
      for (const c of best) if (c[1] === last) c[0] += REPEAT_PENALTY;
      best.sort((x, y) => x[0] - y[0]);
      const ws = best.map(([d]) => Math.exp(-(d - best[0][0]) / 0.12));
      let r = hash(k, h === "MD" ? 1 : 2) * ws.reduce((s, x) => s + x, 0), pick = best[0][1];
      for (let j = 0; j < best.length; j++) { r -= ws[j]; if (r <= 0) { pick = best[j][1]; break; } }
      last = pick;
      curveOf(lib, h, pick, tmp);
      // força: a preparação acompanha a nota de chegada (a do recorte pode ser outra)
      const H = lib.hands[h];
      const k2 = Math.min(1.5, Math.max(0.65, want(q.vb) / want(H.vb[pick] / 255)));
      const curve = new Float32Array(D);
      for (let j = 0; j < D; j++) curve[j] = tmp[j] * (j % C === C - 1 ? Math.sqrt(k2) : k2);
      t0s.push(A.t); t1s.push(B.t); as.push(A.inst); bs.push(B.inst); curves.push(curve);
      used++;
    }
    const n = t0s.length, flat = new Float32Array(n * D);
    curves.forEach((c, i) => flat.set(c, i * D));
    plan.hands[h] = { t0: Float64Array.from(t0s), t1: Float64Array.from(t1s), a: as, b: bs, curves: flat };
    plan.stats[h] = { hits: hits.length, covered: used };
  }
  plan.stats.ms = performance.now() - t0;
  return plan;
}

/** Arrays do plano (pra transferir do Worker sem copiar). */
export function planBuffers(plan) {
  return HANDS.flatMap((h) => {
    const p = plan.hands[h];
    return p ? [p.t0.buffer, p.t1.buffer, p.curves.buffer] : [];
  });
}

/** Índice do recorte que cobre t na mão h, ou -1. */
export function segmentAt(plan, h, t) {
  const p = plan.hands[h];
  if (!p || !p.t0.length) return -1;
  let lo = 0, hi = p.t0.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (p.t0[m] <= t) lo = m + 1; else hi = m;
  }
  const i = lo - 1;
  return i >= 0 && t <= p.t1[i] ? i : -1;
}
