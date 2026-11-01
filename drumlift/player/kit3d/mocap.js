// The motion capture stage: the drummer as joints and bones on a dark floor, the kit in
// thin lines. Piece faces share the background color, only to hide what is behind them,
// like a technical drawing. Color appears only on what is playing: each hand has its own,
// and a piece lights up in the color of the limb that hit it.

import {
  BoxGeometry, BufferAttribute, BufferGeometry, CircleGeometry, Color, CylinderGeometry, DoubleSide, EdgesGeometry, Float32BufferAttribute,
  Group, IcosahedronGeometry, InstancedMesh, LatheGeometry, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial,
  NoToneMapping, Quaternion, SphereGeometry, Vector2, Vector3, WireframeGeometry,
} from "../vendor/three.module.min.js";
import { CYMBALS, DRUMS, HIHAT_PEDAL, KICK, KICK_PEDAL, THRONE } from "./layout.js";
import {
  beaterAngle, contact, cymbalProfile, pedalAngle, placeFrame, profileHeight, standRods, strikeAngle, surfaceY,
} from "./pieces.js";
import { BONE, FEET, FINGERS, FINGER_LEN, HANDS, SKEL } from "./skeleton.js";
import { INSTANCE_PIECE, lastAtOrBefore } from "./timeline.js";
import { flash, footPress, hihatFoot, wobble } from "./motion.js";
import { createRings, updateRings } from "./rings.js";
import { createRig } from "./rig.js";
import { MOCAP } from "./theme.js";

const UP = new Vector3(0, 1, 0);
const WOBBLE = { crash: [0.11, 0.6, 2.1], ride: [0.045, 0.5, 2.6], hihat: [0.018, 0.12, 6] };
const SIDES = 48;
const BONE_R = 0.0048;
const STICK_R = 0.0062;

const bg = new Color(MOCAP.bg);
const limbColor = Object.fromEntries(Object.entries(MOCAP.limb).map(([k, v]) => [k, new Color(v)]));
const white = new Color("#ffffff");

// ---------- lines ----------
function circle(out, r, y, n = SIDES, cx = 0, cz = 0) {
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2, b = ((k + 1) / n) * Math.PI * 2;
    out.push(cx + r * Math.cos(a), y, cz + r * Math.sin(a), cx + r * Math.cos(b), y, cz + r * Math.sin(b));
  }
}
function lug(out, r, y0, y1, n) {
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2, x = r * Math.cos(a), z = r * Math.sin(a);
    out.push(x, y0, z, x, y1, z);
  }
}
function lines(points, material) {
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(points, 3));
  return new LineSegments(geo, material);
}
// a background-colored face that only hides what is behind; the line sits on top
const fillMaterial = (extra = {}) => new MeshBasicMaterial({ polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, ...extra });

