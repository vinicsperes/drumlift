// The drummer's skeleton, with no mesh, as a pure function of time: a "drummer" decides
// at each moment where each stick, the pelvis, spine, head, elbows and feet are
// (the drive, skeleton.js), and the human skeleton solves the rest. The stage only
// draws this skeleton.
//
// For each hand and each piece there is a "strike configuration" (stick fulcrum, direction
// and roll, elbow opening) where the tip touches exactly the piece's contact point. The
// animation interpolates between these configurations and lifts the stick in between.

import { Matrix4, Object3D, Quaternion, Vector3 } from "../vendor/three.module.min.js";
import { BODY, CYMBALS, DRUMS, HIHAT_PEDAL, KICK_PEDAL, TORSO_LIMIT, TORSO_REACH } from "./layout.js";
import { contact, pedalAngle, placeFrame, strikeAngle, surfaceY } from "./pieces.js";
import { handState, hihatFoot } from "./motion.js";
import { BONE, FEET, HANDS, SKEL, createDrive, createSkeleton } from "./skeleton.js";
import { segmentAt } from "./perform.js";
import { unwarp } from "./moves.js";

export { FEET, HANDS };
export const TIP_R = 0.0085; // radius of the ball at the stick's tip

const UP = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const deg = (d) => (d * Math.PI) / 180;
// Whip (Moeller method): the elbow and shoulder rise just before the stick. It only
// moves the arm chain, not the wrist, so the tip stays exact.
const WHIP_LEAD = 0.04;    // s of elbow lead
const WHIP_SWIVEL = 0.22;  // rad the elbow opens with the stick fully up
const WHIP_CLAV = 0.03;    // rad the clavicle rises
// Changing pieces, the hand clears the rims: the farther, the higher.
const TRAVEL_ARC = 0.55;   // extra height (fraction of h) per meter of distance
// Tip rise at h = 1, and how much of it comes from the hand (the rest is wrist turn).
// Measured on a real drummer: on cymbals it is nearly all wrist and fingers; on the
// snare and toms the hand comes along, ~40% of the rise.
const TIP_MAX = 0.36;
const HAND_SHARE = { hihat: 0.05, ride: 0.05, crash: 0.25, snare: 0.4, tom1: 0.4, tom2: 0.4, floor: 0.4 };
const REACH_K = 0.6;       // how much the torso turns and leans toward far pieces
// The body bounces on the pulse: the torso drops and leans a little right after each
// beat (on the real drummer, the head is lowest at ~0.28 of the beat).
const BOUNCE = 0.007;      // m
const BOUNCE_PHASE = 0.28;
// Left foot: the heel marks the pulse with the toes still on the hi-hat pedal.
const HEEL_LIFT = 0.16;    // rad at mid beat
// Heel-up kick: the heel stays in the air and rises more with the pedal released.
const HEEL_UP = 0.3;       // rad
const HEEL_STOMP = 0.22;   // extra rad with the pedal released (the leg "loads" the stroke)
const HEEL_WIN = 1.5;      // s: window for the mean kick strength
// How the torso splits across the vertebrae (pelvis, lumbar, thoracic, chest).
const YAW_SPLIT = [0.15, 0.25, 0.3, 0.3];
const LEAN_SPLIT = [0.25, 0.3, 0.3, 0.15];
const HEAD_DOWN = deg(-12); // the head looks at the snare
// Strike pose measured on the real drummer (tools/mmip_moves.py): hand turn around the
// stick (0 = back of the hand up, German grip; + = thumb up) and elbow opening
// (+ = outward), in degrees.
const ROLL = {
  MD: { snare: 43, hihat: 41, tom1: 46, tom2: 57, floor: 62, crash: 40, ride: 64 },
  ME: { snare: 24, hihat: 33, tom1: 31, tom2: 10, floor: 19, crash: 25, ride: 33 },
};
const SWIVEL = {
  MD: { snare: 25, hihat: 23, tom1: 18, tom2: 21, floor: 19, crash: 39, ride: 32 },
  ME: { snare: 9, hihat: 14, tom1: 10, tom2: 7, floor: 4, crash: 12, ride: 9 },
};
const HAND_TARGETS = ["snare", "hihat", "tom1", "tom2", "floor", "crash", "ride"];

