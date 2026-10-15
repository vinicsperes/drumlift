// Player do drumlift: liga o motor de áudio, o baterista 3D (o palco, que
// ocupa a tela toda), a faixa de notas, a tab completa e os controles.

import { $, $$, SUBDIV_NAME, clamp, fmt, lowerBound, makeGrid, pref, splitTitle, toast } from "./util.js";
import { createEngine } from "./audio.js";
import { createLane } from "./lane.js";
import { createSheet } from "./sheet.js";
import { prepareSong } from "../kit3d/timeline.js";
import { themeFor } from "../kit3d/theme.js";

const PIECES = ["crash", "ride", "hihat", "snare", "tom", "kick"];
const CAMS = ["frente", "baterista", "lado", "cima"];
const CAM_LABEL = { frente: "Frente", baterista: "Baterista", lado: "Lado", cima: "Cima" };
const STYLES = ["pelucia", "manequim"];
const STYLE_LABEL = { pelucia: "Pelúcia", manequim: "Manequim" };
const KIT_LABEL = { acustico: "Acústico", 808: "808", bipes: "Bipes", custom: "Seus samples" };

const state = { song: null, notes: [], muted: new Set(), solo: null, anchorBar: 0, loopPicked: false };
let grid, engine, lane, sheet, kit3d = null;
const darkMQ = matchMedia("(prefers-color-scheme: dark)");

boot().catch((e) => {
  console.error(e);
  $("#loading .label").textContent = `Não deu pra abrir: ${e.message}`;
});

async function boot() {
  const res = await fetch("song.json", { cache: "no-store" });
  if (!res.ok) throw new Error("song.json não encontrado");
  const song = await res.json();
  state.song = song;
  state.notes = song.notes.map((n) => ({ ...n }));
  grid = makeGrid(song);
  masthead(song);

  engine = createEngine(song, grid);
  lane = createLane($("#lane"), {
    grid,
    getTime: () => engine.time,
    getLoop: () => engine.loop,
    getMuted: mutedSet,
    onSeek: (t) => engine.seek(t),
    onLoopSelect: (a, b) => { state.loopPicked = true; engine.setLoop(true, a, b); },
    onLabel: toggleMute,
  });
  sheet = createSheet($("#sheet"), {
    grid, state,
    getTime: () => engine.time,
    onSeek: (t, bar, shift) => {
      if (shift) { state.loopPicked = true; engine.setLoop(true, state.anchorBar, bar); return; }
      state.anchorBar = bar;
      engine.seek(t);
    },
    onChange: notesChanged,
    onSaved: (saved) => {
      state.song = saved;
      state.notes = saved.notes.map((n) => ({ ...n }));
      notesChanged();
    },
  });

  applyTheme();
  darkMQ.addEventListener("change", applyTheme);
  notesChanged();
  setupPanel();
  setupTransport();
  setupKeys();
  engine.onChange(syncUI);
  const ro = new ResizeObserver(layout);
  ro.observe($("#dock"));
  ro.observe($("#panel"));
  addEventListener("resize", layout);
  layout();
  mount3D();
  syncUI();
  requestAnimationFrame(frame);

  await engine.load((p) => { $("#loading-bar").style.width = `${Math.round(p * 100)}%`; });
  $("#loading").classList.add("done");
  $("#play").disabled = false;
}

// ---------- música ----------
function masthead(song) {
  const { name, artist } = splitTitle(song.title);
  document.title = `${name} · drumlift`;
  $("#title").textContent = name;
  $("#artist").textContent = artist;
  const [lo, hi] = song.tempo_range || [song.tempo, song.tempo];
  const range = hi - lo >= 2 ? ` (${Math.round(lo)}–${Math.round(hi)})` : "";
  $("#meta").textContent = `${Math.round(song.tempo)} BPM${range} · ${song.beats_per_bar}/4 · ` +
    `${SUBDIV_NAME[song.subdiv] || `${song.subdiv} por tempo`} · ${grid.nBars} compassos`;
  $("#ro-bars").textContent = `/${grid.nBars}`;
}

/** A música com as notas atuais (editadas ou não), cada uma com seu tempo. */
function songWithNotes() {
  return { ...state.song, notes: state.notes.map((n) => ({ ...n, t: grid.stepTime(n.step) })) };
}

