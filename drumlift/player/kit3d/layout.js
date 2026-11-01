// Kit and drummer measures, in meters. Y up; the drummer faces -Z, so his right is +X.
// Right-handed setup: hi-hat and crash on the left, floor tom and ride on the right,
// toms on top of the kick.

const deg = (d) => (d * Math.PI) / 180;

// pos = center of the top head; tilt leans the head toward the drummer; roll to the
// side (positive = head turned left).
export const DRUMS = {
  snare: { pos: [-0.15, 0.70, -0.40], r: 0.178, depth: 0.13, tilt: deg(6), roll: 0 },
  tom1: { pos: [-0.03, 0.88, -0.66], r: 0.152, depth: 0.2, tilt: deg(16), roll: deg(-6) },
  tom2: { pos: [0.27, 0.88, -0.66], r: 0.165, depth: 0.22, tilt: deg(16), roll: deg(6) },
  floor: { pos: [0.52, 0.66, -0.3], r: 0.203, depth: 0.38, tilt: deg(3), roll: deg(3) },
};

export const CYMBALS = {
  hihat: { pos: [-0.47, 0.89, -0.36], r: 0.178, tilt: 0, roll: 0 },
  crash: { pos: [-0.46, 1.16, -0.62], r: 0.21, tilt: deg(20), roll: deg(-8) },
  ride: { pos: [0.74, 1.02, -0.58], r: 0.255, tilt: deg(12), roll: deg(10) },
};

// Kick on its side: pos = center of the batter head (facing the drummer).
export const KICK = { pos: [0.1, 0.28, -0.48], r: 0.28, depth: 0.4 };

export const KICK_PEDAL = {
  hinge: [0.1, 0.035, -0.12],     // heel axis
  length: 0.27,
  restAngle: deg(24),             // toe up with the pedal released
  pressAngle: deg(10),            // pedal pressed (beater on the head)
  beaterPivot: [0.1, 0.13, -0.42],
  beaterLen: 0.19,
  feltR: 0.03,
  beaterBack: deg(45),            // how far the beater pulls back with the pedal released
};

export const HIHAT_PEDAL = { hinge: [-0.3, 0.035, -0.1], length: 0.26, angle: deg(12), travel: deg(8) };

// Where the stick tip touches, in the piece's plane: [x to the right, z toward the drummer].
export const CONTACTS = {
  snare: { MD: [0.03, 0.05], ME: [-0.05, 0.07] },
  hihat: { MD: [0.07, 0.11], ME: [0.0, 0.13] },
  tom1: { MD: [0.02, 0.05], ME: [-0.02, 0.05] },
  tom2: { MD: [0.02, 0.05], ME: [-0.06, 0.06] },
  floor: { MD: [0.0, 0.06], ME: [-0.09, 0.08] },
  crash: { MD: [0.06, 0.15], ME: [0.0, 0.16] },
  ride: { MD: [-0.05, 0.12], ME: [-0.09, 0.12] },
};

// Angle between the stick and the surface at the strike.
export const STRIKE_ANGLE = { drum: deg(16), cymbal: deg(12) };

export const THRONE = { pos: [0, 0.5, 0.28], r: 0.17 };

export const BODY = {
  pelvis: [0, 0.58, 0.26],
  hip: [0.1, 0, -0.02],           // relative to the pelvis (mirrored on the left)
  shoulder: [0.19, 0.49, -0.02],  // relative to the pelvis, on the torso
  head: [0, 0.71, -0.03],
  leanBase: deg(6),
  upperArm: 0.31,
  foreArm: 0.3,                   // elbow to where the hand holds the stick
  thigh: 0.42,
  shin: 0.42,
  ankle: [0, 0.075, -0.05],       // ankle relative to the heel, in the pedal's plane
  footLength: 0.25,
  stickFront: 0.28,               // from the hand to the tip
  stickBack: 0.13,
  // Reference point for the stick's heading (x, z): where each hand "comes from".
  anchor: { MD: [0.2, 0.05], ME: [-0.22, 0.05] },
  home: { MD: "hihat", ME: "snare" },
  liftUp: 0.07,                   // m the wrist rises with the stick fully up
  liftBack: 0.04,
  liftAngle: deg(62),             // stick turn at the highest windup
};

// How much the torso turns (yaw, positive = left) and leans forward when each hand
// goes to the piece. The two hands' contributions add up.
export const TORSO_REACH = {
  MD: {
    snare: [0, 0], hihat: [deg(3), 0], tom1: [deg(2), deg(5)], tom2: [deg(-3), deg(5)],
    floor: [deg(-10), deg(4)], crash: [deg(12), deg(6)], ride: [deg(-8), deg(3)],
  },
  ME: {
    snare: [0, 0], hihat: [deg(2), 0], tom1: [deg(-2), deg(5)], tom2: [deg(-7), deg(6)],
    floor: [deg(-14), deg(5)], crash: [deg(8), deg(5)], ride: [deg(-12), deg(4)],
  },
};
export const TORSO_LIMIT = { yaw: deg(16), lean: deg(9), bob: deg(1.2) };
// How far the shoulder can advance toward a far target (m).
export const SHOULDER_REACH = 0.07;
