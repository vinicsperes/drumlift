// Estilos visuais da bateria 3D. Todos vestem o mesmo esqueleto (rig.js) e o
// mesmo kit lógico (pieces.js): só muda a aparência.
//
// Um estilo é { name, group, kit, rig, avatar, paint(dark), update(t, prep,
// anticipation), setMuted(set), tipWorld(limb), beaterGap(), dispose() } e
// libera tudo o que criou (geometrias, materiais, texturas) no dispose.

import { createManequim } from "./manequim.js";
import { createPelucia } from "./pelucia.js";

export const STYLE_NAMES = ["manequim", "pelucia"];
export const STYLE_LABELS = { manequim: "Manequim", pelucia: "Pelúcia" };
export const DEFAULT_STYLE = "pelucia";

export function createStyle(name, ctx, opts = {}) {
  return name === "manequim" ? createManequim(ctx, opts) : createPelucia(ctx, opts);
}
