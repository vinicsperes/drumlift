// Baterista do estilo pelúcia: um gato humanoide de feltro ("corpo de gente,
// pele de gato") vestindo o mesmo esqueleto do manequim (rig.js).
//
// O corpo inteiro (cabeça, orelhas, tronco, braços, patas, pernas, rabo) é uma
// malha contínua e fechada (catbody.js), desenhada como SkinnedMesh: os ossos
// seguem as juntas que o IK decide (catrig.js) e a superfície dobra nas
// juntas sem emenda. Os detalhes pequenos (olhos de botão, nariz, boca,
// bigodes, lado de dentro das orelhas, feijõezinhos, pulseiras, costuras e
// baquetas) ficam presos aos mesmos ossos e saem todos num draw call só.

import {
  Bone, BufferAttribute, BufferGeometry, Group, LatheGeometry, Matrix4, Mesh, OctahedronGeometry, Quaternion, Skeleton,
  SkinnedMesh, SphereGeometry, TorusGeometry, Uint16BufferAttribute, Vector2, Vector3,
} from "../vendor/three.module.min.js";
import { BODY } from "./layout.js";
import { FEET, HANDS } from "./rig.js";
import { B, EARS, EYE_C, createCatBones } from "./catrig.js";
import { catBody, projectToBody, rayToBody } from "./catbody.js";
import { CAT_PALETTES, plushMaterial, setSlot, setSlotEmissive } from "./felt.js";
import { basis, ellipsoid as shapeEllipsoid, mergeSkinned, thread as shapeThread } from "./shapes.js";

const v3 = (x, y, z) => new Vector3(x, y, z);
const UP = v3(0, 1, 0);

// slots da paleta dos detalhes
const S = { eye: 0, glint: 1, nose: 2, lining: 3, thread: 4, bean: 5, stick: 6, MD: 7, ME: 8, PD: 9, PE: 10, rim: 11 };
const SLOTS = 12;

const ellipsoid = (rx, ry, rz, w = 14, h = 10) => shapeEllipsoid(rx, ry, rz, w, h);
const thread = (pts, r, segs = 0, radial = 5) => shapeThread(pts, r, { segs, radial });

/**
 * Junta os detalhes numa geometria com slot e skin. Parte: { geo (pose de
 * ligação, mundo), slot, bone } ou { ..., at } — `at` = ponto de onde a parte
 * copia os pesos do corpo (assim ela anda junto com a superfície embaixo).
 */
function mergeParts(parts, body) {
  const wi = new Uint16Array(4), ww = new Float32Array(4);
  for (const p of parts) {
    if (!p.at) continue;
    body.skinAt(p.at, wi, ww);
    p.bones = Array.from(wi);
    p.weights = Array.from(ww);
  }
  return mergeSkinned(parts);
}