// ---------- kit ----------
function createLineKit() {
  const group = new Group();
  group.name = "kit-traco";
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };
  const stand = keep(new LineBasicMaterial());
  const rest = keep(new LineBasicMaterial());
  const solid = keep(fillMaterial({ side: DoubleSide }));
  const inst = {};

  const frameAt = (id) => { const f = placeFrame(id, new Group()); group.add(f); return f; };
  const addLines = (parent, points, material) => {
    const m = lines(points, material);
    keep(m.geometry);
    parent.add(m);
    return m;
  };

  function piece(id, kind, frame, r, extra = {}) {
    const line = keep(new LineBasicMaterial()), fill = keep(fillMaterial({ side: DoubleSide }));
    const it = { id, kind, piece: INSTANCE_PIECE[id] ?? id, frame, r, line, fill, ...extra };
    inst[id] = it;
    return it;
  }

  // drums: two rims, lugs and the head
  for (const [id, d] of Object.entries(DRUMS)) {
    const frame = frameAt(id), it = piece(id, "drum", frame, d.r);
    const pts = [];
    circle(pts, d.r, 0);
    circle(pts, d.r * 0.965, 0.001);
    circle(pts, d.r, -d.depth);
    lug(pts, d.r, 0, -d.depth, id === "floor" ? 10 : 8);
    addLines(frame, pts, it.line);
    const shell = new Mesh(keep(new CylinderGeometry(d.r, d.r, d.depth, SIDES, 1, true)), it.fill);
    shell.position.y = -d.depth / 2;
    const head = new Mesh(keep(new CircleGeometry(d.r, SIDES).rotateX(-Math.PI / 2)), it.fill);
    frame.add(shell, head);
    it.rings = createRings(frame, d.r, 0.004, keep);
  }

  // cymbals: rings at profile height and the bell
  for (const [id, c] of Object.entries(CYMBALS)) {
    const frame = frameAt(id), pivot = new Group();
    frame.add(pivot);
    const it = piece(id, "cymbal", frame, c.r, { pivot });
    const profile = cymbalProfile(c.r);
    const pts = [];
    for (const rho of [c.r, c.r * 0.97, c.r * 0.66, 0.07, 0.05, 0.032]) circle(pts, rho, profileHeight(profile, rho) + 0.0008);
    const geo = keep(new LatheGeometry(profile.map(([x, y]) => new Vector2(x, y)), SIDES));
    pivot.add(new Mesh(geo, it.fill));
    addLines(pivot, pts, it.line);
    if (id === "hihat") {
      const low = new Group();
      low.rotation.x = Math.PI;
      low.position.y = -0.03;
      low.add(new Mesh(geo, it.fill));
      addLines(low, pts, it.line);
      pivot.add(low);
    }
    it.rings = createRings(frame, c.r, 0.004, keep);
  }

  // stands: one line set for everything
  {
    const pts = [], a = new Vector3(), b = new Vector3(), frames = {};
    for (const s of standRods()) {
      a.set(...s.a); b.set(...s.b);
      if (s.frame) {
        const f = (frames[s.frame] ||= placeFrame(s.frame, new Group()));
        a.applyMatrix4(f.matrix); b.applyMatrix4(f.matrix);
      }
      pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    addLines(group, pts, stand);
  }

  // kick (the frame's y points to the drummer)
  {
    const frame = frameAt("kick"), it = piece("kick", "kick", frame, KICK.r);
    const pts = [];
    circle(pts, KICK.r, 0.001);
    circle(pts, KICK.r * 0.965, 0.002);
    circle(pts, KICK.r, -KICK.depth);
    circle(pts, KICK.r * 0.965, -KICK.depth - 0.001);
    circle(pts, 0.055, -KICK.depth - 0.002, 24, 0.11, 0.1);
    lug(pts, KICK.r, 0, -KICK.depth, 10);
    addLines(frame, pts, it.line);
    const shell = new Mesh(keep(new CylinderGeometry(KICK.r, KICK.r, KICK.depth, SIDES, 1, true)), it.fill);
    shell.position.y = -KICK.depth / 2;
    const headGeo = keep(new CircleGeometry(KICK.r, SIDES).rotateX(-Math.PI / 2));
    const batter = new Mesh(headGeo, it.fill);
    const reso = new Mesh(headGeo, it.fill);
    reso.position.y = -KICK.depth;
    frame.add(shell, batter, reso);
    it.rings = createRings(frame, KICK.r, 0.004, keep);
  }

  // pedals and beater
  const P = KICK_PEDAL, H = HIHAT_PEDAL;
  const board = (w, len) => keep(new BoxGeometry(w, 0.012, len).translate(0, 0.006, -len / 2));
  const boardEdges = (geo) => keep(new EdgesGeometry(geo));
  const kickGeo = board(0.085, P.length), hhGeo = board(0.08, H.length);
  const kickBoard = new Group();
  kickBoard.position.set(...P.hinge);
  kickBoard.add(new Mesh(kickGeo, solid), new LineSegments(boardEdges(kickGeo), rest));
  const hhBoard = new Group();
  hhBoard.position.set(...H.hinge);
  hhBoard.add(new Mesh(hhGeo, solid), new LineSegments(boardEdges(hhGeo), rest));
  const beater = new Group();
  beater.position.set(...P.beaterPivot);
  addLines(beater, [0, 0, 0, 0, P.beaterLen, 0], rest);
  const felt = new Mesh(keep(new SphereGeometry(P.feltR, 16, 10)), solid);
  felt.position.y = P.beaterLen;
  beater.add(felt);
  const feltEdge = [];
  circle(feltEdge, P.feltR, P.beaterLen, 24);
  addLines(beater, feltEdge, rest);
  group.add(kickBoard, hhBoard, beater);

  // throne
  {
    const seat = new Group();
    seat.position.set(...THRONE.pos);
    const pts = [];
    circle(pts, THRONE.r, 0);
    circle(pts, THRONE.r * 0.95, -0.08);
    lug(pts, THRONE.r * 0.97, 0, -0.08, 8);
    addLines(seat, pts, stand);
    const cush = new Mesh(keep(new CylinderGeometry(THRONE.r, THRONE.r * 0.95, 0.08, SIDES)), solid);
    cush.position.y = -0.04;
    seat.add(cush);
    group.add(seat);
  }

  // floor: a grid that fades with distance, like a capture volume
  {
    const pts = [], cols = [], half = 2.5, step = 0.25, cx = 0.1, cz = -0.3;
    const floor = new Color(MOCAP.grid), c = new Color();
    const push = (x, z) => {
      pts.push(x, 0, z);
      c.copy(floor).lerp(bg, Math.min(1, Math.hypot(x - cx, z - cz) / half));
      cols.push(c.r, c.g, c.b);
    };
    const n = Math.round((2 * half) / step);
    for (let i = 0; i <= n; i++) {
      const u = -half + i * step;
      for (let j = 0; j < n; j++) {
        const v0 = -half + j * step, v1 = v0 + step;
        push(cx + u, cz + v0); push(cx + u, cz + v1);
        push(cx + v0, cz + u); push(cx + v1, cz + u);
      }
    }
    const geo = keep(new BufferGeometry());
    geo.setAttribute("position", new Float32BufferAttribute(pts, 3));
    geo.setAttribute("color", new Float32BufferAttribute(cols, 3));
    group.add(new LineSegments(geo, keep(new LineBasicMaterial({ vertexColors: true }))));
  }
  group.updateMatrixWorld(true);

  // ---------- colors ----------
  const rim = new Color(MOCAP.rim), face = new Color(MOCAP.face);
  let muted = new Set();
  function paint() {
    stand.color.set(MOCAP.stand);
    rest.color.set(MOCAP.stand);
    solid.color.copy(face);
    for (const it of Object.values(inst)) {
      it.line.color.copy(rim);
      it.fill.color.copy(face);
      for (const ring of it.rings) ring.material.color.copy(white);
    }
  }

  // ---------- animation ----------
  const hhState = { press: 0, tap: 0 };
  function update(t, prep, anticipation) {
    for (const it of Object.values(inst)) {
      const hits = prep.instHits[it.id] || [];
      const off = muted.has(it.piece);
      const f = off ? 0 : flash(hits, t);
      const i = f > 0 ? lastAtOrBefore(hits, t) : -1;
      const c = i >= 0 ? limbColor[hits[i].limb] || white : white;
      it.line.color.copy(rim).lerp(bg, off ? 0.65 : 0).lerp(c, Math.min(1, f * 1.5));
      it.fill.color.copy(face).lerp(c, 0.42 * f);
      if (it.pivot) {
        const [amp, tau, freq] = WOBBLE[it.id];
        it.pivot.rotation.x = wobble(hits, t, amp, tau, freq);
      }
      updateRings(it.rings, hits, t, prep.clock, anticipation && !off);
    }
    const p = footPress(prep.limbs.PD, t);
    kickBoard.rotation.x = pedalAngle(p);
    beater.rotation.x = beaterAngle(p);
    hhBoard.rotation.x = H.angle - H.travel * hihatFoot(prep, t, hhState).press;
    return p;
  }

  /** Debug: distance (m) from the front of the beater to the kick head. */
  function beaterGap() {
    beater.updateMatrixWorld(true);
    return felt.getWorldPosition(new Vector3()).z - P.feltR - KICK.pos[2];
  }

  return {
    group, inst, contact, strikeAngle, surfaceY, update, paint, pedalAngle, beaterGap,
    setMuted(set) { muted = new Set(set || []); },
    dispose() { for (const d of disposables) d.dispose(); },
  };
}

