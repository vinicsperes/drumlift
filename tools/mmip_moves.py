"""Build the drummer's motion library from the MMIP capture.

MMIP (University of Cyprus / CYENS, CC BY-NC-SA 4.0) has 14 drum performances with
the full body captured by a sensor suit, in sync with the MIDI. This produces a small
derived file, with credit and the same license, that the player uses to move like a
person:

- strokes of each hand: the hand's motion between two consecutive notes, described
  against the straight path between the two strike poses (the residual). That works on
  any kit: ours supplies the strike poses and the residual (lift, arc, wrist turn, elbow
  opening) comes from the real drummer. Compressed with PCA, per hand.
- body: how far the pelvis, spine, neck, head and clavicles leave the mean pose. Part
  follows the hands (the torso turns toward a far-reaching hand): a linear regression
  from the wrist positions (before, now and after) to the body deviations. The rest
  (sway, glances, adjustments) lives in 8-beat clips sampled in musical time, to play
  at our song's tempo.

usage (after `tools/mmip.py fetch` and `node tools/mmip_bones.mjs songs/mmip/NN`):
  uv run python tools/mmip_moves.py            # every downloaded performance
  uv run python tools/mmip_moves.py 5 6 7      # just some

Output: drumlift/player/kit3d/moves/mmip.json
"""

import argparse
import base64
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "songs" / "mmip"
OUT = ROOT / "drumlift" / "player" / "kit3d" / "moves" / "mmip.json"
CREDIT = ("Motion derived from the MMIP (Multi-Modal Instrument Performances) database of the University of "
          "Cyprus and CYENS Centre of Excellence, https://mmip.cs.ucy.ac.cy. CC BY-NC-SA 4.0.")

HANDS = ["MD", "ME"]
HAND_BONE = {"MD": "Right", "ME": "Left"}
INSTS = ["snare", "hihat", "tom1", "tom2", "floor", "crash", "ride"]
# typical x (m) of each piece on a right-handed kit: decides who plays what in a pair
SIDE_X = {"hihat": -0.47, "crash": -0.46, "snare": -0.15, "tom1": -0.03, "tom2": 0.27, "floor": 0.52, "ride": 0.74}

# Grip (same as kit3d/skeleton.js, right hand; x mirrors on the left): the stick's
# fulcrum and direction in hand space. Used to measure how the hand turns around the
# stick at the strike, which becomes our drummer's strike pose.
GRIP_DIR = np.array([-0.3, 0.95, 0.0])
N = 28            # samples per stroke
WARP = 0.75       # denser samples near the notes (rebound and descent)
GAP_MIN, GAP_MAX = 0.07, 2.4
K = 14            # PCA components per hand
# body: (bone, parent) of each deviation; the pelvis deviates in the world
BODY = [("Hips", None), ("Spine1", "Hips"), ("Spine3", "Spine1"), ("Spine4", "Spine3"), ("Neck", "Spine4"),
        ("Head", "Neck"), ("RightShoulder", "Spine4"), ("LeftShoulder", "Spine4")]
BODY_NAMES = ["pelve", "lombar", "toracica", "peito", "pescoco", "cabeca", "claviculaMD", "claviculaME"]
HP_SEC = 2.0      # removes anything slower than this (sensor suit drift)
LAGS = (-0.2, 0.0, 0.2)
SPB = 4           # samples per beat in the groove clips
CLIP = 8          # beats per clip (+1 of overlap for joining)
MAX_CLIPS = 240


# ---------- quaternions (x, y, z, w), vectorized ----------
def qmul(a, b):
    ax, ay, az, aw = np.moveaxis(a, -1, 0)
    bx, by, bz, bw = np.moveaxis(b, -1, 0)
    return np.stack([aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz], -1)


def qconj(q):
    return q * np.array([-1, -1, -1, 1.0])


def qrot(q, v):
    u, w = q[..., :3], q[..., 3:4]
    t = 2 * np.cross(u, v)
    return v + w * t + np.cross(u, t)


