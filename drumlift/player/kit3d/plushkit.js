// Kit do estilo pelúcia: cascos de feltro estufados nas cores das peças, com o
// aro arredondado fazendo parte do mesmo torno (sem argola solta), peles
// creme com costura, pratos de feltro dourado, estantes de corda grossa e
// sombras borradas no chão. Mesmos frames e pontos de contato do kit do
// manequim (pieces.js); no golpe a pele afunda, o casco amassa e o prato
// balança molenga, voltando ao lugar antes do golpe seguinte.
//
// Tudo o que é opaco sai num draw call só: uma SkinnedMesh em que cada parte
// que se mexe (corpo e pele de cada tambor, prato, pedal, batedor) é um osso e
// cada vértice aponta pra uma cor da tabela (felt.js). As sombras são outra
// malha e os anéis de antecipação uma InstancedMesh.

import {
  Bone, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DoubleSide, Group, InstancedBufferAttribute,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Object3D, Quaternion, RingGeometry, Skeleton, SkinnedMesh,
  SphereGeometry, TorusGeometry, Vector3,
} from "../vendor/three.module.min.js";
import { CONTACTS, CYMBALS, DRUMS, HIHAT_PEDAL, KICK, KICK_PEDAL, THRONE } from "./layout.js";
import { beaterAngle, cymbalProfile, pedalAngle, placeFrame, standRods } from "./pieces.js";
import { INSTANCE_PIECE, upperBound } from "./timeline.js";
import { flash, footPress, hihatFoot } from "./motion.js";
import { cymbalSwing, softWobble } from "./plushmotion.js";
import { RINGS_PER_PIECE } from "./rings.js";
import { plushMaterial, setSlot, setSlotEmissive } from "./felt.js";
import { cushionProfile, ellipsoid, lathe, mergeSkinned, pillow, stitchGeometry, stitchLine } from "./shapes.js";

const UP = new Vector3(0, 1, 0);
// Prato molenga: amplitude (rad), amortecimento (s), frequência (Hz). O crash
// balança largo e demorado; o ride, pesado, pouco; o chimbal fechado só treme.
const FLOP = {
  crash: { amp: 0.17, tau: 0.75, freq: 1.45 },
  ride: { amp: 0.06, tau: 0.6, freq: 1.9 },
  hihat: { amp: 0.026, tau: 0.13, freq: 4.2 },
};
// direção (no plano do prato) de onde a baqueta costuma bater: a da mão direita
const HIT_DIR = Object.fromEntries(Object.keys(FLOP).map((id) => {
  const [x, z] = CONTACTS[id].MD, l = Math.hypot(x, z) || 1;
  return [id, [x / l, z / l]];
}));
const swing = [0, 0];
const SQUASH = { tau: 0.07, freq: 5.5, dip: 0.007 }; // dip: quanto a pele desce (m) num golpe forte
const CYM_T = 0.009; // espessura do prato de feltro

const DRUM_IDS = ["snare", "tom1", "tom2", "floor", "kick"];
const CYM_IDS = ["hihat", "crash", "ride"];
// slots da paleta
const SL = {};
DRUM_IDS.forEach((id, i) => { SL[`shell_${id}`] = i * 3; SL[`hoop_${id}`] = i * 3 + 1; SL[`head_${id}`] = i * 3 + 2; });
CYM_IDS.forEach((id, i) => { SL[`gold_${id}`] = 15 + i * 2; SL[`accent_${id}`] = 16 + i * 2; });
Object.assign(SL, { rope: 21, pad: 22, seat: 23, ball: 24, thread: 25 });
const SLOTS = 26;

// Altura da face de cima do prato: cúpula suave até ρ = 0.07 e depois o mesmo
// arco reto do perfil lógico, onde as baquetas encostam.
function cymbalTop(r, rho) {
  const prof = cymbalProfile(r), [r3, y3] = prof[3], [r4, y4] = prof[4];
  if (rho >= r3) return y3 + ((rho - r3) / (r4 - r3)) * (y4 - y3);
  const u = rho / r3;
  return y3 + (prof[0][1] - y3) * Math.pow(0.5 + 0.5 * Math.cos(Math.PI * u), 1.15);
}

