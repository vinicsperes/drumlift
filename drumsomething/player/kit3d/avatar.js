// Baterista do estilo manequim: cápsulas e esferas vestindo o esqueleto de
// rig.js, com uma baqueta em cada mão.

import {
  BoxGeometry, CapsuleGeometry, CylinderGeometry, Group, Mesh, MeshLambertMaterial,
  SphereGeometry, Vector3,
} from "../vendor/three.module.min.js";
import { BODY } from "./layout.js";
import { FEET, HANDS } from "./rig.js";

const UP = new Vector3(0, 1, 0);

export function createAvatar(rig) {
  const group = new Group();
  group.name = "baterista";
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };
  const { TIP_R } = rig;

  const bodyMat = keep(new MeshLambertMaterial());
  const faceMat = keep(new MeshLambertMaterial());
  const stickMat = keep(new MeshLambertMaterial());
  const limbMat = {
    MD: keep(new MeshLambertMaterial()), ME: keep(new MeshLambertMaterial()),
    PD: keep(new MeshLambertMaterial()), PE: keep(new MeshLambertMaterial()),
  };

  const capsule = (r, len, mat) => {
    const m = new Mesh(keep(new CapsuleGeometry(r, Math.max(0.01, len - r), 4, 10)), mat);
    group.add(m);
    return m;
  };

  // ---------- tronco e cabeça ----------
  const pelvis = new Mesh(keep(new CapsuleGeometry(0.085, 0.16, 4, 10)), bodyMat);
  pelvis.rotation.z = Math.PI / 2;
  pelvis.position.copy(rig.torso.position);
  group.add(pelvis);

  const torso = new Group();
  torso.position.copy(rig.torso.position);
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
    };
  }

  // ---------- pernas e pés ----------
  const shoeGeo = keep(new BoxGeometry(0.095, 0.065, BODY.footLength));
  shoeGeo.translate(0, 0.012 + 0.0325, -BODY.footLength / 2 + 0.035);
  const legs = {};
  for (const limb of FEET) {
    const foot = new Group();
    foot.position.copy(rig.legs[limb].foot.position);
    foot.add(new Mesh(shoeGeo, limbMat[limb]));
    group.add(foot);
    legs[limb] = {
      foot,
      thigh: capsule(0.065, BODY.thigh, bodyMat),
      shin: capsule(0.05, BODY.shin, bodyMat),
    };
  }

  // ---------- pose ----------
  const tmpV = new Vector3();
  function placeBone(mesh, a, b) {
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(UP, tmpV.subVectors(b, a).normalize());
  }

  /** Veste o esqueleto (chamar depois de rig.update). */
  function update() {
    torso.rotation.copy(rig.torso.rotation);
    for (const limb of HANDS) {
      const arm = arms[limb], r = rig.arms[limb];
      arm.joint.position.copy(r.shoulder);
      placeBone(arm.upper, r.shoulder, r.elbow);
      placeBone(arm.fore, r.elbow, r.wrist);
      arm.hand.position.copy(r.wrist);
      arm.stick.position.copy(r.wrist);
      arm.stick.quaternion.setFromUnitVectors(UP, r.dir);
    }
    for (const limb of FEET) {
      const leg = legs[limb], r = rig.legs[limb];
      leg.foot.rotation.x = r.foot.rotation.x;
      placeBone(leg.thigh, r.hip, r.knee);
      placeBone(leg.shin, r.knee, r.ankle);
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
    group, update, paint, tipWorld,
    dispose() { for (const d of disposables) d.dispose(); },
  };
}