/** Detalhes do gato na pose de ligação (mundo). */
function buildDetails(body) {
  const { bind, joints } = body;
  const parts = [];
  const head = bind[B.cabeca];
  const H = (x, y, z) => v3(x, y, z).applyMatrix4(head);
  const N = new Vector3();
  const onBody = (p, n = N) => projectToBody(body, p.clone(), n);
  // ponto do rosto: raio saindo de dentro da cabeça na direção de (x, y, z) local
  const headC = H(0, 0.1, -0.02);
  const onFace = (x, y, z, n = N) => rayToBody(body, headC, H(x, y, z).sub(headC), n);
  const headN = new Matrix4().extractRotation(head);
  const fwd = v3(0, 0, -1).applyMatrix4(headN), headUp = v3(0, 1, 0).applyMatrix4(headN);
  const bodyStitches = [], headStitches = [];

  // ---------- olhos de botão (osso dos olhos, que pisca) ----------
  for (const s of [1, -1]) {
    const P = onFace(0.052 * s, EYE_C.y, -0.2);
    const n = N.clone();
    const m = basis(P.clone().addScaledVector(n, 0.0042), n, headUp);
    const btn = ellipsoid(0.02, 0.02, 0.0085, 20, 14).applyMatrix4(m);
    parts.push({ geo: btn, slot: S.eye, bone: B.olhos });
    const rim = new TorusGeometry(0.0175, 0.0026, 6, 24).applyMatrix4(m.clone().multiply(new Matrix4().makeTranslation(0, 0, -0.004)));
    parts.push({ geo: rim, slot: S.rim, bone: B.olhos });
    const g1 = ellipsoid(0.0052, 0.0052, 0.0027, 10, 8).translate(-0.0067 * s, 0.0072, -0.0078).applyMatrix4(m);
    const g2 = ellipsoid(0.0022, 0.0022, 0.0015, 8, 6).translate(0.0072 * s, -0.006, -0.0075).applyMatrix4(m);
    parts.push({ geo: g1, slot: S.glint, bone: B.olhos }, { geo: g2, slot: S.glint, bone: B.olhos });
  }

  // ---------- nariz, boca e bigodes (cabeça) ----------
  const puff = (s) => H(0.031 * s, 0.064, -0.12); // centro das almofadas do focinho
  const noseP = onFace(0, 0.093, -0.2);
  const noseN = N.clone();
  {
    const g = new SphereGeometry(1, 18, 12);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y01 = (p.getY(i) + 1) / 2;
      p.setXYZ(i, p.getX(i) * 0.018 * (0.4 + 0.6 * y01), p.getY(i) * 0.0118, p.getZ(i) * 0.0105);
    }
    g.computeVertexNormals();
    g.applyMatrix4(basis(noseP.clone().addScaledVector(noseN, 0.002), noseN, headUp));
    parts.push({ geo: g, slot: S.nose, bone: B.cabeca });
  }
  {
    const lift = (q) => { const n = new Vector3(); const r = onBody(q, n); return r.addScaledVector(n, 0.0007); };
    const top = lift(noseP.clone().addScaledVector(headUp, -0.011));
    const valley = (() => { const n = new Vector3(); return onFace(0, 0.052, -0.2, n).addScaledVector(n, 0.0007); })();
    parts.push({ geo: thread([top, top.clone().lerp(valley, 0.5), valley], 0.0012), slot: S.thread, bone: B.cabeca });
    for (const s of [1, -1]) {
      const c = puff(s), pts = [valley];
      for (const b of [0.45, 0.95, 1.45, 1.95, 2.35]) {
        pts.push(lift(c.clone().add(v3(-s * Math.cos(b) * 0.03, -Math.sin(b) * 0.026, 0).applyMatrix4(headN)).addScaledVector(fwd, 0.03)));
      }
      parts.push({ geo: thread(pts, 0.0011), slot: S.thread, bone: B.cabeca });
      for (const [k, dy] of [[0, 0.012], [1, 0], [2, -0.011]]) {
        const s0 = lift(c.clone().add(v3(s * 0.03, 0.006 - 0.008 * k, -0.012).applyMatrix4(headN)));
        const out = v3(s, 0, 0.1).applyMatrix4(headN).normalize();
        parts.push({
          geo: thread([
            s0,
            s0.clone().addScaledVector(out, 0.035).addScaledVector(headUp, dy * 0.6 + 0.002),
            s0.clone().addScaledVector(out, 0.075).addScaledVector(headUp, dy * 1.5 - 0.004),
          ], 0.0009, 10, 4),
          slot: S.thread, bone: B.cabeca,
        });
      }
    }
  }
  // costura do meio da cabeça, da testa até a nuca
  {
    const pts = [];
    for (let k = 0; k <= 24; k++) {
      const a = 0.85 + (k / 24) * 1.85;
      const n = new Vector3();
      const p = onBody(H(0, 0.113 + Math.sin(a) * 0.2, -Math.cos(a) * 0.2), n);
      pts.push([p, n.clone()]);
    }
    headStitches.push(pts);
  }

  // ---------- lado de dentro das orelhas (osso de cada orelha) ----------
  EARS.forEach((e, k) => {
    const m = head.clone().multiply(new Matrix4().makeRotationFromQuaternion(e.q).setPosition(e.base));
    const nu = 6, nvv = 9, pos = [], nor = [], idx = [];
    for (let j = 0; j <= nvv; j++) {
      const y = 0.016 + (j / nvv) * 0.062;
      const w = 0.029 * Math.pow(1 - (y - 0.016) / 0.075, 0.9) + 0.002;
      for (let i = 0; i <= nu; i++) {
        const x = (i / nu - 0.5) * 2 * w;
        const n = new Vector3();
        const p = onBody(v3(x, y, -0.04).applyMatrix4(m), n);
        p.addScaledVector(n, 0.0016);
        pos.push(p.x, p.y, p.z);
        nor.push(n.x, n.y, n.z);
      }
    }
    for (let j = 0; j < nvv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + nu + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
    g.setIndex(idx);
    // a face tem que olhar pra fora (pra frente da orelha)
    const front = v3(0, 0, -1).applyMatrix4(new Matrix4().extractRotation(m));
    const p0 = v3().fromArray(pos, 0), p1 = v3().fromArray(pos, 3), p2 = v3().fromArray(pos, (nu + 1) * 3);
    if (p1.sub(p0).cross(p2.sub(p0)).dot(front) < 0) {
      for (let t = 0; t < idx.length; t += 3) { const q = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = q; }
      g.setIndex(idx);
    }
    parts.push({ geo: g, slot: S.lining, bone: k === 0 ? B.orelhaE : B.orelhaD });
  });

  // ---------- patas: feijõezinhos e dedinhos costurados ----------
  for (const l of HANDS) {
    const paw = bind[B[`pata${l}`]], bone = B[`pata${l}`];
    const pr = new Matrix4().extractRotation(paw);
    const py = v3(0, 1, 0).applyMatrix4(pr);
    const c = v3(0, 0.024, 0).applyMatrix4(paw); // centro da pata
    const front = py.clone().multiplyScalar(0.35).add(v3(0, -0.45, -0.82)).normalize();
    const side = new Vector3().crossVectors(front, py).normalize();
    const up2 = new Vector3().crossVectors(side, front).normalize();
    const bean = (d, rx, ry, rz) => {
      const n = new Vector3();
      // começa logo fora da pata, pra cair na pata e não no braço
      const p = onBody(c.clone().addScaledVector(d, 0.066), n);
      const g = ellipsoid(rx, ry, rz, 12, 8).applyMatrix4(basis(p.addScaledVector(n, rz * 0.3), n, py));
      parts.push({ geo: g, slot: S.bean, bone });
    };
    for (const [a, b] of [[-0.62, 0.42], [-0.21, 0.62], [0.21, 0.62], [0.62, 0.42]]) {
      bean(front.clone().addScaledVector(side, a * 0.62).addScaledVector(up2, b * 0.7).normalize(), 0.0098, 0.009, 0.0055);
    }
    bean(front.clone().addScaledVector(up2, -0.32).normalize(), 0.018, 0.014, 0.007);
    // dedinhos nas costas da pata
    for (const sx of [-1, 1]) {
      const pts = [0.15, 0.5, 0.85].map((a) => {
        const d = py.clone().multiplyScalar(Math.sin(a + 0.6)).addScaledVector(front, -Math.cos(a + 0.6)).addScaledVector(side, sx * 0.2).normalize();
        const n = new Vector3();
        return onBody(c.clone().addScaledVector(d, 0.1), n).addScaledVector(n, 0.0007);
      });
      parts.push({ geo: thread(pts, 0.0011), slot: S.thread, bone });
    }
  }
  // pés: dedinhos costurados na frente
  for (const l of FEET) {
    const foot = bind[B[`pe${l}`]], bone = B[`pe${l}`];
    for (const sx of [-0.016, 0.016]) {
      const pts = [0.2, 0.55, 0.95].map((a) => {
        const n = new Vector3();
        const q = v3(sx, 0.066 + Math.sin(a) * 0.06, -0.085 - Math.cos(a) * 0.15).applyMatrix4(foot);
        return onBody(q, n).addScaledVector(n, 0.0007);
      });
      parts.push({ geo: thread(pts, 0.0012), slot: S.thread, bone });
    }
  }

  // ---------- pulseiras e tornozeleiras de feltro ----------
  const band = (a, b, back, tube, slot) => {
    const dir = b.clone().sub(a).normalize();
    const c = a.clone().addScaledVector(dir, back);
    // raio do membro ali = distância do eixo até a superfície
    const r = Math.max(0.03, -body.distance(c) * 0.98);
    const g = new TorusGeometry(r + tube * 0.25, tube, 8, 28);
    g.rotateX(Math.PI / 2);
    g.applyMatrix4(new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromUnitVectors(UP, dir)).setPosition(c));
    parts.push({ geo: g, slot, at: c });
  };
  for (const l of HANDS) {
    const j = joints.arms[l];
    band(j.wrist, j.elbow, 0.05, 0.0125, S[l]);
  }
  for (const l of FEET) {
    const j = joints.legs[l];
    band(j.ankle, j.knee, 0.06, 0.0135, S[l]);
  }

  // ---------- costura em volta do peito creme ----------
  {
    const torso = bind[B.pelve], pts = [];
    const fwdT = v3(0, 0, -1).applyMatrix4(new Matrix4().extractRotation(torso));
    for (let k = 0; k <= 72; k++) {
      const a = (k / 72) * Math.PI * 2;
      const q = v3(0.118 * 0.93 * Math.cos(a), 0.255 + 0.29 * 0.93 * Math.sin(a), -0.3).applyMatrix4(torso);
      const n = new Vector3();
      // projeta só no tronco; ponto escondido embaixo de braço ou perna fica de fora
      // raio de dentro do tronco pra frente, na mesma altura e largura
      const pc = rayToBody(body, q.clone().addScaledVector(fwdT, -0.3), fwdT, n, body.coreDistance);
      // depois sobe até a superfície de verdade (o estofado das emendas fica
      // por cima do tronco); se ela estiver longe, é braço ou perna na frente
      const p = projectToBody(body, pc.clone(), n);
      pts.push(p.distanceTo(pc) < 0.006 ? [p, n.clone()] : null);
    }
    // quebra a linha nos trechos escondidos
    let run = [];
    for (const x of pts) {
      if (x) run.push(x);
      else { if (run.length > 1) bodyStitches.push(run); run = []; }
    }
    if (run.length > 1) bodyStitches.push(run);
  }

  // pontinhos de costura (grãos alongados) ao longo das linhas
  const stitchGeo = (lines, bone) => {
    for (const line of lines) {
      let acc = 0;
      for (let i = 1; i < line.length; i++) {
        const [p0, n0] = line[i - 1], [p1] = line[i];
        const seg = p1.distanceTo(p0);
        acc += seg;
        if (acc < 0.0125) continue;
        acc = 0;
        const x = p1.clone().sub(p0).normalize();
        const y = new Vector3().crossVectors(n0, x).normalize();
        const z = new Vector3().crossVectors(x, y);
        const m = new Matrix4().makeBasis(x.multiplyScalar(0.0038), y.multiplyScalar(0.0009), z.multiplyScalar(0.0011))
          .setPosition(p0.clone().lerp(p1, 0.5).addScaledVector(n0, 0.0006));
        const g = new OctahedronGeometry(1, 0).applyMatrix4(m);
        parts.push(bone === undefined ? { geo: g, slot: S.thread, at: p0 } : { geo: g, slot: S.thread, bone });
      }
    }
  };
  stitchGeo(headStitches, B.cabeca);
  stitchGeo(bodyStitches);

  // ---------- baquetas (rígidas no pulso) ----------
  for (const l of HANDS) {
    const len = BODY.stickFront + BODY.stickBack, r0 = 0.0085, r1 = 0.0062;
    const pts = [[0, -BODY.stickBack - 0.004], [r0 * 0.7, -BODY.stickBack - 0.003], [r0, -BODY.stickBack + 0.002]];
    for (let k = 1; k <= 6; k++) pts.push([r0 + (r1 - r0) * (k / 6), -BODY.stickBack + len * (k / 6)]);
    pts.push([0, BODY.stickFront]);
    const shaft = new LatheGeometry(pts.map(([x, y]) => new Vector2(x, y)), 10);
    const tip = new SphereGeometry(0.0085, 12, 8).translate(0, BODY.stickFront, 0);
    for (const g of [shaft, tip]) {
      g.applyMatrix4(bind[B[`baqueta${l}`]]);
      parts.push({ geo: g, slot: S.stick, bone: B[`baqueta${l}`] });
    }
  }
  return mergeParts(parts, body);
}

