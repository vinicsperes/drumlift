"""Monta a biblioteca de movimento do baterista a partir da captura MMIP.

A base MMIP (Universidade de Chipre / CYENS, CC BY-NC-SA 4.0) tem 14
performances de bateria com o corpo inteiro capturado por uma roupa de
sensores, sincronizado com o MIDI. Daqui sai um arquivo pequeno, derivado,
com crédito e a mesma licença, que o player usa pra tocar como gente:

- golpes de cada mão: o movimento da mão entre duas notas seguidas, descrito
  em relação ao caminho reto entre as duas poses de golpe (resíduo). Assim ele
  serve pra qualquer kit: no nosso, as poses de golpe são as nossas e o
  resíduo (subida, arco, giro do pulso, abertura do cotovelo) é o do baterista
  real. Comprimido por PCA, por mão.

uso (depois de `tools/mmip.py fetch` e `node tools/mmip_bones.mjs songs/mmip/NN`):
  uv run python tools/mmip_moves.py            # todas as performances baixadas
  uv run python tools/mmip_moves.py 5 6 7      # só algumas

Saída: drumsomething/player/kit3d/moves/mmip.json
"""

import argparse
import base64
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "songs" / "mmip"
OUT = ROOT / "drumsomething" / "player" / "kit3d" / "moves" / "mmip.json"
CREDIT = ("Movimento derivado da base MMIP (Multi-Modal Instrument Performances) da Universidade de "
          "Chipre e do CYENS – Centre of Excellence, https://mmip.cs.ucy.ac.cy. CC BY-NC-SA 4.0.")

HANDS = ["MD", "ME"]
HAND_BONE = {"MD": "Right", "ME": "Left"}
INSTS = ["snare", "hihat", "tom1", "tom2", "floor", "crash", "ride"]
# x típico (m) de cada peça num kit de destro: decide quem toca o quê num par
SIDE_X = {"hihat": -0.47, "crash": -0.46, "snare": -0.15, "tom1": -0.03, "tom2": 0.27, "floor": 0.52, "ride": 0.74}

# Pegada (a mesma de kit3d/skeleton.js, mão direita; x espelha na esquerda):
# fulcro e direção da baqueta no espaço da mão. Serve pra medir o giro da mão
# em volta da baqueta no golpe, que vira a pose de golpe do nosso baterista.
GRIP_DIR = np.array([-0.3, 0.95, 0.0])
N = 28            # amostras por golpe
WARP = 0.75       # amostras mais densas perto das notas (rebote e descida)
GAP_MIN, GAP_MAX = 0.07, 2.4
K = 14            # componentes da PCA por mão


# ---------- quatérnios (x, y, z, w), vetorizados ----------
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
    """Vetor de rotação (eixo * ângulo) do quatérnio."""
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


# FBX: o baterista olha pra +X com a direita em +Z; aqui, olha pra -Z com a direita em +X
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
    # algumas sessões gravaram os ossos girados 180° em x (y e z com o sinal
    # trocado); normaliza pra y ao longo do osso e, na mão, z no dorso
    v = qrot(qconj(quat[:, B["Spine1"]]), pos[:, B["Spine2"]] - pos[:, B["Spine1"]]).mean(0)
    if v[1] < 0:
        flip = np.array([1.0, 0, 0, 0])
        for name, i in B.items():
            if name != "Hips":
                quat[:, i] = qmul(quat[:, i], np.broadcast_to(flip, quat[:, i].shape))
    song = json.loads((d / "song.json").read_text())
    return {"n": n, "fps": meta["fps"], "frames": meta["frames"], "pos": pos, "quat": quat, "B": B, "song": song}


def at(arr, fps, t):
    """Interpolação linear de arr (quadros, ...) nos tempos t (s)."""
    x = np.asarray(t) * fps
    i0 = np.clip(np.floor(x).astype(int), 0, len(arr) - 2)
    u = np.clip(x - i0, 0, 1)[..., None]
    return arr[i0] * (1 - u) + arr[i0 + 1] * u


def qat(q, fps, t):
    x = np.asarray(t) * fps
    i0 = np.clip(np.floor(x).astype(int), 0, len(q) - 2)
    return qslerp(q[i0], q[i0 + 1], np.clip(x - i0, 0, 1))


