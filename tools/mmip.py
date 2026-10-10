"""Baixa performances de bateria da base MMIP e converte pro formato do drumSomething.

A MMIP (Universidade de Chipre / CYENS) tem captura de movimento de corpo inteiro
(com os dedos) de um baterista de rock, sincronizada com MIDI e áudio.
Licença CC BY-NC-SA 4.0: uso não comercial, com crédito.
Dados obtidos de https://mmip.cs.ucy.ac.cy, a base MMIP (Multi-Modal Instrument
Performances) da Universidade de Chipre e do CYENS – Centre of Excellence.

uso (no ambiente do projeto):
  uv run python tools/mmip.py list
  uv run python tools/mmip.py fetch 1 [2 ...]

Cada performance vai pra songs/mmip/<nn>/ (fora do git): take.fbx (movimento),
take.mid, audio.wav, meta.json e song.json, com as notas do MIDI no formato do
player e o tempo real de cada golpe (não o da grade), pra comparar o nosso
baterista com o real nota por nota.
"""

import argparse
import json
import ssl
import sys
import urllib.request
from pathlib import Path

import mido
import numpy as np
import soundfile as sf

from drumsomething import tab, transcribe
from drumsomething.grid import build_beats, quantize
from drumsomething.pieces import BY_KEY, ORDER

BASE = "https://mmip.cs.ucy.ac.cy"
ROOT = Path(__file__).resolve().parent.parent / "songs" / "mmip"
CREDIT = ("Dados obtidos de https://mmip.cs.ucy.ac.cy, a base MMIP (Multi-Modal Instrument Performances) "
          "da Universidade de Chipre e do CYENS – Centre of Excellence. CC BY-NC-SA 4.0.")

# Nota MIDI (GM, kit eletrônico) -> (peça, peça física). 44 é o pedal do chimbal.
NOTE_MAP = {
    35: ("kick", "kick"), 36: ("kick", "kick"),
    37: ("snare", "snare"), 38: ("snare", "snare"), 40: ("snare", "snare"),
    22: ("hihat", "hihat"), 26: ("hihat", "hihat"), 42: ("hihat", "hihat"), 46: ("hihat", "hihat"),
    44: ("pedal", None),
    49: ("crash", "crash"), 52: ("crash", "crash"), 55: ("crash", "crash"), 57: ("crash", "crash"),
    51: ("ride", "ride"), 53: ("ride", "ride"), 59: ("ride", "ride"),
    48: ("tom", "tom1"), 50: ("tom", "tom1"), 45: ("tom", "tom2"), 47: ("tom", "tom2"),
    41: ("tom", "floor"), 43: ("tom", "floor"),
}


def _open(path: str):
    # O servidor da MMIP não manda o certificado intermediário, então a
    # verificação falha fora do navegador. Só pra este host, sem verificação.
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return urllib.request.urlopen(BASE + path, context=ctx, timeout=120)


def drum_takes() -> list[dict]:
    with _open("/Server/initialize.php") as r:
        rows = json.load(r)
    return [x for x in rows if x["Instrument"]["Type"] == "Drums"]


def download(path: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        return
    tmp = dest.with_suffix(dest.suffix + ".part")
    with _open(path) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    tmp.rename(dest)


def midi_notes(path: Path) -> list[tuple[float, int, int]]:
    """(tempo em s, nota, velocidade) de cada note_on, com o mapa de andamento aplicado."""
    t, out = 0.0, []
    for msg in mido.MidiFile(path):
        t += msg.time
        if msg.type == "note_on" and msg.velocity > 0:
            out.append((t, msg.note, msg.velocity))
    return out


def convert(folder: Path, title: str) -> dict:
    """MIDI + áudio -> song.json (grade das batidas do áudio, tempos reais do MIDI)."""
    raw = midi_notes(folder / "take.mid")
    hits, pedal, unknown = [], [], {}
    for t, note, vel in raw:
        piece, inst = NOTE_MAP.get(note, (None, None))
        if piece is None:
            unknown[note] = unknown.get(note, 0) + 1
            continue
        if piece == "pedal":
            pedal.append(round(t, 4))
            continue
        h = transcribe.Hit(piece, t, 1.0, (vel / 127) ** 0.8)
        h.inst = inst
        hits.append(h)

    duration = sf.info(folder / "audio.wav").duration
    beats_raw, downbeats = transcribe.track_beats(folder / "audio.wav")
    beats, bpb = build_beats(beats_raw, downbeats, duration)
    grid, notes = quantize(hits, beats, bpb, None)

    # volta o tempo real e a peça física (tom 1, tom 2, surdo) de cada nota
    by_piece: dict[str, list] = {}
    for h in hits:
        by_piece.setdefault(h.piece, []).append(h)
    for n in notes:
        cands = by_piece[n["piece"]]
        best = min(cands, key=lambda h: abs(h.t - n["t_raw"]))
        n["t"] = round(best.t, 4)
        if n["piece"] == "tom":
            n["inst"] = best.inst

    bpm, lo, hi = grid.tempo()
    used = [k for k in ORDER if any(n["piece"] == k for n in notes)]
    song = {
        "title": title, "duration": duration, "source": "mmip", "sensitivity": 1.0,
        "tempo": round(bpm, 2), "tempo_range": [round(lo, 2), round(hi, 2)],
        "beats_per_bar": grid.beats_per_bar, "subdiv": grid.subdiv,
        "offset": grid.offset, "beats": [round(b, 5) for b in grid.beats.tolist()],
        "count": tab.count_line(grid),
        "pieces": [{"key": p.key, "label": p.label, "name": p.name, "symbol": p.symbol,
                    "used": p.key in used} for p in map(BY_KEY.get, ORDER)],
        "notes": notes,
        "pedal": pedal,
        "audio": {"drums": "audio.wav"},
        "credit": CREDIT,
    }
    (folder / "song.json").write_text(json.dumps(song, ensure_ascii=False))
    return {"notes": len(notes), "pedal": len(pedal), "unknown": unknown, "bpm": round(bpm, 1),
            "grid": grid.subdiv, "bars": grid.n_bars}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", help="lista as performances de bateria")
    f = sub.add_parser("fetch", help="baixa e converte performances (números da lista)")
    f.add_argument("ids", type=int, nargs="+")
    a = ap.parse_args()

    takes = drum_takes()
    if a.cmd == "list":
        for i, x in enumerate(takes, 1):
            m = x["Music"]
            print(f"{i:2d}  {m.get('Genre', '').strip():18s} {m.get('BPM', '?'):>4s} BPM  {m.get('Duration', '').split()[0]}")
        print(f"\n{CREDIT}")
        return

    for i in a.ids:
        if not 1 <= i <= len(takes):
            sys.exit(f"não existe a performance {i} (1 a {len(takes)})")
        x = takes[i - 1]
        folder = ROOT / f"{i:02d}"
        folder.mkdir(parents=True, exist_ok=True)
        d = x["Downloads"]
        print(f"[{i}] baixando...", flush=True)
        download(d["FBX"], folder / "take.fbx")
        download(d["MIDI"], folder / "take.mid")
        download(d["AUDIO"], folder / "audio.wav")
        m = x["Music"]
        title = f"MMIP {i:02d} — {m.get('Genre', '').strip()} {m.get('BPM', '')} BPM"
        (folder / "meta.json").write_text(json.dumps({**x, "credit": CREDIT}, ensure_ascii=False, indent=1))
        info = convert(folder, title)
        print(f"[{i}] {folder}: {info}", flush=True)


if __name__ == "__main__":
    main()