export function createCat(rig, { palette = "laranja" } = {}) {
  const group = new Group();
  group.name = "gato";
  const t0 = performance.now();
  const body = catBody();
  const cat = createCatBones();

  // ossos: matrizes de mundo escritas direto (o grupo do gato fica na origem)
  const boneObjs = cat.bones.map((m, i) => {
    const b = new Bone();
    b.name = `osso-${i}`;
    b.matrixAutoUpdate = false;
    b.matrix.copy(m);
    b.matrixWorld.copy(m);
    group.add(b);
    return b;
  });
  const skeleton = new Skeleton(boneObjs, cat.bind.map((m) => m.clone().invert()));

  // ---------- corpo ----------
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(body.positions, 3));
  geo.setAttribute("normal", new BufferAttribute(body.normals, 3));
  geo.setAttribute("bi", new Uint16BufferAttribute(body.skinIndex, 4));
  geo.setAttribute("bw", new BufferAttribute(body.skinWeight, 4));
  geo.setAttribute("fur", new BufferAttribute(body.fur, 2));
  geo.setIndex(new BufferAttribute(body.index, 1));
  const nb = cat.bones.length;
  const furMat = plushMaterial("fur", { sheen: 0.95, sheenMix: 0.5, dq: nb });
  const dq = furMat.userData.u.uDQ.value;
  const mesh = new Mesh(geo, furMat); // skinning de quatérnio duplo no shader
  mesh.name = "gato-corpo";
  mesh.frustumCulled = false;
  group.add(mesh);

  // ---------- detalhes ----------
  if (!body.details) body.details = buildDetails(body); // só os arrays; a geometria é por montagem
  const dgeo = body.details.clone();
  const detailMat = plushMaterial("palette", { slots: SLOTS, sheen: 0.6, sheenMix: 0.4 });
  const details = new SkinnedMesh(dgeo, detailMat);
  details.name = "gato-detalhes";
  details.frustumCulled = false;
  details.bind(skeleton, new Matrix4());
  group.add(details);
  const genMs = performance.now() - t0;

  // ---------- pose ----------
  const bindInv = cat.bind.map((m) => m.clone().invert());
  const dm = new Matrix4(), dqr = new Quaternion();
  /** Quatérnio duplo (rotação, dual) da deformação de cada osso: osso * inverso da ligação. */
  function writeDQ(src) {
    for (let i = 0; i < nb; i++) {
      dm.multiplyMatrices(src[i], bindInv[i]);
      dqr.setFromRotationMatrix(dm);
      if (dqr.w < 0) dqr.set(-dqr.x, -dqr.y, -dqr.z, -dqr.w);
      const e = dm.elements, tx = e[12], ty = e[13], tz = e[14], o = i * 8;
      dq[o] = dqr.x; dq[o + 1] = dqr.y; dq[o + 2] = dqr.z; dq[o + 3] = dqr.w;
      // dual = ½ · (t, 0) · rotação
      dq[o + 4] = 0.5 * (dqr.w * tx + ty * dqr.z - tz * dqr.y);
      dq[o + 5] = 0.5 * (dqr.w * ty + tz * dqr.x - tx * dqr.z);
      dq[o + 6] = 0.5 * (dqr.w * tz + tx * dqr.y - ty * dqr.x);
      dq[o + 7] = -0.5 * (tx * dqr.x + ty * dqr.y + tz * dqr.z);
    }
  }
  function update(t, prep) {
    cat.update(rig, t, prep);
    const src = api.showBind ? cat.bind : cat.bones; // showBind: só pra depurar a malha
    for (let i = 0; i < boneObjs.length; i++) {
      boneObjs[i].matrix.copy(src[i]);
      boneObjs[i].matrixWorld.copy(src[i]);
    }
    writeDQ(src);
  }
  writeDQ(cat.bind);

  // ---------- cores ----------
  let pal = CAT_PALETTES[palette] || CAT_PALETTES.laranja;
  let lastTheme = null;
  function paint(theme) {
    lastTheme = theme;
    const u = furMat.userData.u;
    u.uFur.value.set(pal.fur);
    u.uStripe.value.set(pal.stripe || pal.fur);
    u.uCream.value.set(pal.cream);
    setSlot(detailMat, S.eye, 0x120e0d, 0.16);
    setSlot(detailMat, S.rim, 0x1d1714, 0.35);
    setSlot(detailMat, S.glint, 0xffffff, 0.4);
    setSlotEmissive(detailMat, S.glint, u.uCream.value.clone().set(0xffffff), 0.9);
    setSlot(detailMat, S.nose, pal.pink, 0.75);
    setSlot(detailMat, S.lining, pal.lining, 0.92);
    setSlot(detailMat, S.bean, pal.pink, 0.85);
    setSlot(detailMat, S.thread, theme.thread, 0.9);
    setSlot(detailMat, S.stick, theme.stick, 0.85);
    for (const l of [...HANDS, ...FEET]) setSlot(detailMat, S[l], theme.limb[l], 0.92);
  }
  function setPalette(name) {
    pal = CAT_PALETTES[name] || CAT_PALETTES.laranja;
    if (lastTheme) paint(lastTheme);
  }

  /** Debug: centro da bolinha da baqueta no mundo (depois do update). */
  const tipWorld = (limb, out = new Vector3()) => out.copy(rig.arms[limb].dir).multiplyScalar(BODY.stickFront).add(rig.arms[limb].wrist);

  const api = {
    group, update, paint, setPalette, tipWorld, mesh, details, skeleton, showBind: false,
    genMs, bodyMs: body.stats.ms, stats: body.stats,
    dispose() {
      geo.dispose();
      dgeo.dispose();
      furMat.dispose();
      detailMat.dispose();
      skeleton.dispose();
    },
  };
  return api;
}
