#!/usr/bin/env python3
"""patterns.py — the pattern-theorist's quantitative toolkit.

Every command is built to answer: *is this pattern real, or is it fooling me?*
So each test reports a verdict against a null, not just a number.

Usage:
  python3 patterns.py powerlaw   <file|--demo>   # heavy tail: power law vs lognormal
  python3 patterns.py network    <edgelist|--demo># hubs real vs random (Erdos-Renyi) null
  python3 patterns.py fractal    <xy-file|--demo> # box-counting fractal dimension
  python3 patterns.py entropy    <seq-file|--demo># Shannon entropy of a sequence
  python3 patterns.py cycles     <series|--demo>  # dominant period (autocorr + FFT)
  python3 patterns.py benford    <numbers|--demo> # first-digit law (fraud/anomaly screen)

Files: one value (or "u v" edge, or "x y" point) per line.
"""
import sys
import numpy as np


def _load(path, cols=1):
    if path == "--demo":
        return None
    rows = []
    with open(path) as f:
        for ln in f:
            ln = ln.strip()
            if not ln or ln.startswith("#"):
                continue
            parts = ln.replace(",", " ").split()
            rows.append(parts[0] if cols == 1 else parts[:cols])
    return rows


# ---------------------------------------------------------------- power law
def powerlaw(path):
    from scipy import stats
    if path == "--demo":
        x = (np.random.pareto(2.0, 3000) + 1)  # true power law, alpha~3
    else:
        x = np.array([float(v) for v in _load(path)])
    x = x[x > 0]
    xmin = x.min()
    n = len(x)
    alpha = 1 + n / np.sum(np.log(x / xmin))           # Clauset MLE (continuous)
    # Compare power-law vs lognormal by AIC (lower = better)
    ll_pl = n * np.log((alpha - 1) / xmin) - alpha * np.sum(np.log(x / xmin))
    s, loc, scale = stats.lognorm.fit(x, floc=0)
    ll_ln = np.sum(stats.lognorm.logpdf(x, s, loc, scale))
    aic_pl, aic_ln = 2 * 1 - 2 * ll_pl, 2 * 2 - 2 * ll_ln
    print(f"n={n}  xmin={xmin:.3g}")
    print(f"power-law exponent  alpha = {alpha:.3f}")
    print(f"AIC  power-law={aic_pl:.1f}   lognormal={aic_ln:.1f}")
    if aic_pl + 2 < aic_ln:
        print("VERDICT: power law is favored over lognormal. (solid-ish)")
    elif aic_ln + 2 < aic_pl:
        print("VERDICT: LOGNORMAL fits better — 'power law' would be over-claimed. (caution)")
    else:
        print("VERDICT: indistinguishable on this data — do not claim a power law. (artifact-risk)")


# ------------------------------------------------------------------ network
def network(path):
    import networkx as nx
    if path == "--demo":
        G = nx.barabasi_albert_graph(4000, 3, seed=1)
    else:
        G = nx.Graph()
        for u, v in _load(path, 2):
            G.add_edge(u, v)
    deg = np.array([d for _, d in G.degree()])
    n, m = G.number_of_nodes(), G.number_of_edges()
    er = nx.erdos_renyi_graph(n, min(1, 2 * m / max(1, n * (n - 1))), seed=1)
    edeg = np.array([d for _, d in er.degree()]) if er.number_of_edges() else np.array([0])
    share = lambda d: d[d >= np.percentile(d, 99)].sum() / max(1, d.sum())
    print(f"nodes={n}  edges={m}  mean deg={deg.mean():.2f}")
    print(f"max degree:  observed={deg.max()}   random null={edeg.max()}")
    print(f"top-1% degree share:  observed={share(deg):.1%}   random null={share(edeg):.1%}")
    print(f"clustering: observed={nx.average_clustering(G):.3f}")
    if deg.max() > 3 * max(1, edeg.max()):
        print("VERDICT: hub structure is REAL — far beyond the random null. (solid)")
    else:
        print("VERDICT: degree spread is within random-graph range — no special hubs. (artifact-risk)")


