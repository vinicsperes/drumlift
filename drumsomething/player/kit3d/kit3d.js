// Bateria 3D: um baterista tocando a tab em sincronia com a música.
//
//   import { mountKit3D } from "./kit3d/kit3d.js";
//   const view = mountKit3D(container, { song, getTime: () => seconds, style: "pelucia" });
//   view.setSong(song); view.setCamera("baterista" | "frente" | "lado" | "cima");
//   view.setMuted(new Set(["hihat"])); view.setAnticipation(true);
//   view.setStyle("pelucia" | "manequim"); view.style; view.dispose();
//
// O módulo não toca áudio e não é dono do relógio: chama getTime() a cada quadro
// e calcula a pose inteira a partir desse tempo.

import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "../vendor/three.module.min.js";
import { OrbitControls } from "../vendor/OrbitControls.js";
import { prepareSong } from "./timeline.js";
import { DEFAULT_STYLE, STYLE_NAMES, createStyle } from "./styles.js";
import { CAMERA_NAMES, cameraPose } from "./cameras.js";
import { LIMB_NAMES } from "./theme.js";

const FOV = 42;
const CAMERA_TWEEN = 0.6; // s
// Máquina fraca: se o quadro médio passar disso por 2 s, desenha com pixelRatio 1.
const SLOW_FRAME_MS = 25;
const SLOW_WINDOW_MS = 2000;

export { CAMERA_NAMES, CAMERA_LABELS } from "./cameras.js";
export { STYLE_NAMES, STYLE_LABELS } from "./styles.js";
export { CAT_COLOR_NAMES, CAT_COLOR_LABELS } from "./felt.js";

/**
 * @param {HTMLElement} container elemento com tamanho definido; o canvas ocupa ele todo
 * @param {{song?: object, getTime: () => number, camera?: string, anticipation?: boolean,
 *          style?: string, catColors?: string}} opts
 */
