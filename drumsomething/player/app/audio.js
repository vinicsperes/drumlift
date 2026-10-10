// Motor de áudio: toca as faixas da música (banda sem bateria e bateria isolada)
// e agenda as notas da tab, num kit sintetizado, e o metrônomo um pouco antes
// da hora. Tem loop sem emenda e velocidade. O relógio (`time`) é o do que está
// saindo no alto-falante, contínuo a cada quadro: é por ele que a tab e o
// baterista 3D andam.

import { lowerBound } from "./util.js";

const LOOKAHEAD = 0.2; // s agendados à frente
const TRACKS = ["band", "drums"];
const CHANNELS = ["band", "drums", "tab", "click"];
const DEFAULT_VOL = { band: 0.85, drums: 1, tab: 1, click: 0.5 };

/** Modos de escuta: o que fica ligado em cada um. */
export const MODES = {
  tab: { band: true, drums: false, tab: true },
  original: { band: true, drums: true, tab: false },
};

export function createEngine(song, grid) {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.connect(ctx.destination);
  const gains = {}, vol = { ...DEFAULT_VOL }, on = { band: true, drums: false, tab: true, click: true };
  for (const id of CHANNELS) {
    gains[id] = ctx.createGain();
    gains[id].connect(master);
  }
  const buffers = {}, kits = {};
  let notes = [], beatTimes = [];
  const st = {
    playing: false, segs: [], voices: [], schedCtx: 0, pausedAt: 0, rate: 1, timer: 0,
    loop: false, loopA: 0, loopB: 0, kit: "acustico", metro: false, mode: "tab",
    muted: new Set(), solo: null,
  };
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn(api));

  function applyGain(id) {
    gains[id].gain.setTargetAtTime(on[id] ? vol[id] : 0, ctx.currentTime, 0.015);
  }
  CHANNELS.forEach(applyGain);

  // ---------- carregamento ----------
  async function decode(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return ctx.decodeAudioData(await res.arrayBuffer());
  }
  function makeClick(freq) {
    const len = Math.floor(ctx.sampleRate * 0.03), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.sin((2 * Math.PI * freq * i) / ctx.sampleRate) * Math.exp(-i / (len / 5));
    return b;
  }
  async function load(onProgress = () => {}) {
    const jobs = [];
    let done = 0;
    const tick = () => onProgress(++done / jobs.length);
    for (const id of TRACKS) {
      if (!song.audio?.[id]) continue;
      jobs.push(decode(song.audio[id]).then((b) => { buffers[id] = b; tick(); }));
    }
    for (const [kit, pieces] of Object.entries(song.kits || {})) {
      for (const [piece, url] of Object.entries(pieces)) {
        jobs.push(decode(url).then((b) => { (kits[kit] ||= {})[piece] = b; tick(); }));
      }
    }
    await Promise.all(jobs);
    buffers.click = makeClick(1500);
    buffers.clickDown = makeClick(2200);
  }

  // ---------- notas ----------
  function setNotes(list) {
    notes = list.map((n) => ({ ...n, t: grid.stepTime(n.step) })).sort((a, b) => a.t - b.t);
    beatTimes = song.beats.map((_, k) => grid.beatTime(k));
  }
  setNotes(song.notes);

  // ---------- relógio ----------
  // ctx.currentTime anda em degraus (no Linux, blocos de ~10 ms) e fica
  // adiantado pela latência de saída; o par contextTime/performanceTime de
  // getOutputTimestamp deixa interpolar com o relógio da tela.
  const heard = { t: 0, at: 0 };
  function heardTime() {
    const now = performance.now();
    const ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
    let t = ts && ts.performanceTime > 0
      ? ts.contextTime + (now - ts.performanceTime) / 1000
      : ctx.currentTime - (ctx.outputLatency || 0) - (ctx.baseLatency || 0);
    // a estimativa oscila uns ms: segue a previsão contínua e corrige a deriva aos poucos
    const predicted = heard.t + (now - heard.at) / 1000;
    if (heard.at && Math.abs(t - predicted) < 0.03) t = predicted + (t - predicted) * 0.1;
    heard.t = t;
    heard.at = now;
    return t;
  }
  function songTime() {
    if (!st.playing) return st.pausedAt;
    const now = heardTime();
    let seg = st.segs[0];
    for (const s of st.segs) if (s.ctx <= now) seg = s;
    return seg.song + Math.max(0, now - seg.ctx) * st.rate;
  }

  // ---------- agenda ----------
  function startTracks(at, offset) {
    const srcs = [];
    for (const id of TRACKS) {
      const buf = buffers[id];
      if (!buf) continue;
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.playbackRate.value = st.rate;
      s.connect(gains[id]);
      if (offset < 0) s.start(at - offset / st.rate, 0);
      else if (offset < buf.duration) s.start(at, offset);
      else continue;
      srcs.push(s);
    }
    return srcs;
  }
  const audible = (piece) => (st.solo ? st.solo === piece : !st.muted.has(piece));
  function voice(buf, when, gain, dest) {
    if (!buf) return;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    s.connect(g).connect(dest);
    s.start(Math.max(when, ctx.currentTime));
    st.voices.push(s);
    s.onended = () => { const i = st.voices.indexOf(s); if (i >= 0) st.voices.splice(i, 1); };
  }
  function scheduleRange(seg, a, b) {
    const toCtx = (t) => seg.ctx + (t - seg.song) / st.rate;
    const kit = kits[st.kit] || kits.acustico || {};
    for (let i = lowerBound(notes, a, (n) => n.t); i < notes.length && notes[i].t < b; i++) {
      const n = notes[i];
      if (!audible(n.piece)) continue;
      voice(kit[n.piece] || kits.acustico?.[n.piece], toCtx(n.t), n.ghost ? 0.25 : 0.35 + 0.65 * n.vel, gains.tab);
    }
    if (st.metro) {
      for (let k = lowerBound(beatTimes, a); k < beatTimes.length && beatTimes[k] < b; k++) {
        voice(k % grid.bpb === 0 ? buffers.clickDown : buffers.click, toCtx(beatTimes[k]), 0.8, gains.click);
      }
    }
  }
  function loopTimes() {
    const a = Math.min(st.loopA, st.loopB), b = Math.max(st.loopA, st.loopB);
    return [grid.barTime(a) - 0.03, grid.barTime(b + 1) - 0.03];
  }
  function tick() {
    const target = ctx.currentTime + LOOKAHEAD;
    for (let guard = 0; st.schedCtx < target && guard < 4; guard++) {
      const seg = st.segs[st.segs.length - 1];
      const a = seg.song + (st.schedCtx - seg.ctx) * st.rate;
      const b = seg.song + (target - seg.ctx) * st.rate;
      const [la, lb] = loopTimes();
      if (st.loop && b >= lb && a < lb) {
        scheduleRange(seg, a, lb);
        const at = seg.ctx + (lb - seg.song) / st.rate;
        for (const s of seg.srcs) s.stop(at);
        st.segs.push({ ctx: at, song: la, srcs: startTracks(at, la) });
        if (st.segs.length > 3) st.segs.shift();
        st.schedCtx = at;
        continue;
      }
      scheduleRange(seg, a, b);
      st.schedCtx = target;
    }
    if (!st.loop && songTime() > song.duration + 0.3) { pause(); st.pausedAt = 0; emit(); }
  }
  function halt() {
    clearInterval(st.timer);
    for (const seg of st.segs) for (const s of seg.srcs) { try { s.stop(); } catch { /* já parou */ } }
    for (const v of st.voices.splice(0)) { try { v.stop(); } catch { /* já parou */ } }
    st.segs = [];
  }

  // ---------- transporte ----------
  function play(from = st.pausedAt) {
    if (!buffers.band && !buffers.drums) return;
    ctx.resume();
    halt();
    const at = ctx.currentTime + 0.06;
    st.segs = [{ ctx: at, song: from, srcs: startTracks(at, from) }];
    st.schedCtx = at;
    st.playing = true;
    st.timer = setInterval(tick, 25);
    tick();
    emit();
  }
  function pause() {
    if (!st.playing) return;
    st.pausedAt = songTime();
    halt();
    st.playing = false;
    emit();
  }
  function seek(t) {
    t = Math.max(Math.min(t, song.duration), Math.min(0, grid.barTime(0)));
    if (st.playing) play(t); else { st.pausedAt = t; emit(); }
  }

  // ---------- canais e modos ----------
  function setMode(mode) {
    if (!MODES[mode]) return;
    st.mode = mode;
    Object.assign(on, MODES[mode]);
    for (const id of ["band", "drums", "tab"]) applyGain(id);
    emit();
  }
  setMode("tab");

  const api = {
    ctx, load, setNotes, play, pause, seek, loopTimes,
    toggle() { st.playing ? pause() : play(); },
    get time() { return songTime(); },
    get playing() { return st.playing; },
    get rate() { return st.rate; },
    setRate(r) {
      const t = songTime();
      st.rate = r;
      if (st.playing) play(t); else emit();
    },
    get loop() { return { on: st.loop, a: Math.min(st.loopA, st.loopB), b: Math.max(st.loopA, st.loopB) }; },
    /** Liga/desliga o loop dos compassos a..b (inclusive). */
    setLoop(onOff, a = st.loopA, b = st.loopB) {
      st.loop = onOff;
      st.loopA = Math.min(a, b);
      st.loopB = Math.max(a, b);
      if (onOff && st.playing) {
        const [la, lb] = loopTimes(), t = songTime();
        if (t < la || t >= lb) play(la);
      }
      emit();
    },
    get mode() { return st.mode; },
    setMode,
    volume: (id) => vol[id],
    setVolume(id, v) { vol[id] = v; applyGain(id); },
    get kit() { return st.kit; },
    setKit(name) { st.kit = name; emit(); },
    get metronome() { return st.metro; },
    setMetronome(onOff) { st.metro = !!onOff; emit(); },
    setMuted(set, solo = null) { st.muted = new Set(set || []); st.solo = solo; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    kitNames: () => Object.keys(song.kits || {}),
  };
  return api;
}
