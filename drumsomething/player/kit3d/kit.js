// Kit procedural: cilindros, discos e tubos, nada baixado. Cada peça tem um
// "frame" no centro da superfície de golpe (y = normal da pele, z = lado do
// baterista), usado pra posicionar a pele, os anéis e os pontos de contato.

import {
  CircleGeometry, Color, CylinderGeometry, DoubleSide, Group, LatheGeometry,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, BoxGeometry, Quaternion,
  RingGeometry, TorusGeometry, Vector2, Vector3,
} from "../vendor/three.module.min.js";
import {
  CONTACTS, CYMBALS, DRUMS, HIHAT_PEDAL, KICK, KICK_PEDAL, STRIKE_ANGLE, THRONE,
} from "./layout.js";
import { INSTANCE_PIECE, upperBound } from "./timeline.js";
import { flash, footPress, wobble } from "./motion.js";

const UP = new Vector3(0, 1, 0);
const RINGS_PER_PIECE = 4;
// Balanço dos pratos: amplitude (rad), amortecimento (s), frequência (Hz).
const WOBBLE = { crash: [0.11, 0.6, 2.1], ride: [0.045, 0.5, 2.6], hihat: [0.018, 0.12, 6] };

// Perfil do prato (raio, altura) como fração do raio: cúpula + arco.
function cymbalProfile(r) {
  return [[0, 0.03], [0.032, 0.028], [0.05, 0.016], [0.07, 0.007], [r, -0.012]];
}
function profileHeight(profile, rho) {
  for (let i = 1; i < profile.length; i++) {
    const [r0, y0] = profile[i - 1], [r1, y1] = profile[i];
    if (rho <= r1) return y0 + ((rho - r0) / (r1 - r0)) * (y1 - y0);
  }
  return profile[profile.length - 1][1];
}

