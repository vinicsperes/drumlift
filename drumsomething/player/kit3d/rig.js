// Esqueleto do baterista, sem malha: tronco, braços e pernas com IK de dois
// ossos e a direção de cada baqueta, tudo como função pura do tempo. Os estilos
// só vestem este esqueleto, então o golpe é o mesmo em qualquer visual.
//
// Pra cada mão e cada peça há uma "configuração de golpe" (pulso + direção da
// baqueta) em que a ponta encosta exatamente no ponto de contato da peça; a
// animação interpola entre essas configurações e levanta a baqueta no meio.

import { Object3D, Quaternion, Vector3 } from "../vendor/three.module.min.js";
import { BODY, HIHAT_PEDAL, KICK_PEDAL, SHOULDER_REACH, TORSO_LIMIT, TORSO_REACH } from "./layout.js";
import { contact, pedalAngle, strikeAngle } from "./pieces.js";
import { handState } from "./motion.js";
import { solveTwoBone } from "./ik.js";

const UP = new Vector3(0, 1, 0);
export const HANDS = ["MD", "ME"];
export const FEET = ["PD", "PE"];
const HAND_TARGETS = ["snare", "hihat", "tom1", "tom2", "floor", "crash", "ride"];
export const TIP_R = 0.0085; // raio da bolinha na ponta da baqueta

