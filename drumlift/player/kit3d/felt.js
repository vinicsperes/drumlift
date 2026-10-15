// Feltro procedural do estilo pelúcia, sem nenhuma textura: o material é um
// MeshLambertMaterial (fosco e barato) com três acréscimos no shader
// (onBeforeCompile):
//
// - fibra de feltro: ruído 3D pequeno nas coordenadas da pose de ligação
//   (o `position` antes do skinning), que mexe na normal e mancha a cor de
//   leve. Como é 3D, não tem UV nem emenda em lugar nenhum;
// - brilho de veludo (sheen) nas bordas, na cor do tecido clareada;
// - a cor: no modo "pelo" ela vem de campos por vértice (listra, creme) com a
//   borda decidida no fragmento, e no modo "paleta" cada vértice aponta pra
//   uma cor de uma tabela de uniforms (as cores mudam sem mexer na malha).

import { Color, MeshLambertMaterial, Vector4 } from "../vendor/three.module.min.js";

// ---------- paletas do gato ----------
export const CAT_COLOR_NAMES = ["laranja", "cinza", "frajola"];
export const CAT_COLOR_LABELS = { laranja: "Laranja rajado", cinza: "Cinza rajado", frajola: "Frajola" };
export const CAT_PALETTES = {
  laranja: { fur: "#e8924a", stripe: "#c0632a", cream: "#f6e8d3", pink: "#f2a3ae", lining: "#f4b8bf" },
  cinza: { fur: "#9c9ea6", stripe: "#686b74", cream: "#f1eee8", pink: "#f0a7b2", lining: "#f3bcc3" },
  frajola: { fur: "#2c2b30", stripe: null, cream: "#f3f0ea", pink: "#ee9fab", lining: "#f1b5bd" },
};

const NOISE = /* glsl */ `
varying vec3 vBind;
uniform float uBump;
uniform float uSheen;
uniform float uSheenMix;
float plushHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float plushNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(plushHash(i), plushHash(i + vec3(1, 0, 0)), f.x), mix(plushHash(i + vec3(0, 1, 0)), plushHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(plushHash(i + vec3(0, 0, 1)), plushHash(i + vec3(1, 0, 1)), f.x), mix(plushHash(i + vec3(0, 1, 1)), plushHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
// relevo a partir de uma altura h (m) com derivadas de tela (Mikkelsen)
vec3 plushBump(vec3 pos, vec3 n, float h, float faceDir) {
  vec2 dh = vec2(dFdx(h), dFdy(h));
  vec3 sx = dFdx(pos), sy = dFdy(pos);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 g = sign(det) * (dh.x * r1 + dh.y * r2);
  return normalize(abs(det) * n - g);
}
`;

// fibra: duas oitavas (fibras de ~4 mm e calombos de ~1,3 cm), que somem
// quando o pixel fica maior que elas (sem cintilar de longe). O teste usa
// fwidth, que é igual nos 4 pixels de cada quadrado 2x2, então o desvio não
// atrapalha as derivadas do relevo; de longe o ruído nem é calculado.
const FIBER = /* glsl */ `
  float plushFw = length(fwidth(vBind));
  float plushH = 0.0, plushMottle = 1.0;
  float plushFineK = 1.0 - smoothstep(0.0012, 0.0035, plushFw);
  float plushLumpK = 1.0 - smoothstep(0.004, 0.012, plushFw);
  if (plushLumpK > 0.0) {
    float lump = plushNoise(vBind * 75.0 + 7.1);
    float fine = plushFineK > 0.0 ? plushNoise(vBind * 260.0) : 0.5;
    plushH = (0.65 * fine * plushFineK + 0.35 * lump * plushLumpK) * uBump;
    plushMottle = 1.0 + 0.09 * (lump - 0.5) * plushLumpK + 0.05 * (fine - 0.5) * plushFineK;
  }
`;

