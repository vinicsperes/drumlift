// Esqueleto humano do baterista: pelve, coluna em três partes, pescoço,
// cabeça, clavículas, braço, antebraço com torção, mão com cinco dedos
// segurando a baqueta e pernas com tornozelo e dedos do pé.
//
// Quem decide a pose é um "comando" por quadro (createDrive): rotações da
// pelve, da coluna e da cabeça, clavículas, onde está cada baqueta (fulcro e
// orientação), quanto cada cotovelo abre e como cada pé está no pedal. O
// esqueleto resolve o resto: a mão sai da baqueta (pegada fixa), o cotovelo
// do IK de dois ossos com o giro pedido, a torção do antebraço da diferença
// entre mão e antebraço, os dedos da pegada e as pernas do IK até os pedais.
// Como a mão vem da baqueta, a ponta da baqueta fica exatamente onde o
// comando mandou, qualquer que seja o braço.
//
// Convenções (as mesmas da captura MMIP, pra transferir movimento direto):
// mundo com y pra cima e o baterista olhando pra -Z (direita = +X); cada
// osso tem origem na junta, y ao longo do osso; na mão, y vai do pulso pros
// dedos, z sai pelo dorso e x = y × z (ulnar na direita, radial na esquerda).

import { Euler, Matrix4, Quaternion, Vector3 } from "../vendor/three.module.min.js";
import { solveTwoBone } from "./ik.js";

export const HANDS = ["MD", "ME"];
export const FEET = ["PD", "PE"];
export const FINGERS = ["thumb", "index", "middle", "ring", "pinky"];
export const SPINE = ["spine", "spine1", "chest"];

export const BONES = [
  "hips", ...SPINE, "neck", "head",
  ...HANDS.flatMap((l) => [
    `clav.${l}`, `arm.${l}`, `forearm.${l}`, `twist.${l}`, `hand.${l}`, `stick.${l}`,
    ...FINGERS.flatMap((f) => [1, 2, 3].map((k) => `${f}${k}.${l}`)),
  ]),
  ...FEET.flatMap((l) => [`thigh.${l}`, `shin.${l}`, `foot.${l}`, `toe.${l}`]),
];
export const BONE = Object.fromEntries(BONES.map((n, i) => [n, i]));

const v3 = (a) => new Vector3(a[0], a[1], a[2]);

// Medidas (m). Offsets da coluna e da cabeça no espaço do osso de cima; os
// de lado (x) são da direita e espelham na esquerda.
export const SKEL = {
  hips: [0, 0.58, 0.26],           // centro da pelve, no banco (mundo)
  spine: [0, 0.095, -0.005],       // pelve -> lombar
  spine1: [0, 0.125, 0],           // lombar -> torácica
  chest: [0, 0.13, 0],             // -> peito
  neck: [0, 0.19, 0.012],          // peito -> base do pescoço
  head: [0, 0.095, -0.012],        // pescoço -> base do crânio
  headTop: 0.2,                    // base do crânio -> topo da cabeça
  sc: [0.022, 0.135, -0.045],      // peito -> junta esterno-clavicular
  shoulder: [0.168, 0.012, 0.03],  // esterno-clavicular -> ombro
  upperArm: 0.285,
  foreArm: 0.255,
  hip: [0.095, -0.045, -0.01],     // pelve -> quadril
  thigh: 0.42,
  shin: 0.42,
  // pé, no plano da sola (origem no calcanhar, -z pra frente)
  ankle: [0, 0.075, -0.05],
  ball: [0, 0.022, -0.165],
  toeTip: [0, 0.016, -0.235],
  footWidth: 0.09,
  // baqueta: do fulcro (entre o polegar e o indicador) até o centro da bolinha, e até o cabo
  stickFront: 0.28,
  stickBack: 0.13,
};

