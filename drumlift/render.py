"""Renderiza a tab como áudio, nos tempos reais da música."""

from pathlib import Path

import numpy as np
import soundfile as sf

from .grid import Grid

SR = 44100


def synth_track(grid: Grid, notes: list[dict], kit: dict[str, np.ndarray], duration: float) -> np.ndarray:
    out = np.zeros(int(round(duration * SR)) + SR * 3, dtype=np.float32)
    times = grid.step_time([n["step"] for n in notes])
    for n, t in zip(notes, times):
        sample = kit[n["piece"]]
        gain = 0.25 if n.get("ghost") else 0.35 + 0.65 * n["vel"]
        i = int(round(t * SR))
        if not 0 <= i < len(out):
            continue
        out[i:i + len(sample)] += sample[: len(out) - i] * gain
    return out[: int(round(duration * SR))]


def write_renders(outdir: Path, grid: Grid, notes: list[dict], kit: dict[str, np.ndarray]) -> None:
    """tab_synth.wav (só a tab) e tab_with_band.wav (banda sem bateria + tab)."""
    band, _ = sf.read(outdir / "no_drums.wav", dtype="float32", always_2d=True)
    duration = len(band) / SR
    drums = synth_track(grid, notes, kit, duration)
    drums *= 0.9 / (np.abs(drums).max() + 1e-9)
    sf.write(outdir / "tab_synth.wav", drums, SR, subtype="PCM_16")

    mix = band + drums[:, None] * 0.8
    mix *= min(1.0, 0.98 / (np.abs(mix).max() + 1e-9))
    sf.write(outdir / "tab_with_band.wav", mix, SR, subtype="PCM_16")
