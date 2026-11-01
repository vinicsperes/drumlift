// The drummer's human skeleton: pelvis, a three-part spine, neck, head, clavicles, arm,
// forearm with twist, a five-fingered hand holding the stick, and legs with ankle and toes.
//
// A per-frame "drive" (createDrive) decides the pose: rotations of the pelvis, spine and
// head, clavicles, where each stick is (fulcrum and orientation), how far each elbow opens
// and how each foot sits on its pedal. The skeleton solves the rest: the hand comes from
// the stick (fixed grip), the elbow from a two-bone IK with the requested turn, the forearm
// twist from the difference between hand and forearm, the fingers from the grip, and the
// legs from IK to the pedals. Since the hand comes from the stick, the tip lands exactly
// where the drive said, whatever the arm does.
//
// Conventions (the same as the MMIP capture, to transfer motion directly): world with y
// up and the drummer facing -Z (right = +X); each bone has its origin at the joint, y along
// the bone; on the hand, y goes from wrist to fingers, z out of the back and x = y × z
// (ulnar on the right, radial on the left).

import { Euler, Matrix4, Quaternion, Vector3 } from "../vendor/three.module.min.js";
import { solveTwoBone } from "./ik.js";

export const HANDS = ["MD", "ME"];
export const FEET = ["PD", "PE"];
export const FINGERS = ["thumb", "index", "middle", "ring", "pinky"];
export const SPINE = ["spine", "spine1", "chest"];

export const BONES = [
  "hips", ...SPINE, "neck", "head",
  ...HANDS.flatMap((l) => [
    `clav.${l}`, `arm.${l}`, `forearm.${l}`, `twist.${l}`, `hand.${l}`, `stick.${l}`,
    ...FINGERS.flatMap((f) => [1, 2, 3].map((k) => `${f}${k}.${l}`)),
  ]),
  ...FEET.flatMap((l) => [`thigh.${l}`, `shin.${l}`, `foot.${l}`, `toe.${l}`]),
];
export const BONE = Object.fromEntries(BONES.map((n, i) => [n, i]));

const v3 = (a) => new Vector3(a[0], a[1], a[2]);

// Measures (m). Spine and head offsets in the space of the bone above; side offsets (x)
// are for the right and mirror on the left.
export const SKEL = {
  hips: [0, 0.58, 0.26],           // center of the pelvis, on the throne (world)
  spine: [0, 0.095, -0.005],       // pelvis -> lumbar
  spine1: [0, 0.125, 0],           // lumbar -> thoracic
  chest: [0, 0.13, 0],             // -> chest
  neck: [0, 0.19, 0.012],          // chest -> base of the neck
  head: [0, 0.095, -0.012],        // neck -> base of the skull
  headTop: 0.2,                    // base of the skull -> top of the head
  sc: [0.022, 0.135, -0.045],      // chest -> sternoclavicular joint
  shoulder: [0.168, 0.012, 0.03],  // sternoclavicular joint -> shoulder
  upperArm: 0.285,
  foreArm: 0.255,
  hip: [0.095, -0.045, -0.01],     // pelvis -> hip
  thigh: 0.42,
  shin: 0.42,
  // foot, in the plane of the sole (origin at the heel, -z forward)
  ankle: [0, 0.075, -0.05],
  ball: [0, 0.022, -0.165],
  toeTip: [0, 0.016, -0.235],
  footWidth: 0.09,
  // stick: from the fulcrum (between thumb and index) to the ball's center, and to the butt
  stickFront: 0.28,
  stickBack: 0.13,
};

// Grip: stick fulcrum and direction in hand space (right; x mirrors on the left). The
// stick crosses the palm slightly diagonally, from the heel of the hand to between thumb
// and index, against the palm. The direction splits the difference between anatomy and
// what the capture shows (the cloud of stick tips tightens with the stick nearly on the
// hand's axis).
export const GRIP = { fulcrum: [-0.024, 0.088, -0.03], dir: [-0.3, 0.95, 0] };

// Fingers (right, cm in hand space): base, length of the 3 phalanges and flexion of each
// joint in the grip (degrees). The thumb leaves from its base and touches the stick above
// the fulcrum.
const FINGER_DEF = {
  thumb: { base: [-2.8, 2.2, -1.2], dir: [-0.3, 0.93, -0.2], len: [4.0, 3.1, 2.6], flex: [6, 12, 14], spread: 0 },
  index: { base: [-3.2, 7.9, -0.2], dir: [-0.08, 1, 0], len: [4.5, 2.8, 2.1], flex: [25, 75, 22], spread: -3 },
  middle: { base: [-0.8, 8.2, -0.2], dir: [0, 1, 0], len: [4.7, 3.1, 2.2], flex: [58, 95, 32], spread: 0 },
  ring: { base: [1.5, 7.8, -0.4], dir: [0.04, 1, 0], len: [4.3, 2.8, 2.1], flex: [78, 95, 35], spread: 3 },
  pinky: { base: [3.6, 6.8, -0.7], dir: [0.1, 1, 0], len: [3.5, 2.2, 1.9], flex: [88, 95, 35], spread: 6 },
};
export const FINGER_LEN = Object.fromEntries(Object.entries(FINGER_DEF).map(([k, f]) => [k, f.len.map((x) => x / 100)]));