// Skinning de quatérnio duplo: cada osso chega como (rotação, dual) em
// uDQ[2i], uDQ[2i+1]. Misturar quatérnios em vez de matrizes não encolhe a
// junta quando ela dobra nem torce como embrulho de bala.
const DQ_HEAD = (n) => /* glsl */ `
attribute vec4 bi;
attribute vec4 bw;
uniform vec4 uDQ[${n * 2}];
`;
const DQ_BLEND = /* glsl */ `
  vec4 dqR, dqD;
  {
    int i0 = int(bi.x) * 2, i1 = int(bi.y) * 2, i2 = int(bi.z) * 2, i3 = int(bi.w) * 2;
    vec4 r0 = uDQ[i0], r1 = uDQ[i1], r2 = uDQ[i2], r3 = uDQ[i3];
    float w1 = dot(r0, r1) < 0.0 ? -bw.y : bw.y;
    float w2 = dot(r0, r2) < 0.0 ? -bw.z : bw.z;
    float w3 = dot(r0, r3) < 0.0 ? -bw.w : bw.w;
    dqR = bw.x * r0 + w1 * r1 + w2 * r2 + w3 * r3;
    dqD = bw.x * uDQ[i0 + 1] + w1 * uDQ[i1 + 1] + w2 * uDQ[i2 + 1] + w3 * uDQ[i3 + 1];
    float l = length(dqR);
    dqR /= l;
    dqD /= l;
  }
  objectNormal += 2.0 * cross(dqR.xyz, cross(dqR.xyz, objectNormal) + dqR.w * objectNormal);
`;
const DQ_POINT = /* glsl */ `
  transformed += 2.0 * cross(dqR.xyz, cross(dqR.xyz, transformed) + dqR.w * transformed)
    + 2.0 * (dqR.w * dqD.xyz - dqD.w * dqR.xyz + cross(dqR.xyz, dqD.xyz));
`;

const SHEEN = /* glsl */ `
  {
    float nv = saturate(dot(normal, geometryViewDir));
    vec3 lit = (reflectedLight.directDiffuse + reflectedLight.indirectDiffuse) / max(diffuseColor.rgb, vec3(0.04));
    vec3 sheenC = mix(diffuseColor.rgb, vec3(1.0), uSheenMix);
    outgoingLight += sheenC * lit * (pow(1.0 - nv, 2.6) * uSheen);
  }
`;

// brilho de botão (olhos): reflexo da luz principal e uma borda clara, só nos
// slots com aspereza baixa
const GLOSS = /* glsl */ `
#if NUM_DIR_LIGHTS > 0
  if (vPal.a < 0.5) {
    float gk = 1.0 - vPal.a;
    vec3 hv = normalize(directionalLights[0].direction + geometryViewDir);
    outgoingLight += directionalLights[0].color * (pow(saturate(dot(normal, hv)), 90.0) * 0.5 * gk);
    outgoingLight += vec3(0.32) * (pow(1.0 - saturate(dot(normal, geometryViewDir)), 3.0) * gk);
  }
#endif
`;

/**
 * Material de feltro.
 * - kind "fur": atributo `fur` (vec2: listra, creme); cores em u.fur/u.stripe/u.cream.
 * - kind "palette": atributo `slot` (float); cor em u.pal[slot] (Vector4: rgb linear e
 *   aspereza; abaixo de 0,5 ganha brilho de botão) e brilho próprio em u.emi[slot].
 * - dq = número de ossos: skinning de quatérnio duplo (atributos `bi`, `bw` e
 *   u.uDQ, 8 floats por osso), pra malhas comuns (não SkinnedMesh). `rope` = slot que
 *   ganha o padrão de corda torcida (usa o atributo `puv`).
 */
