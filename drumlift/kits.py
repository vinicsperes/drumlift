"""Synthesized drum sounds, with no samples to download.

Kits:
  acoustic - approximates an acoustic kit
  808      - classic electronic
  beeps    - one pitch per piece; good for hearing each line apart
  custom   - your samples: a folder with kick.wav, snare.wav, hihat.wav, tom.wav, crash.wav, ride.wav
"""

import shutil
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

SR = 44100
_rng = np.random.default_rng(7)


def _t(dur: float) -> np.ndarray:
    return np.arange(int(dur * SR)) / SR


def _env(t: np.ndarray, decay: float, attack: float = 0.001) -> np.ndarray:
    return np.minimum(t / attack, 1.0) * np.exp(-t / decay)


def _noise(n: int) -> np.ndarray:
    return _rng.uniform(-1, 1, n)


def _filt(x: np.ndarray, kind: str, f) -> np.ndarray:
    return sosfilt(butter(4, f, btype=kind, fs=SR, output="sos"), x)


def _sweep(t: np.ndarray, f_end: float, f_start: float, tau: float) -> np.ndarray:
    """Sine with pitch falling exponentially from f_start to f_end."""
    f = f_end + (f_start - f_end) * np.exp(-t / tau)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def _metal(t: np.ndarray, base: float = 1.0) -> np.ndarray:
    """Six inharmonic square waves (the 808 hi-hat trick)."""
    freqs = np.array([205.3, 304.4, 369.6, 522.7, 540.0, 800.0]) * base
    return sum(np.sign(np.sin(2 * np.pi * f * t + _rng.uniform(0, 6))) for f in freqs) / 6


def _norm(x: np.ndarray, peak: float = 0.9) -> np.ndarray:
    return (x / (np.abs(x).max() + 1e-9) * peak).astype(np.float32)


def _acoustic() -> dict[str, np.ndarray]:
    k = {}
    t = _t(0.5)
    click = _filt(_noise(len(t)), "lowpass", 3000) * _env(t, 0.003)
    k["kick"] = _norm(_sweep(t, 48, 140, 0.035) * _env(t, 0.22) + 0.4 * click)

    t = _t(0.4)
    tone = 0.6 * np.sin(2 * np.pi * 190 * t) * _env(t, 0.06) + 0.3 * np.sin(2 * np.pi * 340 * t) * _env(t, 0.04)
    wires = _filt(_noise(len(t)), "bandpass", [1200, 9000]) * _env(t, 0.12)
    k["snare"] = _norm(tone + wires)

    t = _t(0.15)
    hh = _filt(_noise(len(t)) * 0.7 + _metal(t, 2.0) * 0.5, "highpass", 7000)
    k["hihat"] = _norm(hh * _env(t, 0.03), 0.6)

    t = _t(0.7)
    k["tom"] = _norm(_sweep(t, 100, 170, 0.08) * _env(t, 0.28)
                     + 0.15 * _filt(_noise(len(t)), "bandpass", [300, 3000]) * _env(t, 0.02))

    t = _t(2.2)
    cr = _filt(_noise(len(t)) * 0.6 + _metal(t, 3.1) * 0.5, "highpass", 3500)
    k["crash"] = _norm(cr * _env(t, 0.8, 0.002), 0.7)

    t = _t(1.4)
    bell = sum(np.sin(2 * np.pi * f * t) * a for f, a in ((2950, 0.5), (4180, 0.3), (5600, 0.2)))
    wash = _filt(_noise(len(t)), "highpass", 5000) * 0.35
    k["ride"] = _norm((bell + wash) * _env(t, 0.55), 0.55)
    return k


def _808() -> dict[str, np.ndarray]:
    k = {}
    t = _t(0.8)
    k["kick"] = _norm(np.tanh(1.8 * _sweep(t, 50, 130, 0.03) * _env(t, 0.4)))

    t = _t(0.3)
    body = np.sin(2 * np.pi * 180 * t) * _env(t, 0.05) + 0.6 * np.sin(2 * np.pi * 330 * t) * _env(t, 0.03)
    snap = _filt(_noise(len(t)), "highpass", 2000) * _env(t, 0.09)
    k["snare"] = _norm(body + 0.8 * snap)

    t = _t(0.1)
    k["hihat"] = _norm(_filt(_metal(t, 2.0), "bandpass", [7000, 12000]) * _env(t, 0.025), 0.6)

    t = _t(0.5)
    k["tom"] = _norm(_sweep(t, 120, 160, 0.05) * _env(t, 0.2))

    t = _t(1.6)
    k["crash"] = _norm(_filt(_metal(t, 2.6) + 0.3 * _noise(len(t)), "highpass", 4000) * _env(t, 0.6), 0.65)

    t = _t(1.0)
    k["ride"] = _norm(_filt(_metal(t, 3.4), "bandpass", [3000, 9000]) * _env(t, 0.35), 0.5)
    return k


def _beeps() -> dict[str, np.ndarray]:
    def bip(freq: float, dur: float, decay: float, peak: float = 0.8) -> np.ndarray:
        t = _t(dur)
        return _norm(np.sin(2 * np.pi * freq * t) * _env(t, decay, 0.002), peak)

    return {
        "kick": bip(65, 0.25, 0.08),
        "snare": bip(440, 0.2, 0.06),
        "hihat": bip(3520, 0.06, 0.015, 0.5),
        "tom": bip(220, 0.25, 0.08),
        "crash": bip(1760, 0.6, 0.2, 0.6),
        "ride": bip(2637, 0.3, 0.08, 0.5),
    }


BUILTIN = {"acoustic": _acoustic, "808": _808, "beeps": _beeps}


def write_kits(dest: Path, custom: Path | None = None) -> dict[str, dict[str, str]]:
    """Write each kit's WAVs to dest/<kit>/<piece>.wav and return the relative paths."""
    index = {}
    for name, make in BUILTIN.items():
        d = dest / name
        d.mkdir(parents=True, exist_ok=True)
        index[name] = {}
        for piece, audio in make().items():
            sf.write(d / f"{piece}.wav", audio, SR, subtype="PCM_16")
            index[name][piece] = f"kits/{name}/{piece}.wav"
    if custom:
        d = dest / "custom"
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
        index["custom"] = {}
        for piece in index["acoustic"]:
            src = next((p for p in custom.glob(f"{piece}.*") if p.suffix.lower() in (".wav", ".flac", ".ogg", ".mp3")), None)
            if src is None:
                src = dest / "acoustic" / f"{piece}.wav"  # fill in what's missing
            shutil.copy(src, d / f"{piece}{src.suffix.lower()}")
            index["custom"][piece] = f"kits/custom/{piece}{src.suffix.lower()}"
    elif (dest / "custom").is_dir():  # keep the custom kit from an earlier run
        index["custom"] = {p.stem: f"kits/custom/{p.name}" for p in sorted((dest / "custom").iterdir())}
    return index


def load_kit(root: Path, paths: dict[str, str]) -> dict[str, np.ndarray]:
    """Read a written kit (mono, 44.1 kHz) for offline rendering."""
    import librosa

    out = {}
    for piece, rel in paths.items():
        y, _ = librosa.load(root / rel, sr=SR, mono=True)
        out[piece] = y.astype(np.float32)
    return out