/** Notas mudaram (abriu, editou, salvou): recalcula as mãos e avisa todo mundo. */
function notesChanged() {
  const song = songWithNotes();
  const prep = prepareSong(song);
  const limbOf = new Map(prep.notes.map((n) => [`${n.piece}:${n.step}`, n.limb]));
  lane.setNotes(song.notes.map((n) => ({ ...n, limb: limbOf.get(`${n.piece}:${n.step}`) })));
  engine.setNotes(state.notes);
  clearTimeout(notesChanged.timer);
  notesChanged.timer = setTimeout(() => kit3d?.setSong(song), 60);
  layout();
}

// ---------- baterista 3D ----------
async function mount3D() {
  try {
    const { mountKit3D } = await import("../kit3d/kit3d.js");
    kit3d = mountKit3D($("#stage"), {
      song: songWithNotes(),
      getTime: () => engine.time,
      camera: CAMS.includes(pref("kit3d.camera")) ? pref("kit3d.camera") : "frente",
      style: STYLES.includes(pref("kit3d.style")) ? pref("kit3d.style") : "pelucia",
      anticipation: pref("kit3d.anticipation") === "1",
      transparent: true,
      legend: false,
      insets: insets(),
    });
    kit3d.setMuted(mutedSet());
    syncUI();
  } catch (e) {
    console.error(e);
    toast(`Não deu pra abrir o baterista 3D: ${e.message}`, 6000);
  }
}

/** Partes da tela cobertas por painéis: o baterista fica centrado no resto. */
function insets() {
  const W = innerWidth, H = innerHeight;
  const dock = $("#dock").getBoundingClientRect();
  const panel = $("#panel");
  const head = $(".masthead").getBoundingClientRect();
  const narrow = W < 760;
  const right = !narrow && !panel.classList.contains("collapsed") ? W - panel.getBoundingClientRect().left + 8 : 0;
  const top = narrow ? head.bottom + 4 : Math.min(H * 0.16, head.bottom * 0.4);
  return { top, right, bottom: H - dock.top + 4, left: 0 };
}

function layout() {
  if (!lane) return;
  lane.resize();
  document.documentElement.style.setProperty("--dock-h", `${$("#dock").offsetHeight + 12}px`);
  kit3d?.setInsets(insets());
}

// ---------- peças silenciadas ----------
function mutedSet() {
  return state.solo ? new Set(PIECES.filter((p) => p !== state.solo)) : new Set(state.muted);
}
function toggleMute(piece, solo) {
  if (solo) state.solo = state.solo === piece ? null : piece;
  else if (state.muted.has(piece)) state.muted.delete(piece);
  else state.muted.add(piece);
  engine.setMuted(state.muted, state.solo);
  kit3d?.setMuted(mutedSet());
}