function cymbalBodyProfile(r) {
  // de baixo pra cima: centro de baixo -> borda -> volta por cima até o centro
  const pts = [], n = 10;
  const rhoAt = (k) => r * Math.pow(k / n, 0.85);
  for (let k = 0; k <= n; k++) { const rho = rhoAt(k) * 0.985; pts.push([rho, cymbalTop(r, rho) - CYM_T]); }
  const [re, ye] = [r * 0.985, cymbalTop(r, r * 0.985)];
  for (let k = 1; k < 4; k++) {
    const a = -Math.PI / 2 + (k / 4) * Math.PI;
    pts.push([re + (CYM_T / 2) * Math.cos(a), ye - CYM_T / 2 + (CYM_T / 2) * Math.sin(a)]);
  }
  for (let k = n; k >= 0; k--) { const rho = rhoAt(k) * 0.985; pts.push([rho, cymbalTop(r, rho)]); }
  pts[0][0] = 0;
  pts[pts.length - 1][0] = 0;
  return pts;
}

/** Arco de círculo no perfil (ângulos em graus, 0 = pra fora, 90 = pra cima). */
function bead(pts, cx, cy, rad, a0, a1, slot, n = 8) {
  for (let k = 0; k <= n; k++) {
    const a = ((a0 + ((a1 - a0) * k) / n) * Math.PI) / 180;
    pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a), slot]);
  }
}

/**
 * Casco + aros num torno só (y = 0 no plano da pele, casco até -depth): fundo,
 * aro de baixo, casco estufado, aro de cima por cima da borda da pele.
 */
function drumProfile(r, depth, { bottom, hoop, shell }, beadR = 0.0125, topR = 0.0135) {
  const pts = [], yb = -depth - 0.002;
  for (const f of [0, 0.45, 0.75, 0.9]) pts.push([r * f, yb - 0.004 * (1 - f * f), bottom]);
  bead(pts, r + 0.002, -depth + beadR - 0.001, beadR, -120, 95, hoop);
  for (let k = 1; k <= 7; k++) {
    const u = k / 8;
    pts.push([r + 0.006 + 0.005 * Math.sin(Math.PI * u), -depth + 2 * beadR + (depth - 2 * beadR - 0.016) * u, shell]);
  }
  bead(pts, r + 0.001, -0.001, topR, -95, 215, hoop, 12);
  return pts;
}

/** Pele: do lado de dentro do aro até o centro, bem pouco abaulada. */
const headProfile = (r, slot) => [[r * 0.975, -0.009, slot], [r * 0.958, -0.0025, slot], [r * 0.92, 0.0004, slot], [r * 0.5, 0.0006, slot], [0, 0.0006, slot]];

// Cilindro aberto com coordenada de corda (uma volta em u, hélice a ~50°).
function ropeGeometry(r, len) {
  const g = new CylinderGeometry(r, r, len, 8, Math.max(1, Math.round(len / 0.09)), true);
  const uv = g.attributes.uv, k = len / (0.56 * 2 * Math.PI * r), puv = new Float32Array(uv.count * 2);
  for (let i = 0; i < uv.count; i++) { puv[i * 2] = uv.getX(i); puv[i * 2 + 1] = uv.getY(i) * k; }
  g.setAttribute("puv", new BufferAttribute(puv, 2));
  return g;
}

