"""Grade rítmica: compassos a partir das batidas e quantização das notas.

A grade acompanha as batidas reais da música (não um BPM fixo), então
variações de andamento de banda ao vivo não desalinham a tab.
"""

from collections import Counter
from dataclasses import dataclass

import numpy as np

from .transcribe import Hit


@dataclass
class Grid:
    beats: np.ndarray  # tempo (s) de cada batida; bar i começa na batida i*beats_per_bar
    beats_per_bar: int
    subdiv: int  # divisões por batida (4 = semicolcheias, 3 = tercinas...; 12 = misto)
    offset: float  # atraso médio das notas em relação à grade, em batidas
    # Com subdiv 12: subdivisão de cada batida (4, 3 ou 6), pra escrever cada tempo na sua grade.
    beat_subdiv: np.ndarray | None = None

    @property
    def steps_per_bar(self) -> int:
        return self.beats_per_bar * self.subdiv

    @property
    def n_bars(self) -> int:
        return (len(self.beats) - 1) // self.beats_per_bar

    def beat_pos(self, t) -> np.ndarray:
        """Segundos -> posição contínua em batidas."""
        return np.interp(t, self.beats, np.arange(len(self.beats)), left=np.nan, right=np.nan)

    def step_time(self, step) -> np.ndarray:
        """Índice de passo da grade -> segundos (já compensando o atraso médio)."""
        return np.interp(np.asarray(step) / self.subdiv + self.offset,
                         np.arange(len(self.beats)), self.beats)

    def bar_start(self, bar: int) -> float:
        return float(self.beats[bar * self.beats_per_bar])

    def tempo(self) -> tuple[float, float, float]:
        """BPM mediano e faixa (percentis 5-95), medidos por compasso pra não pegar tremida de batida."""
        bar_len = np.diff(self.beats[:: self.beats_per_bar])
        bpm = 60 * self.beats_per_bar / bar_len
        return float(np.median(bpm)), float(np.percentile(bpm, 5)), float(np.percentile(bpm, 95))


def _strength(hits: list[Hit], piece: str, times: np.ndarray, win: float = 0.04) -> np.ndarray:
    """Confiança da nota de `piece` mais próxima de cada tempo (0 se não tiver nenhuma a até `win`)."""
    sel = [h for h in hits if h.piece == piece]
    if not sel:
        return np.zeros(len(times))
    ht = np.array([h.t for h in sel])
    hc = np.array([h.conf for h in sel])
    k = np.clip(np.searchsorted(ht, times), 1, max(1, len(ht) - 1))
    out = np.zeros(len(times))
    for j in (k - 1, np.minimum(k, len(ht) - 1)):
        near = np.abs(ht[j] - times) <= win
        out = np.where(near, np.maximum(out, hc[j]), out)
    return out


def _period_curve(beats: np.ndarray):
    """Duração da batida ao longo da música, numa oitava só.

    O detector às vezes acompanha o dobro ou a metade do andamento num trecho;
    cada intervalo é dobrado/dividido até a oitava do intervalo mediano antes da
    mediana móvel, então essas trocas não contaminam a curva.
    """
    d = np.diff(beats)
    p0 = float(np.median(d))
    folded = d * 2.0 ** np.round(np.log2(p0 / d))
    k = 8
    smooth = np.array([np.median(folded[max(0, i - k):i + k + 1]) for i in range(len(folded))])
    mids = (beats[:-1] + beats[1:]) / 2
    return lambda t: np.interp(t, mids, smooth)


