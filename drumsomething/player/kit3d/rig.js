// Esqueleto do baterista, sem malha, como função pura do tempo: um "baterista"
// decide a cada instante onde está cada baqueta, a pelve, a coluna, a cabeça,
// os cotovelos e os pés (o comando, skeleton.js), e o esqueleto humano
// resolve o resto. Os estilos só vestem este esqueleto, então o golpe é o
// mesmo em qualquer visual.
//
// Pra cada mão e cada peça há uma "configuração de golpe" (fulcro, direção e
// giro da baqueta, abertura do cotovelo) em que a ponta encosta exatamente no
// ponto de contato da peça; a animação interpola entre essas configurações e
// levanta a baqueta no meio.

import { Matrix4, Object3D, Quaternion, Vector3 } from "../vendor/three.module.min.js";
import { BODY, CYMBALS, DRUMS, HIHAT_PEDAL, KICK_PEDAL, TORSO_LIMIT, TORSO_REACH } from "./layout.js";
import { contact, pedalAngle, placeFrame, strikeAngle, surfaceY } from "./pieces.js";
import { handState } from "./motion.js";
import { BONE, FEET, HANDS, SKEL, createDrive, createSkeleton } from "./skeleton.js";
import { segmentAt } from "./perform.js";
import { unwarp } from "./moves.js";

export { FEET, HANDS };
export const TIP_R = 0.0085; // raio da bolinha na ponta da baqueta

const UP = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const deg = (d) => (d * Math.PI) / 180;
// Chicote (método Moeller): o cotovelo e o ombro sobem um instante antes da
// baqueta. Só mexe na cadeia do braço, não no pulso: a ponta continua exata.
const WHIP_LEAD = 0.04;    // s de adiantamento do cotovelo
const WHIP_SWIVEL = 0.22;  // rad que o cotovelo abre com a baqueta toda levantada
const WHIP_CLAV = 0.03;    // rad que a clavícula sobe
// Trocando de peça, a mão passa por cima dos aros: levanta mais quanto mais longe.
const TRAVEL_ARC = 0.55;   // altura extra (fração de h) por metro de distância
// Subida da ponta da baqueta com h = 1, e quanto dela vem da mão (o resto é o
// giro do pulso). Medido num baterista real: nos pratos quase tudo é pulso e
// dedos; na caixa e nos tons a mão desce junto, ~40% da subida.
const TIP_MAX = 0.36;
const HAND_SHARE = { hihat: 0.05, ride: 0.05, crash: 0.25, snare: 0.4, tom1: 0.4, tom2: 0.4, floor: 0.4 };
const REACH_K = 0.6;       // quanto o tronco gira/inclina na direção das peças longe
// O corpo "quica" no pulso: o tronco desce e inclina um pouco logo depois de
// cada batida (no baterista real, a cabeça fica mais baixa a ~0,28 do tempo).
const BOUNCE = 0.007;      // m
const BOUNCE_PHASE = 0.28;
// Pé esquerdo: o calcanhar marca o pulso com a ponta parada no pedal do chimbal.
const HEEL_LIFT = 0.16;    // rad no meio do tempo
// Como o tronco se divide pelas vértebras (pelve, lombar, torácica, peito).
const YAW_SPLIT = [0.15, 0.25, 0.3, 0.3];
const LEAN_SPLIT = [0.25, 0.3, 0.3, 0.15];
const HEAD_DOWN = deg(-12); // a cabeça olha pra caixa
// Pose de golpe medida no baterista real (tools/mmip_moves.py): giro da mão em
// volta da baqueta (0 = dorso pra cima, pegada alemã; + = polegar pra cima) e
// abertura do cotovelo (+ = pra fora), em graus.
const ROLL = {
  MD: { snare: 43, hihat: 41, tom1: 46, tom2: 57, floor: 62, crash: 40, ride: 64 },
  ME: { snare: 24, hihat: 33, tom1: 31, tom2: 10, floor: 19, crash: 25, ride: 33 },
};
const SWIVEL = {
  MD: { snare: 25, hihat: 23, tom1: 18, tom2: 21, floor: 19, crash: 39, ride: 32 },
  ME: { snare: 9, hihat: 14, tom1: 10, tom2: 7, floor: 4, crash: 12, ride: 9 },
};
const HAND_TARGETS = ["snare", "hihat", "tom1", "tom2", "floor", "crash", "ride"];