/** Stick orientation with direction d and roll `roll` (rad) around it. */
export function stickQuat(d, roll, out = new Quaternion()) {
  const y = d.clone().normalize();
  const ups = UP.clone().addScaledVector(y, -y.y).normalize();
  const side = new Vector3().crossVectors(y, ups);
  const z = ups.multiplyScalar(Math.cos(roll)).addScaledVector(side, Math.sin(roll));
  const x = new Vector3().crossVectors(y, z);
  return out.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

export function createRig() {
  const skel = createSkeleton();
  const drive = createDrive();
  const pelvis = new Vector3(...SKEL.hips);

  // ---------- strike configurations ----------
  // Fulcrum F0 and orientation q0 such that F0 + d0 * stickFront = center of the
  // ball touching the surface (P + n * TIP_R).
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
        const F0 = tip.clone().addScaledVector(d0, -SKEL.stickFront);
        // thumb up turns the back of the hand outward: right on the right hand, left on the left
        const q0 = stickQuat(d0, deg(ROLL[limb][id]) * (limb === "MD" ? 1 : -1));
        // hand in this pose (the stick comes from the hand through the fixed grip)
        const g = skel.grip[limb];
        const hq0 = q0.clone().multiply(g.q.clone().invert());
        const hp0 = F0.clone().sub(g.f.clone().applyQuaternion(hq0));
        // H0 (the fulcrum's old name) stays for compatibility
        configs[limb][id] = { P: P.clone(), n: n.clone(), tip, d0, F0, H0: F0, q0, hq0, hp0, swivel: deg(SWIVEL[limb][id]) };
      }
    }
  }

  // Compatibility: main joints under their old names.
  const arms = {}, legs = {};
  for (const limb of HANDS) {
    arms[limb] = {
      state: { a: "snare", b: "snare", w: 1, h: 0 },
      shoulder: new Vector3(), elbow: new Vector3(), wrist: new Vector3(), fulcrum: new Vector3(),
      dir: new Vector3(0, 1, 0), // stick direction (fulcrum to tip)
      reached: true,
    };
  }
  for (const [limb, pedal] of [["PD", KICK_PEDAL], ["PE", HIHAT_PEDAL]]) {
    const foot = new Object3D(); // pedal board; rotation.x = angle
    foot.position.set(...pedal.hinge);
    legs[limb] = { foot, rest: foot.position.clone(), hip: new Vector3(), knee: new Vector3(), ankle: new Vector3(), reached: true };
  }
  // Torso (compatibility): origin at the pelvis, rotation of the chest.
  const torso = new Object3D();
  torso.position.copy(pelvis);
  torso.rotation.order = "YXZ";

  // ---------- baked performance (perform.js) ----------
  // With a plan, each covered stroke uses a real drummer's segment: the hand leaves the
  // straight path between the two strike poses by the recorded residual (in its heading
  // frame), turns by the recorded turn and the elbow opens like his. At the ends the
  // residual is zero, so the stick touches exactly on the note.
  let plan = null;
  const res = new Float32Array(8);
  const baseP = new Vector3(), baseQ = new Quaternion(), handP = new Vector3(), handQ = new Quaternion();
  const fwd = new Vector3(), back = new Vector3(), right = new Vector3(), rv = new Vector3(), dq = new Quaternion();
  const tipV = new Vector3();
  const SHALLOW = 0.05; // m: how deep the clamp for pieces along the path acts
  const SWIVEL_RES = 0.5;
  const minjerk = (u) => u * u * u * (10 - 15 * u + 6 * u * u);
  // frame of each piece (origin at the center of the strike surface, y = normal)
  const pieceFrames = {};
  {
    const o = new Object3D();
    for (const id of HAND_TARGETS) {
      placeFrame(id, o);
      const r = (DRUMS[id] || CYMBALS[id]).r;
      pieceFrames[id] = { inv: o.matrix.clone().invert(), n: new Vector3(0, 1, 0).applyQuaternion(o.quaternion), r, depth: DRUMS[id]?.depth || 0 };
    }
  }
  /**
   * Push the stick out of the piece if the tip is inside it (fading at the edge).
   * With `depth`, only if it went that deep (below that, the tip is beside or under
   * the piece, not passing over it).
   */
  function guard(st, id, depth = Infinity) {
    const f = pieceFrames[id];
    tipV.set(0, SKEL.stickFront, 0).applyQuaternion(st.quat).add(st.pos).applyMatrix4(f.inv);
    const rho = Math.hypot(tipV.x, tipV.z);
    if (rho > f.r + 0.03) return;
    const deficit = surfaceY(id, rho) + TIP_R - tipV.y;
    if (deficit <= 0 || deficit > depth) return;
    const k = rho < f.r - 0.02 ? 1 : 1 - (rho - (f.r - 0.02)) / 0.05;
    st.pos.addScaledVector(f.n, deficit * k * k * (3 - 2 * k));
  }
  /** Catmull-Rom over the samples of segment i, at position s (0..N-1). */
  function sample(p, i, s) {
    const N = plan.N, C = plan.C, base = i * N * C, k = Math.min(N - 2, Math.floor(s)), f = s - k;
    const i0 = Math.max(0, k - 1), i3 = Math.min(N - 1, k + 2);
    const f2 = f * f, f3 = f2 * f;
    for (let c = 0; c < C; c++) {
      const p0 = p[base + i0 * C + c], p1 = p[base + k * C + c], p2 = p[base + (k + 1) * C + c], p3 = p[base + i3 * C + c];
      res[c] = 0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (3 * p1 - p0 - 3 * p2 + p3) * f3);
    }
  }
  /** Hand (handP, handQ) between two strike poses, at point sig of the path, with residual r. */
  function handFromResidual(ca, cb, sig, r) {
    baseP.lerpVectors(ca.hp0, cb.hp0, sig);
    baseQ.slerpQuaternions(ca.hq0, cb.hq0, sig);
    // heading frame: y up, z behind the hand's heading
    fwd.set(0, 1, 0).applyQuaternion(baseQ).setY(0);
    if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, -1);
    fwd.normalize();
    back.copy(fwd).negate();
    right.crossVectors(UP, back);
    handP.copy(baseP).addScaledVector(right, r[0]).addScaledVector(UP, r[1]).addScaledVector(back, r[2]);
    rv.set(r[3], r[4], r[5]);
    const ang = rv.length();
    if (ang > 1e-9) dq.setFromAxisAngle(rv.divideScalar(ang), ang); else dq.identity();
    handQ.copy(baseQ).multiply(dq);
  }

  /**
   * How close a segment, placed on our kit between pieces a and b, comes to crossing
   * any piece (m; negative = enters), the tip's lowest height, and how far it dives
   * below the stroke's two pieces.
   * The plan uses this to discard segments that don't fit our kit.
   */
  const curveR = new Float32Array(8), ctip = new Vector3();
  function curveClearance(limb, a, b, curve, off, N, C, w) {
    const ca = configs[limb][a], cb = configs[limb][b], g = skel.grip[limb];
    let clear = Infinity, low = Infinity;
    for (let k = 1; k < N - 1; k++) {
      const u = k / (N - 1) - (w * Math.sin(2 * Math.PI * k / (N - 1))) / (2 * Math.PI);
      for (let c = 0; c < C; c++) curveR[c] = curve[off + k * C + c];
      handFromResidual(ca, cb, minjerk(u), curveR);
      ctip.set(0, SKEL.stickFront, 0).applyQuaternion(g.q).add(g.f).applyQuaternion(handQ).add(handP);
      low = Math.min(low, ctip.y);
      for (const id of HAND_TARGETS) {
        if (id === a || id === b) continue; // the clamp handles these on the spot
        const f = pieceFrames[id];
        tipV.copy(ctip).applyMatrix4(f.inv);
        const rho = Math.hypot(tipV.x, tipV.z);
        if (rho > f.r) continue;
        const top = surfaceY(id, rho) + TIP_R;
        // drum: the whole body; cymbal: a thin layer
        const bottom = f.depth ? -f.depth : top - 0.025;
        if (tipV.y > bottom) clear = Math.min(clear, tipV.y - top);
      }
    }
    // dive: how far the tip drops below the lower of the two pieces
    return { clear, low, dip: Math.min(ca.tip.y, cb.tip.y) - low };
  }

  function planHand(limb, i, t) {
    const p = plan.hands[limb], st = drive.stick[limb], g = skel.grip[limb];
    const t0 = p.t0[i], t1 = p.t1[i], u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    const ca = configs[limb][p.a[i]], cb = configs[limb][p.b[i]];
    const sig = minjerk(u);
    sample(p.curves, i, unwarp(u, plan.warp) * (plan.N - 1));
    handFromResidual(ca, cb, sig, res);
    st.quat.copy(handQ).multiply(g.q);
    st.pos.copy(g.f).applyQuaternion(handQ).add(handP);
    // the stick never enters the piece it just played or will play, and passes over the
    // others (on the way between two pieces, over the rim)
    for (const id of HAND_TARGETS) {
      if (id === p.a[i] || id === p.b[i]) guard(st, id);
      else guard(st, id, SHALLOW);
    }
    // our arm's elbow (doll proportions) already moves more with the hand: half the recorded turn
    drive.swivel[limb] = ca.swivel + (cb.swivel - ca.swivel) * sig + SWIVEL_RES * res[6];
    drive.clav[limb].elev = 0;
    drive.clav[limb].prot = 0;
    // the fingers squeeze at the strike and release in between
    const edge = Math.min(u, 1 - u) * (t1 - t0);
    drive.grip[limb] = Math.max(0, 1 - edge / 0.08);
    arms[limb].dir.set(0, 1, 0).applyQuaternion(st.quat);
  }

  // Center of the head in the base posture (where the gaze aims from).
  const headRest = new Vector3(...SKEL.hips)
    .add(new Vector3(0, SKEL.spine[1] + SKEL.spine1[1] + SKEL.chest[1] + SKEL.neck[1] + SKEL.head[1] + 0.09, 0)
      .applyAxisAngle(X_AXIS, -BODY.leanBase * 0.6));

  // ---------- pose ----------
  const tmpV = new Vector3(), tmpK = new Vector3();
  const qLift = new Quaternion();
  const lead = { a: "snare", b: "snare", w: 1, h: 0, travel: 0 };
  const reach = (limb, id) => TORSO_REACH[limb][id] || TORSO_REACH[limb].snare;

  /** How much the music is "rolling" now (0..1): a stroke in the last or next beats. */
  function activity(prep, t) {
    const len = prep.clock.beatLen(t);
    let active = 0;
    for (const l of ["MD", "ME", "PD"]) {
      const hits = prep.limbs[l];
      if (!hits.length) continue;
      let lo = 0, hi = hits.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (hits[m].t < t) lo = m + 1; else hi = m; }
      const prev = hits[lo - 1], next = hits[lo];
      const d = Math.min(prev ? t - prev.t : Infinity, next ? next.t - t : Infinity);
      active = Math.max(active, 1 - Math.min(1, Math.max(0, (d - len) / len)));
    }
    return active;
  }

  /** Hands at time t: sticks, elbows and fingers (independent of the body). */
  function performHands(t, prep) {
    const limbs = prep.limbs;
    handState(limbs.MD, BODY.home.MD, t, arms.MD.state);
    handState(limbs.ME, BODY.home.ME, t, arms.ME.state);
    for (const limb of HANDS) {
      const arm = arms[limb], s = arm.state, st = drive.stick[limb];
      const ca = configs[limb][s.a] || configs[limb][BODY.home[limb]];
      const cb = configs[limb][s.b] || configs[limb][BODY.home[limb]];
      // base pose between two strike configurations
      st.pos.lerpVectors(ca.F0, cb.F0, s.w);
      st.quat.slerpQuaternions(ca.q0, cb.q0, s.w);
      const d = arm.dir.set(0, 1, 0).applyQuaternion(st.quat);
      // lifting: the fulcrum rises and pulls back, the stick turns up around it;
      // changing pieces, it lifts more mid-way (over the rims)
      const h = s.h + TRAVEL_ARC * s.travel * ca.F0.distanceTo(cb.F0);
      if (h > 0) {
        // the tip rises h*TIP_MAX; part is the hand rising, the rest the wrist turning
        const sa = HAND_SHARE[s.a] ?? 0.3, share = sa + ((HAND_SHARE[s.b] ?? 0.3) - sa) * s.w;
        const rise = h * TIP_MAX, handRise = share * rise;
        tmpV.set(d.x, 0, d.z).normalize();
        st.pos.addScaledVector(UP, handRise).addScaledVector(tmpV, -0.45 * handRise);
        const phi = Math.asin(Math.max(-1, Math.min(1, d.y)));
        const want = Math.max(-0.99, Math.min(0.99, Math.sin(phi) + (rise - handRise) / SKEL.stickFront));
        tmpK.crossVectors(d, UP).normalize();
        qLift.setFromAxisAngle(tmpK, Math.asin(want) - phi);
        st.quat.premultiply(qLift);
      }
      // whip: the arm "pulls" the stick, ahead in time
      handState(limbs[limb], BODY.home[limb], t + WHIP_LEAD, lead);
      const hLead = Math.min(1.2, lead.h + TRAVEL_ARC * lead.travel * 0.3);
      drive.swivel[limb] = ca.swivel + (cb.swivel - ca.swivel) * s.w + WHIP_SWIVEL * hLead;
      drive.clav[limb].elev = WHIP_CLAV * hLead;
      drive.clav[limb].prot = 0;
      drive.grip[limb] = Math.max(0, 1 - s.h * 6);
      const seg = plan ? segmentAt(plan, limb, t) : -1;
      lapW[limb] = 0;
      if (seg >= 0) planHand(limb, seg, t);
      else rest(limb, limbs[limb], t);
    }

  }

  /**
   * Body at time t: pelvis, spine, head, clavicles and feet. With the baked body
   * (plan.body), the deviations come from the real drummer (reach, groove and gaze);
   * without it, the torso turns and sways by the older rules.
   */
  function performBody(t, prep, press) {
    const body = plan?.body;
    // torso: turns and leans toward far pieces; sways gently in time
    let yaw = 0, lean = 0;
    for (const limb of HANDS) {
      const s = arms[limb].state, ra = reach(limb, s.a), rb = reach(limb, s.b);
      yaw += REACH_K * (ra[0] + (rb[0] - ra[0]) * s.w);
      lean += REACH_K * (ra[1] + (rb[1] - ra[1]) * s.w);
    }
    yaw = Math.max(-TORSO_LIMIT.yaw, Math.min(TORSO_LIMIT.yaw, yaw));
    lean = Math.min(TORSO_LIMIT.lean, lean);
    const active = activity(prep, t);
    const phase = prep.clock.beatAt(t) % 1;
    const pulse = active * (0.5 + 0.5 * Math.cos(2 * Math.PI * (phase - BOUNCE_PHASE)));
    const pitch = BODY.leanBase + lean + TORSO_LIMIT.bob * pulse;
    if (body) {
      // when still, the body settles (less groove) and, with the sticks on the thighs, leans back a little
      const rested = 0.5 * (lapW.MD + lapW.ME);
      applyBody(body, t, BODY.leanBase * (1 - 0.6 * rested) + 0.5 * lean + BODY_BOUNCE * TORSO_LIMIT.bob * pulse, 0.35 + 0.65 * active);
      // half of the older rules' turn on top: our kit is more open than the capture's,
      // and without this the right hand doesn't reach the crash
      for (let k = 0; k < 4; k++) (k ? drive.spine[k - 1] : drive.hips.rot).y += 0.5 * yaw * YAW_SPLIT[k];
      drive.hips.pos.y -= BODY_BOUNCE * BOUNCE * pulse;
    } else {
      drive.hips.pos.set(pelvis.x, pelvis.y - BOUNCE * pulse, pelvis.z);
      drive.hips.rot.set(-pitch * LEAN_SPLIT[0], yaw * YAW_SPLIT[0], 0);
      for (let k = 0; k < 3; k++) drive.spine[k].set(-pitch * LEAN_SPLIT[k + 1], yaw * YAW_SPLIT[k + 1], 0);
      // head: compensates half the turn and lean, looking at the kit
      drive.neck.set(pitch * 0.35, -yaw * 0.25, 0);
      drive.head.set(HEAD_DOWN + pitch * 0.25, -yaw * 0.2, 0);
    }

    // right foot: in loud parts it plays heel up (the whole leg rises and falls on the
    // pedal, the ball of the foot stays on the board); in soft and still parts, heel
    // down, ankle only
    const up = heelUp(prep, t);
    legs.PD.foot.rotation.x = pedalAngle(press);
    legs.PD.foot.updateMatrix();
    drive.foot.PD.board.copy(legs.PD.foot.matrix);
    drive.foot.PD.heel = 0;
    drive.foot.PD.lift = up * (HEEL_UP + HEEL_STOMP * (1 - press));
    // left foot: holds the hi-hat closed (heel marking time) or does the "chick"
    hihatFoot(prep, t, hh);
    legs.PE.foot.rotation.x = HIHAT_PEDAL.angle - HIHAT_PEDAL.travel * hh.press;
    legs.PE.foot.updateMatrix();
    drive.foot.PE.board.copy(legs.PE.foot.matrix);
    drive.foot.PE.heel = 0;
    drive.foot.PE.lift = HEEL_LIFT * hh.tap;
  }

  /** How heel-up the kick is played (0..1): the mean kick strength around t. */
  function heelUp(prep, t) {
    const hits = prep.limbs.PD;
    if (!hits.length) return 0;
    let lo = 0, hi = hits.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (hits[m].t < t - HEEL_WIN) lo = m + 1; else hi = m; }
    let sum = 0, wsum = 0;
    for (let j = lo; j < hits.length && hits[j].t <= t + HEEL_WIN; j++) {
      const w = 1 - Math.abs(hits[j].t - t) / HEEL_WIN;
      sum += w * hits[j].vel;
      wsum += w;
    }
    if (wsum <= 0) return 0;
    const v = sum / wsum, k = Math.min(1, Math.max(0, (v - 0.5) / 0.25));
    return k * k * (3 - 2 * k) * Math.min(1, wsum);
  }
  const hh = { press: 0, tap: 0 };

  /** Baked body deviations (8 joints x 3 and the pelvis position, drummer's frame) over the base posture. */
  const bodyD = new Float32Array(32);
  // Gain of the baked deviations (the groove is sampled at 4 per beat and loses some
  // tremor; the pelvis comes in a bit under the sensor suit) and the bounce on the
  // pulse, which is weak in the real clips.
  const BODY_GAIN = 1.35, PELVIS_SWAY = 0.8, BODY_BOUNCE = 0.35;
  function applyBody(body, t, pitch, gain = 1) {
    const C = body.channels, n = body.delta.length / C, f = Math.max(0, t * body.fps);
    const i = Math.min(n - 2, Math.floor(f)), u = Math.min(1, f - i), k = BODY_GAIN * gain;
    for (let c = 0; c < C; c++) bodyD[c] = k * (body.delta[i * C + c] * (1 - u) + body.delta[(i + 1) * C + c] * u);
    const d = bodyD;
    drive.hips.pos.copy(pelvis);
    if (C >= 27) drive.hips.pos.add(tmpV.set(d[24], d[25], d[26]).multiplyScalar(PELVIS_SWAY));
    drive.hips.rot.set(-pitch * LEAN_SPLIT[0] + d[0], d[1], d[2]);
    for (let k = 0; k < 3; k++) drive.spine[k].set(-pitch * LEAN_SPLIT[k + 1] + d[3 + k * 3], d[4 + k * 3], d[5 + k * 3]);
    drive.neck.set(pitch * 0.35 + d[12], d[13], d[14]);
    drive.head.set(HEAD_DOWN + pitch * 0.25 + d[15], d[16], d[17]);
    // clavicles: rise = turn around the back axis, forward = around the vertical
    drive.clav.MD.elev += d[20];
    drive.clav.MD.prot += d[19];
    drive.clav.ME.elev -= d[23];
    drive.clav.ME.prot -= d[22];
  }

  /**
   * A hand with no stroke nearby: held in the air it breathes (a slow drift of a few
   * centimeters); in a long break the sticks rest on the thighs and return before the
   * entry. Near notes it changes nothing, so the stroke stays exact.
   */
  const lapQ = {}, lapP = {};
  for (const limb of HANDS) {
    const sx = limb === "MD" ? 1 : -1;
    lapP[limb] = new Vector3(0.14 * sx, 0.655, 0.0);
    lapQ[limb] = stickQuat(new Vector3(-0.82 * sx, -0.06, -0.57), deg(55) * sx);
  }
  const restV = new Vector3();
  const lapW = { MD: 0, ME: 0 };
  function rest(limb, hits, t) {
    lapW[limb] = 0;
    const st = drive.stick[limb];
    let lo = 0, hi = hits.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (hits[m].t <= t) lo = m + 1; else hi = m; }
    const since = lo > 0 ? t - hits[lo - 1].t : Infinity, until = lo < hits.length ? hits[lo].t - t : Infinity;
    const sm = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
    // breathing: fades near the notes
    const idle = sm(0.45, 1.1, since) * sm(0.55, 1.1, until);
    if (idle > 0) {
      const ph = limb === "MD" ? 0 : 1.7;
      restV.set(0.008 * Math.sin(2 * Math.PI * t / 3.7 + ph), 0.011 * Math.sin(2 * Math.PI * t / 4.3 + ph * 0.6) - 0.012,
        0.007 * Math.sin(2 * Math.PI * t / 5.3 + ph * 1.3));
      st.pos.addScaledVector(restV, idle);
    }
    // long break: sticks on the thighs
    const lap = sm(0.7, 1.8, since) * sm(1.2, 2.2, until);
    lapW[limb] = lap;
    if (lap > 0) {
      st.pos.lerp(lapP[limb], lap);
      st.quat.slerp(lapQ[limb], lap);
      // on the way, the hand rises a little so the stick clears the snare
      st.pos.y += 0.07 * 4 * lap * (1 - lap);
      drive.swivel[limb] += (0.18 - drive.swivel[limb]) * lap;
      drive.grip[limb] *= 1 - lap;
      arms[limb].dir.set(0, 1, 0).applyQuaternion(st.quat);
    }
  }

  /** Decide the pose drive at time t. */
  function perform(t, prep, press) {
    performHands(t, prep);
    performBody(t, prep, press);
  }

  /** Wrists at time t (hands only, to bake the body). */
  const wq = new Quaternion(), wv = new Vector3();
  function wrists(t, prep, outR, outL) {
    performHands(t, prep);
    HANDS.forEach((limb, k) => {
      const st = drive.stick[limb], g = skel.grip[limb], out = k ? outL : outR;
      wq.copy(st.quat).multiply(gInv[limb]);
      wv.copy(g.f).applyQuaternion(wq);
      out.x = st.pos.x - wv.x; out.y = st.pos.y - wv.y; out.z = st.pos.z - wv.z;
    });
  }
  const gInv = { MD: skel.grip.MD.q.clone().invert(), ME: skel.grip.ME.q.clone().invert() };

  function sync() {
    const P = skel.pos;
    for (const limb of HANDS) {
      const a = arms[limb];
      a.shoulder.copy(P[BONE[`arm.${limb}`]]);
      a.elbow.copy(P[BONE[`forearm.${limb}`]]);
      a.wrist.copy(P[BONE[`hand.${limb}`]]);
      a.fulcrum.copy(drive.stick[limb].pos);
      a.dir.set(0, 1, 0).applyQuaternion(drive.stick[limb].quat);
      a.reached = skel.reached[limb];
    }
    for (const limb of FEET) {
      const g = legs[limb];
      g.hip.copy(P[BONE[`thigh.${limb}`]]);
      g.knee.copy(P[BONE[`shin.${limb}`]]);
      g.ankle.copy(P[BONE[`foot.${limb}`]]);
      g.reached = skel.reached[limb];
    }
    torso.position.copy(P[BONE.hips]);
    torso.quaternion.copy(skel.quat[BONE.chest]);
    torso.updateMatrixWorld(true);
  }

  /** Compute the whole skeleton at time t. `press` = kick pedal (0..1). */
  function update(t, prep, press) {
    perform(t, prep, press);
    skel.solve(drive);
    sync();
  }

  /** Center of the stick's ball in the world (after update). */
  function tip(limb, out = new Vector3()) {
    const st = drive.stick[limb];
    return out.set(0, SKEL.stickFront, 0).applyQuaternion(st.quat).add(st.pos);
  }

  return {
    skel, drive, torso, arms, legs, configs, update, tip, TIP_R, X_AXIS,
    /** Baked performance (perform.js), or null for the procedural model. */
    setPlan(p) { plan = p; },
    wrists, headRest, curveClearance,
    get plan() { return plan; },
  };
}
