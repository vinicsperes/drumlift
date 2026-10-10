// Ossos do gato de pelúcia. Quem decide a pose continua sendo o esqueleto de
// rig.js (IK de ombro-cotovelo-pulso e quadril-joelho-tornozelo); aqui os
// ossos só seguem essas juntas, e ganham a ação secundária de plushmotion.js.
//
// A pose de ligação (onde a malha é gerada) é a pose sentada tocando, com as
// duas mãos na caixa: braços dobrados pra frente, pés nos pedais. Assim a
// deformação nas juntas fica pequena durante a música.

import { Euler, Matrix4, Quaternion, Vector3 } from "../vendor/three.module.min.js";
import { createRig } from "./rig.js";
import { FEET, HANDS } from "./rig.js";
import { TAIL_BONES, catMotion } from "./plushmotion.js";

const v3 = (x, y, z) => new Vector3(x, y, z);

export const BONE_NAMES = [
  "pelve", "coluna", "peito", "barriga", "cabeca", "orelhaE", "orelhaD", "olhos",
  ...HANDS.flatMap((l) => [`ombro${l}`, `braco${l}`, `antebraco${l}`, `pata${l}`, `baqueta${l}`]),
  ...FEET.flatMap((l) => [`coxa${l}`, `canela${l}`, `pe${l}`]),
  ...Array.from({ length: TAIL_BONES }, (_, i) => `rabo${i}`),
];
export const B = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));

// ---------- medidas (m) ----------
// No espaço do tronco (origem na pelve, igual a rig.torso):
export const NECK = v3(0, 0.585, -0.03);  // pivô da cabeça
export const HEAD_TILT = -0.11;           // olhando pra caixa
export const BELLY_C = v3(0, 0.15, -0.09);
// No espaço da cabeça (origem no pescoço, já inclinada). A cabeça é um pouco
// maior que a de gente, como num bicho de pelúcia; o esqueleto não muda.
export const HEAD_SCALE = 1.14;
const hs = (x, y, z) => v3(x, y, z).multiplyScalar(HEAD_SCALE);
export const SKULL = { c: hs(0, 0.113, 0), r: hs(0.139, 0.119, 0.125) };
export const EYE_C = hs(0, 0.14, -0.11); // centro dos olhos (pivô da piscada)
export const EAR = {
  dir: [0.58, 0.8, 0.12], len: 0.098 * HEAD_SCALE, r1: 0.048 * HEAD_SCALE, r2: 0.0145 * HEAD_SCALE, flat: 0.7, out: 0.22,
};
// Rabo: curva na pose de ligação (mundo), saindo de dentro do quadril.
export const TAIL_CURVE = [
  v3(0, 0.62, 0.35), v3(0, 0.61, 0.47), v3(0, 0.53, 0.56), v3(0, 0.41, 0.615),
  v3(0, 0.3, 0.665), v3(0, 0.275, 0.75), v3(0, 0.335, 0.82), v3(0, 0.44, 0.835),
];

/** Ponto da superfície do crânio (espaço da cabeça) na direção d, e a normal. */
export function skullPoint(d, outP, outN) {
  const r = SKULL.r, n = d.clone().normalize();
  const s = 1 / Math.sqrt((n.x / r.x) ** 2 + (n.y / r.y) ** 2 + (n.z / r.z) ** 2);
  outP.copy(n).multiplyScalar(s).add(SKULL.c);
  if (outN) outN.set((outP.x - SKULL.c.x) / (r.x * r.x), (outP.y - SKULL.c.y) / (r.y * r.y), (outP.z - SKULL.c.z) / (r.z * r.z)).normalize();
  return outP;
}

/** Base e orientação de cada orelha no espaço da cabeça (y = pra ponta, z = pra trás). */
export const EARS = [-1, 1].map((side) => {
  const P = new Vector3(), N = new Vector3();
  skullPoint(v3(EAR.dir[0] * side, EAR.dir[1], EAR.dir[2]), P, N);
  const y = N.clone().add(v3(EAR.out * side, 0.2, 0.06)).normalize();
  const z = v3(0, 0, 1).addScaledVector(y, -y.z).normalize();
  const x = new Vector3().crossVectors(y, z);
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
  return { side, base: P.addScaledVector(N, -0.014), q };
});