# ---------- quem tocou cada nota ----------
def assign_hands(D: dict, shift: float = 0.0, rounds: int = 5):
    """Mão de cada nota (0 = direita, 1 = esquerda): a ponta de uma baqueta rígida
    na mão tem que cair sempre no mesmo lugar em cada peça. Devolve as notas de
    mão, com o tempo do movimento (MIDI + shift)."""
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
    """Atraso do movimento em relação ao MIDI (s), que muda de uma gravação pra
    outra (de -80 a +110 ms). No golpe a baqueta bate e volta: um ponto preso na
    mão, 30 cm à frente do pulso, leva um tranco pra cima. Na média de centenas
    de golpes alinhados pela nota, o pico desse tranco é o instante do golpe.
    Devolve o atraso e a proeminência do pico (desvios acima da média)."""
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
    """Abertura do cotovelo (rad): giro em volta do eixo ombro-pulso a partir de
    "pendurado", positivo pra fora do corpo."""
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
    """Giro da mão em volta da baqueta (rad): 0 = dorso pra cima (pegada alemã),
    + = polegar pra cima na direita (e na esquerda, espelhado)."""
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
    """Tempo normalizado u (0..1) da amostra s (0..1): mais denso nas pontas."""
    return s - WARP * np.sin(2 * np.pi * s) / (2 * np.pi)


def minjerk(u):
    return u * u * u * (10 - 15 * u + 6 * u * u)


def heading(q):
    """Frame de rumo: y pra cima, z pra trás do rumo da mão (eixo y dela no plano)."""
    fwd = qrot(q, np.broadcast_to([0, 1.0, 0], q.shape[:-1] + (3,)))
    fwd[..., 1] = 0
    fwd /= np.maximum(np.linalg.norm(fwd, axis=-1, keepdims=True), 1e-9)
    up = np.broadcast_to([0, 1.0, 0], fwd.shape)
    back = -fwd
    right = np.cross(up, back)
    return np.stack([right, up, back], -1)  # colunas


def segments(D: dict, strokes: list):
    """Golpes de cada mão: resíduo da mão entre duas notas seguidas."""
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
            # base: reto (mínimo jerk) de uma pose de golpe à outra
            pb = p[0] + (p[-1] - p[0]) * sig[:, None]
            qb = qslerp(np.broadcast_to(q[0], q.shape), np.broadcast_to(q[-1], q.shape), sig)
            Hm = heading(qb)
            rp = np.einsum("nji,nj->ni", Hm, p - pb)          # no frame de rumo
            rq = qlog(qmul(qconj(qb), q))                       # no espaço da mão
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


def b64(arr: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode()


def build(takes: list[int]) -> dict:
    segs = {h: [] for h in HANDS}
    info = []
    for n in takes:
        D = load_take(n)
        if D is None:
            print(f"[{n}] sem bones.f32 (rode tools/mmip_bones.mjs), pulando", file=sys.stderr)
            continue
        lat, prom = latency(D, assign_hands(D))
        if prom < 2.5:
            print(f"[{n}] MIDI e movimento não batem (pico {prom:.1f}), pulando", file=sys.stderr)
            continue
        strokes = assign_hands(D, lat)
        sg = segments(D, strokes)
        for h in HANDS:
            segs[h] += sg[h]
        info.append({"take": n, "latency_ms": round(lat * 1000, 1), "strokes": len(strokes),
                     "segments": {h: len(sg[h]) for h in HANDS}})
        print(f"[{n}] atraso {lat * 1000:+.0f} ms, {len(strokes)} golpes de mão, "
              f"recortes D {len(sg['MD'])} E {len(sg['ME'])}", flush=True)

    hands = {}
    for h in HANDS:
        S = segs[h]
        X = np.stack([x["res"] for x in S])                 # (n, N, 7)
        scale = X.reshape(-1, 7).std(0) + 1e-9               # por canal
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
        # pose no golpe, por peça: abertura do cotovelo e giro da mão em volta da
        # baqueta (rad), ponto de partida das nossas poses de golpe
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
        print(f"{h}: {len(S)} recortes, PCA {K} componentes explicam {var[:K].sum() * 100:.1f}% "
              f"(erro rms {err:.3f} desvios)", flush=True)
        print(f"   no golpe (graus) giro {({k: round(np.degrees(v)) for k, v in rl.items()})} "
              f"cotovelo {({k: round(np.degrees(v)) for k, v in sw.items()})}", flush=True)

    return {
        "credit": CREDIT, "license": "CC BY-NC-SA 4.0", "version": 1,
        "about": "Golpes de cada mão entre duas notas seguidas, em relação ao caminho reto entre as poses de golpe. "
                 "Canais por amostra: posição do pulso no frame de rumo (m: direita, cima, trás), giro da mão "
                 "(vetor de rotação no espaço da mão, rad) e abertura do cotovelo (rad).",
        "samples": N, "warp": WARP, "channels": ["px", "py", "pz", "rx", "ry", "rz", "swivel"],
        "insts": INSTS, "gap": [GAP_MIN, GAP_MAX], "k": K, "takes": info, "hands": hands,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("takes", type=int, nargs="*", help="performances (padrão: todas as baixadas)")
    ap.add_argument("-o", "--out", type=Path, default=OUT)
    a = ap.parse_args()
    takes = a.takes or sorted(int(p.name) for p in DATA.iterdir() if p.is_dir() and p.name.isdigit())
    lib = build(takes)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(lib, ensure_ascii=False, separators=(",", ":")))
    print(f"{a.out}: {a.out.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
