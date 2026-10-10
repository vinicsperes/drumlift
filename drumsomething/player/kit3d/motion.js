// Movimento de cada membro como função pura do tempo: acha o golpe anterior e o
// próximo daquele membro (busca binária) e interpola. Nada depende do quadro
// anterior, então seek e loop pra trás funcionam de graça.

import { lastAtOrBefore } from "./timeline.js";

const UP = 0.16;          // s: rebote depois do golpe
const DOWN = 0.13;        // s: descida da baqueta até a peça
const REST_GAP = 1.1;     // s: intervalo a partir do qual a mão volta a descansar
const SETTLE = 0.36;      // s: tempo pra ir da peça até a posição de descanso
const APPROACH = 0.5;     // s: saindo do descanso, quanto antes do golpe começa a preparar
const FULL_STROKE = 0.55; // s: tempo pra uma preparação na altura máxima
export const REST_LIFT = 0.32;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut = (x) => 1 - (1 - x) * (1 - x);
const smooth = (x) => x * x * (3 - 2 * x);
const smoothstep = (a, b, x) => smooth(clamp01((x - a) / (b - a)));

/** Altura da preparação (0..1): depende de vel, de ghost e do tempo que sobra. */
export function strokeHeight(hit, gap) {
  const want = hit.ghost ? 0.07 : 0.22 + 0.78 * hit.vel;
  return Math.max(0.03, Math.min(want, gap / FULL_STROKE));
}

function setState(out, a, b, w, h) {
  out.a = a; out.b = b; out.w = w; out.h = h;
  return out;
}

/**
 * Estado de uma mão no tempo t.
 * Resultado: a pose base vai da configuração de golpe da peça `a` pra da peça
 * `b` com peso `w`; `h` (0..1) é quanto a baqueta está levantada. Em `h = 0` e
 * `w = 1` a ponta da baqueta está encostada na peça `b`.
 * @param {{t:number, inst:string, vel:number, ghost:boolean}[]} hits golpes do membro, em ordem
 * @param {string} home peça de descanso (onde a mão fica parada)
 */
export function handState(hits, home, t, out = {}) {
  const i = lastAtOrBefore(hits, t);
  const A = i >= 0 ? hits[i] : null;
  const B = i + 1 < hits.length ? hits[i + 1] : null;

  if (A && B && B.t - A.t <= REST_GAP) {
    // Golpe seguido de golpe: rebote até a altura do próximo, espera, desce.
    const gap = B.t - A.t, hB = strokeHeight(B, gap);
    const dUp = Math.min(UP, 0.45 * gap), dDown = Math.min(DOWN, 0.5 * gap);
    const s = t - A.t, r = B.t - t;
    let h;
    if (s < dUp) h = hB * easeOut(s / dUp);
    else if (r > dDown) h = hB;
    else { const u = 1 - r / dDown; h = hB * (1 - u * u); }
    if (A.inst === B.inst) return setState(out, B.inst, B.inst, 1, h);
    return setState(out, A.inst, B.inst, smoothstep(0.12, 0.7, s / gap), h);
  }

  if (A && (!B || t - A.t < (B.t - A.t) / 2)) {
    // Depois do último golpe por perto: rebote e volta pro descanso.
    const s = t - A.t;
    const h = REST_LIFT * easeOut(clamp01(s / UP));
    return setState(out, A.inst, home, smoothstep(UP * 0.5, UP + SETTLE, s), h);
  }

  if (B) {
    // Saindo do descanso pro próximo golpe.
    const r = B.t - t, hB = strokeHeight(B, APPROACH);
    if (r >= APPROACH) return setState(out, home, home, 1, REST_LIFT);
    if (r > DOWN) {
      const k = smooth(1 - (r - DOWN) / (APPROACH - DOWN));
      return setState(out, home, B.inst, k, REST_LIFT + (hB - REST_LIFT) * k);
    }
    const u = 1 - r / DOWN;
    return setState(out, B.inst, B.inst, 1, hB * (1 - u * u));
  }

  return setState(out, home, home, 1, REST_LIFT);
}

const K_DOWN = 0.09;  // s: pé descendo
const K_UP = 0.14;    // s: pé soltando o pedal

/** Quanto o pedal está pisado (0 = solto, 1 = batedor encostado na pele). */
export function footPress(hits, t) {
  const i = lastAtOrBefore(hits, t);
  const A = i >= 0 ? hits[i] : null;
  const B = i + 1 < hits.length ? hits[i + 1] : null;
  const gap = A && B ? B.t - A.t : Infinity;
  let p = 0;
  if (A) {
    const rel = Math.min(K_UP, 0.45 * gap), s = t - A.t;
    if (s < rel) p = 1 - easeOut(s / rel);
  }
  if (B) {
    const dn = Math.min(K_DOWN, 0.5 * gap), r = B.t - t;
    if (r < dn) { const u = 1 - r / dn; p = Math.max(p, u * u); }
  }
  return p;
}

/**
 * Soma de balanços amortecidos dos últimos golpes numa peça (pratos).
 * Contínua no tempo: cada golpe começa com deslocamento zero.
 */
export function wobble(hits, t, amp, tau, freq) {
  let i = lastAtOrBefore(hits, t), sum = 0;
  for (let k = 0; i >= 0 && k < 8; i--, k++) {
    const s = t - hits[i].t;
    if (s > tau * 5) break;
    sum += amp * hits[i].vel * Math.exp(-s / tau) * Math.sin(2 * Math.PI * freq * s);
  }
  return sum;
}

/** Brilho da pele logo depois do golpe (0..1). */
export function flash(hits, t) {
  const i = lastAtOrBefore(hits, t);
  if (i < 0) return 0;
  const s = t - hits[i].t;
  return s > 0.5 ? 0 : Math.exp(-s / 0.11) * (0.45 + 0.55 * hits[i].vel);
}
