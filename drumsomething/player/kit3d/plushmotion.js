// Movimentos extras do estilo pelúcia, todos como função pura do tempo (igual
// a motion.js): rabo no andamento, cabeça no pulso, piscada, orelhas no prato
// de ataque e o amasso das peças no golpe.

import { lastAtOrBefore } from "./timeline.js";

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * Balanço amortecido que começa em zero no golpe e volta a zero antes do
 * próximo golpe na mesma peça: no instante de cada nota a peça está parada no
 * lugar, então a baqueta encosta na superfície que se vê.
 * @param hits golpes da peça ({t, vel}), em ordem
 */
export function softWobble(hits, t, amp, tau, freq, fade = 0.12) {
  const i = lastAtOrBefore(hits, t);
  if (i < 0) return 0;
  const h = hits[i], s = t - h.t;
  if (s > tau * 7) return 0;
  let v = amp * h.vel * Math.exp(-s / tau) * Math.sin(2 * Math.PI * freq * s);
  const next = hits[i + 1];
  if (next) {
    const gap = next.t - h.t, f = Math.min(fade, gap * 0.5);
    if (s > gap - f) v *= smooth((gap - s) / f);
  }
  return v;
}

/** Ângulo do rabo (rad, -1..1 vezes a amplitude) num ponto s (0 = base, 1 = ponta). */
export function tailSway(clock, t, s) {
  const beat = clock.beatAt(t);
  // um vaivém a cada 2 tempos, com a ponta atrasada (onda descendo pelo rabo)
  return Math.sin(Math.PI * beat - 1.5 * s) * (0.35 + 0.65 * s);
}

/** Aceno da cabeça no pulso: 1 na batida, 0 no meio do tempo. */
export function headPulse(clock, t) {
  const phase = clock.beatAt(t) % 1;
  return Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * phase), 2);
}

// Hash determinístico em [0, 1).
const hash = (k) => {
  const x = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const BLINK_EVERY = 3.4; // s (média)
const BLINK_LEN = 0.17;  // s

/** Olho fechado (0 = aberto, 1 = fechado). Pisca de tempos em tempos, às vezes duas vezes. */
export function blink(t) {
  const k = Math.floor(t / BLINK_EVERY);
  let c = 0;
  for (const j of [k - 1, k]) {
    const start = j * BLINK_EVERY + 0.2 + hash(j) * (BLINK_EVERY - 0.8);
    const twice = hash(j + 0.5) < 0.25;
    for (const s0 of twice ? [start, start + 0.26] : [start]) {
      const u = (t - s0) / BLINK_LEN;
      if (u > 0 && u < 1) c = Math.max(c, Math.sin(Math.PI * u));
    }
  }
  return c;
}

/** Orelhas mexendo depois de um golpe no prato de ataque (-1..1). */
export const earTwitch = (crashHits, t) => softWobble(crashHits, t, 1, 0.13, 5.5, 0.1);
