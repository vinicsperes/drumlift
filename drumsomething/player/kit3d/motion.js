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
// Abaixo disso a baqueta não para no alto: sai do rebote e cai no golpe
// seguinte num arco só, como um corpo jogado pra cima (parábola).
const BALLISTIC = 0.42;   // s
const WINDUP = 0.16;      // armada extra antes de um golpe forte (fração da altura)
// Altura de descanso: a baqueta paira uns 6 cm acima da peça (h = 1 ↔ 36 cm de ponta).
export const REST_LIFT = 0.17;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut = (x) => 1 - (1 - x) * (1 - x);
const smooth = (x) => x * x * (3 - 2 * x);
const smoothstep = (a, b, x) => smooth(clamp01((x - a) / (b - a)));

/**
 * Altura da preparação (h, 1 ↔ 36 cm de ponta). Medida num baterista real: a
 * baqueta fica baixa nas notas normais (~4 cm) e fracas (~2,5 cm) e sobe
 * ~13 cm nos acentos; por isso cresce com o cubo da força. Também não passa
 * do que dá tempo de subir.
 */
export function strokeHeight(hit, gap) {
  const want = hit.ghost ? 0.035 : 0.04 + 0.5 * hit.vel ** 3;
  return Math.max(0.025, Math.min(want, gap / FULL_STROKE));
}

function setState(out, a, b, w, h, travel = 0) {
  out.a = a; out.b = b; out.w = w; out.h = h; out.travel = travel;
  return out;
}

/**
 * Estado de uma mão no tempo t.
 * Resultado: a pose base vai da configuração de golpe da peça `a` pra da peça
 * `b` com peso `w`; `h` (0..1) é quanto a baqueta está levantada; `travel`
 * (0..1) é quanto a mão está no meio de uma troca de peça (pra passar por cima
 * dos aros). Em `h = 0` e `w = 1` a ponta da baqueta está encostada na peça `b`.
 *
 * Golpes próximos viram um arco balístico (rebote que já é a preparação do
 * próximo); golpes espaçados sobem, esperam e dão uma armada antes de descer,
 * maior quanto mais forte for o golpe — como a mão de um baterista.
 * @param {{t:number, inst:string, vel:number, ghost:boolean}[]} hits golpes do membro, em ordem
 * @param {string} home peça de descanso (onde a mão fica parada)
 */
export function handState(hits, home, t, out = {}) {
  const i = lastAtOrBefore(hits, t);
  const A = i >= 0 ? hits[i] : null;
  const B = i + 1 < hits.length ? hits[i + 1] : null;

  if (A && B && B.t - A.t <= REST_GAP) {
    const gap = B.t - A.t, hB = strokeHeight(B, gap);
    const s = t - A.t, r = B.t - t, u = s / gap;
    let h;
    if (gap < BALLISTIC) {
      // um arco só: sobe no rebote e cai no golpe seguinte (pico um pouco antes do meio)
      const v = Math.pow(u, 0.9);
      h = hB * 4 * v * (1 - v);
    } else {
      const dUp = Math.min(UP, 0.45 * gap), dDown = Math.min(DOWN, 0.5 * gap);
      const wind = hit2wind(B) * hB;
      if (s < dUp) h = hB * easeOut(s / dUp);
      else if (r > dDown) {
        // esperando no alto: a armada cresce no fim da espera
        const hold = (s - dUp) / Math.max(1e-6, gap - dUp - dDown);
        h = hB + wind * smoothstep(0.55, 1, hold);
      } else {
        const k = 1 - r / dDown;
        h = (hB + wind) * (1 - k * k);
      }
    }
    if (A.inst === B.inst) return setState(out, B.inst, B.inst, 1, h);
    const w = smoothstep(0.12, 0.7, u);
    return setState(out, A.inst, B.inst, w, h, Math.sin(Math.PI * w));
  }

  if (A && (!B || t - A.t < (B.t - A.t) / 2)) {
    // Depois do último golpe por perto: rebote e volta pro descanso.
    const s = t - A.t;
    const h = REST_LIFT * easeOut(clamp01(s / UP));
    const w = smoothstep(UP * 0.5, UP + SETTLE, s);
    return setState(out, A.inst, home, w, h, A.inst === home ? 0 : Math.sin(Math.PI * w));
  }

  if (B) {
    // Saindo do descanso pro próximo golpe, com a armada no fim.
    const r = B.t - t, hB = strokeHeight(B, APPROACH), wind = hit2wind(B) * hB;
    if (r >= APPROACH) return setState(out, home, home, 1, REST_LIFT);
    if (r > DOWN) {
      const k = smooth(1 - (r - DOWN) / (APPROACH - DOWN));
      const h = REST_LIFT + (hB - REST_LIFT) * k + wind * smoothstep(0.6, 1, k);
      return setState(out, home, B.inst, k, h, home === B.inst ? 0 : Math.sin(Math.PI * k));
    }
    const u = 1 - r / DOWN;
    return setState(out, B.inst, B.inst, 1, (hB + wind) * (1 - u * u));
  }

  return setState(out, home, home, 1, REST_LIFT);
}