const deg = (d) => (d * Math.PI) / 180;
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
const DOWN = new Vector3(0, -1, 0);
const side = (l) => (l === "MD" || l === "PD" ? 1 : -1);
// Hand relative to the forearm with the thumb up (zero twist), around y.
const TWIST0 = Math.PI / 2;
const STRETCH = 1.025; // how far the arm may stretch past its length (invisible)
const mirror = (a, s) => [a[0] * s, a[1], a[2]];

/** Pose drive (what the "drummer" decides each frame). */
export function createDrive() {
  const hand = () => ({ pos: new Vector3(), quat: new Quaternion() });
  return {
    hips: { pos: v3(SKEL.hips), rot: new Euler(0, 0, 0, "YXZ") },
    spine: SPINE.map(() => new Euler(0, 0, 0, "YXZ")),  // local rotation of each vertebra
    neck: new Euler(0, 0, 0, "YXZ"),
    head: new Euler(0, 0, 0, "YXZ"),
    clav: { MD: { elev: 0, prot: 0 }, ME: { elev: 0, prot: 0 } }, // rad: rises and goes forward
    stick: { MD: hand(), ME: hand() },                  // stick fulcrum and orientation
    swivel: { MD: 0.45, ME: 0.2 },                      // rad: elbow outward (+) from "hanging"
    grip: { MD: 0, ME: 0 },                             // 0..1: how much the fingers squeeze
    // foot on the pedal: board frame (origin on the axis, y = normal, -z toward the toe),
    // where the heel sits on the board and how far it is lifted (rad, turning at the ball)
    foot: {
      PD: { board: new Matrix4(), heel: 0, lift: 0 },
      PE: { board: new Matrix4(), heel: 0, lift: 0 },
    },
  };
}

/** Matrix with origin o, y axis = yDir and x as close as possible to xHint. */
export function frameFrom(o, yDir, xHint, out) {
  const y = _f.y.copy(yDir).normalize();
  const x = _f.x.copy(xHint).addScaledVector(y, -xHint.dot(y));
  if (x.lengthSq() < 1e-10) x.copy(Math.abs(y.x) < 0.9 ? X : Z).addScaledVector(y, -(Math.abs(y.x) < 0.9 ? y.x : y.z));
  x.normalize();
  const z = _f.z.crossVectors(x, y);
  return out.makeBasis(x, y, z).setPosition(o);
}
const _f = { x: new Vector3(), y: new Vector3(), z: new Vector3() };

/**
 * Create the skeleton. `bones[i]` is the world matrix of each bone (BONES) after
 * `solve(drive)`; `joints` keeps the joint positions, for whoever wants them.
 */
