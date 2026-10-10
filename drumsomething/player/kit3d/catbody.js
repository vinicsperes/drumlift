// Corpo contínuo do gato de pelúcia: cada parte (quadril, barriga, peito,
// cabeça, bochechas, focinho, orelhas, braços, patas, pernas, pés, rabo) é uma
// forma simples com distância assinada, presa a um osso. As formas se juntam
// com união suave (o "estofado" das emendas) e a superfície sai inteira de
// uma vez com surface nets (sdf.js): uma malha só, fechada, sem emenda.
//
// Os pesos de skinning saem da mesma união suave: em cada vértice, o peso de
// cada forma é a contribuição dela na união (softmax das distâncias, com
// falloff largo nas juntas), seguindo a árvore da união: o tronco com cada
// membro, e as partes de cada membro entre si. As cores da pelagem (listras e
// creme) também são campos medidos na pose de ligação.

import { Matrix4, Vector3 } from "../vendor/three.module.min.js";
import { B, EARS, EAR, SKULL, createCatBones, sampleTail } from "./catrig.js";
import { FEET, HANDS } from "./rig.js";
import { TAIL_BONES } from "./plushmotion.js";
import { dist, ellipsoid, flatCone, polygonize, roundCone, smin } from "./sdf.js";

const v3 = (x, y, z) => new Vector3(x, y, z);
const smooth = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
const band = (phase) => 0.5 + 0.5 * Math.cos(2 * Math.PI * phase);

export const CELL = 0.0115;      // m: lado da célula da grade
const TAIL_SEGS = TAIL_BONES * 2;

/** Matriz 3x4 (linhas) mundo -> local a partir da matriz local -> mundo. */
function toLocal(m) {
  const e = m.clone().invert().elements; // coluna-maior
  return Float64Array.of(e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]);
}
const apply = (m, p) => p.clone().applyMatrix4(m);

/**
 * Formas do corpo na pose de ligação. Cada uma: { prim, bone, fur(p) } —
 * fur devolve [listra, creme] (0..1) num ponto do mundo.
 */
