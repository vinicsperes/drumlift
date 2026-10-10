// Kit do estilo manequim: cilindros, discos e tubos de cromo, nada baixado.
// Cada peça tem um "frame" no centro da superfície de golpe (pieces.js), usado
// pra posicionar a pele e os anéis.

import {
  CircleGeometry, Color, CylinderGeometry, DoubleSide, Group, LatheGeometry,
  InstancedMesh, Matrix4, Mesh, MeshLambertMaterial, BoxGeometry, Quaternion,
  TorusGeometry, Vector2, Vector3,
} from "../vendor/three.module.min.js";
import { CYMBALS, DRUMS, HIHAT_PEDAL, KICK, KICK_PEDAL, THRONE } from "./layout.js";
import {
  beaterAngle, contact, cymbalProfile, pedalAngle, placeFrame, standRods, strikeAngle, surfaceY,
} from "./pieces.js";
import { INSTANCE_PIECE } from "./timeline.js";
import { flash, footPress, wobble } from "./motion.js";
import { createRings, updateRings } from "./rings.js";

const UP = new Vector3(0, 1, 0);
// Balanço dos pratos: amplitude (rad), amortecimento (s), frequência (Hz).
const WOBBLE = { crash: [0.11, 0.6, 2.1], ride: [0.045, 0.5, 2.6], hihat: [0.018, 0.12, 6] };

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
  function frameAt(id) {
    const f = placeFrame(id, new Group());
    group.add(f);
    return f;
  }

  const inst = {};

  // ---------- tambores ----------
  for (const [id, d] of Object.entries(DRUMS)) {
    const frame = frameAt(id);
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
    inst[id] = { id, kind: "drum", piece: INSTANCE_PIECE[id], frame, r: d.r, shellMat, headMat };
    inst[id].rings = createRings(frame, d.r, 0.014, keep);
  }

  // ---------- pratos ----------
  for (const [id, c] of Object.entries(CYMBALS)) {
    const frame = frameAt(id);
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
    }
    inst[id] = { id, kind: "cymbal", piece: INSTANCE_PIECE[id], frame, pivot, r: c.r, shellMat: mat, headMat: null };
    inst[id].rings = createRings(frame, c.r, 0.004, keep);
  }

  // ---------- estantes ----------
  for (const s of standRods()) rod(s.frame ? inst[s.frame].frame : group, s.a, s.b, s.r);

  // ---------- bumbo ----------
  {
    const frame = frameAt("kick"); // y local = pro baterista
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
    inst.kick = { id: "kick", kind: "kick", piece: "kick", frame, r: KICK.r, shellMat, headMat };
    inst.kick.rings = createRings(frame, KICK.r, 0.03, keep);
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
  const beater = new Group();
  beater.position.set(...P.beaterPivot);
  group.add(beater);
  rod(beater, [0, 0, 0], [0, P.beaterLen, 0], 0.004, true);
  const felt = new Mesh(keep(new CylinderGeometry(P.feltR, P.feltR, 0.05, 16)), dark);
  felt.rotation.z = Math.PI / 2;
  felt.position.y = P.beaterLen;
  beater.add(felt);

  // ---------- pedal do chimbal ----------
  const H = HIHAT_PEDAL;
  const hhGeo = keep(new BoxGeometry(0.08, 0.012, H.length));
  hhGeo.translate(0, 0.006, -H.length / 2);
  const hhBoard = new Mesh(hhGeo, dark);
  hhBoard.position.set(...H.hinge);
  hhBoard.rotation.x = H.angle;
  group.add(hhBoard);

  // ---------- banco e tapete ----------
  const seatMesh = new Mesh(keep(new CylinderGeometry(THRONE.r, THRONE.r * 0.95, 0.08, 24)), seat);
  seatMesh.position.set(THRONE.pos[0], THRONE.pos[1] - 0.04, THRONE.pos[2]);
  group.add(seatMesh);
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

  // ---------- animação ----------
  /** Atualiza reações no tempo t; devolve quanto o pedal do bumbo está pisado. */
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
    const c = felt.getWorldPosition(new Vector3());
    return c.z - P.feltR - KICK.pos[2];
  }

  return {
    group, inst, contact, strikeAngle, surfaceY, update, paint, setMuted, pedalAngle, beaterGap,
    dispose() { for (const d of disposables) d.dispose(); },
  };
}