export function createPlushKit() {
  const group = new Group();
  group.name = "kit-pelucia";
  const bones = [];
  const bone = (parent) => { const b = new Bone(); parent.add(b); bones.push(b); return b; };
  const root = bone(group);
  const frameOf = (id) => { const f = placeFrame(id, new Group()); group.add(f); return f; };
  const parts = [];
  const add = (geo, b, slot) => { parts.push({ geo, bone: bones.indexOf(b), slot, local: true, owner: b }); return geo; };
  const inst = {};
  const rings = [];

  // costura em volta de um círculo no plano y = h
  const ringStitches = (r, y) => stitchGeometry(stitchLine((s, P, N) => {
    const a = s * Math.PI * 2;
    P.set(r * Math.cos(a), y, r * Math.sin(a));
    N.set(0, 1, 0);
    return P;
  }, 2 * Math.PI * r, [], { closed: true }));

  // ---------- tambores ----------
  for (const [id, d] of Object.entries(DRUMS)) {
    const frame = frameOf(id);
    const squash = new Group(); // apoiado no fundo: no golpe o topo desce
    squash.position.y = -d.depth;
    frame.add(squash);
    const body = bone(squash);
    body.position.y = d.depth;
    const head = bone(body);
    const s = { bottom: SL[`shell_${id}`], hoop: SL[`hoop_${id}`], shell: SL[`shell_${id}`] };
    add(lathe(drumProfile(d.r, d.depth, s), 44), body);
    add(lathe(headProfile(d.r, SL[`head_${id}`]), 44), head);
    for (const g of ringStitches(d.r * 0.86, 0.0009)) add(g, head, SL.thread);
    inst[id] = { id, kind: "drum", piece: INSTANCE_PIECE[id], frame, squash, head, depth: d.depth };
    rings.push({ id, frame, r: d.r, y: 0.016 });
  }

  // ---------- bumbo ----------
  {
    const frame = frameOf("kick"); // y local = pro baterista
    const squash = new Group(); // apoiado na pele da frente: no golpe a de trás afunda
    squash.position.y = -KICK.depth;
    frame.add(squash);
    const body = bone(squash);
    body.position.y = KICK.depth;
    const batter = bone(body);
    const s = { bottom: SL.head_kick, hoop: SL.hoop_kick, shell: SL.shell_kick };
    add(lathe(drumProfile(KICK.r, KICK.depth, s, 0.02, 0.02), 48), body);
    add(lathe(headProfile(KICK.r, SL.head_kick), 48), batter);
    for (const g of ringStitches(KICK.r * 0.88, 0.0009)) add(g, batter, SL.thread);
    // pele da frente: costura e patinha (almofada + 4 dedos) pra quem olha de frente
    const yf = -KICK.depth - 0.0062, ys = -KICK.depth - 0.002 - 0.004 * (1 - 0.88 * 0.88) - 0.0006;
    for (const g of ringStitches(KICK.r * 0.88, 0)) add(g.rotateX(Math.PI).translate(0, ys, 0), body, SL.thread);
    const pad = (x, z, rx, rz) => add(ellipsoid(rx, 0.006, rz, 20, 8).translate(x, yf, -z), body, SL.hoop_kick);
    pad(0, 0.045, 0.072, 0.058);
    for (const [x, z, k] of [[-0.085, -0.03, 0.026], [-0.032, -0.075, 0.028], [0.032, -0.075, 0.028], [0.085, -0.03, 0.026]]) {
      pad(x, z, k, k * 1.15);
    }
    inst.kick = { id: "kick", kind: "kick", piece: "kick", frame, squash, head: batter, depth: KICK.depth };
    rings.push({ id: "kick", frame, r: KICK.r, y: 0.032 });
  }

  // ---------- pratos ----------
  for (const [id, c] of Object.entries(CYMBALS)) {
    const frame = frameOf(id);
    const pivot = bone(frame); // balanço
    const flop = bone(pivot);  // borda molenga (escala em y)
    const gold = SL[`gold_${id}`], accent = SL[`accent_${id}`];
    const bodyPts = cymbalBodyProfile(c.r);
    add(lathe(bodyPts, 44, gold), flop);
    // cúpula e borda na cor da peça
    const bell = [];
    for (let k = 0; k <= 8; k++) {
      const rho = 0.058 * (1 - k / 8);
      bell.push([rho, cymbalTop(c.r, rho) + 0.0016 - (k === 0 ? 0.003 : 0)]);
    }
    bell[bell.length - 1][0] = 0;
    add(lathe(bell, 32, accent), flop);
    add(new TorusGeometry(c.r * 0.985, 0.0068, 6, 44).rotateX(Math.PI / 2).translate(0, cymbalTop(c.r, c.r) - CYM_T / 2, 0), flop, accent);
    const rs = c.r - 0.032;
    for (const g of ringStitches(rs, cymbalTop(c.r, rs) + 0.0003)) add(g, flop, SL.thread);
    if (id === "hihat") add(lathe(bodyPts, 44, gold).rotateX(Math.PI).translate(0, -0.03, 0), pivot);
    inst[id] = { id, kind: "cymbal", piece: INSTANCE_PIECE[id], frame, pivot, flop };
    rings.push({ id, frame, r: c.r, y: 0.006 });
  }

  // ---------- estantes de corda ----------
  {
    const f = new Object3D(), a = new Vector3(), b = new Vector3(), q = new Quaternion(), m = new Matrix4(), s = new Vector3();
    for (const rod of standRods()) {
      a.set(...rod.a); b.set(...rod.b);
      if (rod.frame) { placeFrame(rod.frame, f); a.applyMatrix4(f.matrix); b.applyMatrix4(f.matrix); }
      const r = Math.max(0.0075, rod.r * 1.55), len = a.distanceTo(b);
      const g = ropeGeometry(r, len);
      q.setFromUnitVectors(UP, s.subVectors(b, a).normalize());
      m.compose(a.clone().add(b).multiplyScalar(0.5), q, new Vector3(1, 1, 1));
      add(g.applyMatrix4(m), root, SL.rope);
      if (rod.foot) {
        const knot = new SphereGeometry(r * 1.9, 10, 6);
        const uv = knot.attributes.uv, puv = new Float32Array(uv.count * 2);
        for (let i = 0; i < uv.count; i++) { puv[i * 2] = uv.getX(i); puv[i * 2 + 1] = uv.getY(i) * 0.6; }
        knot.setAttribute("puv", new BufferAttribute(puv, 2));
        add(knot.translate(b.x, Math.max(r * 1.9 * 0.8, b.y), b.z), root, SL.rope);
      }
    }
  }

  // ---------- pedal do bumbo ----------
  const P = KICK_PEDAL;
  const kickBoard = bone(group);
  kickBoard.position.set(...P.hinge);
  add(pillow(0.088, 0.022, P.length, 4).translate(0, 0.011, -P.length / 2), kickBoard, SL.pad);
  add(pillow(0.115, 0.014, 0.36, 4).translate(P.hinge[0], 0.007, P.hinge[2] - 0.17), root, SL.pad);
  const beater = bone(group);
  beater.position.set(...P.beaterPivot);
  add(ropeGeometry(0.0065, P.beaterLen).translate(0, P.beaterLen / 2, 0), beater, SL.rope);
  add(ellipsoid(P.feltR, P.feltR, P.feltR, 20, 14).translate(0, P.beaterLen, 0), beater, SL.ball);

  // ---------- pedal do chimbal ----------
  const hhBoard = bone(group);
  hhBoard.position.set(...HIHAT_PEDAL.hinge);
  hhBoard.rotation.x = HIHAT_PEDAL.angle;
  add(pillow(0.084, 0.022, HIHAT_PEDAL.length, 4).translate(0, 0.011, -HIHAT_PEDAL.length / 2), hhBoard, SL.pad);

  // ---------- banco: almofada redonda com costura ----------
  {
    const top = THRONE.pos[1], r = THRONE.r + 0.025, y0 = top - 0.1, mid = (y0 + top) / 2;
    add(lathe(cushionProfile(r, y0, top, 3.2, 18), 40, SL.seat).translate(THRONE.pos[0], 0, THRONE.pos[2]), root);
    for (const g of stitchGeometry(stitchLine((s, Pt, N) => {
      const a = s * Math.PI * 2;
      N.set(Math.cos(a), 0, Math.sin(a));
      return Pt.set(r * Math.cos(a), mid, r * Math.sin(a)).addScaledVector(N, 0.0005);
    }, 2 * Math.PI * r, [], { closed: true }))) add(g.translate(THRONE.pos[0], 0, THRONE.pos[2]), root, SL.thread);
  }

  // ---------- tudo numa SkinnedMesh ----------
  group.updateMatrixWorld(true);
  for (const p of parts) p.geo.applyMatrix4(p.owner.matrixWorld); // pose de repouso, no mundo
  const geo = mergeSkinned(parts);
  const mat = plushMaterial("palette", { slots: SLOTS, rope: SL.rope, sheen: 0.8, sheenMix: 0.45 });
  const skeleton = new Skeleton(bones, bones.map((b) => b.matrixWorld.clone().invert()));
  const mesh = new SkinnedMesh(geo, mat);
  mesh.name = "kit-pelucia-feltro";
  mesh.frustumCulled = false;
  mesh.bind(skeleton, new Matrix4());
  group.add(mesh);

  // ---------- sombras borradas no chão (uma malha) ----------
  const cymFoot = (id) => { const f = placeFrame(id, new Object3D()); return [f.position.x, f.position.z]; };
  const blobs = [
    [0.08, -0.22, 2.7, 2.3, 0], [0.02, 0.2, 1.2, 1.1, 0],
    [THRONE.pos[0], THRONE.pos[2] + 0.02, 0.78, 0.74, 1],
    [KICK.pos[0], KICK.pos[2] - KICK.depth / 2, 0.82, 0.62, 1],
    [DRUMS.floor.pos[0], DRUMS.floor.pos[2], 0.6, 0.6, 1],
    [DRUMS.snare.pos[0], DRUMS.snare.pos[2], 0.5, 0.5, 1],
    [...cymFoot("hihat"), 0.5, 0.5, 1], [...cymFoot("crash"), 0.55, 0.55, 1], [...cymFoot("ride"), 0.58, 0.58, 1],
    [P.hinge[0], P.hinge[2] - 0.14, 0.28, 0.5, 1], [HIHAT_PEDAL.hinge[0], HIHAT_PEDAL.hinge[2] - 0.12, 0.26, 0.45, 1],
  ];
  const shadowGeo = new BufferGeometry();
  {
    const pos = [], uv = [], kind = [], idx = [];
    blobs.forEach(([x, z, sx, sz, k], i) => {
      const y = k ? 0.0016 + i * 0.0001 : 0.001 + i * 0.0001;
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        pos.push(x + (u * sx) / 2, y, z + (v * sz) / 2);
        uv.push(u, v);
        kind.push(k);
      }
      const o = i * 4;
      idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
    });
    shadowGeo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    shadowGeo.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
    shadowGeo.setAttribute("kind", new BufferAttribute(new Float32Array(kind), 1));
    shadowGeo.setIndex(idx);
  }
  const shadowU = { uSoft: { value: 0.2 }, uHard: { value: 0.34 } };
  const shadowMat = new MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false });
  shadowMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shadowU);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float kind;\nvarying vec3 vSh;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSh = vec3(uv, kind);");
    // mancha radial: mesmo perfil da sombra borrada de antes (e^(-3,9 r²))
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSh;\nuniform float uSoft;\nuniform float uHard;")
      .replace("vec4 diffuseColor = vec4( diffuse, opacity );",
        "float rr = dot(vSh.xy, vSh.xy);\nvec4 diffuseColor = vec4( diffuse, mix(uSoft, uHard, vSh.z) * exp(-3.93 * rr) * (1.0 - smoothstep(0.72, 1.0, rr)) );");
  };
  shadowMat.customProgramCacheKey = () => "plush-shadow";
  const shadows = new Mesh(shadowGeo, shadowMat);
  shadows.name = "kit-pelucia-sombras";
  shadows.renderOrder = -1;
  group.add(shadows);

  // ---------- anéis de antecipação (uma InstancedMesh) ----------
  const ringGeo = new RingGeometry(0.93, 1, 48, 1);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMax = rings.length * RINGS_PER_PIECE;
  const ringMat = new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
  const ringAlpha = new InstancedBufferAttribute(new Float32Array(ringMax), 1);
  ringGeo.setAttribute("ringAlpha", ringAlpha);
  ringMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float ringAlpha;\nvarying float vRingAlpha;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRingAlpha = ringAlpha;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vRingAlpha;")
      .replace("vec4 diffuseColor = vec4( diffuse, opacity );", "vec4 diffuseColor = vec4( diffuse, opacity * vRingAlpha );");
  };
  ringMat.customProgramCacheKey = () => "plush-rings";
  const ringMesh = new InstancedMesh(ringGeo, ringMat, ringMax);
  ringMesh.name = "kit-pelucia-aneis";
  ringMesh.count = 0;
  ringMesh.renderOrder = 2;
  ringMesh.frustumCulled = false;
  ringMesh.setColorAt(0, new Color(1, 1, 1));
  group.add(ringMesh);
  for (const rg of rings) { rg.frame.updateMatrixWorld(true); rg.matrix = rg.frame.matrixWorld.clone(); }

  // ---------- cores ----------
  const colors = { piece: {}, accent: {}, head: new Color(), bg: new Color(), gold: new Color() };
  const tmpC = new Color(), black = new Color(0, 0, 0);
  let muted = new Set();
  function paint(theme) {
    setSlot(mat, SL.rope, theme.rope);
    setSlot(mat, SL.pad, theme.pad);
    setSlot(mat, SL.seat, theme.seat);
    setSlot(mat, SL.ball, theme.head);
    setSlot(mat, SL.thread, theme.thread, 0.85);
    shadowMat.color.set(theme.shadow);
    shadowU.uSoft.value = theme.shadowSoft;
    shadowU.uHard.value = theme.shadowHard;
    colors.head.set(theme.head);
    colors.bg.set(theme.bg);
    colors.gold.set(theme.gold);
    for (const [k, v] of Object.entries(theme.piece)) colors.piece[k] = new Color(v);
    for (const [k, v] of Object.entries(theme.accent)) colors.accent[k] = new Color(v);
    applyMuted();
  }
  function applyMuted() {
    for (const it of Object.values(inst)) {
      const c = colors.piece[it.piece];
      if (!c) continue;
      const m = muted.has(it.piece);
      if (it.kind === "cymbal") {
        setSlot(mat, SL[`gold_${it.id}`], tmpC.copy(colors.gold).lerp(colors.bg, m ? 0.6 : 0), 0.86);
        setSlot(mat, SL[`accent_${it.id}`], tmpC.copy(colors.accent[it.piece]).lerp(colors.bg, m ? 0.78 : 0));
      } else {
        setSlot(mat, SL[`shell_${it.id}`], tmpC.copy(c).lerp(colors.bg, m ? 0.78 : 0));
        setSlot(mat, SL[`hoop_${it.id}`], tmpC.copy(c).multiplyScalar(0.8).lerp(colors.bg, m ? 0.78 : 0));
        setSlot(mat, SL[`head_${it.id}`], tmpC.copy(colors.head).lerp(colors.bg, m ? 0.7 : 0));
      }
    }
  }

  // ---------- animação ----------
  const ringM = new Matrix4(), ringS = new Matrix4();
  function update(t, prep, anticipation) {
    let shown = 0;
    for (const it of Object.values(inst)) {
      const hits = prep.instHits[it.id] || [];
      const c = colors.piece[it.piece];
      const isMuted = muted.has(it.piece);
      const f = isMuted ? 0 : flash(hits, t);
      if (it.kind === "cymbal") {
        setSlotEmissive(mat, SL[`gold_${it.id}`], c || black, 0.22 * f);
        setSlotEmissive(mat, SL[`accent_${it.id}`], c || black, 0.3 * f);
        const fl = FLOP[it.id];
        cymbalSwing(hits, t, fl, HIT_DIR[it.id], swing);
        it.pivot.rotation.set(swing[0], 0, swing[1]);
        it.flop.scale.y = 1 + softWobble(hits, t, 0.45, fl.tau * 0.45, fl.freq * 2.4, 0.1);
      } else {
        if (!isMuted && c) setSlot(mat, SL[`head_${it.id}`], tmpC.copy(colors.head).lerp(c, 0.35 * f));
        setSlotEmissive(mat, SL[`head_${it.id}`], c || black, 0.2 * f);
        // pele afunda e casco amassa (squash and stretch), parado de novo no próximo golpe
        const q = softWobble(hits, t, 1, SQUASH.tau, SQUASH.freq, 0.1);
        const k = (SQUASH.dip / it.depth) * q;
        it.squash.scale.set(1 + 0.6 * k, 1 - k, 1 + 0.6 * k);
        it.head.position.y = -0.003 * Math.max(0, q);
      }
      // anéis: os próximos golpes até 1 tempo à frente
      if (anticipation && !isMuted && c) {
        const len = prep.clock.beatLen(t), rg = rings.find((x) => x.id === it.id);
        for (let j = upperBound(hits, t), n = 0; j < hits.length && n < RINGS_PER_PIECE; j++, n++) {
          const dt = hits[j].t - t;
          if (dt > len) break;
          const u = dt / len, sc = rg.r * (1 + 1.4 * u);
          ringM.copy(rg.matrix).multiply(ringS.makeTranslation(0, rg.y, 0)).multiply(ringS.makeScale(sc, sc, sc));
          ringMesh.setMatrixAt(shown, ringM);
          ringMesh.setColorAt(shown, c);
          ringAlpha.array[shown] = 0.9 * (1 - u) + 0.08;
          shown++;
        }
      }
    }
    ringMesh.count = shown;
    if (shown) {
      ringMesh.instanceMatrix.needsUpdate = true;
      ringMesh.instanceColor.needsUpdate = true;
      ringAlpha.needsUpdate = true;
    }
    const p = footPress(prep.limbs.PD, t);
    kickBoard.rotation.x = pedalAngle(p);
    beater.rotation.x = beaterAngle(p);
    hhBoard.rotation.x = HIHAT_PEDAL.angle - HIHAT_PEDAL.travel * hihatFoot(prep, t, hhState).press;
    return p;
  }
  const hhState = { press: 0, tap: 0 };

  function setMuted(set) { muted = new Set(set || []); applyMuted(); }

  /** Debug: distância (m) da frente do batedor até a pele do bumbo. */
  function beaterGap() {
    beater.updateMatrixWorld(true);
    const w = new Vector3(0, P.beaterLen, 0).applyMatrix4(beater.matrixWorld);
    return w.z - P.feltR - KICK.pos[2];
  }
  /** Debug: quanto a superfície da peça está fora do lugar agora (m ou rad). */
  function deform(id) {
    const it = inst[id];
    if (it.kind === "cymbal") return Math.abs(it.pivot.rotation.x) + Math.abs(it.pivot.rotation.z) + Math.abs(it.flop.scale.y - 1) * 0.02;
    return Math.abs(it.depth * (1 - it.squash.scale.y)) + Math.abs(it.head.position.y);
  }

  return {
    group, inst, update, paint, setMuted, beaterGap, deform,
    dispose() {
      geo.dispose(); mat.dispose(); skeleton.dispose();
      shadowGeo.dispose(); shadowMat.dispose();
      ringGeo.dispose(); ringMat.dispose(); ringMesh.dispose();
    },
  };
}
