"""Rhythmic grid: bars from the beats, and note quantization.

The grid follows the song's real beats, not a fixed BPM, so a band that drifts
in tempo doesn't misalign the tab.
"""

from collections import Counter
from dataclasses import dataclass

import numpy as np

from .transcribe import Hit


@dataclass
class Grid:
    beats: np.ndarray  # time (s) of each beat; bar i starts at beat i*beats_per_bar
    beats_per_bar: int
    subdiv: int  # divisions per beat (4 = sixteenths, 3 = triplets...; 12 = mixed)
    offset: float  # mean delay of the notes against the grid, in beats
    # With subdiv 12: subdivision of each beat (4, 3 or 6), to write each beat on its own grid.
    beat_subdiv: np.ndarray | None = None

    @property
    def steps_per_bar(self) -> int:
        return self.beats_per_bar * self.subdiv

    @property
    def n_bars(self) -> int:
        return (len(self.beats) - 1) // self.beats_per_bar

    def beat_pos(self, t) -> np.ndarray:
        """Seconds -> continuous position in beats."""
        return np.interp(t, self.beats, np.arange(len(self.beats)), left=np.nan, right=np.nan)

    def step_time(self, step) -> np.ndarray:
        """Grid step index -> seconds (mean delay already compensated)."""
        return np.interp(np.asarray(step) / self.subdiv + self.offset,
                         np.arange(len(self.beats)), self.beats)

    def bar_start(self, bar: int) -> float:
        return float(self.beats[bar * self.beats_per_bar])

    def tempo(self) -> tuple[float, float, float]:
        """Median BPM and range (5th-95th percentile), measured per bar to ignore beat jitter."""
        bar_len = np.diff(self.beats[:: self.beats_per_bar])
        bpm = 60 * self.beats_per_bar / bar_len
        return float(np.median(bpm)), float(np.percentile(bpm, 5)), float(np.percentile(bpm, 95))


def _strength(hits: list[Hit], piece: str, times: np.ndarray, win: float = 0.04) -> np.ndarray:
    """Confidence of the `piece` note nearest each time (0 if none within `win`)."""
    sel = [h for h in hits if h.piece == piece]
    if not sel:
        return np.zeros(len(times))
    ht = np.array([h.t for h in sel])
    hc = np.array([h.conf for h in sel])
    k = np.clip(np.searchsorted(ht, times), 1, max(1, len(ht) - 1))
    out = np.zeros(len(times))
    for j in (k - 1, np.minimum(k, len(ht) - 1)):
        near = np.abs(ht[j] - times) <= win
        out = np.where(near, np.maximum(out, hc[j]), out)
    return out


def _period_curve(beats: np.ndarray):
    """Beat length over the song, in a single octave.

    The tracker sometimes follows double or half the tempo in a section. Each
    interval is doubled or halved to the octave of the median interval before the
    running median, so those flips don't contaminate the curve.
    """
    d = np.diff(beats)
    p0 = float(np.median(d))
    folded = d * 2.0 ** np.round(np.log2(p0 / d))
    k = 8
    smooth = np.array([np.median(folded[max(0, i - k):i + k + 1]) for i in range(len(folded))])
    mids = (beats[:-1] + beats[1:]) / 2
    return lambda t: np.interp(t, mids, smooth)


def _octave(period, hits: list[Hit]) -> int:
    """How many octaves to move the tempo so the snare lands on 2 and 4.

    In a rock or pop groove the snare marks the backbeat, so the most common
    interval between snares is two beats. Returns k (beat = curve * 2**k).
    """
    s = np.array(sorted(h.t for h in hits if h.piece == "snare"))
    if len(s) < 16:
        return 0
    r = np.log2(np.diff(s) / period(s[:-1]))
    votes = {k: int(np.sum(np.abs(r - (k + 1)) < 0.15)) for k in (-1, 0, 1)}
    best = max(votes, key=votes.get)
    bpm = 60 / (float(np.median(period(s))) * 2.0 ** best)
    if best != 0 and votes[best] > 1.3 * votes[0] and 50 <= bpm <= 210:
        return best
    return 0


