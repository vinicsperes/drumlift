"""Compare the generated tab (song.json) with the test song's ground truth.

usage: python tests/score.py out/<song> song.truth.json
Aligns bars automatically (the tab's first bar may be silence).
"""

import json
import sys
from collections import Counter
from pathlib import Path


def main() -> None:
    song = json.loads((Path(sys.argv[1]) / "song.json").read_text())
    truth = json.loads(Path(sys.argv[2]).read_text())
    spb = song["beats_per_bar"] * song["subdiv"]
    scale = spb / truth.get("steps_per_bar", 16)
    ref = {(h["piece"], round(h["bar"] * spb + h["step"] * scale)) for h in truth["hits"]}
    got = {(n["piece"], n["step"]) for n in song["notes"]}

    best = max(range(-4 * spb, 4 * spb + 1), key=lambda sh: len(ref & {(p, s - sh) for p, s in got}))
    got = {(p, s - best) for p, s in got}
    print(f"grid {song['subdiv']}/beat, {song['tempo']:.1f} BPM, shift {best} steps")
    print(f"{'piece':<7}{'ref':>5}{'hits':>9}{'missed':>8}{'extra':>8}  F1")
    for piece in sorted({p for p, _ in ref | got}):
        r = {x for x in ref if x[0] == piece}
        g = {x for x in got if x[0] == piece}
        tp = len(r & g)
        f1 = 2 * tp / (len(r) + len(g)) if r or g else 1
        print(f"{piece:<7}{len(r):>5}{tp:>9}{len(r - g):>8}{len(g - r):>8}  {f1:.2f}")
    tp = len(ref & got)
    print(f"{'total':<7}{len(ref):>5}{tp:>9}{len(ref - got):>8}{len(got - ref):>8}  "
          f"{2 * tp / (len(ref) + len(got)):.2f}")
    confused = Counter((a, b) for a, s in ref - got for b, t in got - ref if s == t)
    if confused:
        print("swaps (truth -> tab):", dict(confused))


if __name__ == "__main__":
    main()
