import argparse
import json
from pathlib import Path

from . import pipeline, server


def _grid(v: str) -> int | None:
    if v == "auto":
        return None
    if v not in ("2", "3", "4", "6", "8"):
        raise argparse.ArgumentTypeError("use auto, 2, 3, 4, 6 or 8")
    return int(v)


def main() -> None:
    ap = argparse.ArgumentParser(prog="drumlift",
                                 description="Song -> isolated drums -> tab -> the tab played back to check by ear.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    tab_opts = argparse.ArgumentParser(add_help=False)
    tab_opts.add_argument("--grid", type=_grid, default=None,
                          help="divisions per beat: auto (default), 4=sixteenths, 3=triplets, 6, 8, 2")
    tab_opts.add_argument("--sens", type=float, default=1.0,
                          help="detection sensitivity (1.0 default; 1.3 catches weak notes, 0.8 only strong ones)")
    tab_opts.add_argument("--kit", type=Path, default=None,
                          help="folder with your samples (kick.wav, snare.wav, hihat.wav, tom.wav, crash.wav, ride.wav)")
    tab_opts.add_argument("--no-play", action="store_true", help="don't open the player at the end")
    tab_opts.add_argument("--port", type=int, default=8765)

    r = sub.add_parser("run", parents=[tab_opts], help="process a song (file or link)")
    r.add_argument("song", help="audio file (mp3, wav, flac...) or link (needs yt-dlp)")
    r.add_argument("-o", "--out", type=Path, default=Path("out"), help="output folder (default: out/)")
    r.add_argument("--from", dest="source", choices=["drums", "mix"], default="drums",
                   help="transcribe the isolated drums (default) or the full mix")
    r.add_argument("--model", default="htdemucs", help="Demucs model (htdemucs, htdemucs_ft = better and 4x slower)")
    r.add_argument("--device", default="cpu", choices=["cpu", "cuda"])
    r.add_argument("--force", action="store_true", help="redo everything, ignoring the cache")

    t = sub.add_parser("retab", parents=[tab_opts], help="rebuild the tab of a processed song (fast)")
    t.add_argument("folder", type=Path)
    t.add_argument("--from", dest="source", choices=["drums", "mix"], default=None)

    p = sub.add_parser("play", help="open the player for a processed song")
    p.add_argument("folder", type=Path)
    p.add_argument("--port", type=int, default=8765)

    a = ap.parse_args()
    if a.cmd == "play":
        server.serve(a.folder, a.port)
        return

    if a.cmd == "run":
        outdir = pipeline.run(a.song, a.out, model=a.model, device=a.device, subdiv=a.grid,
                              sensitivity=a.sens, source=a.source, custom_kit=a.kit, force=a.force)
    else:
        song_file = a.folder / "song.json"
        song = json.loads(song_file.read_text()) if song_file.exists() else {"title": a.folder.name, "source": "drums"}
        source = a.source or song["source"]
        pipeline.transcribe_stage(a.folder, source)
        outdir = pipeline.build(a.folder, song["title"], subdiv=a.grid, sensitivity=a.sens,
                                source=source, custom_kit=a.kit)

    print(f"\nDone! Files in {outdir}/")
    print("  tab.txt           tab")
    print("  drums.mid         MIDI (opens in MuseScore/Guitar Pro/Reaper)")
    print("  tab_with_band.wav band without the original drums + the tab")
    if a.no_play:
        print(f"\nTo open the player: drumlift play {outdir}")
    else:
        server.serve(outdir, a.port)


if __name__ == "__main__":
    main()
