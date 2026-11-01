// Piece geometry: where each piece is, where the stick touches, the cymbal profile,
// the pedal angles and the stands.

import { Object3D, Vector3 } from "../vendor/three.module.min.js";
import {
  CONTACTS, CYMBALS, DRUMS, HIHAT_PEDAL, KICK, KICK_PEDAL, STRIKE_ANGLE, THRONE,
} from "./layout.js";

const UP = new Vector3(0, 1, 0);

// Cymbal profile, pairs (radius, height) in meters: bell + arc to the edge.
export function cymbalProfile(r) {
  return [[0, 0.03], [0.032, 0.028], [0.05, 0.016], [0.07, 0.007], [r, -0.012]];
}
export function profileHeight(profile, rho) {
  for (let i = 1; i < profile.length; i++) {
    const [r0, y0] = profile[i - 1], [r1, y1] = profile[i];
    if (rho <= r1) return y0 + ((rho - r0) / (r1 - r0)) * (y1 - y0);
  }
  return profile[profile.length - 1][1];
}
const PROFILES = Object.fromEntries(Object.entries(CYMBALS).map(([id, c]) => [id, cymbalProfile(c.r)]));

/** "drum", "cymbal" or "kick". */
export const pieceKind = (id) => (id === "kick" ? "kick" : CYMBALS[id] ? "cymbal" : "drum");

/**
 * Put `obj` in the piece's "frame": origin at the center of the strike surface,
 * y = head normal, z = drummer's side (on the kick, y points to the drummer).
 */
export function placeFrame(id, obj) {
  if (id === "kick") {
    obj.position.set(...KICK.pos);
    obj.rotation.set(Math.PI / 2, 0, 0);
  } else {
    const s = DRUMS[id] || CYMBALS[id];
    obj.position.set(...s.pos);
    obj.rotation.set(s.tilt || 0, 0, s.roll || 0);
  }
  obj.updateMatrix();
  return obj;
}

/** Strike surface height in the piece's frame, `rho` meters from the center. */
export const surfaceY = (id, rho) => (PROFILES[id] ? profileHeight(PROFILES[id], rho) : 0);

const tmpFrame = new Object3D();
/** Contact point and surface normal (world) for hand `limb` on piece `id`. */
export function contact(id, limb, outP, outN) {
  const [x, z] = CONTACTS[id][limb];
  placeFrame(id, tmpFrame);
  outP.set(x, surfaceY(id, Math.hypot(x, z)), z).applyMatrix4(tmpFrame.matrix);
  outN.copy(UP).applyQuaternion(tmpFrame.quaternion);
}

/** Angle between the stick and the surface at the strike. */
export const strikeAngle = (id) => (CYMBALS[id] ? STRIKE_ANGLE.cymbal : STRIKE_ANGLE.drum);

/** Kick pedal angle with the pedal pressed `p` (0 = released, 1 = beater on the head). */
export const pedalAngle = (p) => KICK_PEDAL.restAngle + (KICK_PEDAL.pressAngle - KICK_PEDAL.restAngle) * p;

// Beater angle touching the head.
const BEATER_CONTACT = Math.asin((KICK.pos[2] + KICK_PEDAL.feltR - KICK_PEDAL.beaterPivot[2]) / KICK_PEDAL.beaterLen);
/** Beater angle (rotation.x) with the pedal pressed `p`. */
export const beaterAngle = (p) => BEATER_CONTACT + (1 - p) * KICK_PEDAL.beaterBack;

/**
 * Stands and supports: segments { a, b, r, frame }, with a/b in the world or, if
 * `frame` is set, in that piece's frame. `foot` marks the end touching the floor.
 */
export function standRods() {
  const out = [];
  const rod = (a, b, r, frame = null, foot = false) => out.push({ a, b, r, frame, foot });
  const f = new Object3D(), v = new Vector3();
  function tripod(x, z, top, spread = 0.2, r = 0.008) {
    rod([x, 0.2, z], [x, top, z], r);
    for (let k = 0; k < 3; k++) {
      const ang = Math.PI / 2 + (k * 2 * Math.PI) / 3;
      rod([x, 0.22, z], [x + Math.cos(ang) * spread, 0.005, z - Math.sin(ang) * spread], r * 0.8, null, true);
    }
  }

  // drums
  const sn = DRUMS.snare.pos;
  tripod(sn[0], sn[2], sn[1] - DRUMS.snare.depth - 0.01, 0.2);
  const fl = DRUMS.floor;
  for (let k = 0; k < 3; k++) {
    const ang = -Math.PI / 6 + (k * 2 * Math.PI) / 3;
    const x = fl.pos[0] + Math.cos(ang) * (fl.r + 0.03), z = fl.pos[2] - Math.sin(ang) * (fl.r + 0.03);
    rod([x, fl.pos[1] - 0.06, z], [x + Math.cos(ang) * 0.05, 0.005, z - Math.sin(ang) * 0.05], 0.007, null, true);
  }
  const holderTop = [0.12, 0.72, -0.66];
  rod([0.12, 0.55, -0.66], holderTop, 0.011);
  for (const id of ["tom1", "tom2"]) {
    placeFrame(id, f);
    v.set(0, -DRUMS[id].depth * 0.55, 0).applyMatrix4(f.matrix);
    rod(holderTop, [v.x, v.y, v.z], 0.009);
  }

  // cymbals: a vertical rod up to just under the bell
  for (const id of Object.keys(CYMBALS)) {
    if (id === "hihat") rod([0, 0.03, 0], [0, 0.12, 0], 0.004, "hihat");
    placeFrame(id, f);
    v.set(0, -0.035, 0).applyMatrix4(f.matrix);
    tripod(v.x, v.z, v.y, id === "hihat" ? 0.2 : 0.24);
  }
  rod([0, -0.03, 0], [0, -0.035, 0], 0.004, "hihat");

  // kick
  const [kx, ky, kz] = KICK.pos, zMid = kz - KICK.depth * 0.75;
  rod([kx - KICK.r * 0.8, ky - 0.05, zMid], [kx - KICK.r - 0.12, 0.005, zMid + 0.06], 0.008, null, true);
  rod([kx + KICK.r * 0.8, ky - 0.05, zMid], [kx + KICK.r + 0.12, 0.005, zMid + 0.06], 0.008, null, true);

  // kick pedal: columns and beater axis
  const P = KICK_PEDAL;
  for (const dx of [-0.055, 0.055]) {
    rod([P.beaterPivot[0] + dx, 0.008, P.beaterPivot[2]], [P.beaterPivot[0] + dx, P.beaterPivot[1], P.beaterPivot[2]], 0.006);
  }
  rod([P.beaterPivot[0] - 0.055, P.beaterPivot[1], P.beaterPivot[2]],
    [P.beaterPivot[0] + 0.055, P.beaterPivot[1], P.beaterPivot[2]], 0.005);

  // hi-hat pedal: rod up to the hi-hat
  const H = HIHAT_PEDAL, hh = CYMBALS.hihat.pos;
  rod([H.hinge[0], 0.008, H.hinge[2] - H.length], [hh[0], 0.03, hh[2]], 0.006);

  // throne
  tripod(THRONE.pos[0], THRONE.pos[2], THRONE.pos[1] - 0.08, 0.22, 0.012);
  return out;
}