export function createSkeleton() {
  const n = BONES.length;
  const bones = Array.from({ length: n }, () => new Matrix4());
  const pos = Array.from({ length: n }, () => new Vector3());   // origin of each bone
  const quat = Array.from({ length: n }, () => new Quaternion());
  const reached = { MD: true, ME: true, PD: true, PE: true };
  const twist = { MD: 0, ME: 0 };

  // grip: hand -> stick (constant)
  const grip = {};
  for (const l of HANDS) {
    const s = side(l);
    const f = v3(mirror(GRIP.fulcrum, s));
    const y = v3(mirror(GRIP.dir, s)).normalize();
    const z = Z.clone().addScaledVector(y, -y.z).normalize();
    const x = new Vector3().crossVectors(y, z);
    const m = new Matrix4().makeBasis(x, y, z).setPosition(f);
    grip[l] = { m, inv: m.clone().invert(), q: new Quaternion().setFromRotationMatrix(m), f };
  }
  // fingers: base, directions and flexions in hand space
  const fingers = {};
  for (const l of HANDS) {
    const s = side(l);
    fingers[l] = FINGERS.map((name) => {
      const d = FINGER_DEF[name];
      return {
        name, base: v3(mirror(d.base, s)).multiplyScalar(0.01),
        dir: v3(mirror(d.dir, s)).normalize(),
        len: d.len.map((x) => x / 100), flex: d.flex.map(deg), spread: deg(d.spread) * s,
      };
    });
  }

  // tmp
  const tA = new Vector3(), tB = new Vector3(), tC = new Vector3(), tD = new Vector3();
  const qA = new Quaternion(), qB = new Quaternion(), qC = new Quaternion();
  const mA = new Matrix4(), mB = new Matrix4();
  const hinge = new Vector3(), axis = new Vector3(), e0 = new Vector3(), ref = new Vector3();

  function setBone(i, m) {
    bones[i].copy(m);
    pos[i].setFromMatrixPosition(m);
    quat[i].setFromRotationMatrix(m);
  }
  /** Child bone: parent * local translation * local rotation. */
  function child(i, parent, offset, euler) {
    mA.makeRotationFromEuler(euler);
    mA.setPosition(offset[0], offset[1], offset[2]);
    bones[i].multiplyMatrices(bones[parent], mA);
    pos[i].setFromMatrixPosition(bones[i]);
    quat[i].setFromRotationMatrix(bones[i]);
  }

  function solveTrunk(d) {
    mA.makeRotationFromEuler(d.hips.rot).setPosition(d.hips.pos);
    setBone(BONE.hips, mA);
    child(BONE.spine, BONE.hips, SKEL.spine, d.spine[0]);
    child(BONE.spine1, BONE.spine, SKEL.spine1, d.spine[1]);
    child(BONE.chest, BONE.spine1, SKEL.chest, d.spine[2]);
    child(BONE.neck, BONE.chest, SKEL.neck, d.neck);
    child(BONE.head, BONE.neck, SKEL.head, d.head);
  }

  const clavRest = {}, scLocal = {};
  for (const l of HANDS) {
    clavRest[l] = v3(mirror(SKEL.shoulder, side(l)));
    scLocal[l] = mirror(SKEL.sc, side(l));
  }
  const clavLen = v3(SKEL.shoulder).length();
  const handM = new Matrix4(), handQ = new Quaternion(), stickM = new Matrix4();
  const S = new Vector3(), E = new Vector3(), W = new Vector3(), SC = new Vector3();

  function solveArm(l, d) {
    const s = side(l), chest = bones[BONE.chest];
    // clavicle: turns the shoulder around the sternoclavicular joint
    SC.set(...scLocal[l]).applyMatrix4(chest);
    const c = d.clav[l];
    tA.copy(clavRest[l]);
    tA.applyAxisAngle(Z, c.elev * s);          // rises
    tA.applyAxisAngle(Y, c.prot * s);          // goes forward
    qA.setFromRotationMatrix(chest);
    S.copy(tA).applyQuaternion(qA).add(SC);

    // hand: from the stick (fixed grip)
    const st = d.stick[l];
    stickM.makeRotationFromQuaternion(st.quat).setPosition(st.pos);
    handM.multiplyMatrices(stickM, grip[l].inv);
    handQ.setFromRotationMatrix(handM);
    W.setFromMatrixPosition(handM);

    // far target: the clavicle brings the shoulder a little toward the wrist
    const a = SKEL.upperArm, b = SKEL.foreArm;
    for (let k = 0; k < 2; k++) {
      const ex = S.distanceTo(W) - (a + b - 0.004);
      if (ex <= 0) break;
      tB.subVectors(W, S).normalize().multiplyScalar(Math.min(ex, 0.08) * 1.05).add(S).sub(SC).setLength(clavLen);
      S.copy(SC).add(tB);
    }

    // elbow: IK with the requested turn around the shoulder-wrist axis
    axis.subVectors(W, S);
    const dist = axis.length();
    axis.divideScalar(dist || 1);
    ref.copy(DOWN).addScaledVector(axis, -DOWN.dot(axis));
    if (ref.lengthSq() < 1e-6) {
      // arm vertical: the reference is the back of the chest
      tC.set(0, 0, 1).applyQuaternion(qA);
      ref.copy(tC).addScaledVector(axis, -tC.dot(axis));
    }
    ref.normalize();
    // outward = +X on the right and -X on the left: turns "hanging" around the axis
    e0.copy(ref).applyAxisAngle(axis, -s * d.swivel[l]);
    // slightly too far (up to 2.5%): the arm stretches unnoticed; beyond that, it
    // stretches toward the wrist (the hand stays on the stick)
    const k = Math.min(STRETCH, Math.max(1, dist / (a + b - 2e-4)));
    reached[l] = solveTwoBone(S, W, a * k, b * k, e0, E, tD);
    hinge.crossVectors(e0, axis).normalize();

    frameFrom(SC, tA.subVectors(S, SC), Y.clone().applyQuaternion(qA), mB);
    setBone(BONE[`clav.${l}`], mB);
    frameFrom(S, tA.subVectors(E, S), hinge, mB);
    setBone(BONE[`arm.${l}`], mB);
    frameFrom(E, tA.subVectors(tD, E), hinge, mB);
    setBone(BONE[`forearm.${l}`], mB);
    // twist: how much the hand turns around the forearm from neutral (thumb up);
    // half goes to the forearm's middle bone
    const fq = quat[BONE[`forearm.${l}`]];
    qB.copy(fq).invert().multiply(handQ);
    const tw = 2 * Math.atan2(qB.y, qB.w) - TWIST0 * s;
    twist[l] = Math.atan2(Math.sin(tw), Math.cos(tw));
    qC.setFromAxisAngle(Y, twist[l] * 0.5);
    qB.copy(fq).multiply(qC);
    tA.lerpVectors(E, tD, 0.5);
    mB.makeRotationFromQuaternion(qB).setPosition(tA);
    setBone(BONE[`twist.${l}`], mB);
    setBone(BONE[`hand.${l}`], handM);
    setBone(BONE[`stick.${l}`], stickM);

    // fingers: base fixed on the hand, flexion from the grip (+ squeeze)
    const sq = d.grip[l];
    for (const f of fingers[l]) {
      // phalanx frame: y = finger direction, x = flexion axis (the hand's x)
      tB.copy(f.dir);
      if (f.spread) tB.applyAxisAngle(Z, f.spread);
      mB.copy(frameFrom(f.base, tB, X, mA));
      let parent = handM;
      for (let k = 0; k < 3; k++) {
        const flex = f.flex[k] * (1 + (f.name === "thumb" ? 0.1 : 0.12) * sq);
        // turns around local x toward the palm (-z)
        mA.makeRotationAxis(X, -flex);
        if (k === 0) mB.multiply(mA);
        else mB.makeTranslation(0, f.len[k - 1], 0).multiply(mA);
        const i = BONE[`${f.name}${k + 1}.${l}`];
        bones[i].multiplyMatrices(parent, mB);
        pos[i].setFromMatrixPosition(bones[i]);
        quat[i].setFromRotationMatrix(bones[i]);
        parent = bones[i];
      }
    }
    return { S, E, W: tD };
  }

  const ankleL = v3(SKEL.ankle), ballL = v3(SKEL.ball), toeL = v3(SKEL.toeTip);
  const flat = new Matrix4(), sole = new Matrix4(), hip = new Vector3(), knee = new Vector3();
  const ankle = new Vector3(), ball = new Vector3(), toe = new Vector3(), kneePole = new Vector3();
  function solveLeg(l, d) {
    const s = side(l), f = d.foot[l];
    // sole flat on the board, heel at z = heel; lifting the heel turns the sole around
    // the ball, and the toes stay flat on the board
    flat.copy(f.board).multiply(mA.makeTranslation(0, 0, f.heel));
    sole.copy(flat);
    if (f.lift) {
      sole.multiply(mA.makeTranslation(0, 0, ballL.z))
        .multiply(mB.makeRotationAxis(X, -f.lift))
        .multiply(mA.makeTranslation(0, 0, -ballL.z));
    }
    ankle.copy(ankleL).applyMatrix4(sole);
    ball.copy(ballL).applyMatrix4(sole);
    toe.copy(toeL).applyMatrix4(flat);
    hip.set(...mirror(SKEL.hip, s)).applyMatrix4(bones[BONE.hips]);
    kneePole.set(0.3 * s, 0.6, -1).normalize();
    reached[l] = solveTwoBone(hip, ankle, SKEL.thigh, SKEL.shin, kneePole, knee, tD);
    hinge.subVectors(knee, hip).cross(tA.subVectors(tD, knee));
    if (hinge.lengthSq() < 1e-10) hinge.copy(X);
    hinge.normalize();
    frameFrom(hip, tA.subVectors(knee, hip), hinge, mB);
    setBone(BONE[`thigh.${l}`], mB);
    frameFrom(knee, tA.subVectors(tD, knee), hinge, mB);
    setBone(BONE[`shin.${l}`], mB);
    tB.set(1, 0, 0).transformDirection(f.board);
    frameFrom(tD, tA.subVectors(ball, tD), tB, mB);
    setBone(BONE[`foot.${l}`], mB);
    frameFrom(ball, tA.subVectors(toe, ball), tB, mB);
    setBone(BONE[`toe.${l}`], mB);
  }

  function solve(d) {
    solveTrunk(d);
    for (const l of HANDS) solveArm(l, d);
    for (const l of FEET) solveLeg(l, d);
  }

  return {
    bones, pos, quat, reached, twist, grip, solve, bone: BONE,
    /** World position of a bone (shortcut). */
    at: (name, out = new Vector3()) => out.copy(pos[BONE[name]]),
  };
}

/** Stick tip (center of the ball) in the world, given the drive. */
export function stickTip(stick, out = new Vector3()) {
  return out.set(0, SKEL.stickFront, 0).applyQuaternion(stick.quat).add(stick.pos);
}
