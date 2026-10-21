"""Saídas legíveis: tablatura em texto e MIDI com mapa de andamento."""

from pathlib import Path

import mido
import numpy as np

from .grid import Grid
from .pieces import BY_KEY, GHOST_SYMBOL, ORDER

_COUNT = {
    2: ["{n}", "&"],
    3: ["{n}", "t", "l"],
    4: ["{n}", "e", "&", "a"],
    6: ["{n}", ".", ".", "&", ".", "."],
    8: ["{n}", ".", "e", ".", "&", ".", "a", "."],
}
_SUBDIV_NAME = {2: "colcheias", 3: "tercinas de colcheia", 4: "semicolcheias",
                6: "tercinas de semicolcheia", 8: "fusas"}


def fmt_time(t: float) -> str:
    t = max(0.0, t)
    return f"{int(t // 60)}:{t % 60:04.1f}"


def bar_cells(grid: Grid, notes: list[dict]) -> list[dict[str, list[str]]]:
    """Uma matriz de caracteres por compasso: {peça: [símbolo por passo]}."""
    spb = grid.steps_per_bar
    bars = [{k: ["-"] * spb for k in ORDER} for _ in range(grid.n_bars)]
    for n in notes:
        bar, col = divmod(n["step"], spb)
        sym = GHOST_SYMBOL if n.get("ghost") else BY_KEY[n["piece"]].symbol
        bars[bar][n["piece"]][col] = sym
    return bars


