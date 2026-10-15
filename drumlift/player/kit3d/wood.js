// Madeira procedural do boneco articulado, sem textura: MeshStandardMaterial
// com uma paleta por slot (cor e quanto do veio aparece) e o veio desenhado
// no shader a partir da posição antes do skinning. Como cada parte do boneco
// é modelada no espaço do próprio osso (y ao longo dele), os anéis do veio
// correm ao longo de cada peça, como num boneco torneado de verdade.

import { Color, MeshStandardMaterial, Vector4 } from "../vendor/three.module.min.js";

const GRAIN = /* glsl */ `
varying vec3 vBind;
varying vec4 vWood;
float woodHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float woodNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(woodHash(i), woodHash(i + vec3(1, 0, 0)), f.x), mix(woodHash(i + vec3(0, 1, 0)), woodHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(woodHash(i + vec3(0, 0, 1)), woodHash(i + vec3(1, 0, 1)), f.x), mix(woodHash(i + vec3(0, 1, 1)), woodHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
`;

/**
 * Material de madeira com `slots` cores. Atributo `slot` (float) por vértice;
 * u.uPal[slot] = (r, g, b linear, veio 0..1).
 */
export function woodMaterial(slots) {
  const mat = new MeshStandardMaterial({ roughness: 0.55, metalness: 0 });
  const u = { uPal: { value: Array.from({ length: slots }, () => new Vector4(1, 1, 1, 1)) } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
attribute float slot;
uniform vec4 uPal[${slots}];
varying vec3 vBind;
varying vec4 vWood;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vBind = position;
vWood = uPal[int(slot + 0.5)];`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\n${GRAIN}`)
      .replace("#include <color_fragment>", `
  {
    // anéis em volta do eixo da peça, tortos pelo ruído, e fibras finas ao longo dele
    float fw = length(fwidth(vBind));
    float k = (1.0 - smoothstep(0.002, 0.008, fw)) * vWood.a;
    float wobble = woodNoise(vBind * vec3(22.0, 2.5, 22.0)) * 2.2;
    float ring = fract(length(vBind.xz) * 150.0 + wobble + vBind.y * 3.0);
    float band = smoothstep(0.0, 0.35, ring) * (1.0 - smoothstep(0.55, 1.0, ring));
    float fiber = woodNoise(vBind * vec3(420.0, 9.0, 420.0));
    diffuseColor.rgb = vWood.rgb * (1.0 + k * (0.07 * band - 0.05 + 0.05 * (fiber - 0.5)));
  }`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
  roughnessFactor = mix(0.42, 0.62, vWood.a);`);
  };
  mat.customProgramCacheKey = () => `wood-${slots}`;
  mat.userData.u = u;
  return mat;
}

const tmp = new Color();
/** Cor (hex/Color) e veio (0..1) do slot `i`. */
export function setWood(mat, i, color, grain = 1) {
  tmp.set(color);
  mat.userData.u.uPal.value[i].set(tmp.r, tmp.g, tmp.b, grain);
}
