// Laboratório "real × nosso": o baterista da base MMIP (captura de movimento
// sincronizada com MIDI) ao lado do nosso baterista tocando as mesmas notas,
// no mesmo relógio, e as mesmas métricas medidas nos dois.
//
//   /drumsomething/player/lab.html?take=/songs/mmip/01/&style=manequim
//   (a pasta vem de `uv run python tools/mmip.py fetch 1`)

import {
  CircleGeometry, Color, CylinderGeometry, DirectionalLight, HemisphereLight, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PerspectiveCamera, Quaternion, Scene, Vector3, WebGLRenderer,
} from "../vendor/three.module.min.js";
import { OrbitControls } from "../vendor/OrbitControls.js";
import { createEngine } from "../app/audio.js";
import { $, fmt, makeGrid } from "../app/util.js";
import { mountKit3D } from "../kit3d/kit3d.js";
import { themeFor } from "../kit3d/theme.js";
import { loadReal } from "./real.js";
import { HAND_ID, inferSticks } from "./sticks.js";
import { GRIP, SKEL } from "../kit3d/skeleton.js";
import { ROWS, measure } from "./metrics.js";

const params = new URLSearchParams(location.search);
const base = (params.get("take") || "/songs/mmip/01/").replace(/\/?$/, "/");
const FPS = 120;
const CYMBALS = new Set(["hihat", "ride", "crash"]);
const PIECE_OF = { tom1: "tom", tom2: "tom", floor: "tom" };
const FLIP = new Quaternion(1, 0, 0, 0); // ossos gravados girados 180° em x (real.js)

const status = (msg, frac) => {
  $("#loading-text").textContent = msg;
  if (frac !== undefined) $("#loading-bar").style.width = `${Math.round(frac * 100)}%`;
};
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

boot().catch((e) => { console.error(e); status(`Erro: ${e.message}`); });

async function boot() {
  status("carregando a música", 0.05);
  const song = await (await fetch(`${base}song.json`, { cache: "no-store" })).json();
  song.audio = { drums: `${base}audio.wav` };
  $("#title").textContent = song.title;
  $("#meta").textContent = `${Math.round(song.tempo)} BPM · ${song.notes.length} notas · ${song.pedal?.length || 0} pisadas no pedal do chimbal`;
  $("#credit").textContent = song.credit || "";
  const grid = makeGrid(song);
  const engine = createEngine(song, grid);
  engine.setMode("original");

  // ---------- nosso ----------
  let style = ["manequim", "pelucia"].includes(params.get("style")) ? params.get("style") : "manequim";
  // ?moves=0: só o modelo procedural (pra comparar com os golpes do baterista real)
  const ours = mountKit3D($("#ours"), { song, getTime: () => engine.time, style, camera: "frente", legend: false, moves: params.get("moves") !== "0" });

  // ---------- real ----------
  status("carregando o baterista real (FBX, ~20 MB)", 0.15);
  await nextFrame();
  const real = await loadReal(`${base}take.fbx`, (m) => status(m, 0.3));
  status("amostrando o movimento real a 120 Hz", 0.4);
  await nextFrame();
  const S = real.sample(FPS);
  status("inferindo as baquetas e as mãos", 0.55);
  await nextFrame();
  // o MIDI e o movimento têm um atraso diferente em cada gravação: acha e corrige
  const lat = latency(S, inferSticks(S, song.notes));
  const realNotes = song.notes.map((n) => ({ ...n, t: n.t + lat }));
  const sk = inferSticks(S, realNotes);
  const scene = buildRealScene(real, sk, S, lat);

  // ---------- métricas ----------
  status("montando a nossa performance", 0.62);
  const plan = await ours.planReady;
  status("medindo os dois", 0.65);
  await nextFrame();
  const mReal = measure(trackFromReal(S, sk), song.beats);
  const mOurs = measure(trackFromOurs(ours, song.duration), song.beats);
  renderTable(mReal, mOurs);
  const spread = Object.entries(sk.spread).map(([k, v]) => `${k} ${v.cm} cm (${v.n})`).join(" · ");
  const right = sk.strokes.filter((s) => s.hand === 0).length, left = sk.strokes.filter((s) => s.hand === 1).length;
  $("#sticks").textContent = `Atraso do MIDI em relação ao movimento: ${Math.round(lat * 1000)} ms. ` +
    `Baquetas inferidas: espalhamento das pontas por peça ${spread}. ` +
    `Golpes da mão direita ${right}, esquerda ${left}. Comprimento mão→ponta ` +
    `${sk.d.map((v) => Math.round(Math.hypot(...v) * 100)).join(" / ")} cm.`;
  window.LAB = { mReal, mOurs, lat, sk: { spread: sk.spread, d: sk.d, right, left }, plan: plan?.stats || null };

  // ---------- áudio e transporte ----------
  status("carregando o áudio", 0.8);
  await engine.load((p) => status("carregando o áudio", 0.8 + 0.2 * p));
  $("#loading").classList.add("done");
  const play = $("#play"), scrub = $("#scrub");
  play.disabled = false;
  scrub.max = song.duration;
  play.onclick = () => engine.toggle();
  scrub.oninput = () => engine.seek(+scrub.value);
  engine.onChange(() => document.body.classList.toggle("playing", engine.playing));
  addEventListener("keydown", (e) => {
    if (e.key === " ") { e.preventDefault(); engine.toggle(); }
    if (e.key === "ArrowRight") engine.seek(engine.time + 2);
    if (e.key === "ArrowLeft") engine.seek(engine.time - 2);
  });
  $("#styles").onclick = (e) => {
    const s = e.target.dataset.style;
    if (!s) return;
    style = s;
    ours.setStyle(s);
    for (const b of document.querySelectorAll("#styles [data-style]")) b.classList.toggle("on", b.dataset.style === s);
  };
  for (const b of document.querySelectorAll("#styles [data-style]")) b.classList.toggle("on", b.dataset.style === style);

  const loop = () => {
    requestAnimationFrame(loop);
    const t = engine.time;
    scene.draw(t);
    $("#time").textContent = fmt(t, true);
    if (document.activeElement !== scrub) scrub.value = t;
  };
  loop();
}