def qlog(q):
    """Rotation vector (axis * angle) of the quaternion."""
    q = q * np.where(q[..., 3:4] < 0, -1, 1)
    v = q[..., :3]
    s = np.linalg.norm(v, axis=-1, keepdims=True)
    a = 2 * np.arctan2(s, q[..., 3:4])
    return np.where(s > 1e-9, v / np.maximum(s, 1e-12) * a, 2 * v)


def qslerp(a, b, u):
    b = np.where((a * b).sum(-1, keepdims=True) < 0, -b, b)
    d = np.clip((a * b).sum(-1, keepdims=True), -1, 1)
    th = np.arccos(d)
    s = np.sin(th)
    u = np.asarray(u)[..., None] if np.ndim(u) else u
    wa = np.where(s > 1e-6, np.sin((1 - u) * th) / np.maximum(s, 1e-9), 1 - u)
    wb = np.where(s > 1e-6, np.sin(u * th) / np.maximum(s, 1e-9), u)
    r = wa * a + wb * b
    return r / np.linalg.norm(r, axis=-1, keepdims=True)


# FBX: the drummer faces +X with the right at +Z; here, faces -Z with the right at +X
QY90 = np.array([0, np.sin(np.pi / 4), 0, np.cos(np.pi / 4)])


def load_take(n: int) -> dict | None:
    d = DATA / f"{n:02d}"
    if not (d / "bones.f32").exists():
        return None
    meta = json.loads((d / "bones.json").read_text())
    raw = np.fromfile(d / "bones.f32", dtype=np.float32).reshape(meta["frames"], len(meta["bones"]), 7).astype(np.float64)
    pos = qrot(QY90, raw[..., :3])
    quat = qmul(np.broadcast_to(QY90, raw[..., 3:].shape), raw[..., 3:])
    B = {name: i for i, name in enumerate(meta["bones"])}
    # some sessions recorded bones turned 180° in x (y and z with flipped signs);
    # normalize to y along the bone and, on the hand, z on the back
    v = qrot(qconj(quat[:, B["Spine1"]]), pos[:, B["Spine2"]] - pos[:, B["Spine1"]]).mean(0)
    if v[1] < 0:
        flip = np.array([1.0, 0, 0, 0])
        for name, i in B.items():
            if name != "Hips":
                quat[:, i] = qmul(quat[:, i], np.broadcast_to(flip, quat[:, i].shape))
    song = json.loads((d / "song.json").read_text())
    return {"n": n, "fps": meta["fps"], "frames": meta["frames"], "pos": pos, "quat": quat, "B": B, "song": song}


def at(arr, fps, t):
    """Linear interpolation of arr (frames, ...) at times t (s)."""
    x = np.asarray(t) * fps
    i0 = np.clip(np.floor(x).astype(int), 0, len(arr) - 2)
    u = np.clip(x - i0, 0, 1)[..., None]
    return arr[i0] * (1 - u) + arr[i0 + 1] * u


def qat(q, fps, t):
    x = np.asarray(t) * fps
    i0 = np.clip(np.floor(x).astype(int), 0, len(q) - 2)
    return qslerp(q[i0], q[i0 + 1], np.clip(x - i0, 0, 1))


