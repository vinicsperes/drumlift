// Each limb's motion as a pure function of time: find that limb's previous and next
// stroke (binary search) and interpolate. Nothing depends on the previous frame, so
// seeking and looping backward just work.

import { lastAtOrBefore } from "./timeline.js";

const UP = 0.16;          // s: rebound after the stroke
const DOWN = 0.13;        // s: stick descent to the piece
const REST_GAP = 1.1;     // s: gap beyond which the hand returns to rest
const SETTLE = 0.36;      // s: time from the piece to the rest position
const APPROACH = 0.5;     // s: leaving rest, how long before the stroke the windup starts
const FULL_STROKE = 0.55; // s: time for a windup at full height
// Below this the stick doesn't stop at the top: it leaves the rebound and falls into the
// next stroke in one arc, like something thrown up (a parabola).
const BALLISTIC = 0.42;   // s
const WINDUP = 0.16;      // extra windup before a strong stroke (fraction of height)
// Rest height: the stick hovers about 6 cm above the piece (h = 1 is 36 cm of tip).
export const REST_LIFT = 0.17;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut = (x) => 1 - (1 - x) * (1 - x);
const smooth = (x) => x * x * (3 - 2 * x);
const smoothstep = (a, b, x) => smooth(clamp01((x - a) / (b - a)));

/**
 * Windup height (h, 1 is 36 cm of tip). Measured on a real drummer: the stick stays low
 * on normal (~4 cm) and soft (~2.5 cm) notes and rises ~13 cm on accents, so it grows with
 * the cube of the strength. It also never exceeds what there is time to reach.
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
 * State of a hand at time t.
 * Result: the base pose goes from piece `a`'s strike configuration to piece `b`'s with
 * weight `w`; `h` (0..1) is how lifted the stick is; `travel` (0..1) is how far the hand
 * is through a piece change (to clear the rims). At `h = 0` and `w = 1` the tip touches
 * piece `b`.
 *
 * Close strokes become a ballistic arc (a rebound that is already the next windup);
 * spaced strokes rise, wait and wind up before descending, more the stronger the stroke,
 * like a drummer's hand.
 * @param {{t:number, inst:string, vel:number, ghost:boolean}[]} hits the limb's strokes, in order
 * @param {string} home rest piece (where the hand waits)
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
      // one arc: rises on the rebound and falls into the next stroke (peak a little before mid)
      const v = Math.pow(u, 0.9);
      h = hB * 4 * v * (1 - v);
    } else {
      const dUp = Math.min(UP, 0.45 * gap), dDown = Math.min(DOWN, 0.5 * gap);
      const wind = hit2wind(B) * hB;
      if (s < dUp) h = hB * easeOut(s / dUp);
      else if (r > dDown) {
        // waiting at the top: the windup grows at the end of the wait
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
    // After the last nearby stroke: rebound and back to rest.
    const s = t - A.t;
    const h = REST_LIFT * easeOut(clamp01(s / UP));
    const w = smoothstep(UP * 0.5, UP + SETTLE, s);
    return setState(out, A.inst, home, w, h, A.inst === home ? 0 : Math.sin(Math.PI * w));
  }

  if (B) {
    // Leaving rest for the next stroke, with the windup at the end.
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

/** Windup before the stroke: only on strong ones (accents), none on ghost notes. */
function hit2wind(hit) {
  return hit.ghost ? 0 : WINDUP * smoothstep(0.55, 1, hit.vel);
}

const K_DOWN = 0.09;  // s: foot descending
const K_UP = 0.14;    // s: foot releasing the pedal

/** How pressed the pedal is (0 = released, 1 = beater on the head). */
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

const HH_DOWN = 0.08, HH_UP = 0.12;  // s: foot descending and releasing on the "chick"
const HH_HOLD = 1.5;                // beats: after playing the hi-hat, the foot holds it closed

/**
 * Left foot on the hi-hat pedal: `press` (0 = released, 1 = fully pressed) and `tap`
 * (0..1, the heel tapping the pulse). Playing the hi-hat with the stick, the foot holds
 * the pedal closed and the heel marks time; on the ride and crash, the foot does the
 * "chick" on 2 and 4 (or on the song's pedal notes, if it has them); when still, the
 * foot rests on the pedal.
 */
export function hihatFoot(prep, t, out = { press: 0, tap: 0 }) {
  const clock = prep.clock, beat = clock.beatAt(t), len = clock.beatLen(t);
  // hi-hat played nearby (back up to HH_HOLD beats, forward half a beat)
  const hh = prep.instHits.hihat || [];
  const i = lastAtOrBefore(hh, t);
  const since = i >= 0 ? (t - hh[i].t) / len : Infinity, until = i + 1 < hh.length ? (hh[i + 1].t - t) / len : Infinity;
  const closed = Math.max(1 - clamp01((since - HH_HOLD) / 0.6), 1 - clamp01((until - 0.5) / 0.6));
  // music rolling?
  let active = 0;
  for (const l of ["MD", "ME", "PD"]) {
    const hits = prep.limbs[l];
    const j = lastAtOrBefore(hits, t);
    const d = Math.min(j >= 0 ? t - hits[j].t : Infinity, j + 1 < hits.length ? hits[j + 1].t - t : Infinity);
    active = Math.max(active, 1 - clamp01((d - len) / len));
  }
  // chick: the song's pedal notes, or 2 and 4
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

/** Press envelope around times (descends HH_DOWN before, releases over HH_UP). */
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
 * Sum of damped swings of the last strokes on a piece (cymbals).
 * Continuous in time: each stroke starts at zero displacement.
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

/** Head brightness right after the stroke (0..1). */
export function flash(hits, t) {
  const i = lastAtOrBefore(hits, t);
  if (i < 0) return 0;
  const s = t - hits[i].t;
  return s > 0.5 ? 0 : Math.exp(-s / 0.11) * (0.45 + 0.55 * hits[i].vel);
}
