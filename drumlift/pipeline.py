"""Runs the stages. The heavy ones are cached in the song's folder."""

import json
import re
import shutil
import time
import unicodedata
from importlib.resources import files
from pathlib import Path

import numpy as np
import soundfile as sf

from . import kits, render, separate, tab, transcribe
from .grid import Grid, build_beats, quantize
from .pieces import BY_KEY, ORDER


def slugify(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower() or "song"


def log(msg: str) -> None:
    print(f"\033[1;36m▸\033[0m {msg}", flush=True)


def run(src: str, out_root: Path, *, model: str = "htdemucs", device: str = "cpu",
        subdiv: int | None = None, sensitivity: float = 1.0, source: str = "drums",
        custom_kit: Path | None = None, force: bool = False) -> Path:
    if re.match(r"https?://", src):
        log("Downloading audio...")
        src_path = separate.download(src, out_root / "_downloads")
    else:
        src_path = Path(src).expanduser()
        if not src_path.exists():
            raise SystemExit(f"File not found: {src_path}")
    title = src_path.stem
    outdir = out_root / slugify(title)
    outdir.mkdir(parents=True, exist_ok=True)

    if force or not (outdir / "drums.wav").exists():
        log(f"Converting {src_path.name}")
        separate.to_wav(src_path, outdir / "mix.wav")
        log(f"Isolating the drums with Demucs ({model}, {device}), takes a few minutes on CPU")
        t0 = time.time()
        separate.separate_drums(outdir / "mix.wav", outdir, model=model, device=device)
        log(f"  done in {time.time() - t0:.0f}s")
    else:
        log("Drums already isolated (cache)")

    beats_file = outdir / "beats.json"
    if force or not beats_file.exists():
        log("Detecting beats and bars (beat_this)")
        beats, downbeats = transcribe.track_beats(outdir / "mix.wav", device=device)
        beats_file.write_text(json.dumps({"beats": beats.tolist(), "downbeats": downbeats.tolist()}))

    transcribe_stage(outdir, source, device, force)
    return build(outdir, title, subdiv=subdiv, sensitivity=sensitivity, source=source,
                 custom_kit=custom_kit)


def transcribe_stage(outdir: Path, source: str, device: str = "cpu", force: bool = False) -> None:
    act_file = outdir / f"activations_{source}.npy"
    if force or not act_file.exists():
        log(f"Transcribing the drums (ADTOF, from {'isolated drums' if source == 'drums' else 'mix'})")
        t0 = time.time()
        act = transcribe.adtof_activations(outdir / ("drums.wav" if source == "drums" else "mix.wav"), device)
        np.save(act_file, act)
        log(f"  done in {time.time() - t0:.0f}s")


def build(outdir: Path, title: str, *, subdiv: int | None = None, sensitivity: float = 1.0,
          source: str = "drums", custom_kit: Path | None = None, player: bool = True) -> Path:
    """Fast stage: from the cached activations to tab, MIDI, audio and player.

    With player=False it writes only song.json, tab.txt and drums.mid (for quick measuring).
    """
    log("Building the tab")
    raw = json.loads((outdir / "beats.json").read_text())
    act = np.load(outdir / f"activations_{source}.npy")
    duration = sf.info(outdir / "mix.wav").duration
    hits = transcribe.drop_tom_doubles(transcribe.pick_hits(act, sensitivity))
    beats, bpb = build_beats(np.array(raw["beats"]), np.array(raw["downbeats"]), duration, hits)
    transcribe.split_cymbals(hits, beats)
    transcribe.estimate_velocity(hits, outdir / "drums.wav")
    grid, notes = quantize(hits, beats, bpb, subdiv)

    meta = {"title": title, "duration": duration, "source": source, "sensitivity": sensitivity,
            "kits": kits.write_kits(outdir / "kits", custom_kit) if player else {}}
    save(outdir, grid, notes, meta, render_audio=player)
    if player:
        shutil.copytree(Path(str(files("drumlift") / "player")), outdir, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns(
                            "kit3d-dev.html", "lab.html", "lab", "FBXLoader.js", "NURBS*.js", "fflate.module.js"))

    counts = {BY_KEY[k].name: sum(n["piece"] == k for n in notes) for k in ORDER}
    bpm, lo, hi = grid.tempo()
    log(f"~{bpm:.0f} BPM, {grid.beats_per_bar}/4, {grid.n_bars} bars, grid {grid.subdiv}/beat")
    log("Notes: " + ", ".join(f"{k} {v}" for k, v in counts.items() if v))
    return outdir


def save(outdir: Path, grid: Grid, notes: list[dict], meta: dict, render_audio: bool = True) -> None:
    """Write song.json, tab.txt, drums.mid and the rendered audio."""
    bpm, lo, hi = grid.tempo()
    used = [k for k in ORDER if any(n["piece"] == k for n in notes)]
    song = {
        **meta,
        "tempo": round(bpm, 2), "tempo_range": [round(lo, 2), round(hi, 2)],
        "beats_per_bar": grid.beats_per_bar, "subdiv": grid.subdiv,
        "offset": grid.offset, "beats": [round(b, 5) for b in grid.beats.tolist()],
        **({"beat_subdiv": grid.beat_subdiv.tolist()} if grid.beat_subdiv is not None else {}),
        "count": tab.count_line(grid),
        "pieces": [{"key": p.key, "label": p.label, "name": p.name, "symbol": p.symbol,
                    "used": p.key in used} for p in map(BY_KEY.get, ORDER)],
        "notes": [{**n, "t": round(float(t), 4)}
                  for n, t in zip(notes, grid.step_time([n["step"] for n in notes]))],
        "audio": {"mix": "mix.wav", "drums": "drums.wav", "band": "no_drums.wav"},
    }
    (outdir / "song.json").write_text(json.dumps(song, ensure_ascii=False))
    (outdir / "tab.txt").write_text(tab.render_text(grid, notes, meta["title"]))
    tab.write_midi(grid, notes, outdir / "drums.mid", meta["title"])
    if render_audio:
        kit = kits.load_kit(outdir, meta["kits"]["acoustic"])
        render.write_renders(outdir, grid, notes, kit)


def load(outdir: Path) -> tuple[Grid, list[dict], dict]:
    song = json.loads((outdir / "song.json").read_text())
    grid = Grid(beats=np.array(song["beats"]), beats_per_bar=song["beats_per_bar"],
                subdiv=song["subdiv"], offset=song["offset"],
                beat_subdiv=np.array(song["beat_subdiv"]) if "beat_subdiv" in song else None)
    meta = {k: song[k] for k in ("title", "duration", "source", "sensitivity", "kits")}
    return grid, song["notes"], meta
