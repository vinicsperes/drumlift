// Quem toca o quê. Regras pra destro, pensadas pros grooves comuns:
//   PD = bumbo; PE fica parado no pedal do chimbal (não inventa notas).
//   Mesmo passo: prato + caixa/tom -> MD no prato; caixa + tom -> ME na caixa.
//   Sozinhas: prato -> MD (ME se a MD não tiver tempo, menos no ride); caixa ->
//   ME, alternando D-E-D-E em sequências rápidas; tons alternam dentro da virada.

const CYMBALS = new Set(["crash", "ride", "hihat"]);
const DRUMS = new Set(["snare", "tom"]);
const PRIORITY = { crash: 0, ride: 1, hihat: 2, snare: 3, tom: 4 };

export const FAST_CYMBAL = 0.09; // s: a MD não repete prato mais rápido que isso
export const FAST_DRUM = 0.18;   // s: abaixo disso a caixa alterna as mãos

const other = (limb) => (limb === "MD" ? "ME" : "MD");

// Com 3 ou mais notas de mão: o prato mais importante e o tambor mais
// importante (se houver); senão, as duas primeiras na ordem prato > caixa > tom.
function pickTwo(hand) {
  const cym = hand.filter((n) => CYMBALS.has(n.piece));
  const drum = hand.filter((n) => DRUMS.has(n.piece));
  return cym.length && drum.length ? [cym[0], drum[0]] : hand.slice(0, 2);
}

function assignPair(a, b) {
  // a vem antes na ordem de importância
  const ca = CYMBALS.has(a.piece), cb = CYMBALS.has(b.piece);
  if (ca && b.inst === "floor" && a.piece !== "ride") {
    // Prato da esquerda + surdo: cruzar os dois braços não dá; cada mão no seu lado.
    a.limb = "ME"; b.limb = "MD";
  } else if (ca && cb) {
    // Dois pratos: a MD fica com o ride (à direita); senão com o de maior prioridade.
    const right = b.piece === "ride" ? b : a;
    right.limb = "MD";
    (right === a ? b : a).limb = "ME";
  } else if (ca) {
    a.limb = "MD"; b.limb = "ME";      // prato + caixa/tom: mão cruzada de destro
  } else {
    a.limb = "ME"; b.limb = "MD";      // caixa + tom: ME na caixa, MD no tom
  }
}

function assignSingle(g, prev, next, last, clock) {
  const n = g.single;
  if (CYMBALS.has(n.piece)) {
    // O ride fica longe demais da ME: a MD faz o golpe duplo mesmo sem folga.
    n.limb = n.t - last.MD < FAST_CYMBAL && n.piece !== "ride" ? "ME" : "MD";
    return;
  }
  const prevDrum = prev?.single && DRUMS.has(prev.single.piece) ? prev.single : null;
  if (prevDrum) {
    const gap = n.t - prevDrum.t;
    // Continua alternando: sequência rápida, ou tom dentro da virada (até 1 tempo).
    if (gap < FAST_DRUM || (n.piece === "tom" && gap <= clock.beatLen(prevDrum.t) * 1.05)) {
      n.limb = other(prevDrum.limb);
      return;
    }
  }
  if (n.piece === "tom") {
    // Começo de virada: a mão que está livre há mais tempo (empate -> MD).
    n.limb = last.ME < last.MD ? "ME" : "MD";
    return;
  }
  // Caixa abrindo uma sequência rápida: começa com a direita (D-E-D-E).
  const nextDrum = next?.single && DRUMS.has(next.single.piece) ? next.single : null;
  if (nextDrum && nextDrum.t - n.t < FAST_DRUM && n.t - last.MD >= FAST_CYMBAL) {
    n.limb = "MD";
    return;
  }
  // Caixa sozinha: ME, a não ser que a ME tenha acabado de tocar e a MD esteja
  // livre. Com as duas ocupadas a ME faz o golpe duplo e a MD segue no prato.
  n.limb = n.t - last.ME < FAST_DRUM && n.t - last.MD >= FAST_DRUM ? "MD" : "ME";
}

/** Marca `limb` em cada nota dos grupos (null = nenhum membro toca). */
export function assignSticking(groups, clock) {
  const handGroups = [];
  for (const g of groups) {
    const seen = new Map();
    for (const n of g.notes) {
      if (n.piece === "kick") {
        if (!seen.has("kick")) { n.limb = "PD"; seen.set("kick", n); }
        continue;
      }
      const dup = seen.get(n.piece);
      if (!dup || n.vel > dup.vel) seen.set(n.piece, n);
    }
    let hand = [...seen.values()].filter((n) => n.piece !== "kick")
      .sort((a, b) => PRIORITY[a.piece] - PRIORITY[b.piece]);
    if (hand.length > 2) hand = pickTwo(hand);
    if (!hand.length) continue;
    handGroups.push({
      t: Math.min(...hand.map((n) => n.t)),
      notes: hand,
      single: hand.length === 1 ? hand[0] : null,
    });
  }

  const last = { MD: -Infinity, ME: -Infinity };
  for (let i = 0; i < handGroups.length; i++) {
    const g = handGroups[i];
    if (g.single) assignSingle(g, handGroups[i - 1], handGroups[i + 1], last, clock);
    else assignPair(g.notes[0], g.notes[1]);
    for (const n of g.notes) last[n.limb] = Math.max(last[n.limb], n.t);
  }
}
