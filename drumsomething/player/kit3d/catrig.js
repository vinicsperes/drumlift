// Ossos do gato de pelúcia. Quem decide a pose é o esqueleto humano
// (skeleton.js, guiado por rig.js): os ossos do gato são os mesmos, com os
// mesmos índices, e ganham alguns a mais só dele: a cabeça de pelúcia (com
// orelhas e olhos que piscam), a barriga que sacode, o rabo e um "ombro" sem
// torção pro estofado entre o braço e o peito. A ação secundária vem de
// plushmotion.js.
//
// A pose de ligação (onde a malha é gerada) é a pose sentada tocando, com as
// duas mãos na caixa: braços dobrados pra frente, pés nos pedais. Assim a
// deformação nas juntas fica pequena durante a música.

import { Euler, Matrix4, Quaternion, Vector3 } from "../vendor/three.module.min.js";
import { createRig } from "./rig.js";
import { BONE as SK, BONES as SK_BONES, FEET, HANDS, SKEL } from "./skeleton.js";
import { TAIL_BONES, catMotion } from "./plushmotion.js";

const v3 = (x, y, z) => new Vector3(x, y, z);

export const BONE_NAMES = [
  ...SK_BONES,
  ...HANDS.map((l) => `ombro${l}`),
  "cabeca", "barriga", "orelhaE", "orelhaD", "olhos",
  ...Array.from({ length: TAIL_BONES }, (_, i) => `rabo${i}`),
];
export const B = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));
// nomes do gato pros ossos do esqueleto
Object.assign(B, { pelve: SK.hips, lombar: SK.spine, coluna: SK.spine1, peito: SK.chest });
for (const l of HANDS) {
  Object.assign(B, {
    [`clavicula${l}`]: SK[`clav.${l}`], [`braco${l}`]: SK[`arm.${l}`], [`antebraco${l}`]: SK[`forearm.${l}`],
    [`torcao${l}`]: SK[`twist.${l}`], [`pata${l}`]: SK[`hand.${l}`], [`baqueta${l}`]: SK[`stick.${l}`],
    [`polegar${l}`]: SK[`thumb1.${l}`], [`polegar2${l}`]: SK[`thumb2.${l}`],
    [`dedos${l}`]: SK[`middle1.${l}`], [`dedos2${l}`]: SK[`middle2.${l}`],
  });
}
for (const l of FEET) Object.assign(B, { [`coxa${l}`]: SK[`thigh.${l}`], [`canela${l}`]: SK[`shin.${l}`], [`pe${l}`]: SK[`foot.${l}`], [`dedao${l}`]: SK[`toe.${l}`] });

