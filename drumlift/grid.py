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
    subdiv: int  # divisões por batida (4 = semicolcheias, 3 = tercinas...)
    offset: float  # atraso médio das notas em relação à grade, em batidas

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


def build_beats(beats: np.ndarray, downbeats: np.ndarray, duration: float) -> tuple[np.ndarray, int]:
    """Estende as batidas pra cobrir a música toda e alinha o índice 0 a um início de compasso.

    Assume fórmula de compasso constante (a mais votada) e usa os downbeats só
    pra decidir a fase; isso evita compassos tortos quando o detector erra um.
    """
    beats = np.unique(np.asarray(beats, dtype=float))
    if len(beats) < 4:
        raise SystemExit("Não consegui detectar as batidas da música.")
    ibi = float(np.median(np.diff(beats)))

    # Índice da batida mais próxima de cada downbeat.
    idx = [int(np.argmin(np.abs(beats - d))) for d in downbeats]
    idx = sorted({i for i, d in zip(idx, downbeats) if abs(beats[i] - d) < 0.25 * ibi})
    gaps = [g for g in np.diff(idx) if 2 <= g <= 7]
    bpb = int(Counter(gaps).most_common(1)[0][0]) if gaps else 4
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


def quantize(hits: list[Hit], beats: np.ndarray, bpb: int, subdiv: int | None) -> tuple[Grid, list[dict]]:
    """Encaixa as notas na grade. Retorna a grade e as notas com o passo de cada uma."""
    pos_all = np.interp([h.t for h in hits], beats, np.arange(len(beats)))
    # Usa só as peças "de tempo" pra medir atraso/subdivisão (pratos longos atrapalham).
    timing = np.array([p for p, h in zip(pos_all, hits) if h.piece in ("kick", "snare", "hihat", "ride")])
    if timing.size == 0:
        timing = pos_all
    if subdiv is None:
        subdiv = choose_subdiv(timing) if timing.size else 4
    offset, _ = _residuals(timing, subdiv) if timing.size else (0.0, 0.0)
    grid = Grid(beats=beats, beats_per_bar=bpb, subdiv=subdiv, offset=offset)

    # Mesma peça no mesmo passo: fica a mais forte.
    cells: dict[tuple[str, int], dict] = {}
    for p, h in zip(pos_all, hits):
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
