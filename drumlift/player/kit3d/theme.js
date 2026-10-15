// Cores da cena. As das peças são as mesmas da tab (index.html), escuro e claro.

export const LIMB_NAMES = { MD: "Mão direita", ME: "Mão esquerda", PD: "Pé direito", PE: "Pé esquerdo" };

const DARK = {
  dark: true,
  bg: "#0e1015", floor: "#171b23", panel: "#161a22", line: "#2a303c", text: "#e7e9ef", muted: "#8a92a6",
  piece: { crash: "#ff8a65", ride: "#ffd166", hihat: "#4fc3f7", snare: "#f06292", tom: "#b388ff", kick: "#7bd88f" },
  limb: { MD: "#ff5252", ME: "#4d7cff", PD: "#ff9e9e", PE: "#a3bcff" },
  head: "#e9e5db", chrome: "#9aa1ad", body: "#8d95a6", face: "#2b303b", stick: "#d8b98a", seat: "#2a2f39",
  hemiSky: "#dfe6f5", hemiGround: "#2a2d33", hemi: 1.6, sun: 2.4,
};

const LIGHT = {
  dark: false,
  bg: "#f6f7f9", floor: "#e7eaf0", panel: "#ffffff", line: "#d9dde5", text: "#1b1f27", muted: "#5d6576",
  piece: { crash: "#d9541e", ride: "#a77b00", hihat: "#0b84c6", snare: "#c2185b", tom: "#6a3fd1", kick: "#2e8b45" },
  limb: { MD: "#d32f2f", ME: "#2952cc", PD: "#e57373", PE: "#7d9bf0" },
  head: "#f3efe6", chrome: "#7d8592", body: "#6f788a", face: "#1d2129", stick: "#c49a62", seat: "#3a404c",
  hemiSky: "#ffffff", hemiGround: "#9aa0aa", hemi: 1.7, sun: 2.2,
};

export const themeFor = (dark) => (dark ? DARK : LIGHT);
