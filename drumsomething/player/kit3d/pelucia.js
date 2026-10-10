// Estilo "pelúcia": gato humanoide de feltro numa bateria de feltro, com luz
// de estúdio suave (hemisférica + uma principal + ambiente RoomEnvironment pro
// brilho do tecido) e sombra borrada no chão, como foto de produto.

import {
  Color, DirectionalLight, Group, HemisphereLight, NeutralToneMapping, PMREMGenerator,
} from "../vendor/three.module.min.js";
import { RoomEnvironment } from "../vendor/RoomEnvironment.js";
import { createRig } from "./rig.js";
import { createPlushKit } from "./plushkit.js";
import { createCat } from "./cat.js";
import { CAT_COLOR_NAMES, createFeltTextures } from "./felt.js";
import { themeFor } from "./theme.js";

const CREAM = new Color("#f3ead9");

// Cores das peças um pouco mais pastel, pra parecer feltro.
function pastel(pieces, amount) {
  const out = {};
  for (const [k, v] of Object.entries(pieces)) out[k] = "#" + new Color(v).lerp(CREAM, amount).getHexString();
  return out;
}

const LIGHT = {
  bg: "#ece8e1", text: "#2b251e", line: "#d6cdc0", chip: "rgba(255,251,245,.86)",
  head: "#f5eddf", gold: "#ead48e", rope: "#cbb595", pad: "#7a675a", seat: "#6f8794",
  stick: "#e3c18e", thread: "#3a2a21",
  shadow: "#4b3627", shadowSoft: 0.2, shadowHard: 0.34,
  hemiSky: "#fffaf3", hemiGround: "#ddcdb8", hemi: 0.85, key: "#fff2e2", keyI: 2.5, env: 0.5, exposure: 1.0,
};
const DARK = {
  bg: "#1b1916", text: "#ece6dc", line: "#3a342c", chip: "rgba(38,33,28,.84)",
  head: "#e6dbc8", gold: "#b89a58", rope: "#a8957a", pad: "#5b4d43", seat: "#5a6d77",
  stick: "#d6b27e", thread: "#2a1f19",
  shadow: "#000000", shadowSoft: 0.34, shadowHard: 0.5,
  hemiSky: "#ffeedd", hemiGround: "#3a3028", hemi: 0.75, key: "#ffeedd", keyI: 2.2, env: 0.42, exposure: 1.0,
};

export function plushThemeFor(dark) {
  const base = themeFor(dark);
  const th = dark ? DARK : LIGHT;
  return {
    ...th, dark, limb: base.limb,
    piece: pastel(base.piece, dark ? 0.16 : 0.3),
    accent: pastel(base.piece, dark ? 0.05 : 0.08), // cúpula e borda dos pratos: mais forte que o dourado
  };
}

export function createPelucia({ renderer, scene }, { catColors } = {}) {
  const group = new Group();
  group.name = "pelucia";
  const hemi = new HemisphereLight();
  const key = new DirectionalLight();
  key.position.set(1.1, 3.4, -1.7);
  group.add(hemi, key);

  // ambiente de estúdio pro brilho (sheen) do feltro
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, 0.04);
  room.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
  room.dispose();
  pmrem.dispose();
  scene.environment = envRT.texture;
  renderer.toneMapping = NeutralToneMapping;

  const tex = createFeltTextures(CAT_COLOR_NAMES.includes(catColors) ? catColors : "laranja");
  const kit = createPlushKit(tex);
  const rig = createRig();
  const cat = createCat(rig, tex, { palette: CAT_COLOR_NAMES.includes(catColors) ? catColors : "laranja" });
  group.add(kit.group, cat.group);

  return {
    name: "pelucia", group, kit, rig, avatar: cat,
    paint(dark) {
      const th = plushThemeFor(dark);
      scene.background = new Color(th.bg);
      scene.environmentIntensity = th.env;
      renderer.toneMappingExposure = th.exposure;
      hemi.color.set(th.hemiSky);
      hemi.groundColor.set(th.hemiGround);
      hemi.intensity = th.hemi;
      key.color.set(th.key);
      key.intensity = th.keyI;
      kit.paint(th);
      cat.paint(th);
      return th;
    },
    update(t, prep, anticipation) {
      const press = kit.update(t, prep, anticipation);
      rig.update(t, prep, press);
      cat.update(t, prep);
    },
    setMuted: (set) => kit.setMuted(set),
    setCatColors: (name) => cat.setPalette(CAT_COLOR_NAMES.includes(name) ? name : "laranja"),
    tipWorld: (limb, out) => cat.tipWorld(limb, out),
    beaterGap: () => kit.beaterGap(),
    dispose() {
      kit.dispose();
      cat.dispose();
      tex.dispose();
      if (scene.environment === envRT.texture) scene.environment = null;
      scene.environmentIntensity = 1;
      envRT.dispose();
    },
  };
}