// ---------- tema ----------
function hexToRgba(hex, a) {
  const m = hex.replace("#", "");
  const n = parseInt(m.length === 3 ? m.replace(/./g, "$&$&") : m, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function applyTheme() {
  const th = themeFor(darkMQ.matches);
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  const card = v("--dock-solid");
  lane.setColors({
    piece: th.piece, limb: th.limb,
    hair: v("--hair"), beat: v("--hair"), bar: v("--hair-2"),
    muted: v("--muted"), now: v("--ink"), loop: v("--loop"),
    card, cardClear: hexToRgba(card, 0),
  });
}

// ---------- ajustes ----------
function setupPanel() {
  const panel = $("#panel"), toggle = $("#panel-toggle");
  const saved = pref("panel");
  const collapsed = saved === "0" || (saved === null && innerWidth < 760);
  const setCollapsed = (c) => {
    panel.classList.toggle("collapsed", c);
    toggle.setAttribute("aria-expanded", String(!c));
    layout();
  };
  setCollapsed(collapsed);
  toggle.onclick = () => {
    const c = !panel.classList.contains("collapsed");
    setCollapsed(c);
    pref("panel", c ? "0" : "1");
  };

  const rate = $("#rate");
  rate.oninput = () => { $("#rate-out").textContent = `${rate.value}%`; };
  rate.onchange = () => engine.setRate(rate.value / 100);

  $("#cams").innerHTML = CAMS.map((c) => `<button data-cam="${c}">${CAM_LABEL[c]}</button>`).join("");
  $("#cams").onclick = (e) => { const c = e.target.dataset.cam; if (c) setCamera(c); };
  $("#styles").innerHTML = STYLES.map((s) => `<button data-style="${s}">${STYLE_LABEL[s]}</button>`).join("");
  $("#styles").onclick = (e) => {
    const s = e.target.dataset.style;
    if (!s || !kit3d) return;
    kit3d.setStyle(s);
    pref("kit3d.style", s);
    syncUI();
  };
  const ant = $("#anticipation");
  ant.checked = pref("kit3d.anticipation") === "1";
  ant.onchange = () => { kit3d?.setAnticipation(ant.checked); pref("kit3d.anticipation", ant.checked ? "1" : "0"); };

  const kit = $("#kit");
  for (const k of engine.kitNames()) kit.add(new Option(KIT_LABEL[k] || k, k));
  kit.value = engine.kitNames().includes(pref("kit")) ? pref("kit") : "acustico";
  engine.setKit(kit.value);
  kit.onchange = () => { engine.setKit(kit.value); pref("kit", kit.value); };
  $("#metronome").onchange = (e) => engine.setMetronome(e.target.checked);
  for (const r of $$("[data-vol]")) {
    r.value = engine.volume(r.dataset.vol);
    r.oninput = () => engine.setVolume(r.dataset.vol, +r.value);
  }
}

function setCamera(name) {
  if (!kit3d || !CAMS.includes(name)) return;
  kit3d.setCamera(name);
  pref("kit3d.camera", name);
  syncUI();
}

// ---------- transporte ----------
const currentBar = () => clamp(Math.floor((grid.timeToStep(engine.time) + 0.15) / grid.spb), 0, grid.nBars - 1);
const seekBar = (bar) => engine.seek(grid.barTime(clamp(bar, 0, grid.nBars - 1)) - 0.03);

function toggleLoop() {
  const l = engine.loop;
  if (l.on) { engine.setLoop(false); return; }
  const bar = currentBar();
  if (state.loopPicked && bar >= l.a - 1 && bar <= l.b + 1) engine.setLoop(true, l.a, l.b);
  else engine.setLoop(true, bar, bar);
}

function setupTransport() {
  $("#play").onclick = () => engine.toggle();
  $("#dur").textContent = fmt(state.song.duration);
  $("#ab").onclick = (e) => {
    const m = e.target.closest("[data-mode]")?.dataset.mode;
    if (m) engine.setMode(m);
  };
  $("#loop").onclick = toggleLoop;
  $("#sheet-btn").onclick = () => sheet.toggle();

  // barra de posição
  const el = $("#scrub"), tip = $("#scrub-tip");
  let dragging = false;
  const timeAt = (x) => {
    const r = el.getBoundingClientRect();
    return clamp((x - r.left) / r.width, 0, 1) * state.song.duration;
  };
  const showTip = (t, x) => {
    const r = el.getBoundingClientRect();
    const bar = clamp(Math.floor(grid.timeToStep(t) / grid.spb), 0, grid.nBars - 1);
    tip.textContent = `compasso ${bar + 1} · ${fmt(t)}`;
    tip.style.left = `${clamp(x - r.left, 40, r.width - 40)}px`;
  };
  const place = (t) => {
    const f = clamp(t / state.song.duration, 0, 1) * 100;
    $("#scrub-fill").style.width = `${f}%`;
    $("#scrub-knob").style.left = `${f}%`;
  };
  el.addEventListener("pointerdown", (e) => {
    dragging = true;
    el.classList.add("dragging");
    el.setPointerCapture(e.pointerId);
    place(timeAt(e.clientX));
    showTip(timeAt(e.clientX), e.clientX);
  });
  el.addEventListener("pointermove", (e) => {
    showTip(timeAt(e.clientX), e.clientX);
    if (dragging) place(timeAt(e.clientX));
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove("dragging");
    if (e.type === "pointerup") engine.seek(timeAt(e.clientX));
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  setupTransport.place = place;
  setupTransport.dragging = () => dragging;
}

/** Botões e rótulos que dependem do estado do motor. */
function syncUI() {
  if (!engine) return;
  document.body.classList.toggle("playing", engine.playing);
  $("#play").setAttribute("aria-label", engine.playing ? "Pausar (espaço)" : "Tocar (espaço)");
  for (const b of $$("#ab [data-mode]")) b.classList.toggle("on", b.dataset.mode === engine.mode);
  const l = engine.loop;
  $("#loop").classList.toggle("on", l.on);
  $("#loop-label").textContent = l.on ? (l.a === l.b ? `Loop ${l.a + 1}` : `Loop ${l.a + 1}–${l.b + 1}`) : "Loop";
  const box = $("#scrub-loop");
  box.style.display = l.on ? "block" : "none";
  if (l.on) {
    const [a, b] = engine.loopTimes(), d = state.song.duration;
    box.style.left = `${clamp(a / d, 0, 1) * 100}%`;
    box.style.width = `${Math.max(0.4, ((b - a) / d) * 100)}%`;
  }
  const r = Math.round(engine.rate * 100);
  $("#rate").value = r;
  $("#rate-out").textContent = `${r}%`;
  $("#metronome").checked = engine.metronome;
  for (const b of $$("#cams [data-cam]")) b.classList.toggle("on", kit3d?.camera === b.dataset.cam);
  for (const b of $$("#styles [data-style]")) b.classList.toggle("on", kit3d?.style === b.dataset.style);
}

// ---------- quadro ----------
const last = { bar: -1, beat: -1, sec: -1, bpm: -1 };
function localBpm(t) {
  const b = state.song.beats, i = clamp(lowerBound(b, t), 2, b.length - 3);
  return 240 / (b[i + 2] - b[i - 2]);
}
function frame() {
  requestAnimationFrame(frame);
  const t = engine.time;
  lane.draw(t);
  sheet.update(t, engine.playing);
  const step = Math.floor(grid.timeToStep(t) + 0.15);
  const bar = clamp(Math.floor(step / grid.spb), 0, grid.nBars - 1);
  const beat = clamp(Math.floor((step - bar * grid.spb) / grid.subdiv), 0, grid.bpb - 1) + 1;
  if (bar !== last.bar) { $("#ro-bar").textContent = bar + 1; last.bar = bar; }
  if (beat !== last.beat) {
    $("#ro-beat").textContent = beat;
    last.beat = beat;
    const bpm = Math.round(localBpm(t));
    if (bpm !== last.bpm) { $("#ro-bpm").textContent = bpm; last.bpm = bpm; }
  }
  const sec = Math.floor(t);
  if (sec !== last.sec) { $("#time").textContent = fmt(t); last.sec = sec; }
  if (!setupTransport.dragging()) setupTransport.place(t);
}

// ---------- teclado ----------
function setupKeys() {
  addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (mod && k === "s") { if (sheet.isOpen) { e.preventDefault(); sheet.save(); } return; }
    if (mod && k === "z") { if (sheet.isOpen) { e.preventDefault(); sheet.undo(); } return; }
    if (mod || e.altKey) return;
    if (e.target.closest("input, select, textarea")) return;
    const rate = engine.rate;
    switch (k) {
      case " ": e.preventDefault(); engine.toggle(); break;
      case "arrowleft": e.preventDefault(); seekBar(currentBar() - 1); break;
      case "arrowright": e.preventDefault(); seekBar(currentBar() + 1); break;
      case "a": engine.setMode(engine.mode === "tab" ? "original" : "tab"); break;
      case "l": toggleLoop(); break;
      case "m": engine.setMetronome(!engine.metronome); break;
      case "t": sheet.toggle(); break;
      case "e": sheet.toggleEdit(); break;
      case "escape": sheet.close(); break;
      case "[": engine.setRate(clamp(Math.round((rate - 0.05) * 20) / 20, 0.5, 1)); break;
      case "]": engine.setRate(clamp(Math.round((rate + 0.05) * 20) / 20, 0.5, 1)); break;
      case "home": engine.seek(0); break;
      default:
        if ("1234".includes(k) && k.length === 1) setCamera(CAMS[+k - 1]);
    }
  });
}
