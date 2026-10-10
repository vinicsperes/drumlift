// Kit do estilo pelúcia: cascos de feltro estufados nas cores das peças, peles
// creme com costura em volta do aro, pratos de feltro dourado, estantes de
// corda grossa e sombras borradas no chão. Mesmos frames e pontos de contato
// do kit do manequim (pieces.js); no golpe a pele afunda, o casco amassa e o
// prato balança molenga, voltando ao lugar antes do golpe seguinte.

import {
  Color, CylinderGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D,
  PlaneGeometry, Quaternion, SphereGeometry, TorusGeometry, Vector3,
} from "../vendor/three.module.min.js";
import { CYMBALS, DRUMS, HIHAT_PEDAL, KICK, KICK_PEDAL, THRONE } from "./layout.js";
import { beaterAngle, cymbalProfile, pedalAngle, placeFrame, standRods } from "./pieces.js";
import { INSTANCE_PIECE } from "./timeline.js";
import { flash, footPress } from "./motion.js";
import { softWobble } from "./plushmotion.js";
import { createRings, updateRings } from "./rings.js";
import { feltMaterial, setFelt } from "./felt.js";
import {
  aroundUnits, cushionProfile, ellipsoid, lathe, mergeGeos, pillow, planarUV, scaleUV, stitchGeometry,
  stitchLine, stitchMesh,
} from "./shapes.js";

const UP = new Vector3(0, 1, 0);
// Prato molenga: amplitude (rad), amortecimento (s), frequência (Hz).
const FLOP = { crash: [0.15, 0.5, 1.7], ride: [0.065, 0.42, 2.1], hihat: [0.028, 0.14, 4.2] };
const SQUASH = { tau: 0.07, freq: 5.5, dip: 0.007 }; // dip: quanto a pele desce (m) num golpe forte
const CYM_T = 0.009; // espessura do prato de feltro

// Altura da face de cima do prato: cúpula suave até ρ = 0.07 e depois o mesmo
// arco reto do perfil lógico, onde as baquetas encostam.
function cymbalTop(r, rho) {
  const prof = cymbalProfile(r), [r3, y3] = prof[3], [r4, y4] = prof[4];
  if (rho >= r3) return y3 + ((rho - r3) / (r4 - r3)) * (y4 - y3);
  const u = rho / r3;
  return y3 + (prof[0][1] - y3) * Math.pow(0.5 + 0.5 * Math.cos(Math.PI * u), 1.15);
}

function cymbalBodyProfile(r) {
  // de baixo pra cima: centro de baixo -> borda -> volta por cima até o centro
  const pts = [], n = 10;
  const rhoAt = (k) => r * Math.pow(k / n, 0.85);
  for (let k = 0; k <= n; k++) { const rho = rhoAt(k) * 0.985; pts.push([rho, cymbalTop(r, rho) - CYM_T]); }
  const [re, ye] = [r * 0.985, cymbalTop(r, r * 0.985)];
  for (let k = 1; k < 4; k++) {
    const a = -Math.PI / 2 + (k / 4) * Math.PI;
    pts.push([re + (CYM_T / 2) * Math.cos(a), ye - CYM_T / 2 + (CYM_T / 2) * Math.sin(a)]);
  }
  for (let k = n; k >= 0; k--) { const rho = rhoAt(k) * 0.985; pts.push([rho, cymbalTop(r, rho)]); }
  pts[0][0] = 0;
  pts[pts.length - 1][0] = 0;
  return pts;
}

