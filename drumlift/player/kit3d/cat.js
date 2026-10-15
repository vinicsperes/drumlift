// Baterista do estilo pelúcia: um gato humanoide de feltro ("corpo de gente,
// pele de gato") vestindo o mesmo esqueleto do manequim (rig.js).
//
// O corpo inteiro (cabeça, orelhas, tronco, braços, patas, pernas, rabo) é uma
// malha contínua e fechada (catbody.js), deformada por skinning de quatérnio
// duplo: os ossos seguem as juntas que o IK decide (catrig.js) e a superfície
// dobra nas juntas sem emenda. Os detalhes pequenos (catdetails.js) ficam
// presos aos mesmos ossos e saem todos num draw call só.
//
// A malha é gerada uma vez por página num Web Worker (catworker.js), pra não
// travar quem abre a bateria: o kit aparece na hora e o gato logo depois.

import {
  Bone, BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, Quaternion, Skeleton, SkinnedMesh,
  Uint16BufferAttribute, Vector3,
} from "../vendor/three.module.min.js";
import { FEET, HANDS } from "./skeleton.js";
import { createCatBones } from "./catrig.js";
import { S, SLOTS, catMeshData } from "./catdetails.js";
import { CAT_PALETTES, plushMaterial, setSlot, setSlotEmissive } from "./felt.js";

let dataPromise = null;
let data = null;

/**
 * Arrays da malha do gato (uma vez por página). Gera no Worker; se o Worker
 * não abrir, gera aqui mesmo, mas depois de devolver o controle à página.
 */
export function catData() {
  if (dataPromise) return dataPromise;
  const t0 = performance.now();
  dataPromise = new Promise((resolve) => {
    const local = () => setTimeout(() => resolve(catMeshData()), 0);
    let worker;
    try {
      worker = new Worker(new URL("./catworker.js", import.meta.url), { type: "module" });
    } catch {
      local();
      return;
    }
    worker.onmessage = (e) => { worker.terminate(); resolve(e.data); };
    worker.onerror = (e) => { e.preventDefault(); worker.terminate(); local(); };
    worker.postMessage("gerar");
  }).then((d) => {
    d.stats.readyMs = performance.now() - t0;
    data = d;
    return d;
  });
  return dataPromise;
}