// Pose de ligação: as duas mãos descendo pra caixa, baqueta um pouco levantada.
function bindPrep() {
  const hit = { t: 1, inst: "snare", vel: 1, ghost: false, piece: "snare" };
  return {
    limbs: { MD: [hit], ME: [{ ...hit }], PD: [], PE: [] },
    instHits: {}, clock: { beatAt: () => 0.25, beatLen: () => 0.5 },
  };
}
const BIND_T = 1 - 0.03;

const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);

/** Matriz com origem o, eixo y = yDir e x o mais perto possível de xHint. */
function frame(o, yDir, xHint, out) {
  const y = yDir.clone().normalize();
  const x = xHint.clone().addScaledVector(y, -xHint.dot(y));
  if (x.lengthSq() < 1e-10) x.set(1, 0, 0).addScaledVector(y, -y.x);
  x.normalize();
  const z = new Vector3().crossVectors(x, y);
  return out.makeBasis(x, y, z).setPosition(o);
}

/** Tira a torção em volta de `axis` de uma rotação (fica só o "balanço"). */
function swingOnly(q, axis, out) {
  const p = axis.dot(new Vector3(q.x, q.y, q.z));
  const twist = new Quaternion(axis.x * p, axis.y * p, axis.z * p, q.w);
  if (twist.lengthSq() < 1e-12) return out.copy(q);
  twist.normalize();
  return out.copy(q).multiply(twist.invert());
}

/**
 * Cria os ossos do gato. `bones` são as matrizes de mundo (uma por osso);
 * `bind` as mesmas na pose de ligação; `joints` as juntas da pose de ligação.
 * `update(rig, t, prep)` recalcula tudo depois de rig.update.
 */