def _octave(period, hits: list[Hit]) -> int:
    """Quantas oitavas mover o andamento pra caixa cair no 2 e no 4.

    Num groove de rock/pop a caixa marca o contratempo: o intervalo mais comum
    entre caixas vale duas batidas. Devolve k (batida = curva * 2**k).
    """
    s = np.array(sorted(h.t for h in hits if h.piece == "snare"))
    if len(s) < 16:
        return 0
    r = np.log2(np.diff(s) / period(s[:-1]))
    votes = {k: int(np.sum(np.abs(r - (k + 1)) < 0.15)) for k in (-1, 0, 1)}
    best = max(votes, key=votes.get)
    bpm = 60 / (float(np.median(period(s))) * 2.0 ** best)
    if best != 0 and votes[best] > 1.3 * votes[0] and 50 <= bpm <= 210:
        return best
    return 0


def regularize_beats(beats: np.ndarray, hits: list[Hit]) -> np.ndarray:
    """Batidas numa oitava só, seguindo as do detector onde ele acertou.

    Programação dinâmica sobre as batidas detectadas mais os pontos médios entre
    elas (que cobrem trechos detectados na metade do andamento). O caminho paga
    por intervalo fora da batida esperada e ganha com bumbo/caixa/prato na batida,
    o que escolhe quais batidas manter num trecho detectado no dobro.
    """
    curve = _period_curve(beats)
    k = _octave(curve, hits)

    def period(t):
        return curve(t) * 2.0 ** k

    cand = np.concatenate([beats, (beats[:-1] + beats[1:]) / 2])
    orig = np.concatenate([np.ones(len(beats)), np.zeros(len(beats) - 1)])
    order = np.argsort(cand)
    cand, orig = cand[order], orig[order]
    w = (_strength(hits, "kick", cand) + _strength(hits, "snare", cand)
         + 0.5 * _strength(hits, "cymbal", cand) + 0.5 * orig)

    n = len(cand)
    score = np.full(n, -np.inf)
    prev = np.full(n, -1)
    p_first, p_last = period(beats[0]), period(beats[-1])
    for j in range(n):
        if cand[j] <= beats[0] + 1.5 * p_first:
            score[j] = w[j]
        i = j - 1
        while i >= 0 and cand[j] - cand[i] <= 1.6 * period(cand[j]):
            ratio = (cand[j] - cand[i]) / period((cand[i] + cand[j]) / 2)
            if ratio >= 0.6 and score[i] > -np.inf:
                s = score[i] - 10 * np.log2(ratio) ** 2 + w[j]
                if s > score[j]:
                    score[j], prev[j] = s, i
            i -= 1
    ends = np.where(cand >= beats[-1] - 1.5 * p_last)[0]
    j = int(ends[np.argmax(score[ends])])
    path = []
    while j >= 0:
        path.append(cand[j])
        j = prev[j]
    return np.array(path[::-1])


def _bar_phase(beats: np.ndarray, bpb: int, hits: list[Hit], db_votes: np.ndarray) -> int:
    """Qual batida abre o compasso, pelo padrão da bateria.

    Bumbo e prato de ataque no 1, caixa no 2 e no 4; os inícios de compasso do
    detector entram como mais um voto (só onde ele estava no andamento certo).
    """
    kick = _strength(hits, "kick", beats)
    snare = _strength(hits, "snare", beats)
    crash = _strength(hits, "cymbal", beats)
    if bpb == 4:
        weights = {0: (1.0, -1.0, 1.0), 1: (-0.3, 1.0, -0.3), 2: (0.5, -1.0, 0.2), 3: (-0.3, 1.0, -0.3)}
    else:
        weights = {q: (1.0, 0.0, 1.0) if q == 0 else (0.0, 0.0, 0.0) for q in range(bpb)}
    idx = np.arange(len(beats))
    best, phase = -np.inf, 0
    for ph in range(bpb):
        q = (idx - ph) % bpb
        wk, ws, wc = (np.array([weights[x][i] for x in q]) for i in range(3))
        s = float(np.sum(wk * kick + ws * snare + wc * crash) + 1.5 * np.sum(db_votes[q == 0]))
        if s > best:
            best, phase = s, ph
    return phase