/** Armada antes do golpe: só nos fortes (acento), nada na nota fantasma. */
function hit2wind(hit) {
  return hit.ghost ? 0 : WINDUP * smoothstep(0.55, 1, hit.vel);
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

const HH_DOWN = 0.08, HH_UP = 0.12;  // s: pé descendo e soltando no "chick"
const HH_HOLD = 1.5;                // tempos: depois de tocar no chimbal, o pé segura fechado

/**
 * Pé esquerdo no pedal do chimbal: `press` (0 = solto, 1 = pisado até o fim) e
 * `tap` (0..1, o calcanhar batendo o pulso). Tocando no chimbal com a baqueta,
 * o pé segura o pedal fechado e o calcanhar marca o tempo; no ride e no prato,
 * o pé faz o "chick" no 2 e no 4 (ou nas notas de pedal da música, se ela tiver);
 * parado, o pé descansa no pedal.
 */
export function hihatFoot(prep, t, out = { press: 0, tap: 0 }) {
  const clock = prep.clock, beat = clock.beatAt(t), len = clock.beatLen(t);
  // chimbal tocado perto daqui (pra trás até HH_HOLD tempos, pra frente meio tempo)
  const hh = prep.instHits.hihat || [];
  const i = lastAtOrBefore(hh, t);
  const since = i >= 0 ? (t - hh[i].t) / len : Infinity, until = i + 1 < hh.length ? (hh[i + 1].t - t) / len : Infinity;
  const closed = Math.max(1 - clamp01((since - HH_HOLD) / 0.6), 1 - clamp01((until - 0.5) / 0.6));
  // música rolando?
  let active = 0;
  for (const l of ["MD", "ME", "PD"]) {
    const hits = prep.limbs[l];
    const j = lastAtOrBefore(hits, t);
    const d = Math.min(j >= 0 ? t - hits[j].t : Infinity, j + 1 < hits.length ? hits[j + 1].t - t : Infinity);
    active = Math.max(active, 1 - clamp01((d - len) / len));
  }
  // chick: notas de pedal da música, ou o 2 e o 4
  let chick = 0;
  if (prep.pedal && prep.pedal.length) {
    chick = pressAround(prep.pedal, t);
  } else {
    const b = Math.floor(beat);
    for (const k of [b, b + 1]) {
      if (((k % 2) + 2) % 2 !== 1) continue;
      const tk = t + (k - beat) * len, s = t - tk;
      if (s >= 0 && s < HH_UP) chick = Math.max(chick, 1 - easeOut(s / HH_UP));
      else if (s < 0 && -s < HH_DOWN) { const u = 1 + s / HH_DOWN; chick = Math.max(chick, u * u); }
    }
  }
  const ph = beat % 1;
  out.press = closed + (1 - closed) * (active * chick + (1 - active) * 0.35);
  out.tap = closed * active * Math.pow(Math.sin(Math.PI * (ph < 0 ? ph + 1 : ph)), 2);
  return out;
}

/** Envelope de pisada em volta de tempos (desce HH_DOWN antes, solta em HH_UP). */
function pressAround(times, t) {
  let lo = 0, hi = times.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m + 1; else hi = m; }
  let p = 0;
  const a = times[lo - 1], b = times[lo];
  if (a !== undefined && t - a < HH_UP) p = Math.max(p, 1 - easeOut((t - a) / HH_UP));
  if (b !== undefined && b - t < HH_DOWN) { const u = 1 - (b - t) / HH_DOWN; p = Math.max(p, u * u); }
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