// ---------- skeleton ----------
function createMarkers(rig) {
  const group = new Group();
  group.name = "captura";
  const at = (name) => BONE[name];
  const segs = [["hips", "spine"], ["spine", "spine1"], ["spine1", "chest"], ["chest", "neck"], ["neck", "head"]].map(([a, b]) => [at(a), at(b), null]);
  for (const l of HANDS) {
    segs.push([at("chest"), at(`clav.${l}`), null], [at(`clav.${l}`), at(`arm.${l}`), null], [at(`arm.${l}`), at(`forearm.${l}`), null]);
    segs.push([at(`forearm.${l}`), at(`hand.${l}`), l], [at(`hand.${l}`), at(`stick.${l}`), l]);
  }
  for (const l of FEET) {
    segs.push([at("hips"), at(`thigh.${l}`), null], [at(`thigh.${l}`), at(`shin.${l}`), null]);
    segs.push([at(`shin.${l}`), at(`foot.${l}`), l], [at(`foot.${l}`), at(`toe.${l}`), l]);
  }
  const joints = [
    ["hips", 0.015, null], ["spine", 0.009, null], ["spine1", 0.009, null], ["chest", 0.011, null], ["neck", 0.011, null],
    ...HANDS.flatMap((l) => [[`arm.${l}`, 0.014, null], [`forearm.${l}`, 0.012, null], [`hand.${l}`, 0.013, l], [`stick.${l}`, 0.008, l]]),
    ...FEET.flatMap((l) => [[`thigh.${l}`, 0.015, null], [`shin.${l}`, 0.013, null], [`foot.${l}`, 0.013, l], [`toe.${l}`, 0.009, l]]),
  ].map(([n, r, l]) => [at(n), r, l]);

  const cyl = new CylinderGeometry(1, 1, 1, 8, 1), ball = new SphereGeometry(1, 12, 8);
  const bonesMat = new MeshBasicMaterial(), ballsMat = new MeshBasicMaterial();
  const nSeg = segs.length + 2, nBall = joints.length + 2; // + sticks and tips
  const bones = new InstancedMesh(cyl, bonesMat, nSeg), balls = new InstancedMesh(ball, ballsMat, nBall);
  bones.frustumCulled = balls.frustumCulled = false;
  group.add(bones, balls);

  // head: a wire mesh, with a tick where it looks
  const head = new Group();
  head.matrixAutoUpdate = false;
  const skull = new IcosahedronGeometry(1, 1).scale(0.082, 0.102, 0.092);
  const wire = new WireframeGeometry(skull);
  const headFill = new MeshBasicMaterial({ color: MOCAP.bg, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const headLine = new LineBasicMaterial({ color: MOCAP.wire });
  const gaze = new BufferGeometry().setFromPoints([new Vector3(0, -0.005, -0.09), new Vector3(0, -0.012, -0.128)]);
  const gazeLine = new LineBasicMaterial({ color: MOCAP.body });
  head.add(new Mesh(skull, headFill), new LineSegments(wire, headLine), new LineSegments(gaze, gazeLine));
  group.add(head);
  const headOffset = new Matrix4().makeTranslation(0, 0.095, -0.012);

  // fingers: a thin line, just to show the grip
  const fingerPairs = [];
  for (const l of HANDS) {
    for (const f of FINGERS) {
      const ids = [1, 2, 3].map((k) => at(`${f}${k}.${l}`));
      fingerPairs.push([at(`hand.${l}`), ids[0]], [ids[0], ids[1]], [ids[1], ids[2]], [ids[2], ids[2], FINGER_LEN[f][2]]);
    }
  }
  const fingerPos = new BufferAttribute(new Float32Array(fingerPairs.length * 6), 3);
  const fingerGeo = new BufferGeometry().setAttribute("position", fingerPos);
  const fingerMat = new LineBasicMaterial({ color: MOCAP.wire });
  const fingers = new LineSegments(fingerGeo, fingerMat);
  fingers.frustumCulled = false;
  group.add(fingers);

  const pa = new Vector3(), pb = new Vector3(), dir = new Vector3(), q = new Quaternion(), s = new Vector3(), m = new Matrix4(), c = new Color();
  const body = new Color(MOCAP.body);
  const pos = (i, out) => out.setFromMatrixPosition(rig.skel.bones[i]);
  function setSeg(i, a, b, r) {
    dir.subVectors(b, a);
    const len = dir.length();
    q.setFromUnitVectors(UP, len > 1e-6 ? dir.divideScalar(len) : UP);
    m.compose(s.addVectors(a, b).multiplyScalar(0.5), q, pb2.set(r, len, r));
    bones.setMatrixAt(i, m);
  }
  const pb2 = new Vector3(), pc = new Vector3();
  function setBall(i, p, r, color) {
    m.makeScale(r, r, r).setPosition(p);
    balls.setMatrixAt(i, m);
    balls.setColorAt(i, color);
  }

  const glow = { MD: new Color(), ME: new Color(), PD: new Color(), PE: new Color() };
  const hhState = { press: 0, tap: 0 };
  function update(t, prep) {
    // each limb's color: dim at rest, full at the stroke
    for (const l of HANDS) glow[l].copy(limbColor[l]).lerp(bg, 0.28).lerp(limbColor[l], Math.min(1, flash(prep.limbs[l], t) * 1.6));
    glow.PD.copy(limbColor.PD).lerp(bg, 0.45).lerp(limbColor.PD, Math.min(1, flash(prep.limbs.PD, t) * 1.6));
    glow.PE.copy(limbColor.PE).lerp(bg, 0.45).lerp(limbColor.PE, hihatFoot(prep, t, hhState).press);

    segs.forEach(([a, b, l], i) => {
      setSeg(i, pos(a, pa), pos(b, pb), BONE_R);
      bones.setColorAt(i, l ? glow[l] : body);
    });
    joints.forEach(([j, r, l], i) => setBall(i, pos(j, pa), r, l ? glow[l] : white));
    // stick: butt to tip, with the tip growing at the stroke
    HANDS.forEach((l, k) => {
      const st = rig.skel.bones[at(`stick.${l}`)];
      pa.set(0, -SKEL.stickBack, 0).applyMatrix4(st);
      pb.set(0, SKEL.stickFront, 0).applyMatrix4(st);
      setSeg(segs.length + k, pa, pb, STICK_R);
      bones.setColorAt(segs.length + k, glow[l]);
      setBall(joints.length + k, pb, 0.0105 + 0.012 * flash(prep.limbs[l], t), c.copy(glow[l]));
    });
    bones.instanceMatrix.needsUpdate = balls.instanceMatrix.needsUpdate = true;
    bones.instanceColor.needsUpdate = balls.instanceColor.needsUpdate = true;

    head.matrix.multiplyMatrices(rig.skel.bones[at("head")], headOffset);
    head.matrixWorldNeedsUpdate = true;

    fingerPairs.forEach(([a, b, tipLen], i) => {
      pos(a, pa);
      if (tipLen) pc.set(0, tipLen, 0).applyMatrix4(rig.skel.bones[b]); else pos(b, pc);
      fingerPos.setXYZ(i * 2, pa.x, pa.y, pa.z);
      fingerPos.setXYZ(i * 2 + 1, pc.x, pc.y, pc.z);
    });
    fingerPos.needsUpdate = true;
  }

  return {
    group, update, paint() {},
    /** On the over-the-shoulder camera, the head would sit in front of everything. */
    setCamera(name) { head.visible = name !== "drummer"; },
    tipWorld: (limb, out = new Vector3()) => rig.tip(limb, out),
    dispose() {
      for (const x of [cyl, ball, skull, wire, gaze, fingerGeo, bonesMat, ballsMat, headFill, headLine, gazeLine, fingerMat, bones, balls]) x.dispose();
    },
  };
}

// ---------- stage ----------
export function createMocap({ renderer, scene }) {
  const group = new Group();
  group.name = "mocap";
  const kit = createLineKit();
  const rig = createRig();
  const avatar = createMarkers(rig);
  group.add(kit.group, avatar.group);
  renderer.toneMapping = NoToneMapping;
  scene.environment = null;
  return {
    name: "mocap", group, kit, rig, avatar,
    paint() {
      scene.background = new Color(MOCAP.bg);
      kit.paint();
      return MOCAP;
    },
    update(t, prep, anticipation) {
      const press = kit.update(t, prep, anticipation);
      rig.update(t, prep, press);
      avatar.update(t, prep);
    },
    setMuted: (set) => kit.setMuted(set),
    setCamera: (name) => avatar.setCamera(name),
    tipWorld: (limb, out) => avatar.tipWorld(limb, out),
    beaterGap: () => kit.beaterGap(),
    dispose() {
      kit.dispose();
      avatar.dispose();
    },
  };
}
