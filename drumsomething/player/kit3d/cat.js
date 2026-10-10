// Baterista do estilo pelúcia: um gato humanoide de feltro ("corpo de gente,
// pele de gato") vestindo o mesmo esqueleto do manequim (rig.js). Mesmas
// medidas de braço e perna, formas estufadas, olhos de botão, patas com
// feijõezinhos, costuras e um rabo que balança no andamento.

import {
  BufferAttribute, BufferGeometry, Color, Group, Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalMaterial,
  MeshStandardMaterial, PlaneGeometry, Quaternion, Sphere, TorusGeometry, Vector3,
} from "../vendor/three.module.min.js";
import { BODY } from "./layout.js";
import { FEET, HANDS } from "./rig.js";
import { TILE, feltMaterial, setFelt } from "./felt.js";
import {
  aroundUnits, blob, ellipsoid, ellipsoidPoint, lathe, limb, mergeGeos, plainUv1, sameUv1, scaleUV, stitchGeometry,
  stitchLine, stitchMesh, thread,
} from "./shapes.js";
import { blink, earTwitch, headPulse, tailSway } from "./plushmotion.js";

const UP = new Vector3(0, 1, 0);
const WHITE = new Color(1, 1, 1);
const FRONT = new Vector3(0, 0, -1);
const v3 = (x, y, z) => new Vector3(x, y, z);
const smooth01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// ---------- medidas do gato (m) ----------
// Tronco: superelipse de revolução no espaço do tronco (origem na pelve),
// achatada na frente-trás.
const TORSO = { yc: 0.26, h: 0.34, p: 2.6, rBottom: 0.2, rTop: 0.155, kz: 0.78 };
// scale: a cabeça de pelúcia é grande, mas não pode esconder o surdo na
// câmera "baterista" (a que mais ensina)
const HEAD = { r: v3(0.158, 0.135, 0.142), pos: v3(BODY.head[0], BODY.head[1] - 0.012, BODY.head[2]), tilt: -0.18, scale: 0.86 };
const ARM = { upper: [0.058, 0.047], fore: [0.046, 0.04] };
const LEG = { thigh: [0.076, 0.062], shin: [0.06, 0.05] };
const PAW = v3(0.05, 0.057, 0.045);
const PAW_LEAN = v3(0, -0.35, -1).normalize();
const FOOT = { r: v3(0.05, 0.043, 0.122), c: v3(0, 0.044, -0.082) };

function torsoRadius(y) {
  const { yc, h, p, rBottom, rTop } = TORSO;
  const u = Math.min(1, Math.abs((y - yc) / h));
  const rmax = rBottom + (rTop - rBottom) * ((y - (yc - h)) / (2 * h));
  return rmax * Math.pow(1 - Math.pow(u, p), 1 / p);
}
/** Ponto do tronco no ângulo th (0 = frente) e altura y; normal em outN. */
function torsoAt(th, y, out, outN) {
  const r = torsoRadius(y);
  out.set(r * Math.sin(th), y, -r * Math.cos(th) * TORSO.kz);
  if (outN) {
    const e = 1e-3, a = new Vector3(), b = new Vector3();
    const ra = torsoRadius(y), rb = torsoRadius(Math.min(TORSO.yc + TORSO.h - 1e-4, y + e));
    a.set(ra * Math.sin(th + e), y, -ra * Math.cos(th + e) * TORSO.kz).sub(out);
    b.set(rb * Math.sin(th), y + e, -rb * Math.cos(th) * TORSO.kz).sub(out);
    outN.crossVectors(a, b).normalize();
    if (outN.dot(v3(out.x, 0, out.z)) < 0) outN.negate();
  }
  return out;
}

function headShape(d, out) {
  ellipsoidPoint(HEAD.r, d, out);
  // bochechas mais cheias embaixo, topo um pouco achatado
  out.x *= 1 + 0.08 * smooth01((0.15 - d.y) / 0.9);
  if (d.y > 0) out.y *= 1 - 0.07 * d.y * d.y;
  return out;
}
/** Ponto e normal da cabeça na direção dir (espaço da cabeça). */
function headAt(dir, out, outN) {
  const d = dir.clone().normalize();
  headShape(d, out);
  if (outN) {
    const t1 = new Vector3().crossVectors(d, Math.abs(d.y) < 0.9 ? UP : FRONT).normalize();
    const t2 = new Vector3().crossVectors(d, t1).normalize();
    const e = 1e-3;
    const a = headShape(d.clone().addScaledVector(t1, e).normalize(), new Vector3()).sub(out);
    const b = headShape(d.clone().addScaledVector(t2, e).normalize(), new Vector3()).sub(out);
    outN.crossVectors(a, b).normalize();
    if (outN.dot(d) < 0) outN.negate();
  }
  return out;
}

