"""Drum pieces: display order in the tab, symbols and General MIDI notes."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Piece:
    key: str
    label: str  # line label in the tab
    name: str  # display name
    symbol: str  # character in the tab
    gm_note: int  # General MIDI note (channel 10)


# Top to bottom, like a normal drum tab.
PIECES = [
    Piece("crash", "CR", "Crash", "X", 49),
    Piece("ride", "RD", "Ride", "x", 51),
    Piece("hihat", "HH", "Hi-hat", "x", 42),
    Piece("snare", "SD", "Snare", "o", 38),
    Piece("tom", "T", "Tom", "o", 47),
    Piece("kick", "BD", "Kick", "o", 36),
]

BY_KEY = {p.key: p for p in PIECES}
ORDER = [p.key for p in PIECES]

GHOST_SYMBOL = "g"

# ADTOF outputs (LABELS_5 = [35, 38, 47, 42, 49]) -> pieces.
# The "cymbal" class is split into crash and ride later, by a density heuristic.
ADTOF_CLASSES = ["kick", "snare", "tom", "hihat", "cymbal"]
