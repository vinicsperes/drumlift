// Scene colors.

export const LIMB_NAMES = { MD: "Right hand", ME: "Left hand", PD: "Right foot", PE: "Left foot" };

// Dark stage: the pieces are all neutral and color belongs to the limbs.
const NEUTRAL = "#c9c7d1";
export const MOCAP = {
  dark: true,
  bg: "#0a0a0f", face: "#0e0e15", grid: "#2c2c38", stand: "#3a3a47", rim: "#8d8b99", wire: "#6d6b7a", body: "#d6d4dd",
  text: "#e8e6ee", line: "#26262f", chip: "rgba(14,14,21,.85)",
  piece: { crash: NEUTRAL, ride: NEUTRAL, hihat: NEUTRAL, snare: NEUTRAL, tom: NEUTRAL, kick: NEUTRAL },
  limb: { MD: "#ff3d63", ME: "#5aa9ff", PD: "#ff8ca2", PE: "#a5cdff" },
};