# ---------- who played each note ----------
def assign_hands(D: dict, shift: float = 0.0, rounds: int = 5):
    """Hand of each note (0 = right, 1 = left): the tip of a stick rigid in the hand must
    always land in the same place on each piece. Returns the hand notes, with the
    motion time (MIDI + shift)."""
    notes = sorted((n for n in D["song"]["notes"] if n["piece"] != "kick"), key=lambda n: n["t"])
    t = np.array([n["t"] for n in notes]) + shift
    inst = np.array([n.get("inst") or n["piece"] for n in notes])
    P, Q, B, fps = D["pos"], D["quat"], D["B"], D["fps"]
    names = [f"{HAND_BONE[h]}Hand" for h in HANDS]
    hp = [at(P[:, B[b]], fps, t) for b in names]
    hq = [qat(Q[:, B[b]], fps, t) for b in names]
    hand = np.full(len(t), -1)
    pair = np.zeros(len(t), bool)
    k = 0
    while k < len(t):
        e = k + 1
        while e < len(t) and t[e] - t[k] < 0.025:
            e += 1
        if e - k >= 2:
            a, b = k, k + 1
            a_right = inst[a] == "hihat" or (inst[b] != "hihat" and SIDE_X.get(inst[a], 0) >= SIDE_X.get(inst[b], 0))
            hand[a], hand[b] = (0, 1) if a_right else (1, 0)
            pair[k:e] = True
        else:
            dip = [at(P[:, B[n], 1], fps, t[k] - 0.1) - at(P[:, B[n], 1], fps, t[k]) for n in names]
            hand[k] = 0 if dip[0] >= dip[1] else 1
        k = e
    d = [np.array([0, 0.36, 0.0]), np.array([0, 0.36, 0.0])]
    tips = lambda h: hp[h] + qrot(hq[h], np.broadcast_to(d[h], hp[h].shape))
    for _ in range(rounds):
        T = [tips(0), tips(1)]
        pads = {}
        for i in set(inst):
            m = [(inst == i) & (hand == h) for h in (0, 1)]
            pads[i] = [T[h][m[h]].mean(0) if m[h].any() else None for h in (0, 1)]
        for h in (0, 1):
            sel = np.where(hand == h)[0]
            if not len(sel):
                continue
            c = np.array([pads[inst[s]][h] for s in sel])
            v = qrot(qconj(hq[h][sel]), c - hp[h][sel]).mean(0)
            d[h] = v / np.linalg.norm(v) * np.clip(np.linalg.norm(v), 0.26, 0.44)
        T = [tips(0), tips(1)]
        for s in np.where(~pair)[0]:
            c = [pads[inst[s]][h] for h in (0, 1)]
            c = [x for x in c if x is not None]
            if not c:
                continue
            c = np.mean(c, axis=0)
            hand[s] = 0 if np.linalg.norm(T[0][s] - c) <= np.linalg.norm(T[1][s] - c) else 1
    out = []
    for i, n in enumerate(notes):
        if hand[i] >= 0 and inst[i] in INSTS:
            out.append({"t": float(t[i]), "inst": inst[i], "vel": n["vel"], "hand": int(hand[i])})
    return out


def latency(D: dict, strokes: list) -> tuple[float, float]:
    """Motion delay against the MIDI (s), which varies by recording (-80 to +110 ms). At
    a strike the stick hits and rebounds: a point fixed on the hand, 30 cm past the wrist,
    jerks upward. Averaged over hundreds of strokes aligned by note, the peak of that jerk
    is the moment of the strike. Returns the delay and the peak's prominence (deviations
    above the mean)."""
    P, Q, B, fps = D["pos"], D["quat"], D["B"], D["fps"]
    lags = np.arange(-0.5, 0.5, 1 / 240)
    prof = np.zeros(len(lags))
    for h in (0, 1):
        bone = f"{HAND_BONE[HANDS[h]]}Hand"
        y = (P[:, B[bone]] + qrot(Q[:, B[bone]], np.broadcast_to([0, 0.3, 0.0], P[:, B[bone]].shape)))[:, 1]
        acc = np.zeros_like(y)
        acc[1:-1] = (y[2:] - 2 * y[1:-1] + y[:-2]) * fps * fps
        ix = np.arange(len(acc))
        for s in strokes:
            if s["hand"] == h:
                prof += np.interp((s["t"] + lags) * fps, ix, acc)
    k = int(np.argmax(prof))
    return float(lags[k]), float(prof[k] / (prof.std() + 1e-9))


def swivel(D: dict, h: int, t) -> np.ndarray:
    """Elbow opening (rad): rotation around the shoulder-wrist axis from "hanging",
    positive away from the body."""
    P, B, fps = D["pos"], D["B"], D["fps"]
    s = HAND_BONE[HANDS[h]]
    S, E, W = (at(P[:, B[f"{s}{b}"]], fps, t) for b in ("Arm", "ForeArm", "Hand"))
    A = W - S
    A /= np.linalg.norm(A, axis=-1, keepdims=True)
    down = np.array([0, -1.0, 0])
    r0 = down - (A @ down)[..., None] * A
    r0 /= np.linalg.norm(r0, axis=-1, keepdims=True)
    e = E - S
    e -= (e * A).sum(-1, keepdims=True) * A
    e /= np.linalg.norm(e, axis=-1, keepdims=True)
    side = 1 if h == 0 else -1
    return -np.arctan2((np.cross(r0, e) * A).sum(-1), (r0 * e).sum(-1)) * side


