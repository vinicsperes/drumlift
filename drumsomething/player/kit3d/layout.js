// Medidas do kit e do baterista, em metros. Y pra cima; o baterista olha pra -Z,
// então a direita dele é +X. Montagem de destro: chimbal e crash à esquerda,
// surdo e ride à direita, tons em cima do bumbo.

const deg = (d) => (d * Math.PI) / 180;

// pos = centro da pele de cima; tilt inclina a pele pro baterista; roll pro lado
// (positivo = pele virada pra esquerda).
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

// Bumbo deitado: pos = centro da pele de batida (virada pro baterista).
export const KICK = { pos: [0.1, 0.28, -0.48], r: 0.28, depth: 0.4 };

export const KICK_PEDAL = {
  hinge: [0.1, 0.035, -0.12],     // eixo do calcanhar
  length: 0.27,
  restAngle: deg(24),             // ponta pra cima com o pedal solto
  pressAngle: deg(10),            // pedal pisado (batedor na pele)
  beaterPivot: [0.1, 0.13, -0.42],
  beaterLen: 0.19,
  feltR: 0.03,
  beaterBack: deg(45),            // quanto o batedor recua com o pedal solto
};

export const HIHAT_PEDAL = { hinge: [-0.3, 0.035, -0.1], length: 0.26, angle: deg(12) };

// Onde a ponta da baqueta encosta, no plano da peça: [x pra direita, z pro baterista].
export const CONTACTS = {
  snare: { MD: [0.03, 0.05], ME: [-0.05, 0.07] },
  hihat: { MD: [0.07, 0.11], ME: [0.0, 0.13] },
  tom1: { MD: [0.02, 0.05], ME: [-0.02, 0.05] },
  tom2: { MD: [0.02, 0.05], ME: [-0.06, 0.06] },
  floor: { MD: [0.0, 0.06], ME: [-0.09, 0.08] },
  crash: { MD: [0.06, 0.15], ME: [0.0, 0.16] },
  ride: { MD: [-0.05, 0.12], ME: [-0.09, 0.12] },
};

// Ângulo entre a baqueta e a superfície no golpe.
export const STRIKE_ANGLE = { drum: deg(16), cymbal: deg(12) };

export const THRONE = { pos: [0, 0.5, 0.28], r: 0.17 };

export const BODY = {
  pelvis: [0, 0.58, 0.26],
  hip: [0.1, 0, -0.02],           // relativo à pelve (espelhado pro lado esquerdo)
  shoulder: [0.19, 0.49, -0.02],  // relativo à pelve, no tronco
  head: [0, 0.71, -0.03],
  leanBase: deg(6),
  upperArm: 0.31,
  foreArm: 0.3,                   // cotovelo até o ponto onde a mão segura a baqueta
  thigh: 0.42,
  shin: 0.42,
  ankle: [0, 0.075, -0.05],       // tornozelo em relação ao calcanhar, no plano do pedal
  footLength: 0.25,
  stickFront: 0.28,               // da mão até a ponta
  stickBack: 0.13,
  // Ponto de referência pro rumo da baqueta (x, z): de onde cada mão "vem".
  anchor: { MD: [0.2, 0.05], ME: [-0.22, 0.05] },
  home: { MD: "hihat", ME: "snare" },
  liftUp: 0.07,                   // m que o pulso sobe com a baqueta toda levantada
  liftBack: 0.04,
  liftAngle: deg(62),             // giro da baqueta com a preparação máxima
};

// Quanto o tronco gira (yaw, positivo = pra esquerda) e inclina pra frente
// quando cada mão vai até a peça. As contribuições das duas mãos se somam.
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
// Quanto o ombro pode avançar na direção de um alvo longe (m).
export const SHOULDER_REACH = 0.07;
