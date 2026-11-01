"""Audio preparation and drum separation with Demucs."""

import shutil
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 44100


def download(url: str, dest_dir: Path) -> Path:
    """Download the audio of a URL with yt-dlp (must be installed)."""
    exe = shutil.which("yt-dlp")
    if exe is None:
        raise SystemExit(
            "Links need yt-dlp: `uv tool install yt-dlp` "
            "(or pass a local audio file)."
        )
    dest_dir.mkdir(parents=True, exist_ok=True)
    template = str(dest_dir / "%(title)s.%(ext)s")
    out = subprocess.run(
        [exe, "-x", "--audio-format", "wav", "--no-playlist", "-o", template,
         "--print", "after_move:filepath", url],
        check=True, capture_output=True, text=True,
    )
    return Path(out.stdout.strip().splitlines()[-1])


def to_wav(src: Path, dst: Path) -> None:
    """Convert any format ffmpeg reads to 44.1 kHz stereo WAV."""
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
         "-vn", "-ac", "2", "-ar", str(SR), "-c:a", "pcm_s16le", str(dst)],
        check=True,
    )


def separate_drums(mix_wav: Path, outdir: Path, model: str = "htdemucs",
                   device: str = "cpu", shifts: int = 1) -> None:
    """Write drums.wav (isolated drums) and no_drums.wav (everything else)."""
    from demucs.api import Separator

    sep = Separator(model=model, device=device, shifts=shifts, progress=True)
    wav, stems = sep.separate_audio_file(mix_wav)
    drums = stems["drums"].numpy()
    rest = sum(v for k, v in stems.items() if k != "drums").numpy()
    mix = wav.numpy()

    # Same gain for everything, so the volumes stay comparable in the player.
    peak = max(np.abs(x).max() for x in (mix, drums, rest))
    gain = 0.99 / peak if peak > 0.99 else 1.0
    for name, x in (("mix", mix), ("drums", drums), ("no_drums", rest)):
        sf.write(outdir / f"{name}.wav", (x * gain).T, sep.samplerate, subtype="PCM_16")