def roll(q, h):
    """Hand turn around the stick (rad): 0 = back of the hand up (German grip),
    + = thumb up on the right (mirrored on the left)."""
    u = GRIP_DIR * np.array([1 if h == 0 else -1, 1, 1])
    u = u / np.linalg.norm(u)
    sd = qrot(q, u)
    dz = qrot(q, np.array([0, 0, 1.0]))
    zs = dz - (dz @ sd) * sd
    zs /= np.linalg.norm(zs)
    ups = np.array([0, 1.0, 0]) - sd[1] * sd
    ups /= np.linalg.norm(ups)
    r = np.arctan2(np.cross(ups, zs) @ sd, ups @ zs)
    return r if h == 0 else -r


def warp(s):
    """Normalized time u (0..1) of sample s (0..1): denser at the ends."""
    return s - WARP * np.sin(2 * np.pi * s) / (2 * np.pi)


def minjerk(u):
    return u * u * u * (10 - 15 * u + 6 * u * u)


def heading(q):
    """Heading frame: y up, z behind the hand's heading (its y axis in the plane)."""
    fwd = qrot(q, np.broadcast_to([0, 1.0, 0], q.shape[:-1] + (3,)))
    fwd[..., 1] = 0
    fwd /= np.maximum(np.linalg.norm(fwd, axis=-1, keepdims=True), 1e-9)
    up = np.broadcast_to([0, 1.0, 0], fwd.shape)
    back = -fwd
    right = np.cross(up, back)
    return np.stack([right, up, back], -1)  # colunas


def segments(D: dict, strokes: list):
    """Strokes of each hand: the hand's residual between two consecutive notes."""
    P, Q, B, fps = D["pos"], D["quat"], D["B"], D["fps"]
    beats = np.array(D["song"]["beats"])
    beat_len = lambda t: float(np.interp(t, beats[1:], np.diff(beats)))
    s = np.linspace(0, 1, N)
    uu = warp(s)
    sig = minjerk(uu)
    out = {h: [] for h in HANDS}
    for h, name in enumerate(HANDS):
        bone = f"{HAND_BONE[name]}Hand"
        st = [x for x in strokes if x["hand"] == h]
        tc = np.array([x["t"] for x in st])
        for k in range(len(st) - 1):
            a, b = st[k], st[k + 1]
            g = tc[k + 1] - tc[k]
            if not GAP_MIN <= g <= GAP_MAX:
                continue
            ts = tc[k] + g * uu
            p = at(P[:, B[bone]], fps, ts)
            q = qat(Q[:, B[bone]], fps, ts)
            # base: straight (minimum jerk) from one strike pose to the other
            pb = p[0] + (p[-1] - p[0]) * sig[:, None]
            qb = qslerp(np.broadcast_to(q[0], q.shape), np.broadcast_to(q[-1], q.shape), sig)
            Hm = heading(qb)
            rp = np.einsum("nji,nj->ni", Hm, p - pb)          # no frame de rumo
            rq = qlog(qmul(qconj(qb), q))                       # in hand space
            sw = swivel(D, h, ts)
            rs = sw - (sw[0] + (sw[-1] - sw[0]) * sig)
            res = np.concatenate([rp, rq, rs[:, None]], 1)
            res[0] = res[-1] = 0
            out[name].append({
                "rolla": float(roll(q[0], h)), "rollb": float(roll(q[-1], h)),
                "a": INSTS.index(a["inst"]), "b": INSTS.index(b["inst"]), "g": g,
                "va": a["vel"], "vb": b["vel"],
                "gp": tc[k] - tc[k - 1] if k else GAP_MAX, "gn": tc[k + 2] - tc[k + 1] if k + 2 < len(tc) else GAP_MAX,
                "beat": beat_len(tc[k]), "res": res,
                "swa": float(sw[0]), "swb": float(sw[-1]),
            })
    return out


