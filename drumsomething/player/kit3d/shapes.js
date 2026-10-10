// Formas estufadas pro estilo pelúcia, todas a partir de primitivas: esferas
// deformadas, tornos (lathe) com cantos redondos, membros afunilados, caixas
// arredondadas, tubos de linha e pontos de costura (instanced). As UVs saem em
// unidades de feltro (felt.js), com número inteiro de repetições em volta das
// peças fechadas pra textura não ter emenda.

import {
  BufferAttribute, BufferGeometry, CatmullRomCurve3, InstancedMesh, LatheGeometry, Matrix4,
  OctahedronGeometry, SphereGeometry, TubeGeometry, Vector2, Vector3,
} from "../vendor/three.module.min.js";
import { STRIPE_TILES, TILE } from "./felt.js";

/** Unidades de UV em volta de um contorno fechado (múltiplo das listras). */
export const aroundUnits = (circ) => STRIPE_TILES * Math.max(1, Math.round(circ / (STRIPE_TILES * TILE)));

/** Escala as UVs (u por su, v por sv). */
export function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

/** UV plana: projeta nos eixos a e b (0 = x, 1 = y, 2 = z), em unidades. */
export function planarUV(geo, a = 0, b = 2) {
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const v = [p.getX(i), p.getY(i), p.getZ(i)];
    uv.setXY(i, v[a] / TILE, v[b] / TILE);
  }
  return geo;
}

/** Média das normais de vértices na mesma posição (some a costura da esfera). */
export function smoothSeams(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal, map = new Map();
  const key = (i) => `${Math.round(p.getX(i) * 1e5)},${Math.round(p.getY(i) * 1e5)},${Math.round(p.getZ(i) * 1e5)}`;
  for (let i = 0; i < p.count; i++) {
    const k = key(i);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(i);
  }
  const v = new Vector3();
  for (const list of map.values()) {
    if (list.length < 2) continue;
    v.set(0, 0, 0);
    for (const i of list) v.x += n.getX(i), v.y += n.getY(i), v.z += n.getZ(i);
    v.normalize();
    for (const i of list) n.setXYZ(i, v.x, v.y, v.z);
  }
  return geo;
}

/**
 * Esfera deformada: `shape(d, out)` recebe a direção unitária d e escreve o
 * ponto da superfície em out. `axis` = "y" (polo em cima) ou "-z" (polo pra
 * frente). UV: u em volta do polo, v do polo ao outro, em unidades.
 */
export function blob(shape, { w = 28, h = 20, axis = "y", circ = 0.6, merid = 0.3 } = {}) {
  const geo = new SphereGeometry(1, w, h);
  if (axis === "-z") geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position, d = new Vector3(), out = new Vector3();
  for (let i = 0; i < p.count; i++) {
    d.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    shape(d, out);
    p.setXYZ(i, out.x, out.y, out.z);
  }
  geo.computeVertexNormals();
  smoothSeams(geo);
  scaleUV(geo, aroundUnits(circ), merid / TILE);
  return geo;
}

/** Ponto na superfície do elipsoide de semieixos r na direção d. */
export function ellipsoidPoint(r, d, out) {
  const s = 1 / Math.sqrt((d.x / r.x) ** 2 + (d.y / r.y) ** 2 + (d.z / r.z) ** 2);
  return out.copy(d).multiplyScalar(s);
}

/** Elipsoide simples (semieixos rx, ry, rz). */
export function ellipsoid(rx, ry, rz, opts = {}) {
  const r = new Vector3(rx, ry, rz);
  const circ = 2 * Math.PI * Math.sqrt((rx * rx + (opts.axis === "-z" ? ry * ry : rz * rz)) / 2);
  return blob((d, out) => ellipsoidPoint(r, d, out), { circ, merid: Math.PI * Math.max(rx, ry, rz), ...opts });
}

/**
 * Torno com UV em unidades: u em volta (inteiro), v pelo comprimento do perfil.
 * `pts` = [[raio, y], ...].
 */
