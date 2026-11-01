// Analytic two-bone IK (shoulder-elbow-wrist, hip-knee-ankle).
// Bones have fixed length; if the target is too far, the limb stretches toward it
// and `solveTwoBone` returns false.

import { Vector3 } from "../vendor/three.module.min.js";

const _dir = new Vector3();
const _perp = new Vector3();

/**
 * @param {Vector3} root   start of the first bone
 * @param {Vector3} target where the end of the second bone should be
 * @param {number} a       length of the first bone
 * @param {number} b       length of the second bone
 * @param {Vector3} pole   direction the middle joint points to
 * @param {Vector3} outMid receives the middle joint (elbow or knee)
 * @param {Vector3} outEnd receives the end (wrist or ankle)
 * @returns {boolean} true if the target was reached exactly
 */
export function solveTwoBone(root, target, a, b, pole, outMid, outEnd) {
  _dir.subVectors(target, root);
  let d = _dir.length();
  if (d < 1e-6) { _dir.set(0, -1, 0); d = 1e-6; } else _dir.divideScalar(d);
  const minD = Math.abs(a - b) + 1e-4, maxD = a + b - 1e-4;
  const reached = d >= minD && d <= maxD;
  const dc = Math.min(maxD, Math.max(minD, d));

  const cosA = Math.min(1, Math.max(-1, (a * a + dc * dc - b * b) / (2 * a * dc)));
  const sinA = Math.sqrt(1 - cosA * cosA);

  // Pole component perpendicular to the root-target axis.
  _perp.copy(pole).addScaledVector(_dir, -pole.dot(_dir));
  if (_perp.lengthSq() < 1e-10) {
    _perp.set(0, 1, 0).addScaledVector(_dir, -_dir.y);
    if (_perp.lengthSq() < 1e-10) _perp.set(1, 0, 0);
  }
  _perp.normalize();

  outMid.copy(root).addScaledVector(_dir, a * cosA).addScaledVector(_perp, a * sinA);
  outEnd.copy(root).addScaledVector(_dir, dc);
  return reached;
}
