// Baterista do estilo manequim: um boneco articulado de madeira, como os de
// desenho, vestindo o esqueleto humano (skeleton.js). As juntas aparecem como
// bolas, cada peça é torneada no espaço do próprio osso e as mãos têm os cinco
// dedos fechados na baqueta, com o fulcro entre o polegar e o indicador. Mãos
// e pés têm a cor do membro (a mesma da legenda), pra ver quem toca o quê.
//
// Tudo sai numa malha só (SkinnedMesh com cada parte presa a um osso, um draw
// call): as partes são modeladas no espaço local do osso, então os inversos de
// ligação são a identidade e a matriz de cada osso é a de mundo do esqueleto.

import {
  Bone, Group, Matrix4, Skeleton, SkinnedMesh, SphereGeometry, Vector3,
} from "../vendor/three.module.min.js";
import { BONE, BONES, FEET, FINGERS, FINGER_LEN, HANDS, SKEL } from "./skeleton.js";
import { lathe, mergeSkinned, pillow } from "./shapes.js";
import { setWood, woodMaterial } from "./wood.js";

// slots da paleta
const S = { wood: 0, joint: 1, stick: 2, MD: 3, ME: 4, PD: 5, PE: 6, face: 7 };
const SLOTS = 8;

/** Peça torneada ao longo de y, de y0 a y1, com pontas arredondadas (raios r0 e r1). */
function turned(r0, r1, y0, y1, seg = 22) {
  const pts = [];
  const N = 6;
  for (let k = 0; k <= N; k++) {
    const a = -Math.PI / 2 + (k / N) * (Math.PI / 2);
    pts.push([r0 * Math.cos(a), y0 + r0 + r0 * Math.sin(a)]);
  }
  for (let k = 0; k <= N; k++) {
    const a = (k / N) * (Math.PI / 2);
    pts.push([r1 * Math.cos(a), y1 - r1 + r1 * Math.sin(a)]);
  }
  pts[0][0] = 0;
  pts[pts.length - 1][0] = 0;
  return lathe(pts, seg);
}
const ball = (r, w = 18, h = 12) => new SphereGeometry(r, w, h);

/** Base da sola -> osso: matriz com origem o, y na direção de o->p e x = (1,0,0). */
function soleFrame(o, p) {
  const y = new Vector3().subVectors(p, o).normalize();
  const x = new Vector3(1, 0, 0).addScaledVector(y, -y.x).normalize();
  const z = new Vector3().crossVectors(x, y);
  return new Matrix4().makeBasis(x, y, z).setPosition(o);
}

