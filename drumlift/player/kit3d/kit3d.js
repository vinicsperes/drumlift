// 3D stage: a drummer playing the tab in sync with the song.
//
//   import { mountKit3D } from "./kit3d/kit3d.js";
//   const view = mountKit3D(container, { song, getTime: () => seconds });
// view.setSong(song); view.setCamera("drummer" | "front" | "side" | "top");
//   view.setMuted(new Set(["hihat"])); view.setAnticipation(true);
//   view.dispose();
// view.setInsets({ top, right, bottom, left }); // px covered by panels on top
// await view.planReady; // baked performance from the capture (moves/)
//
// Options: `transparent` (the page draws the background), `legend: false` (no limb
// legend, when the page shows its own) and `moves: false` (procedural model only,
// without the real drummer's strokes).
// The module plays no audio and owns no clock: it calls getTime() each frame and
// computes the whole pose from that time.

import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "../vendor/three.module.min.js";
import { OrbitControls } from "../vendor/OrbitControls.js";
import { prepareSong } from "./timeline.js";
import { createMocap } from "./mocap.js";
import { CAMERA_NAMES, cameraPose } from "./cameras.js";
import { LIMB_NAMES } from "./theme.js";

const FOV = 42;
const CAMERA_TWEEN = 0.6; // s
// Weak machine: if the mean frame exceeds this for 2 s, draw at pixelRatio 1.
const SLOW_FRAME_MS = 25;
const SLOW_WINDOW_MS = 2000;
// A real drummer's strokes (tools/mmip_moves.py); the plan is built in a Worker.
const MOVES_URL = new URL("./moves/mmip.json", import.meta.url).href;

export { CAMERA_NAMES, CAMERA_LABELS } from "./cameras.js";

/**
 * @param {HTMLElement} container element with a set size; the canvas fills it
 * @param {{song?: object, getTime: () => number, camera?: string, anticipation?: boolean,
 *          transparent?: boolean, legend?: boolean,
 *          insets?: {top?: number, right?: number, bottom?: number, left?: number}}} opts
 */