def bar_columns(grid: Grid, bar: int) -> list[int]:
    """Colunas do compasso que aparecem na tab: com grade mista, cada batida na sua subdivisão."""
    if grid.beat_subdiv is None:
        return list(range(grid.steps_per_bar))
    cols = []
    for b in range(grid.beats_per_bar):
        s = int(grid.beat_subdiv[bar * grid.beats_per_bar + b])
        cols += [b * 12 + j * (12 // s) for j in range(s)]
    return cols


def bar_count(grid: Grid, bar: int) -> str:
    """Linha de contagem de um compasso ("1e&a2e&a..." ou, com tercinas, "1tl2e&a...")."""
    if grid.beat_subdiv is None:
        return count_line(grid)
    out = ""
    for b in range(grid.beats_per_bar):
        for lab in _COUNT[int(grid.beat_subdiv[bar * grid.beats_per_bar + b])]:
            out += lab.format(n=b + 1)[-1]
    return out


def count_line(grid: Grid) -> str:
    labels = _COUNT.get(grid.subdiv, ["{n}"] + ["."] * (grid.subdiv - 1))
    out = ""
    for b in range(grid.beats_per_bar):
        for lab in labels:
            out += lab.format(n=b + 1)[-1]
    return out


def render_text(grid: Grid, notes: list[dict], title: str, bars_per_line: int = 4) -> str:
    used = [k for k in ORDER if any(n["piece"] == k for n in notes)]
    bars = bar_cells(grid, notes)
    bpm, lo, hi = grid.tempo()

    lines = [
        f"{title}",
        f"Andamento: ~{bpm:.0f} BPM (varia {lo:.0f}-{hi:.0f})   "
        f"Compasso: {grid.beats_per_bar}/4   Grade: "
        + ("semicolcheias e tercinas (cada tempo na sua)" if grid.beat_subdiv is not None
           else _SUBDIV_NAME.get(grid.subdiv, grid.subdiv)),
        "Legenda: " + "  ".join(f"{BY_KEY[k].label}={BY_KEY[k].name}" for k in used),
        f"         X/x = prato/chimbal   o = batida   {GHOST_SYMBOL} = nota fantasma (caixa fraca)",
        "",
    ]
    width = max(len(BY_KEY[k].label) for k in used) if used else 2

    def is_empty(b: int) -> bool:
        return all(c == "-" for k in used for c in bars[b][k])

    def row(b: int, k: str) -> str:
        return "".join(bars[b][k][c] for c in bar_columns(grid, b))

    def bar_key(b: int) -> tuple:
        return (bar_count(grid, b),) + tuple(row(b, k) for k in used)

    b = 0
    prev_block = None
    while b < grid.n_bars:
        if is_empty(b):
            e = b
            while e + 1 < grid.n_bars and is_empty(e + 1):
                e += 1
            rng = f"{b + 1}" if e == b else f"{b + 1}-{e + 1}"
            lines += [f"[{rng}] {fmt_time(grid.bar_start(b))}  (sem bateria)", ""]
            b = e + 1
            prev_block = None
            continue

        block = [b]
        while len(block) < bars_per_line and block[-1] + 1 < grid.n_bars and not is_empty(block[-1] + 1):
            block.append(block[-1] + 1)
        keys = [bar_key(i) for i in block]
        rng = f"{block[0] + 1}" if len(block) == 1 else f"{block[0] + 1}-{block[-1] + 1}"

        if prev_block is not None and keys == prev_block[1]:
            first = prev_block[0]
            lines += [f"[{rng}] {fmt_time(grid.bar_start(b))}  = igual aos compassos "
                      f"{first[0] + 1}-{first[-1] + 1}", ""]
        else:
            header = f"[{rng}] {fmt_time(grid.bar_start(b))}"
            lines.append(header)
            lines.append(" " * (width + 1) + " ".join(bar_count(grid, i) for i in block))
            for k in used:
                lines.append(f"{BY_KEY[k].label:<{width}}|" + "|".join(row(i, k) for i in block) + "|")
            lines.append("")
            prev_block = (block, keys)
        b = block[-1] + 1
    return "\n".join(lines).rstrip() + "\n"


def write_midi(grid: Grid, notes: list[dict], path: Path, title: str) -> None:
    """MIDI de bateria (canal 10) com um evento de andamento por batida.

    Cada batida vale exatamente 480 ticks, então editores de partitura
    (MuseScore, Guitar Pro, Reaper...) mostram as notas já no lugar certo
    da grade, e a reprodução continua sincronizada com a gravação original.
    """
    tpb = 480
    mid = mido.MidiFile(ticks_per_beat=tpb)
    tempo_track = mido.MidiTrack()
    drum_track = mido.MidiTrack()
    mid.tracks += [tempo_track, drum_track]

    tempo_track.append(mido.MetaMessage("track_name", name=title[:60], time=0))
    tempo_track.append(mido.MetaMessage("time_signature", numerator=grid.beats_per_bar,
                                        denominator=4, time=0))
    # Tick 0 = batida 0 da grade, que pode cair antes do início do áudio
    # (compasso incompleto no começo). Num DAW, posicione o áudio original
    # nesse deslocamento pra ficar sincronizado com o MIDI.
    lead = -float(grid.beats[0])
    tempo_track.append(mido.MetaMessage("marker", time=0,
                                        text=f"audio original em {lead:+.3f}s"))
    for i, dt in enumerate(np.diff(grid.beats)):
        tempo_track.append(mido.MetaMessage("set_tempo", tempo=int(round(dt * 1e6)),
                                            time=0 if i == 0 else tpb))

    drum_track.append(mido.MetaMessage("track_name", name="Bateria", time=0))
    events = []
    ticks_per_step = tpb // grid.subdiv if tpb % grid.subdiv == 0 else tpb / grid.subdiv
    for n in notes:
        tick = int(round(n["step"] * ticks_per_step))
        vel = 40 if n.get("ghost") else int(50 + 77 * n["vel"])
        note = BY_KEY[n["piece"]].gm_note
        events.append((tick, 1, note, vel))
        events.append((tick + tpb // 8, 0, note, 0))
    events.sort()
    last = 0
    for tick, on, note, vel in events:
        kind = "note_on" if on else "note_off"
        drum_track.append(mido.Message(kind, channel=9, note=note, velocity=vel, time=tick - last))
        last = tick
    mid.save(path)