/** Geometria das partes do boneco, cada uma no espaço do seu osso. */
function buildParts() {
  const parts = [];
  const add = (bone, geo, slot) => {
    geo.deleteAttribute("slot"); // a cor vem da parte
    parts.push({ geo, slot, bone: BONE[bone] });
  };
  // ---------- tronco e cabeça ----------
  add("hips", pillow(0.29, 0.14, 0.2, 3.2).translate(0, -0.012, 0.004), S.wood);
  add("spine", ball(0.07).scale(1.45, 0.75, 1.15).translate(0, 0.045, 0), S.joint);
  add("spine1", pillow(0.24, 0.13, 0.165, 3).translate(0, 0.07, 0), S.wood);
  {
    // peito: mais largo em cima (ombros) que embaixo
    const g = pillow(0.31, 0.21, 0.19, 3.2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 0.105; // -1..1
      p.setX(i, p.getX(i) * (0.84 + 0.16 * (y + 1) / 2));
      p.setZ(i, p.getZ(i) * (0.95 - 0.08 * Math.max(0, y)));
    }
    g.computeVertexNormals();
    add("chest", g.translate(0, 0.105, 0.004), S.wood);
  }
  add("neck", turned(0.03, 0.028, -0.01, 0.1), S.joint);
  add("head", ball(1, 26, 18).scale(0.083, 0.106, 0.094).translate(0, 0.095, -0.012), S.wood);
  add("head", ball(1, 10, 8).scale(0.012, 0.018, 0.014).translate(0, 0.085, -0.104), S.wood); // nariz: pra onde olha

  // ---------- braços, mãos e baquetas ----------
  const a = SKEL.upperArm, f = SKEL.foreArm;
  for (const l of HANDS) {
    add(`arm.${l}`, ball(0.047), S.joint);
    add(`arm.${l}`, turned(0.041, 0.034, 0.03, a - 0.025), S.wood);
    add(`forearm.${l}`, ball(0.035), S.joint);
    add(`twist.${l}`, turned(0.033, 0.026, 0.028 - f / 2, f / 2 - 0.02), S.wood);
    add(`hand.${l}`, ball(0.025), S.joint);
    add(`hand.${l}`, pillow(0.074, 0.082, 0.03, 3.4).translate(0, 0.05, -0.01), S[l]);
    for (const name of FINGERS) {
      const len = FINGER_LEN[name], r = name === "thumb" ? 0.0108 : name === "pinky" ? 0.0084 : 0.0097;
      len.forEach((L, k) => add(`${name}${k + 1}.${l}`, turned(r * (1 - 0.06 * k), r * (0.92 - 0.06 * k), -r * 0.6, L + r * 0.4, 10), S[l]));
    }
    // baqueta: cabo grosso, afina pra ponta, bolinha no fim
    const back = SKEL.stickBack, front = SKEL.stickFront;
    add(`stick.${l}`, lathe([
      [0, -back], [0.0074, -back + 0.004], [0.0076, 0.0], [0.0068, front * 0.62], [0.0042, front - 0.012], [0.0035, front - 0.006],
      [0.0062, front - 0.004], [0.0085, front], [0.0062, front + 0.0055], [0, front + 0.0085],
    ], 14), S.stick);
  }

  // ---------- pernas e pés ----------
  const ankle = new Vector3(...SKEL.ankle), ballP = new Vector3(...SKEL.ball), toe = new Vector3(...SKEL.toeTip);
  const footInv = soleFrame(ankle, ballP).invert(), toeInv = soleFrame(ballP, toe).invert();
  for (const l of FEET) {
    add(`thigh.${l}`, ball(0.058), S.joint);
    add(`thigh.${l}`, turned(0.06, 0.047, 0.045, SKEL.thigh - 0.04), S.wood);
    add(`shin.${l}`, ball(0.048), S.joint);
    add(`shin.${l}`, turned(0.045, 0.034, 0.04, SKEL.shin - 0.03), S.wood);
    add(`foot.${l}`, ball(0.033), S.joint);
    add(`foot.${l}`, pillow(0.09, 0.075, 0.2, 3.4).translate(0, 0.04, -0.07).applyMatrix4(footInv), S[l]);
    add(`toe.${l}`, pillow(0.084, 0.036, 0.075, 3).translate(0, 0.02, -0.2).applyMatrix4(toeInv), S[l]);
  }
  return parts;
}

export function createAvatar(rig) {
  const group = new Group();
  group.name = "baterista";
  const geo = mergeSkinned(buildParts());
  const mat = woodMaterial(SLOTS);
  const bones = BONES.map((name) => {
    const b = new Bone();
    b.name = name;
    b.matrixAutoUpdate = false;
    group.add(b);
    return b;
  });
  const skeleton = new Skeleton(bones, bones.map(() => new Matrix4()));
  const mesh = new SkinnedMesh(geo, mat);
  mesh.name = "boneco";
  mesh.frustumCulled = false;
  mesh.bind(skeleton, new Matrix4());
  group.add(mesh);

  /** Veste o esqueleto (chamar depois de rig.update). */
  function update() {
    const src = rig.skel.bones;
    for (let i = 0; i < bones.length; i++) {
      bones[i].matrix.copy(src[i]);
      bones[i].matrixWorld.copy(src[i]);
    }
  }

  function paint(theme) {
    const dark = !!theme.dark;
    setWood(mat, S.wood, dark ? "#c39566" : "#ddb789", 1);
    setWood(mat, S.joint, dark ? "#a97c4f" : "#c69a68", 0.8);
    setWood(mat, S.stick, theme.stick, 0.6);
    setWood(mat, S.face, "#2a2119", 0);
    for (const l of [...HANDS, ...FEET]) setWood(mat, S[l], theme.limb[l], 0.25);
  }

  /** Debug: centro da bolinha da baqueta no mundo (depois do update). */
  function tipWorld(limb, out = new Vector3()) {
    return rig.tip(limb, out);
  }

  return {
    group, update, paint, tipWorld, mesh,
    dispose() { geo.dispose(); mat.dispose(); skeleton.dispose(); },
  };
}