// ---------- medidas (m) ----------
// A cabeça de pelúcia gira no alto do pescoço, um pouco abaixo da base do
// crânio do esqueleto (o gato quase não tem pescoço).
const HEAD_PIVOT = v3(0, -0.048, -0.018); // no espaço do osso "head"
export const HEAD_TILT = 0.06;             // a cabeça do esqueleto já olha pra caixa
// Barriga: centro no espaço da lombar.
export const BELLY_C = v3(0, 0.055, -0.085);
// No espaço da cabeça (origem no pivô, já inclinada). A cabeça é um pouco
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
  const tA = new Vector3(), shoulder = new Vector3();
  const qA = new Quaternion(), qB = new Quaternion(), qC = new Quaternion(), chestInv = new Quaternion();
  const mA = new Matrix4(), mB = new Matrix4(), mC = new Matrix4();
  const eul = new Euler();

  // relações fixas medidas na pose de ligação
  const shoulderBind = {}; // braço no espaço do peito
  const tailRel = [];
  let bound = false;
  const motion = { tail: new Float64Array(TAIL_BONES * 2) };

  function compute(rig, m) {
    const sk = rig.skel.bones;
    for (let i = 0; i < SK_BONES.length; i++) bones[i].copy(sk[i]);
    // peito: um pouquinho de atraso no golpe (só o estofado; os braços já saíram do esqueleto)
    qA.setFromEuler(eul.set(m.chestPitch, 0, m.chestRoll, "XYZ"));
    bones[B.peito].multiply(mA.makeRotationFromQuaternion(qA));
    // barriga: sacode pra frente e balança um pouquinho em volta do centro
    // dela (só movimento rígido: o corpo usa skinning de quatérnio duplo)
    const j = m.belly;
    qA.setFromAxisAngle(X, j * 2.2);
    mA.makeTranslation(BELLY_C.x, BELLY_C.y - j * 0.4, BELLY_C.z - j)
      .multiply(mB.makeRotationFromQuaternion(qA))
      .multiply(mC.makeTranslation(-BELLY_C.x, -BELLY_C.y, -BELLY_C.z));
    bones[B.barriga].multiplyMatrices(bones[B.lombar], mA);
    // cabeça de pelúcia: no alto do pescoço, seguindo a cabeça do esqueleto
    qA.setFromEuler(eul.set(HEAD_TILT + m.headPitch, m.headYaw, m.headRoll, "YXZ"));
    mA.makeRotationFromQuaternion(qA).setPosition(HEAD_PIVOT);
    bones[B.cabeca].multiplyMatrices(sk[SK.head], mA);
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

    // ombro: só balança a partir da pose de ligação (sem torcer), relativo ao
    // peito, pra o estofado entre braço e peito não torcer junto com o braço
    const chestQ = qB.setFromRotationMatrix(bones[B.peito]);
    chestInv.copy(chestQ).invert();
    for (const l of HANDS) {
      const arm = sk[SK[`arm.${l}`]];
      if (bound) {
        shoulder.setFromMatrixPosition(arm);
        tA.setFromMatrixPosition(sk[SK[`forearm.${l}`]]).sub(shoulder).normalize().applyQuaternion(chestInv);
        qA.setFromUnitVectors(shoulderBind[l].y, tA);
        qC.copy(chestQ).multiply(qA).multiply(shoulderBind[l].q);
        bones[B[`ombro${l}`]].makeRotationFromQuaternion(qC).setPosition(shoulder);
      } else {
        bones[B[`ombro${l}`]].copy(arm);
      }
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
  }
  {
    const inv = new Quaternion().setFromRotationMatrix(bones[B.peito]).invert();
    const P = bindRig.skel.pos;
    for (const l of HANDS) {
      const armQ = new Quaternion().setFromRotationMatrix(bones[SK[`arm.${l}`]]);
      shoulderBind[l] = {
        y: P[SK[`forearm.${l}`]].clone().sub(P[SK[`arm.${l}`]]).normalize().applyQuaternion(inv),
        q: inv.clone().multiply(armQ),
      };
    }
  }
  bones.forEach((m, i) => bind[i].copy(m));
  bound = true;

  const P = bindRig.skel.pos;
  const joints = {
    pelvis: P[SK.hips].clone(),
    spine: P[SK.spine].clone(), spine1: P[SK.spine1].clone(), chest: P[SK.chest].clone(), neck: P[SK.neck].clone(),
    arms: Object.fromEntries(HANDS.map((l) => [l, {
      clavicle: P[SK[`clav.${l}`]].clone(), shoulder: P[SK[`arm.${l}`]].clone(), elbow: P[SK[`forearm.${l}`]].clone(),
      wrist: P[SK[`hand.${l}`]].clone(), fulcrum: P[SK[`stick.${l}`]].clone(),
    }])),
    legs: Object.fromEntries(FEET.map((l) => [l, {
      hip: P[SK[`thigh.${l}`]].clone(), knee: P[SK[`shin.${l}`]].clone(), ankle: P[SK[`foot.${l}`]].clone(),
      ball: P[SK[`toe.${l}`]].clone(),
    }])),
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

export { SKEL };
