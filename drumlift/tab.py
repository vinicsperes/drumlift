"""Readable output: a text tab and MIDI with a tempo map."""

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
_SUBDIV_NAME = {2: "eighths", 3: "eighth triplets", 4: "sixteenths",
                6: "sixteenth triplets", 8: "thirty-seconds"}


def fmt_time(t: float) -> str:
    t = max(0.0, t)
    return f"{int(t // 60)}:{t % 60:04.1f}"


def bar_cells(grid: Grid, notes: list[dict]) -> list[dict[str, list[str]]]:
    """One character matrix per bar: {piece: [symbol per step]}."""
    spb = grid.steps_per_bar
    bars = [{k: ["-"] * spb for k in ORDER} for _ in range(grid.n_bars)]
    for n in notes:
        bar, col = divmod(n["step"], spb)
        sym = GHOST_SYMBOL if n.get("ghost") else BY_KEY[n["piece"]].symbol
        bars[bar][n["piece"]][col] = sym
    return bars


def bar_columns(grid: Grid, bar: int) -> list[int]:
    """Bar columns shown in the tab: on a mixed grid, each beat on its own subdivision."""
    if grid.beat_subdiv is None:
        return list(range(grid.steps_per_bar))
    cols = []
    for b in range(grid.beats_per_bar):
        s = int(grid.beat_subdiv[bar * grid.beats_per_bar + b])
        cols += [b * 12 + j * (12 // s) for j in range(s)]
    return cols


def bar_count(grid: Grid, bar: int) -> str:
    """Count line of a bar ("1e&a2e&a..." or, with triplets, "1tl2e&a...")."""
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
        f"Tempo: ~{bpm:.0f} BPM (range {lo:.0f}-{hi:.0f})   "
        f"Time: {grid.beats_per_bar}/4   Grid: "
        + ("sixteenths and triplets (per beat)" if grid.beat_subdiv is not None
           else _SUBDIV_NAME.get(grid.subdiv, grid.subdiv)),
        "Legend: " + "  ".join(f"{BY_KEY[k].label}={BY_KEY[k].name}" for k in used),
        f"         X/x = cymbal/hi-hat   o = hit   {GHOST_SYMBOL} = ghost note (weak snare)",
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
            lines += [f"[{rng}] {fmt_time(grid.bar_start(b))}  (no drums)", ""]
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
            lines += [f"[{rng}] {fmt_time(grid.bar_start(b))}  = same as bars "
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
    """Drum MIDI (channel 10) with one tempo event per beat.

    Each beat is exactly 480 ticks, so score editors (MuseScore, Guitar Pro,
    Reaper...) show the notes on the right grid position, and playback stays in
    sync with the original recording.
    """
    tpb = 480
    mid = mido.MidiFile(ticks_per_beat=tpb)
    tempo_track = mido.MidiTrack()
    drum_track = mido.MidiTrack()
    mid.tracks += [tempo_track, drum_track]

    tempo_track.append(mido.MetaMessage("track_name", name=title[:60], time=0))
    tempo_track.append(mido.MetaMessage("time_signature", numerator=grid.beats_per_bar,
                                        denominator=4, time=0))
    # Tick 0 = grid beat 0, which can fall before the audio starts (an incomplete
    # first bar). In a DAW, place the original audio at this offset to sync with the MIDI.
    lead = -float(grid.beats[0])
    tempo_track.append(mido.MetaMessage("marker", time=0,
                                        text=f"original audio at {lead:+.3f}s"))
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