def highpass(Y, fps, sec=HP_SEC):
    """Remove the moving average of ±sec seconds (what remains is motion, without drift)."""
    k = int(sec * fps)
    c = np.cumsum(np.vstack([np.zeros((1,) + Y.shape[1:]), Y]), 0)
    i = np.arange(len(Y))
    a, b = np.maximum(0, i - k), np.minimum(len(Y), i + k + 1)
    return Y - (c[b] - c[a]) / (b - a)[:, None]


def body_tracks(D: dict):
    """Body deviations (rad, rotation vector in the drummer's frame: x right, y up, z back)
    and wrist positions in that frame, frame by frame, without drift."""
    P, Q, B, fps = D["pos"], D["quat"], D["B"], D["fps"]
    hips = P[:, B["Hips"]]
    hands = (P[:, B["RightHand"]] + P[:, B["LeftHand"]]) / 2
    fwd = (hands - hips).mean(0)
    fwd[1] = 0
    fwd /= np.linalg.norm(fwd)
    up = np.array([0, 1.0, 0])
    right = np.cross(fwd, up)
    right /= np.linalg.norm(right)
    R = np.stack([right, up, -fwd], 1)  # columns: right, up, back (in the world)
    mean_q = lambda q: q.mean(0) / np.linalg.norm(q.mean(0))
    Y = []
    for child, parent in BODY:
        qc = Q[:, B[child]]
        if parent is None:
            qm = mean_q(qc)
            rv = qlog(qmul(qc, np.broadcast_to(qconj(qm), qc.shape)))           # already in the world
        else:
            ql = qmul(qconj(Q[:, B[parent]]), qc)
            qm = mean_q(ql)
            rv = qrot(np.broadcast_to(mean_q(qc), qc.shape), qlog(qmul(np.broadcast_to(qconj(qm), ql.shape), ql)))
        Y.append(rv @ R)
    # the pelvis also moves (sways on the throne): position in the drummer's frame
    Y.append((hips - hips.mean(0)) @ R)
    Y = highpass(np.concatenate(Y, 1), fps)
    X = np.concatenate([(P[:, B["RightHand"]] - hips.mean(0)) @ R, (P[:, B["LeftHand"]] - hips.mean(0)) @ R], 1)
    return highpass(X, fps), Y


def lagged(X, fps):
    """Wrists before, now and after (LAGS), side by side."""
    n = len(X)
    cols = []
    for l in LAGS:
        i = np.clip(np.arange(n) + int(round(l * fps)), 0, n - 1)
        cols.append(X[i])
    return np.concatenate(cols, 1)


