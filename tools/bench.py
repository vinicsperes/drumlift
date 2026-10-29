"""Mede a tab gerada contra um gabarito: as notas no tempo certo e a tab escrita igual.

uso: uv run python tools/bench.py [--retab] GABARITO...

Cada gabarito `<nome>.ref.json` (ou `<nome>.truth.json`, das músicas sintéticas) é
comparado com `out/<nome>/song.json`. Com --retab, refaz a tab (etapa rápida) antes.

Duas medidas:
- notas: cada nota do gabarito é posta no tempo do áudio (alinhamento compasso a
  compasso pelo bumbo/caixa/tom/prato) e casada com as notas detectadas a até 50 ms.
  Diz se a transcrição ouviu as notas, sem depender da grade.
- tab: compasso e posição no compasso têm que ser exatamente os do gabarito
  (com um deslocamento de compassos fixo pra música toda). Diz se a tab escrita
  está certa: andamento, início de compasso e subdivisão.

Formato .ref.json: {"bars": [{"num", "den", "bpm"}], "notes": [{"bar", "pos", "gm", "grace"}]},
pos em semínimas desde o início do compasso (fração em texto, ex. "5/2").
"""

import argparse
import json
import sys
from collections import Counter, defaultdict
from fractions import Fraction
from pathlib import Path

import numpy as np

CLASSES = ["kick", "snare", "hihat", "tom", "cymbal"]
# General MIDI + extras do Guitar Pro/Songsterr (91-98).
GM = {35: "kick", 36: "kick", 37: "snare", 38: "snare", 40: "snare", 91: "snare",
      41: "tom", 43: "tom", 45: "tom", 47: "tom", 48: "tom", 50: "tom",
      42: "hihat", 44: "hihat", 46: "hihat", 92: "hihat",
      49: "cymbal", 51: "cymbal", 52: "cymbal", 53: "cymbal", 55: "cymbal", 57: "cymbal",
      59: "cymbal", 93: "cymbal", 94: "cymbal", 95: "cymbal", 96: "cymbal", 97: "cymbal", 98: "cymbal"}
PIECE = {"kick": "kick", "snare": "snare", "hihat": "hihat", "tom": "tom", "crash": "cymbal", "ride": "cymbal"}
ANCHORS = ("kick", "snare", "tom", "cymbal")
TOL = 0.05


def load_ref(path: Path) -> tuple[list[dict], list[tuple[int, Fraction, str]]]:
    """Compassos e notas (compasso, posição em semínimas, classe), sem repetidas nem apojaturas."""
    d = json.loads(path.read_text())
    if "hits" in d:  # gabarito das músicas sintéticas (passos fixos por compasso)
        spb = d.get("steps_per_bar", 16)
        nbars = max(h["bar"] for h in d["hits"]) + 1
        bars = [{"num": 4, "den": 4, "bpm": d["bpm"]}] * nbars
        notes = {(h["bar"], Fraction(4 * h["step"], spb), PIECE[h["piece"]]) for h in d["hits"]}
    else:
        bars = d["bars"]
        notes = {(n["bar"], Fraction(n["pos"]), GM[n["gm"]]) for n in d["notes"]
                 if not n["grace"] and n["gm"] in GM}
    return bars, sorted(notes)


def match(ref_t, det_t, tol: float = TOL) -> list[tuple[int, int]]:
    """Casamento 1-pra-1, do par mais próximo pro mais distante."""
    det_t = np.asarray(det_t)
    cands = []
    for i, r in enumerate(ref_t):
        lo, hi = np.searchsorted(det_t, [r - tol, r + tol])
        cands += [(abs(det_t[j] - r), i, j) for j in range(lo, hi)]
    used_r, used_d, pairs = set(), set(), []
    for _, i, j in sorted(cands):
        if i not in used_r and j not in used_d:
            used_r.add(i); used_d.add(j); pairs.append((i, j))
    return pairs


def hits_near(t: np.ndarray, det: np.ndarray, tol: float) -> np.ndarray:
    """Quantos tempos de `t` (qualquer forma) têm uma nota detectada a até `tol`."""
    flat = t.ravel()
    k = np.clip(np.searchsorted(det, flat), 1, len(det) - 1)
    d = np.minimum(np.abs(det[k] - flat), np.abs(det[k - 1] - flat))
    return (d <= tol).reshape(t.shape)


