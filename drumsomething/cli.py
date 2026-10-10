import argparse
import json
from pathlib import Path

from . import pipeline, server


def _grid(v: str) -> int | None:
    if v == "auto":
        return None
    if v not in ("2", "3", "4", "6", "8"):
        raise argparse.ArgumentTypeError("use auto, 2, 3, 4, 6 ou 8")
    return int(v)


def main() -> None:
    ap = argparse.ArgumentParser(prog="drumsomething",
                                 description="Música -> bateria isolada -> tab -> tab tocando pra conferir de ouvido.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    tab_opts = argparse.ArgumentParser(add_help=False)
    tab_opts.add_argument("--grid", type=_grid, default=None,
                          help="divisões por tempo: auto (padrão), 4=semicolcheia, 3=tercina, 6, 8, 2")
    tab_opts.add_argument("--sens", type=float, default=1.0,
                          help="sensibilidade da detecção (1.0 padrão; 1.3 pega notas fracas, 0.8 só as fortes)")
    tab_opts.add_argument("--kit", type=Path, default=None,
                          help="pasta com seus samples (kick.wav, snare.wav, hihat.wav, tom.wav, crash.wav, ride.wav)")
    tab_opts.add_argument("--no-play", action="store_true", help="não abrir o player no final")
    tab_opts.add_argument("--port", type=int, default=8765)

    r = sub.add_parser("run", parents=[tab_opts], help="processa uma música (arquivo ou link)")
    r.add_argument("musica", help="arquivo de áudio (mp3, wav, flac...) ou link (precisa de yt-dlp)")
    r.add_argument("-o", "--out", type=Path, default=Path("out"), help="pasta de saída (padrão: out/)")
    r.add_argument("--from", dest="source", choices=["drums", "mix"], default="drums",
                   help="transcrever da bateria isolada (padrão) ou da música inteira")
    r.add_argument("--model", default="htdemucs", help="modelo do Demucs (htdemucs, htdemucs_ft = melhor e 4x mais lento)")
    r.add_argument("--device", default="cpu", choices=["cpu", "cuda"])
    r.add_argument("--force", action="store_true", help="refaz tudo, ignorando o cache")

    t = sub.add_parser("retab", parents=[tab_opts], help="regera a tab de uma música já processada (rápido)")
    t.add_argument("pasta", type=Path)
    t.add_argument("--from", dest="source", choices=["drums", "mix"], default=None)

    p = sub.add_parser("play", help="abre o player de uma música já processada")
    p.add_argument("pasta", type=Path)
    p.add_argument("--port", type=int, default=8765)

    a = ap.parse_args()
    if a.cmd == "play":
        server.serve(a.pasta, a.port)
        return

    if a.cmd == "run":
        outdir = pipeline.run(a.musica, a.out, model=a.model, device=a.device, subdiv=a.grid,
                              sensitivity=a.sens, source=a.source, custom_kit=a.kit, force=a.force)
    else:
        song_file = a.pasta / "song.json"
        song = json.loads(song_file.read_text()) if song_file.exists() else {"title": a.pasta.name, "source": "drums"}
        source = a.source or song["source"]
        pipeline.transcribe_stage(a.pasta, source)
        outdir = pipeline.build(a.pasta, song["title"], subdiv=a.grid, sensitivity=a.sens,
                                source=source, custom_kit=a.kit)

    print(f"\nPronto! Arquivos em {outdir}/")
    print("  tab.txt           tablatura")
    print("  drums.mid         MIDI (abre no MuseScore/Guitar Pro/Reaper)")
    print("  tab_with_band.wav banda sem a bateria original + tab tocando")
    if a.no_play:
        print(f"\nPra abrir o player: drumsomething play {outdir}")
    else:
        server.serve(outdir, a.port)


if __name__ == "__main__":
    main()