export function mountKit3D(container, opts = {}) {
  const getTime = typeof opts.getTime === "function" ? opts.getTime : () => 0;
  const root = document.createElement("div");
  root.className = "kit3d";
  root.style.cssText = "position:relative;width:100%;height:100%;min-height:160px;overflow:hidden;";
  container.appendChild(root);

  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, powerPreference: "default", alpha: !!opts.transparent });
  } catch (err) {
    console.warn("kit3d: WebGL unavailable", err);
    root.style.cssText += "display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;opacity:.7;";
    root.textContent = "Could not open the 3D stage: the browser did not allow WebGL.";
    const noop = () => {};
    return {
      setSong: noop, setCamera: noop, setMuted: noop, setAnticipation: noop, 
      setInsets: noop,
      dispose: () => root.remove(),
    };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const transparent = !!opts.transparent;
  if (transparent) renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline:none;";
  canvas.setAttribute("aria-label", "3D stage: drag to rotate, scroll to zoom");
  root.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.05, 30);
  const style = createMocap({ renderer, scene });
  scene.add(style.group);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 0.7;
  controls.maxDistance = 7;
  controls.maxPolarAngle = Math.PI * 0.53;
  controls.screenSpacePanning = true;

  // ---------- limb legend ----------
  const legend = document.createElement("div");
  legend.style.cssText = "position:absolute;left:8px;top:8px;display:flex;gap:6px;flex-wrap:wrap;" +
    "font:600 11px/1 ui-monospace,Menlo,monospace;user-select:none;";
  const chips = {};
  for (const limb of Object.keys(LIMB_NAMES)) {
    const chip = document.createElement("span");
    chip.title = LIMB_NAMES[limb];
    chip.style.cssText = "display:inline-flex;align-items:center;gap:5px;padding:4px 7px;border-radius:6px;border:1px solid;";
    const dot = document.createElement("i");
    dot.style.cssText = "display:inline-block;width:9px;height:9px;border-radius:50%;";
    chip.append(dot, limb);
    legend.append(chip);
    chips[limb] = { chip, dot };
  }
  if (opts.legend !== false) root.appendChild(legend);

  // ---------- state ----------
  let prep = prepareSong(opts.song);
  let plan = null, planId = 0, planWorker = null, planDone = null;
  const useMoves = opts.moves !== false;
  let anticipation = !!opts.anticipation;
  let muted = new Set();
  let camName = CAMERA_NAMES.includes(opts.camera) ? opts.camera : "front";
  let userMoved = false;
  let tween = null;
  let dirty = true;
  let lastT = NaN;
  let width = 0, height = 0;
  // free area of the canvas (without the page's panels on top), in px
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  Object.assign(insets, opts.insets || {});
  let raf = 0;
  let disposed = false;

  // ---------- theme ----------
  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function applyTheme() {
    const th = style.paint(mq ? mq.matches : true);
    if (transparent) scene.background = null;
    for (const [limb, { chip, dot }] of Object.entries(chips)) {
      dot.style.background = th.limb[limb];
      chip.style.color = th.text;
      chip.style.borderColor = th.line;
      chip.style.background = th.chip;
    }
    dirty = true;
  }
  mq?.addEventListener?.("change", applyTheme);
  applyTheme();

  // ---------- camera ----------
  const tmpPos = new Vector3(), tmpTarget = new Vector3();
  // The camera frames the free area: the optical axis goes to its center
  // (setViewOffset) and the distance is what makes the kit fit.
  function freeRect() {
    const fw = Math.max(80, width - insets.left - insets.right);
    const fh = Math.max(80, height - insets.top - insets.bottom);
    return { fw, fh, cx: insets.left + fw / 2, cy: insets.top + fh / 2 };
  }
  function applyViewOffset() {
    if (!width || !height) return;
    const { cx, cy } = freeRect();
    const dx = cx - width / 2, dy = cy - height / 2;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) camera.clearViewOffset();
    else camera.setViewOffset(width, height, -dx, -dy, width, height);
    camera.updateProjectionMatrix();
  }
  function placeCamera(name, animate) {
    style.setCamera(name);
    const { fw, fh } = freeRect();
    const freeFov = height ? (2 * Math.atan(Math.tan((FOV * Math.PI) / 360) * (fh / height)) * 180) / Math.PI : FOV;
    cameraPose(name, fw / fh, freeFov, tmpPos, tmpTarget);
    if (!animate) {
      tween = null;
      camera.position.copy(tmpPos);
      controls.target.copy(tmpTarget);
      controls.update();
    } else {
      tween = {
        t0: performance.now(),
        fromPos: camera.position.clone(), fromTarget: controls.target.clone(),
        toPos: tmpPos.clone(), toTarget: tmpTarget.clone(),
      };
    }
    dirty = true;
  }
  function stepTween() {
    if (!tween) return false;
    const u = Math.min(1, (performance.now() - tween.t0) / 1000 / CAMERA_TWEEN);
    const e = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
    camera.position.lerpVectors(tween.fromPos, tween.toPos, e);
    controls.target.lerpVectors(tween.fromTarget, tween.toTarget, e);
    if (u >= 1) tween = null;
    return true;
  }
  const onStart = () => { tween = null; userMoved = true; };
  const onChange = () => { dirty = true; };
  controls.addEventListener("start", onStart);
  controls.addEventListener("change", onChange);

  // ---------- size ----------
  function resize(w, h) {
    width = Math.floor(w);
    height = Math.floor(h);
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    applyViewOffset();
    if (!userMoved) placeCamera(camName, false);
    dirty = true;
  }
  const ro = new ResizeObserver((entries) => {
    const r = entries[entries.length - 1].contentRect;
    resize(r.width, r.height);
  });
  ro.observe(root);
  resize(root.clientWidth, root.clientHeight);

  // ---------- performance ----------
  // Measures the interval between consecutive drawn frames; still frames (nothing
  // changed), background tabs and stalls over 1 s don't count.
  const perf = { last: 0, sum: 0, n: 0 };
  function watchPerf(rendered) {
    const now = performance.now();
    if (!rendered || document.hidden || renderer.getPixelRatio() <= 1) { perf.last = 0; return; }
    const dt = perf.last ? now - perf.last : 0;
    perf.last = now;
    if (dt <= 0 || dt > 1000) return;
    perf.sum += dt;
    perf.n++;
    if (perf.sum < SLOW_WINDOW_MS) return;
    if (perf.sum / perf.n > SLOW_FRAME_MS) {
      renderer.setPixelRatio(1);
      renderer.setSize(width, height, false);
      dirty = true;
    }
    perf.sum = 0;
    perf.n = 0;
  }

  // ---------- frame ----------
  function readTime() {
    let t;
    try { t = Number(getTime()); } catch { t = NaN; }
    return Number.isFinite(t) ? t : 0;
  }
  function pose(t) { style.update(t, prep, anticipation); }
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!width || !height) return;
    const t = readTime();
    const moving = stepTween();
    const changed = controls.update();
    if (t === lastT && !dirty && !moving && !changed) { watchPerf(false); return; }
    pose(t);
    renderer.render(scene, camera);
    lastT = t;
    dirty = false;
    watchPerf(true);
  }
  raf = requestAnimationFrame(frame);

  // ---------- baked performance ----------
  // For each song (or edit), a Worker picks the closest real segment for each stroke;
  // until then, or if something fails, the procedural model applies.
  let planReady = Promise.resolve(null);
  function requestPlan(song) {
    const id = ++planId;
    if (!useMoves || !song || !Array.isArray(song.notes)) {
      plan = null;
      style.rig.setPlan(null);
      planReady = Promise.resolve(null);
      return;
    }
    // the previous plan holds until the new one arrives (editing the tab doesn't send
    // the drummer back to the procedural model for a moment)
    planReady = new Promise((resolve) => { planDone = resolve; });
    const msg = { id, song: { notes: song.notes, beats: song.beats, tempo: song.tempo, duration: song.duration }, url: MOVES_URL };
    try {
      planWorker ||= new Worker(new URL("./performworker.js", import.meta.url), { type: "module" });
      planWorker.onmessage = (e) => applyPlan(e.data);
      planWorker.onerror = (e) => { e.preventDefault?.(); planWorker = null; buildHere(msg); };
      planWorker.postMessage(msg);
    } catch {
      buildHere(msg);
    }
  }
  /** No Worker: build it here, after yielding to the page. */
  function buildHere(msg) {
    setTimeout(async () => {
      try {
        const [{ loadMoves }, { buildPlan }, { createRig }] = await Promise.all([import("./moves.js"), import("./perform.js"), import("./rig.js")]);
        const lib = await loadMoves(msg.url);
        applyPlan({ id: msg.id, plan: buildPlan(prepareSong(msg.song), lib, { rigFactory: createRig }) });
      } catch (err) {
        applyPlan({ id: msg.id, error: String(err?.message || err) });
      }
    }, 0);
  }
  function applyPlan({ id, plan: p, error }) {
    if (id !== planId || disposed) return;
    if (error) console.warn("kit3d: procedural performance (", error, ")");
    plan = p || null;
    style.rig.setPlan(plan);
    dirty = true;
    planDone?.(plan);
  }

  // Compatible with the old _debug.avatar: skeleton + stick tip.
  const avatarView = () => ({
    ...style.avatar, configs: style.rig.configs, arms: style.rig.arms, legs: style.rig.legs,
    TIP_R: style.rig.TIP_R, tipWorld: style.tipWorld,
  });

  // ---------- API ----------
  const view = {
    setSong(song) { prep = prepareSong(song); requestPlan(song); dirty = true; },
    /** Promise of the current song's baked performance (null = procedural). */
    get planReady() { return planReady; },
    setCamera(name) {
      if (!CAMERA_NAMES.includes(name)) return;
      camName = name;
      userMoved = false;
      placeCamera(name, true);
    },
    setMuted(pieces) { muted = new Set(pieces || []); style.setMuted(muted); dirty = true; },
    setAnticipation(on) { anticipation = !!on; dirty = true; },
    /** Parts of the canvas covered by the page's panels (px): the drummer centers in the rest. */
    setInsets(next) {
      Object.assign(insets, next || {});
      applyViewOffset();
      if (!userMoved) placeCamera(camName, !!tween);
      dirty = true;
    },
    get camera() { return camName; },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      planWorker?.terminate();
      ro.disconnect();
      mq?.removeEventListener?.("change", applyTheme);
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("change", onChange);
      controls.dispose();
      style.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      root.remove();
    },
    // Test hooks; not part of the contract.
    _debug: {
      get prep() { return prep; },
      get plan() { return plan; },
      get kit() { return style.kit; },
      get avatar() { return avatarView(); },
      get rig() { return style.rig; },
      get styleObj() { return style; },
      /** Is the camera still moving to its preset? */
      get tweening() { return !!tween; },
      renderer, camera, controls, scene,
      /** Compute the pose at time t (no drawing). The next frame returns to getTime(). */
      pose(t) { pose(t); dirty = true; },
      /**
       * Stick tip relative to the piece's contact point, at time t:
       * gap = height (m) above the surface; off = distance (m) to the target point.
       */
      tip(limb, inst, t) {
        pose(t);
        dirty = true;
        const c = style.rig.configs[limb][inst];
        const tip = style.tipWorld(limb);
        const off = tip.distanceTo(c.tip);
        return { gap: tip.sub(c.P).dot(c.n) - style.rig.TIP_R, off };
      },
      /** Distance (m) from the beater to the kick head, at time t. */
      beaterGap(t) { pose(t); dirty = true; return style.beaterGap(); },
      /** How far the piece's surface is out of place at time t. */
      deform(id, t) { pose(t); dirty = true; return style.kit.deform ? style.kit.deform(id) : 0; },
      /** Did the IK reach its targets at time t? */
      reached(t) {
        pose(t);
        dirty = true;
        const { arms, legs } = style.rig;
        return { MD: arms.MD.reached, ME: arms.ME.reached, PD: legs.PD.reached, PE: legs.PE.reached };
      },
      info() { return { ...renderer.info.render }; },
      memory() { return { ...renderer.info.memory }; },
      /** Draw a frame now (to measure draw calls and memory). */
      render() { pose(readTime()); renderer.render(scene, camera); return { ...renderer.info.render }; },
    },
  };
  placeCamera(camName, false);
  requestPlan(opts.song);
  return view;
}
