"""Gera uma música de teste com bateria + baixo + acordes e o gabarito da bateria.

uso: python tests/make_test_song.py saida.wav [--bpm 104] [--bpm-end 112] [--bars 16] [--shuffle] [--ride]
Grava saida.wav e saida.truth.json ({piece, bar, step}; step em semicolcheias,
ou em tercinas de colcheia com --shuffle).
"""

import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf

from drumlift.kits import SR, _acustico

# Groove de 1 compasso em semicolcheias (16 passos).
GROOVE = {
    "hihat": [0, 2, 4, 6, 8, 10, 12, 14],
    "snare": [4, 12],
    "kick": [0, 7, 8, 10],
}
FILL = {"snare": [8, 9, 10, 11], "tom": [12, 13, 14, 15], "kick": [0, 8], "hihat": [0, 2, 4, 6]}
# Shuffle em tercinas (12 passos por compasso): chimbal "1 . a 2 . a ..."
SHUFFLE = {"hihat": [0, 2, 3, 5, 6, 8, 9, 11], "snare": [3, 9], "kick": [0, 5, 6]}
SHUFFLE_FILL = {"snare": [6, 7, 8], "tom": [9, 10, 11], "kick": [0], "hihat": [0, 2, 3, 5]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out", type=Path)
    ap.add_argument("--bpm", type=float, default=104)
    ap.add_argument("--bpm-end", type=float, default=None, help="acelera/desacelera até esse BPM")
    ap.add_argument("--bars", type=int, default=16)
    ap.add_argument("--shuffle", action="store_true")
    ap.add_argument("--ride", action="store_true", help="a cada 8 compassos, os 4 últimos conduzem no ride")
    a = ap.parse_args()

    rng = np.random.default_rng(1)
    kit = _acustico()
    lead = 1.3  # silêncio antes do primeiro compasso, pra testar o início
    bpm_end = a.bpm_end or a.bpm
    # Tempo de cada batida com o andamento mudando linearmente.
    bpms = np.linspace(a.bpm, bpm_end, a.bars * 4 + 1)
    beat_t = lead + np.concatenate([[0], np.cumsum(60 / bpms[:-1])])
    beat = 60 / a.bpm
    steps = 12 if a.shuffle else 16

    def when(bar: int, step: float) -> float:
        return float(np.interp(bar * 4 + step * 4 / steps, np.arange(len(beat_t)), beat_t))

    total = beat_t[-1] + 3
    mix = np.zeros(int(total * SR), dtype=np.float32)
    truth = []

    def add(sample: np.ndarray, t: float, gain: float) -> None:
        i = int(t * SR)
        seg = sample[: len(mix) - i]
        mix[i:i + len(seg)] += seg * gain

    for bar in range(a.bars):
        if a.shuffle:
            pattern = SHUFFLE_FILL if bar % 4 == 3 else SHUFFLE
        else:
            pattern = FILL if bar % 4 == 3 else GROOVE
        hits = {k: list(v) for k, v in pattern.items()}
        if bar % 4 == 0:
            hits["crash"] = [0]
            hits["hihat"] = [s for s in hits["hihat"] if s != 0]
        if a.ride and bar % 8 >= 4:
            hits["ride"] = hits.pop("hihat")
        for piece, positions in hits.items():
            for s in positions:
                t = when(bar, s) + rng.normal(0, 0.006)
                add(kit[piece], t, 0.5 if piece in ("hihat", "ride") and s % (steps // 4) else 0.8)
                truth.append({"piece": piece, "bar": bar, "step": s})

    # Baixo e acordes (pra ter algo além da bateria pro Demucs separar).
    roots = [55.0, 55.0, 43.65, 49.0]
    for bar in range(a.bars):
        f = roots[bar % 4]
        for q in range(8):
            t0 = when(bar, q * steps / 8)
            n = int(beat / 2 * SR * 0.9)
            tt = np.arange(n) / SR
            tone = np.sign(np.sin(2 * np.pi * f * tt)) * np.exp(-tt / 0.25) * 0.15
            add(tone.astype(np.float32), t0, 1.0)
        n = int(4 * beat * SR)
        tt = np.arange(n) / SR
        chord = sum(np.sin(2 * np.pi * f * m * 4 * tt) for m in (1, 1.26, 1.5)) * 0.04
        add((chord * np.minimum(tt / 0.2, 1)).astype(np.float32), when(bar, 0), 1.0)

    mix /= np.abs(mix).max() / 0.9
    sf.write(a.out, np.stack([mix, mix], axis=1), SR)
    a.out.with_suffix(".truth.json").write_text(json.dumps({"bpm": a.bpm, "steps_per_bar": steps, "hits": truth}))
    print(f"{a.out}: {a.bars} compassos, {a.bpm}->{bpm_end} BPM, {len(truth)} notas")


if __name__ == "__main__":
    main()