export function mountKit3D(container, opts = {}) {
  const getTime = typeof opts.getTime === "function" ? opts.getTime : () => 0;
  const root = document.createElement("div");
  root.className = "kit3d";
  root.style.cssText = "position:relative;width:100%;height:100%;min-height:160px;overflow:hidden;";
  container.appendChild(root);

  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, powerPreference: "default" });
  } catch (err) {
    console.warn("kit3d: WebGL indisponível", err);
    root.style.cssText += "display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;opacity:.7;";
    root.textContent = "Não deu pra abrir a bateria 3D: o navegador não liberou o WebGL.";
    const noop = () => {};
    const wanted = STYLE_NAMES.includes(opts.style) ? opts.style : DEFAULT_STYLE;
    return {
      setSong: noop, setCamera: noop, setMuted: noop, setAnticipation: noop, setStyle: noop, setCatColors: noop,
      get style() { return wanted; }, dispose: () => root.remove(),
    };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline:none;";
  canvas.setAttribute("aria-label", "Bateria 3D: arraste pra girar, role pra aproximar");
  root.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.05, 30);
  let styleName = STYLE_NAMES.includes(opts.style) ? opts.style : DEFAULT_STYLE;
  let catColors = opts.catColors;
  let style = createStyle(styleName, { renderer, scene }, { catColors });
  scene.add(style.group);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 0.7;
  controls.maxDistance = 7;
  controls.maxPolarAngle = Math.PI * 0.53;
  controls.screenSpacePanning = true;

  // ---------- legenda dos membros ----------
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
  root.appendChild(legend);

  // ---------- estado ----------
  let prep = prepareSong(opts.song);
  let anticipation = !!opts.anticipation;
  let muted = new Set();
  let camName = CAMERA_NAMES.includes(opts.camera) ? opts.camera : "baterista";
  let userMoved = false;
  let tween = null;
  let dirty = true;
  let lastT = NaN;
  let width = 0, height = 0;
  let raf = 0;
  let disposed = false;

  // ---------- tema ----------
  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function applyTheme() {
    const th = style.paint(mq ? mq.matches : true);
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

  // ---------- câmera ----------
  const tmpPos = new Vector3(), tmpTarget = new Vector3();
  function placeCamera(name, animate) {
    cameraPose(name, camera.aspect || 1, FOV, tmpPos, tmpTarget);
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

  // ---------- tamanho ----------
  function resize(w, h) {
    width = Math.floor(w);
    height = Math.floor(h);
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (!userMoved) placeCamera(camName, false);
    dirty = true;
  }
  const ro = new ResizeObserver((entries) => {
    const r = entries[entries.length - 1].contentRect;
    resize(r.width, r.height);
  });
  ro.observe(root);
  resize(root.clientWidth, root.clientHeight);

  // ---------- desempenho ----------
  // Mede o intervalo entre quadros desenhados seguidos; quadros parados (nada
  // mudou), abas em segundo plano e engasgos de mais de 1 s não contam.
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

  // ---------- quadro ----------
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

  // ---------- estilo ----------
  // Troca ao vivo: câmera, controles, tempo e peças silenciadas ficam; o estilo
  // anterior libera geometrias, materiais e texturas antes do novo nascer.
  function setStyle(name) {
    if (!STYLE_NAMES.includes(name) || name === styleName || disposed) return;
    scene.remove(style.group);
    style.dispose();
    styleName = name;
    style = createStyle(name, { renderer, scene }, { catColors });
    scene.add(style.group);
    style.setMuted(muted);
    applyTheme();
    dirty = true;
  }

  // Compatível com o _debug.avatar de antes: esqueleto + ponta da baqueta.
  const avatarView = () => ({
    ...style.avatar, configs: style.rig.configs, arms: style.rig.arms, legs: style.rig.legs,
    TIP_R: style.rig.TIP_R, tipWorld: style.tipWorld,
  });

  // ---------- API ----------
  const view = {
    setSong(song) { prep = prepareSong(song); dirty = true; },
    setCamera(name) {
      if (!CAMERA_NAMES.includes(name)) return;
      camName = name;
      userMoved = false;
      placeCamera(name, true);
    },
    setMuted(pieces) { muted = new Set(pieces || []); style.setMuted(muted); dirty = true; },
    setAnticipation(on) { anticipation = !!on; dirty = true; },
    setStyle,
    /** Paleta do gato ("laranja" | "cinza" | "frajola"); por enquanto só na página de desenvolvimento. */
    setCatColors(name) {
      catColors = name;
      style.setCatColors?.(name);
      dirty = true;
    },
    get camera() { return camName; },
    get style() { return styleName; },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
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
    // Ganchos pra testes; não fazem parte do contrato.
    _debug: {
      get prep() { return prep; },
      get kit() { return style.kit; },
      get avatar() { return avatarView(); },
      get rig() { return style.rig; },
      get styleObj() { return style; },
      renderer, camera, controls, scene,
      /** Calcula a pose no tempo t (sem desenhar). O próximo quadro volta pro getTime(). */
      pose(t) { pose(t); dirty = true; },
      /**
       * Ponta da baqueta em relação ao ponto de contato da peça, no tempo t:
       * gap = altura (m) acima da superfície; off = distância (m) até o ponto alvo.
       */
      tip(limb, inst, t) {
        pose(t);
        dirty = true;
        const c = style.rig.configs[limb][inst];
        const tip = style.tipWorld(limb);
        const off = tip.distanceTo(c.tip);
        return { gap: tip.sub(c.P).dot(c.n) - style.rig.TIP_R, off };
      },
      /** Distância (m) do batedor até a pele do bumbo, no tempo t. */
      beaterGap(t) { pose(t); dirty = true; return style.beaterGap(); },
      /** Quanto a superfície da peça está fora do lugar no tempo t (estilo pelúcia; 0 no manequim). */
      deform(id, t) { pose(t); dirty = true; return style.kit.deform ? style.kit.deform(id) : 0; },
      /** IK alcançou os alvos no tempo t? */
      reached(t) {
        pose(t);
        dirty = true;
        const { arms, legs } = style.rig;
        return { MD: arms.MD.reached, ME: arms.ME.reached, PD: legs.PD.reached, PE: legs.PE.reached };
      },
      info() { return { ...renderer.info.render }; },
      memory() { return { ...renderer.info.memory }; },
      /** Desenha um quadro agora (pra medir draw calls e memória). */
      render() { pose(readTime()); renderer.render(scene, camera); return { ...renderer.info.render }; },
    },
  };
  placeCamera(camName, false);
  return view;
}