def align(bars: list[dict], ref: list, det: dict[str, np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """Início (s) e duração de semínima (s) de cada compasso do gabarito no áudio.

    Primeiro um DTW grosso (10 quadros/s) entre o gabarito no andamento escrito e
    as notas detectadas, peça por peça; ele acha o lugar de cada compasso mesmo
    com introdução repetitiva e andamento solto. Depois cada compasso é ajustado
    fino em volta desse lugar. Cada nota do gabarito só conta se a mesma peça foi
    detectada ali.
    """
    import librosa

    n = len(bars)
    length = np.array([4 * b["num"] / b["den"] for b in bars])
    nominal = np.array([60 / b["bpm"] for b in bars])
    nom_start = np.concatenate([[0], np.cumsum(length * nominal)])
    by_bar = defaultdict(lambda: defaultdict(list))
    for bar, p, c in ref:
        if c in ANCHORS and len(det.get(c, [])) > 1:
            by_bar[bar][c].append(float(p))
    pos = {m: {c: np.array(v) for c, v in d.items()} for m, d in by_bar.items()}

    fps = 10
    classes = [c for c in ANCHORS if len(det.get(c, [])) > 1]

    def roll(times: dict[str, np.ndarray], dur: float) -> np.ndarray:
        x = np.zeros((len(classes) + 1, int(dur * fps) + 2))
        for i, c in enumerate(classes):
            f = np.clip(np.round(np.asarray(times.get(c, [])) * fps).astype(int), 0, x.shape[1] - 1)
            np.add.at(x[i], f, 1.0)
        x[:-1] = np.maximum(x[:-1], 0.5 * np.roll(x[:-1], 1, axis=1))
        x[-1] = 0.3 * (x[:-1].sum(0) == 0)  # quadro sem nota também casa com quadro sem nota
        return x

    ref_t = defaultdict(list)
    for m, d in pos.items():
        for c, v in d.items():
            ref_t[c] += list(nom_start[m] + v * nominal[m])
    end = max(max(v) for v in det.values() if len(v)) + 2
    X, Y = roll(ref_t, nom_start[-1]), roll(det, end)
    _, wp = librosa.sequence.dtw(X=X, Y=Y, metric="cosine")
    wp = wp[::-1] / fps
    to_audio = lambda t: np.interp(t, wp[:, 0], wp[:, 1])  # noqa: E731

    def hits(A: np.ndarray, B: np.ndarray, p: dict[str, np.ndarray], tol: float = 0.03) -> np.ndarray:
        return sum(hits_near(A[..., None] + B[..., None] * v, det[c], tol).sum(-1) for c, v in p.items())

    def refine(starts: np.ndarray, spq: np.ndarray) -> tuple[float, np.ndarray, np.ndarray]:
        starts, spq, total = starts.copy(), spq.copy(), 0.0
        for m in range(n):
            p = pos.get(m)
            if p is None or sum(len(v) for v in p.values()) < 3:
                continue
            a = starts[m] + np.arange(-0.15, 0.1501, 0.005)
            b = spq[m] * np.arange(0.96, 1.0401, 0.005)
            A, B = np.meshgrid(a, b, indexing="ij")
            score = hits(A, B, p) - 0.01 * np.abs(A - starts[m]) / 0.15
            i, j = np.unravel_index(np.argmax(score), score.shape)
            starts[m], spq[m] = A[i, j], B[i, j]
            total += hits(np.array(starts[m]), np.array(spq[m]), p)
        return total, starts, spq

    count = {m: sum(len(v) for v in d.values()) for m, d in pos.items()}
    first = min(m for m, k in count.items() if k >= 3)

    def chain(a0: float, b0: float) -> tuple[np.ndarray, np.ndarray]:
        """Compasso a compasso a partir do primeiro (bom quando o DTW se perde num trecho)."""
        starts, spq = np.zeros(n), np.zeros(n)
        starts[first], spq[first] = a0, b0
        for m in range(first + 1, n):
            starts[m] = starts[m - 1] + length[m - 1] * spq[m - 1]
            spq[m] = spq[m - 1] * nominal[m] / nominal[m - 1]
            p = pos.get(m)
            if p is None or count[m] < 3:
                continue
            A, B = np.meshgrid(starts[m] + np.arange(-0.12, 0.1201, 0.005),
                               spq[m] * np.arange(0.97, 1.0301, 0.005), indexing="ij")
            score = hits(A, B, p) - 0.01 * np.abs(A - starts[m]) / 0.12 - 0.01 * np.abs(B / spq[m] - 1) / 0.03
            i, j = np.unravel_index(np.argmax(score), score.shape)
            starts[m], spq[m] = A[i, j], B[i, j]
        for m in range(first - 1, -1, -1):
            spq[m] = spq[m + 1]
            starts[m] = starts[m + 1] - length[m] * spq[m]
        return starts, spq

    # Inclinação do DTW por compasso é ruidosa (quadros de 100 ms): mediana de 9 compassos.
    spq = np.diff(to_audio(nom_start)) / length
    spq = np.where(spq > 0, spq, nominal)
    spq = np.array([np.median(spq[max(0, m - 4):m + 5]) for m in range(n)])
    via_dtw = refine(to_audio(nom_start[:-1]), spq)
    # A corrente parte de onde o DTW pôs o primeiro compasso, ou até 8 tempos antes/depois
    # (numa introdução repetitiva o DTW pode errar o começo por alguns tempos).
    a0 = float(to_audio(nom_start[first]))
    b0 = float(spq[first])
    options = [via_dtw] + [refine(*chain(a0 + k * b0, b0)) for k in range(-8, 9)]
    best = max(options, key=lambda r: r[0])
    return best[1], best[2]


def prf(nref: int, ndet: int, tp: int) -> tuple[float, float, float]:
    p, r = (tp / ndet if ndet else 0.0), (tp / nref if nref else 0.0)
    return p, r, (2 * p * r / (p + r) if p + r else 0.0)


def score_song(ref_path: Path, song: dict) -> dict:
    bars, ref = load_ref(ref_path)
    det = [(n["t_raw"], PIECE[n["piece"]]) for n in song["notes"]]
    starts, spq = align(bars, ref, {c: np.array(sorted(t for t, k in det if k == c)) for c in ANCHORS})

    # notas no tempo
    note = {}
    for c in CLASSES:
        R = sorted(starts[b] + float(p) * spq[b] for b, p, k in ref if k == c)
        D = sorted(t for t, k in det if k == c)
        note[c] = (len(R), len(D), len(match(R, D)))

    # tab escrita
    spb, sub = song["beats_per_bar"] * song["subdiv"], song["subdiv"]
    got = {(n["step"] // spb, Fraction(n["step"] % spb, sub), PIECE[n["piece"]]) for n in song["notes"]}
    refset = set(ref)
    shift = max(range(-8, 9), key=lambda s: len(refset & {(b - s, p, c) for b, p, c in got}))
    got = {(b - shift, p, c) for b, p, c in got}
    tab = {c: (sum(x[2] == c for x in refset), sum(x[2] == c for x in got),
               sum(x[2] == c for x in refset & got)) for c in CLASSES}
    by_bar_ref, by_bar_got = defaultdict(set), defaultdict(set)
    for x in refset:
        by_bar_ref[x[0]].add(x)
    for x in got:
        by_bar_got[x[0]].add(x)
    exact = sum(by_bar_ref[m] == by_bar_got[m] for m in range(len(bars)) if by_bar_ref[m])
    errors = {"faltou": Counter(), "sobrou": Counter()}
    for kind, mine, other in (("faltou", refset - got, got), ("sobrou", got - refset, refset)):
        at = defaultdict(set)
        for b, p, c in other:
            at[(b, p)].add(c)
        for b, p, c in mine:
            if any((b, q, c) in other for q in at_offsets(p)):
                errors[kind][f"{c}: posição perto mas diferente"] += 1
            elif at[(b, p)] - {c}:
                errors[kind][f"{c}: {'saiu' if kind == 'faltou' else 'era'} {'+'.join(sorted(at[(b, p)] - {c}))}"] += 1
            else:
                errors[kind][f"{c}: nada ali"] += 1

    # compassos no lugar: início de compasso do drumlift a até 70 ms de um do gabarito
    beats = np.array(song["beats"])
    dl_starts = beats[:: song["beats_per_bar"]]
    placed = int(hits_near(starts, dl_starts, 0.07).sum())

    return {"note": note, "tab": tab, "bars": len(bars), "bars_with_notes": len(by_bar_ref),
            "exact": exact, "placed": placed, "dl_bars": len(dl_starts) - 1, "shift": shift,
            "ref_bpm": float(np.median(60 / spq)), "dl_bpm": song["tempo"],
            "ref_sig": f"{bars[0]['num']}/{bars[0]['den']}", "dl_sig": f"{song['beats_per_bar']}/4",
            "subdiv": song["subdiv"], "errors": errors}


def at_offsets(p: Fraction) -> list[Fraction]:
    """Posições vizinhas (até uma semicolcheia) onde a mesma nota conta como 'perto'."""
    return [p + Fraction(k, 12) for k in range(-3, 4) if k]


def table(title: str, counts: dict) -> list[str]:
    lines = [f"  {title:<7} {'gab':>5} {'drumlift':>8} {'certas':>6}  precisão  pegou      F"]
    tot = [0, 0, 0]
    for c in CLASSES:
        nr, nd, tp = counts[c]
        tot = [tot[0] + nr, tot[1] + nd, tot[2] + tp]
        if nr or nd:
            p, r, f = prf(nr, nd, tp)
            lines.append(f"  {c:<7} {nr:5} {nd:8} {tp:6}  {p:7.0%}  {r:6.0%}  {f:5.0%}")
    p, r, f = prf(*tot)
    lines.append(f"  {'total':<7} {tot[0]:5} {tot[1]:8} {tot[2]:6}  {p:7.0%}  {r:6.0%}  {f:5.0%}")
    return lines


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("refs", nargs="+", type=Path)
    ap.add_argument("--retab", action="store_true", help="refaz a tab antes de medir")
    ap.add_argument("--out", type=Path, default=Path("out"))
    ap.add_argument("-q", "--quiet", action="store_true", help="só o resumo")
    ap.add_argument("-e", "--erros", action="store_true", help="mostra de onde vêm os erros da tab")
    a = ap.parse_args()

    summary = []
    for ref_path in a.refs:
        name = ref_path.name.removesuffix(".ref.json").removesuffix(".truth.json")
        outdir = a.out / name
        if not (outdir / "song.json").exists():
            print(f"{name}: sem {outdir}/song.json, pulei", file=sys.stderr)
            continue
        if a.retab:
            from drumlift import pipeline
            song = json.loads((outdir / "song.json").read_text())
            pipeline.build(outdir, song["title"], source=song.get("source", "drums"), player=False)
        song = json.loads((outdir / "song.json").read_text())
        r = score_song(ref_path, song)
        note_f = prf(*map(sum, zip(*r["note"].values())))[2]
        tab_f = prf(*map(sum, zip(*r["tab"].values())))[2]
        summary.append((name, note_f, tab_f, r))
        if not a.quiet:
            print(f"\n{name}")
            print(f"  gabarito {r['bars']} compassos {r['ref_sig']} a ~{r['ref_bpm']:.0f} BPM | drumlift "
                  f"{r['dl_bars']} compassos {r['dl_sig']} a ~{r['dl_bpm']:.0f} BPM, grade {r['subdiv']}/batida")
            print(f"  compassos no lugar certo: {r['placed']}/{r['bars']}   "
                  f"idênticos ao gabarito: {r['exact']}/{r['bars_with_notes']}   (deslocamento {r['shift']:+d})")
            print("\n".join(table("notas", r["note"])))
            print("\n".join(table("tab", r["tab"])))
            if a.erros:
                for kind, cnt in r["errors"].items():
                    print(f"  {kind}: " + "; ".join(f"{k} {v}" for k, v in sorted(cnt.items())))

    if summary:
        print(f"\n{'música':<40} {'notas F':>8} {'tab F':>6} {'no lugar':>9} {'idênticos':>10}")
        for name, nf, tf, r in summary:
            print(f"{name[:40]:<40} {nf:8.0%} {tf:6.0%} {r['placed'] / r['bars']:9.0%} "
                  f"{r['exact'] / max(1, r['bars_with_notes']):10.0%}")


if __name__ == "__main__":
    main()