/** Orelha: triângulo estufado, base na origem, ponta em +y, frente em -z. */
function earGeometry(H, W, T) {
  return blob((d, out) => {
    const y01 = (d.y + 1) / 2;
    const w = Math.pow(1 - y01, 0.85) * 0.9 + 0.1;
    return out.set(d.x * W * w, y01 * H, d.z * T * 0.5 * Math.sqrt(w));
  }, { w: 20, h: 16, circ: 2 * W, merid: H });
}

/** Junta geometrias já posicionadas por matrizes. */
function placed(list) {
  return mergeGeos(list.map(([g, m]) => { g.applyMatrix4(m); return g; }));
}
const basisMatrix = (pos, n, up = UP) => {
  // -z da peça na normal n, +y o mais perto possível de `up`
  const z = n.clone().negate();
  const x = new Vector3().crossVectors(up, z);
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0);
  x.normalize();
  const y = new Vector3().crossVectors(z, x);
  return new Matrix4().makeBasis(x, y, z).setPosition(pos);
};

export function createCat(rig, tex, { palette = "laranja" } = {}) {
  const group = new Group();
  group.name = "gato";
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };

  // ---------- materiais ----------
  const furMat = keep(feltMaterial(tex, { map: tex.fur, sheenMix: 0.5 }));
  const headMat = keep(feltMaterial(tex, { map: tex.head, sheenMix: 0.5 }));
  const creamMat = keep(feltMaterial(tex, { sheenMix: 0.3 }));
  const pinkMat = keep(feltMaterial(tex, { sheenMix: 0.35, normalScale: 0.3 }));
  const liningMat = keep(feltMaterial(tex, { sheenMix: 0.35, normalScale: 0.3 }));
  const stickMat = keep(feltMaterial(tex, { sheenMix: 0.3, normalScale: 0.25 }));
  const eyeMat = keep(new MeshPhysicalMaterial({
    color: 0x120e0d, roughness: 0.22, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06,
  }));
  const glintMat = keep(new MeshBasicMaterial({ color: 0xffffff }));
  const threadMat = keep(new MeshStandardMaterial({ roughness: 0.85 }));
  const blushMat = keep(new MeshBasicMaterial({
    map: tex.radial, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  }));
  const bandMat = {};
  for (const l of [...HANDS, ...FEET]) bandMat[l] = keep(feltMaterial(tex, { sheenMix: 0.4 }));
  const stitchGeo = keep(stitchGeometry());

  // ---------- tronco ----------
  const torso = new Group();
  torso.position.copy(rig.torso.position);
  torso.rotation.order = "YXZ";
  group.add(torso);
  const shoulderLocal = {
    MD: v3(BODY.shoulder[0], BODY.shoulder[1], BODY.shoulder[2]),
    ME: v3(-BODY.shoulder[0], BODY.shoulder[1], BODY.shoulder[2]),
  };
  {
    // grade (ângulo em volta, parâmetro da superelipse na vertical)
    const nTh = 36, nPs = 26, { yc, h, p } = TORSO;
    const pos = [], uv = [], idx = [];
    const circ = 2 * Math.PI * TORSO.rBottom * (1 + TORSO.kz) / 2, nu = aroundUnits(circ);
    const P = new Vector3();
    let arc = 0, prev = null;
    for (let j = 0; j <= nPs; j++) {
      const ps = -Math.PI / 2 + (j / nPs) * Math.PI, s = Math.sin(ps);
      const y = yc + h * Math.sign(s) * Math.pow(Math.abs(s), 2 / p);
      torsoAt(0, y, P);
      if (prev) arc += P.distanceTo(prev);
      prev = P.clone();
      for (let i = 0; i <= nTh; i++) {
        const th = (i / nTh) * Math.PI * 2;
        torsoAt(th, y, P);
        if (j === 0 || j === nPs) P.set(0, y, 0);
        pos.push(P.x, P.y, P.z);
        uv.push((i / nTh) * nu, arc / TILE);
      }
    }
    for (let j = 0; j < nPs; j++) {
      for (let i = 0; i < nTh; i++) {
        const a = j * (nTh + 1) + i, b = a + nTh + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    sameUv1(geo);
    // ombros: bolas de pelúcia no lugar de repouso dos ombros
    const balls = HANDS.map((l) => {
      const g = ellipsoid(ARM.upper[0], ARM.upper[0], ARM.upper[0], { w: 18, h: 12 });
      g.rotateZ(Math.PI / 2);
      g.translate(...shoulderLocal[l].toArray());
      return plainUv1(g);
    });
    const body = new Mesh(keep(mergeGeos([geo, ...balls])), furMat);
    torso.add(body);
  }

  // barriga creme: remendo estufado colado no tronco, com costura em volta
  const BELLY = { th: 0.92, yc: 0.2, dy: 0.21, puff: 0.005 };
  const torsoStitches = [];
  {
    const nR = 7, nA = 44, pos = [], uv = [], idx = [];
    const P = new Vector3(), N = new Vector3();
    for (let k = 0; k <= nR; k++) {
      const rho = k / nR;
      for (let i = 0; i <= nA; i++) {
        const a = (i / nA) * Math.PI * 2;
        const th = BELLY.th * rho * Math.cos(a), y = BELLY.yc + BELLY.dy * rho * Math.sin(a);
        torsoAt(th, y, P, N);
        const lift = 0.0012 + BELLY.puff * Math.sqrt(Math.max(0, 1 - Math.pow(rho, 5)));
        P.addScaledVector(N, lift);
        pos.push(P.x, P.y, P.z);
        uv.push(P.x / TILE, P.y / TILE);
      }
    }
    for (let k = 0; k < nR; k++) {
      for (let i = 0; i < nA; i++) {
        const a = k * (nA + 1) + i, b = a + nA + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    torso.add(new Mesh(keep(geo), creamMat));
    // costura na borda do remendo
    const at = (s, out, n) => {
      const a = s * Math.PI * 2, rho = 0.93;
      torsoAt(BELLY.th * rho * Math.cos(a), BELLY.yc + BELLY.dy * rho * Math.sin(a), out, n);
      return out.addScaledVector(n, 0.0012 + BELLY.puff * Math.sqrt(1 - Math.pow(rho, 5)));
    };
    stitchLine(at, 2 * Math.PI * Math.sqrt(((0.15 * BELLY.th) ** 2 + BELLY.dy ** 2) / 2), torsoStitches, { closed: true });
    // costura das costas
    stitchLine((s, out, n) => torsoAt(Math.PI, -0.03 + s * 0.6, out, n), 0.62, torsoStitches);
  }
  const torsoSeams = keep(stitchMesh(stitchGeo, threadMat, torsoStitches));
  torso.add(torsoSeams);

  // ---------- cabeça ----------
  const head = new Group();
  head.position.copy(HEAD.pos);
  head.scale.setScalar(HEAD.scale);
  head.rotation.x = HEAD.tilt;
  torso.add(head);
  {
    const geo = blob(headShape, { axis: "-z", w: 40, h: 28, circ: 2 * Math.PI * 0.15, merid: Math.PI * 0.142 });
    const uv = geo.attributes.uv;
    let uMax = 0, vMax = 0;
    for (let i = 0; i < uv.count; i++) { uMax = Math.max(uMax, uv.getX(i)); vMax = Math.max(vMax, uv.getY(i)); }
    tex.head.repeat.set(1 / uMax, 1 / vMax);
    head.add(new Mesh(keep(geo), headMat));
  }
  const P = new Vector3(), N = new Vector3();
  const headStitches = [];
  // costura do meio da cabeça, da testa até a nuca
  stitchLine((s, out, n) => {
    const a = 0.95 + s * 1.75;
    headAt(v3(0, Math.sin(a), -Math.cos(a)), out, n);
    return out;
  }, 0.125 * 1.75, headStitches);

  // focinho: duas almofadinhas + queixo, creme
  const MUZ = v3(0.039, 0.031, 0.029);
  const puffC = {};
  const muzzleParts = [];
  for (const side of [1, -1]) {
    headAt(v3(0.29 * side, -0.37, -1), P, N);
    const c = P.clone().addScaledVector(N, -0.011);
    puffC[side] = c;
    muzzleParts.push(ellipsoid(MUZ.x, MUZ.y, MUZ.z, { w: 22, h: 16 }).translate(c.x, c.y, c.z));
  }
  headAt(v3(0, -0.66, -1), P, N);
  const chinC = P.clone().addScaledVector(N, -0.008);
  muzzleParts.push(ellipsoid(0.03, 0.022, 0.023, { w: 18, h: 12 }).translate(chinC.x, chinC.y, chinC.z));
  head.add(new Mesh(keep(mergeGeos(muzzleParts)), creamMat));
  const puffAt = (side, d) => ellipsoidPoint(MUZ, d.clone().normalize(), new Vector3()).add(puffC[side]);

  // nariz rosa: triângulo invertido arredondado, em cima do encontro das almofadas
  const noseTop = puffC[1].y + MUZ.y * 0.62;
  const noseZ = Math.min(puffC[1].z, puffC[-1].z) - MUZ.z * 0.78;
  {
    const g = blob((d, out) => {
      const y01 = (d.y + 1) / 2;
      return out.set(d.x * 0.019 * (0.42 + 0.58 * y01), d.y * 0.0122, d.z * 0.0105);
    }, { w: 18, h: 12, circ: 0.07, merid: 0.03 });
    g.translate(0, noseTop, noseZ);
    head.add(new Mesh(keep(g), pinkMat));
  }

  // olhos de botão com reflexo (piscam juntos: escala y do grupo)
  const eyes = new Group();
  const eyeY = 0.016;
  eyes.position.set(0, eyeY, 0);
  head.add(eyes);
  {
    const btn = [], glint = [];
    for (const side of [1, -1]) {
      headAt(v3(0.37 * side, 0.14, -1), P, N);
      P.y -= eyeY;
      const m = basisMatrix(P.clone().addScaledVector(N, 0.004), N);
      btn.push([ellipsoid(0.0245, 0.0245, 0.0098, { w: 20, h: 14 }), m]);
      // aro do botão
      const rim = new TorusGeometry(0.021, 0.003, 6, 24);
      btn.push([rim, m.clone().multiply(new Matrix4().makeTranslation(0, 0, -0.0048))]);
      const gl = ellipsoid(0.0062, 0.0062, 0.0032, { w: 10, h: 8 });
      gl.translate(-0.008, 0.0086, -0.009);
      glint.push([gl, m]);
      const gl2 = ellipsoid(0.0026, 0.0026, 0.0017, { w: 8, h: 6 });
      gl2.translate(0.0086, -0.0072, -0.0087);
      glint.push([gl2, m]);
    }
    eyes.add(new Mesh(keep(placed(btn)), eyeMat));
    eyes.add(new Mesh(keep(placed(glint)), glintMat));
  }

  // bochechas rosadas: plaquinhas curvas na superfície, com alfa radial
  {
    const parts = [];
    for (const side of [1, -1]) {
      const g = new PlaneGeometry(0.07, 0.05, 6, 4);
      const c = v3(0.62 * side, -0.24, -0.78).normalize();
      const t1 = new Vector3().crossVectors(UP, c).normalize(), t2 = new Vector3().crossVectors(c, t1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const d = c.clone().multiplyScalar(0.15).addScaledVector(t1, p.getX(i)).addScaledVector(t2, p.getY(i));
        headAt(d, P, N);
        P.addScaledVector(N, 0.0016);
        p.setXYZ(i, P.x, P.y, P.z);
      }
      g.computeVertexNormals();
      parts.push(g);
    }
    head.add(new Mesh(keep(mergeGeos(parts)), blushMat));
  }

  // boca costurada (linha descendo do nariz e dois arcos) e bigodes de linha
  {
    const lines = [];
    const top = v3(0, noseTop - 0.009, noseZ + 0.002);
    const valley = v3(0, puffC[1].y - MUZ.y * 0.15, Math.min(puffC[1].z, puffC[-1].z) - MUZ.z * 0.62);
    lines.push(thread([top, top.clone().lerp(valley, 0.5).add(v3(0, 0, -0.001)), valley], 0.0013));
    for (const side of [1, -1]) {
      const pts = [valley];
      // arco por baixo de cada almofada, de dentro pra fora ("ω")
      for (const b of [0.35, 0.85, 1.35, 1.85, 2.25]) {
        const q = puffAt(side, v3(-side * Math.cos(b), -Math.sin(b), -0.55));
        pts.push(q.addScaledVector(q.clone().sub(puffC[side]).normalize(), 0.0006));
      }
      lines.push(thread(pts, 0.0012));
      for (const [k, dy] of [[0, 0.012], [1, 0.0], [2, -0.011]]) {
        const s0 = puffAt(side, v3(side, 0.2 - 0.25 * k, -0.6));
        const out = v3(side, 0, 0.12).normalize();
        lines.push(thread([
          s0,
          s0.clone().addScaledVector(out, 0.035).add(v3(0, dy * 0.6 + 0.002, 0)),
          s0.clone().addScaledVector(out, 0.075).add(v3(0, dy * 1.5 - 0.004, 0)),
        ], 0.00095, { segs: 10, radial: 4 }));
      }
    }
    head.add(new Mesh(keep(mergeGeos(lines)), threadMat));
  }

  // orelhas: externa de pelo, interna rosa; giram na base
  const ears = {};
  {
    const outerGeo = keep(earGeometry(0.1, 0.057, 0.038));
    const innerGeo = keep(earGeometry(0.071, 0.036, 0.013));
    for (const side of [1, -1]) {
      headAt(v3(0.6 * side, 0.8, 0.04), P, N);
      const ear = new Group();
      ear.position.copy(P).addScaledVector(N, -0.016);
      const y = N.clone().add(v3(0.16 * side, 0.12, 0.04)).normalize();
      const z = v3(0, 0, 1).addScaledVector(y, -y.z).normalize();
      const x = new Vector3().crossVectors(y, z);
      ear.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
      ear.add(new Mesh(outerGeo, headMat));
      const inner = new Mesh(innerGeo, liningMat);
      inner.position.set(0, 0.016, -0.0118);
      ear.add(inner);
      head.add(ear);
      ears[side] = { ear, base: ear.quaternion.clone() };
    }
  }
  const headSeams = keep(stitchMesh(stitchGeo, threadMat, headStitches));
  head.add(headSeams);

  // ---------- braços, patas e baquetas ----------
  const upperGeo = keep(limb(BODY.upperArm, ...ARM.upper));
  const foreGeo = keep(limb(BODY.foreArm, ...ARM.fore));
  const ballGeo = keep(plainUv1(ellipsoid(ARM.upper[0] * 1.03, ARM.upper[0] * 1.03, ARM.upper[0] * 1.03, { w: 18, h: 12 })));
  const wristGeo = keep(new TorusGeometry(0.043, 0.0135, 8, 24));
  scaleUV(wristGeo, aroundUnits(2 * Math.PI * 0.043), aroundUnits(2 * Math.PI * 0.0135));
  wristGeo.rotateX(Math.PI / 2);
  // pata: luva redonda; frente (+y) = ponta, -z = palma; feijõezinhos na ponta
  const pawGeo = keep(blob((d, out) => {
    ellipsoidPoint(PAW, d, out);
    if (d.z < 0) out.z *= 0.86; // palma mais reta
    out.y += 0.012;
    return out;
  }, { w: 24, h: 18, circ: 0.3, merid: 0.17 }));
  const pawSurface = (d) => {
    const q = ellipsoidPoint(PAW, d.clone().normalize(), new Vector3());
    if (q.z < 0) q.z *= 0.86;
    q.y += 0.012;
    return q;
  };
  const beanGeo = (() => {
    const parts = [];
    const add = (d, rx, ry, rz) => {
      const q = pawSurface(d), n = d.clone().normalize();
      const g = ellipsoid(rx, ry, rz, { w: 14, h: 10 });
      parts.push([g, basisMatrix(q.addScaledVector(n, rz * 0.35), n, v3(0, 0, -1))]);
    };
    for (const [x, y, z] of [[-0.42, 0.78, -0.42], [-0.14, 0.92, -0.36], [0.14, 0.92, -0.36], [0.42, 0.78, -0.42]]) {
      add(v3(x, y, z), 0.0105, 0.0098, 0.006);
    }
    add(v3(0, 0.42, -0.9), 0.019, 0.0145, 0.0075);
    return placed(parts);
  })();
  keep(beanGeo);
  // dedinhos costurados nas costas da pata
  const pawLineGeo = keep(mergeGeos([-1, 1].map((sx) => thread(
    [0.2, 0.55, 0.85].map((a) => {
      const d = v3(sx * 0.17, Math.sin(a + 0.55), Math.cos(a + 0.55));
      const q = pawSurface(d);
      return q.addScaledVector(d.normalize(), 0.0008);
    }), 0.0011))));
  const stickGeo = placed([
    [stickShaft(BODY.stickFront + BODY.stickBack), new Matrix4().makeTranslation(0, (BODY.stickFront - BODY.stickBack) / 2, 0)],
    [ellipsoid(rig.TIP_R, rig.TIP_R, rig.TIP_R, { w: 12, h: 8 }), new Matrix4().makeTranslation(0, BODY.stickFront, 0)],
  ]);
  keep(stickGeo);

  const arms = {};
  for (const limbName of HANDS) {
    const stick = new Group();
    stick.add(new Mesh(stickGeo, stickMat));
    group.add(stick);
    const paw = new Group();
    paw.add(new Mesh(pawGeo, creamMat), new Mesh(beanGeo, pinkMat), new Mesh(pawLineGeo, threadMat));
    group.add(paw);
    const mk = (geo, mat) => { const m = new Mesh(geo, mat); group.add(m); return m; };
    arms[limbName] = {
      ball: mk(ballGeo, furMat),
      upper: mk(upperGeo, furMat),
      fore: mk(foreGeo, furMat),
      band: mk(wristGeo, bandMat[limbName]),
      paw, stick,
    };
  }

  // ---------- pernas e pés ----------
  const thighGeo = keep(limb(BODY.thigh, ...LEG.thigh));
  const shinGeo = keep(limb(BODY.shin, ...LEG.shin));
  const ankleGeo = keep(new TorusGeometry(0.053, 0.0145, 8, 24));
  scaleUV(ankleGeo, aroundUnits(2 * Math.PI * 0.053), aroundUnits(2 * Math.PI * 0.0145));
  ankleGeo.rotateX(Math.PI / 2);
  const footGeo = keep(blob((d, out) => {
    ellipsoidPoint(FOOT.r, d, out);
    if (d.y < 0) out.y *= 0.55; // sola mais reta
    out.x *= 1 + 0.18 * smooth01(-d.z); // mais larga nos dedos
    return out.add(FOOT.c);
  }, { w: 24, h: 16, circ: 0.5, merid: 0.38 }));
  const footSurface = (d) => {
    const q = ellipsoidPoint(FOOT.r, d.clone().normalize(), new Vector3());
    if (d.y < 0) q.y *= 0.55;
    q.x *= 1 + 0.18 * smooth01(-d.clone().normalize().z);
    return q.add(FOOT.c);
  };
  const toeGeo = keep(mergeGeos([-1, 1].map((sx) => thread(
    [0.15, 0.5, 0.95].map((a) => {
      const d = v3(sx * 0.16, Math.sin(a), -Math.cos(a) * 1.0);
      return footSurface(d).addScaledVector(d.normalize(), 0.0008);
    }), 0.0012))));
  const legs = {};
  for (const limbName of FEET) {
    const foot = new Group();
    foot.position.copy(rig.legs[limbName].foot.position);
    foot.add(new Mesh(footGeo, creamMat), new Mesh(toeGeo, threadMat));
    group.add(foot);
    const mk = (geo, mat) => { const m = new Mesh(geo, mat); group.add(m); return m; };
    legs[limbName] = { foot, thigh: mk(thighGeo, furMat), shin: mk(shinGeo, furMat), band: mk(ankleGeo, bandMat[limbName]) };
  }

  // ---------- rabo ----------
  const tail = createTail(keep);
  const tailMesh = new Mesh(tail.geo, furMat);
  tailMesh.frustumCulled = false;
  group.add(tailMesh);

  // ---------- pose ----------
  const tmpV = new Vector3(), tmpA = new Vector3(), tmpZ = new Vector3(), tmpX = new Vector3();
  const tmpM = new Matrix4(), tmpQ = new Quaternion(), tmpQ2 = new Quaternion();
  const AX = new Vector3(1, 0, 0), AZ = new Vector3(0, 0, 1);
  function placeBone(mesh, a, b) {
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(UP, tmpV.subVectors(b, a).normalize());
  }
  function placeRing(mesh, at, toward, back) {
    tmpV.subVectors(toward, at).normalize();
    mesh.position.copy(at).addScaledVector(tmpV, back);
    mesh.quaternion.setFromUnitVectors(UP, tmpV);
  }

  /** Veste o esqueleto (depois de rig.update) e faz os movimentos extras. */
  function update(t, prep) {
    torso.rotation.copy(rig.torso.rotation);
    const clock = prep.clock;
    // cabeça acompanha o pulso; balança de lado a cada 2 tempos
    const pulse = headPulse(clock, t);
    head.rotation.set(HEAD.tilt - 0.045 * pulse, 0, 0.035 * Math.sin(Math.PI * clock.beatAt(t)));
    eyes.scale.y = 1 - 0.88 * blink(t);
    const tw = earTwitch(prep.instHits.crash || [], t);
    for (const side of [1, -1]) {
      const e = ears[side];
      tmpQ.setFromAxisAngle(AX, 0.32 * tw);
      tmpQ2.setFromAxisAngle(AZ, -side * 0.22 * Math.abs(tw));
      e.ear.quaternion.copy(e.base).multiply(tmpQ).multiply(tmpQ2);
    }

    for (const limbName of HANDS) {
      const arm = arms[limbName], r = rig.arms[limbName];
      // bolinha entre o ombro parado e o ombro que avançou
      tmpV.copy(shoulderLocal[limbName]);
      rig.torso.localToWorld(tmpV);
      arm.ball.position.copy(tmpV).add(r.shoulder).multiplyScalar(0.5);
      arm.ball.quaternion.setFromUnitVectors(UP, tmpA.subVectors(r.elbow, r.shoulder).normalize());
      placeBone(arm.upper, r.shoulder, r.elbow);
      placeBone(arm.fore, r.elbow, r.wrist);
      placeRing(arm.band, r.wrist, r.elbow, 0.052);
      // pata: +y ao longo do antebraço, dobrada um pouco pra frente (os
      // feijõezinhos aparecem pra quem olha de frente), palma pra baixo
      tmpA.subVectors(r.wrist, r.elbow).normalize().multiplyScalar(0.7).add(PAW_LEAN).normalize();
      tmpZ.set(0, 1, 0).addScaledVector(tmpA, -tmpA.y);
      if (tmpZ.lengthSq() < 1e-6) tmpZ.copy(r.dir);
      tmpZ.normalize();
      tmpX.crossVectors(tmpA, tmpZ);
      tmpM.makeBasis(tmpX, tmpA, tmpZ);
      arm.paw.quaternion.setFromRotationMatrix(tmpM);
      arm.paw.position.copy(r.wrist);
      arm.stick.position.copy(r.wrist);
      arm.stick.quaternion.setFromUnitVectors(UP, r.dir);
    }
    for (const limbName of FEET) {
      const leg = legs[limbName], r = rig.legs[limbName];
      leg.foot.rotation.x = r.foot.rotation.x;
      placeBone(leg.thigh, r.hip, r.knee);
      placeBone(leg.shin, r.knee, r.ankle);
      placeRing(leg.band, r.ankle, r.knee, 0.05);
    }
    tail.update(clock, t);
  }

  // ---------- cores ----------
  let pal = tex.setPalette(palette);
  let lastTheme = null;
  function paint(theme) {
    lastTheme = theme;
    // a cor da pelagem está na textura; o brilho é a pelagem clareada
    for (const m of [furMat, headMat]) {
      m.color.setRGB(1, 1, 1);
      m.sheenColor.set(pal.fur).lerp(WHITE, 0.5);
    }
    setFelt(creamMat, pal.cream);
    setFelt(pinkMat, pal.pink);
    setFelt(liningMat, pal.lining);
    setFelt(stickMat, theme.stick);
    threadMat.color.set(theme.thread);
    blushMat.color.set(pal.pink);
    blushMat.opacity = theme.dark ? 0.55 : 0.75;
    for (const l of Object.keys(bandMat)) setFelt(bandMat[l], theme.limb[l]);
  }
  function setPalette(name) {
    pal = tex.setPalette(name);
    if (lastTheme) paint(lastTheme);
  }

  /** Debug: centro da bolinha da baqueta no mundo (depois do update). */
  function tipWorld(limbName, out = new Vector3()) {
    const s = arms[limbName].stick;
    s.updateMatrixWorld(true);
    return s.localToWorld(out.set(0, BODY.stickFront, 0));
  }

  return {
    group, update, paint, setPalette, tipWorld,
    dispose() { for (const d of disposables) d.dispose(); },
  };
}

// Baqueta de feltro: afina na ponta (mesmas medidas da do manequim).
function stickShaft(len) {
  const r0 = 0.0085, r1 = 0.0062;
  const pts = [[0, -len / 2 - 0.004], [r0 * 0.7, -len / 2 - 0.003], [r0, -len / 2 + 0.002]];
  for (let k = 1; k <= 6; k++) pts.push([r0 + (r1 - r0) * (k / 6), -len / 2 + len * (k / 6)]);
  pts.push([0, len / 2]);
  return lathe(pts, 10);
}

/**
 * Rabo: tubo que sai de trás do banco, desce e enrola a ponta pra cima. A
 * geometria é refeita na CPU a cada quadro (poucos vértices) a partir de uma
 * curva fixa girada em volta da base, como função pura do tempo.
 */
function createTail(keep) {
  const ROOT = v3(0, 0.6, 0.37);
  const ctrl = [
    v3(0, 0.6, 0.37), v3(0, 0.6, 0.47), v3(0, 0.53, 0.56), v3(0, 0.4, 0.61),
    v3(0, 0.29, 0.66), v3(0, 0.27, 0.75), v3(0, 0.34, 0.82), v3(0, 0.45, 0.83),
  ];
  // amostras da curva em repouso (Catmull-Rom uniforme)
  const NS = 36, NR = 12, R0 = 0.034, R1 = 0.027;
  const rest = [];
  const cr = (p0, p1, p2, p3, u) => {
    const u2 = u * u, u3 = u2 * u;
    return new Vector3(
      0.5 * (2 * p1.x + (-p0.x + p2.x) * u + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3),
      0.5 * (2 * p1.y + (-p0.y + p2.y) * u + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3),
      0.5 * (2 * p1.z + (-p0.z + p2.z) * u + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * u2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * u3));
  };
  const nSeg = ctrl.length - 1;
  for (let i = 0; i <= NS; i++) {
    // mais amostras perto da ponta, pra ela fechar redonda
    const g = (1 - Math.pow(1 - i / NS, 1.6)) * nSeg, k = Math.min(nSeg - 1, Math.floor(g)), u = g - k;
    const p0 = ctrl[Math.max(0, k - 1)], p1 = ctrl[k], p2 = ctrl[k + 1], p3 = ctrl[Math.min(nSeg, k + 2)];
    rest.push(cr(p0, p1, p2, p3, u));
  }
  const arc = [0];
  for (let i = 1; i <= NS; i++) arc.push(arc[i - 1] + rest[i].distanceTo(rest[i - 1]));
  const total = arc[NS];
  // raio: afina devagar e fecha a ponta como meia esfera
  const radius = arc.map((a) => {
    const s = a / total, r = R0 + (R1 - R0) * s, tipLen = r * 1.25;
    const fromTip = total - a;
    return fromTip >= tipLen ? r : r * Math.sqrt(Math.max(0, 1 - ((tipLen - fromTip) / tipLen) ** 2));
  });
  const nv = (NS + 1) * (NR + 1);
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = [];
  const uv1 = new Float32Array(nv * 2);
  const tipStart = arc[radius.findIndex((r, i) => i > 0 && r < radius[i - 1] * 0.98)] || total;
  const nu = aroundUnits(2 * Math.PI * R0);
  for (let i = 0; i <= NS; i++) {
    for (let j = 0; j <= NR; j++) {
      const o = i * (NR + 1) + j;
      uv[o * 2] = (j / NR) * nu;
      uv[o * 2 + 1] = arc[i] / TILE;
      uv1[o * 2] = uv[o * 2];
      uv1[o * 2 + 1] = Math.min(arc[i], tipStart) / TILE; // ponta lisa, sem juntar listra
    }
  }
  for (let i = 0; i < NS; i++) {
    for (let j = 0; j < NR; j++) {
      const a = i * (NR + 1) + j, b = a + NR + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geo = keep(new BufferGeometry());
  const posAttr = new BufferAttribute(pos, 3), norAttr = new BufferAttribute(nor, 3);
  geo.setAttribute("position", posAttr);
  geo.setAttribute("normal", norAttr);
  geo.setAttribute("uv", new BufferAttribute(uv, 2));
  geo.setAttribute("uv1", new BufferAttribute(uv1, 2));
  geo.setIndex(idx);
  geo.boundingSphere = new Sphere(ROOT.clone().add(v3(0, -0.1, 0.25)), 0.6);
  geo.userData.dynamic = true;

  const C = rest.map(() => new Vector3());
  const T = new Vector3(), Nn = new Vector3(), B = new Vector3(), Xr = new Vector3(), D = new Vector3();
  const AMP = 0.42;
  function update(clock, t) {
    for (let i = 0; i <= NS; i++) {
      const s = arc[i] / total, ang = AMP * tailSway(clock, t, s);
      const dx = rest[i].x - ROOT.x, dz = rest[i].z - ROOT.z, c = Math.cos(ang), sn = Math.sin(ang);
      C[i].set(ROOT.x + dx * c + dz * sn, rest[i].y + 0.012 * Math.sin(ang * 2) * s, ROOT.z - dx * sn + dz * c);
    }
    for (let i = 0; i <= NS; i++) {
      T.subVectors(C[Math.min(NS, i + 1)], C[Math.max(0, i - 1)]).normalize();
      const s = arc[i] / total, ang = AMP * tailSway(clock, t, s);
      Xr.set(Math.cos(ang), 0, -Math.sin(ang));
      Nn.copy(Xr).addScaledVector(T, -Xr.dot(T)).normalize();
      B.crossVectors(T, Nn);
      // inclinação da normal onde o raio muda (fecha a ponta)
      const dr = i < NS ? (radius[i + 1] - radius[Math.max(0, i - 1)]) / (arc[i + 1] - arc[Math.max(0, i - 1)]) : -4;
      const k = Math.max(-6, Math.min(6, dr));
      for (let j = 0; j <= NR; j++) {
        const th = (j / NR) * Math.PI * 2, ct = Math.cos(th), st = Math.sin(th);
        const o = (i * (NR + 1) + j) * 3, r = radius[i];
        D.set(Nn.x * ct + B.x * st, Nn.y * ct + B.y * st, Nn.z * ct + B.z * st);
        pos[o] = C[i].x + D.x * r; pos[o + 1] = C[i].y + D.y * r; pos[o + 2] = C[i].z + D.z * r;
        D.addScaledVector(T, -k).normalize();
        nor[o] = D.x; nor[o + 1] = D.y; nor[o + 2] = D.z;
      }
    }
    posAttr.needsUpdate = true;
    norAttr.needsUpdate = true;
  }
  return { geo, update };
}
