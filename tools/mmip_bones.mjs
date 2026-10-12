// Lê o take.fbx de uma performance MMIP com o FBXLoader do three.js e grava a
// posição e a rotação (no mundo) dos ossos que interessam, quadro a quadro,
// a 60 Hz. Quem usa é o tools/mmip_moves.py; roda no Node:
//
//   node tools/mmip_bones.mjs songs/mmip/01 [songs/mmip/02 ...]
//
// Saída na mesma pasta: bones.f32 (float32, quadros × ossos × [x y z qx qy qz qw],
// em metros, eixos do FBX) e bones.json (fps, quadros, nomes dos ossos).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const VENDOR = fileURLToPath(new URL("../drumsomething/player/vendor/", import.meta.url));
const { AnimationMixer, Quaternion, Vector3 } = await import(join(VENDOR, "three.module.min.js"));
const { FBXLoader } = await import(join(VENDOR, "FBXLoader.js"));

const FPS = 60;
const SIDE = ["Right", "Left"];
const BONES = [
  "Hips", "Spine1", "Spine2", "Spine3", "Spine4", "Neck", "Head",
  ...SIDE.flatMap((s) => [
    `${s}Shoulder`, `${s}Arm`, `${s}ForeArm`, `${s}Hand`,
    `${s}Finger1Proximal`, `${s}Finger1Distal`, `${s}Finger2Proximal`, `${s}Finger2Medial`,
    `${s}Finger3Proximal`, `${s}Finger5Proximal`,
    `${s}Thigh`, `${s}Shin`, `${s}Foot`, `${s}Toe`,
  ]),
];

// o FBXLoader avisa de cada vértice com mais de 4 pesos; aqui só o movimento importa
const warn = console.warn;
console.warn = (...a) => { if (!String(a[0]).includes("skinning weights")) warn(...a); };

for (const dir of process.argv.slice(2)) {
  const buf = readFileSync(join(dir, "take.fbx"));
  const obj = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
  obj.scale.setScalar(0.01); // cm -> m
  const clip = obj.animations[0];
  const mixer = new AnimationMixer(obj);
  mixer.clipAction(clip).play();
  const bones = BONES.map((n) => {
    const b = obj.getObjectByName(n);
    if (!b) throw new Error(`${dir}: osso ${n} não encontrado`);
    return b;
  });
  const n = Math.floor(clip.duration * FPS);
  const out = new Float32Array(n * bones.length * 7);
  const v = new Vector3(), q = new Quaternion();
  for (let i = 0; i < n; i++) {
    mixer.setTime(i / FPS);
    obj.updateMatrixWorld(true);
    for (let k = 0; k < bones.length; k++) {
      bones[k].getWorldPosition(v);
      bones[k].getWorldQuaternion(q);
      out.set([v.x, v.y, v.z, q.x, q.y, q.z, q.w], (i * bones.length + k) * 7);
    }
  }
  writeFileSync(join(dir, "bones.f32"), Buffer.from(out.buffer));
  writeFileSync(join(dir, "bones.json"), JSON.stringify({ fps: FPS, frames: n, bones: BONES }));
  console.log(`${dir}: ${n} quadros, ${bones.length} ossos`);
}