export function createPlushKit(tex) {
  const group = new Group();
  group.name = "kit-pelucia";
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };

  const ropeMat = keep(feltMaterial(tex, { map: tex.rope, sheenMix: 0.4, normalScale: 0.9 }));
  ropeMat.normalMap = tex.ropeNormal;
  const padMat = keep(feltMaterial(tex, { sheenMix: 0.35 }));
  const seatMat = keep(feltMaterial(tex, { sheenMix: 0.4 }));
  const ballMat = keep(feltMaterial(tex, { sheenMix: 0.3 }));
  const threadMat = keep(new MeshStandardMaterial({ roughness: 0.85 }));
  const stitchGeo = keep(stitchGeometry());
  const frameOf = (id) => { const f = placeFrame(id, new Group()); group.add(f); return f; };
  const inst = {};

  // costura em volta de um círculo no plano y = h (no espaço de quem a recebe)
  function ringStitches(r, y, out = []) {
    return stitchLine((s, P, N) => {
      const a = s * Math.PI * 2;
      P.set(r * Math.cos(a), y, r * Math.sin(a));
      N.set(0, 1, 0);
      return P;
    }, 2 * Math.PI * r, out, { closed: true });
  }

  // ---------- tambores ----------
  function drumHeadGeo(r) {
    const g = lathe([[r * 0.975, -0.009], [r * 0.958, -0.0025], [r * 0.92, 0.0004], [r * 0.5, 0.0006], [0, 0.0006]], 48);
    return planarUV(g, 0, 2);
  }
  function hoopGeo(r, tube) {
    const g = new TorusGeometry(r, tube, 6, 36);
    scaleUV(g, aroundUnits(2 * Math.PI * r), aroundUnits(2 * Math.PI * tube));
    g.rotateX(Math.PI / 2);
    return g;
  }
  for (const [id, d] of Object.entries(DRUMS)) {
    const frame = frameOf(id);
    const shellMat = keep(feltMaterial(tex, { sheenMix: 0.45 }));
    const headMat = keep(feltMaterial(tex, { sheenMix: 0.3 }));
    const hoopMat = keep(feltMaterial(tex, { sheenMix: 0.45 }));
    const squash = new Group(); // apoiado no fundo: no golpe o topo desce
    squash.position.y = -d.depth;
    frame.add(squash);
    const body = new Group();
    body.position.y = d.depth;
    squash.add(body);
    body.add(new Mesh(keep(lathe(cushionProfile(d.r + 0.006, -d.depth - 0.004, -0.006, 5, 18), 40)), shellMat));
    const head = new Mesh(keep(drumHeadGeo(d.r)), headMat);
    body.add(head);
    head.add(keep(stitchMesh(stitchGeo, threadMat, ringStitches(d.r * 0.86, 0.0006))));
    const hg = keep(hoopGeo(d.r * 0.99, 0.0135));
    const top = new Mesh(hg, hoopMat);
    top.position.y = 0.0008;
    // debrum de baixo encostado na curva do casco (não fica boiando)
    const bottom = new Mesh(keep(hoopGeo(d.r + 0.004, 0.01)), hoopMat);
    bottom.position.y = -d.depth + 0.014;
    body.add(top, bottom);
    inst[id] = {
      id, kind: "drum", piece: INSTANCE_PIECE[id], frame, squash, head, depth: d.depth,
      shellMat, headMat, hoopMat, rings: createRings(frame, d.r, 0.016, keep),
    };
  }

  // ---------- bumbo ----------
  {
    const frame = frameOf("kick"); // y local = pro baterista
    const shellMat = keep(feltMaterial(tex, { sheenMix: 0.45 }));
    const headMat = keep(feltMaterial(tex, { sheenMix: 0.3 }));
    const hoopMat = keep(feltMaterial(tex, { sheenMix: 0.45 }));
    const squash = new Group(); // apoiado na pele da frente: no golpe a de trás afunda
    squash.position.y = -KICK.depth;
    frame.add(squash);
    const body = new Group();
    body.position.y = KICK.depth;
    squash.add(body);
    body.add(new Mesh(keep(lathe(cushionProfile(KICK.r + 0.01, -KICK.depth + 0.002, -0.002, 7, 20), 44)), shellMat));
    const hg = keep(drumHeadGeo(KICK.r));
    const batter = new Mesh(hg, headMat);
    batter.add(keep(stitchMesh(stitchGeo, threadMat, ringStitches(KICK.r * 0.88, 0.0006))));
    const reso = new Mesh(hg, headMat);
    reso.rotation.x = Math.PI;
    reso.position.y = -KICK.depth;
    reso.add(keep(stitchMesh(stitchGeo, threadMat, ringStitches(KICK.r * 0.88, 0.0006))));
    body.add(batter, reso);
    const kh = keep(hoopGeo(KICK.r * 0.995, 0.02));
    for (const y of [0.002, -KICK.depth - 0.002]) {
      const h = new Mesh(kh, hoopMat);
      h.position.y = y;
      body.add(h);
    }
    // patinha na pele da frente (pra quem olha de frente): almofada + 4 dedos
    const paw = [];
    const add = (x, z, rx, rz) => {
      const g = ellipsoid(rx, 0.006, rz, { w: 20, h: 8 });
      g.translate(x, 0, z);
      paw.push(g);
    };
    add(0, 0.045, 0.072, 0.058);
    for (const [x, z, s] of [[-0.085, -0.03, 0.026], [-0.032, -0.075, 0.028], [0.032, -0.075, 0.028], [0.085, -0.03, 0.026]]) {
      add(x, z, s, s * 1.15);
    }
    const logo = new Mesh(keep(mergeGeos(paw)), hoopMat);
    logo.position.set(0, 0.002, 0);
    reso.add(logo);
    inst.kick = {
      id: "kick", kind: "kick", piece: "kick", frame, squash, head: batter, depth: KICK.depth,
      shellMat, headMat, hoopMat, rings: createRings(frame, KICK.r, 0.032, keep),
    };
  }

  // ---------- pratos ----------
  for (const [id, c] of Object.entries(CYMBALS)) {
    const frame = frameOf(id);
    const pivot = new Group(); // balanço
    frame.add(pivot);
    const flop = new Group();  // borda molenga (escala em y)
    pivot.add(flop);
    const bodyMat = keep(feltMaterial(tex, { sheenMix: 0.55, sheenRoughness: 0.4 }));
    const accentMat = keep(feltMaterial(tex, { sheenMix: 0.45 }));
    const bodyGeo = keep(lathe(cymbalBodyProfile(c.r), 40));
    planarUV(bodyGeo, 0, 2);
    flop.add(new Mesh(bodyGeo, bodyMat));
    // cúpula e borda na cor da peça
    const bell = [];
    for (let k = 0; k <= 8; k++) {
      const rho = 0.058 * (1 - k / 8);
      bell.push([rho, cymbalTop(c.r, rho) + 0.0016 - (k === 0 ? 0.003 : 0)]);
    }
    bell[bell.length - 1][0] = 0;
    flop.add(new Mesh(keep(planarUV(lathe(bell, 32), 0, 2)), accentMat));
    const edge = new Mesh(keep(hoopGeo(c.r * 0.985, 0.0068)), accentMat);
    edge.position.y = cymbalTop(c.r, c.r) - CYM_T / 2;
    flop.add(edge);
    const rs = c.r - 0.032;
    flop.add(keep(stitchMesh(stitchGeo, threadMat, ringStitches(rs, cymbalTop(c.r, rs) + 0.0003))));
    if (id === "hihat") {
      const bottom = new Mesh(bodyGeo, bodyMat);
      bottom.rotation.x = Math.PI;
      bottom.position.y = -0.03;
      pivot.add(bottom);
    }
    inst[id] = {
      id, kind: "cymbal", piece: INSTANCE_PIECE[id], frame, pivot, flop, bodyMat, accentMat,
      rings: createRings(frame, c.r, 0.006, keep),
    };
  }

  // ---------- estantes de corda ----------
  {
    const parts = [], f = new Object3D(), a = new Vector3(), b = new Vector3(), q = new Quaternion();
    const m = new Matrix4(), s = new Vector3();
    for (const rod of standRods()) {
      a.set(...rod.a); b.set(...rod.b);
      if (rod.frame) { placeFrame(rod.frame, f); a.applyMatrix4(f.matrix); b.applyMatrix4(f.matrix); }
      const r = Math.max(0.0075, rod.r * 1.55), len = a.distanceTo(b);
      const g = ropeGeometry(r, len);
      q.setFromUnitVectors(UP, s.subVectors(b, a).normalize());
      m.compose(a.clone().add(b).multiplyScalar(0.5), q, new Vector3(1, 1, 1));
      g.applyMatrix4(m);
      parts.push(g);
      if (rod.foot) {
        const knot = new SphereGeometry(r * 1.9, 10, 6);
        scaleUV(knot, 1, 0.6);
        knot.translate(b.x, Math.max(r * 1.9 * 0.8, b.y), b.z);
        parts.push(knot);
      }
    }
    group.add(new Mesh(keep(mergeGeos(parts)), ropeMat));
  }

  // ---------- pedal do bumbo ----------
  const P = KICK_PEDAL;
  const kickBoard = new Group();
  kickBoard.position.set(...P.hinge);
  group.add(kickBoard);
  {
    const g = keep(pillow(0.088, 0.022, P.length, 4));
    g.translate(0, 0.011, -P.length / 2);
    kickBoard.add(new Mesh(g, padMat));
    const plate = new Mesh(keep(pillow(0.115, 0.014, 0.36, 4)), padMat);
    plate.position.set(P.hinge[0], 0.007, P.hinge[2] - 0.17);
    group.add(plate);
  }
  const beater = new Group();
  beater.position.set(...P.beaterPivot);
  group.add(beater);
  {
    const g = keep(ropeGeometry(0.0065, P.beaterLen));
    g.translate(0, P.beaterLen / 2, 0);
    beater.add(new Mesh(g, ropeMat));
  }
  const felt = new Mesh(keep(ellipsoid(P.feltR, P.feltR, P.feltR, { w: 20, h: 14 })), ballMat);
  felt.position.y = P.beaterLen;
  beater.add(felt);

  // ---------- pedal do chimbal ----------
  {
    const H = HIHAT_PEDAL;
    const g = keep(pillow(0.084, 0.022, H.length, 4));
    g.translate(0, 0.011, -H.length / 2);
    const board = new Mesh(g, padMat);
    board.position.set(...H.hinge);
    board.rotation.x = H.angle;
    group.add(board);
  }

  // ---------- banco: almofada redonda com botão e costura ----------
  {
    const top = THRONE.pos[1], r = THRONE.r + 0.025, y0 = top - 0.1;
    const cushion = new Mesh(keep(lathe(cushionProfile(r, y0, top, 3.2, 18), 40)), seatMat);
    cushion.position.set(THRONE.pos[0], 0, THRONE.pos[2]);
    group.add(cushion);
    const mid = (y0 + top) / 2;
    cushion.add(keep(stitchMesh(stitchGeo, threadMat, stitchLine((s, Pt, N) => {
      const a = s * Math.PI * 2;
      N.set(Math.cos(a), 0, Math.sin(a));
      return Pt.set(r * Math.cos(a), mid, r * Math.sin(a)).addScaledVector(N, 0.0005);
    }, 2 * Math.PI * r, [], { closed: true }))));
  }

  // ---------- sombras borradas no chão ----------
  const shadowGeo = keep(new PlaneGeometry(1, 1));
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowSoft = keep(new MeshBasicMaterial({ map: tex.radial, transparent: true, depthWrite: false, toneMapped: false }));
  const shadowHard = keep(new MeshBasicMaterial({ map: tex.radial, transparent: true, depthWrite: false, toneMapped: false }));
  function shadows(mat, list, y) {
    const m = new InstancedMesh(shadowGeo, mat, list.length), M = new Matrix4();
    list.forEach(([x, z, sx, sz], i) => m.setMatrixAt(i, M.makeScale(sx, 1, sz).setPosition(x, y + i * 0.0001, z)));
    m.computeBoundingSphere();
    m.renderOrder = -1;
    group.add(m);
    return keep(m);
  }
  const cymFoot = (id) => { const f = placeFrame(id, new Object3D()); return [f.position.x, f.position.z]; };
  shadows(shadowSoft, [[0.08, -0.22, 2.7, 2.3], [0.02, 0.2, 1.2, 1.1]], 0.001);
  shadows(shadowHard, [
    [THRONE.pos[0], THRONE.pos[2] + 0.02, 0.78, 0.74],
    [KICK.pos[0], KICK.pos[2] - KICK.depth / 2, 0.82, 0.62],
    [DRUMS.floor.pos[0], DRUMS.floor.pos[2], 0.6, 0.6],
    [DRUMS.snare.pos[0], DRUMS.snare.pos[2], 0.5, 0.5],
    [...cymFoot("hihat"), 0.5, 0.5], [...cymFoot("crash"), 0.55, 0.55], [...cymFoot("ride"), 0.58, 0.58],
    [P.hinge[0], P.hinge[2] - 0.14, 0.28, 0.5], [HIHAT_PEDAL.hinge[0], HIHAT_PEDAL.hinge[2] - 0.12, 0.26, 0.45],
  ], 0.0016);

  group.updateMatrixWorld(true);

  // ---------- cores ----------
  const colors = { piece: {}, accent: {}, head: new Color(), bg: new Color(), gold: new Color() };
  const tmpC = new Color();
  let muted = new Set();
  function paint(theme) {
    setFelt(ropeMat, theme.rope);
    setFelt(padMat, theme.pad);
    setFelt(seatMat, theme.seat);
    setFelt(ballMat, theme.head);
    threadMat.color.set(theme.thread);
    shadowSoft.color.set(theme.shadow);
    shadowHard.color.set(theme.shadow);
    shadowSoft.opacity = theme.shadowSoft;
    shadowHard.opacity = theme.shadowHard;
    colors.head.set(theme.head);
    colors.bg.set(theme.bg);
    colors.gold.set(theme.gold);
    for (const [k, v] of Object.entries(theme.piece)) colors.piece[k] = new Color(v);
    for (const [k, v] of Object.entries(theme.accent)) colors.accent[k] = new Color(v);
    applyMuted();
  }
  function applyMuted() {
    for (const it of Object.values(inst)) {
      const c = colors.piece[it.piece];
      if (!c) continue;
      const m = muted.has(it.piece);
      for (const r of it.rings) r.material.color.copy(c);
      if (it.kind === "cymbal") {
        setFelt(it.bodyMat, tmpC.copy(colors.gold).lerp(colors.bg, m ? 0.6 : 0));
        setFelt(it.accentMat, tmpC.copy(colors.accent[it.piece]).lerp(colors.bg, m ? 0.78 : 0));
      } else {
        setFelt(it.shellMat, tmpC.copy(c).lerp(colors.bg, m ? 0.78 : 0));
        setFelt(it.hoopMat, tmpC.copy(c).multiplyScalar(0.8).lerp(colors.bg, m ? 0.78 : 0));
        setFelt(it.headMat, tmpC.copy(colors.head).lerp(colors.bg, m ? 0.7 : 0));
      }
    }
  }

  // ---------- animação ----------
  function update(t, prep, anticipation) {
    for (const it of Object.values(inst)) {
      const hits = prep.instHits[it.id] || [];
      const c = colors.piece[it.piece];
      const isMuted = muted.has(it.piece);
      const f = isMuted ? 0 : flash(hits, t);
      if (it.kind === "cymbal") {
        it.bodyMat.emissive.copy(c).multiplyScalar(0.22 * f);
        it.accentMat.emissive.copy(c).multiplyScalar(0.3 * f);
        const [amp, tau, freq] = FLOP[it.id];
        it.pivot.rotation.x = softWobble(hits, t, amp, tau, freq, 0.14);
        it.flop.scale.y = 1 + softWobble(hits, t, 0.45, tau * 0.6, freq * 2.2, 0.1);
      } else {
        if (!isMuted) it.headMat.color.copy(colors.head).lerp(c, 0.35 * f);
        it.headMat.emissive.copy(c).multiplyScalar(0.2 * f);
        // pele afunda e casco amassa (squash and stretch), parado de novo no próximo golpe
        const q = softWobble(hits, t, 1, SQUASH.tau, SQUASH.freq, 0.1);
        const k = (SQUASH.dip / it.depth) * q;
        it.squash.scale.set(1 + 0.6 * k, 1 - k, 1 + 0.6 * k);
        it.head.position.y = -0.003 * Math.max(0, q);
      }
      updateRings(it.rings, hits, t, prep.clock, anticipation && !isMuted);
    }
    const p = footPress(prep.limbs.PD, t);
    kickBoard.rotation.x = pedalAngle(p);
    beater.rotation.x = beaterAngle(p);
    return p;
  }

  function setMuted(set) { muted = new Set(set || []); applyMuted(); }

  /** Debug: distância (m) da frente do batedor até a pele do bumbo. */
  function beaterGap() {
    beater.updateMatrixWorld(true);
    const w = felt.getWorldPosition(new Vector3());
    return w.z - P.feltR - KICK.pos[2];
  }
  /** Debug: quanto a superfície da peça está fora do lugar agora (m ou rad). */
  function deform(id) {
    const it = inst[id];
    if (it.kind === "cymbal") return Math.abs(it.pivot.rotation.x) + Math.abs(it.flop.scale.y - 1) * 0.02;
    return Math.abs(it.depth * (1 - it.squash.scale.y)) + Math.abs(it.head.position.y);
  }

  return {
    group, inst, update, paint, setMuted, beaterGap, deform,
    dispose() { for (const d of disposables) d.dispose(); },
  };
}

// Cilindro aberto com UV de corda: uma volta da textura em u, hélice a ~50°.
function ropeGeometry(r, len) {
  const g = new CylinderGeometry(r, r, len, 8, Math.max(1, Math.round(len / 0.09)), true);
  return scaleUV(g, 1, len / (0.56 * 2 * Math.PI * r));
}
