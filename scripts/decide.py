#!/usr/bin/env python3
"""decide.py — a weighted decision-matrix engine.

Takes options scored against weighted criteria and ranks them two ways
(Simple Additive Weighting + TOPSIS), then checks whether the ranking is
stable under weight changes. Disagreement or instability is reported, not
hidden — a decision matrix that pretends to certainty is worse than none.

Usage:
  python3 decide.py <matrix.json>   # your own problem
  python3 decide.py --demo          # ranks THIS project's roadmap (the "known knowns")

JSON format:
  {
    "criteria": [{"name":"Value","weight":0.3,"benefit":true}, ...],
    "options":  [{"name":"X","scores":{"Value":5,"Effort":2, ...}}, ...]
  }
Set "benefit": false for cost-like criteria (lower is better, e.g. Effort).
"""
import json
import sys
import numpy as np


# The project's current roadmap, scored (1-5) on honest judgement. This is the
# "integrate all known knowns into a decision matrix" demo.
DEMO = {
    "criteria": [
        {"name": "Value",     "weight": 0.30, "benefit": True},   # impact if it works
        {"name": "Viability", "weight": 0.20, "benefit": True},   # can we actually build it well
        {"name": "Effort",    "weight": 0.15, "benefit": False},  # cost (lower is better)
        {"name": "Alignment", "weight": 0.20, "benefit": True},   # fits the project's soul
        {"name": "Leverage",  "weight": 0.15, "benefit": True},   # unlocks future work
    ],
    "options": [
        {"name": "Serendipity ranker (pattern-theorist scores analogies)",
         "scores": {"Value": 5, "Viability": 4, "Effort": 3, "Alignment": 5, "Leverage": 5}},
        {"name": "PWA / offline-installable workshop",
         "scores": {"Value": 4, "Viability": 5, "Effort": 2, "Alignment": 4, "Leverage": 2}},
        {"name": "'Who already solved this?' OpenAlex analog search",
         "scores": {"Value": 5, "Viability": 3, "Effort": 4, "Alignment": 5, "Leverage": 4}},
        {"name": "More outside-the-box nodes (Wiktionary/OEIS/folklore)",
         "scores": {"Value": 3, "Viability": 4, "Effort": 2, "Alignment": 3, "Leverage": 2}},
        {"name": "Provenance / data 'nutrition label' + challenge button",
         "scores": {"Value": 3, "Viability": 5, "Effort": 2, "Alignment": 4, "Leverage": 3}},
    ],
}


def _matrix(spec):
    crit = spec["criteria"]
    names = [o["name"] for o in spec["options"]]
    M = np.array([[o["scores"][c["name"]] for c in crit] for o in spec["options"]], float)
    w = np.array([c["weight"] for c in crit], float); w = w / w.sum()
    benefit = np.array([c.get("benefit", True) for c in crit])
    return names, crit, M, w, benefit


def saw(M, w, benefit):
    N = M.copy()
    for j in range(M.shape[1]):
        col = M[:, j]
        N[:, j] = col / col.max() if benefit[j] else col.min() / np.where(col == 0, 1e-9, col)
    return (N * w).sum(1)


def topsis(M, w, benefit):
    N = M / np.sqrt((M ** 2).sum(0))
    V = N * w
    best = np.where(benefit, V.max(0), V.min(0))
    worst = np.where(benefit, V.min(0), V.max(0))
    dp = np.sqrt(((V - best) ** 2).sum(1))
    dn = np.sqrt(((V - worst) ** 2).sum(1))
    return dn / (dp + dn)


def stability(M, w, benefit, names, trials=300, jitter=0.25):
    top = []
    for _ in range(trials):
        ww = w * (1 + np.random.uniform(-jitter, jitter, len(w)))
        ww /= ww.sum()
        top.append(np.argmax(saw(M, ww, benefit)))
    vals, counts = np.unique(top, return_counts=True)
    win = vals[np.argmax(counts)]
    return names[win], counts.max() / trials


def run(spec, title):
    names, crit, M, w, benefit = _matrix(spec)
    s, t = saw(M, w, benefit), topsis(M, w, benefit)
    order = np.argsort(-s)
    print(f"\n=== {title} ===")
    print(f"criteria: " + ", ".join(f"{c['name']}({c['weight']:.0%}{'↓' if not c.get('benefit',True) else ''})" for c in crit))
    print(f"\n{'rank':<5}{'SAW':>6}{'TOPSIS':>8}   option")
    for r, i in enumerate(order, 1):
        print(f"{r:<5}{s[i]:>6.3f}{t[i]:>8.3f}   {names[i]}")
    win, conf = stability(M, w, benefit, names)
    saw_top, top_top = names[order[0]], names[int(np.argmax(t))]
    print(f"\nSAW winner:    {saw_top}")
    print(f"TOPSIS winner: {top_top}")
    print("agreement:     " + ("both methods agree ✓" if saw_top == top_top else "METHODS DISAGREE — decide by hand ⚠"))
    print(f"stability:     '{win}' stays #1 in {conf:.0%} of weight-perturbation trials "
          f"({'robust' if conf > 0.7 else 'fragile — weights matter a lot'})")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    if sys.argv[1] == "--demo":
        run(DEMO, "Ubiquitous System — next-build roadmap")
    else:
        with open(sys.argv[1]) as f:
            run(json.load(f), sys.argv[1])
