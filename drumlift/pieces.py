"""Peças da bateria: ordem de exibição na tab, símbolos e notas General MIDI."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Piece:
    key: str
    label: str  # rótulo da linha na tab
    name: str  # nome em português
    symbol: str  # caractere na tab
    gm_note: int  # nota General MIDI (canal 10)


# De cima pra baixo, como numa tab de bateria normal.
PIECES = [
    Piece("crash", "CR", "Prato de ataque", "X", 49),
    Piece("ride", "RD", "Prato de condução", "x", 51),
    Piece("hihat", "HH", "Chimbal", "x", 42),
    Piece("snare", "SD", "Caixa", "o", 38),
    Piece("tom", "T", "Tom", "o", 47),
    Piece("kick", "BD", "Bumbo", "o", 36),
]

BY_KEY = {p.key: p for p in PIECES}
ORDER = [p.key for p in PIECES]

GHOST_SYMBOL = "g"

# Saídas do ADTOF (LABELS_5 = [35, 38, 47, 42, 49]) -> peças.
# A classe "cymbal" é separada em crash/ride depois, por heurística de densidade.
ADTOF_CLASSES = ["kick", "snare", "tom", "hihat", "cymbal"]