// Pegada: fulcro e direção da baqueta no espaço da mão (direita; x espelha na
// esquerda). A baqueta atravessa a palma na diagonal, do pé da mão (lado do
// mínimo) até sair entre o polegar e o indicador, encostada na palma.
export const GRIP = { fulcrum: [-0.024, 0.088, -0.03], dir: [-0.6, 0.8, 0] };

// Dedos (direita, cm no espaço da mão): base, comprimento das 3 falanges e
// flexão de cada junta na pegada (graus). O polegar sai do pé do polegar e
// encosta a ponta na baqueta, em cima do fulcro.
const FINGER_DEF = {
  thumb: { base: [-2.8, 2.2, -1.2], dir: [-0.3, 0.93, -0.2], len: [4.0, 3.1, 2.6], flex: [6, 12, 14], spread: 0 },
  index: { base: [-3.2, 7.9, -0.2], dir: [-0.08, 1, 0], len: [4.5, 2.8, 2.1], flex: [25, 75, 22], spread: -3 },
  middle: { base: [-0.8, 8.2, -0.2], dir: [0, 1, 0], len: [4.7, 3.1, 2.2], flex: [58, 95, 32], spread: 0 },
  ring: { base: [1.5, 7.8, -0.4], dir: [0.04, 1, 0], len: [4.3, 2.8, 2.1], flex: [78, 95, 35], spread: 3 },
  pinky: { base: [3.6, 6.8, -0.7], dir: [0.1, 1, 0], len: [3.5, 2.2, 1.9], flex: [88, 95, 35], spread: 6 },
};
export const FINGER_LEN = Object.fromEntries(Object.entries(FINGER_DEF).map(([k, f]) => [k, f.len.map((x) => x / 100)]));

const deg = (d) => (d * Math.PI) / 180;
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
const DOWN = new Vector3(0, -1, 0);
const side = (l) => (l === "MD" || l === "PD" ? 1 : -1);
// Mão em relação ao antebraço com o polegar pra cima (torção zero), em volta do y.
const TWIST0 = Math.PI / 2;
const mirror = (a, s) => [a[0] * s, a[1], a[2]];

/** Comando de pose (o que o "baterista" decide a cada quadro). */
export function createDrive() {
  const hand = () => ({ pos: new Vector3(), quat: new Quaternion() });
  return {
    hips: { pos: v3(SKEL.hips), rot: new Euler(0, 0, 0, "YXZ") },
    spine: SPINE.map(() => new Euler(0, 0, 0, "YXZ")),  // rotação local de cada vértebra
    neck: new Euler(0, 0, 0, "YXZ"),
    head: new Euler(0, 0, 0, "YXZ"),
    clav: { MD: { elev: 0, prot: 0 }, ME: { elev: 0, prot: 0 } }, // rad: sobe e vai pra frente
    stick: { MD: hand(), ME: hand() },                  // fulcro e orientação da baqueta
    swivel: { MD: 0.45, ME: 0.2 },                      // rad: cotovelo pra fora (+) a partir de "pendurado"
    grip: { MD: 0, ME: 0 },                             // 0..1: quanto os dedos apertam
    // pé no pedal: frame da prancha (origem no eixo, y = normal, -z = pra ponta),
    // onde fica o calcanhar na prancha e quanto ele está levantado (rad, gira na planta)
    foot: {
      PD: { board: new Matrix4(), heel: 0, lift: 0 },
      PE: { board: new Matrix4(), heel: 0, lift: 0 },
    },
  };
}

/** Matriz com origem o, eixo y = yDir e x o mais perto possível de xHint. */
export function frameFrom(o, yDir, xHint, out) {
  const y = _f.y.copy(yDir).normalize();
  const x = _f.x.copy(xHint).addScaledVector(y, -xHint.dot(y));
  if (x.lengthSq() < 1e-10) x.copy(Math.abs(y.x) < 0.9 ? X : Z).addScaledVector(y, -(Math.abs(y.x) < 0.9 ? y.x : y.z));
  x.normalize();
  const z = _f.z.crossVectors(x, y);
  return out.makeBasis(x, y, z).setPosition(o);
}
const _f = { x: new Vector3(), y: new Vector3(), z: new Vector3() };

