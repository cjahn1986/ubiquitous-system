#!/usr/bin/env python3
"""analogy.py — structural-analogy strength scorer (the pattern-theorist's serendipity ranker).

Scores how REAL a cross-domain analogy is likely to be — not whether it is true,
but whether it is worth testing first — from transparent structural signals:
  bridge      cross-source corroboration + literature relatedness (shared structure)
  surprise    genuine domain-distance (far in surface => the transfer is non-obvious)
  mechanism   does the analogy ride a transferable mechanism, not a surface trait?
  specificity a concrete target beats a vague one
A high score means "test this first," never "this is true."

Mirror of the heuristic in tools/node-explorer.html, so the pattern-theorist can
rank analogies reproducibly from the command line.

Usage:
  python3 analogy.py <input.json>   # {concept, prop, candidates:[{name,oa_score,oa_level,sources}]}
  python3 analogy.py --demo
"""
import json
import re
import sys

GENERIC = {'system', 'process', 'thing', 'method', 'study', 'research', 'science',
           'theory', 'concept', 'field', 'analysis', 'model', 'structure',
           'phenomenon', 'property', 'effect', 'state', 'function', 'material'}
MECH = ['transport', 'flow', 'feedback', 'growth', 'signal', 'storage', 'store', 'optim',
        'defen', 'filter', 'oscillat', 'network', 'adapt', 'exchange', 'conversion',
        'convert', 'pattern', 'self-organ', 'diffus', 'gradient', 'threshold', 'cascade',
        'regulat', 'synchron', 'redund', 'recycl', 'distribut', 'rout', 'swarm',
        'balance', 'equilibri', 'sens']


def _toks(s):
    return {w for w in re.split(r'[^a-z]+', str(s).lower()) if len(w) > 3}


def _overlap(a, b):
    A, B = _toks(a), _toks(b)
    return len(A & B) / max(1, min(len(A), len(B)))


def _mech(s):
    s = str(s).lower()
    return any(m in s for m in MECH)


def score(concept, prop, c):
    t = c['name'].lower()
    oa_s, oa_l = c.get('oa_score', 0) or 0, c.get('oa_level', 0) or 0
    sources = c.get('sources', 1) or 1
    bridge = 25 * min(1, oa_s * 1.4) + (10 if sources >= 2 else 0)
    surprise = 15 * (1 - _overlap(concept, c['name'])) + min(10, oa_l * 3)
    mech = (15 if _mech(prop) else 0) + (10 if _mech(c['name']) else 0)
    spec = 2 if t in GENERIC else min(15, 6 + len(t.split()) * 3)
    total = max(0, min(100, round(bridge + surprise + mech + spec)))
    why = []
    if sources >= 2: why.append('multi-source bridge')
    if oa_s > 0.3: why.append('literature-linked')
    if _overlap(concept, c['name']) < 0.2: why.append('cross-domain')
    if _mech(prop) or _mech(c['name']): why.append('mechanism-anchored')
    if t in GENERIC: why.append('too generic')
    return total, ' · '.join(why) or 'weak signals'


DEMO = {"concept": "slime mold",
        "prop": "finds shortest paths by reinforcing efficient routes",
        "candidates": [
            {"name": "transport network design", "oa_score": 0.55, "oa_level": 2, "sources": 2},
            {"name": "supply chain routing", "oa_score": 0.42, "oa_level": 3, "sources": 2},
            {"name": "cellular automata", "oa_score": 0.60, "oa_level": 1, "sources": 1},
            {"name": "system", "oa_score": 0.20, "oa_level": 0, "sources": 1},
            {"name": "urban planning", "oa_score": 0.30, "oa_level": 2, "sources": 1},
            {"name": "neural pruning", "oa_score": 0.28, "oa_level": 3, "sources": 2}]}


def run(spec):
    c, prop = spec['concept'], spec.get('prop', 'its core mechanism')
    rows = sorted((score(c, prop, x) + (x['name'],) for x in spec['candidates']), reverse=True)
    print(f'Concept: {c}\nMechanism: "{prop}"\n')
    print(f'{"score":>5}  {"analogy target":<28} why')
    for tot, why, name in rows:
        print(f'{tot:>5}  {name:<28} {why}')
    print('\n(high score = worth testing first, NOT true. These are hypotheses.)')


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    run(DEMO if sys.argv[1] == "--demo" else json.load(open(sys.argv[1])))
