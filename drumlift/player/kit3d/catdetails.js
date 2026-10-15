// Detalhes pequenos do gato de pelúcia (olhos de botão, nariz, boca, bigodes,
// lado de dentro das orelhas, feijõezinhos, dedinhos, pulseiras, costuras e
// baquetas), montados na pose de ligação em cima do corpo contínuo e juntados
// numa geometria só, presa aos ossos. Sem DOM: roda também no Web Worker.

import {
  BufferAttribute, BufferGeometry, LatheGeometry, Matrix4, OctahedronGeometry, Quaternion, SphereGeometry,
  TorusGeometry, Vector2, Vector3,
} from "../vendor/three.module.min.js";
import { FEET, HANDS, SKEL } from "./skeleton.js";
import { B, EARS, EYE_C, HEAD_SCALE as HS, SKULL } from "./catrig.js";
import { catBody, projectToBody, rayToBody } from "./catbody.js";
import { basis, ellipsoid as shapeEllipsoid, mergeSkinned, thread as shapeThread } from "./shapes.js";

const v3 = (x, y, z) => new Vector3(x, y, z);
const UP = v3(0, 1, 0);

// slots da paleta dos detalhes
export const S = { eye: 0, glint: 1, nose: 2, lining: 3, thread: 4, bean: 5, stick: 6, MD: 7, ME: 8, PD: 9, PE: 10, rim: 11 };
export const SLOTS = 12;

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
export function buildDetails(body) {
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
    const P = onFace(0.052 * HS * s, EYE_C.y, -0.2);
    const n = N.clone();
    const m = basis(P.clone().addScaledVector(n, 0.0042 * HS), n, headUp).multiply(new Matrix4().makeScale(HS, HS, HS));
    const btn = ellipsoid(0.02, 0.02, 0.0085, 20, 14).applyMatrix4(m);
    parts.push({ geo: btn, slot: S.eye, bone: B.olhos });
    const rim = new TorusGeometry(0.0175, 0.0026, 6, 24).applyMatrix4(m.clone().multiply(new Matrix4().makeTranslation(0, 0, -0.004)));
    parts.push({ geo: rim, slot: S.rim, bone: B.olhos });
    const g1 = ellipsoid(0.0052, 0.0052, 0.0027, 10, 8).translate(-0.0067 * s, 0.0072, -0.0078).applyMatrix4(m);
    const g2 = ellipsoid(0.0022, 0.0022, 0.0015, 8, 6).translate(0.0072 * s, -0.006, -0.0075).applyMatrix4(m);
    parts.push({ geo: g1, slot: S.glint, bone: B.olhos }, { geo: g2, slot: S.glint, bone: B.olhos });
  }

  // ---------- nariz, boca e bigodes (cabeça) ----------
  const puff = (s) => H(0.031 * HS * s, 0.064 * HS, -0.12 * HS); // centro das almofadas do focinho
  const noseP = onFace(0, 0.093 * HS, -0.2);
  const noseN = N.clone();
  {
    const g = new SphereGeometry(1, 18, 12);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y01 = (p.getY(i) + 1) / 2;
      p.setXYZ(i, p.getX(i) * 0.018 * HS * (0.4 + 0.6 * y01), p.getY(i) * 0.0118 * HS, p.getZ(i) * 0.0105 * HS);
    }
    g.computeVertexNormals();
    g.applyMatrix4(basis(noseP.clone().addScaledVector(noseN, 0.002), noseN, headUp));
    parts.push({ geo: g, slot: S.nose, bone: B.cabeca });
  }
  {
    const lift = (q) => { const n = new Vector3(); const r = onBody(q, n); return r.addScaledVector(n, 0.0007); };
    const top = lift(noseP.clone().addScaledVector(headUp, -0.011));
    const valley = (() => { const n = new Vector3(); return onFace(0, 0.052 * HS, -0.2, n).addScaledVector(n, 0.0007); })();
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
      const p = onBody(H(0, SKULL.c.y + Math.sin(a) * 0.25, -Math.cos(a) * 0.25), n);
      pts.push([p, n.clone()]);
    }
    headStitches.push(pts);
  }

  // ---------- lado de dentro das orelhas (osso de cada orelha) ----------
  EARS.forEach((e, k) => {
    const m = head.clone().multiply(new Matrix4().makeRotationFromQuaternion(e.q).setPosition(e.base));
    const nu = 6, nvv = 9, pos = [], nor = [], idx = [];
    for (let j = 0; j <= nvv; j++) {
      const y = (0.016 + (j / nvv) * 0.062) * HS;
      const w = 0.029 * HS * Math.pow(1 - (y / HS - 0.016) / 0.075, 0.9) + 0.002;
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
    const paw = bind[B[`pata${l}`]], bone = B[`pata${l}`], sx = l === "MD" ? 1 : -1;
    const pr = new Matrix4().extractRotation(paw);
    const py = v3(0, 1, 0).applyMatrix4(pr);              // pros dedos
    const front = v3(0, 0, -1).applyMatrix4(pr);          // palma
    const side = v3(1, 0, 0).applyMatrix4(pr);
    const c = v3(-0.006 * sx, 0.06, -0.02).applyMatrix4(paw); // centro da pata
    const bean = (d, rx, ry, rz) => {
      const n = new Vector3();
      // começa logo fora da pata, pra cair na pata e não no braço
      const p = onBody(c.clone().addScaledVector(d, 0.066), n);
      const g = ellipsoid(rx, ry, rz, 12, 8).applyMatrix4(basis(p.addScaledVector(n, rz * 0.3), n, py));
      parts.push({ geo: g, slot: S.bean, bone });
    };
    for (const [a, b] of [[-0.62, 0.42], [-0.21, 0.62], [0.21, 0.62], [0.62, 0.42]]) {
      bean(front.clone().addScaledVector(side, a * 0.62).addScaledVector(py, b * 0.7).normalize(), 0.0098, 0.009, 0.0055);
    }
    bean(front.clone().addScaledVector(py, -0.32).normalize(), 0.018, 0.014, 0.007);
    // dedinhos nas costas da pata
    for (const k of [-1, 1]) {
      const pts = [0.15, 0.5, 0.85].map((a) => {
        const d = py.clone().multiplyScalar(Math.sin(a + 0.6)).addScaledVector(front, -Math.cos(a + 0.6)).addScaledVector(side, k * 0.2).normalize();
        const n = new Vector3();
        return onBody(c.clone().addScaledVector(d, 0.1), n).addScaledVector(n, 0.0007);
      });
      parts.push({ geo: thread(pts, 0.0011), slot: S.thread, bone });
    }
  }
  // pés: dedinhos costurados na frente (na parte da frente do pé, que dobra na planta)
  const soleToFoot = (() => {
    const o = v3(...SKEL.ankle), y = v3(...SKEL.ball).sub(o).normalize();
    const x = v3(1, 0, 0).addScaledVector(y, -y.x).normalize();
    return new Matrix4().makeBasis(x, y, new Vector3().crossVectors(x, y)).setPosition(o).invert();
  })();
  for (const l of FEET) {
    const sole = bind[B[`pe${l}`]].clone().multiply(soleToFoot), bone = B[`dedao${l}`];
    for (const sx of [-0.016, 0.016]) {
      const pts = [0.2, 0.55, 0.95].map((a) => {
        const n = new Vector3();
        const q = v3(sx, 0.066 + Math.sin(a) * 0.06, -0.085 - Math.cos(a) * 0.15).applyMatrix4(sole);
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
    const len = SKEL.stickFront + SKEL.stickBack, r0 = 0.0085, r1 = 0.0062;
    const pts = [[0, -SKEL.stickBack - 0.004], [r0 * 0.7, -SKEL.stickBack - 0.003], [r0, -SKEL.stickBack + 0.002]];
    for (let k = 1; k <= 6; k++) pts.push([r0 + (r1 - r0) * (k / 6), -SKEL.stickBack + len * (k / 6)]);
    pts.push([0, SKEL.stickFront]);
    const shaft = new LatheGeometry(pts.map(([x, y]) => new Vector2(x, y)), 10);
    const tip = new SphereGeometry(0.0085, 12, 8).translate(0, SKEL.stickFront, 0);
    for (const g of [shaft, tip]) {
      g.applyMatrix4(bind[B[`baqueta${l}`]]);
      parts.push({ geo: g, slot: S.stick, bone: B[`baqueta${l}`] });
    }
  }
  return mergeParts(parts, body);
}

/**
 * Tudo o que o gato precisa de geometria, em arrays (dá pra transferir do
 * Worker): corpo contínuo e detalhes, mais quanto tempo levou.
 */
export function catMeshData() {
  const t0 = performance.now();
  const body = catBody();
  const t1 = performance.now();
  const g = buildDetails(body);
  const a = g.attributes;
  const details = {
    position: a.position.array, normal: a.normal.array, slot: a.slot.array,
    skinIndex: a.skinIndex.array, skinWeight: a.skinWeight.array, index: g.index.array,
  };
  return {
    body: {
      positions: body.positions, normals: body.normals, index: body.index,
      skinIndex: body.skinIndex, skinWeight: body.skinWeight, fur: body.fur, ao: body.ao,
    },
    details,
    stats: { ...body.stats, bodyMs: t1 - t0, detailsMs: performance.now() - t1 },
  };
}

/** Buffers dos arrays (pra transferir sem copiar). */
export function meshDataBuffers(d) {
  return [...Object.values(d.body), ...Object.values(d.details)].map((x) => x.buffer);
}
