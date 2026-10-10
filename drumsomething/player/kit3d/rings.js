// Anel de antecipação: encolhe até o tamanho da peça no instante do golpe,
// com 1 tempo de antecedência. Igual nos dois estilos.

import { DoubleSide, Mesh, MeshBasicMaterial, RingGeometry } from "../vendor/three.module.min.js";
import { upperBound } from "./timeline.js";

export const RINGS_PER_PIECE = 4;

/** Cria os anéis (invisíveis) de uma peça, deitados no plano do frame, em `y`. */
export function createRings(parent, r, y, keep) {
  const geo = keep(new RingGeometry(r * 0.93, r, 48, 1));
  geo.rotateX(-Math.PI / 2);
  const rings = [];
  for (let k = 0; k < RINGS_PER_PIECE; k++) {
    const mat = keep(new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide }));
    const m = new Mesh(geo, mat);
    m.position.y = y;
    m.visible = false;
    m.renderOrder = 2;
    parent.add(m);
    rings.push(m);
  }
  return rings;
}

/** Mostra os anéis dos próximos golpes (até 1 tempo à frente) no tempo t. */
export function updateRings(rings, hits, t, clock, show) {
  let shown = 0;
  if (show) {
    const len = clock.beatLen(t);
    for (let j = upperBound(hits, t); j < hits.length && shown < rings.length; j++) {
      const dt = hits[j].t - t;
      if (dt > len) break;
      const ring = rings[shown++], u = dt / len;
      ring.visible = true;
      ring.scale.setScalar(1 + 1.4 * u);
      ring.material.opacity = 0.9 * (1 - u) + 0.08;
    }
  }
  for (let k = shown; k < rings.length; k++) rings[k].visible = false;
}