/** @param onReady chamado quando a malha entra na cena (pra redesenhar). */
export function createCat(rig, { palette = "laranja", onReady } = {}) {
  const group = new Group();
  group.name = "gato";
  const cat = createCatBones();
  const nb = cat.bones.length;
  let disposed = false;

  // ossos: matrizes de mundo escritas direto (o grupo do gato fica na origem)
  const boneObjs = cat.bones.map((m, i) => {
    const b = new Bone();
    b.name = `osso-${i}`;
    b.matrixAutoUpdate = false;
    b.matrix.copy(m);
    b.matrixWorld.copy(m);
    group.add(b);
    return b;
  });
  const skeleton = new Skeleton(boneObjs, cat.bind.map((m) => m.clone().invert()));
  const furMat = plushMaterial("fur", { sheen: 0.95, sheenMix: 0.5, dq: nb });
  const detailMat = plushMaterial("palette", { slots: SLOTS, sheen: 0.6, sheenMix: 0.4 });
  const dq = furMat.userData.u.uDQ.value;
  const geos = [];

  const api = {
    group, update, paint, setPalette, tipWorld, skeleton, showBind: false,
    mesh: null, details: null, stats: null, genMs: 0,
    ready: null,
    dispose() {
      disposed = true;
      for (const g of geos) g.dispose();
      furMat.dispose();
      detailMat.dispose();
      skeleton.dispose();
    },
  };

  // ---------- malhas (quando os arrays chegam) ----------
  function build(d) {
    if (disposed) return api;
    const t0 = performance.now();
    const b = d.body, geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(b.positions, 3));
    geo.setAttribute("normal", new BufferAttribute(b.normals, 3));
    geo.setAttribute("bi", new Uint16BufferAttribute(b.skinIndex, 4));
    geo.setAttribute("bw", new BufferAttribute(b.skinWeight, 4));
    geo.setAttribute("fur", new BufferAttribute(b.fur, 2));
    geo.setAttribute("ao", new BufferAttribute(b.ao, 1));
    geo.setIndex(new BufferAttribute(b.index, 1));
    const mesh = new Mesh(geo, furMat); // skinning de quatérnio duplo no shader
    mesh.name = "gato-corpo";
    mesh.frustumCulled = false;

    const t = d.details, dgeo = new BufferGeometry();
    dgeo.setAttribute("position", new BufferAttribute(t.position, 3));
    dgeo.setAttribute("normal", new BufferAttribute(t.normal, 3));
    dgeo.setAttribute("slot", new BufferAttribute(t.slot, 1));
    dgeo.setAttribute("skinIndex", new Uint16BufferAttribute(t.skinIndex, 4));
    dgeo.setAttribute("skinWeight", new BufferAttribute(t.skinWeight, 4));
    dgeo.setIndex(new BufferAttribute(t.index, 1));
    const details = new SkinnedMesh(dgeo, detailMat);
    details.name = "gato-detalhes";
    details.frustumCulled = false;
    details.bind(skeleton, new Matrix4());

    group.add(mesh, details);
    geos.push(geo, dgeo);
    Object.assign(api, { mesh, details, stats: d.stats, genMs: performance.now() - t0 });
    onReady?.();
    return api;
  }
  api.ready = data ? Promise.resolve(build(data)) : catData().then(build);

  // ---------- pose ----------
  const bindInv = cat.bind.map((m) => m.clone().invert());
  const dm = new Matrix4(), dqr = new Quaternion();
  /** Quatérnio duplo (rotação, dual) da deformação de cada osso: osso * inverso da ligação. */
  function writeDQ(src) {
    for (let i = 0; i < nb; i++) {
      dm.multiplyMatrices(src[i], bindInv[i]);
      dqr.setFromRotationMatrix(dm);
      if (dqr.w < 0) dqr.set(-dqr.x, -dqr.y, -dqr.z, -dqr.w);
      const e = dm.elements, tx = e[12], ty = e[13], tz = e[14], o = i * 8;
      dq[o] = dqr.x; dq[o + 1] = dqr.y; dq[o + 2] = dqr.z; dq[o + 3] = dqr.w;
      // dual = ½ · (t, 0) · rotação
      dq[o + 4] = 0.5 * (dqr.w * tx + ty * dqr.z - tz * dqr.y);
      dq[o + 5] = 0.5 * (dqr.w * ty + tz * dqr.x - tx * dqr.z);
      dq[o + 6] = 0.5 * (dqr.w * tz + tx * dqr.y - ty * dqr.x);
      dq[o + 7] = -0.5 * (tx * dqr.x + ty * dqr.y + tz * dqr.z);
    }
  }
  function update(t, prep) {
    cat.update(rig, t, prep);
    const src = api.showBind ? cat.bind : cat.bones; // showBind: só pra depurar a malha
    for (let i = 0; i < nb; i++) {
      boneObjs[i].matrix.copy(src[i]);
      boneObjs[i].matrixWorld.copy(src[i]);
    }
    writeDQ(src);
  }
  writeDQ(cat.bind);

  // ---------- cores ----------
  let pal = CAT_PALETTES[palette] || CAT_PALETTES.laranja;
  let lastTheme = null;
  const white = furMat.userData.u.uCream.value.clone().set(0xffffff);
  function paint(theme) {
    lastTheme = theme;
    const u = furMat.userData.u;
    u.uFur.value.set(pal.fur);
    u.uStripe.value.set(pal.stripe || pal.fur);
    u.uCream.value.set(pal.cream);
    setSlot(detailMat, S.eye, 0x120e0d, 0.16);
    setSlot(detailMat, S.rim, 0x1d1714, 0.35);
    setSlot(detailMat, S.glint, 0xffffff, 0.4);
    setSlotEmissive(detailMat, S.glint, white, 0.9);
    setSlot(detailMat, S.nose, pal.pink, 0.75);
    setSlot(detailMat, S.lining, pal.lining, 0.92);
    setSlot(detailMat, S.bean, pal.pink, 0.85);
    setSlot(detailMat, S.thread, theme.thread, 0.9);
    setSlot(detailMat, S.stick, theme.stick, 0.85);
    for (const l of [...HANDS, ...FEET]) setSlot(detailMat, S[l], theme.limb[l], 0.92);
  }
  function setPalette(name) {
    pal = CAT_PALETTES[name] || CAT_PALETTES.laranja;
    if (lastTheme) paint(lastTheme);
  }

  /** Debug: centro da bolinha da baqueta no mundo (depois do update). */
  function tipWorld(limb, out = new Vector3()) {
    return rig.tip(limb, out);
  }

  return api;
}
