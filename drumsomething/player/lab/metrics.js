// Métricas de movimento, iguais pro baterista real e pro nosso. Recebem uma
// "trilha": posições (m) quadro a quadro da ponta da baqueta, pulso, cotovelo,
// ombro (direita e esquerda), peito e cabeça, mais os golpes de cada mão.
//
//   trilha = { fps, n, tip: [D, E], wrist: [D, E], elbow: [D, E],
//              chest, head, strokes: [[{t, vel, inst}], [...]] }
//   (cada posição é um Float32Array com x, y, z por quadro)

const CYMBALS = new Set(["hihat", "ride", "crash"]);

const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

/** Interpolação t -> posição em tempos (batidas). */
function beatPos(beats, t) {
  const n = beats.length;
  if (t <= beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
  if (t >= beats[n - 1]) return n - 1 + (t - beats[n - 1]) / (beats[n - 1] - beats[n - 2]);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (beats[m] <= t) lo = m; else hi = m; }
  return lo + (t - beats[lo]) / (beats[hi] - beats[lo]);
}

export function measure(tr, beats) {
  const f = (t) => Math.min(tr.n - 1, Math.max(0, Math.round(t * tr.fps)));
  const y = (arr, i) => arr[i * 3 + 1];
  const out = { strokes: 0 };

  // ---------- golpes: preparação, divisão entre juntas, quem vai na frente ----------
  const prep = [], wrist = { cym: [], drum: [] }, elbow = { cym: [], drum: [] }, lead = [], speed = [];
  const travelJerk = [], travelArc = [];
  for (const h of [0, 1]) {
    const st = tr.strokes[h];
    for (let k = 1; k < st.length; k++) {
      const a = st[k - 1], b = st[k], gap = b.t - a.t;
      if (gap < 0.1 || gap > 1.5) continue;
      const i0 = f(a.t + 0.25 * gap), i1 = f(b.t);
      const tipA = tr.tip[h], wA = tr.wrist[h], eA = tr.elbow[h];
      let tMax = -Infinity, wMax = -Infinity, eMax = -Infinity, it = i0, iw = i0, vMax = 0;
      for (let i = i0; i <= i1; i++) {
        if (y(tipA, i) > tMax) { tMax = y(tipA, i); it = i; }
        if (y(wA, i) > wMax) { wMax = y(wA, i); iw = i; }
        if (y(eA, i) > eMax) eMax = y(eA, i);
        if (i > i0) {
          const dx = tipA[i * 3] - tipA[i * 3 - 3], dy = tipA[i * 3 + 1] - tipA[i * 3 - 2], dz = tipA[i * 3 + 2] - tipA[i * 3 - 1];
          vMax = Math.max(vMax, Math.hypot(dx, dy, dz) * tr.fps);
        }
      }
      const p = tMax - y(tipA, i1);
      const cls = CYMBALS.has(b.inst) ? "cym" : "drum";
      prep.push({ vel: b.vel, cm: p * 100, cls });
      speed.push(vMax);
      if (p > 0.02) {
        wrist[cls].push((wMax - y(wA, i1)) / p);
        elbow[cls].push((eMax - y(eA, i1)) / p);
        lead.push(((iw - it) / tr.fps) * 1000);
      }
      // troca de peça: suavidade (jerk normalizado) e arco do caminho da ponta
      if (b.inst !== a.inst && gap >= 0.15) {
        const s0 = f(a.t + 0.02), s1 = f(b.t - 0.02);
        if (s1 - s0 > 8) {
          let L = 0, J = 0;
          for (let i = s0 + 1; i <= s1; i++) {
            L += Math.hypot(tipA[i * 3] - tipA[i * 3 - 3], tipA[i * 3 + 1] - tipA[i * 3 - 2], tipA[i * 3 + 2] - tipA[i * 3 - 1]);
          }
          for (let i = s0; i + 3 <= s1; i++) {
            let j2 = 0;
            for (let c = 0; c < 3; c++) {
              const j = (tipA[(i + 3) * 3 + c] - 3 * tipA[(i + 2) * 3 + c] + 3 * tipA[(i + 1) * 3 + c] - tipA[i * 3 + c]) * tr.fps ** 3;
              j2 += j * j;
            }
            J += j2 / tr.fps;
          }
          const T = (s1 - s0) / tr.fps;
          if (L > 0.03) travelJerk.push(Math.sqrt((0.5 * J * T ** 5) / (L * L)));
          // arco: maior distância do caminho até a reta entre as pontas
          const A = [tipA[s0 * 3], tipA[s0 * 3 + 1], tipA[s0 * 3 + 2]], B = [tipA[s1 * 3], tipA[s1 * 3 + 1], tipA[s1 * 3 + 2]];
          const AB = B.map((x, c) => x - A[c]), l2 = AB.reduce((s, x) => s + x * x, 0) || 1;
          let arc = 0;
          for (let i = s0; i <= s1; i++) {
            const AP = [0, 1, 2].map((c) => tipA[i * 3 + c] - A[c]);
            const u = Math.max(0, Math.min(1, AP.reduce((s, x, c) => s + x * AB[c], 0) / l2));
            arc = Math.max(arc, Math.hypot(...AP.map((x, c) => x - u * AB[c])));
          }
          travelArc.push(arc * 100);
        }
      }
    }
  }
  out.strokes = prep.length;
  const byVel = (lo, hi) => mean(prep.filter((p) => p.vel >= lo && p.vel < hi).map((p) => p.cm));
  // inclinação da reta altura (cm) x força (0..1)
  const mv = mean(prep.map((p) => p.vel)), mc = mean(prep.map((p) => p.cm));
  let sxy = 0, sxx = 0;
  for (const p of prep) { sxy += (p.vel - mv) * (p.cm - mc); sxx += (p.vel - mv) ** 2; }
  out.prep = {
    accent: byVel(0.75, 9), normal: byVel(0.45, 0.75), soft: byVel(0, 0.45),
    cym: mean(prep.filter((p) => p.cls === "cym").map((p) => p.cm)),
    drum: mean(prep.filter((p) => p.cls === "drum").map((p) => p.cm)),
    slope: sxx ? sxy / sxx : NaN,
  };
  out.share = {
    wristCym: median(wrist.cym), wristDrum: median(wrist.drum),
    elbowCym: median(elbow.cym), elbowDrum: median(elbow.drum),
  };
  out.lead = median(lead);
  out.speed = median(speed);
  out.travel = { jerk: median(travelJerk), arc: median(travelArc), n: travelJerk.length };

  // ---------- corpo: balanço do peito e da cabeça, aceno no pulso ----------
  const win = Math.round(tr.fps); // tira a deriva lenta (média de ±1 s)
  function residual(arr) {
    const res = new Float32Array(tr.n * 3), acc = [0, 0, 0];
    let lo = 0, hi = -1;
    for (let i = 0; i < tr.n; i++) {
      while (hi < Math.min(tr.n - 1, i + win)) { hi++; for (let c = 0; c < 3; c++) acc[c] += arr[hi * 3 + c]; }
      while (lo < i - win) { for (let c = 0; c < 3; c++) acc[c] -= arr[lo * 3 + c]; lo++; }
      const cnt = hi - lo + 1;
      for (let c = 0; c < 3; c++) res[i * 3 + c] = arr[i * 3 + c] - acc[c] / cnt;
    }
    return res;
  }
  const rms = (res) => { let s = 0; for (let i = 0; i < res.length; i++) s += res[i] * res[i]; return Math.sqrt(s / tr.n) * 1000; };
  const chest = residual(tr.chest), head = residual(tr.head);
  // só enquanto a música toca (entre o primeiro e o último golpe)
  const all = tr.strokes.flat().map((s) => s.t);
  const first = f(Math.min(...all)), last = f(Math.max(...all));
  const slice = (res) => res.subarray(first * 3, (last + 1) * 3);
  const bins = new Float64Array(16), cnts = new Float64Array(16);
  for (let i = first; i <= last; i++) {
    const ph = beatPos(beats, i / tr.fps) % 1;
    const b = Math.min(15, Math.floor((ph < 0 ? ph + 1 : ph) * 16));
    bins[b] += head[i * 3 + 1]; cnts[b]++;
  }
  let mn = Infinity, mx = -Infinity, at = 0;
  for (let b = 0; b < 16; b++) {
    const v = cnts[b] ? bins[b] / cnts[b] : 0;
    if (v < mn) { mn = v; at = b; }
    mx = Math.max(mx, v);
  }
  const nSlice = (last - first + 1);
  const rmsSlice = (res) => { const s = slice(res); let a = 0; for (let i = 0; i < s.length; i++) a += s[i] * s[i]; return Math.sqrt(a / nSlice) * 1000; };
  out.body = { chest: rmsSlice(chest), head: rmsSlice(head), bob: (mx - mn) * 1000, bobPhase: (at + 0.5) / 16 };
  void rms;

  // ---------- mão parada ----------
  const idle = [];
  for (const h of [0, 1]) {
    const st = tr.strokes[h], w = tr.wrist[h];
    for (let k = 1; k < st.length; k++) {
      if (st[k].t - st[k - 1].t < 1.2) continue;
      const i0 = f(st[k - 1].t + 0.3), i1 = f(st[k].t - 0.3);
      const m = [0, 0, 0];
      for (let i = i0; i <= i1; i++) for (let c = 0; c < 3; c++) m[c] += w[i * 3 + c] / (i1 - i0 + 1);
      let s = 0;
      for (let i = i0; i <= i1; i++) for (let c = 0; c < 3; c++) s += (w[i * 3 + c] - m[c]) ** 2;
      idle.push(Math.sqrt(s / (i1 - i0 + 1)) * 1000);
    }
  }
  out.idle = median(idle);
  out.idleN = idle.length;
  return out;
}