/**
 * Atraso do movimento em relação ao MIDI (s). No golpe a baqueta bate e volta:
 * um ponto preso na mão, 30 cm à frente do pulso, leva um tranco pra cima. Na
 * média de centenas de golpes alinhados pela nota, o pico do tranco é o golpe.
 */
function latency(S, sk) {
  const lags = [];
  for (let l = -0.5; l <= 0.5; l += 1 / S.fps) lags.push(l);
  const prof = new Float64Array(lags.length), v = new Vector3(), q = new Quaternion();
  for (const h of [0, 1]) {
    const pos = S.pos[HAND_ID[h]], quat = S.quat[HAND_ID[h]], y = new Float32Array(S.n);
    for (let i = 0; i < S.n; i++) {
      q.fromArray(quat, i * 4);
      v.set(0, 0.3, 0).applyQuaternion(q);
      y[i] = pos[i * 3 + 1] + v.y;
    }
    for (const s of sk.strokes) {
      if (s.hand !== h) continue;
      lags.forEach((l, k) => {
        const i = Math.round((s.t + l) * S.fps);
        if (i > 0 && i < S.n - 1) prof[k] += (y[i + 1] - 2 * y[i] + y[i - 1]) * S.fps * S.fps;
      });
    }
  }
  let best = 0;
  for (let k = 1; k < lags.length; k++) if (prof[k] > prof[best]) best = k;
  return lags[best];
}