def build_body(takes_data: list) -> dict:
    """Hands -> body regression and groove clips in musical time."""
    XS, YS = [], []
    for D, _ in takes_data:
        X, Y = body_tracks(D)
        m = int(HP_SEC * D["fps"])  # edges without a full average
        XS.append(lagged(X, D["fps"])[m:-m])
        YS.append(Y[m:-m])
    X = np.concatenate(XS)
    Y = np.concatenate(YS)
    Xb = np.concatenate([X, np.ones((len(X), 1))], 1)
    W = np.linalg.solve(Xb.T @ Xb + 1e-2 * len(X) * np.eye(Xb.shape[1]), Xb.T @ Y)
    r2 = 1 - (Y - Xb @ W).var(0) / Y.var(0)

    clips, feats = [], []
    for D, strokes in takes_data:
        X, Y = body_tracks(D)
        fps = D["fps"]
        res = Y - np.concatenate([lagged(X, fps), np.ones((len(X), 1))], 1) @ W
        beats = np.array(D["song"]["beats"])
        hand_t = np.array([s["t"] for s in strokes])
        kick_t = np.array([n["t"] for n in D["song"]["notes"] if n["piece"] == "kick"])
        m = int(HP_SEC * fps) / fps
        for k in range(0, len(beats) - CLIP - 1, CLIP):
            b0, b1 = beats[k], beats[k + CLIP]
            if b0 < m or beats[k + CLIP + 1] > len(Y) / fps - m:
                continue
            nh = ((hand_t >= b0) & (hand_t < b1)).sum()
            if nh < CLIP:  # still: not a groove
                continue
            ts = np.concatenate([beats[j] + (beats[j + 1] - beats[j]) * np.arange(SPB) / SPB for j in range(k, k + CLIP + 1)])
            c = at(res, fps, ts)
            if np.abs(c[:, :24]).max() > np.radians(14) or np.abs(c[:, 24:]).max() > 0.06:  # tranco de sensor
                continue
            clips.append(c.astype(np.float32))
            feats.append((np.mean(np.diff(beats[k:k + CLIP + 1])), nh / CLIP, ((kick_t >= b0) & (kick_t < b1)).sum() / CLIP))
    idx = np.linspace(0, len(clips) - 1, min(MAX_CLIPS, len(clips))).round().astype(int)
    C = np.stack([clips[i] for i in idx])                     # (n, (CLIP+1)*SPB, 24)
    F = np.array([feats[i] for i in idx])
    cs = np.abs(C).reshape(-1, C.shape[-1]).max(0) / 127
    names = [f"{BODY_NAMES[j // 3]}.{'xyz'[j % 3]}" for j in range(24)] + ["pelvis-pos.x", "pelvis-pos.y", "pelvis-pos.z"]
    print(f"body: {len(C)} groove clips of {len(clips)}; reach R² "
          + " ".join(f"{names[j]} {r2[j]:.2f}" for j in range(len(r2)) if r2[j] > 0.2), flush=True)
    sd = Y.std(0)
    print("   pelvis deviation (mm, no drift):", (sd[24:] * 1000).round(1).tolist(), flush=True)
    return {
        "joints": BODY_NAMES, "position": "pelvis (m, drummer's frame)", "lags": list(LAGS), "highpass": HP_SEC,
        "W": b64(W.astype(np.float32)), "inputs": X.shape[1] + 1, "outputs": Y.shape[1],
        "r2": [round(float(x), 3) for x in r2],
        "spb": SPB, "clipBeats": CLIP, "n": len(C),
        "clips": b64(np.round(C / cs).astype(np.int8)), "clipScale": cs.astype(np.float32).tolist(),
        "clipFeat": {"beat": b64(np.round(F[:, 0] * 1000).astype(np.uint16)),
                     "dens": b64(np.round(F[:, 1] * 10).astype(np.uint8)),
                     "kick": b64(np.round(F[:, 2] * 10).astype(np.uint8))},
    }