export function createCatBones() {
  const n = BONE_NAMES.length;
  const bones = Array.from({ length: n }, () => new Matrix4());
  const bind = Array.from({ length: n }, () => new Matrix4());

  // tmp
  const tA = new Vector3(), tB = new Vector3(), tC = new Vector3(), hinge = new Vector3();
  const qA = new Quaternion(), qB = new Quaternion(), qC = new Quaternion();
  const mA = new Matrix4(), mB = new Matrix4(), mC = new Matrix4();
  const torsoQ = new Quaternion(), bindTorsoQ = new Quaternion();
  const pelvis = new Vector3();
  const eul = new Euler();

  // relações fixas medidas na pose de ligação
  const bindLocal = { ua: {}, stickDirFA: {} }; // braço (no tronco) e baqueta (no antebraço)
  const tailRel = [], tailLen = [];
  let bound = false;
  const motion = { tail: new Float64Array(TAIL_BONES * 2) };

  function limbHinge(a, b, c, fallback, out) {
    tA.subVectors(b, a); tB.subVectors(c, b);
    out.crossVectors(tA, tB);
    if (out.lengthSq() < 1e-10) out.copy(fallback);
    return out.normalize();
  }

  function compute(rig, m) {
    pelvis.copy(rig.torso.position);
    torsoQ.copy(rig.torso.quaternion);
    // pelve parada (é onde o gato senta)
    bones[B.pelve].makeRotationFromQuaternion(bindTorsoQ).setPosition(pelvis);
    // peito = tronco do esqueleto + um pouquinho de atraso no golpe
    qA.setFromEuler(eul.set(m.chestPitch, 0, m.chestRoll, "XYZ"));
    qB.copy(torsoQ).multiply(qA);
    bones[B.peito].makeRotationFromQuaternion(qB).setPosition(pelvis);
    qC.copy(bindTorsoQ).slerp(qB, 0.5);
    bones[B.coluna].makeRotationFromQuaternion(qC).setPosition(pelvis);
    // barriga: sacode pra frente e balança um pouquinho em volta do centro
    // dela (só movimento rígido: o corpo usa skinning de quatérnio duplo)
    const j = m.belly;
    qA.setFromAxisAngle(X, j * 2.2);
    mA.makeTranslation(BELLY_C.x, BELLY_C.y - j * 0.4, BELLY_C.z - j)
      .multiply(mB.makeRotationFromQuaternion(qA))
      .multiply(mC.makeTranslation(-BELLY_C.x, -BELLY_C.y, -BELLY_C.z));
    bones[B.barriga].multiplyMatrices(bones[B.coluna], mA);
    // cabeça
    qA.setFromEuler(eul.set(HEAD_TILT + m.headPitch, m.headYaw, m.headRoll, "YXZ"));
    mA.makeRotationFromQuaternion(qA).setPosition(NECK);
    bones[B.cabeca].multiplyMatrices(bones[B.peito], mA);
    EARS.forEach((e, k) => {
      qA.setFromAxisAngle(X, m.earPitch);
      qB.setFromAxisAngle(Z, -e.side * m.earRoll);
      qC.copy(e.q).multiply(qA).multiply(qB);
      mA.makeRotationFromQuaternion(qC).setPosition(e.base);
      bones[k === 0 ? B.orelhaE : B.orelhaD].multiplyMatrices(bones[B.cabeca], mA);
    });
    // olhos: piscam (achatam em y em volta do centro deles)
    const ey = EYE_C;
    mA.makeTranslation(ey.x, ey.y, ey.z).multiply(mB.makeScale(1, Math.max(0.08, 1 - 0.9 * m.blink), 1))
      .multiply(mC.makeTranslation(-ey.x, -ey.y, -ey.z));
    bones[B.olhos].multiplyMatrices(bones[B.cabeca], mA);

    // braços
    for (const l of HANDS) {
      const a = rig.arms[l];
      const fb = tC.set(l === "MD" ? 1 : -1, -0.55, 0.35).normalize().applyQuaternion(torsoQ);
      limbHinge(a.shoulder, a.elbow, a.wrist, fb, hinge);
      const upper = tB.subVectors(a.elbow, a.shoulder).normalize().clone();
      frame(a.shoulder, upper, hinge, bones[B[`braco${l}`]]);
      frame(a.elbow, tA.subVectors(a.wrist, a.elbow), hinge, bones[B[`antebraco${l}`]]);
      // ombro: só balança a partir da pose de ligação (sem torcer), relativo ao peito
      const chestQ = qB.setFromRotationMatrix(bones[B.peito]);
      if (bound) {
        const yNow = upper.clone().applyQuaternion(chestQ.clone().invert());
        qA.setFromUnitVectors(bindLocal.ua[l].y, yNow);
        qC.copy(chestQ).multiply(qA).multiply(bindLocal.ua[l].q);
        bones[B[`ombro${l}`]].makeRotationFromQuaternion(qC).setPosition(a.shoulder);
      } else {
        bones[B[`ombro${l}`]].copy(bones[B[`braco${l}`]]);
      }
      // pata: segue a baqueta pela metade, sem torcer em volta do antebraço
      const fa = bones[B[`antebraco${l}`]];
      const faQ = qA.setFromRotationMatrix(fa);
      if (bound) {
        const dNow = a.dir.clone().applyQuaternion(faQ.clone().invert());
        qB.setFromUnitVectors(bindLocal.stickDirFA[l], dNow);
        swingOnly(qB, Y, qC);
        qC.slerp(qB.identity(), 0.45);
        qB.copy(faQ).multiply(qC);
        bones[B[`pata${l}`]].makeRotationFromQuaternion(qB).setPosition(a.wrist);
      } else {
        bones[B[`pata${l}`]].copy(fa).setPosition(a.wrist);
      }
      // baqueta: rígida no pulso, na direção do esqueleto
      qA.setFromUnitVectors(Y, a.dir);
      bones[B[`baqueta${l}`]].makeRotationFromQuaternion(qA).setPosition(a.wrist);
    }

    // pernas
    for (const l of FEET) {
      const g = rig.legs[l];
      limbHinge(g.hip, g.knee, g.ankle, X, hinge);
      frame(g.hip, tA.subVectors(g.knee, g.hip), hinge, bones[B[`coxa${l}`]]);
      frame(g.knee, tA.subVectors(g.ankle, g.knee), hinge, bones[B[`canela${l}`]]);
      g.foot.updateMatrixWorld(true);
      bones[B[`pe${l}`]].copy(g.foot.matrixWorld);
    }

    // rabo: corrente presa na pelve
    if (bound) {
      let parent = bones[B.pelve];
      for (let i = 0; i < TAIL_BONES; i++) {
        qA.setFromAxisAngle(Z, m.tail[i * 2]);
        qB.setFromAxisAngle(X, m.tail[i * 2 + 1]);
        mA.copy(tailRel[i]).multiply(mB.makeRotationFromQuaternion(qA.multiply(qB)));
        bones[B.rabo0 + i].multiplyMatrices(parent, mA);
        parent = bones[B.rabo0 + i];
      }
    }
  }

  // ---------- pose de ligação ----------
  const bindRig = createRig();
  bindRig.update(BIND_T, bindPrep(), 0);
  bindTorsoQ.copy(bindRig.torso.quaternion);
  const zero = { chestPitch: 0, chestRoll: 0, headPitch: 0, headRoll: 0, headYaw: 0, earPitch: 0, earRoll: 0, belly: 0, blink: 0, tail: new Float64Array(TAIL_BONES * 2) };
  compute(bindRig, zero);
  // rabo na pose de ligação: um osso por trecho da curva amostrada
  const tailPts = sampleTail(TAIL_BONES);
  for (let i = 0; i < TAIL_BONES; i++) {
    frame(tailPts[i], tA.subVectors(tailPts[i + 1], tailPts[i]), X, bones[B.rabo0 + i]);
  }
  for (let i = 0; i < TAIL_BONES; i++) {
    const parent = i === 0 ? bones[B.pelve] : bones[B.rabo0 + i - 1];
    tailRel.push(parent.clone().invert().multiply(bones[B.rabo0 + i]));
    tailLen.push(tailPts[i + 1].distanceTo(tailPts[i]));
  }
  {
    const chestQ = new Quaternion().setFromRotationMatrix(bones[B.peito]), inv = chestQ.clone().invert();
    for (const l of HANDS) {
      const a = bindRig.arms[l];
      const uaQ = new Quaternion().setFromRotationMatrix(bones[B[`braco${l}`]]);
      bindLocal.ua[l] = {
        y: a.elbow.clone().sub(a.shoulder).normalize().applyQuaternion(inv),
        q: inv.clone().multiply(uaQ),
      };
      const faQ = new Quaternion().setFromRotationMatrix(bones[B[`antebraco${l}`]]);
      bindLocal.stickDirFA[l] = a.dir.clone().applyQuaternion(faQ.invert());
    }
  }
  bones.forEach((m, i) => bind[i].copy(m));
  bound = true;

  const joints = {
    pelvis: bindRig.torso.position.clone(),
    arms: Object.fromEntries(HANDS.map((l) => {
      const a = bindRig.arms[l];
      return [l, { shoulder: a.shoulder.clone(), elbow: a.elbow.clone(), wrist: a.wrist.clone(), dir: a.dir.clone() }];
    })),
    legs: Object.fromEntries(FEET.map((l) => {
      const g = bindRig.legs[l];
      return [l, { hip: g.hip.clone(), knee: g.knee.clone(), ankle: g.ankle.clone() }];
    })),
    tail: tailPts,
  };

  return {
    bones, bind, joints,
    /** Ossos no tempo t (chamar depois de rig.update). */
    update(rig, t, prep) {
      catMotion(prep, t, motion);
      compute(rig, motion);
      return motion;
    },
  };
}