// ---------- cena do baterista real ----------
function buildRealScene(real, sk, S, lat) {
  const host = $("#real");
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  host.append(renderer.domElement);
  renderer.domElement.style.cssText = "display:block;width:100%;height:100%";
  const scene = new Scene();
  const th = themeFor(false);
  scene.background = new Color("#ece8e1");
  scene.add(new HemisphereLight("#ffffff", "#c9beb0", 1.6));
  const key = new DirectionalLight("#fff4e6", 2.2);
  key.position.set(1.5, 3, 1.2);
  scene.add(key, real.object);

  // peças: discos nos centros inferidos (onde as baquetas caem)
  for (const [inst, c] of Object.entries(sk.pads)) {
    const piece = PIECE_OF[inst] || inst;
    const r = CYMBALS.has(inst) ? 0.17 : 0.13;
    const disc = new Mesh(new CircleGeometry(r, 40), new MeshBasicMaterial({ color: th.piece[piece] || "#888", transparent: true, opacity: 0.55 }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(c[0], c[1] - 0.004, c[2]);
    scene.add(disc);
  }
  // chão
  const floor = new Mesh(new CircleGeometry(2.4, 64), new MeshBasicMaterial({ color: "#e3ddd3" }));
  floor.rotation.x = -Math.PI / 2;
  let footY = Infinity;
  for (const j of ["RightToe", "LeftToe"]) for (let i = 0; i < S.n; i += 60) footY = Math.min(footY, S.pos[j][i * 3 + 1]);
  floor.position.y = footY - 0.03;
  scene.add(floor);

  // baquetas: a mesma pegada do nosso (fulcro e direção fixos na mão)
  const stickMat = new MeshStandardMaterial({ color: "#c79a5e", roughness: 0.6 });
  const sticks = GRIP_REAL.map((g) => {
    const len = SKEL.stickFront + SKEL.stickBack;
    const m = new Mesh(new CylinderGeometry(0.006, 0.0085, len, 10), stickMat);
    scene.add(m);
    return { mesh: m, len, g };
  });

  // câmera: frente-direita do baterista, olhando pro kit (como a "frente" do nosso);
  // o rumo é da pelve pras mãos, na média da música
  const mean = (arr) => { const m = new Vector3(); for (let i = 0; i < S.n; i += 30) m.add(new Vector3(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2])); return m.divideScalar(Math.ceil(S.n / 30)); };
  const hips = mean(S.pos.Hips);
  const hands = mean(S.pos.RightHand).add(mean(S.pos.LeftHand)).multiplyScalar(0.5);
  const fwd = hands.clone().sub(hips).setY(0).normalize();
  const up = new Vector3(0, 1, 0), right = new Vector3().crossVectors(fwd, up).normalize();
  const target = hips.clone().addScaledVector(fwd, 0.2).setY(hips.y + 0.3);
  const camera = new PerspectiveCamera(42, 1, 0.05, 30);
  camera.position.copy(target).addScaledVector(right.clone().multiplyScalar(0.34).addScaledVector(up, 0.56).addScaledVector(fwd, 0.76).normalize(), 2.7);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.update();

  const ro = new ResizeObserver(() => {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  ro.observe(host);

  const q = new Quaternion(), p = new Vector3(), dir = new Vector3(), tip = new Vector3(), Y = new Vector3(0, 1, 0);
  return {
    draw(t) {
      real.setTime(t + lat);
      sticks.forEach((s, h) => {
        const bone = real.bones[HAND_ID[h]];
        bone.getWorldPosition(p);
        bone.getWorldQuaternion(q);
        if (real.flip) q.multiply(FLIP);
        dir.copy(s.g.u).applyQuaternion(q);
        tip.copy(s.g.f).applyQuaternion(q).add(p); // fulcro
        s.mesh.position.copy(tip).addScaledVector(dir, (SKEL.stickFront - SKEL.stickBack) / 2);
        s.mesh.quaternion.setFromUnitVectors(Y, dir);
      });
      controls.update();
      renderer.render(scene, camera);
    },
  };
}

// ---------- trilhas pras métricas ----------
function put(arr, i, v) { arr[i * 3] = v.x ?? v[0]; arr[i * 3 + 1] = v.y ?? v[1]; arr[i * 3 + 2] = v.z ?? v[2]; }

/**
 * Baqueta do real com a mesma pegada do nosso (skeleton.js): fulcro e direção
 * fixos no espaço da mão. Assim os dois lados são medidos do mesmo jeito.
 */
const GRIP_REAL = [0, 1].map((h) => {
  const s = h === 0 ? 1 : -1, u = new Vector3(GRIP.dir[0] * s, GRIP.dir[1], GRIP.dir[2]).normalize();
  return { f: new Vector3(GRIP.fulcrum[0] * s, GRIP.fulcrum[1], GRIP.fulcrum[2]), u };
});
function gripTip(S, h, i, out = new Vector3()) {
  const q = new Quaternion().fromArray(S.quat[HAND_ID[h]], i * 4), g = GRIP_REAL[h];
  return out.copy(g.u).multiplyScalar(SKEL.stickFront).add(g.f).applyQuaternion(q)
    .add(new Vector3().fromArray(S.pos[HAND_ID[h]], i * 3));
}

function trackFromReal(S, sk) {
  const n = S.n, arr = () => new Float32Array(n * 3);
  const tr = {
    fps: S.fps, n, tip: [arr(), arr()],
    wrist: [S.pos.RightHand, S.pos.LeftHand], elbow: [S.pos.RightForeArm, S.pos.LeftForeArm],
    chest: S.pos.Spine3, head: S.pos.Head,
    strokes: [[], []],
  };
  const out = new Vector3();
  for (let i = 0; i < n; i++) for (const h of [0, 1]) put(tr.tip[h], i, gripTip(S, h, i, out));
  for (const s of sk.strokes) if (s.hand >= 0) tr.strokes[s.hand].push({ t: s.t, vel: s.vel, inst: s.inst });
  return tr;
}

function trackFromOurs(view, duration) {
  const n = Math.floor(duration * FPS), arr = () => new Float32Array(n * 3);
  const tr = { fps: FPS, n, tip: [arr(), arr()], wrist: [arr(), arr()], elbow: [arr(), arr()], chest: arr(), head: arr(), strokes: [[], []] };
  const dbg = view._debug;
  for (let i = 0; i < n; i++) {
    dbg.pose(i / FPS);
    const rig = dbg.rig, P = rig.skel.pos, at = (name) => P[rig.skel.bone[name]];
    ["MD", "ME"].forEach((l, h) => {
      put(tr.tip[h], i, dbg.avatar.tipWorld(l));
      put(tr.wrist[h], i, rig.arms[l].wrist);
      put(tr.elbow[h], i, rig.arms[l].elbow);
    });
    // mesmas juntas do real: peito (Spine3) e base do crânio (Head)
    put(tr.chest, i, at("chest"));
    put(tr.head, i, at("head"));
  }
  const prep = dbg.prep;
  ["MD", "ME"].forEach((l, h) => { tr.strokes[h] = prep.limbs[l].map((s) => ({ t: s.t, vel: s.vel, inst: s.inst })); });
  return tr;
}

// ---------- tabela ----------
function renderTable(real, ours) {
  const rows = ROWS.map(([label, get, unit, dec]) => {
    const a = get(real), b = get(ours);
    const fmtv = (x) => (Number.isFinite(x) ? x.toFixed(dec) : "—");
    let cls = "", ratio = "";
    if (Number.isFinite(a) && Number.isFinite(b)) {
      if (unit === "ms") {
        const diff = b - a;
        ratio = `${diff > 0 ? "+" : ""}${diff.toFixed(0)} ms`;
        cls = Math.abs(diff) <= 15 ? "ok" : Math.abs(diff) <= 40 ? "meh" : "bad";
      } else if (Math.abs(a) > 1e-6) {
        const r = b / a;
        ratio = `${r.toFixed(2)}×`;
        const l = Math.abs(Math.log(Math.max(r, 1e-6)));
        cls = r <= 0 ? "bad" : l <= Math.log(1.25) ? "ok" : l <= Math.log(1.6) ? "meh" : "bad";
      }
    }
    return `<tr class="${cls}"><th>${label}</th><td>${fmtv(a)} <small>${unit}</small></td><td>${fmtv(b)} <small>${unit}</small></td><td>${ratio}</td></tr>`;
  });
  $("#metrics").innerHTML = `<thead><tr><th></th><th>Real</th><th>Nosso</th><th>Nosso ÷ real</th></tr></thead><tbody>${rows.join("")}</tbody>`;
}
