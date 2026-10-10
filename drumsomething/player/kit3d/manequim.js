// Estilo "manequim": o visual original, com kit de cromo e baterista de
// cápsulas, uma luz direcional e uma hemisférica.

import { Color, DirectionalLight, Group, HemisphereLight, NoToneMapping } from "../vendor/three.module.min.js";
import { createKit } from "./kit.js";
import { createAvatar } from "./avatar.js";
import { createRig } from "./rig.js";
import { themeFor } from "./theme.js";

export function createManequim({ renderer, scene }) {
  const group = new Group();
  group.name = "manequim";
  const hemi = new HemisphereLight();
  const sun = new DirectionalLight();
  sun.position.set(1.2, 3.4, 2.0);
  group.add(hemi, sun);

  const kit = createKit();
  const rig = createRig();
  const avatar = createAvatar(rig);
  group.add(kit.group, avatar.group);
  renderer.toneMapping = NoToneMapping;
  scene.environment = null;

  return {
    name: "manequim", group, kit, rig, avatar,
    /** Aplica as cores do tema e devolve as da interface (legenda). */
    paint(dark) {
      const th = themeFor(dark);
      scene.background = new Color(th.bg);
      hemi.color.set(th.hemiSky);
      hemi.groundColor.set(th.hemiGround);
      hemi.intensity = th.hemi;
      sun.intensity = th.sun;
      kit.paint(th);
      avatar.paint(th);
      return { ...th, chip: th.dark ? "rgba(22,26,34,.78)" : "rgba(255,255,255,.82)" };
    },
    update(t, prep, anticipation) {
      const press = kit.update(t, prep, anticipation);
      rig.update(t, prep, press);
      avatar.update(t, prep);
    },
    setMuted: (set) => kit.setMuted(set),
    tipWorld: (limb, out) => avatar.tipWorld(limb, out),
    beaterGap: () => kit.beaterGap(),
    dispose() {
      kit.dispose();
      avatar.dispose();
    },
  };
}
