"""Transcrição da bateria (ADTOF) e detecção de batidas/compassos (beat_this)."""

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfiltfilt

from .pieces import ADTOF_CLASSES

FPS = 100


@dataclass
class Hit:
    piece: str
    t: float  # segundos, posição detectada (sem quantizar)
    conf: float  # ativação do modelo no pico (0-1)
    vel: float = 1.0  # intensidade estimada (0-1)


def adtof_activations(audio: Path, device: str = "cpu") -> np.ndarray:
    """Ativações por frame [T, 5] a 100 fps, ordem de ADTOF_CLASSES."""
    from adtof_pytorch import transcribe_to_midi

    pred = transcribe_to_midi(audio, "/dev/null", return_activations=True, device=device)
    return np.asarray(pred[0], dtype=np.float32)


def pick_hits(act: np.ndarray, sensitivity: float = 1.0) -> list[Hit]:
    """Picos das ativações -> lista de batidas. sensitivity > 1 pega mais notas."""
    from adtof_pytorch import FRAME_RNN_THRESHOLDS, PeakPicker

    thresholds = [t / sensitivity for t in FRAME_RNN_THRESHOLDS]
    peaks = PeakPicker(thresholds=thresholds, fps=FPS).pick(act, labels=list(range(5)))[0]
    hits = []
    for cls, times in peaks.items():
        for t in times:
            frame = int(round(t * FPS))
            lo, hi = max(0, frame - 2), min(len(act), frame + 3)
            hits.append(Hit(ADTOF_CLASSES[cls], float(t), float(act[lo:hi, cls].max())))
    hits.sort(key=lambda h: h.t)
    return hits


def split_cymbals(hits: list[Hit], beats: np.ndarray) -> None:
    """Separa a classe 'cymbal' do ADTOF em crash ou ride.

    Heurística: agrupa os pratos em sequências (intervalo de até 1 tempo entre
    batidas). Sequência longa e regular é condução (ride); batidas avulsas ou
    curtas são ataque (crash). Rotular a sequência inteira evita uma linha
    que pula de um prato pro outro a cada nota.
    """
    cym = [h for h in hits if h.piece == "cymbal"]
    if not cym:
        return
    pos = np.interp([h.t for h in cym], beats, np.arange(len(beats)))
    runs, cur = [], [0]
    for i in range(1, len(cym)):
        if pos[i] - pos[i - 1] <= 1.05:
            cur.append(i)
        else:
            runs.append(cur)
            cur = [i]
    runs.append(cur)
    for run in runs:
        ride = len(run) >= 6 and pos[run[-1]] - pos[run[0]] >= 3
        for i in run:
            cym[i].piece = "ride" if ride else "crash"


# Banda de frequência usada pra medir a força de cada peça na bateria isolada.
_BANDS = {
    "kick": (None, 120),
    "snare": (900, 5000),
    "tom": (70, 350),
    "hihat": (7000, None),
    "crash": (4000, None),
    "ride": (4000, None),
}


def estimate_velocity(hits: list[Hit], drums_wav: Path) -> None:
    """Estima a intensidade de cada batida pela energia na banda da peça.

    Normaliza por peça: a batida mais forte (percentil 95) vira 1.0 e
    24 dB abaixo vira 0.
    """
    audio, sr = sf.read(drums_wav, dtype="float32", always_2d=True)
    mono = audio.mean(axis=1)
    by_piece: dict[str, list[Hit]] = {}
    for h in hits:
        by_piece.setdefault(h.piece, []).append(h)

    for piece, group in by_piece.items():
        lo, hi = _BANDS[piece]
        if lo and hi:
            sos = butter(4, [lo, hi], btype="bandpass", fs=sr, output="sos")
        elif lo:
            sos = butter(4, lo, btype="highpass", fs=sr, output="sos")
        else:
            sos = butter(4, hi, btype="lowpass", fs=sr, output="sos")
        band = np.abs(sosfiltfilt(sos, mono))
        db = []
        for h in group:
            a, b = int((h.t - 0.005) * sr), int((h.t + 0.04) * sr)
            seg = band[max(0, a):max(a + 1, b)]
            db.append(20 * np.log10(seg.max() + 1e-9) if seg.size else -120.0)
        db = np.array(db)
        ref = np.percentile(db, 95)
        for h, d in zip(group, db):
            h.vel = float(np.clip((d - ref + 24) / 24, 0.05, 1.0))


def track_beats(mix_wav: Path, device: str = "cpu") -> tuple[np.ndarray, np.ndarray]:
    """Tempos (s) das batidas e dos inícios de compasso."""
    from beat_this.inference import File2Beats

    beats, downbeats = File2Beats(checkpoint_path="final0", device=device, dbn=False)(str(mix_wav))
    return np.asarray(beats, dtype=float), np.asarray(downbeats, dtype=float)
