// Câmeras prontas. Cada uma é só uma direção de olhar; a distância e o alvo
// saem de encaixar a silhueta da cena (kit + baterista + rabo) na área livre
// da tela, então nada fica cortado em nenhuma proporção de tela.

import { Vector3 } from "../vendor/three.module.min.js";
import { CYMBALS, DRUMS, KICK } from "./layout.js";

export const CAMERA_NAMES = ["frente", "baterista", "lado", "cima"];
export const CAMERA_LABELS = { frente: "Frente", baterista: "Baterista", lado: "Lado", cima: "Cima" };

// Pontos da silhueta da cena (m) que precisam caber: bordas dos pratos, frente
// do bumbo, surdo, pés das estantes, a cabeça e as orelhas do baterista, as
// costas e a ponta do rabo. Encaixar pontos reais (em vez de uma caixa) deixa
// o enquadramento justo, sem cantos vazios.
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
  // pés das estantes dos pratos e do banco, no chão
  for (const [x, z, r] of [[-0.46, -0.62, 0.26], [0.74, -0.58, 0.26], [-0.47, -0.36, 0.22], [0, 0.28, 0.24]]) ring(x, 0.0, z, r);
  // baterista: cabeça e orelhas, ombros, costas, joelhos, rabo
  pts.push([0, 1.43, 0.18], [-0.16, 1.38, 0.2], [0.16, 1.38, 0.2], [-0.27, 1.06, 0.24], [0.27, 1.06, 0.24]);
  pts.push([0, 0.75, 0.5], [-0.2, 0.5, 0.42], [0.2, 0.5, 0.42], [0, 0.42, 0.86], [0, 0.3, 0.7]);
  pts.push([-0.3, 0.62, -0.1], [0.12, 0.62, -0.14]);
  return pts;
})();

// dir = de onde a câmera olha (do alvo pra câmera); bias = deslocamento do
// alvo a partir do centro da caixa; margin = folga em volta (fração).
const PRESETS = {
  // 3/4 pela frente-esquerda, um pouco de cima: rosto, as duas mãos e o kit
  frente: { dir: [-0.42, 0.4, -0.8], bias: [0, 0, 0], margin: 0.06 },
  // por cima do ombro esquerdo: num kit de destro é ali que acontece quase tudo
  baterista: { dir: [-0.36, 0.78, 0.5], bias: [0, 0, 0], margin: 0.05 },
  // de lado, pela direita e um pouco por trás: mostra os pés nos pedais
  lado: { dir: [0.9, 0.3, 0.32], bias: [0, 0, 0], margin: 0.06 },
  cima: { dir: [0.02, 1, 0.12], bias: [0, 0, 0], margin: 0.05 },
};

const UP = new Vector3(0, 1, 0);
const corner = new Vector3(), right = new Vector3(), up = new Vector3(), dir = new Vector3(), center = new Vector3();

/**
 * Posição e alvo da câmera `name` pra uma área de tela com essa proporção e
 * esse campo de visão vertical (graus).
 */
export function cameraPose(name, aspect, vfovDeg, outPos, outTarget) {
  const p = PRESETS[name] || PRESETS.frente;
  dir.set(...p.dir).normalize();
  right.crossVectors(UP, dir).normalize();
  up.crossVectors(dir, right).normalize();
  const tanV = Math.tan((vfovDeg * Math.PI) / 360), tanH = tanV * aspect;
  center.set(0, 0, 0);
  for (const q of SILHOUETTE) center.x += q[0], center.y += q[1], center.z += q[2];
  center.divideScalar(SILHOUETTE.length).add(corner.set(...p.bias));
  // duas passadas: acha a distância, recentra o alvo no meio do que se vê
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
      // desloca o alvo pro centro da projeção (no plano da câmera, na distância do alvo)
      center.addScaledVector(right, ((x0 + x1) / 2) * d).addScaledVector(up, ((y0 + y1) / 2) * d);
    } else {
      outTarget.copy(center);
      outPos.copy(center).addScaledVector(dir, d);
    }
  }
}