def regularize_beats(beats: np.ndarray, hits: list[Hit]) -> np.ndarray:
    """Beats in a single octave, following the tracker where it got them right.

    Dynamic programming over the tracked beats plus the midpoints between them
    (which cover sections tracked at half tempo). The path pays for intervals off
    the expected beat and earns from kick, snare and cymbal on the beat, which
    picks the beats to keep in a section tracked at double tempo.
    """
    curve = _period_curve(beats)
    k = _octave(curve, hits)

    def period(t):
        return curve(t) * 2.0 ** k

    cand = np.concatenate([beats, (beats[:-1] + beats[1:]) / 2])
    orig = np.concatenate([np.ones(len(beats)), np.zeros(len(beats) - 1)])
    order = np.argsort(cand)
    cand, orig = cand[order], orig[order]
    w = (_strength(hits, "kick", cand) + _strength(hits, "snare", cand)
         + 0.5 * _strength(hits, "cymbal", cand) + 0.5 * orig)

    # A jump of several beats (a gap with no tracked beats, in a break) is allowed
    # at a cost per filled beat; the missing ones are interpolated.
    n = len(cand)
    score = np.full(n, -np.inf)
    prev = np.full(n, -1)
    steps = np.ones(n, dtype=int)
    p_first, p_last = period(beats[0]), period(beats[-1])
    for j in range(n):
        if cand[j] <= beats[0] + 1.5 * p_first:
            score[j] = w[j]
        i = j - 1
        while i >= 0 and cand[j] - cand[i] <= 8.5 * period(cand[j]):
            ratio = (cand[j] - cand[i]) / period((cand[i] + cand[j]) / 2)
            if ratio >= 0.6 and score[i] > -np.inf:
                m = max(1, int(round(ratio)))
                s = score[i] - 10 * np.log2(ratio / m) ** 2 - (m - 1) + w[j]
                if s > score[j]:
                    score[j], prev[j], steps[j] = s, i, m
            i -= 1
    ends = np.where(cand >= beats[-1] - 1.5 * p_last)[0]
    if not ends.size or not np.isfinite(score[ends]).any():
        return beats
    j = int(ends[np.argmax(score[ends])])
    path = []
    while j >= 0:
        i = prev[j]
        if i >= 0 and steps[j] > 1:
            path += list(np.linspace(cand[j], cand[i], steps[j] + 1)[:-1])
        else:
            path.append(cand[j])
        j = i
    return np.array(path[::-1])


def _bar_phase(beats: np.ndarray, bpb: int, hits: list[Hit], db_votes: np.ndarray) -> int:
    """Which beat opens the bar, from the drum pattern.

    Kick and crash on 1, snare on 2 and 4. The tracker's downbeats count as one
    more vote, only where it had the right tempo.
    """
    kick = _strength(hits, "kick", beats)
    snare = _strength(hits, "snare", beats)
    crash = _strength(hits, "cymbal", beats)
    if bpb == 4:
        weights = {0: (1.0, -1.0, 1.0), 1: (-0.3, 1.0, -0.3), 2: (0.5, -1.0, 0.2), 3: (-0.3, 1.0, -0.3)}
    else:
        weights = {q: (1.0, 0.0, 1.0) if q == 0 else (0.0, 0.0, 0.0) for q in range(bpb)}
    idx = np.arange(len(beats))
    best, phase = -np.inf, 0
    for ph in range(bpb):
        q = (idx - ph) % bpb
        wk, ws, wc = (np.array([weights[x][i] for x in q]) for i in range(3))
        s = float(np.sum(wk * kick + ws * snare + wc * crash) + 1.5 * np.sum(db_votes[q == 0]))
        if s > best:
            best, phase = s, ph
    return phase


def build_beats(beats: np.ndarray, downbeats: np.ndarray, duration: float,
                hits: list[Hit] | None = None) -> tuple[np.ndarray, int]:
    """Extend the beats over the whole song and align index 0 to a downbeat.

    Assumes one time signature (the most voted). With the drum notes, it fixes
    sections tracked at double or half tempo and places the downbeat from the drum
    pattern; without them, it uses only the tracker's downbeats.
    """
    raw = np.unique(np.asarray(beats, dtype=float))
    if len(raw) < 4:
        raise SystemExit("Could not detect the song's beats.")
    beats = regularize_beats(raw, hits) if hits else raw
    ibi = float(np.median(np.diff(beats)))

    # Index of the beat nearest each downbeat, only where the tracker had the same
    # tempo (in a double-tempo section its downbeats land mid-bar).
    raw_ibi = np.interp(downbeats, (raw[:-1] + raw[1:]) / 2, np.diff(raw)) if len(downbeats) else []
    local = np.interp(downbeats, (beats[:-1] + beats[1:]) / 2, np.diff(beats)) if len(downbeats) else []
    idx = [int(np.argmin(np.abs(beats - d))) for d in downbeats]
    idx = sorted({i for i, d, r, l in zip(idx, downbeats, raw_ibi, local)
                  if abs(beats[i] - d) < 0.25 * ibi and abs(np.log2(r / l)) < 0.25})
    gaps = [g for g in np.diff(idx) if 2 <= g <= 7]
    if hits:
        # A tracker at double tempo sees bars of 2: drum tabs write 4/4 (and 6 becomes 3).
        gaps = [{2: 4, 6: 3}.get(g, g) for g in gaps]
    bpb = int(Counter(gaps).most_common(1)[0][0]) if gaps else 4
    if hits:
        votes = np.zeros(len(beats))
        votes[idx] = 1
        phase = _bar_phase(beats, bpb, hits, votes)
    else:
        phase = int(Counter(i % bpb for i in idx).most_common(1)[0][0]) if idx else 0

    # Before the first beat: fill until t <= 0 and the phase is 0.
    head = []
    first = beats[0]
    while first > 0.0 or (len(head) + phase) % bpb:
        first -= ibi
        head.append(first)
    beats = np.concatenate([head[::-1], beats])

    # After the last: fill past the end and close the bar (+1 as a margin).
    tail = []
    last = beats[-1]
    while last < duration or (len(beats) + len(tail) - 1) % bpb:
        last += ibi
        tail.append(last)
    return np.concatenate([beats, tail]), bpb