def b64(arr: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode()


def build(takes: list[int]) -> dict:
    segs = {h: [] for h in HANDS}
    info, kept = [], []
    for n in takes:
        D = load_take(n)
        if D is None:
            print(f"[{n}] no bones.f32 (run tools/mmip_bones.mjs), skipping", file=sys.stderr)
            continue
        lat, prom = latency(D, assign_hands(D))
        if prom < 2.5:
            print(f"[{n}] MIDI and motion don't match (peak {prom:.1f}), skipping", file=sys.stderr)
            continue
        strokes = assign_hands(D, lat)
        sg = segments(D, strokes)
        # the body uses the motion's musical time (MIDI + delay)
        D["song"]["beats"] = [b + lat for b in D["song"]["beats"]]
        for x in D["song"]["notes"]:
            x["t"] += lat
        kept.append((D, strokes))
        for h in HANDS:
            segs[h] += sg[h]
        info.append({"take": n, "latency_ms": round(lat * 1000, 1), "strokes": len(strokes),
                     "segments": {h: len(sg[h]) for h in HANDS}})
        print(f"[{n}] delay {lat * 1000:+.0f} ms, {len(strokes)} hand strokes, "
              f"segments R {len(sg['MD'])} L {len(sg['ME'])}", flush=True)

    hands = {}
    for h in HANDS:
        S = segs[h]
        X = np.stack([x["res"] for x in S])                 # (n, N, 7)
        scale = X.reshape(-1, 7).std(0) + 1e-9               # per channel
        Z = (X / scale).reshape(len(S), -1)
        mean = Z.mean(0)
        U, sv, Vt = np.linalg.svd(Z - mean, full_matrices=False)
        var = sv ** 2 / (sv ** 2).sum()
        basis = Vt[:K]                                       # (K, N*7)
        coef = (Z - mean) @ basis.T                           # (n, K)
        recon = coef @ basis + mean
        err = np.sqrt(((recon - Z) ** 2).mean())
        cscale = np.abs(coef).max(0) / 32767
        feat = {
            "a": np.array([x["a"] for x in S], np.uint8), "b": np.array([x["b"] for x in S], np.uint8),
            "g": np.array([round(x["g"] * 1000) for x in S], np.uint16),
            "va": np.array([round(x["va"] * 255) for x in S], np.uint8), "vb": np.array([round(x["vb"] * 255) for x in S], np.uint8),
            "gp": np.array([round(min(x["gp"], GAP_MAX) * 1000) for x in S], np.uint16),
            "gn": np.array([round(min(x["gn"], GAP_MAX) * 1000) for x in S], np.uint16),
            "beat": np.array([round(x["beat"] * 1000) for x in S], np.uint16),
        }
        # strike pose per piece: elbow opening and hand turn around the stick (rad), the
        # starting point of our strike poses
        sw, rl = {}, {}
        for i, inst in enumerate(INSTS):
            v = [x["swa"] for x in S if x["a"] == i] + [x["swb"] for x in S if x["b"] == i]
            r = [x["rolla"] for x in S if x["a"] == i] + [x["rollb"] for x in S if x["b"] == i]
            if v:
                sw[inst] = round(float(np.median(v)), 4)
                rl[inst] = round(float(np.median(r)), 4)
        hands[h] = {
            "n": len(S), "scale": scale.round(6).tolist(), "mean": b64(mean.astype(np.float32)),
            "basis": b64(basis.astype(np.float32)), "coef": b64(np.round(coef / cscale).astype(np.int16)),
            "coefScale": cscale.astype(np.float32).tolist(),
            "feat": {k: b64(v) for k, v in feat.items()}, "swivel": sw, "roll": rl,
            "explained": round(float(var[:K].sum()), 4), "rms": round(float(err), 4),
        }
        print(f"{h}: {len(S)} segments, PCA {K} components explain {var[:K].sum() * 100:.1f}% "
              f"(rms error {err:.3f} deviations)", flush=True)
        print(f"   at the strike (degrees) turn {({k: round(np.degrees(v)) for k, v in rl.items()})} "
              f"elbow {({k: round(np.degrees(v)) for k, v in sw.items()})}", flush=True)

    body = build_body(kept)
    return {
        "credit": CREDIT, "license": "CC BY-NC-SA 4.0", "version": 1, "body": body,
        "about": "Strokes of each hand between two consecutive notes, against the straight path between strike poses. "
                 "Channels per sample: wrist position in the heading frame (m: right, up, back), hand turn "
                 "(rotation vector in hand space, rad) and elbow opening (rad). Body: deviations from the mean "
                 "pose (rotation vector in the drummer's frame: x right, y up, z back), part from the regression "
                 "on the wrist positions, part from 8-beat clips.",
        "samples": N, "warp": WARP, "channels": ["px", "py", "pz", "rx", "ry", "rz", "swivel"],
        "insts": INSTS, "gap": [GAP_MIN, GAP_MAX], "k": K, "takes": info, "hands": hands,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("takes", type=int, nargs="*", help="performances (default: all downloaded)")
    ap.add_argument("-o", "--out", type=Path, default=OUT)
    a = ap.parse_args()
    takes = a.takes or sorted(int(p.name) for p in DATA.iterdir() if p.is_dir() and p.name.isdigit())
    lib = build(takes)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(lib, ensure_ascii=False, separators=(",", ":")))
    print(f"{a.out}: {a.out.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