/** Orientação da baqueta com direção d e giro `roll` (rad) em volta dela. */
export function stickQuat(d, roll, out = new Quaternion()) {
  const y = d.clone().normalize();
  const ups = UP.clone().addScaledVector(y, -y.y).normalize();
  const side = new Vector3().crossVectors(y, ups);
  const z = ups.multiplyScalar(Math.cos(roll)).addScaledVector(side, Math.sin(roll));
  const x = new Vector3().crossVectors(y, z);
  return out.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

export function createRig() {
  const skel = createSkeleton();
  const drive = createDrive();
  const pelvis = new Vector3(...SKEL.hips);

  // ---------- configurações de golpe ----------
  // Fulcro F0 e orientação q0 tais que F0 + d0 * stickFront = centro da
  // bolinha encostada na superfície (P + n * TIP_R).
  const configs = { MD: {}, ME: {} };
  {
    const P = new Vector3(), n = new Vector3(), hd = new Vector3();
    for (const limb of HANDS) {
      const [ax, az] = BODY.anchor[limb];
      for (const id of HAND_TARGETS) {
        contact(id, limb, P, n);
        hd.set(P.x - ax, 0, P.z - az).normalize();
        const along = hd.clone().addScaledVector(n, -hd.dot(n)).normalize();
        const beta = strikeAngle(id);
        const d0 = along.multiplyScalar(Math.cos(beta)).addScaledVector(n, -Math.sin(beta)).normalize();
        const tip = P.clone().addScaledVector(n, TIP_R);
        const F0 = tip.clone().addScaledVector(d0, -SKEL.stickFront);
        // polegar pra cima gira o dorso pra fora: pra direita na mão direita, pra esquerda na esquerda
        const q0 = stickQuat(d0, deg(ROLL[limb][id]) * (limb === "MD" ? 1 : -1));
        // mão nessa pose (a baqueta vem da mão pela pegada fixa)
        const g = skel.grip[limb];
        const hq0 = q0.clone().multiply(g.q.clone().invert());
        const hp0 = F0.clone().sub(g.f.clone().applyQuaternion(hq0));
        // H0 (antigo nome do fulcro) fica por compatibilidade
        configs[limb][id] = { P: P.clone(), n: n.clone(), tip, d0, F0, H0: F0, q0, hq0, hp0, swivel: deg(SWIVEL[limb][id]) };
      }
    }
  }

  // Compatibilidade: juntas principais com os nomes de antes.
  const arms = {}, legs = {};
  for (const limb of HANDS) {
    arms[limb] = {
      state: { a: "snare", b: "snare", w: 1, h: 0 },
      shoulder: new Vector3(), elbow: new Vector3(), wrist: new Vector3(), fulcrum: new Vector3(),
      dir: new Vector3(0, 1, 0), // direção da baqueta (do fulcro pra ponta)
      reached: true,
    };
  }
  for (const [limb, pedal] of [["PD", KICK_PEDAL], ["PE", HIHAT_PEDAL]]) {
    const foot = new Object3D(); // prancha do pedal; rotation.x = ângulo
    foot.position.set(...pedal.hinge);
    legs[limb] = { foot, rest: foot.position.clone(), hip: new Vector3(), knee: new Vector3(), ankle: new Vector3(), reached: true };
  }
  // Tronco (compatibilidade): origem na pelve, rotação do peito.
  const torso = new Object3D();
  torso.position.copy(pelvis);
  torso.rotation.order = "YXZ";

  // ---------- performance assada (perform.js) ----------
  // Com plano, cada golpe coberto usa o recorte de um baterista real: a mão sai
  // do caminho reto entre as duas poses de golpe pelo resíduo gravado (no frame
  // de rumo dela), gira pelo giro gravado e o cotovelo abre como o dele. Nas
  // pontas o resíduo é zero: a baqueta encosta exatamente na nota.
  let plan = null;
  const res = new Float32Array(8);
  const baseP = new Vector3(), baseQ = new Quaternion(), handP = new Vector3(), handQ = new Quaternion();
  const fwd = new Vector3(), back = new Vector3(), right = new Vector3(), rv = new Vector3(), dq = new Quaternion();
  const tipV = new Vector3();
  const minjerk = (u) => u * u * u * (10 - 15 * u + 6 * u * u);
  // frame de cada peça (origem no centro da superfície de golpe, y = normal)
  const pieceFrames = {};
  {
    const o = new Object3D();
    for (const id of HAND_TARGETS) {
      placeFrame(id, o);
      const r = (DRUMS[id] || CYMBALS[id]).r;
      pieceFrames[id] = { inv: o.matrix.clone().invert(), n: new Vector3(0, 1, 0).applyQuaternion(o.quaternion), r };
    }
  }
  /** Empurra a baqueta pra fora da peça se a ponta estiver dentro dela (some suave na borda). */
  function guard(st, id) {
    const f = pieceFrames[id];
    tipV.set(0, SKEL.stickFront, 0).applyQuaternion(st.quat).add(st.pos).applyMatrix4(f.inv);
    const rho = Math.hypot(tipV.x, tipV.z);
    if (rho > f.r + 0.03) return;
    const deficit = surfaceY(id, rho) + TIP_R - tipV.y;
    if (deficit <= 0) return;
    const k = rho < f.r - 0.02 ? 1 : 1 - (rho - (f.r - 0.02)) / 0.05;
    st.pos.addScaledVector(f.n, deficit * k * k * (3 - 2 * k));
  }
  /** Catmull-Rom nas amostras do recorte i, na posição s (0..N-1). */
  function sample(p, i, s) {
    const N = plan.N, C = plan.C, base = i * N * C, k = Math.min(N - 2, Math.floor(s)), f = s - k;
    const i0 = Math.max(0, k - 1), i3 = Math.min(N - 1, k + 2);
    const f2 = f * f, f3 = f2 * f;
    for (let c = 0; c < C; c++) {
      const p0 = p[base + i0 * C + c], p1 = p[base + k * C + c], p2 = p[base + (k + 1) * C + c], p3 = p[base + i3 * C + c];
      res[c] = 0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (3 * p1 - p0 - 3 * p2 + p3) * f3);
    }
  }
  function planHand(limb, i, t) {
    const p = plan.hands[limb], st = drive.stick[limb], g = skel.grip[limb];
    const t0 = p.t0[i], t1 = p.t1[i], u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    const ca = configs[limb][p.a[i]], cb = configs[limb][p.b[i]];
    const sig = minjerk(u);
    sample(p.curves, i, unwarp(u, plan.warp) * (plan.N - 1));
    baseP.lerpVectors(ca.hp0, cb.hp0, sig);
    baseQ.slerpQuaternions(ca.hq0, cb.hq0, sig);
    // frame de rumo: y pra cima, z pra trás do rumo da mão
    fwd.set(0, 1, 0).applyQuaternion(baseQ).setY(0);
    if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, -1);
    fwd.normalize();
    back.copy(fwd).negate();
    right.crossVectors(UP, back);
    handP.copy(baseP).addScaledVector(right, res[0]).addScaledVector(UP, res[1]).addScaledVector(back, res[2]);
    rv.set(res[3], res[4], res[5]);
    const ang = rv.length();
    if (ang > 1e-9) dq.setFromAxisAngle(rv.divideScalar(ang), ang); else dq.identity();
    handQ.copy(baseQ).multiply(dq);
    st.quat.copy(handQ).multiply(g.q);
    st.pos.copy(g.f).applyQuaternion(handQ).add(handP);
    // a baqueta nunca entra na peça que acabou de tocar nem na que vai tocar
    guard(st, p.a[i]);
    if (p.b[i] !== p.a[i]) guard(st, p.b[i]);
    drive.swivel[limb] = ca.swivel + (cb.swivel - ca.swivel) * sig + res[6];
    drive.clav[limb].elev = 0;
    drive.clav[limb].prot = 0;
    // os dedos apertam no golpe e soltam no meio
    const edge = Math.min(u, 1 - u) * (t1 - t0);
    drive.grip[limb] = Math.max(0, 1 - edge / 0.08);
    arms[limb].dir.set(0, 1, 0).applyQuaternion(st.quat);
  }

  // Centro da cabeça na postura de base (de onde o olhar mira os alvos).
  const headRest = new Vector3(...SKEL.hips)
    .add(new Vector3(0, SKEL.spine[1] + SKEL.spine1[1] + SKEL.chest[1] + SKEL.neck[1] + SKEL.head[1] + 0.09, 0)
      .applyAxisAngle(X_AXIS, -BODY.leanBase * 0.6));

  // ---------- pose ----------
  const tmpV = new Vector3(), tmpK = new Vector3();
  const qLift = new Quaternion();
  const lead = { a: "snare", b: "snare", w: 1, h: 0, travel: 0 };
  const reach = (limb, id) => TORSO_REACH[limb][id] || TORSO_REACH[limb].snare;

  /** Quanto a música está "rolando" agora (0..1): golpe nos últimos/próximos tempos. */
  function activity(prep, t) {
    const len = prep.clock.beatLen(t);
    let active = 0;
    for (const l of ["MD", "ME", "PD"]) {
      const hits = prep.limbs[l];
      if (!hits.length) continue;
      let lo = 0, hi = hits.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (hits[m].t < t) lo = m + 1; else hi = m; }
      const prev = hits[lo - 1], next = hits[lo];
      const d = Math.min(prev ? t - prev.t : Infinity, next ? next.t - t : Infinity);
      active = Math.max(active, 1 - Math.min(1, Math.max(0, (d - len) / len)));
    }
    return active;
  }
  /** Calcanhar esquerdo (0..1): sobe no meio de cada tempo e desce na batida. */
  function heelPulse(prep, t, active) {
    if (active <= 0) return 0;
    const ph = prep.clock.beatAt(t) % 1;
    return active * Math.pow(Math.sin(Math.PI * (ph < 0 ? ph + 1 : ph)), 2);
  }

  /** Mãos no tempo t: baquetas, cotovelos e dedos (não dependem do corpo). */
  function performHands(t, prep) {
    const limbs = prep.limbs;
    handState(limbs.MD, BODY.home.MD, t, arms.MD.state);
    handState(limbs.ME, BODY.home.ME, t, arms.ME.state);
    for (const limb of HANDS) {
      const arm = arms[limb], s = arm.state, st = drive.stick[limb];
      const ca = configs[limb][s.a] || configs[limb][BODY.home[limb]];
      const cb = configs[limb][s.b] || configs[limb][BODY.home[limb]];
      // pose base entre duas configurações de golpe
      st.pos.lerpVectors(ca.F0, cb.F0, s.w);
      st.quat.slerpQuaternions(ca.q0, cb.q0, s.w);
      const d = arm.dir.set(0, 1, 0).applyQuaternion(st.quat);
      // levantar: o fulcro sobe e recua, a baqueta gira pra cima em volta dele;
      // trocando de peça, levanta mais no meio do caminho (por cima dos aros)
      const h = s.h + TRAVEL_ARC * s.travel * ca.F0.distanceTo(cb.F0);
      if (h > 0) {
        // a ponta sobe h·TIP_MAX; parte disso é a mão subindo, o resto é o pulso girando
        const sa = HAND_SHARE[s.a] ?? 0.3, share = sa + ((HAND_SHARE[s.b] ?? 0.3) - sa) * s.w;
        const rise = h * TIP_MAX, handRise = share * rise;
        tmpV.set(d.x, 0, d.z).normalize();
        st.pos.addScaledVector(UP, handRise).addScaledVector(tmpV, -0.45 * handRise);
        const phi = Math.asin(Math.max(-1, Math.min(1, d.y)));
        const want = Math.max(-0.99, Math.min(0.99, Math.sin(phi) + (rise - handRise) / SKEL.stickFront));
        tmpK.crossVectors(d, UP).normalize();
        qLift.setFromAxisAngle(tmpK, Math.asin(want) - phi);
        st.quat.premultiply(qLift);
      }
      // chicote: o braço "puxa" a baqueta, adiantado no tempo
      handState(limbs[limb], BODY.home[limb], t + WHIP_LEAD, lead);
      const hLead = Math.min(1.2, lead.h + TRAVEL_ARC * lead.travel * 0.3);
      drive.swivel[limb] = ca.swivel + (cb.swivel - ca.swivel) * s.w + WHIP_SWIVEL * hLead;
      drive.clav[limb].elev = WHIP_CLAV * hLead;
      drive.clav[limb].prot = 0;
      drive.grip[limb] = Math.max(0, 1 - s.h * 6);
      if (plan) {
        const i = segmentAt(plan, limb, t);
        if (i >= 0) planHand(limb, i, t);
      }
    }

  }

  /**
   * Corpo no tempo t: pelve, coluna, cabeça, clavículas e pés. Com o corpo
   * assado (plan.body), os desvios vêm do baterista real (alcance, groove e
   * olhar); sem ele, o tronco gira e balança pelas regras de antes.
   */
  function performBody(t, prep, press) {
    const body = plan?.body;
    // tronco: gira e inclina na direção das peças longe; balança de leve no tempo
    let yaw = 0, lean = 0;
    for (const limb of HANDS) {
      const s = arms[limb].state, ra = reach(limb, s.a), rb = reach(limb, s.b);
      yaw += REACH_K * (ra[0] + (rb[0] - ra[0]) * s.w);
      lean += REACH_K * (ra[1] + (rb[1] - ra[1]) * s.w);
    }
    yaw = Math.max(-TORSO_LIMIT.yaw, Math.min(TORSO_LIMIT.yaw, yaw));
    lean = Math.min(TORSO_LIMIT.lean, lean);
    const active = activity(prep, t);
    const phase = prep.clock.beatAt(t) % 1;
    const pulse = active * (0.5 + 0.5 * Math.cos(2 * Math.PI * (phase - BOUNCE_PHASE)));
    const pitch = BODY.leanBase + lean + TORSO_LIMIT.bob * pulse;
    if (body) {
      applyBody(body, t, BODY.leanBase + 0.5 * lean + BODY_BOUNCE * TORSO_LIMIT.bob * pulse);
      drive.hips.pos.y -= BODY_BOUNCE * BOUNCE * pulse;
    } else {
      drive.hips.pos.set(pelvis.x, pelvis.y - BOUNCE * pulse, pelvis.z);
      drive.hips.rot.set(-pitch * LEAN_SPLIT[0], yaw * YAW_SPLIT[0], 0);
      for (let k = 0; k < 3; k++) drive.spine[k].set(-pitch * LEAN_SPLIT[k + 1], yaw * YAW_SPLIT[k + 1], 0);
      // cabeça: compensa metade do giro e da inclinação, olhando pro kit
      drive.neck.set(pitch * 0.35, -yaw * 0.25, 0);
      drive.head.set(HEAD_DOWN + pitch * 0.25, -yaw * 0.2, 0);
    }

    // pé direito: calcanhar parado no pedal, ponta desce junto com ele
    legs.PD.foot.rotation.x = pedalAngle(press);
    legs.PD.foot.updateMatrix();
    drive.foot.PD.board.copy(legs.PD.foot.matrix);
    drive.foot.PD.heel = 0;
    drive.foot.PD.lift = 0;
    // pé esquerdo: a ponta fica no pedal do chimbal e o calcanhar sobe e desce
    legs.PE.foot.rotation.x = HIHAT_PEDAL.angle;
    legs.PE.foot.updateMatrix();
    drive.foot.PE.board.copy(legs.PE.foot.matrix);
    drive.foot.PE.heel = 0;
    drive.foot.PE.lift = HEEL_LIFT * heelPulse(prep, t, active);
  }

  /** Desvios assados do corpo (8 juntas x 3 e a posição da pelve, frame do baterista) sobre a postura base. */
  const bodyD = new Float32Array(32);
  // Ganho dos desvios assados (o groove sai amostrado a 4 por tempo e perde um
  // pouco do tremor; a pelve vem um pouco menos que na roupa de sensores) e o
  // quique no pulso, que nos trechos reais aparece fraco.
  const BODY_GAIN = 1.35, PELVIS_SWAY = 0.8, BODY_BOUNCE = 0.7;
  function applyBody(body, t, pitch) {
    const C = body.channels, n = body.delta.length / C, f = Math.max(0, t * body.fps);
    const i = Math.min(n - 2, Math.floor(f)), u = Math.min(1, f - i);
    for (let c = 0; c < C; c++) bodyD[c] = BODY_GAIN * (body.delta[i * C + c] * (1 - u) + body.delta[(i + 1) * C + c] * u);
    const d = bodyD;
    drive.hips.pos.copy(pelvis);
    if (C >= 27) drive.hips.pos.add(tmpV.set(d[24], d[25], d[26]).multiplyScalar(PELVIS_SWAY));
    drive.hips.rot.set(-pitch * LEAN_SPLIT[0] + d[0], d[1], d[2]);
    for (let k = 0; k < 3; k++) drive.spine[k].set(-pitch * LEAN_SPLIT[k + 1] + d[3 + k * 3], d[4 + k * 3], d[5 + k * 3]);
    drive.neck.set(pitch * 0.35 + d[12], d[13], d[14]);
    drive.head.set(HEAD_DOWN + pitch * 0.25 + d[15], d[16], d[17]);
    // clavículas: sobe = giro em volta do eixo pra trás, vai pra frente = em volta do vertical
    drive.clav.MD.elev += d[20];
    drive.clav.MD.prot += d[19];
    drive.clav.ME.elev -= d[23];
    drive.clav.ME.prot -= d[22];
  }

  /** Decide o comando de pose no tempo t. */
  function perform(t, prep, press) {
    performHands(t, prep);
    performBody(t, prep, press);
  }

  /** Pulsos no tempo t (só as mãos; pra assar o corpo). */
  const wq = new Quaternion(), wv = new Vector3();
  function wrists(t, prep, outR, outL) {
    performHands(t, prep);
    HANDS.forEach((limb, k) => {
      const st = drive.stick[limb], g = skel.grip[limb], out = k ? outL : outR;
      wq.copy(st.quat).multiply(gInv[limb]);
      wv.copy(g.f).applyQuaternion(wq);
      out.x = st.pos.x - wv.x; out.y = st.pos.y - wv.y; out.z = st.pos.z - wv.z;
    });
  }
  const gInv = { MD: skel.grip.MD.q.clone().invert(), ME: skel.grip.ME.q.clone().invert() };

  function sync() {
    const P = skel.pos;
    for (const limb of HANDS) {
      const a = arms[limb];
      a.shoulder.copy(P[BONE[`arm.${limb}`]]);
      a.elbow.copy(P[BONE[`forearm.${limb}`]]);
      a.wrist.copy(P[BONE[`hand.${limb}`]]);
      a.fulcrum.copy(drive.stick[limb].pos);
      a.dir.set(0, 1, 0).applyQuaternion(drive.stick[limb].quat);
      a.reached = skel.reached[limb];
    }
    for (const limb of FEET) {
      const g = legs[limb];
      g.hip.copy(P[BONE[`thigh.${limb}`]]);
      g.knee.copy(P[BONE[`shin.${limb}`]]);
      g.ankle.copy(P[BONE[`foot.${limb}`]]);
      g.reached = skel.reached[limb];
    }
    torso.position.copy(P[BONE.hips]);
    torso.quaternion.copy(skel.quat[BONE.chest]);
    torso.updateMatrixWorld(true);
  }

  /** Calcula o esqueleto inteiro no tempo t. `press` = pedal do bumbo (0..1). */
  function update(t, prep, press) {
    perform(t, prep, press);
    skel.solve(drive);
    sync();
  }

  /** Centro da bolinha da baqueta no mundo (depois do update). */
  function tip(limb, out = new Vector3()) {
    const st = drive.stick[limb];
    return out.set(0, SKEL.stickFront, 0).applyQuaternion(st.quat).add(st.pos);
  }

  return {
    skel, drive, torso, arms, legs, configs, update, tip, TIP_R, X_AXIS,
    /** Performance assada (perform.js) ou null pro modelo procedural. */
    setPlan(p) { plan = p; },
    wrists, headRest,
    get plan() { return plan; },
  };
}
