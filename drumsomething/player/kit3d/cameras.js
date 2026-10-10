// Câmeras prontas. "baterista" (por cima do ombro) é a que mais ajuda quem aprende.

import { Vector3 } from "../vendor/three.module.min.js";

export const CAMERA_NAMES = ["baterista", "frente", "lado", "cima"];
export const CAMERA_LABELS = { baterista: "Baterista", frente: "Frente", lado: "Lado", cima: "Cima" };

// pos/target em metros; `fit` = raio (m) em volta do alvo que precisa caber na tela.
const PRESETS = {
  // Por cima do ombro esquerdo: num kit de destro é ali que acontece quase tudo
  // (chimbal, caixa, mão cruzada) e a cabeça não fica na frente das mãos.
  baterista: { pos: [-0.5, 2.3, 0.8], target: [0.06, 0.76, -0.4], fit: 0.7 },
  frente: { pos: [0.05, 1.45, -2.45], target: [0.08, 0.78, -0.25], fit: 0.85 },
  // de lado, um pouco por trás, pra que o surdo não esconda os pés
  lado: { pos: [1.95, 1.0, 1.15], target: [0.05, 0.62, -0.2], fit: 0.85 },
  cima: { pos: [0.04, 3.05, 0.32], target: [0.06, 0.55, -0.26], fit: 0.92 },
};

/**
 * Posição e alvo da câmera `name` pra uma tela com essa proporção. Em telas
 * estreitas (celular em pé) a câmera recua pra que o kit caiba na largura.
 */
export function cameraPose(name, aspect, vfovDeg, outPos, outTarget) {
  const p = PRESETS[name] || PRESETS.baterista;
  outTarget.set(...p.target);
  outPos.set(...p.pos);
  const dir = new Vector3().subVectors(outPos, outTarget);
  const dist = dir.length();
  const half = (vfovDeg * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(half) * aspect);
  const need = p.fit / Math.tan(Math.min(half, hHalf));
  dir.multiplyScalar(Math.max(dist, need) / dist);
  outPos.copy(outTarget).add(dir);
}
