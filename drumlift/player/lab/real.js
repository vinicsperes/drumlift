// The real MMIP drummer: loads the FBX (body captured by a Rokoko suit, fingers included),
// plays the animation by time and samples the joints at 120 Hz for the metrics. The FBX
// is in centimeters; everything here becomes meters.

import { AnimationMixer, MeshStandardMaterial, Quaternion, Vector3 } from "../vendor/three.module.min.js";
import { FBXLoader } from "../vendor/FBXLoader.js";

export const JOINTS = [
  "Hips", "Spine1", "Spine2", "Spine3", "Neck", "Head",
  "RightArm", "RightForeArm", "RightHand", "RightFinger2Proximal",
  "LeftArm", "LeftForeArm", "LeftHand", "LeftFinger2Proximal",
  "RightFoot", "RightToe", "LeftFoot", "LeftToe",
];
export const HANDS = ["RightHand", "LeftHand"];

export async function loadReal(url, onProgress = () => {}) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const buf = await res.arrayBuffer();
  onProgress("reading the FBX");
  const obj = new FBXLoader().parse(buf, "");
  obj.scale.setScalar(0.01);
  const skin = new MeshStandardMaterial({ color: 0x9aa1ad, roughness: 0.85, metalness: 0 });
  obj.traverse((o) => { if (o.isMesh) { o.material = skin; o.frustumCulled = false; } });
  const mixer = new AnimationMixer(obj);
  const clip = obj.animations[0];
  mixer.clipAction(clip).play();
  const bones = Object.fromEntries(JOINTS.map((n) => [n, obj.getObjectByName(n)]));
  for (const [n, b] of Object.entries(bones)) if (!b) throw new Error(`bone ${n} not found in the FBX`);

  function setTime(t) {
    mixer.setTime(Math.min(Math.max(t, 0), clip.duration - 1e-3));
    obj.updateMatrixWorld(true);
  }

  // Some sessions recorded the bones turned 180° in x (bone y and z with flipped signs).
  // Normalize the hands to y = wrist to fingers, z = back of the hand.
  const FLIP = new Quaternion(1, 0, 0, 0);
  setTime(clip.duration / 2);
  const flip = (() => {
    const a = bones.Spine1.getWorldPosition(new Vector3()), b = bones.Spine2.getWorldPosition(new Vector3());
    return b.sub(a).applyQuaternion(bones.Spine1.getWorldQuaternion(new Quaternion()).invert()).y < 0;
  })();

  /** Position (m) of each joint and rotation of the hands, frame by frame. */
  function sample(fps = 120) {
    const n = Math.floor(clip.duration * fps);
    const pos = Object.fromEntries(JOINTS.map((j) => [j, new Float32Array(n * 3)]));
    const quat = Object.fromEntries(HANDS.map((h) => [h, new Float32Array(n * 4)]));
    const v = new Vector3(), q = new Quaternion();
    for (let i = 0; i < n; i++) {
      setTime(i / fps);
      for (const j of JOINTS) {
        bones[j].getWorldPosition(v);
        pos[j][i * 3] = v.x; pos[j][i * 3 + 1] = v.y; pos[j][i * 3 + 2] = v.z;
      }
      for (const h of HANDS) {
        bones[h].getWorldQuaternion(q);
        if (flip) q.multiply(FLIP);
        quat[h][i * 4] = q.x; quat[h][i * 4 + 1] = q.y; quat[h][i * 4 + 2] = q.z; quat[h][i * 4 + 3] = q.w;
      }
    }
    return { fps, n, pos, quat };
  }

  return {
    object: obj, bones, clip, setTime, sample, duration: clip.duration, flip,
    dispose() { obj.traverse((o) => { o.geometry?.dispose?.(); }); skin.dispose(); },
  };
}