def build_beats(beats: np.ndarray, downbeats: np.ndarray, duration: float,
                hits: list[Hit] | None = None) -> tuple[np.ndarray, int]:
    """Estende as batidas pra cobrir a música toda e alinha o índice 0 a um início de compasso.

    Assume fórmula de compasso constante (a mais votada). Com as notas da bateria,
    corrige trechos detectados no dobro/metade do andamento e decide o início do
    compasso pelo padrão da bateria; sem elas, usa só os downbeats do detector.
    """
    raw = np.unique(np.asarray(beats, dtype=float))
    if len(raw) < 4:
        raise SystemExit("Não consegui detectar as batidas da música.")
    beats = regularize_beats(raw, hits) if hits else raw
    ibi = float(np.median(np.diff(beats)))

    # Índice da batida mais próxima de cada downbeat, só onde o detector estava
    # no mesmo andamento (num trecho no dobro, os downbeats dele caem no meio do compasso).
    raw_ibi = np.interp(downbeats, (raw[:-1] + raw[1:]) / 2, np.diff(raw)) if len(downbeats) else []
    local = np.interp(downbeats, (beats[:-1] + beats[1:]) / 2, np.diff(beats)) if len(downbeats) else []
    idx = [int(np.argmin(np.abs(beats - d))) for d in downbeats]
    idx = sorted({i for i, d, r, l in zip(idx, downbeats, raw_ibi, local)
                  if abs(beats[i] - d) < 0.25 * ibi and abs(np.log2(r / l)) < 0.25})
    gaps = [g for g in np.diff(idx) if 2 <= g <= 7]
    if hits:
        # Detector no dobro do andamento enxerga compasso de 2: tab de bateria escreve 4/4 (e 6 vira 3).
        gaps = [{2: 4, 6: 3}.get(g, g) for g in gaps]
    bpb = int(Counter(gaps).most_common(1)[0][0]) if gaps else 4
    if hits:
        votes = np.zeros(len(beats))
        votes[idx] = 1
        phase = _bar_phase(beats, bpb, hits, votes)
    else:
        phase = int(Counter(i % bpb for i in idx).most_common(1)[0][0]) if idx else 0

    # Antes da primeira batida: completa até t <= 0 e até a fase ficar 0.
    head = []
    first = beats[0]
    while first > 0.0 or (len(head) + phase) % bpb:
        first -= ibi
        head.append(first)
    beats = np.concatenate([head[::-1], beats])

    # Depois da última: completa até passar do fim e fechar o compasso (+1 de borda).
    tail = []
    last = beats[-1]
    while last < duration or (len(beats) + len(tail) - 1) % bpb:
        last += ibi
        tail.append(last)
    return np.concatenate([beats, tail]), bpb


def _residuals(pos: np.ndarray, subdiv: int) -> tuple[float, float]:
    """Atraso mediano (em batidas) e erro médio de quantização após compensá-lo."""
    r = pos * subdiv - np.round(pos * subdiv)
    off = float(np.median(r))
    r = (pos - off / subdiv) * subdiv
    err = float(np.mean(np.abs(r - np.round(r)))) / subdiv
    return off / subdiv, err


def choose_subdiv(pos: np.ndarray) -> int:
    """Escolhe entre semicolcheia (4), tercina (3) ou sextina (6) pelo erro de encaixe."""
    err = {s: _residuals(pos, s)[1] for s in (4, 3, 6)}
    if min(err[3], err[6]) < 0.75 * err[4]:
        return 3 if err[3] <= err[6] * 1.15 else 6
    return 4