export function createRig() {
  const pelvis = new Vector3(...BODY.pelvis);

  // Tronco: origem na pelve; os ombros e a cabeça ficam no espaço dele.
  const torso = new Object3D();
  torso.position.copy(pelvis);
  torso.rotation.order = "YXZ";

  const shoulderLocal = {
    MD: new Vector3(BODY.shoulder[0], BODY.shoulder[1], BODY.shoulder[2]),
    ME: new Vector3(-BODY.shoulder[0], BODY.shoulder[1], BODY.shoulder[2]),
  };
  const elbowPoleLocal = { MD: new Vector3(1, -0.55, 0.35).normalize(), ME: new Vector3(-1, -0.55, 0.35).normalize() };

  const arms = {};
  for (const limb of HANDS) {
    arms[limb] = {
      state: { a: "snare", b: "snare", w: 1, h: 0 },
      shoulder: new Vector3(), elbow: new Vector3(), wrist: new Vector3(),
      dir: new Vector3(0, 1, 0), // direção da baqueta (do pulso pra ponta)
      reached: true,
    };
  }

  const legs = {};
  for (const [limb, pedal, side] of [["PD", KICK_PEDAL, 1], ["PE", HIHAT_PEDAL, -1]]) {
    const foot = new Object3D(); // no eixo do pedal; rotation.x = ângulo do pé
    foot.position.set(...pedal.hinge);
    legs[limb] = {
      foot,
      hip: new Vector3(BODY.hip[0] * side, BODY.hip[1], BODY.hip[2]).add(pelvis),
      pole: new Vector3(0.3 * side, 0.6, -1).normalize(),
      knee: new Vector3(), ankle: new Vector3(), reached: true,
    };
  }
  legs.PE.foot.rotation.x = HIHAT_PEDAL.angle;

  // ---------- configurações de golpe ----------
  // Pulso H0 e direção d0 tais que H0 + d0 * stickFront = centro da bolinha
  // encostada na superfície (P + n * TIP_R).
  const configs = { MD: {}, ME: {} };
  {
    const P = new Vector3(), n = new Vector3(), hd = new Vector3();
    for (const limb of HANDS) {
      const [ax, az] = BODY.anchor[limb];
      for (const id of HAND_TARGETS) {
        contact(id, limb, P, n);
        hd.set(P.x - ax, 0, P.z - az).normalize();
        const along = hd.clone().addScaledVector(n, -hd.dot(n)).normalize();
        const beta = strikeAngle(id);
        const d0 = along.multiplyScalar(Math.cos(beta)).addScaledVector(n, -Math.sin(beta)).normalize();
        const tip = P.clone().addScaledVector(n, TIP_R);
        const H0 = tip.clone().addScaledVector(d0, -BODY.stickFront);
        configs[limb][id] = { P: P.clone(), n: n.clone(), tip, d0, H0 };
      }
    }
  }

  // ---------- pose ----------
  const tmpV = new Vector3(), tmpK = new Vector3(), tmpH = new Vector3();
  const tmpQ = new Quaternion(), pole = new Vector3();
  const reach = (limb, id) => TORSO_REACH[limb][id] || TORSO_REACH[limb].snare;

  /** Calcula o esqueleto inteiro no tempo t. `press` = pedal do bumbo (0..1). */
  function update(t, prep, press) {
    const limbs = prep.limbs;
    handState(limbs.MD, BODY.home.MD, t, arms.MD.state);
    handState(limbs.ME, BODY.home.ME, t, arms.ME.state);

    // tronco: gira e inclina na direção das peças longe; balança de leve no tempo
    let yaw = 0, lean = 0;
    for (const limb of HANDS) {
      const s = arms[limb].state, ra = reach(limb, s.a), rb = reach(limb, s.b);
      yaw += ra[0] + (rb[0] - ra[0]) * s.w;
      lean += ra[1] + (rb[1] - ra[1]) * s.w;
    }
    yaw = Math.max(-TORSO_LIMIT.yaw, Math.min(TORSO_LIMIT.yaw, yaw));
    lean = Math.min(TORSO_LIMIT.lean, lean);
    const phase = prep.clock.beatAt(t) % 1;
    const bob = TORSO_LIMIT.bob * (0.5 + 0.5 * Math.cos(2 * Math.PI * phase));
    torso.rotation.set(-(BODY.leanBase + lean + bob), yaw, 0);
    torso.updateMatrixWorld(true);
    tmpQ.copy(torso.quaternion);

    for (const limb of HANDS) {
      const arm = arms[limb], s = arm.state, d = arm.dir;
      const ca = configs[limb][s.a] || configs[limb][BODY.home[limb]];
      const cb = configs[limb][s.b] || configs[limb][BODY.home[limb]];
      // pose base entre duas configurações de golpe
      tmpH.lerpVectors(ca.H0, cb.H0, s.w);
      d.lerpVectors(ca.d0, cb.d0, s.w).normalize();
      // levantar: pulso sobe e recua, baqueta gira pra cima em volta do pulso
      if (s.h > 0) {
        tmpV.set(d.x, 0, d.z).normalize();
        tmpH.addScaledVector(UP, BODY.liftUp * s.h).addScaledVector(tmpV, -BODY.liftBack * s.h);
        tmpK.crossVectors(d, UP).normalize();
        d.applyAxisAngle(tmpK, BODY.liftAngle * s.h);
      }
      arm.shoulder.copy(shoulderLocal[limb]);
      torso.localToWorld(arm.shoulder);
      // alvo longe: o ombro avança um pouco na direção dele
      tmpV.subVectors(tmpH, arm.shoulder);
      const excess = tmpV.length() - (BODY.upperArm + BODY.foreArm - 0.005);
      if (excess > 0) arm.shoulder.addScaledVector(tmpV.normalize(), Math.min(excess, SHOULDER_REACH));
      pole.copy(elbowPoleLocal[limb]).applyQuaternion(tmpQ);
      arm.reached = solveTwoBone(arm.shoulder, tmpH, BODY.upperArm, BODY.foreArm, pole, arm.elbow, arm.wrist);
    }

    // pé direito: calcanhar parado no pedal, ponta desce junto com ele
    legs.PD.foot.rotation.x = pedalAngle(press);
    for (const limb of FEET) {
      const leg = legs[limb];
      leg.foot.updateMatrixWorld(true);
      tmpV.set(...BODY.ankle);
      leg.foot.localToWorld(tmpV);
      leg.reached = solveTwoBone(leg.hip, tmpV, BODY.thigh, BODY.shin, leg.pole, leg.knee, leg.ankle);
    }
  }

  return { torso, arms, legs, configs, update, TIP_R };
}