export function lathe(pts, segments = 40) {
  const v2 = pts.map(([x, y]) => new Vector2(x, y));
  const geo = new LatheGeometry(v2, segments);
  const rMax = Math.max(...pts.map((q) => q[0]));
  const arc = [0];
  for (let i = 1; i < v2.length; i++) arc.push(arc[i - 1] + v2[i].distanceTo(v2[i - 1]));
  const uv = geo.attributes.uv, nu = aroundUnits(2 * Math.PI * rMax);
  // LatheGeometry: vértice (i, j) = segmento i, ponto j
  for (let i = 0; i <= segments; i++) {
    for (let j = 0; j < v2.length; j++) {
      const k = i * v2.length + j;
      uv.setXY(k, (i / segments) * nu, arc[j] / TILE);
    }
  }
  return geo;
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
 * Membro afunilado e um pouco estufado, centrado na origem, ao longo de y:
 * de -len/2 (raio r0) a +len/2 (raio r1), com uma bola em cada ponta centrada
 * na junta, pra cotovelo e joelho ficarem redondos.
 */
export function limb(len, r0, r1, { bulge = 0.06, segments = 16 } = {}) {
  const pts = [];
  const capN = 5;
  for (let k = 0; k <= capN; k++) {
    const a = -Math.PI / 2 + (k / capN) * (Math.PI / 2);
    pts.push([r0 * Math.cos(a), -len / 2 + r0 * Math.sin(a)]);
  }
  const midN = 8;
  for (let k = 1; k < midN; k++) {
    const s = k / midN;
    pts.push([(r0 + (r1 - r0) * s) * (1 + bulge * Math.sin(Math.PI * s)), -len / 2 + len * s]);
  }
  for (let k = 0; k <= capN; k++) {
    const a = (k / capN) * (Math.PI / 2);
    pts.push([r1 * Math.cos(a), len / 2 + r1 * Math.sin(a)]);
  }
  pts[0][0] = 0;
  pts[pts.length - 1][0] = 0;
  const geo = lathe(pts, segments);
  // uv1 (listras): as pontas não juntam a textura num ponto (ficam lisas);
  // v = 0 na borda da ponta de baixo, que cai entre duas listras
  const uv = geo.attributes.uv, v0 = (Math.PI / 2) * r0 / TILE, v1 = uv.getY(pts.length - 1) - (Math.PI / 2) * r1 / TILE;
  const uv1 = new Float32Array(uv.count * 2);
  for (let i = 0; i < uv.count; i++) {
    uv1[i * 2] = uv.getX(i);
    uv1[i * 2 + 1] = Math.min(v1, Math.max(v0, uv.getY(i))) - v0;
  }
  geo.setAttribute("uv1", new BufferAttribute(uv1, 2));
  return geo;
}

/**
 * Almofada retangular: superelipsoide |x/a|^p + |y/b|^p + |z/c|^p = 1, com
 * largura w (x), altura h (y) e fundo d (z). p maior = cantos mais quadrados.
 */
export function pillow(w, h, d, p = 4, opts = {}) {
  const a = w / 2, b = h / 2, c = d / 2;
  const geo = blob((dir, out) => {
    const s = Math.pow(Math.abs(dir.x / a) ** p + Math.abs(dir.y / b) ** p + Math.abs(dir.z / c) ** p, -1 / p);
    return out.copy(dir).multiplyScalar(s);
  }, { w: 24, h: 16, ...opts });
  planarUV(geo, 0, 2);
  return geo;
}

/** Tubo fino ao longo de pontos (linha de costura, bigode, boca). */
export function thread(points, r = 0.0012, { segs = 0, radial = 5 } = {}) {
  const curve = new CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : new Vector3(...p))));
  return new TubeGeometry(curve, segs || Math.max(4, points.length * 6), r, radial, false);
}

/** Junta geometrias indexadas (position, normal, uv; uv1 e color se alguma tiver). */
export function mergeGeos(geos) {
  const withColor = geos.some((g) => g.attributes.color);
  const withUv1 = geos.some((g) => g.attributes.uv1);
  let nv = 0, ni = 0;
  for (const g of geos) {
    nv += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const col = withColor ? new Float32Array(nv * 3).fill(1) : null;
  const uv1 = withUv1 ? new Float32Array(nv * 2) : null;
  const idx = new (nv > 65535 ? Uint32Array : Uint16Array)(ni);
  let ov = 0, oi = 0;
  for (const g of geos) {
    const a = g.attributes, n = a.position.count;
    pos.set(a.position.array, ov * 3);
    nor.set(a.normal.array, ov * 3);
    if (a.uv) uv.set(a.uv.array, ov * 2);
    if (uv1 && (a.uv1 || a.uv)) uv1.set((a.uv1 || a.uv).array, ov * 2);
    if (col && a.color) col.set(a.color.array, ov * 3);
    if (g.index) for (let k = 0; k < g.index.count; k++) idx[oi + k] = g.index.array[k] + ov;
    else for (let k = 0; k < n; k++) idx[oi + k] = k + ov;
    oi += g.index ? g.index.count : n;
    ov += n;
    g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute("position", new BufferAttribute(pos, 3));
  out.setAttribute("normal", new BufferAttribute(nor, 3));
  out.setAttribute("uv", new BufferAttribute(uv, 2));
  if (col) out.setAttribute("color", new BufferAttribute(col, 3));
  if (uv1) out.setAttribute("uv1", new BufferAttribute(uv1, 2));
  out.setIndex(new BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/** uv1 constante (v = 0, entre duas listras): pelagem lisa, sem listra. */
export function plainUv1(geo) {
  const uv = geo.attributes.uv, uv1 = new Float32Array(uv.count * 2);
  for (let i = 0; i < uv.count; i++) uv1[i * 2] = uv.getX(i);
  geo.setAttribute("uv1", new BufferAttribute(uv1, 2));
  return geo;
}

/** uv1 = uv. */
export function sameUv1(geo) {
  geo.setAttribute("uv1", geo.attributes.uv.clone());
  return geo;
}

/** Pinta uma geometria inteira com uma cor de vértice (pra juntar com mergeGeos). */
export function tint(geo, r, g, b) {
  const n = geo.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([r, g, b], i * 3);
  geo.setAttribute("color", new BufferAttribute(c, 3));
  return geo;
}

// ---------- costuras ----------
export const STITCH = { len: 0.0075, gap: 0.005, w: 0.0017, h: 0.0011, lift: 0.0006 };

/**
 * Pontos de costura ao longo de uma linha na superfície. `at(s, P, N)` escreve
 * o ponto e a normal no parâmetro s (0..1); `length` é o comprimento (m).
 * Devolve matrizes (uma por ponto) pra uma InstancedMesh.
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

/** Um ponto de costura: grãozinho alongado (eixo x), baixo, com 8 triângulos. */
export function stitchGeometry() {
  return new OctahedronGeometry(1, 0);
}

/** InstancedMesh com os pontos de costura. */
export function stitchMesh(geo, mat, matrices) {
  const m = new InstancedMesh(geo, mat, Math.max(1, matrices.length));
  matrices.forEach((x, i) => m.setMatrixAt(i, x));
  m.count = matrices.length;
  m.computeBoundingSphere();
  return m;
}
