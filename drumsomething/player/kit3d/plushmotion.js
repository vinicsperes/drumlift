// Movimentos extras do estilo pelúcia, todos como função pura do tempo (igual
// a motion.js): o amasso das peças no golpe e a ação secundária do gato
// (cabeça e tronco seguindo o golpe, rabo ondulando, orelhas, barriga,
// piscada). Nada guarda estado entre quadros: cada valor é uma soma de
// respostas amortecidas aos golpes recentes, então seek e loop funcionam.

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

/**
 * Prato como pêndulo esférico amortecido. Cada golpe dá um impulso que inclina
 * o prato pro lado onde a baqueta bateu (`dir` = direção do contato no plano
 * do prato, [x, z]). O prato tem dois modos de balanço com frequências um
 * pouco diferentes, em eixos girados: um golpe que não cai em cima de um eixo
 * vira uma elipse que vai rodando (a borda "gira", como num prato de verdade).
 * Soma as respostas dos golpes recentes e assenta suavemente antes do próximo
 * golpe na mesma peça, pra baqueta encostar na superfície que se vê.
 * Devolve [rotação em x, rotação em z] (rad) no frame do prato.
 */
export function cymbalSwing(hits, t, { amp, tau, freq, split = 0.08, axis = 0.6, fade = 0.14 }, dir, out = [0, 0]) {
  out[0] = 0; out[1] = 0;
  const i = lastAtOrBefore(hits, t);
  if (i < 0) return out;
  // eixo de inclinação de um empurrão pra baixo em `dir`: (θx, θz) = (dz, -dx)
  const tx = dir[1], tz = -dir[0];
  const c = Math.cos(axis), sn = Math.sin(axis);
  const c1 = tx * c + tz * sn, c2 = -tx * sn + tz * c; // componentes nos dois modos
  const w1 = 2 * Math.PI * freq, w2 = w1 * (1 + split);
  for (let k = i, n = 0; k >= 0 && n < 8; k--, n++) {
    const s = t - hits[k].t;
    if (s > tau * 6) break;
    const e = amp * (hits[k].ghost ? 0.25 : hits[k].vel) * Math.exp(-s / tau);
    const m1 = e * c1 * Math.sin(w1 * s), m2 = e * c2 * Math.sin(w2 * s);
    out[0] += m1 * c - m2 * sn;
    out[1] += m1 * sn + m2 * c;
  }
  const next = hits[i + 1];
  if (next) {
    const gap = next.t - hits[i].t, f = Math.min(fade, gap * 0.5), s = t - hits[i].t;
    if (s > gap - f) { const k = smooth((gap - s) / f); out[0] *= k; out[1] *= k; }
  }
  return out;
}

/**
 * Soma de impulsos amortecidos dos golpes recentes: cada golpe dá um empurrão
 * que sobe até 1 em `tau` segundos e some devagar (s/τ·e^(1-s/τ)), começando
 * `delay` segundos depois da nota. Contínuo no tempo.
 */
export function impulse(hits, t, tau, delay = 0) {
  if (!hits || !hits.length) return 0;
  let sum = 0;
  for (let i = lastAtOrBefore(hits, t - delay), k = 0; i >= 0 && k < 10; i--, k++) {
    const s = t - delay - hits[i].t;
    if (s > tau * 8) break;
    const u = s / tau;
    sum += (hits[i].ghost ? 0.25 : hits[i].vel) * u * Math.exp(1 - u);
  }
  return sum;
}

/** Soma de balanços amortecidos (e^(-s/τ)·sen(2πfs)) dos golpes recentes. Começa em 0 em cada golpe. */
export function ripple(hits, t, tau, freq, delay = 0) {
  if (!hits || !hits.length) return 0;
  let sum = 0;
  for (let i = lastAtOrBefore(hits, t - delay), k = 0; i >= 0 && k < 10; i--, k++) {
    const s = t - delay - hits[i].t;
    if (s > tau * 6) break;
    sum += (hits[i].ghost ? 0.25 : hits[i].vel) * Math.exp(-s / tau) * Math.sin(2 * Math.PI * freq * s);
  }
  return sum;
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

export const TAIL_BONES = 6;

/**
 * Ação secundária do gato no tempo t (ângulos em rad, distâncias em m).
 * A cabeça e o tronco seguem cada golpe com um pequeno atraso, as orelhas
 * balançam com a cabeça (e mais no prato de ataque), a barriga sacode no
 * bumbo e o rabo ondula em corrente: vaivém no andamento + ondas que descem
 * pelo rabo depois de cada bumbo.
 */
export function catMotion(prep, t, out = { tail: new Float64Array(TAIL_BONES * 2) }) {
  const { limbs, clock, instHits } = prep;
  const md = limbs.MD, me = limbs.ME, kick = limbs.PD;
  const beat = clock.beatAt(t);
  // golpes das mãos: a cabeça e o tronco vão junto um pouquinho depois
  const iMD = impulse(md, t, 0.1, 0.02), iME = impulse(me, t, 0.1, 0.02);
  const iKick = impulse(kick, t, 0.09, 0.015);
  const hands = Math.min(1.6, iMD + iME);
  out.chestPitch = -0.012 * hands - 0.01 * iKick;
  out.chestRoll = 0.012 * (iME - iMD);
  out.headPitch = -0.045 * headPulse(clock, t) - 0.035 * impulse(md, t, 0.13, 0.06) - 0.035 * impulse(me, t, 0.13, 0.06);
  out.headRoll = 0.035 * Math.sin(Math.PI * beat) + 0.03 * (impulse(me, t, 0.14, 0.05) - impulse(md, t, 0.14, 0.05));
  out.headYaw = 0.025 * Math.sin(Math.PI * beat * 0.5 + 0.7);
  // orelhas: inércia do balanço da cabeça + susto no prato de ataque
  const tw = earTwitch(instHits.crash || [], t);
  const flop = 0.5 * (ripple(md, t, 0.11, 4.2, 0.07) + ripple(me, t, 0.11, 4.2, 0.07)) + 0.6 * ripple(kick, t, 0.12, 3.6, 0.04);
  out.earPitch = 0.32 * tw + 0.07 * flop;
  out.earRoll = 0.22 * Math.abs(tw) + 0.05 * flop;
  // barriga: sacode no bumbo
  out.belly = 0.0045 * ripple(kick, t, 0.12, 4.5, 0.01) + 0.0015 * hands;
  // rabo: [yaw, pitch] por osso
  for (let i = 0; i < TAIL_BONES; i++) {
    const s = i / (TAIL_BONES - 1);
    out.tail[i * 2] = (0.07 + 0.06 * s) * Math.sin(Math.PI * beat - 0.9 * i);
    out.tail[i * 2 + 1] = 0.09 * ripple(kick, t, 0.16, 2.6, 0.045 * i) + 0.02 * Math.sin(Math.PI * beat * 0.5 - 0.6 * i);
  }
  out.blink = blink(t);
  return out;
}