# ------------------------------------------------------------------ fractal
def fractal(path):
    if path == "--demo":
        # Sierpinski-ish point cloud (chaos game) -> dimension ~1.585
        pts = [np.array([0.0, 0.0])]
        corners = [np.array([0, 0]), np.array([1, 0]), np.array([0.5, 0.87])]
        for _ in range(20000):
            pts.append((pts[-1] + corners[np.random.randint(3)]) / 2)
        P = np.array(pts)
    else:
        P = np.array([[float(a), float(b)] for a, b in _load(path, 2)])
    P = (P - P.min(0)) / (np.ptp(P, axis=0) + 1e-12)
    counts, scales = [], []
    for k in range(2, 8):
        g = 2 ** k
        occupied = len({(int(x * (g - 1)), int(y * (g - 1))) for x, y in P})
        counts.append(occupied); scales.append(g)
    slope = np.polyfit(np.log(scales), np.log(counts), 1)[0]
    print(f"points={len(P)}")
    print(f"box-counting fractal dimension D = {slope:.3f}")
    print("(line D=1, filled area D=2; non-integer => fractal structure)")


# ------------------------------------------------------------------ entropy
def entropy(path):
    if path == "--demo":
        seq = list("the quick brown fox jumps over the lazy dog")
    else:
        seq = _load(path)
    vals, counts = np.unique(seq, return_counts=True)
    p = counts / counts.sum()
    H = -np.sum(p * np.log2(p))
    Hmax = np.log2(len(vals))
    print(f"symbols={len(vals)}  length={len(seq)}")
    print(f"Shannon entropy H = {H:.3f} bits/symbol  (max {Hmax:.3f})")
    print(f"normalized (randomness) = {H / Hmax:.1%}  "
          f"-> {'near-random' if H/Hmax>0.9 else 'structured/compressible'}")


# ------------------------------------------------------------------- cycles
def cycles(path):
    if path == "--demo":
        t = np.arange(400)
        x = np.sin(2 * np.pi * t / 29) + 0.4 * np.random.randn(400)
    else:
        x = np.array([float(v) for v in _load(path)])
    x = x - x.mean()
    sp = np.abs(np.fft.rfft(x)) ** 2
    freq = np.fft.rfftfreq(len(x))
    k = np.argmax(sp[1:]) + 1
    period = 1 / freq[k] if freq[k] else float("inf")
    # null: compare peak power to shuffled-series peaks
    peaks = []
    for _ in range(200):
        s = np.abs(np.fft.rfft(np.random.permutation(x))) ** 2
        peaks.append(s[1:].max())
    pval = np.mean(np.array(peaks) >= sp[1:].max())
    print(f"length={len(x)}")
    print(f"dominant period ~ {period:.1f} samples")
    print(f"significance vs shuffled null: p={pval:.3f}  "
          f"-> {'REAL cycle (solid)' if pval<0.05 else 'likely noise (artifact-risk)'}")


# ------------------------------------------------------------------ benford
def benford(path):
    from scipy import stats
    if path == "--demo":
        x = 10 ** (np.random.uniform(0, 5, 2000))  # Benford-distributed
    else:
        x = np.array([abs(float(v)) for v in _load(path)])
    x = x[x > 0]
    d = np.array([int(str(f"{v:.5e}")[0]) for v in x])
    obs = np.array([(d == i).sum() for i in range(1, 10)]) / len(d)
    exp = np.log10(1 + 1 / np.arange(1, 10))
    chi2 = len(d) * np.sum((obs - exp) ** 2 / exp)
    p = 1 - stats.chi2.cdf(chi2, 8)
    print("digit  observed  Benford")
    for i in range(9):
        print(f"  {i+1}     {obs[i]:6.1%}   {exp[i]:6.1%}")
    print(f"chi-square={chi2:.1f}  p={p:.3f}  "
          f"-> {'fits Benford (natural)' if p>0.05 else 'DEVIATES — anomaly/curation worth a look'}")


CMDS = {"powerlaw": powerlaw, "network": network, "fractal": fractal,
        "entropy": entropy, "cycles": cycles, "benford": benford}

if __name__ == "__main__":
    if len(sys.argv) < 3 or sys.argv[1] not in CMDS:
        sys.exit(__doc__)
    CMDS[sys.argv[1]](sys.argv[2])