export function plushMaterial(kind, { slots = 1, rope = -1, sheen = 0.85, sheenMix = 0.45, bump = 0.00045, dq = 0 } = {}) {
  const mat = new MeshLambertMaterial();
  const u = {
    uBump: { value: bump }, uSheen: { value: sheen }, uSheenMix: { value: sheenMix },
  };
  if (dq) u.uDQ = { value: new Float32Array(dq * 8) };
  if (kind === "fur") {
    u.uFur = { value: new Color() };
    u.uStripe = { value: new Color() };
    u.uCream = { value: new Color() };
  } else {
    u.uPal = { value: Array.from({ length: slots }, () => new Vector4(1, 1, 1, 0.92)) };
    u.uEmi = { value: Array.from({ length: slots }, () => new Color(0, 0, 0)) };
  }
  const fur = kind === "fur", hasRope = rope >= 0;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    let vs = sh.vertexShader, fs = sh.fragmentShader;
    const vHead = ["varying vec3 vBind;"];
    const vBody = ["vBind = position;"];
    const fHead = [NOISE];
    if (fur) {
      vHead.push("attribute vec2 fur;", "attribute float ao;", "varying vec2 vFur;", "varying float vAo;");
      vBody.push("vFur = fur;", "vAo = ao;");
      fHead.push("varying vec2 vFur;", "varying float vAo;", "uniform vec3 uFur;", "uniform vec3 uStripe;", "uniform vec3 uCream;");
    } else {
      vHead.push("attribute float slot;", `uniform vec4 uPal[${slots}];`, `uniform vec3 uEmi[${slots}];`,
        "varying vec4 vPal;", "varying vec3 vEmi;");
      vBody.push("int plushSlot = int(slot + 0.5);", "vPal = uPal[plushSlot];", "vEmi = uEmi[plushSlot];");
      fHead.push("varying vec4 vPal;", "varying vec3 vEmi;");
      if (hasRope) {
        vHead.push("attribute vec2 puv;", "varying vec3 vRope;");
        vBody.push(`vRope = vec3(puv, plushSlot == ${rope} ? 1.0 : 0.0);`);
        fHead.push("varying vec3 vRope;");
      }
    }
    if (dq) {
      vHead.push(DQ_HEAD(dq));
      vs = vs.replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>\n${DQ_BLEND}`);
    }
    vs = vs.replace("#include <common>", `#include <common>\n${vHead.join("\n")}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${vBody.join("\n")}${dq ? DQ_POINT : ""}`);
    let color = fur
      ? `{
    float sw = fwidth(vFur.x) * 0.8 + 0.05, cw = fwidth(vFur.y) * 0.8 + 0.035;
    float s = smoothstep(0.62 - sw, 0.62 + sw, vFur.x);
    float c = smoothstep(0.5 - cw, 0.5 + cw, vFur.y);
    // dobras escurecem (sombra de contato medida na geração), um pouco mais quentes
    float occ = 1.0 - vAo;
    diffuseColor.rgb = mix(mix(uFur, uStripe, s), uCream, c) * plushMottle * (1.0 - 0.5 * occ) * mix(vec3(1.0), vec3(1.0, 0.86, 0.78), occ * 0.6);
  }`
      : "diffuseColor.rgb = vPal.rgb * plushMottle;";
    if (hasRope) {
      // corda: 3 pernas em hélice (claro no alto de cada perna, escuro no vão)
      color += `
  if (vRope.z > 0.5) {
    float ph = 6.2832 * (3.0 * vRope.x + 2.0 * vRope.y);
    float hgt = pow(0.5 + 0.5 * sin(ph), 0.6);
    diffuseColor.rgb *= 0.72 + 0.28 * hgt;
    plushH += uBump * 1.6 * hgt;
  }`;
    }
    fs = fs.replace("#include <common>", `#include <common>\n${fHead.join("\n")}`)
      .replace("#include <color_fragment>", `${FIBER}\n  ${color}`)
      .replace("#include <normal_fragment_maps>", "normal = plushBump(-vViewPosition, normal, plushH, faceDirection);")
      .replace("#include <emissivemap_fragment>", fur ? "" : "totalEmissiveRadiance += vEmi;")
      .replace("#include <opaque_fragment>", `${SHEEN}\n${fur ? "" : GLOSS}\n#include <opaque_fragment>`);
    sh.vertexShader = vs;
    sh.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => `plush-${kind}-${slots}-${rope}-${dq}`;
  mat.userData.u = u;
  return mat;
}

const tmp = new Color();
/** Põe a cor (hex/Color) e a aspereza no slot `i` de um material de paleta. */
export function setSlot(mat, i, color, roughness) {
  const v = mat.userData.u.uPal.value[i];
  tmp.set(color);
  v.set(tmp.r, tmp.g, tmp.b, roughness ?? v.w);
}
/** Brilho próprio (emissive) do slot `i`. */
export function setSlotEmissive(mat, i, color, k = 1) {
  mat.userData.u.uEmi.value[i].copy(color).multiplyScalar(k);
}