function buildShapes(bind, joints) {
  const shapes = [];
  const torso = bind[B.pelve], head = bind[B.cabeca];
  const torsoInv = torso.clone().invert(), headInv = head.clone().invert();
  // `group` = família de listras: dentro dela os desenhos casam, entre famílias as listras somem na emenda
  let group = "tronco";
  const add = (name, prim, bone, fur) => { shapes.push({ name, prim, bone, fur, group }); return shapes.length - 1; };
  const ell = (frameM, c, r) => {
    const m = frameM.clone().multiply(new Matrix4().makeTranslation(c.x, c.y, c.z));
    return ellipsoid(toLocal(m), [r.x, r.y, r.z], apply(m, v3(0, 0, 0)).toArray());
  };

  // ---------- pelagem por região ----------
  const tq = new Vector3(), hq = new Vector3();
  function torsoFur(p) {
    const q = tq.copy(p).applyMatrix4(torsoInv);
    const th = Math.atan2(q.x, -q.z); // 0 = frente
    const ex = q.x / 0.118, ey = (q.y - 0.255) / 0.29;
    const cream = smooth(0.0, -0.06, q.z) * (1 - smooth(0.8, 1.05, Math.hypot(ex, ey)));
    const phase = q.y / 0.074 + 0.2 * Math.sin(3 * th + 0.4) + 0.07 * Math.sin(7 * th + 1.3);
    const amt = smooth(0.8, 1.7, Math.abs(th)) * (0.75 + 0.25 * smooth(2.0, 2.8, Math.abs(th)));
    return [amt * band(phase) * (1 - cream) * (1 - cream), cream];
  }
  function headFur(p) {
    const h = hq.copy(p).applyMatrix4(headInv);
    // "M" na testa: linhas da frente pra trás no alto da cabeça
    const top = smooth(0.135, 0.19, h.y) * (1 - smooth(0.03, 0.09, h.z));
    const lines = band(h.x / 0.034) * (1 - smooth(0.05, 0.09, Math.abs(h.x)));
    // nuca: anéis
    const back = smooth(0.0, 0.07, h.z) * smooth(0.03, 0.08, h.y) * band((h.y - 0.02) / 0.052);
    // bochechas: duas faixas de cada lado
    const cheek = smooth(0.088, 0.125, Math.abs(h.x)) * (1 - smooth(-0.02, 0.04, h.z)) *
      smooth(0.035, 0.06, h.y) * (1 - smooth(0.115, 0.14, h.y)) * band((h.y - 0.064) / 0.034);
    const s = Math.max(top * lines, back * 0.9, cheek);
    // queixo e garganta creme
    const cream = smooth(0.05, 0.02, h.y) * (1 - smooth(-0.08, -0.03, h.z));
    return [s * (1 - cream), cream];
  }
  /** Anéis em volta de um membro: fase pelo comprimento desde a raiz. */
  const ringFur = (a, b, offset, period, amt = 1) => {
    const ab = b.clone().sub(a), len = ab.length();
    ab.divideScalar(len);
    return (p) => {
      const s = Math.min(len, Math.max(0, (p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z));
      return [amt * band((offset + s) / period), 0];
    };
  };
  const cream = () => [0, 1];

  // ---------- tronco ----------
  const HIPS = add("quadril", ell(torso, v3(0, 0.055, 0.005), v3(0.192, 0.13, 0.166)), B.pelve, torsoFur);
  const BELLY = add("barriga", ell(torso, v3(0, 0.15, -0.048), v3(0.166, 0.152, 0.14)), B.barriga, torsoFur);
  const WAIST = add("cintura", ell(torso, v3(0, 0.262, 0), v3(0.17, 0.14, 0.134)), B.coluna, torsoFur);
  const CHEST = add("peito", ell(torso, v3(0, 0.388, -0.006), v3(0.164, 0.13, 0.124)), B.peito, torsoFur);
  const yokeA = apply(torso, v3(-0.13, 0.468, -0.02)), yokeB = apply(torso, v3(0.13, 0.468, -0.02));
  const YOKE = add("ombros", roundCone(yokeA.toArray(), yokeB.toArray(), 0.07, 0.07), B.peito, torsoFur);

  // ---------- cabeça ----------
  group = "cabeca";
  const SKULL_I = add("cabeca", ell(head, SKULL.c, SKULL.r), B.cabeca, headFur);
  const CHEEKS = [-1, 1].map((s) => add("bochecha", ell(head, v3(0.06 * s, 0.06, -0.05), v3(0.08, 0.058, 0.07)), B.cabeca, headFur));
  const core = [HIPS, BELLY, WAIST, CHEST, YOKE, SKULL_I, ...CHEEKS];

  // ---------- membros ----------
  const branches = [];
  for (const l of HANDS) {
    const j = joints.arms[l], S = j.shoulder, E = j.elbow, W = j.wrist;
    const M = S.clone().lerp(E, 0.45), lu = S.distanceTo(E);
    const paw = bind[B[`pata${l}`]];
    group = `braco${l}`;
    branches.push({
      name: `braco${l}`, k: 0.05, tau: 0.03, tauChain: 0.022,
      prims: [
        add("ombro", roundCone(S.toArray(), M.toArray(), 0.06, 0.054), B[`ombro${l}`], ringFur(S, E, 0.02, 0.066)),
        add("braco", roundCone(M.toArray(), E.toArray(), 0.054, 0.047), B[`braco${l}`], ringFur(S, E, 0.02, 0.066)),
        add("antebraco", roundCone(E.toArray(), W.toArray(), 0.047, 0.04), B[`antebraco${l}`], ringFur(E, W, 0.02 + lu, 0.066)),
        (group = `pata${l}`, add("pata", ell(paw, v3(0, 0.024, 0), v3(0.05, 0.06, 0.047)), B[`pata${l}`], cream)),
      ],
      ks: [0, 0.02, 0.03, 0.026],
    });
  }
  for (const l of FEET) {
    const j = joints.legs[l], H = j.hip, K = j.knee, A = j.ankle, lt = H.distanceTo(K);
    const foot = bind[B[`pe${l}`]];
    group = `perna${l}`;
    branches.push({
      name: `perna${l}`, k: 0.06, tau: 0.035, tauChain: 0.025,
      prims: [
        add("coxa", roundCone(H.toArray(), K.toArray(), 0.083, 0.064), B[`coxa${l}`], ringFur(H, K, 0, 0.075)),
        add("canela", roundCone(K.toArray(), A.toArray(), 0.062, 0.05), B[`canela${l}`], ringFur(K, A, lt, 0.075)),
        (group = `pe${l}`, add("pe", ell(foot, v3(0, 0.066, -0.085), v3(0.056, 0.046, 0.125)), B[`pe${l}`], cream)),
      ],
      ks: [0, 0.03, 0.03],
    });
  }
  {
    group = "rabo";
    const pts = sampleTail(TAIL_SEGS), prims = [], ks = [];
    let arc = 0;
    for (let i = 0; i < TAIL_SEGS; i++) {
      const r1 = 0.036 + (0.027 - 0.036) * (i / TAIL_SEGS), r2 = 0.036 + (0.027 - 0.036) * ((i + 1) / TAIL_SEGS);
      prims.push(add("rabo", roundCone(pts[i].toArray(), pts[i + 1].toArray(), r1, r2), B.rabo0 + Math.floor(i / 2),
        ringFur(pts[i], pts[i + 1], arc, 0.072, i < 2 ? 0.6 : 1)));
      ks.push(i ? 0.02 : 0);
      arc += pts[i].distanceTo(pts[i + 1]);
    }
    branches.push({ name: "rabo", k: 0.045, tau: 0.03, tauChain: 0.03, prims, ks });
  }
  EARS.forEach((e, k) => {
    group = `orelha${k}`;
    const m = head.clone().multiply(new Matrix4().makeRotationFromQuaternion(e.q).setPosition(e.base));
    const tip = apply(m, v3(0, EAR.len, 0)), base = apply(m, v3(0, 0, 0));
    const along = tip.clone().sub(base).normalize();
    const fur = (p) => [0.8 * smooth(0.066, 0.096, (p.x - base.x) * along.x + (p.y - base.y) * along.y + (p.z - base.z) * along.z), 0];
    const prim = flatCone(toLocal(m), EAR.len, EAR.r1, EAR.r2, EAR.flat, base.clone().lerp(tip, 0.5).toArray());
    branches.push({ name: "orelha", k: 0.028, tau: 0.014, tauChain: 0.02, prims: [add("orelha", prim, k === 0 ? B.orelhaE : B.orelhaD, fur)], ks: [0] });
  });
  {
    group = "focinho";
    const puffs = [-1, 1].map((s) => add("focinho", ell(head, v3(0.031 * s, 0.064, -0.12), v3(0.039, 0.031, 0.031)), B.cabeca, cream));
    const chin = add("queixo", ell(head, v3(0, 0.035, -0.106), v3(0.03, 0.021, 0.025)), B.cabeca, cream);
    branches.push({ name: "focinho", k: 0.012, tau: 0.006, tauChain: 0.01, prims: [...puffs, chin], ks: [0, 0.008, 0.01] });
  }
  const groups = [...new Set(shapes.map((sh) => sh.group))];
  for (const sh of shapes) sh.gi = groups.indexOf(sh.group);
  return { shapes, core, branches, coreK: { HIPS, BELLY, WAIST, CHEST, YOKE, SKULL: SKULL_I, CHEEKS } };
}

/** Monta o campo (distância do corpo) e a função de pesos a partir das formas. */
function buildField(def) {
  const { shapes, branches, coreK: c } = def;
  const prims = shapes.map((s) => s.prim);
  const np = prims.length;
  function coreDist(d) {
    let t = smin(d[c.HIPS], d[c.WAIST], 0.07);
    t = smin(t, d[c.CHEST], 0.07);
    t = smin(t, d[c.BELLY], 0.06);
    t = smin(t, d[c.YOKE], 0.06);
    let h = smin(d[c.SKULL], d[c.CHEEKS[0]], 0.04);
    h = smin(h, d[c.CHEEKS[1]], 0.04);
    return smin(t, h, 0.055);
  }
  function chainDist(br, d) {
    const p = br.prims;
    let v = d[p[0]];
    for (let i = 1; i < p.length; i++) v = smin(v, d[p[i]], br.ks[i]);
    return v;
  }
  // na poligonização, só os membros com alguma forma perto do bloco atual
  const brOn = new Uint8Array(branches.length).fill(1);
  function activate(on) {
    branches.forEach((br, j) => { brOn[j] = br.prims.some((i) => on[i]) ? 1 : 0; });
  }
  function combine(d) {
    const core = coreDist(d);
    let out = core;
    for (let j = 0; j < branches.length; j++) {
      if (!brOn[j]) continue;
      const br = branches[j];
      const u = smin(core, chainDist(br, d), br.k);
      if (u < out) out = u;
    }
    return out;
  }

  const TAU_CORE = 0.034, TAU_BRANCH = 0.006;
  const nb = branches.length, coreIdx = Int32Array.from(def.core);
  const u = new Float64Array(nb), ch = new Float64Array(nb), m = new Float64Array(nb);
  const cw = new Float64Array(coreIdx.length), pw = new Float64Array(np);
  /** Peso de cada forma no ponto com distâncias d (soma 1). */
  function primWeights(d, w) {
    w.fill(0);
    const core = coreDist(d);
    let uMin = Infinity;
    for (let j = 0; j < nb; j++) {
      ch[j] = chainDist(branches[j], d);
      u[j] = smin(core, ch[j], branches[j].k);
      if (u[j] < uMin) uMin = u[j];
    }
    // contribuição de cada forma do tronco (softmax das distâncias)
    let cMin = Infinity, cSum = 0, mSum = 0;
    for (let k = 0; k < coreIdx.length; k++) cMin = Math.min(cMin, d[coreIdx[k]]);
    for (let k = 0; k < coreIdx.length; k++) { cw[k] = Math.exp(-(d[coreIdx[k]] - cMin) / TAU_CORE); cSum += cw[k]; }
    for (let j = 0; j < nb; j++) { m[j] = Math.exp(-(u[j] - uMin) / TAU_BRANCH); mSum += m[j]; }
    for (let j = 0; j < nb; j++) {
      const br = branches[j], mj = m[j] / mSum;
      if (mj < 1e-7) continue;
      // tronco x membro: logística da diferença de distâncias
      const sj = 1 / (1 + Math.exp(Math.min(60, (ch[j] - core) / br.tau)));
      const kc = (mj * (1 - sj)) / cSum;
      for (let k = 0; k < coreIdx.length; k++) w[coreIdx[k]] += kc * cw[k];
      if (sj < 1e-6) continue;
      const p = br.prims;
      let pMin = Infinity, pSum = 0;
      for (let k = 0; k < p.length; k++) pMin = Math.min(pMin, d[p[k]]);
      for (let k = 0; k < p.length; k++) { pw[k] = Math.exp(-(d[p[k]] - pMin) / br.tauChain); pSum += pw[k]; }
      const kp = (mj * sj) / pSum;
      for (let k = 0; k < p.length; k++) w[p[k]] += kp * pw[k];
    }
    return w;
  }
  return { prims, combine, activate, coreDist, primWeights, np, all: () => brOn.fill(1) };
}

/** Pesos por osso (até 4) e pelagem num ponto, dadas as distâncias às formas. */
const scratch = { w: null, bone: null, gw: new Float64Array(32), gs: new Float64Array(32) };
function skinFromDists(def, field, d, p, outIdx, outW, outFur, o) {
  const w = field.primWeights(d, scratch.w || (scratch.w = new Float64Array(field.np)));
  const bw = scratch.bone || (scratch.bone = new Float64Array(64));
  const gw = scratch.gw, gs = scratch.gs;
  bw.fill(0);
  gw.fill(0);
  gs.fill(0);
  let cr = 0;
  const shapes = def.shapes;
  for (let i = 0; i < shapes.length; i++) {
    if (w[i] < 1e-5) continue;
    bw[shapes[i].bone] += w[i];
    if (outFur && w[i] > 1e-4) {
      const f = shapes[i].fur(p), g = shapes[i].gi;
      gw[g] += w[i];
      gs[g] += w[i] * f[0];
      cr += w[i] * f[1];
    }
  }
  // listras: só as da família dominante, sumindo onde duas famílias se
  // misturam (ombro, quadril, pescoço, base do rabo) em vez de embaralhar
  let st = 0;
  if (outFur) {
    let g0 = 0;
    for (let g = 1; g < gw.length; g++) if (gw[g] > gw[g0]) g0 = g;
    if (gw[g0] > 0) st = (gs[g0] / gw[g0]) * smooth(0.55, 0.85, gw[g0]);
  }
  // os 4 ossos mais pesados
  let sum = 0;
  for (let k = 0; k < 4; k++) {
    let best = -1, bv = 0;
    for (let b = 0; b < bw.length; b++) if (bw[b] > bv) { bv = bw[b]; best = b; }
    outIdx[o * 4 + k] = best < 0 ? 0 : best;
    outW[o * 4 + k] = bv;
    sum += bv;
    if (best >= 0) bw[best] = 0;
  }
  for (let k = 0; k < 4; k++) outW[o * 4 + k] /= sum || 1;
  if (outFur) { outFur[o * 2] = st; outFur[o * 2 + 1] = cr; }
}

let cache = null;

/**
 * Gera (uma vez por página) a malha do corpo na pose de ligação: posições,
 * normais, índices, skinIndex/skinWeight (até 4 ossos) e pelagem
 * (listra, creme). Determinística.
 */
export function catBody() {
  if (cache) return cache;
  const t0 = performance.now();
  const bones = createCatBones();
  const def = buildShapes(bones.bind, bones.joints);
  const field = buildField(def);
  const mesh = polygonize(field, { cell: CELL, reach: 0.07 });
  field.all();
  const tPoly = performance.now();
  const nv = mesh.positions.length / 3, np = field.np;
  const skinIndex = new Uint16Array(nv * 4), skinWeight = new Float32Array(nv * 4), fur = new Float32Array(nv * 2);
  const d = new Float64Array(np), p = new Vector3();
  for (let v = 0; v < nv; v++) {
    for (let i = 0; i < np; i++) d[i] = mesh.dists[v * np + i];
    p.fromArray(mesh.positions, v * 3);
    skinFromDists(def, field, d, p, skinIndex, skinWeight, fur, v);
  }
  cache = {
    positions: mesh.positions, normals: mesh.normals, index: mesh.index, skinIndex, skinWeight, fur,
    stats: { ...mesh.stats, tSetup: tPoly - t0 - mesh.stats.tField - mesh.stats.tVerts - mesh.stats.tQuads, tSkin: performance.now() - tPoly, ms: performance.now() - t0 },
    bind: bones.bind, joints: bones.joints,
    /** Distância do corpo num ponto do mundo (pose de ligação). */
    distance(q) {
      for (let i = 0; i < np; i++) d[i] = dist(field.prims[i], q.x, q.y, q.z);
      return field.combine(d);
    },
    /** Distância só do tronco e da cabeça (sem membros), pra costuras do peito. */
    coreDistance(q) {
      for (let i = 0; i < np; i++) d[i] = dist(field.prims[i], q.x, q.y, q.z);
      return field.coreDist(d);
    },
    /** Pesos (4 ossos) de um detalhe preso no ponto q. */
    skinAt(q, outIdx, outW, o = 0) {
      for (let i = 0; i < np; i++) d[i] = dist(field.prims[i], q.x, q.y, q.z);
      skinFromDists(def, field, d, q, outIdx, outW, null, o);
    },
  };
  return cache;
}

/**
 * Anda de `from` (dentro do corpo) na direção `dir` até sair pela superfície;
 * devolve o ponto exato da saída e a normal em n.
 */
export function rayToBody(body, from, dir, n = new Vector3(), field = body.distance) {
  const d = dir.clone().normalize(), p = from.clone(), t = new Vector3();
  let a = 0, b = 0;
  for (let k = 0; k < 200; k++) {
    b = a + 0.004;
    if (field(t.copy(p).addScaledVector(d, b)) > 0) break;
    a = b;
  }
  for (let k = 0; k < 24; k++) {
    const m = (a + b) / 2;
    if (field(t.copy(p).addScaledVector(d, m)) > 0) b = m; else a = m;
  }
  p.addScaledVector(d, (a + b) / 2);
  return projectToBody(body, p, n, field);
}

/** Leva q até a superfície do corpo (Newton no campo); devolve q e a normal em n. */
export function projectToBody(body, q, n = new Vector3(), field = body.distance) {
  const e = 0.0008, g = new Vector3(), t = new Vector3();
  const grad = () => {
    const f = (dx, dy, dz) => field(t.set(q.x + dx, q.y + dy, q.z + dz));
    g.set(f(e, 0, 0) - f(-e, 0, 0), f(0, e, 0) - f(0, -e, 0), f(0, 0, e) - f(0, 0, -e));
    return g;
  };
  for (let it = 0; it < 8; it++) {
    const v = field(t.copy(q));
    grad();
    const gg = g.lengthSq();
    if (gg < 1e-14) break;
    q.addScaledVector(g, (-v * 2 * e) / gg);
    if (Math.abs(v) < 1e-5) break;
  }
  n.copy(grad()).normalize();
  return q;
}