def _residuals(pos: np.ndarray, subdiv: int) -> tuple[float, float]:
    """Median delay (in beats) and mean quantization error after compensating it."""
    r = pos * subdiv - np.round(pos * subdiv)
    off = float(np.median(r))
    r = (pos - off / subdiv) * subdiv
    err = float(np.mean(np.abs(r - np.round(r)))) / subdiv
    return off / subdiv, err


def choose_subdiv(pos: np.ndarray) -> int:
    """Pick sixteenths (4), triplets (3) or sextuplets (6) by fit error."""
    err = {s: _residuals(pos, s)[1] for s in (4, 3, 6)}
    if min(err[3], err[6]) < 0.75 * err[4]:
        return 3 if err[3] <= err[6] * 1.15 else 6
    return 4


def beat_subdivs(pos: np.ndarray, n_beats: int, main: int) -> np.ndarray:
    """Subdivision of each beat: sixteenths (4), triplets (3) or sextuplets (6).

    Each beat picks the grid its notes fit best. Switching grids between neighboring
    beats and leaving the song's main grid cost a little, so one crooked note doesn't
    become a triplet, but a triplet fill in a straight groove still shows up.
    """
    options = (4, 3, 6)
    cost = np.zeros((n_beats, len(options)))
    beat = np.floor(pos + 1 / 24).astype(int)
    frac = pos - beat
    for j, s in enumerate(options):
        dev = np.abs(frac * s - np.round(frac * s)) / s
        ok = (beat >= 0) & (beat < n_beats)
        np.add.at(cost[:, j], beat[ok], dev[ok])
        cost[:, j] += (0.0 if s == main else 0.03) + (0.02 if s == 6 else 0.0)
    switch = 0.05
    total = cost[0].copy()
    back = np.zeros((n_beats, len(options)), dtype=int)
    for b in range(1, n_beats):
        trans = total[:, None] + switch * (1 - np.eye(len(options)))
        back[b] = np.argmin(trans, axis=0)
        total = trans[back[b], np.arange(len(options))] + cost[b]
    path = [int(np.argmin(total))]
    for b in range(n_beats - 1, 0, -1):
        path.append(back[b][path[-1]])
    return np.array([options[j] for j in path[::-1]])


def quantize(hits: list[Hit], beats: np.ndarray, bpb: int, subdiv: int | None) -> tuple[Grid, list[dict]]:
    """Fit the notes to the grid. Returns the grid and the notes with their steps.

    With no fixed subdivision, each beat picks its own (beat_subdivs). If the song
    mixes straight and triplets, the grid becomes 12 per beat and each note lands on
    its beat's grid.
    """
    pos_all = np.interp([h.t for h in hits], beats, np.arange(len(beats)))
    # Measure delay and subdivision on the timekeeping pieces only (long cymbals get in the way).
    timing = np.array([p for p, h in zip(pos_all, hits) if h.piece in ("kick", "snare", "hihat", "ride")])
    if timing.size == 0:
        timing = pos_all
    main = subdiv or (choose_subdiv(timing) if timing.size else 4)
    offset, _ = _residuals(timing, main) if timing.size else (0.0, 0.0)
    per_beat = None
    if subdiv is None and pos_all.size:
        per_beat = beat_subdivs(pos_all - offset, len(beats), main)
        used = set(per_beat[np.unique(np.clip(np.floor(pos_all - offset + 1 / 24).astype(int), 0, len(beats) - 1))])
        if len(used) == 1:
            main, per_beat = int(used.pop()), None
    subdiv = 12 if per_beat is not None else main
    grid = Grid(beats=beats, beats_per_bar=bpb, subdiv=subdiv, offset=offset, beat_subdiv=per_beat)

    # Same piece on the same step: keep the strongest.
    cells: dict[tuple[str, int], dict] = {}
    for p, h in zip(pos_all, hits):
        if per_beat is not None:
            b = int(np.floor(p - offset + 1 / 24))
            s = int(per_beat[min(max(b, 0), len(per_beat) - 1)])
            step = b * 12 + int(np.round((p - offset - b) * s)) * (12 // s)
        else:
            step = int(np.round((p - offset) * subdiv))
        if step < 0 or step >= grid.n_bars * grid.steps_per_bar:
            continue
        key = (h.piece, step)
        if key not in cells or h.vel > cells[key]["vel"]:
            cells[key] = {"piece": h.piece, "step": step, "vel": round(h.vel, 3),
                          "conf": round(h.conf, 3), "t_raw": round(h.t, 4)}
    notes = sorted(cells.values(), key=lambda n: (n["step"], n["piece"]))
    mark_ghosts(notes)
    return grid, notes


def mark_ghosts(notes: list[dict]) -> None:
    """A snare much weaker than the song's usual = ghost note."""
    snare = [n["vel"] for n in notes if n["piece"] == "snare"]
    if len(snare) < 8:
        return
    typical = float(np.median(snare))
    for n in notes:
        n["ghost"] = n["piece"] == "snare" and n["vel"] < typical - 0.4
