// Distância assinada (SDF) e poligonização, sem three.js: formas simples
// (cone arredondado, elipsoide), união suave (smooth-min) e "surface nets"
// numa grade esparsa, com os vértices projetados na superfície e normais
// tiradas do gradiente. Usado pra gerar o corpo contínuo do gato de pelúcia.

/** União suave polinomial: cola a e b com um "estofado" de raio k. */
export function smin(a, b, k) {
  const h = k - Math.abs(a - b);
  return h <= 0 ? Math.min(a, b) : Math.min(a, b) - (h * h) / (4 * k);
}

/**
 * Cone arredondado entre a e b (raios r1 em a, r2 em b). Pré-calcula o que
 * não depende do ponto; `roundCone.dist(c, x, y, z)` mede a distância.
 */
export function roundCone(a, b, r1, r2) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz, rr = r1 - r2;
  return {
    kind: 0, ax: a[0], ay: a[1], az: a[2], bax, bay, baz, l2, rr, a2: l2 - rr * rr, il2: 1 / l2, r1, r2,
    sphere: boundRoundCone(a, b, r1, r2),
  };
}

function boundRoundCone(a, b, r1, r2) {
  const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const h = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2;
  return [c[0], c[1], c[2], h + Math.max(r1, r2)];
}

function distRoundCone(c, x, y, z) {
  const pax = x - c.ax, pay = y - c.ay, paz = z - c.az;
  const yy = pax * c.bax + pay * c.bay + paz * c.baz, zz = yy - c.l2;
  const xvx = pax * c.l2 - c.bax * yy, xvy = pay * c.l2 - c.bay * yy, xvz = paz * c.l2 - c.baz * yy;
  const x2 = xvx * xvx + xvy * xvy + xvz * xvz;
  const y2 = yy * yy * c.l2, z2 = zz * zz * c.l2;
  const k = Math.sign(c.rr) * c.rr * c.rr * x2;
  if (Math.sign(zz) * c.a2 * z2 > k) return Math.sqrt(x2 + z2) * c.il2 - c.r2;
  if (Math.sign(yy) * c.a2 * y2 < k) return Math.sqrt(x2 + y2) * c.il2 - c.r1;
  return (Math.sqrt(x2 * c.a2 * c.il2) + yy * c.rr) * c.il2 - c.r1;
}

/**
 * Elipsoide de semieixos r num referencial: `m` = matriz 3x4 (linhas) que leva
 * do mundo pro espaço local, centrado na origem.
 */
export function ellipsoid(m, r, center) {
  const rmax = Math.max(r[0], r[1], r[2]);
  return {
    kind: 1, m, rx: r[0], ry: r[1], rz: r[2], rmin: Math.min(r[0], r[1], r[2]),
    sphere: [center[0], center[1], center[2], rmax],
  };
}

function distEllipsoid(e, x, y, z) {
  const m = e.m;
  const lx = m[0] * x + m[1] * y + m[2] * z + m[3];
  const ly = m[4] * x + m[5] * y + m[6] * z + m[7];
  const lz = m[8] * x + m[9] * y + m[10] * z + m[11];
  const ax = lx / e.rx, ay = ly / e.ry, az = lz / e.rz;
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  const bx = ax / e.rx, by = ay / e.ry, bz = az / e.rz;
  const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
  return k1 < 1e-9 ? -e.rmin : (k0 * (k0 - 1)) / k1;
}

/**
 * Cone arredondado achatado: no espaço local (matriz `m`), vai da origem até
 * (0, len, 0), achatado em z pelo fator `flat` (< 1 = mais fino).
 */
export function flatCone(m, len, r1, r2, flat, center) {
  const c = roundCone([0, 0, 0], [0, len, 0], r1, r2);
  return { kind: 2, m, cone: c, flat, sphere: [center[0], center[1], center[2], len / 2 + Math.max(r1, r2)] };
}

function distFlatCone(f, x, y, z) {
  const m = f.m;
  const lx = m[0] * x + m[1] * y + m[2] * z + m[3];
  const ly = m[4] * x + m[5] * y + m[6] * z + m[7];
  const lz = m[8] * x + m[9] * y + m[10] * z + m[11];
  return distRoundCone(f.cone, lx, ly, lz / f.flat) * f.flat;
}

/** Distância até uma forma (qualquer tipo). */
export function dist(p, x, y, z) {
  return p.kind === 0 ? distRoundCone(p, x, y, z) : p.kind === 1 ? distEllipsoid(p, x, y, z) : distFlatCone(p, x, y, z);
}

/**
 * Surface nets numa grade esparsa.
 *
 * `field` = { prims, combine(d) } — `combine` recebe a distância até cada
 * forma (Float64Array, 1e9 nas formas longe) e devolve a distância do
 * corpo. A grade é dividida em blocos; em cada bloco só entram as formas que
 * podem mexer na superfície ali (`reach` = maior raio de união suave), e
 * blocos inteiros longe da superfície nem são amostrados.
 *
 * Devolve { positions, normals, index, dists } — `dists` guarda a distância até
 * cada forma em cada vértice (pros pesos e as cores).
 */