export function createKit() {
  const group = new Group();
  group.name = "kit";
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };

  const chrome = keep(new MeshLambertMaterial());
  const dark = keep(new MeshLambertMaterial());
  const seat = keep(new MeshLambertMaterial());
  const floorMat = keep(new MeshLambertMaterial());
  const rodGeo = keep(new CylinderGeometry(1, 1, 1, 8, 1));

  const tmpA = new Vector3(), tmpB = new Vector3(), tmpS = new Vector3();
  const tmpQ = new Quaternion(), tmpM = new Matrix4();

  // Tubos de cromo. Os parados viram uma InstancedMesh só (um draw call pra
  // todas as estantes); `dynamic` é pra peça que se mexe, como o batedor.
  const rodMatrices = [];
  function rod(parent, a, b, r, dynamic = false) {
    tmpA.set(...a); tmpB.set(...b);
    const len = tmpA.distanceTo(tmpB);
    const pos = tmpA.clone().add(tmpB).multiplyScalar(0.5);
    tmpQ.setFromUnitVectors(UP, tmpB.sub(tmpA).normalize());
    tmpS.set(r, len, r);
    if (dynamic) {
      const m = new Mesh(rodGeo, chrome);
      m.position.copy(pos);
      m.quaternion.copy(tmpQ);
      m.scale.copy(tmpS);
      parent.add(m);
      return;
    }
    tmpM.compose(pos, tmpQ, tmpS);
    if (parent !== group) { parent.updateMatrix(); tmpM.premultiply(parent.matrix); }
    rodMatrices.push(tmpM.clone());
  }
  function tripod(parent, x, z, top, spread = 0.2, r = 0.008) {
    rod(parent, [x, 0.2, z], [x, top, z], r);
    for (let k = 0; k < 3; k++) {
      const ang = Math.PI / 2 + (k * 2 * Math.PI) / 3;
      rod(parent, [x, 0.22, z], [x + Math.cos(ang) * spread, 0.005, z - Math.sin(ang) * spread], r * 0.8);
    }
  }
  function frameAt(spec) {
    const f = new Group();
    f.position.set(...spec.pos);
    f.rotation.set(spec.tilt || 0, 0, spec.roll || 0);
    group.add(f);
    return f;
  }

  const inst = {};
  function addRings(id, parent, r, y) {
    const geo = keep(new RingGeometry(r * 0.93, r, 48, 1));
    geo.rotateX(-Math.PI / 2);
    const rings = [];
    for (let k = 0; k < RINGS_PER_PIECE; k++) {
      const mat = keep(new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide }));
      const m = new Mesh(geo, mat);
      m.position.y = y;
      m.visible = false;
      m.renderOrder = 2;
      parent.add(m);
      rings.push(m);
    }
    inst[id].rings = rings;
  }

  // ---------- tambores ----------
  for (const [id, d] of Object.entries(DRUMS)) {
    const frame = frameAt(d);
    const shellMat = keep(new MeshLambertMaterial());
    const headMat = keep(new MeshLambertMaterial());
    const shellGeo = keep(new CylinderGeometry(d.r, d.r, d.depth, 32, 1, true));
    const shell = new Mesh(shellGeo, shellMat);
    shell.position.y = -d.depth / 2;
    frame.add(shell);
    const headGeo = keep(new CircleGeometry(d.r * 0.985, 32));
    headGeo.rotateX(-Math.PI / 2);
    const head = new Mesh(headGeo, headMat);
    head.position.y = 0.001;
    frame.add(head);
    const bottom = new Mesh(headGeo, shellMat);
    bottom.rotation.x = Math.PI;
    bottom.position.y = -d.depth;
    frame.add(bottom);
    const hoopGeo = keep(new TorusGeometry(d.r, 0.009, 6, 36));
    hoopGeo.rotateX(Math.PI / 2);
    for (const y of [0.004, -d.depth]) {
      const hoop = new Mesh(hoopGeo, chrome);
      hoop.position.y = y;
      frame.add(hoop);
    }
    inst[id] = { id, kind: "drum", piece: INSTANCE_PIECE[id], frame, r: d.r, shellMat, headMat, surfaceY: () => 0 };
    addRings(id, frame, d.r, 0.014);
  }

  // estantes e suportes dos tambores
  const sn = DRUMS.snare.pos;
  tripod(group, sn[0], sn[2], sn[1] - DRUMS.snare.depth - 0.01, 0.2);
  const fl = DRUMS.floor;
  for (let k = 0; k < 3; k++) {
    const ang = -Math.PI / 6 + (k * 2 * Math.PI) / 3;
    const x = fl.pos[0] + Math.cos(ang) * (fl.r + 0.03), z = fl.pos[2] - Math.sin(ang) * (fl.r + 0.03);
    rod(group, [x, fl.pos[1] - 0.06, z], [x + Math.cos(ang) * 0.05, 0.005, z - Math.sin(ang) * 0.05], 0.007);
  }
  const holderTop = [0.12, 0.72, -0.66];
  rod(group, [0.12, 0.55, -0.66], holderTop, 0.011);
  for (const id of ["tom1", "tom2"]) {
    const f = inst[id].frame;
    f.updateMatrix();
    const p = new Vector3(0, -DRUMS[id].depth * 0.55, 0).applyMatrix4(f.matrix);
    rod(group, holderTop, [p.x, p.y, p.z], 0.009);
  }

  // ---------- pratos ----------
  for (const [id, c] of Object.entries(CYMBALS)) {
    const frame = frameAt(c);
    const pivot = new Group();
    frame.add(pivot);
    const profile = cymbalProfile(c.r);
    const mat = keep(new MeshLambertMaterial({ side: DoubleSide }));
    const geo = keep(new LatheGeometry(profile.map(([x, y]) => new Vector2(x, y)), 36));
    const top = new Mesh(geo, mat);
    pivot.add(top);
    if (id === "hihat") {
      const bottom = new Mesh(geo, mat);
      bottom.rotation.x = Math.PI;
      bottom.position.y = -0.03;
      pivot.add(bottom);
      rod(frame, [0, 0.03, 0], [0, 0.12, 0], 0.004);
    }
    // haste da estante, na vertical, até logo abaixo da cúpula
    frame.updateMatrix();
    const under = new Vector3(0, -0.035, 0).applyMatrix4(frame.matrix);
    tripod(group, under.x, under.z, under.y, id === "hihat" ? 0.2 : 0.24);
    inst[id] = {
      id, kind: "cymbal", piece: INSTANCE_PIECE[id], frame, pivot, r: c.r, shellMat: mat, headMat: null,
      surfaceY: (rho) => profileHeight(profile, rho),
    };
    addRings(id, frame, c.r, 0.004);
  }
  rod(inst.hihat.frame, [0, -0.03, 0], [0, -0.035, 0], 0.004);

  // ---------- bumbo ----------
  {
    const frame = new Group();
    frame.position.set(...KICK.pos);
    frame.rotation.x = Math.PI / 2; // y local = pro baterista
    group.add(frame);
    const shellMat = keep(new MeshLambertMaterial());
    const headMat = keep(new MeshLambertMaterial());
    const shellGeo = keep(new CylinderGeometry(KICK.r, KICK.r, KICK.depth, 36, 1, true));
    const shell = new Mesh(shellGeo, shellMat);
    shell.position.y = -KICK.depth / 2;
    frame.add(shell);
    const headGeo = keep(new CircleGeometry(KICK.r * 0.985, 36));
    headGeo.rotateX(-Math.PI / 2);
    const batter = new Mesh(headGeo, headMat);
    batter.position.y = 0.001;
    frame.add(batter);
    const reso = new Mesh(headGeo, headMat);
    reso.rotation.x = Math.PI;
    reso.position.y = -KICK.depth - 0.001;
    frame.add(reso);
    const portGeo = keep(new CircleGeometry(0.055, 20));
    portGeo.rotateX(Math.PI / 2);
    const port = new Mesh(portGeo, dark);
    port.position.set(0.11, -KICK.depth - 0.003, 0.1);
    frame.add(port);
    const hoopGeo = keep(new TorusGeometry(KICK.r + 0.004, 0.016, 6, 40));
    hoopGeo.rotateX(Math.PI / 2);
    for (const y of [0.006, -KICK.depth - 0.006]) {
      const hoop = new Mesh(hoopGeo, shellMat);
      hoop.position.y = y;
      frame.add(hoop);
    }
    const [kx, ky, kz] = KICK.pos, zMid = kz - KICK.depth * 0.75;
    rod(group, [kx - KICK.r * 0.8, ky - 0.05, zMid], [kx - KICK.r - 0.12, 0.005, zMid + 0.06], 0.008);
    rod(group, [kx + KICK.r * 0.8, ky - 0.05, zMid], [kx + KICK.r + 0.12, 0.005, zMid + 0.06], 0.008);
    inst.kick = { id: "kick", kind: "kick", piece: "kick", frame, r: KICK.r, shellMat, headMat, surfaceY: () => 0 };
    addRings("kick", frame, KICK.r, 0.03);
  }

  // ---------- pedal do bumbo ----------
  const P = KICK_PEDAL;
  const pedalGeo = keep(new BoxGeometry(0.085, 0.012, P.length));
  pedalGeo.translate(0, 0.006, -P.length / 2);
  const kickBoard = new Group();
  kickBoard.position.set(...P.hinge);
  kickBoard.add(new Mesh(pedalGeo, dark));
  group.add(kickBoard);
  const plate = new Mesh(keep(new BoxGeometry(0.11, 0.008, 0.36)), chrome);
  plate.position.set(P.hinge[0], 0.004, P.hinge[2] - 0.17);
  group.add(plate);
  for (const dx of [-0.055, 0.055]) {
    rod(group, [P.beaterPivot[0] + dx, 0.008, P.beaterPivot[2]], [P.beaterPivot[0] + dx, P.beaterPivot[1], P.beaterPivot[2]], 0.006);
  }
  rod(group, [P.beaterPivot[0] - 0.055, P.beaterPivot[1], P.beaterPivot[2]],
    [P.beaterPivot[0] + 0.055, P.beaterPivot[1], P.beaterPivot[2]], 0.005);
  const beater = new Group();
  beater.position.set(...P.beaterPivot);
  group.add(beater);
  rod(beater, [0, 0, 0], [0, P.beaterLen, 0], 0.004, true);
  const felt = new Mesh(keep(new CylinderGeometry(P.feltR, P.feltR, 0.05, 16)), dark);
  felt.rotation.z = Math.PI / 2;
  felt.position.y = P.beaterLen;
  beater.add(felt);
  // ângulo do batedor encostado na pele
  const beaterContact = Math.asin((KICK.pos[2] + P.feltR - P.beaterPivot[2]) / P.beaterLen);

  // ---------- pedal do chimbal ----------
  const H = HIHAT_PEDAL;
  const hhGeo = keep(new BoxGeometry(0.08, 0.012, H.length));
  hhGeo.translate(0, 0.006, -H.length / 2);
  const hhBoard = new Mesh(hhGeo, dark);
  hhBoard.position.set(...H.hinge);
  hhBoard.rotation.x = H.angle;
  group.add(hhBoard);
  const hh = CYMBALS.hihat.pos;
  rod(group, [H.hinge[0], 0.008, H.hinge[2] - H.length], [hh[0], 0.03, hh[2]], 0.006);

  // ---------- banco e tapete ----------
  const seatMesh = new Mesh(keep(new CylinderGeometry(THRONE.r, THRONE.r * 0.95, 0.08, 24)), seat);
  seatMesh.position.set(THRONE.pos[0], THRONE.pos[1] - 0.04, THRONE.pos[2]);
  group.add(seatMesh);
  tripod(group, THRONE.pos[0], THRONE.pos[2], THRONE.pos[1] - 0.08, 0.22, 0.012);
  const rugGeo = keep(new CircleGeometry(1.45, 48));
  rugGeo.rotateX(-Math.PI / 2);
  const rug = new Mesh(rugGeo, floorMat);
  rug.position.set(0.1, 0, -0.3);
  group.add(rug);

  const rods = new InstancedMesh(rodGeo, chrome, rodMatrices.length);
  rodMatrices.forEach((m, i) => rods.setMatrixAt(i, m));
  rods.computeBoundingSphere();
  group.add(rods);
  keep(rods); // InstancedMesh.dispose() libera o buffer das instâncias

  group.updateMatrixWorld(true);

  // ---------- cores ----------
  const colors = { piece: {}, head: new Color(), bg: new Color() };
  let muted = new Set();
  function paint(theme) {
    chrome.color.set(theme.chrome);
    dark.color.set(theme.face);
    seat.color.set(theme.seat);
    floorMat.color.set(theme.floor);
    colors.head.set(theme.head);
    colors.bg.set(theme.bg);
    for (const [k, v] of Object.entries(theme.piece)) colors.piece[k] = new Color(v);
    applyMuted();
  }
  function applyMuted() {
    for (const it of Object.values(inst)) {
      const c = colors.piece[it.piece];
      if (!c) continue;
      const m = muted.has(it.piece);
      it.shellMat.color.copy(c).lerp(colors.bg, m ? 0.78 : 0);
      if (it.headMat) it.headMat.color.copy(colors.head).lerp(colors.bg, m ? 0.7 : 0);
      for (const ring of it.rings) ring.material.color.copy(c);
    }
  }

  // ---------- contato ----------
  /** Ponto de contato e normal da superfície (mundo) pra mão `limb` na peça `id`. */
  function contact(id, limb, outP, outN) {
    const it = inst[id], [x, z] = CONTACTS[id][limb];
    outP.set(x, it.surfaceY(Math.hypot(x, z)), z);
    it.frame.localToWorld(outP);
    it.frame.getWorldQuaternion(tmpQ);
    outN.copy(UP).applyQuaternion(tmpQ);
    return it;
  }
  const strikeAngle = (id) => (inst[id].kind === "cymbal" ? STRIKE_ANGLE.cymbal : STRIKE_ANGLE.drum);

  // ---------- animação ----------
  function pedalAngle(p) { return P.restAngle + (P.pressAngle - P.restAngle) * p; }

  /** Atualiza reações no tempo t. */
  function update(t, prep, anticipation) {
    for (const it of Object.values(inst)) {
      const hits = prep.instHits[it.id] || [];
      const c = colors.piece[it.piece];
      const isMuted = muted.has(it.piece);
      const f = isMuted ? 0 : flash(hits, t);
      if (it.headMat) {
        it.headMat.color.copy(colors.head).lerp(isMuted ? colors.bg : c, isMuted ? 0.7 : 0.6 * f);
        it.headMat.emissive.copy(c).multiplyScalar(0.45 * f);
      } else {
        it.shellMat.emissive.copy(c).multiplyScalar(0.5 * f);
      }
      if (it.pivot) {
        const [amp, tau, freq] = WOBBLE[it.id];
        it.pivot.rotation.x = wobble(hits, t, amp, tau, freq);
      }
      // anel de antecipação: encolhe até o tamanho da peça no instante do golpe
      let shown = 0;
      if (anticipation && !isMuted) {
        const len = prep.clock.beatLen(t);
        for (let j = upperBound(hits, t); j < hits.length && shown < RINGS_PER_PIECE; j++) {
          const dt = hits[j].t - t;
          if (dt > len) break;
          const ring = it.rings[shown++], u = dt / len;
          ring.visible = true;
          ring.scale.setScalar(1 + 1.4 * u);
          ring.material.opacity = 0.9 * (1 - u) + 0.08;
        }
      }
      for (let k = shown; k < it.rings.length; k++) it.rings[k].visible = false;
    }
    const p = footPress(prep.limbs.PD, t);
    kickBoard.rotation.x = pedalAngle(p);
    beater.rotation.x = beaterContact + (1 - p) * P.beaterBack;
    return p;
  }

  function setMuted(set) { muted = new Set(set || []); applyMuted(); }

  /** Debug: distância (m) da frente do batedor até a pele do bumbo. */
  function beaterGap() {
    beater.updateMatrixWorld(true);
    const c = felt.getWorldPosition(new Vector3());
    return c.z - P.feltR - KICK.pos[2];
  }

  return {
    group, inst, contact, strikeAngle, update, paint, setMuted, pedalAngle, beaterGap,
    dispose() { for (const d of disposables) d.dispose(); },
  };
}
