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
 * curva de resíduo dele (N x C amostras), já escalada pela força. Com
 * `rigFactory` (createRig de rig.js), assa também o corpo (bakeBody).
 * @param prep resultado de prepareSong
 * @param lib biblioteca (moves.js)
 */
export function buildPlan(prep, lib, { rigFactory } = {}) {
  const t0 = performance.now();
  const N = lib.N, C = lib.C, D = N * C;
  const plan = { N, C, warp: lib.warp, hands: {}, stats: {} };
  const tmp = new Float32Array(D), cand = new Float32Array(D);
  // com o esqueleto em mãos, cada candidato é testado no nosso kit antes de ser escolhido
  const rig = rigFactory ? rigFactory() : null;
  for (const h of HANDS) {
    const hits = prep.limbs[h] || [];
    const t0s = [], t1s = [], as = [], bs = [], curves = [];
    let last = -1, used = 0, rejected = 0;
    for (let k = 0; k + 1 < hits.length; k++) {
      const A = hits[k], B = hits[k + 1], g = B.t - A.t;
      if (g < lib.gap[0] || g > lib.gap[1] || !lib.insts.includes(A.inst) || !lib.insts.includes(B.inst)) continue;
      const q = {
        a: A.inst, b: B.inst, g, va: A.ghost ? 0.2 : A.vel, vb: B.ghost ? 0.2 : B.vel,
        gp: k ? A.t - hits[k - 1].t : lib.gap[1], gn: k + 2 < hits.length ? hits[k + 2].t - B.t : lib.gap[1],
        beat: prep.clock.beatLen(A.t),
      };
      const best = matchMoves(lib, h, q, rig ? 12 : 6);
      if (!best.length) continue;
      const H = lib.hands[h];
      // força: a preparação acompanha (de leve) a nota de chegada, que no recorte pode ser outra
      const k2Of = (i) => Math.min(1.3, Math.max(0.75, Math.sqrt(want(q.vb) / want(H.vb[i] / 255))));
      const scaled = (i, out) => {
        curveOf(lib, h, i, tmp);
        const k2 = k2Of(i);
        for (let j = 0; j < D; j++) out[j] = tmp[j] * (j % C === C - 1 ? Math.sqrt(k2) : k2);
        return out;
      };
      // física: o recorte não pode atravessar nenhuma peça, nem mergulhar abaixo
      // das duas peças do golpe (no kit da captura as alturas eram outras)
      if (rig) {
        for (const c of best) {
          const r = rig.curveClearance(h, A.inst, B.inst, scaled(c[1], cand), 0, N, C, lib.warp);
          const pen = Math.max(0, -r.clear) + Math.max(0, 0.42 - r.low) + Math.max(0, r.dip - 0.06);
          if (pen > 0.008) c[0] += 2 + 40 * pen;
        }
      }
      // sorteio entre os melhores, com peso pra quem está mais perto
      for (const c of best) if (c[1] === last) c[0] += REPEAT_PENALTY;
      best.sort((x, y) => x[0] - y[0]);
      const top = best.slice(0, 6);
      const ws = top.map(([d]) => Math.exp(-(d - top[0][0]) / 0.12));
      let r = hash(k, h === "MD" ? 1 : 2) * ws.reduce((s, x) => s + x, 0), pick = top[0][1];
      for (let j = 0; j < top.length; j++) { r -= ws[j]; if (r <= 0) { pick = top[j][1]; break; } }
      if (best[0][0] > 2) rejected++;
      last = pick;
      const curve = scaled(pick, new Float32Array(D));
      t0s.push(A.t); t1s.push(B.t); as.push(A.inst); bs.push(B.inst); curves.push(curve);
      used++;
    }
    const n = t0s.length, flat = new Float32Array(n * D);
    curves.forEach((c, i) => flat.set(c, i * D));
    plan.hands[h] = { t0: Float64Array.from(t0s), t1: Float64Array.from(t1s), a: as, b: bs, curves: flat };
    plan.stats[h] = { hits: hits.length, covered: used, noClean: rejected };
  }
  if (lib.body && rig && prep.duration > 0) {
    const t1 = performance.now();
    rig.setPlan(plan);
    plan.body = bakeBody(prep, lib, rig);
    plan.stats.bodyMs = performance.now() - t1;
  }
  plan.stats.ms = performance.now() - t0;
  return plan;
}

