// Camera presets. Each is just a viewing direction; distance and target come from
// fitting the scene's silhouette (kit + drummer) in the free screen area, so nothing
// gets cut off at any aspect ratio.

import { Vector3 } from "../vendor/three.module.min.js";
import { CYMBALS, DRUMS, KICK } from "./layout.js";

export const CAMERA_NAMES = ["front", "drummer", "side", "top"];
export const CAMERA_LABELS = { front: "Front", drummer: "Drummer", side: "Side", top: "Top" };

// Silhouette points (m) that must fit: cymbal edges, kick front, floor tom, stand
// feet, the drummer's head, shoulders and back. Fitting real points (instead of a
// box) keeps the framing tight, with no empty corners.
const SILHOUETTE = (() => {
  const pts = [];
  const ring = (x, y, z, r) => { for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; pts.push([x + r * Math.cos(a), y, z + r * Math.sin(a)]); } };
  ring(...CYMBALS.crash.pos, CYMBALS.crash.r);
  ring(...CYMBALS.ride.pos, CYMBALS.ride.r);
  ring(...CYMBALS.hihat.pos, CYMBALS.hihat.r);
  for (const id of ["tom1", "tom2", "snare"]) ring(...DRUMS[id].pos, DRUMS[id].r);
  const fl = DRUMS.floor;
  ring(fl.pos[0], fl.pos[1], fl.pos[2], fl.r);
  ring(fl.pos[0], 0.02, fl.pos[2], fl.r + 0.05);
  const [kx, ky, kz] = KICK.pos, kf = kz - KICK.depth;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, -1], [-0.7, 0.7], [0.7, 0.7]]) pts.push([kx + dx * KICK.r, ky + dy * KICK.r, kf]);
  // feet of the cymbal and throne stands, on the floor
  for (const [x, z, r] of [[-0.46, -0.62, 0.26], [0.74, -0.58, 0.26], [-0.47, -0.36, 0.22], [0, 0.28, 0.24]]) ring(x, 0.0, z, r);
  // drummer: head, shoulders, back, knees
  pts.push([0, 1.43, 0.18], [-0.16, 1.38, 0.2], [0.16, 1.38, 0.2], [-0.27, 1.06, 0.24], [0.27, 1.06, 0.24]);
  pts.push([0, 0.75, 0.5], [-0.2, 0.5, 0.42], [0.2, 0.5, 0.42]);
  pts.push([-0.3, 0.62, -0.1], [0.12, 0.62, -0.14]);
  return pts;
})();

// dir = where the camera looks from (target to camera); bias = target offset from the
// box center; margin = slack around it (fraction).
const PRESETS = {
  // 3/4 from the front right, from above: face, both hands and the kit, with no cymbal
  // in front of the body (hi-hat and crash are on the drummer's left)
  front: { dir: [0.34, 0.56, -0.76], bias: [0, 0, 0], margin: 0.06 },
  // over the left shoulder: on a right-handed kit, nearly everything happens there
  drummer: { dir: [-0.36, 0.78, 0.5], bias: [0, 0, 0], margin: 0.05 },
  // from the side, from the right and slightly behind: shows the feet on the pedals
  side: { dir: [0.9, 0.3, 0.32], bias: [0, 0, 0], margin: 0.06 },
  top: { dir: [0.02, 1, 0.12], bias: [0, 0, 0], margin: 0.05 },
};

const UP = new Vector3(0, 1, 0);
const corner = new Vector3(), right = new Vector3(), up = new Vector3(), dir = new Vector3(), center = new Vector3();

/**
 * Position and target of camera `name` for a screen area with this aspect and
 * vertical field of view (degrees).
 */
export function cameraPose(name, aspect, vfovDeg, outPos, outTarget) {
  const p = PRESETS[name] || PRESETS.front;
  dir.set(...p.dir).normalize();
  right.crossVectors(UP, dir).normalize();
  up.crossVectors(dir, right).normalize();
  const tanV = Math.tan((vfovDeg * Math.PI) / 360), tanH = tanV * aspect;
  center.set(0, 0, 0);
  for (const q of SILHOUETTE) center.x += q[0], center.y += q[1], center.z += q[2];
  center.divideScalar(SILHOUETTE.length).add(corner.set(...p.bias));
  // two passes: find the distance, recenter the target on what is seen
  for (let pass = 0; pass < 2; pass++) {
    let d = 0;
    for (const q of SILHOUETTE) {
      corner.set(...q).sub(center);
      const z = corner.dot(dir);
      d = Math.max(d, z + Math.abs(corner.dot(right)) / tanH, z + Math.abs(corner.dot(up)) / tanV);
    }
    d *= 1 + p.margin;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const q of SILHOUETTE) {
      corner.set(...q).sub(center);
      const depth = d - corner.dot(dir);
      const sx = corner.dot(right) / depth, sy = corner.dot(up) / depth;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    if (pass === 0) {
      // move the target to the projection's center (in the camera plane, at target distance)
      center.addScaledVector(right, ((x0 + x1) / 2) * d).addScaledVector(up, ((y0 + y1) / 2) * d);
    } else {
      outTarget.copy(center);
      outPos.copy(center).addScaledVector(dir, d);
    }
  }
}
