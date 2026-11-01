// Anticipation ring: shrinks to the piece's size at the moment of the stroke, starting
// 1 beat ahead.

import { DoubleSide, Mesh, MeshBasicMaterial, RingGeometry } from "../vendor/three.module.min.js";
import { upperBound } from "./timeline.js";

export const RINGS_PER_PIECE = 4;

/** Create a piece's (invisible) rings, lying in the frame's plane, at `y`. */
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

/** Show the rings of the next strokes (up to 1 beat ahead) at time t. */
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
