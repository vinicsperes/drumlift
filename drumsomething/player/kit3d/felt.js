// Feltro procedural pro estilo pelúcia: texturas geradas em canvas (fibras,
// manchas, listras do gato, corda, sombra) e o material de tecido. Nada de
// arquivo de textura. Todas as texturas repetem sem emenda.
//
// UV em "unidades de feltro": 1 unidade = TILE metros. As geometrias do estilo
// pelúcia já saem com UV nessa escala (veja shapes.js), então a mesma textura
// de fibras serve pra qualquer peça sem esticar.

import {
  CanvasTexture, Color, LinearMipmapLinearFilter, MeshPhysicalMaterial, RepeatWrapping,
  SRGBColorSpace, Vector2,
} from "../vendor/three.module.min.js";

export const TILE = 0.06;      // m por unidade de UV
export const STRIPE_TILES = 4; // unidades por repetição das listras

/** Gerador pseudoaleatório com semente (as texturas saem sempre iguais). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h = w) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function texture(c, { color = false, repeat = 1 } = {}) {
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  if (color) t.colorSpace = SRGBColorSpace;
  t.repeat.set(repeat, repeat);
  return t;
}

// Ruído de valor periódico (n x n células), suave, em [0, 1].
function periodicNoise(rand, n) {
  const g = Array.from({ length: n * n }, rand);
  const at = (i, j) => g[((j % n + n) % n) * n + ((i % n + n) % n)];
  const s = (x) => x * x * (3 - 2 * x);
  return (u, v) => {
    const x = u * n, y = v * n, i = Math.floor(x), j = Math.floor(y), fx = s(x - i), fy = s(y - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
    return a + (b - a) * fy;
  };
}

/** Mapa de normais de feltro: fibras curtas em todas as direções + calombos. */
function feltNormalCanvas(size = 256) {
  const rand = rng(11);
  const H = new Float32Array(size * size);
  const wrap = (v) => ((Math.round(v) % size) + size) % size;
  for (let i = 0; i < 3200; i++) {
    let x = rand() * size, y = rand() * size, a = rand() * Math.PI * 2;
    const len = 5 + rand() * 16, v = (rand() < 0.45 ? -0.6 : 1) * (0.5 + rand() * 0.5), curl = (rand() - 0.5) * 0.3;
    for (let s = 0; s < len; s += 0.75) {
      H[wrap(y) * size + wrap(x)] += v;
      x += Math.cos(a) * 0.75;
      y += Math.sin(a) * 0.75;
      a += curl;
    }
  }
  // borra 1 px (caixa 3x3) e soma calombos de baixa frequência
  const B = new Float32Array(size * size);
  const lumps = periodicNoise(rng(5), 8), lumps2 = periodicNoise(rng(9), 24);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += H[wrap(y + dy) * size + wrap(x + dx)];
      B[y * size + x] = s / 9 + 2.2 * lumps(x / size, y / size) + 0.9 * lumps2(x / size, y / size);
    }
  }
  const c = canvas(size), ctx = c.getContext("2d"), img = ctx.createImageData(size, size), d = img.data;
  const k = 1.1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (B[y * size + wrap(x + 1)] - B[y * size + wrap(x - 1)]) * k;
      const dy = (B[wrap(y + 1) * size + x] - B[wrap(y - 1) * size + x]) * k;
      const inv = 1 / Math.hypot(dx, dy, 1), o = (y * size + x) * 4;
      d[o] = (-dx * inv * 0.5 + 0.5) * 255;
      d[o + 1] = (dy * inv * 0.5 + 0.5) * 255;
      d[o + 2] = (inv * 0.5 + 0.5) * 255;
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Manchas suaves de cor (feltro nunca é liso): fator multiplicativo em volta de 1.
function mottle(ctx, size, seed, amount) {
  const n1 = periodicNoise(rng(seed), 6), n2 = periodicNoise(rng(seed + 1), 20), rand = rng(seed + 2);
  const img = ctx.getImageData(0, 0, size, size), d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const f = 1 + amount * ((n1(u, v) - 0.5) * 1.2 + (n2(u, v) - 0.5) * 0.6 + (rand() - 0.5) * 0.35);
      const o = (y * size + x) * 4;
      d[o] *= f; d[o + 1] *= f; d[o + 2] *= f;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Mapa de cor quase branco com manchas, pra multiplicar a cor dos feltros lisos. */
function mottleCanvas(size = 128) {
  const c = canvas(size), ctx = c.getContext("2d");
  ctx.fillStyle = "#f4f4f4";
  ctx.fillRect(0, 0, size, size);
  mottle(ctx, size, 21, 0.09);
  return c;
}

/**
 * Listras de gato rajado: faixas onduladas e falhadas, periódicas nos dois
 * eixos. `vertical` desenha faixas verticais (variam em u).
 */
function drawStripes(ctx, size, { n, seed, color, vertical = false, width = 0.34 }) {
  const rand = rng(seed);
  ctx.save();
  if (vertical) ctx.setTransform(0, 1, 1, 0, 0, 0); // troca x e y
  ctx.fillStyle = color;
  const step = size / n;
  for (let k = 0; k < n; k++) {
    const y0 = (k + 0.5) * step + (rand() - 0.5) * step * 0.35;
    const amp = step * (0.1 + rand() * 0.12), f1 = 1 + Math.floor(rand() * 2), f2 = 2 + Math.floor(rand() * 3);
    const p1 = rand() * 6.283, p2 = rand() * 6.283, wf = 1 + Math.floor(rand() * 3), wp = rand() * 6.283;
    const wmax = step * (width + rand() * 0.12);
    const yc = (x) => y0 + amp * Math.sin(6.283 * f1 * x / size + p1) + amp * 0.45 * Math.sin(6.283 * f2 * x / size + p2);
    const wd = (x) => wmax * Math.pow(Math.max(0, 0.5 + 0.6 * Math.sin(6.283 * wf * x / size + wp)), 0.6);
    for (const [scale, alpha] of [[1.35, 0.25], [1.0, 0.55], [0.7, 1]]) {
      ctx.globalAlpha = alpha;
      for (const dy of [-size, 0, size]) {
        ctx.beginPath();
        for (let x = 0; x <= size; x += 4) ctx.lineTo(x, yc(x) - (wd(x) * scale) / 2 + dy);
        for (let x = size; x >= 0; x -= 4) ctx.lineTo(x, yc(x) + (wd(x) * scale) / 2 + dy);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

/** Pelagem do corpo: cor base com manchas e faixas (anéis em volta de braços e tronco). */
function furCanvas(pal, size = 256) {
  const c = canvas(size), ctx = c.getContext("2d");
  ctx.fillStyle = pal.fur;
  ctx.fillRect(0, 0, size, size);
  if (pal.stripe) drawStripes(ctx, size, { n: 4, seed: 3, color: pal.stripe });
  mottle(ctx, size, 31, 0.07);
  return c;
}

/**
 * Pelagem da cabeça. A esfera da cabeça tem o polo na cara, então faixas
 * verticais (em u) saem do focinho como raios: sobem pela testa (o "M" do
 * rajado) e correm pelas bochechas. Somem perto da nuca.
 */
function headCanvas(pal, size = 256) {
  const c = canvas(size), ctx = c.getContext("2d");
  ctx.fillStyle = pal.fur;
  ctx.fillRect(0, 0, size, size);
  if (pal.stripe) {
    const layer = canvas(size), lctx = layer.getContext("2d");
    drawStripes(lctx, size, { n: 12, seed: 8, color: pal.stripe, vertical: true, width: 0.26 });
    // canvas de baixo pra cima = v de 0 (nuca) a 1 (cara)
    const g = lctx.createLinearGradient(0, size, 0, 0);
    g.addColorStop(0, "rgba(0,0,0,0.25)");
    g.addColorStop(0.3, "rgba(0,0,0,1)");
    g.addColorStop(0.8, "rgba(0,0,0,1)");
    g.addColorStop(0.9, "rgba(0,0,0,0)");
    lctx.globalCompositeOperation = "destination-in";
    lctx.fillStyle = g;
    lctx.fillRect(0, 0, size, size);
    ctx.drawImage(layer, 0, 0);
  }
  mottle(ctx, size, 41, 0.07);
  return c;
}

/** Corda torcida: 3 pernas em hélice (cor) e o relevo delas (normais). */
function ropeCanvases(w = 64, h = 128) {
  const col = canvas(w, h), nor = canvas(w, h);
  const ci = col.getContext("2d").createImageData(w, h), ni = nor.getContext("2d").createImageData(w, h);
  const rand = rng(17);
  const strands = 3, turns = 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ph = 2 * Math.PI * (strands * x / w + turns * y / h);
      const s = Math.sin(ph), cph = Math.cos(ph);
      const hgt = Math.pow(0.5 + 0.5 * s, 0.6);
      const lum = 0.72 + 0.28 * hgt + (rand() - 0.5) * 0.06;
      const o = (y * w + x) * 4;
      ci.data[o] = ci.data[o + 1] = ci.data[o + 2] = Math.min(255, lum * 255);
      ci.data[o + 3] = 255;
      const g = cph * (0.5 + 0.5 * s > 0.02 ? 1 : 0) * 0.9;
      const nx = -g * strands * 0.25, ny = g * turns * 0.25, inv = 1 / Math.hypot(nx, ny, 1);
      ni.data[o] = (nx * inv * 0.5 + 0.5) * 255;
      ni.data[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
      ni.data[o + 2] = (inv * 0.5 + 0.5) * 255;
      ni.data[o + 3] = 255;
    }
  }
  col.getContext("2d").putImageData(ci, 0, 0);
  nor.getContext("2d").putImageData(ni, 0, 0);
  return [col, nor];
}

/** Mancha radial branca com alfa suave (sombra no chão, blush). */
function radialCanvas(size = 128) {
  const c = canvas(size), ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [s, a] of [[0, 1], [0.2, 0.86], [0.42, 0.5], [0.62, 0.22], [0.8, 0.06], [1, 0]]) {
    g.addColorStop(s, `rgba(255,255,255,${a})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

// ---------- paletas do gato ----------
export const CAT_COLOR_NAMES = ["laranja", "cinza", "frajola"];
export const CAT_COLOR_LABELS = { laranja: "Laranja rajado", cinza: "Cinza rajado", frajola: "Frajola" };
export const CAT_PALETTES = {
  laranja: { fur: "#e8924a", stripe: "#c0632a", cream: "#f6e8d3", pink: "#f2a3ae", lining: "#f4b8bf" },
  cinza: { fur: "#9c9ea6", stripe: "#686b74", cream: "#f1eee8", pink: "#f0a7b2", lining: "#f3bcc3" },
  frajola: { fur: "#2c2b30", stripe: null, cream: "#f3f0ea", pink: "#ee9fab", lining: "#f1b5bd" },
};

/**
 * Texturas compartilhadas do estilo pelúcia. `setPalette` redesenha só a
 * pelagem. `dispose` libera tudo.
 */
export function createFeltTextures(paletteName = "laranja") {
  const normal = texture(feltNormalCanvas());
  const mottleMap = texture(mottleCanvas(), { color: true });
  const [ropeC, ropeN] = ropeCanvases();
  const rope = texture(ropeC, { color: true });
  const ropeNormal = texture(ropeN);
  const radialMap = new CanvasTexture(radialCanvas());
  radialMap.colorSpace = SRGBColorSpace;
  const furC = canvas(256), headC = canvas(256);
  const fur = texture(furC, { color: true, repeat: 1 / STRIPE_TILES });
  fur.channel = 1; // listras no uv1 (pontas e ombros lisos); as fibras ficam no uv
  const head = texture(headC, { color: true });
  function setPalette(name) {
    const pal = CAT_PALETTES[name] || CAT_PALETTES.laranja;
    furC.getContext("2d").drawImage(furCanvas(pal), 0, 0);
    headC.getContext("2d").drawImage(headCanvas(pal), 0, 0);
    fur.needsUpdate = true;
    head.needsUpdate = true;
    return pal;
  }
  const all = [normal, mottleMap, rope, ropeNormal, radialMap, fur, head];
  return {
    normal, mottle: mottleMap, rope, ropeNormal, radial: radialMap, fur, head, setPalette,
    dispose() { for (const t of all) t.dispose(); },
  };
}

const WHITE = new Color(1, 1, 1);

/**
 * Feltro: fosco (roughness perto de 1), com sheen de veludo nas bordas e o mapa
 * de fibras. `sheenMix` clareia a cor do brilho em relação à cor base.
 */
export function feltMaterial(tex, { color = "#ffffff", map = tex.mottle, normalScale = 0.45, sheen = 1,
  sheenRoughness = 0.5, sheenMix = 0.45, roughness = 0.93, ...rest } = {}) {
  const m = new MeshPhysicalMaterial({
    color, map, normalMap: tex.normal, normalScale: new Vector2(normalScale, normalScale),
    roughness, metalness: 0, sheen, sheenRoughness, ...rest,
  });
  m.userData.sheenMix = sheenMix;
  setFelt(m, color);
  return m;
}

/** Troca a cor de um feltro (e a do brilho junto). */
export function setFelt(m, color) {
  m.color.set(color);
  m.sheenColor.copy(m.color).lerp(WHITE, m.userData.sheenMix ?? 0.45);
  return m;
}