/** Amostra a curva do rabo (Catmull-Rom) em n trechos de comprimento igual. */
export function sampleTail(n) {
  const c = TAIL_CURVE, dense = [];
  const cr = (p0, p1, p2, p3, u) => {
    const u2 = u * u, u3 = u2 * u;
    const f = (a, b, cc, d) => 0.5 * (2 * b + (-a + cc) * u + (2 * a - 5 * b + 4 * cc - d) * u2 + (-a + 3 * b - 3 * cc + d) * u3);
    return v3(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z));
  };
  const segs = c.length - 1;
  for (let k = 0; k < segs; k++) {
    for (let s = 0; s < 16; s++) {
      dense.push(cr(c[Math.max(0, k - 1)], c[k], c[k + 1], c[Math.min(segs, k + 2)], s / 16));
    }
  }
  dense.push(c[segs].clone());
  const arc = [0];
  for (let i = 1; i < dense.length; i++) arc.push(arc[i - 1] + dense[i].distanceTo(dense[i - 1]));
  const total = arc[arc.length - 1], out = [];
  for (let k = 0, j = 0; k <= n; k++) {
    const want = (k / n) * total;
    while (j < arc.length - 2 && arc[j + 1] < want) j++;
    const u = (want - arc[j]) / (arc[j + 1] - arc[j] || 1);
    out.push(dense[j].clone().lerp(dense[j + 1], Math.min(1, Math.max(0, u))));
  }
  return out;
}