export function polygonize(field, { cell, reach, margin = 0.02, block = 4 }) {
  const { prims, combine } = field;
  const np = prims.length;
  // limites da grade: esferas das formas + folga
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) {
    const [cx, cy, cz, r] = p.sphere;
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], [cx, cy, cz][a] - r - reach - margin);
      hi[a] = Math.max(hi[a], [cx, cy, cz][a] + r + reach + margin);
    }
  }
  const nx = Math.ceil((hi[0] - lo[0]) / cell) + 1, ny = Math.ceil((hi[1] - lo[1]) / cell) + 1, nz = Math.ceil((hi[2] - lo[2]) / cell) + 1;
  const sxy = nx * ny;
  const F = new Float32Array(nx * ny * nz);
  const done = new Uint8Array(nx * ny * nz);
  const bx = Math.ceil((nx - 1) / block), by = Math.ceil((ny - 1) / block), bz = Math.ceil((nz - 1) / block);
  const rb = (block * cell * Math.sqrt(3)) / 2;
  const d = new Float64Array(np);
  const active = new Int32Array(np);
  let nActive = 0;

  // formas que podem mexer na superfície perto do bloco atual; as outras
  // ficam em 1e9 (longe) e `field.activate` pode pular grupos inteiros
  const on = new Uint8Array(np);
  d.fill(1e9);
  function setActive(cx, cy, cz, radius) {
    for (let k = 0; k < nActive; k++) { d[active[k]] = 1e9; on[active[k]] = 0; }
    nActive = 0;
    for (let i = 0; i < np; i++) {
      const s = prims[i].sphere;
      if (Math.hypot(s[0] - cx, s[1] - cy, s[2] - cz) - s[3] < radius + reach + margin) { active[nActive++] = i; on[i] = 1; }
    }
    if (field.activate) field.activate(on);
    return nActive;
  }
  function evalActive(x, y, z) {
    for (let k = 0; k < nActive; k++) { const i = active[k]; d[i] = dist(prims[i], x, y, z); }
    return combine(d);
  }

  const T0 = performance.now();
  // 1) classifica os blocos: 0 = fora, 1 = dentro, 2 = perto da superfície
  const state = new Uint8Array(bx * by * bz);
  const near = [];
  for (let k = 0; k < bz; k++) for (let j = 0; j < by; j++) for (let i = 0; i < bx; i++) {
    const cx = lo[0] + (i + 0.5) * block * cell, cy = lo[1] + (j + 0.5) * block * cell, cz = lo[2] + (k + 0.5) * block * cell;
    const b = i + bx * (j + by * k);
    if (!setActive(cx, cy, cz, rb)) { state[b] = 0; continue; }
    const v = evalActive(cx, cy, cz);
    // folga de 1,5x: a distância do elipsoide é aproximada
    if (v > rb * 1.5 + cell) state[b] = 0;
    else if (v < -rb * 1.5 - cell) state[b] = 1;
    else { state[b] = 2; near.push(b); }
  }

  // 2) amostra os pontos dos blocos perto da superfície
  const blockRange = (b) => {
    const i = b % bx, j = Math.floor(b / bx) % by, k = Math.floor(b / (bx * by));
    return [i * block, j * block, k * block, Math.min(nx - 1, (i + 1) * block), Math.min(ny - 1, (j + 1) * block), Math.min(nz - 1, (k + 1) * block)];
  };
  for (const b of near) {
    const [i0, j0, k0, i1, j1, k1] = blockRange(b);
    setActive(lo[0] + ((i0 + i1) / 2) * cell, lo[1] + ((j0 + j1) / 2) * cell, lo[2] + ((k0 + k1) / 2) * cell, rb);
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const o = i + nx * j + sxy * k;
      if (done[o]) continue;
      F[o] = evalActive(lo[0] + i * cell, lo[1] + j * cell, lo[2] + k * cell);
      done[o] = 1;
    }
  }
  // o resto: o sinal do bloco (fora = positivo, dentro = negativo)
  for (let b = 0; b < state.length; b++) {
    if (state[b] === 2) continue;
    const [i0, j0, k0, i1, j1, k1] = blockRange(b), v = state[b] === 1 ? -1 : 1;
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const o = i + nx * j + sxy * k;
      if (!done[o]) { F[o] = v; done[o] = 2; }
    }
  }

  const T1 = performance.now();
  // 3) um vértice por célula cortada pela superfície (média dos cortes nas
  //    arestas), depois projetado na superfície com Newton
  const vid = new Int32Array(nx * ny * nz).fill(-1);
  const pos = [], nor = [];
  const dl = [];
  const CORNERS = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float64Array(8);
  const e = cell * 0.2;
  const grad = (x, y, z, out) => {
    // gradiente por tetraedro (4 amostras)
    const a = evalActive(x + e, y - e, z - e), b = evalActive(x - e, y - e, z + e);
    const c = evalActive(x - e, y + e, z - e), f = evalActive(x + e, y + e, z + e);
    out[0] = a - b - c + f; out[1] = -a - b + c + f; out[2] = -a + b - c + f;
    return out;
  };
  const g = [0, 0, 0];
  for (const b of near) {
    const [i0, j0, k0, i1, j1, k1] = blockRange(b);
    setActive(lo[0] + ((i0 + i1) / 2) * cell, lo[1] + ((j0 + j1) / 2) * cell, lo[2] + ((k0 + k1) / 2) * cell, rb);
    for (let k = k0; k < k1; k++) for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) {
        const [di, dj, dk] = CORNERS[c];
        cv[c] = F[(i + di) + nx * (j + dj) + sxy * (k + dk)];
        if (cv[c] < 0) mask |= 1 << c;
      }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const [a, c] of EDGES) {
        const va = cv[a], vc = cv[c];
        if ((va < 0) === (vc < 0)) continue;
        const t = va / (va - vc), A = CORNERS[a], C = CORNERS[c];
        sx += A[0] + (C[0] - A[0]) * t; sy += A[1] + (C[1] - A[1]) * t; sz += A[2] + (C[2] - A[2]) * t;
        n++;
      }
      let x = lo[0] + (i + sx / n) * cell, y = lo[1] + (j + sy / n) * cell, z = lo[2] + (k + sz / n) * cell;
      // um passo de Newton até a superfície, e a normal no ponto final
      const v = evalActive(x, y, z);
      grad(x, y, z, g);
      const gg = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
      if (gg > 1e-12) {
        const st = v / gg;
        let dx = -g[0] * st, dy = -g[1] * st, dz = -g[2] * st;
        // não deixa o vértice fugir pra longe da célula (dobras duras)
        const dd = Math.hypot(dx, dy, dz);
        if (dd > cell * 0.75) { const f = (cell * 0.75) / dd; dx *= f; dy *= f; dz *= f; }
        x += dx; y += dy; z += dz;
        grad(x, y, z, g);
      }
      const gl = Math.hypot(g[0], g[1], g[2]) || 1;
      vid[i + nx * j + sxy * k] = pos.length / 3;
      pos.push(x, y, z);
      nor.push(g[0] / gl, g[1] / gl, g[2] / gl);
      // distâncias até cada forma neste vértice (1e9 nas inativas)
      evalActive(x, y, z);
      dl.push(Float32Array.from(d));
    }
  }

  const T2 = performance.now();
  // 4) um quadrado por aresta da grade que cruza a superfície, ligando as 4
  //    células em volta; corta pela diagonal mais curta
  const idx = [];
  const P = (v, a) => pos[v * 3 + a];
  const quad = (a, b, c, e2, flip) => {
    if (a < 0 || b < 0 || c < 0 || e2 < 0) return;
    if (flip) { const t = b; b = e2; e2 = t; }
    const d1 = (P(a, 0) - P(c, 0)) ** 2 + (P(a, 1) - P(c, 1)) ** 2 + (P(a, 2) - P(c, 2)) ** 2;
    const d2 = (P(b, 0) - P(e2, 0)) ** 2 + (P(b, 1) - P(e2, 1)) ** 2 + (P(b, 2) - P(e2, 2)) ** 2;
    if (d1 <= d2) idx.push(a, b, c, a, c, e2);
    else idx.push(a, b, e2, b, c, e2);
  };
  for (const b of near) {
    const [i0, j0, k0, i1, j1, k1] = blockRange(b);
    for (let k = k0; k < k1; k++) for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      const o = i + nx * j + sxy * k, inside = F[o] < 0;
      // aresta +x: células (i, j-1..j, k-1..k)
      if (j > 0 && k > 0 && (F[o + 1] < 0) !== inside) {
        quad(vid[o - nx - sxy], vid[o - sxy], vid[o], vid[o - nx], !inside);
      }
      if (i > 0 && k > 0 && (F[o + nx] < 0) !== inside) {
        quad(vid[o - 1 - sxy], vid[o - 1], vid[o], vid[o - sxy], !inside);
      }
      if (i > 0 && j > 0 && (F[o + sxy] < 0) !== inside) {
        quad(vid[o - 1 - nx], vid[o - nx], vid[o], vid[o - 1], !inside);
      }
    }
  }

  const nv = pos.length / 3;
  const dists = new Float32Array(nv * np);
  for (let v = 0; v < nv; v++) dists.set(dl[v], v * np);
  return {
    positions: new Float32Array(pos), normals: new Float32Array(nor),
    index: nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), dists,
    stats: { tField: T1 - T0, tVerts: T2 - T1, tQuads: performance.now() - T2, grid: [nx, ny, nz], blocks: state.length, near: near.length, vertices: nv, triangles: idx.length / 3 },
  };
}
