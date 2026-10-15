// Formas do estilo pelúcia a partir de primitivas: esferas deformadas, tornos
// (lathe) com normais do perfil e cor por trecho, almofadas, tubos de linha e
// pontos de costura. Tudo termina juntado em poucas geometrias com skinning
// (um osso por parte rígida), pra sair em pouquíssimos draw calls.

import {
  BufferAttribute, BufferGeometry, CatmullRomCurve3, Matrix4, OctahedronGeometry, SphereGeometry, TubeGeometry,
  Uint16BufferAttribute, Vector3,
} from "../vendor/three.module.min.js";

const UP = new Vector3(0, 1, 0);

/**
 * Esfera deformada: `shape(d, out)` recebe a direção unitária d e escreve o
 * ponto da superfície em out. Normais recalculadas.
 */
export function blob(shape, { w = 24, h = 16 } = {}) {
  const geo = new SphereGeometry(1, w, h);
  const p = geo.attributes.position, d = new Vector3(), out = new Vector3();
  for (let i = 0; i < p.count; i++) {
    d.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    shape(d, out);
    p.setXYZ(i, out.x, out.y, out.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Elipsoide simples (semieixos rx, ry, rz). */
export const ellipsoid = (rx, ry, rz, w = 16, h = 10) => new SphereGeometry(1, w, h).scale(rx, ry, rz);

/**
 * Torno com normais tiradas do perfil (liso, sem facetas nem costura em
 * volta). `pts` = [[raio, y, slot?], ...]; o slot vale do ponto até o
 * próximo, e onde ele muda o anel é duplicado (borda de cor nítida, mesma
 * normal dos dois lados). Devolve geometria indexada com atributo `slot`.
 */
export function lathe(pts, segments = 40, slot = 0) {
  const n = pts.length;
  // normal 2D de cada ponto (média das normais dos dois trechos vizinhos)
  const nr = [], ny = [];
  for (let j = 0; j < n; j++) {
    const a = pts[Math.max(0, j - 1)], b = pts[Math.min(n - 1, j + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    nr.push(ty); ny.push(-tx); // perfil de baixo pra cima, normal pra fora
  }
  const rows = []; // [índice do ponto, slot]
  for (let j = 0; j < n; j++) {
    const s = pts[j][2] ?? slot, prev = j ? pts[j - 1][2] ?? slot : s;
    if (j && s !== prev) rows.push([j, prev]);
    rows.push([j, s]);
  }
  const pos = [], nor = [], sl = [], idx = [];
  for (const [j, s] of rows) {
    const [r, y] = pts[j];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      pos.push(r * sn, y, r * c);
      nor.push(nr[j] * sn, ny[j], nr[j] * c);
      sl.push(s);
    }
  }
  for (let k = 0; k < rows.length - 1; k++) {
    if (rows[k][0] === rows[k + 1][0]) continue; // anel duplicado (troca de cor)
    for (let i = 0; i < segments; i++) {
      const a = k * (segments + 1) + i, b = a + segments + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute("slot", new BufferAttribute(new Float32Array(sl), 1));
  g.setIndex(idx);
  return g;
}

/** Perfil de superelipse (cilindro estufado): do centro de baixo ao centro de cima. */
export function cushionProfile(r, y0, y1, p = 4, n = 24) {
  const pts = [], yc = (y0 + y1) / 2, hh = (y1 - y0) / 2;
  for (let k = 0; k <= n; k++) {
    const t = -Math.PI / 2 + (k / n) * Math.PI, c = Math.cos(t), s = Math.sin(t);
    pts.push([r * Math.pow(Math.abs(c), 2 / p), yc + hh * Math.sign(s) * Math.pow(Math.abs(s), 2 / p)]);
  }
  pts[0][0] = 0;
  pts[n][0] = 0;
  return pts;
}

/**
 * Almofada retangular: superelipsoide |x/a|^p + |y/b|^p + |z/c|^p = 1, com
 * largura w (x), altura h (y) e fundo d (z). p maior = cantos mais quadrados.
 */
export function pillow(w, h, d, p = 4) {
  const a = w / 2, b = h / 2, c = d / 2;
  return blob((dir, out) => {
    const s = Math.pow(Math.abs(dir.x / a) ** p + Math.abs(dir.y / b) ** p + Math.abs(dir.z / c) ** p, -1 / p);
    return out.copy(dir).multiplyScalar(s);
  });
}

/** Tubo fino ao longo de pontos (linha de costura, bigode, boca). */
export function thread(points, r = 0.0012, { segs = 0, radial = 5 } = {}) {
  const curve = new CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : new Vector3(...p))));
  return new TubeGeometry(curve, segs || Math.max(4, points.length * 6), r, radial, false);
}

/** Base com -z na normal n e +y o mais perto possível de `up`. */
export function basis(pos, n, up = UP) {
  const z = n.clone().negate();
  const x = new Vector3().crossVectors(up, z);
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0);
  x.normalize();
  const y = new Vector3().crossVectors(z, x);
  return new Matrix4().makeBasis(x, y, z).setPosition(pos);
}

// ---------- costuras ----------
export const STITCH = { len: 0.0075, gap: 0.005, w: 0.0017, h: 0.0011, lift: 0.0006 };

/**
 * Pontos de costura ao longo de uma linha na superfície. `at(s, P, N)` escreve
 * o ponto e a normal no parâmetro s (0..1); `length` é o comprimento (m).
 * Devolve uma matriz por ponto (um grão achatado ao longo da linha).
 */
export function stitchLine(at, length, out = [], { closed = false, len = STITCH.len, gap = STITCH.gap } = {}) {
  let period = len + gap, n, offset;
  if (closed) {
    n = Math.max(3, Math.round(length / period));
    period = length / n;
    offset = 0;
  } else {
    n = Math.max(1, Math.floor((length + gap) / period));
    offset = (length - n * period + gap) / 2;
  }
  const P = new Vector3(), N = new Vector3(), P2 = new Vector3(), N2 = new Vector3();
  const X = new Vector3(), Y = new Vector3(), m = new Matrix4();
  for (let k = 0; k < n; k++) {
    const s0 = (offset + k * period) / length, s1 = s0 + len / length;
    at(s0, P, N);
    at(Math.min(1, s1), P2, N2);
    X.subVectors(P2, P);
    const l = X.length();
    if (l < 1e-6) continue;
    X.divideScalar(l);
    N.add(N2).normalize();
    Y.crossVectors(N, X).normalize();
    const Z = new Vector3().crossVectors(X, Y);
    const c = P.add(P2).multiplyScalar(0.5).addScaledVector(Z, STITCH.lift);
    m.makeBasis(X.multiplyScalar(l / 2), Y.multiplyScalar(STITCH.w / 2), Z.multiplyScalar(STITCH.h));
    m.setPosition(c);
    out.push(m.clone());
  }
  return out;
}

/** Geometria dos pontos de costura (um octaedro achatado por matriz). */
export function stitchGeometry(matrices) {
  const unit = new OctahedronGeometry(1, 0);
  const geos = matrices.map((m) => unit.clone().applyMatrix4(m));
  unit.dispose();
  return geos;
}

/**
 * Junta partes rígidas ou com pesos num BufferGeometry com skinning.
 * Parte: { geo, slot, bones: [até 4], weights: [até 4] }. Atributos de saída:
 * position, normal, slot, skinIndex, skinWeight e `puv` (se alguma parte tiver).
 * As geometrias de entrada são liberadas.
 */
export function mergeSkinned(parts) {
  let nv = 0, ni = 0;
  const withPuv = parts.some((p) => p.geo.attributes.puv);
  for (const p of parts) {
    if (!p.geo.index) p.geo.setIndex(Array.from({ length: p.geo.attributes.position.count }, (_, i) => i));
    nv += p.geo.attributes.position.count;
    ni += p.geo.index.count;
  }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), slot = new Float32Array(nv);
  const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4), idx = new Uint32Array(ni);
  const puv = withPuv ? new Float32Array(nv * 2) : null;
  let ov = 0, oi = 0;
  for (const p of parts) {
    const g = p.geo, n = g.attributes.position.count, a = g.attributes;
    pos.set(a.position.array, ov * 3);
    nor.set(a.normal.array, ov * 3);
    if (puv && a.puv) puv.set(a.puv.array, ov * 2);
    const bones = p.bones || [p.bone ?? 0], weights = p.weights || [1];
    for (let k = 0; k < n; k++) {
      slot[ov + k] = a.slot ? a.slot.array[k] : p.slot;
      for (let q = 0; q < 4; q++) {
        si[(ov + k) * 4 + q] = bones[q] ?? 0;
        sw[(ov + k) * 4 + q] = weights[q] ?? 0;
      }
    }
    for (let k = 0; k < g.index.count; k++) idx[oi + k] = g.index.array[k] + ov;
    ov += n;
    oi += g.index.count;
    g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute("position", new BufferAttribute(pos, 3));
  out.setAttribute("normal", new BufferAttribute(nor, 3));
  out.setAttribute("slot", new BufferAttribute(slot, 1));
  out.setAttribute("skinIndex", new Uint16BufferAttribute(si, 4));
  out.setAttribute("skinWeight", new BufferAttribute(sw, 4));
  if (puv) out.setAttribute("puv", new BufferAttribute(puv, 2));
  out.setIndex(new BufferAttribute(nv > 65535 ? idx : Uint16Array.from(idx), 1));
  return out;
}
