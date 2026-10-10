// Baterista estilizado: manequim de cápsulas e esferas sentado no banco.
// Braços e pernas com IK de dois ossos; uma baqueta em cada mão.
// Pra cada mão e cada peça há uma "configuração de golpe" (pulso + direção da
// baqueta) em que a ponta encosta exatamente no ponto de contato da peça; a
// animação interpola entre essas configurações e levanta a baqueta no meio.

import {
  BoxGeometry, CapsuleGeometry, CylinderGeometry, Group, Mesh, MeshLambertMaterial,
  Quaternion, SphereGeometry, Vector3,
} from "../vendor/three.module.min.js";
import { BODY, HIHAT_PEDAL, KICK_PEDAL, SHOULDER_REACH, TORSO_LIMIT, TORSO_REACH } from "./layout.js";
import { handState } from "./motion.js";
import { solveTwoBone } from "./ik.js";

const UP = new Vector3(0, 1, 0);
const HANDS = ["MD", "ME"];
const HAND_TARGETS = ["snare", "hihat", "tom1", "tom2", "floor", "crash", "ride"];
const TIP_R = 0.0085; // raio da bolinha na ponta da baqueta

export function createAvatar(kit) {
  const group = new Group();
  group.name = "baterista";
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };

  const bodyMat = keep(new MeshLambertMaterial());
  const faceMat = keep(new MeshLambertMaterial());
  const stickMat = keep(new MeshLambertMaterial());
  const limbMat = {
    MD: keep(new MeshLambertMaterial()), ME: keep(new MeshLambertMaterial()),
    PD: keep(new MeshLambertMaterial()), PE: keep(new MeshLambertMaterial()),
  };

  const pelvisPos = new Vector3(...BODY.pelvis);
  const capsule = (r, len, mat) => {
    const m = new Mesh(keep(new CapsuleGeometry(r, Math.max(0.01, len - r), 4, 10)), mat);
    group.add(m);
    return m;
  };

  // ---------- tronco e cabeça ----------
  const pelvis = new Mesh(keep(new CapsuleGeometry(0.085, 0.16, 4, 10)), bodyMat);
  pelvis.rotation.z = Math.PI / 2;
  pelvis.position.copy(pelvisPos);
  group.add(pelvis);

  const torso = new Group();
  torso.position.copy(pelvisPos);
  torso.rotation.order = "YXZ";
  group.add(torso);
  const chest = new Mesh(keep(new CapsuleGeometry(0.115, 0.25, 4, 12)), bodyMat);
  chest.position.set(0, 0.25, 0);
  chest.scale.z = 0.78;
  torso.add(chest);
  const shoulders = new Mesh(keep(new CapsuleGeometry(0.06, 0.27, 4, 10)), bodyMat);
  shoulders.rotation.z = Math.PI / 2;
  shoulders.position.set(0, BODY.shoulder[1] - 0.01, BODY.shoulder[2]);
  torso.add(shoulders);
  const neck = new Mesh(keep(new CylinderGeometry(0.038, 0.045, 0.1, 10)), bodyMat);
  neck.position.set(0, 0.6, -0.02);
  torso.add(neck);
  const head = new Group();
  head.position.set(...BODY.head);
  head.rotation.x = -0.18; // olhando pra caixa
  torso.add(head);
  head.add(new Mesh(keep(new SphereGeometry(0.09, 20, 14)), bodyMat));
  const visor = new Mesh(keep(new BoxGeometry(0.13, 0.04, 0.05)), faceMat);
  visor.position.set(0, 0.01, -0.07);
  head.add(visor);

  const shoulderLocal = {
    MD: new Vector3(BODY.shoulder[0], BODY.shoulder[1], BODY.shoulder[2]),
    ME: new Vector3(-BODY.shoulder[0], BODY.shoulder[1], BODY.shoulder[2]),
  };
  const elbowPoleLocal = { MD: new Vector3(1, -0.55, 0.35).normalize(), ME: new Vector3(-1, -0.55, 0.35).normalize() };

  // ---------- braços e baquetas ----------
  const shaftGeo = keep(new CylinderGeometry(0.0062, 0.0085, BODY.stickFront + BODY.stickBack, 8));
  shaftGeo.translate(0, (BODY.stickFront - BODY.stickBack) / 2, 0);
  const tipGeo = keep(new SphereGeometry(TIP_R, 10, 8));
  const jointGeo = keep(new SphereGeometry(0.052, 14, 10));
  const arms = {};
  for (const limb of HANDS) {
    const stick = new Group();
    stick.add(new Mesh(shaftGeo, stickMat));
    const tip = new Mesh(tipGeo, stickMat);
    tip.position.y = BODY.stickFront;
    stick.add(tip);
    group.add(stick);
    const joint = new Mesh(jointGeo, bodyMat);
    group.add(joint);
    arms[limb] = {
      joint,
      upper: capsule(0.042, BODY.upperArm, bodyMat),
      fore: capsule(0.034, BODY.foreArm, bodyMat),
      hand: (() => { const m = new Mesh(keep(new SphereGeometry(0.046, 14, 10)), limbMat[limb]); group.add(m); return m; })(),
      stick, tip,
      state: { a: "snare", b: "snare", w: 1, h: 0 },
      shoulder: new Vector3(), elbow: new Vector3(), wrist: new Vector3(), reached: true,
    };
  }

  // ---------- pernas e pés ----------
  const shoeGeo = keep(new BoxGeometry(0.095, 0.065, BODY.footLength));
  shoeGeo.translate(0, 0.012 + 0.0325, -BODY.footLength / 2 + 0.035);
  const legs = {};
  for (const [limb, pedal, side] of [["PD", KICK_PEDAL, 1], ["PE", HIHAT_PEDAL, -1]]) {
    const foot = new Group();
    foot.position.set(...pedal.hinge);
    foot.add(new Mesh(shoeGeo, limbMat[limb]));
    group.add(foot);
    legs[limb] = {
      foot,
      thigh: capsule(0.065, BODY.thigh, bodyMat),
      shin: capsule(0.05, BODY.shin, bodyMat),
      hip: new Vector3(BODY.hip[0] * side, BODY.hip[1], BODY.hip[2]).add(pelvisPos),
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
        kit.contact(id, limb, P, n);
        hd.set(P.x - ax, 0, P.z - az).normalize();
        const along = hd.clone().addScaledVector(n, -hd.dot(n)).normalize();
        const beta = kit.strikeAngle(id);
        const d0 = along.multiplyScalar(Math.cos(beta)).addScaledVector(n, -Math.sin(beta)).normalize();
        const tip = P.clone().addScaledVector(n, TIP_R);
        const H0 = tip.clone().addScaledVector(d0, -BODY.stickFront);
        configs[limb][id] = { P: P.clone(), n: n.clone(), tip, d0, H0 };
      }
    }
  }

  // ---------- pose ----------
  const tmpV = new Vector3(), tmpD = new Vector3(), tmpK = new Vector3(), tmpH = new Vector3();
  const tmpQ = new Quaternion(), pole = new Vector3();

  function placeBone(mesh, a, b) {
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(UP, tmpV.subVectors(b, a).normalize());
  }
  const reach = (limb, id) => TORSO_REACH[limb][id] || TORSO_REACH[limb].snare;

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
    torso.getWorldQuaternion(tmpQ);

    for (const limb of HANDS) {
      const arm = arms[limb], s = arm.state;
      const ca = configs[limb][s.a] || configs[limb][BODY.home[limb]];
      const cb = configs[limb][s.b] || configs[limb][BODY.home[limb]];
      // pose base entre duas configurações de golpe
      tmpH.lerpVectors(ca.H0, cb.H0, s.w);
      tmpD.lerpVectors(ca.d0, cb.d0, s.w).normalize();
      // levantar: pulso sobe e recua, baqueta gira pra cima em volta do pulso
      if (s.h > 0) {
        tmpV.set(tmpD.x, 0, tmpD.z).normalize();
        tmpH.addScaledVector(UP, BODY.liftUp * s.h).addScaledVector(tmpV, -BODY.liftBack * s.h);
        tmpK.crossVectors(tmpD, UP).normalize();
        tmpD.applyAxisAngle(tmpK, BODY.liftAngle * s.h);
      }
      arm.shoulder.copy(shoulderLocal[limb]);
      torso.localToWorld(arm.shoulder);
      // alvo longe: o ombro avança um pouco na direção dele
      tmpV.subVectors(tmpH, arm.shoulder);
      const excess = tmpV.length() - (BODY.upperArm + BODY.foreArm - 0.005);
      if (excess > 0) arm.shoulder.addScaledVector(tmpV.normalize(), Math.min(excess, SHOULDER_REACH));
      arm.joint.position.copy(arm.shoulder);
      pole.copy(elbowPoleLocal[limb]).applyQuaternion(tmpQ);
      arm.reached = solveTwoBone(arm.shoulder, tmpH, BODY.upperArm, BODY.foreArm, pole, arm.elbow, arm.wrist);
      placeBone(arm.upper, arm.shoulder, arm.elbow);
      placeBone(arm.fore, arm.elbow, arm.wrist);
      arm.hand.position.copy(arm.wrist);
      arm.stick.position.copy(arm.wrist);
      arm.stick.quaternion.setFromUnitVectors(UP, tmpD);
    }

    // pé direito: calcanhar parado no pedal, ponta desce junto com ele
    legs.PD.foot.rotation.x = kit.pedalAngle(press);
    for (const limb of ["PD", "PE"]) {
      const leg = legs[limb];
      leg.foot.updateMatrixWorld(true);
      tmpV.set(...BODY.ankle);
      leg.foot.localToWorld(tmpV);
      leg.reached = solveTwoBone(leg.hip, tmpV, BODY.thigh, BODY.shin, leg.pole, leg.knee, leg.ankle);
      placeBone(leg.thigh, leg.hip, leg.knee);
      placeBone(leg.shin, leg.knee, leg.ankle);
    }
  }

  function paint(theme) {
    bodyMat.color.set(theme.body);
    faceMat.color.set(theme.face);
    stickMat.color.set(theme.stick);
    for (const k of Object.keys(limbMat)) limbMat[k].color.set(theme.limb[k]);
  }

  /** Debug: centro da bolinha da baqueta no mundo (depois do update). */
  function tipWorld(limb, out = new Vector3()) {
    const arm = arms[limb];
    arm.stick.updateMatrixWorld(true);
    return arm.tip.getWorldPosition(out);
  }

  return {
    group, configs, arms, legs, update, paint, tipWorld, TIP_R,
    dispose() { for (const d of disposables) d.dispose(); },
  };
}
