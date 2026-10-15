// IK de dois ossos (ombro-cotovelo-pulso, quadril-joelho-tornozelo), analítico.
// Os ossos têm comprimento fixo; se o alvo estiver longe demais, o membro estica
// na direção dele e `solveTwoBone` devolve false.

import { Vector3 } from "../vendor/three.module.min.js";

const _dir = new Vector3();
const _perp = new Vector3();

/**
 * @param {Vector3} root   início do primeiro osso
 * @param {Vector3} target onde o fim do segundo osso deve ficar
 * @param {number} a       comprimento do primeiro osso
 * @param {number} b       comprimento do segundo osso
 * @param {Vector3} pole   direção pra onde a junta do meio aponta
 * @param {Vector3} outMid recebe a junta do meio (cotovelo/joelho)
 * @param {Vector3} outEnd recebe o fim (pulso/tornozelo)
 * @returns {boolean} true se o alvo foi alcançado exatamente
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

  // Componente do polo perpendicular ao eixo raiz-alvo.
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
