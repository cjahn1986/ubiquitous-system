#!/usr/bin/env python3
"""Classical texts for the agents: find works, fetch editions, print aligned original/translation.

Uses the catalogue built by build_classics_catalog.py (tools/research/data/classics-catalog.js):
2,275 Greek and Latin works from PerseusDL and First1KGreek (CC BY-SA), fetched on demand from
raw.githubusercontent.com (allow-listed in cloud sessions by default via GitHub).

  classics.py find "plato republic"                       search the catalogue
  classics.py get  WORK_ID [--lang grc|lat|eng] [--ref 4.441] [--around 1]
  classics.py align WORK_ID [--ref 1] [--max 40]          original and English side by side
  classics.py to-hub WORK_ID OUT [--by classicist]        write a hub import with original + English
"""
import argparse, json, os, re, sys, urllib.request, uuid, time
import xml.etree.ElementTree as ET

ROOT = os.path.join(os.path.dirname(__file__), '..')
CAT = os.path.join(ROOT, 'tools', 'research', 'data', 'classics-catalog.js')
CACHE = os.path.join(ROOT, 'research', 'cache', 'tei')
SKIP = {'note', 'bibl', 'del', 'teiHeader', 'figure', 'gap', 'ref', 'fw', 'pb', 'lb', 'cb', 'milestone', 'head'}


def catalog():
    s = open(CAT, encoding='utf-8').read()
    return json.loads(s[s.index('=') + 1:].strip().rstrip(';'))


def ln(e): return e.tag.split('}')[-1] if isinstance(e.tag, str) else ''


def text_of(e):
    out = e.text or '' if ln(e) not in SKIP else ''
    for c in e:
        if ln(c) not in SKIP:
            t = text_of(c)
            out += ('\n' + t + '\n') if ln(c) in ('p', 'l', 'sp') else t
        out += c.tail or ''
    return out


def clean(s): return re.sub(r' *\n[\n ]*', '\n', re.sub(r'[ \t\r]+', ' ', s)).strip()


def is_part(e): return ln(e) == 'div' and (e.get('type') == 'textpart' or (e.get('n') is not None and e.get('type') not in ('edition', 'translation')))


def parse_tei(xml):
    root = ET.fromstring(xml)
    body = next((e for e in root.iter() if ln(e) == 'body'), None)
    if body is None: raise ValueError('no <body> in TEI')
    top = next((c for c in body if ln(c) == 'div'), body)
    segs = []

    def walk(e, path):
        kids = [k for k in e if is_part(k)]
        if kids:
            for k in kids: walk(k, path + [k.get('n', '?')])
            return
        lines = [l for l in e.iter() if ln(l) == 'l']
        if len(lines) > 3 and any(l.get('n') for l in lines):
            last = 0
            for l in lines:
                n = l.get('n')
                if n and n.isdigit(): last = int(n)
                elif not n: last += 1
                t = clean(text_of(l))
                if t: segs.append(('.'.join(path + [n or str(last)]), t))
            return
        t = clean(text_of(e))
        if t: segs.append(('.'.join(path) or '1', t))
    walk(top, [])
    return segs


def fetch(ed):
    os.makedirs(CACHE, exist_ok=True); fn = os.path.join(CACHE, ed['u'] + '.xml')
    if not os.path.exists(fn):
        with urllib.request.urlopen(ed['p'], timeout=120) as r, open(fn, 'wb') as f: f.write(r.read())
    return open(fn, 'rb').read()


def work(wid):
    w = next((x for x in catalog() if x['id'] == wid), None)
    if not w: sys.exit(f'unknown work {wid}; try: classics.py find ...')
    return w


def pick(w, lang):
    eds = [e for e in w['e'] if e['l'] == lang] if lang else [e for e in w['e'] if e['l'] != 'eng']
    if not eds: sys.exit(f"no {lang or 'original'} edition; available: {', '.join(e['u'] + ' (' + e['l'] + ')' for e in w['e'])}")
    return eds[0]