def beat_subdivs(pos: np.ndarray, n_beats: int, main: int) -> np.ndarray:
    """Subdivisão de cada batida: semicolcheia (4), tercina (3) ou sextina (6).

    Cada batida escolhe a grade em que suas notas encaixam melhor; trocar de
    grade entre batidas vizinhas e sair da grade principal da música custam um
    pouco, então uma nota meio torta não vira tercina sozinha, mas uma virada
    em tercinas no meio de um groove reto aparece.
    """
    options = (4, 3, 6)
    cost = np.zeros((n_beats, len(options)))
    beat = np.floor(pos + 1 / 24).astype(int)
    frac = pos - beat
    for j, s in enumerate(options):
        dev = np.abs(frac * s - np.round(frac * s)) / s
        ok = (beat >= 0) & (beat < n_beats)
        np.add.at(cost[:, j], beat[ok], dev[ok])
        cost[:, j] += (0.0 if s == main else 0.03) + (0.02 if s == 6 else 0.0)
    switch = 0.05
    total = cost[0].copy()
    back = np.zeros((n_beats, len(options)), dtype=int)
    for b in range(1, n_beats):
        trans = total[:, None] + switch * (1 - np.eye(len(options)))
        back[b] = np.argmin(trans, axis=0)
        total = trans[back[b], np.arange(len(options))] + cost[b]
    path = [int(np.argmin(total))]
    for b in range(n_beats - 1, 0, -1):
        path.append(back[b][path[-1]])
    return np.array([options[j] for j in path[::-1]])


def quantize(hits: list[Hit], beats: np.ndarray, bpb: int, subdiv: int | None) -> tuple[Grid, list[dict]]:
    """Encaixa as notas na grade. Retorna a grade e as notas com o passo de cada uma.

    Sem subdivisão fixa, cada batida escolhe a sua (beat_subdivs); se a música
    mistura reto e tercina, a grade vira 12 por batida e cada nota cai na grade da sua batida.
    """
    pos_all = np.interp([h.t for h in hits], beats, np.arange(len(beats)))
    # Usa só as peças "de tempo" pra medir atraso/subdivisão (pratos longos atrapalham).
    timing = np.array([p for p, h in zip(pos_all, hits) if h.piece in ("kick", "snare", "hihat", "ride")])
    if timing.size == 0:
        timing = pos_all
    main = subdiv or (choose_subdiv(timing) if timing.size else 4)
    offset, _ = _residuals(timing, main) if timing.size else (0.0, 0.0)
    per_beat = None
    if subdiv is None and pos_all.size:
        per_beat = beat_subdivs(pos_all - offset, len(beats), main)
        used = set(per_beat[np.unique(np.clip(np.floor(pos_all - offset + 1 / 24).astype(int), 0, len(beats) - 1))])
        if len(used) == 1:
            main, per_beat = int(used.pop()), None
    subdiv = 12 if per_beat is not None else main
    grid = Grid(beats=beats, beats_per_bar=bpb, subdiv=subdiv, offset=offset, beat_subdiv=per_beat)

    # Mesma peça no mesmo passo: fica a mais forte.
    cells: dict[tuple[str, int], dict] = {}
    for p, h in zip(pos_all, hits):
        if per_beat is not None:
            b = int(np.floor(p - offset + 1 / 24))
            s = int(per_beat[min(max(b, 0), len(per_beat) - 1)])
            step = b * 12 + int(np.round((p - offset - b) * s)) * (12 // s)
        else:
            step = int(np.round((p - offset) * subdiv))
        if step < 0 or step >= grid.n_bars * grid.steps_per_bar:
            continue
        key = (h.piece, step)
        if key not in cells or h.vel > cells[key]["vel"]:
            cells[key] = {"piece": h.piece, "step": step, "vel": round(h.vel, 3),
                          "conf": round(h.conf, 3), "t_raw": round(h.t, 4)}
    notes = sorted(cells.values(), key=lambda n: (n["step"], n["piece"]))
    mark_ghosts(notes)
    return grid, notes


def mark_ghosts(notes: list[dict]) -> None:
    """Caixa bem mais fraca que o normal da música = nota fantasma."""
    snare = [n["vel"] for n in notes if n["piece"] == "snare"]
    if len(snare) < 8:
        return
    typical = float(np.median(snare))
    for n in notes:
        n["ghost"] = n["piece"] == "snare" and n["vel"] < typical - 0.4
