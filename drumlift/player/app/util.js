// Player utilities: DOM, time, binary search, rhythmic grid and preferences.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/** 83.4 -> "1:23" (or "1:23.4" with tenths). */
export function fmt(t, tenths = false) {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), s = t - m * 60;
  return tenths ? `${m}:${s.toFixed(1).padStart(4, "0")}` : `${m}:${String(Math.floor(s)).padStart(2, "0")}`;
}

/** Linear interpolation over increasing xs -> ys, extrapolating at the ends. */
export function interp(x, xs, ys) {
  const n = xs.length;
  if (x <= xs[0]) return ys[0] + ((x - xs[0]) * (ys[1] - ys[0])) / (xs[1] - xs[0]);
  if (x >= xs[n - 1]) return ys[n - 1] + ((x - xs[n - 1]) * (ys[n - 1] - ys[n - 2])) / (xs[n - 1] - xs[n - 2]);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  return ys[lo] + ((x - xs[lo]) * (ys[hi] - ys[lo])) / (xs[hi] - xs[lo]);
}

/** First index with key(arr[i]) >= x. */
export function lowerBound(arr, x, key = (v) => v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (key(arr[m]) < x) lo = m + 1; else hi = m; }
  return lo;
}

/** localStorage with try/catch (private tab, blocked storage...).
 *  The prefix was "drumsomething." before the rename: reading the old one keeps existing settings. */
export function pref(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(`drumlift.${key}`) ?? localStorage.getItem(`drumsomething.${key}`);
    localStorage.setItem(`drumlift.${key}`, String(value));
  } catch { /* no preferences, that's fine */ }
  return null;
}

export const SUBDIV_NAME = { 2: "eighths", 3: "triplets", 4: "sixteenths", 6: "sextuplets", 8: "thirty-seconds" };

/**
 * The song's rhythmic grid. A note's position is its step; the real time comes from
 * the detected beats, so the grid follows the band.
 */
export function makeGrid(song) {
  const idx = song.beats.map((_, i) => i);
  const { subdiv, beats_per_bar: bpb, offset } = song;
  const spb = bpb * subdiv;
  const nBars = Math.floor((song.beats.length - 1) / bpb);
  const stepTime = (step) => interp(step / subdiv + offset, idx, song.beats);
  /** Seconds -> position in beats, aligned with the notes' steps. */
  const timeToBeat = (t) => interp(t, song.beats, idx) - offset;
  return {
    spb, bpb, subdiv, nBars,
    stepTime, timeToBeat,
    timeToStep: (t) => timeToBeat(t) * subdiv,
    beatTime: (k) => stepTime(k * subdiv),
    barTime: (bar) => stepTime(bar * spb),
  };
}

/** "QOTSA - No One Knows" -> { name: "No One Knows", artist: "QOTSA" }. */
export function splitTitle(title = "") {
  const m = title.match(/^(.*?)\s+[-–—]\s+(.*)$/);
  return m ? { name: m[2], artist: m[1] } : { name: title, artist: "" };
}

/** Small footer message. */
export function toast(msg, ms = 2400) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), ms);
}