def align(A, B):
    """same strategy as the browser (tei.js): exact refs at common depth, else numeric ranges, else proportional"""
    depth = lambda arr: max(set(len(r.split('.')) for r, _ in arr), key=[len(r.split('.')) for r, _ in arr].count)
    def merge(arr, d):
        out = {}
        for r, t in arr: out.setdefault('.'.join(r.split('.')[:d]), []).append(t)
        return [(k, ' '.join(v)) for k, v in out.items()]
    d = min(depth(A), depth(B)); ma = merge(A, d) if depth(A) > d else A; mb = merge(B, d) if depth(B) > d else B
    bm = dict(mb)
    if sum(1 for r, _ in ma if r in bm) >= 0.6 * max(len(ma), len(mb)):
        return [(r, t, bm.get(r, '')) for r, t in ma]
    coarse, fine, flip = (A, B, False) if len(A) <= len(B) else (B, A, True)
    def sp(r): p = r.split('.'); return '.'.join(p[:-1]), (int(p[-1]) if p[-1].isdigit() else None)
    rows = []
    for i, (r, t) in enumerate(coarse):
        g, n0 = sp(r); nxt = coarse[i + 1] if i + 1 < len(coarse) else None
        n1 = sp(nxt[0])[1] if nxt and sp(nxt[0])[0] == g else 10 ** 9
        parts = ' '.join(ft for fr, ft in fine if sp(fr)[0] == g and n0 is not None and sp(fr)[1] is not None and n0 <= sp(fr)[1] < (n1 or 10 ** 9))
        rows.append((r, parts, t) if flip else (r, t, parts))
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest='cmd', required=True)
    f = sp.add_parser('find'); f.add_argument('query')
    g = sp.add_parser('get'); g.add_argument('work'); g.add_argument('--lang'); g.add_argument('--ref'); g.add_argument('--around', type=int, default=0)
    a = sp.add_parser('align'); a.add_argument('work'); a.add_argument('--ref', help='row ref or prefix, e.g. 1 or 4.441'); a.add_argument('--max', type=int, default=40)
    h = sp.add_parser('to-hub'); h.add_argument('work'); h.add_argument('out'); h.add_argument('--by', default='classicist')
    x = ap.parse_args()
    if x.cmd == 'find':
        qs = x.query.lower().split()
        for w in catalog():
            hay = f"{w['a']} {w['t']} {w['id']}".lower()
            if all(q in hay for q in qs):
                print(f"{w['id']}\t{w['a']}, {w['t']}\t" + ', '.join(f"{e['l']}:{e['u'].split('.')[-1]}" for e in w['e']))
    elif x.cmd == 'get':
        w = work(x.work); ed = pick(w, x.lang); segs = parse_tei(fetch(ed))
        if x.ref:
            i = next((k for k, (r, _) in enumerate(segs) if r == x.ref or r.startswith(x.ref + '.')), None)
            if i is None: sys.exit('ref not found')
            segs = segs[max(0, i - x.around): i + x.around + 1]
        print(f"# {w['a']}, {w['t']} — {ed['u']}\n# {ed['d']}\n")
        for r, t in segs: print(f'[{r}] {t}\n')
    elif x.cmd == 'align':
        w = work(x.work); o = pick(w, None); e = pick(w, 'eng')
        rows = align(parse_tei(fetch(o)), parse_tei(fetch(e)))
        if x.ref: rows = [r for r in rows if r[0] == x.ref or r[0].startswith(x.ref + '.')]
        print(f"# {w['a']}, {w['t']}: {o['u']} ⇆ {e['u']}\n")
        for r, a_, b_ in rows[:x.max]: print(f'[{r}]\n  {a_}\n  → {b_}\n')
    elif x.cmd == 'to-hub':
        w = work(x.work); docs = []
        for ed in [pick(w, None)] + ([pick(w, 'eng')] if any(e['l'] == 'eng' for e in w['e']) else []):
            segs = parse_tei(fetch(ed)); lab = {'grc': 'Greek', 'lat': 'Latin', 'eng': 'English translation'}.get(ed['l'], ed['l'])
            docs.append({'id': f'doc_{uuid.uuid4().hex[:10]}', 'title': f"{w['a']}, {w['t']} — {lab}", 'author': w['a'], 'kind': 'classic', 'lang': ed['l'], 'era': 'classical', 'collection': 'Classics',
                         'tags': ['classics', lab.split()[0].lower()], 'source': ed['p'], 'notes': ed['d'], 'segments': [{'ref': r, 'text': t} for r, t in segs],
                         'meta': {'work': w['id'], 'urn': ed['u'], 'edition': ed['d'], 'corpus': w['src']}, 'by': x.by, 'added': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
        out = json.load(open(x.out)) if os.path.exists(x.out) else {'version': 1, 'app': 'research-hub', 'docs': []}
        out.setdefault('docs', []).extend(docs); os.makedirs(os.path.dirname(os.path.abspath(x.out)), exist_ok=True)
        json.dump(out, open(x.out, 'w', encoding='utf-8'), ensure_ascii=False)
        print(f"added {len(docs)} editions of {w['a']}, {w['t']} → {x.out}")


if __name__ == '__main__':
    main()