/** Linhas da tabela: [rótulo, chave, unidade, casas]. */
export const ROWS = [
  ["Preparação no acento", (m) => m.prep.accent, "cm", 1],
  ["Preparação normal", (m) => m.prep.normal, "cm", 1],
  ["Preparação fraca", (m) => m.prep.soft, "cm", 1],
  ["Altura × força (inclinação)", (m) => m.prep.slope, "cm", 1],
  ["Preparação nos pratos", (m) => m.prep.cym, "cm", 1],
  ["Preparação nos tambores", (m) => m.prep.drum, "cm", 1],
  ["Pulso / ponta — pratos", (m) => m.share.wristCym, "×", 2],
  ["Pulso / ponta — tambores", (m) => m.share.wristDrum, "×", 2],
  ["Cotovelo / ponta — pratos", (m) => m.share.elbowCym, "×", 2],
  ["Cotovelo / ponta — tambores", (m) => m.share.elbowDrum, "×", 2],
  ["Pico do pulso − pico da ponta", (m) => m.lead, "ms", 0],
  ["Velocidade máx. da ponta", (m) => m.speed, "m/s", 1],
  ["Trocas: jerk normalizado", (m) => m.travel.jerk, "", 0],
  ["Trocas: arco do caminho", (m) => m.travel.arc, "cm", 1],
  ["Balanço do peito", (m) => m.body.chest, "mm", 1],
  ["Balanço da cabeça", (m) => m.body.head, "mm", 1],
  ["Aceno da cabeça no pulso", (m) => m.body.bob, "mm", 1],
  ["Mão parada (deriva)", (m) => m.idle, "mm", 1],
];