/**
 * Cria o esqueleto. `bones[i]` é a matriz de mundo de cada osso (BONES) depois
 * de `solve(drive)`; `joints` guarda as posições das juntas, pra quem quiser.
 */
export function createSkeleton() {
  const n = BONES.length;
  const bones = Array.from({ length: n }, () => new Matrix4());
  const pos = Array.from({ length: n }, () => new Vector3());   // origem de cada osso
  const quat = Array.from({ length: n }, () => new Quaternion());
  const reached = { MD: true, ME: true, PD: true, PE: true };
  const twist = { MD: 0, ME: 0 };

  // pegada: mão -> baqueta (constante)
  const grip = {};
  for (const l of HANDS) {
    const s = side(l);
    const f = v3(mirror(GRIP.fulcrum, s));
    const y = v3(mirror(GRIP.dir, s)).normalize();
    const z = Z.clone().addScaledVector(y, -y.z).normalize();
    const x = new Vector3().crossVectors(y, z);
    const m = new Matrix4().makeBasis(x, y, z).setPosition(f);
    grip[l] = { m, inv: m.clone().invert(), q: new Quaternion().setFromRotationMatrix(m), f };
  }
  // dedos: base, direções e flexões no espaço da mão
  const fingers = {};
  for (const l of HANDS) {
    const s = side(l);
    fingers[l] = FINGERS.map((name) => {
      const d = FINGER_DEF[name];
      return {
        name, base: v3(mirror(d.base, s)).multiplyScalar(0.01),
        dir: v3(mirror(d.dir, s)).normalize(),
        len: d.len.map((x) => x / 100), flex: d.flex.map(deg), spread: deg(d.spread) * s,
      };
    });
  }

  // tmp
  const tA = new Vector3(), tB = new Vector3(), tC = new Vector3(), tD = new Vector3();
  const qA = new Quaternion(), qB = new Quaternion(), qC = new Quaternion();
  const mA = new Matrix4(), mB = new Matrix4();
  const hinge = new Vector3(), axis = new Vector3(), e0 = new Vector3(), ref = new Vector3();

  function setBone(i, m) {
    bones[i].copy(m);
    pos[i].setFromMatrixPosition(m);
    quat[i].setFromRotationMatrix(m);
  }
  /** Osso filho: pai * translação local * rotação local. */
  function child(i, parent, offset, euler) {
    mA.makeRotationFromEuler(euler);
    mA.setPosition(offset[0], offset[1], offset[2]);
    bones[i].multiplyMatrices(bones[parent], mA);
    pos[i].setFromMatrixPosition(bones[i]);
    quat[i].setFromRotationMatrix(bones[i]);
  }

  function solveTrunk(d) {
    mA.makeRotationFromEuler(d.hips.rot).setPosition(d.hips.pos);
    setBone(BONE.hips, mA);
    child(BONE.spine, BONE.hips, SKEL.spine, d.spine[0]);
    child(BONE.spine1, BONE.spine, SKEL.spine1, d.spine[1]);
    child(BONE.chest, BONE.spine1, SKEL.chest, d.spine[2]);
    child(BONE.neck, BONE.chest, SKEL.neck, d.neck);
    child(BONE.head, BONE.neck, SKEL.head, d.head);
  }

  const clavRest = {}, scLocal = {};
  for (const l of HANDS) {
    clavRest[l] = v3(mirror(SKEL.shoulder, side(l)));
    scLocal[l] = mirror(SKEL.sc, side(l));
  }
  const clavLen = v3(SKEL.shoulder).length();
  const handM = new Matrix4(), handQ = new Quaternion(), stickM = new Matrix4();
  const S = new Vector3(), E = new Vector3(), W = new Vector3(), SC = new Vector3();

  function solveArm(l, d) {
    const s = side(l), chest = bones[BONE.chest];
    // clavícula: gira o ombro em volta da junta esterno-clavicular
    SC.set(...scLocal[l]).applyMatrix4(chest);
    const c = d.clav[l];
    tA.copy(clavRest[l]);
    tA.applyAxisAngle(Z, c.elev * s);          // sobe
    tA.applyAxisAngle(Y, c.prot * s);          // vai pra frente
    qA.setFromRotationMatrix(chest);
    S.copy(tA).applyQuaternion(qA).add(SC);

    // mão: da baqueta (pegada fixa)
    const st = d.stick[l];
    stickM.makeRotationFromQuaternion(st.quat).setPosition(st.pos);
    handM.multiplyMatrices(stickM, grip[l].inv);
    handQ.setFromRotationMatrix(handM);
    W.setFromMatrixPosition(handM);

    // alvo longe: a clavícula leva o ombro um pouco na direção do pulso
    const a = SKEL.upperArm, b = SKEL.foreArm;
    for (let k = 0; k < 2; k++) {
      const ex = S.distanceTo(W) - (a + b - 0.004);
      if (ex <= 0) break;
      tB.subVectors(W, S).normalize().multiplyScalar(Math.min(ex, 0.06) * 1.05).add(S).sub(SC).setLength(clavLen);
      S.copy(SC).add(tB);
    }

    // cotovelo: IK com o giro pedido em volta do eixo ombro-pulso
    axis.subVectors(W, S);
    const dist = axis.length();
    axis.divideScalar(dist || 1);
    ref.copy(DOWN).addScaledVector(axis, -DOWN.dot(axis));
    if (ref.lengthSq() < 1e-6) {
      // braço na vertical: a referência é as costas do peito
      tC.set(0, 0, 1).applyQuaternion(qA);
      ref.copy(tC).addScaledVector(axis, -tC.dot(axis));
    }
    ref.normalize();
    // pra fora = +X na direita e -X na esquerda: gira o "pendurado" em volta do eixo
    e0.copy(ref).applyAxisAngle(axis, -s * d.swivel[l]);
    // se não alcançar, o braço estica na direção do pulso (a mão continua na baqueta)
    reached[l] = solveTwoBone(S, W, a, b, e0, E, tD);
    hinge.crossVectors(e0, axis).normalize();

    frameFrom(SC, tA.subVectors(S, SC), Y.clone().applyQuaternion(qA), mB);
    setBone(BONE[`clav.${l}`], mB);
    frameFrom(S, tA.subVectors(E, S), hinge, mB);
    setBone(BONE[`arm.${l}`], mB);
    frameFrom(E, tA.subVectors(tD, E), hinge, mB);
    setBone(BONE[`forearm.${l}`], mB);
    // torção: quanto a mão gira em volta do antebraço a partir do neutro
    // (polegar pra cima); metade vai pro osso do meio do antebraço
    const fq = quat[BONE[`forearm.${l}`]];
    qB.copy(fq).invert().multiply(handQ);
    const tw = 2 * Math.atan2(qB.y, qB.w) - TWIST0 * s;
    twist[l] = Math.atan2(Math.sin(tw), Math.cos(tw));
    qC.setFromAxisAngle(Y, twist[l] * 0.5);
    qB.copy(fq).multiply(qC);
    tA.lerpVectors(E, tD, 0.5);
    mB.makeRotationFromQuaternion(qB).setPosition(tA);
    setBone(BONE[`twist.${l}`], mB);
    setBone(BONE[`hand.${l}`], handM);
    setBone(BONE[`stick.${l}`], stickM);

    // dedos: base fixa na mão, flexão da pegada (+ aperto)
    const sq = d.grip[l];
    for (const f of fingers[l]) {
      // frame da falange: y = direção do dedo, x = eixo da flexão (o x da mão)
      tB.copy(f.dir);
      if (f.spread) tB.applyAxisAngle(Z, f.spread);
      mB.copy(frameFrom(f.base, tB, X, mA));
      let parent = handM;
      for (let k = 0; k < 3; k++) {
        const flex = f.flex[k] * (1 + (f.name === "thumb" ? 0.1 : 0.12) * sq);
        // gira em volta do x local pra palma (-z)
        mA.makeRotationAxis(X, -flex);
        if (k === 0) mB.multiply(mA);
        else mB.makeTranslation(0, f.len[k - 1], 0).multiply(mA);
        const i = BONE[`${f.name}${k + 1}.${l}`];
        bones[i].multiplyMatrices(parent, mB);
        pos[i].setFromMatrixPosition(bones[i]);
        quat[i].setFromRotationMatrix(bones[i]);
        parent = bones[i];
      }
    }
    return { S, E, W: tD };
  }

  const ankleL = v3(SKEL.ankle), ballL = v3(SKEL.ball), toeL = v3(SKEL.toeTip);
  const flat = new Matrix4(), sole = new Matrix4(), hip = new Vector3(), knee = new Vector3();
  const ankle = new Vector3(), ball = new Vector3(), toe = new Vector3(), kneePole = new Vector3();
  function solveLeg(l, d) {
    const s = side(l), f = d.foot[l];
    // sola deitada na prancha, calcanhar em z = heel; levantar o calcanhar gira
    // a sola em volta da planta, e os dedos continuam deitados na prancha
    flat.copy(f.board).multiply(mA.makeTranslation(0, 0, f.heel));
    sole.copy(flat);
    if (f.lift) {
      sole.multiply(mA.makeTranslation(0, 0, ballL.z))
        .multiply(mB.makeRotationAxis(X, -f.lift))
        .multiply(mA.makeTranslation(0, 0, -ballL.z));
    }
    ankle.copy(ankleL).applyMatrix4(sole);
    ball.copy(ballL).applyMatrix4(sole);
    toe.copy(toeL).applyMatrix4(flat);
    hip.set(...mirror(SKEL.hip, s)).applyMatrix4(bones[BONE.hips]);
    kneePole.set(0.3 * s, 0.6, -1).normalize();
    reached[l] = solveTwoBone(hip, ankle, SKEL.thigh, SKEL.shin, kneePole, knee, tD);
    hinge.subVectors(knee, hip).cross(tA.subVectors(tD, knee));
    if (hinge.lengthSq() < 1e-10) hinge.copy(X);
    hinge.normalize();
    frameFrom(hip, tA.subVectors(knee, hip), hinge, mB);
    setBone(BONE[`thigh.${l}`], mB);
    frameFrom(knee, tA.subVectors(tD, knee), hinge, mB);
    setBone(BONE[`shin.${l}`], mB);
    tB.set(1, 0, 0).transformDirection(f.board);
    frameFrom(tD, tA.subVectors(ball, tD), tB, mB);
    setBone(BONE[`foot.${l}`], mB);
    frameFrom(ball, tA.subVectors(toe, ball), tB, mB);
    setBone(BONE[`toe.${l}`], mB);
  }

  function solve(d) {
    solveTrunk(d);
    for (const l of HANDS) solveArm(l, d);
    for (const l of FEET) solveLeg(l, d);
  }

  return {
    bones, pos, quat, reached, twist, grip, solve, bone: BONE,
    /** Posição de mundo de um osso (atalho). */
    at: (name, out = new Vector3()) => out.copy(pos[BONE[name]]),
  };
}

/** Ponta da baqueta (centro da bolinha) no mundo, dado o comando. */
export function stickTip(stick, out = new Vector3()) {
  return out.set(0, SKEL.stickFront, 0).applyQuaternion(stick.quat).add(stick.pos);
}