const BODY_FPS = 30;
const LOOK_AHEAD = 0.55;   // s: a cabeça vai olhando pro próximo alvo longe
const LOOK_GAIN = 0.35;    // fração do ângulo até o alvo
const LOOK_SMOOTH = 0.18;  // s

/**
 * Corpo assado a 30 Hz: desvios da pelve, da coluna, do pescoço, da cabeça e
 * das clavículas (vetor de rotação no frame do baterista, 8 juntas x 3).
 * - alcance: regressão (dos dados) a partir dos nossos pulsos antes, agora e depois;
 * - groove: trechos reais de 8 tempos tocados no tempo da nossa música,
 *   escolhidos pelo andamento e pela densidade, emendados com uma sobreposição;
 * - olhar: a cabeça vira um pouco pro próximo alvo longe, antes do golpe.
 */
export function bakeBody(prep, lib, rig) {
  const B = lib.body, C = B.outputs, n = Math.ceil(prep.duration * BODY_FPS) + 2;
  const delta = new Float32Array(n * C);
  // ---------- alcance ----------
  const wr = new Float32Array(n * 6), a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < n; i++) {
    rig.wrists(i / BODY_FPS, prep, a, b);
    wr.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
  }
  // tira a média móvel (igual aos dados: o que importa é o desvio)
  const k = Math.round(B.highpass * BODY_FPS), acc = new Float64Array(6), hp = new Float32Array(n * 6);
  let lo = 0, hi = -1;
  for (let i = 0; i < n; i++) {
    while (hi < Math.min(n - 1, i + k)) { hi++; for (let c = 0; c < 6; c++) acc[c] += wr[hi * 6 + c]; }
    while (lo < i - k) { for (let c = 0; c < 6; c++) acc[c] -= wr[lo * 6 + c]; lo++; }
    for (let c = 0; c < 6; c++) hp[i * 6 + c] = wr[i * 6 + c] - acc[c] / (hi - lo + 1);
  }
  const x = new Float32Array(B.inputs);
  for (let i = 0; i < n; i++) {
    B.lags.forEach((l, j) => {
      const ii = Math.min(n - 1, Math.max(0, i + Math.round(l * BODY_FPS)));
      for (let c = 0; c < 6; c++) x[j * 6 + c] = hp[ii * 6 + c];
    });
    x[B.inputs - 1] = 1;
    for (let o = 0; o < C; o++) {
      let v = 0;
      for (let q = 0; q < B.inputs; q++) v += x[q] * B.W[q * C + o];
      delta[i * C + o] = v;
    }
  }
  // ---------- groove (em tempo de música) ----------
  const clock = prep.clock, nb = Math.ceil(clock.beatAt(prep.duration)) + 2, spb = B.spb, L = B.clipLen;
  const groove = new Float32Array((nb + 1) * spb * C);
  const handT = [...prep.limbs.MD, ...prep.limbs.ME].map((h) => h.t).sort((p, q) => p - q);
  const kickT = prep.limbs.PD.map((h) => h.t);
  const countIn = (arr, t0, t1) => { let c = 0; for (const t of arr) if (t >= t0 && t < t1) c++; return c; };
  const timeOfBeat = (bt) => { // inverso do relógio (busca binária)
    let x0 = -60, x1 = prep.duration + 60;
    for (let it = 0; it < 40; it++) { const m = (x0 + x1) / 2; if (clock.beatAt(m) < bt) x0 = m; else x1 = m; }
    return (x0 + x1) / 2;
  };
  const recent = [];
  for (let s0 = 0, slot = 0; s0 < nb; s0 += B.clipBeats, slot++) {
    const t0 = timeOfBeat(s0), t1 = timeOfBeat(s0 + B.clipBeats), beat = (t1 - t0) / B.clipBeats;
    const dens = countIn(handT, t0, t1) / B.clipBeats, kick = countIn(kickT, t0, t1) / B.clipBeats;
    let best = [];
    for (let c = 0; c < B.n; c++) {
      let d = 2.5 * Math.abs(Math.log(B.beat[c] / 1000 / beat)) + 0.35 * Math.abs(B.dens[c] / 10 - dens) + 0.25 * Math.abs(B.kick[c] / 10 - kick);
      if (recent.includes(c)) d += 1;
      best.push([d, c]);
    }
    best.sort((p, q) => p[0] - q[0]);
    best = best.slice(0, 5);
    const pick = best[Math.floor(hash(slot, 7) * best.length)][1];
    recent.push(pick);
    if (recent.length > 6) recent.shift();
    // escreve o trecho; no tempo que sobrepõe o anterior, mistura
    for (let j = 0; j < L; j++) {
      const at = s0 * spb + j;
      if (at >= (nb + 1) * spb) break;
      const w = j < spb && slot > 0 ? j / spb : 1;
      for (let c = 0; c < C; c++) {
        const v = B.clips[(pick * L + j) * C + c];
        groove[at * C + c] = groove[at * C + c] * (1 - w) + v * w;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const bt = Math.max(0, clock.beatAt(i / BODY_FPS)) * spb, j = Math.min((nb + 1) * spb - 2, Math.floor(bt)), f = bt - j;
    for (let c = 0; c < C; c++) delta[i * C + c] += groove[j * C + c] * (1 - f) + groove[(j + 1) * C + c] * f;
  }
  // ---------- olhar ----------
  const look = new Float32Array(n * 2), head = rig.headRest;
  const far = (inst) => inst !== "snare" && inst !== "hihat";
  const dir = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < n; i++) {
    const t = i / BODY_FPS;
    let wsum = 0, yaw = 0, pitch = 0;
    for (const l of ["MD", "ME"]) {
      for (const h of prep.limbs[l]) {
        if (h.t < t || h.t > t + LOOK_AHEAD) continue;
        if (!far(h.inst)) continue;
        const P = rig.configs[l][h.inst].P;
        dir.x = P.x - head.x; dir.y = P.y - head.y; dir.z = P.z - head.z;
        const w = 1 - (h.t - t) / LOOK_AHEAD;
        yaw += w * Math.atan2(-dir.x, -dir.z);
        pitch += w * Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
        wsum += w;
        break;
      }
    }
    if (wsum > 0) { look[i * 2] = (yaw / Math.max(1, wsum)) * LOOK_GAIN; look[i * 2 + 1] = (pitch / Math.max(1, wsum) + 0.55) * LOOK_GAIN * 0.5; }
  }
  // suaviza (média móvel) e soma no pescoço e na cabeça
  const ks = Math.round(LOOK_SMOOTH * BODY_FPS), ny = B.joints.indexOf("pescoco") * 3, hy = B.joints.indexOf("cabeca") * 3;
  for (let i = 0; i < n; i++) {
    let sy = 0, sp = 0, cnt = 0;
    for (let j = Math.max(0, i - ks); j <= Math.min(n - 1, i + ks); j++) { sy += look[j * 2]; sp += look[j * 2 + 1]; cnt++; }
    const yv = sy / cnt, pv = sp / cnt;
    delta[i * C + ny + 1] += yv * 0.4; delta[i * C + hy + 1] += yv * 0.6;
    delta[i * C + ny] += pv * 0.4; delta[i * C + hy] += pv * 0.6;
  }
  return { fps: BODY_FPS, channels: C, joints: B.joints, delta };
}

/** Arrays do plano (pra transferir do Worker sem copiar). */
export function planBuffers(plan) {
  const out = HANDS.flatMap((h) => {
    const p = plan.hands[h];
    return p ? [p.t0.buffer, p.t1.buffer, p.curves.buffer] : [];
  });
  if (plan.body) out.push(plan.body.delta.buffer);
  return out;
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
