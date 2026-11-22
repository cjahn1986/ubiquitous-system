#!/usr/bin/env python3
"""Research Hub bridge for the agents: read an export, write importable additions.

The browser app (tools/research/) exports `research-hub-export.json`; save it as
research/hub-export.json. Agents read it with these commands and write additions to
research/hub-import-<agent>.json, which the app's Hub & agents → Import merges.

Read:
  Add --as YOUR-AGENT-NAME to every read command: with the bridge running it applies the user's rules
  (isolated agents get nothing; agents with hidden sources get a private view).

  hub.py whoami  --as AGENT                       what the bridge lets you read and send
  hub.py stats   [EXPORT]
  hub.py docs    [EXPORT]                        list sources (id, kind, title)
  hub.py text    [EXPORT] DOC_ID [--ref R] [--around N]   print a source (or one passage ± N)
  hub.py search  [EXPORT] "query" [--n 15]        BM25 passage search (accent-insensitive)
  hub.py xref    [EXPORT] (--doc ID | --text "passage") [--n 10]   related passages elsewhere + similar sources
  hub.py gaps    [EXPORT]                        co-mentions, structural holes, time bridges, unmapped names
  hub.py map     [EXPORT]                        nodes and links as text
  hub.py trail   [EXPORT] [TRAIL_ID]             trails as Markdown (default: most recent)
  hub.py data    [EXPORT]                        data points

Write (append to an import file; created if missing):
  hub.py add node  OUT --label L [--type concept] [--era ancient] [--discipline D] [--notes N] [--status hypothesis] --by AGENT
  hub.py add link  OUT --from LABEL --to LABEL [--label how] [--status hypothesis] --by AGENT
  hub.py add step  OUT --kind finding --text T [--trail ID] [--doc ID --ref R] --by AGENT
  hub.py add data  OUT --series S --value V [--unit U] [--date D] [--quote Q] [--doc ID --ref R] --by AGENT
  hub.py add doc   OUT --title T --file PATH|--text T [--author A] [--date D] [--kind text] [--era E] [--tags a,b] --by AGENT

EXPORT defaults to research/hub-export.json.
"""
import argparse, json, math, os, re, sys, time, unicodedata, uuid
from collections import Counter, defaultdict

DEFAULT = os.path.join(os.path.dirname(__file__), '..', 'research', 'hub-export.json')
OLD = {'deep', 'ancient', 'classical', 'late-antique', 'medieval'}
NEW = {'early-modern', 'modern', 'contemporary'}
STOP = set(('a an and are as at be been but by for from had has have he her his i if in into is it its of on or our she so than that the their them then there these they this to was we were what when which who will with you your not no nor do does did can could would should may might must shall upon also such only other more most some any all one two three '
            'et in est non ad cum quod qui quae ut sed si de ex a ab per ne nec aut atque ac enim autem esse sunt sit erat iam tamen '
            'και δε το τον την του των τη τω τοις ταις ο η οι αι εν εις μεν γαρ ουκ ου ως επι προς δ τ γ κ τε αν εκ περι ουδε αλλα αλλ μη').split())


def fold(s):
    s = unicodedata.normalize('NFD', str(s or ''))
    s = ''.join(c for c in s if not unicodedata.combining(c)).replace('ς', 'σ').lower()
    return s.replace('ϐ', 'β').replace('ϑ', 'θ').replace('ſ', 's').replace('æ', 'ae').replace('œ', 'oe')


def terms(s):
    return [t for t in re.findall(r'\w+', fold(s)) if len(t) > 1 and t not in STOP and not t.isdigit() or (t.isdigit() and len(t) > 3)]


BRIDGE = os.path.join(os.path.dirname(__file__), '..', 'research', 'bridge')


def bridge_policy():
    try:
        with open(os.path.join(BRIDGE, 'policy.json'), encoding='utf-8') as f: return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError): return None


def bridge_stopped():
    p = bridge_policy()
    return os.path.exists(os.path.join(BRIDGE, 'STOP')) or (p is not None and not p.get('transport', True))


def load(path, agent=None):
    """Load the hub data this agent may read. With the bridge running, each agent reads through it:
    an isolated agent gets nothing; an agent with hidden sources gets its private view."""
    agent = agent or os.environ.get('HUB_AGENT')
    if not path and agent:
        if os.path.exists(os.path.join(BRIDGE, 'out', f'{agent}.isolated')):
            sys.exit(f'BRIDGE: the user has isolated "{agent}" from reading the hub. Do not read files in research/ '
                     f'to work around this — stop and tell the conductor that {agent} is isolated.')
        view = os.path.join(BRIDGE, 'out', f'{agent}.json')
        if os.path.exists(view): path = view
    path = path or DEFAULT
    if not os.path.exists(path):
        if bridge_stopped():
            sys.exit('BRIDGE: transport is stopped by the user, so no hub data is available. Do not look for it elsewhere — '
                     'tell the conductor the bridge is stopped.')
        sys.exit(f'No hub data at {path}. Start the bridge (python3 scripts/hub_bridge.py serve) and open the hub through it, '
                 'or in the hub: Hub & agents → Export everything, saved as research/hub-export.json')
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def doc_text(d):
    if d.get('segments'):
        return '\n\n'.join(s['text'] for s in d['segments'])
    if d.get('pages'):
        return '\n\n'.join(d['pages'])
    return d.get('text') or ''


def chunks_of(d, size=700):
    if d.get('segments'):
        return [(s['ref'], s['text']) for s in d['segments']]
    out = []
    if d.get('pages'):
        for pi, p in enumerate(d['pages']):
            for c in _chunk(p, size):
                out.append((f'p. {pi + 1}', c))
        return out
    return [(f'¶{i + 1}', c) for i, c in enumerate(_chunk(d.get('text') or '', size))]


def _chunk(text, size):
    paras = [re.sub(r'\s+', ' ', p).strip() for p in re.split(r'\n\s*\n', text or '') if p.strip()]
    out, cur = [], ''
    for p in paras:
        if len(p) > size * 1.6:
            if cur: out.append(cur); cur = ''
            buf = ''
            for s in re.split(r'(?<=[.;·!?])\s+', p):
                if len(buf) + len(s) > size and buf: out.append(buf); buf = s
                else: buf = (buf + ' ' + s).strip()
            if buf: out.append(buf)
        elif len(cur) + len(p) > size and cur: out.append(cur); cur = p
        else: cur = (cur + '\n' + p).strip()
    if cur: out.append(cur)
    return out


class Index:
    def __init__(self, ex):
        self.docs = {d['id']: d for d in ex.get('docs', [])}
        self.chunks, self.post, self.len = [], defaultdict(list), []
        self.doc_terms = {}
        for d in self.docs.values():
            dt = Counter()
            for ref, text in chunks_of(d):
                i = len(self.chunks); self.chunks.append((d['id'], ref, text))
                ts = terms(text); self.len.append(len(ts)); tf = Counter(ts); dt.update(tf)
                for t, f in tf.items(): self.post[t].append((i, f))
            self.doc_terms[d['id']] = dt
        self.avg = sum(self.len) / max(1, len(self.len))
        self.df = Counter(t for dt in self.doc_terms.values() for t in dt)

    def idf(self, t):
        N, n = len(self.chunks), len(self.post.get(t, ()))
        return math.log(1 + (N - n + 0.5) / (n + 0.5))

    def search(self, q, n=15, exclude=None):
        phrases = [fold(p) for p in re.findall(r'"([^"]+)"', q)]
        ts = list(dict.fromkeys(terms(re.sub(r'"', ' ', q))))
        score, hits = Counter(), Counter()
        for t in ts:
            idf = self.idf(t)
            for i, f in self.post.get(t, ()):
                score[i] += idf * f * 2.4 / (f + 1.4 * (0.25 + 0.75 * self.len[i] / self.avg)); hits[i] += 1
        res = []
        for i, s in score.most_common():
            d, ref, text = self.chunks[i]
            if exclude and d == exclude: continue
            if phrases and not all(p in ' '.join(re.findall(r'\w+', fold(text))) for p in phrases): continue
            res.append((s * (1 + 0.5 * (hits[i] - 1) / max(1, len(ts))), i))
            if len(res) >= n: break
        return res, ts

    def key_terms(self, text, n=10):
        tf = Counter(t for t in terms(text) if len(t) > 2)
        return [t for t, _ in sorted(tf.items(), key=lambda x: -x[1] * self.idf(x[0]))[:n]]

    def vec(self, did, top=250):
        N = max(1, len(self.docs))
        v = {t: (1 + math.log(f)) * math.log(1 + N / self.df[t]) for t, f in self.doc_terms.get(did, {}).items()}
        return dict(sorted(v.items(), key=lambda x: -x[1])[:top])

    def related(self, did, n=10):
        a = self.vec(did); na = math.sqrt(sum(w * w for w in a.values())) or 1; out = []
        for o in self.docs:
            if o == did: continue
            b = self.vec(o); dot = 0; shared = []
            for t, w in a.items():
                if t in b: dot += w * b[t]; shared.append((w * b[t], t))
            if dot:
                nb = math.sqrt(sum(w * w for w in b.values())) or 1
                out.append((dot / (na * nb), o, [t for _, t in sorted(shared, reverse=True)[:8]]))
        return sorted(out, reverse=True)[:n]

    def mentions(self, label):
        ts = terms(label)
        if not ts: return set()
        cand = None
        for t in ts:
            s = {i for i, _ in self.post.get(t, ())}
            cand = s if cand is None else cand & s
        phrase = ' '.join(ts)
        return {i for i in cand if len(ts) == 1 or phrase in ' '.join(terms(self.chunks[i][2]))}


def snip(text, ts, n=240):
    f = fold(text); pos = min([f.find(t) for t in ts if f.find(t) >= 0] or [0])
    s = max(0, pos - 80)
    return ('… ' if s else '') + re.sub(r'\s+', ' ', text[s:s + n]) + (' …' if s + n < len(text) else '')


# ---------------- read commands ----------------
def cmd_stats(a):
    ex = load(a.export, a.agent)
    for k in ('docs', 'nodes', 'links', 'trails', 'data', 'etym'):
        print(f'{k:7} {len(ex.get(k, []))}')
    print('exported', ex.get('exported'))


def cmd_docs(a):
    for d in load(a.export, a.agent).get('docs', []):
        print(f"{d['id']}\t{d.get('kind', '')}\t{d.get('era', '')}\t{d.get('title', '')}\t{len(doc_text(d))} chars")


def cmd_text(a):
    ex = load(a.export, a.agent); d = next((x for x in ex['docs'] if x['id'] == a.doc), None)
    if not d: sys.exit('no such doc')
    ch = chunks_of(d)
    if a.ref:
        idx = next((i for i, (r, _) in enumerate(ch) if r == a.ref), None)
        if idx is None: sys.exit('no such ref')
        ch = ch[max(0, idx - a.around): idx + a.around + 1]
    print(f"# {d.get('title')}  [{d['id']}]  {d.get('author', '')} {d.get('date', '')}\n")
    for r, t in ch: print(f'[{r}] {t}\n')


def cmd_search(a):
    ix = Index(load(a.export, a.agent)); res, ts = ix.search(a.query, a.n)
    if not res: print('no passages'); return
    for s, i in res:
        d, ref, text = ix.chunks[i]
        print(f"{s:6.2f}  {ix.docs[d].get('title')} [{d}] {ref}\n        {snip(text, ts)}\n")


def cmd_xref(a):
    ex = load(a.export, a.agent); ix = Index(ex)
    if a.doc:
        print('Similar sources:')
        for sim, o, shared in ix.related(a.doc, a.n):
            print(f"  {sim:.0%}  {ix.docs[o].get('title')} [{o}]  shared: {', '.join(shared[:6])}")
        text = doc_text(ix.docs[a.doc])[:200000]
    else:
        text = a.text
    q = ' '.join(ix.key_terms(text, 10)); print(f'\nPassages elsewhere matching key terms: {q}')
    res, ts = ix.search(q, a.n, exclude=a.doc)
    for s, i in res:
        d, ref, t = ix.chunks[i]
        print(f"  {s:6.2f}  {ix.docs[d].get('title')} [{d}] {ref}\n          {snip(t, ts)}")


def cmd_gaps(a):
    ex = load(a.export, a.agent); ix = Index(ex)
    nodes = {n['id']: n for n in ex.get('nodes', [])}; links = ex.get('links', [])
    linked = {(l['from'], l['to']) for l in links} | {(l['to'], l['from']) for l in links}
    nb = defaultdict(set)
    for l in links: nb[l['from']].add(l['to']); nb[l['to']].add(l['from'])
    ment = {i: ix.mentions(n['label']) for i, n in nodes.items()}
    ids = list(nodes)
    co = []
    for x in range(len(ids)):
        for y in range(x + 1, len(ids)):
            p, q = ids[x], ids[y]
            if (p, q) in linked: continue
            c = ment[p] & ment[q]
            if c: co.append((len(c), p, q, sorted(c)[:3]))
    print('## Mentioned together in sources, not linked')
    for c, p, q, ex_ in sorted(co, reverse=True)[:20]:
        d, ref, _ = ix.chunks[ex_[0]]
        print(f"  {nodes[p]['label']} ↔ {nodes[q]['label']}: {c} passages (e.g. {ix.docs[d].get('title')} {ref})")
    print('\n## Structural holes (≥2 shared neighbours, not linked)')
    for x in range(len(ids)):
        for y in range(x + 1, len(ids)):
            p, q = ids[x], ids[y]
            s = nb[p] & nb[q]
            if len(s) >= 2 and (p, q) not in linked:
                print(f"  {nodes[p]['label']} ↔ {nodes[q]['label']} via {', '.join(nodes[i]['label'] for i in list(s)[:4])}")
    print('\n## Across time')
    for l in links:
        A, B = nodes.get(l['from']), nodes.get(l['to'])
        if A and B and ((A.get('era') in OLD and B.get('era') in NEW) or (A.get('era') in NEW and B.get('era') in OLD)):
            print(f"  bridge: {A['label']} — {B['label']} ({l.get('label', '')})")
    for i, n in nodes.items():
        e = n.get('era')
        if e in OLD | NEW and not any(nodes.get(o, {}).get('era') in (NEW if e in OLD else OLD) for o in nb[i]):
            print(f"  no bridge: {n['label']} ({e}) — {'modern counterpart?' if e in OLD else 'ancient precursor?'}")
    print('\n## Recurring names in sources, not on the map')
    onmap = {fold(n['label']) for n in nodes.values()}; cnt = Counter(); docs_with = defaultdict(set); lower = Counter(); label = {}
    for d in ix.docs.values():
        txt = doc_text(d)[:400000]
        for m in re.finditer(r'(?<=[\s(“"\'])([a-z\u03b1-\u03c9\u1f00-\u1fff][a-z\u03b1-\u03c9\u1f00-\u1fff]{3,})', txt): lower[fold(m.group(1))] += 1
        for m in re.finditer(r'\b([A-Z\u0391-\u03A9][a-z\u03b1-\u03c9\u1f00-\u1fff]{3,}(?:\s+(?:of\s+|the\s+)?[A-Z\u0391-\u03A9][a-z\u03b1-\u03c9\u1f00-\u1fff]{3,}){0,2})(?![\w.])', txt):
            f = fold(m.group(1))
            if f in onmap: continue
            cnt[f] += 1; docs_with[f].add(d['id']); label.setdefault(f, m.group(1))
    multi = len(ix.docs) > 1
    keep = [f for f in cnt if lower[f] < 0.3 * cnt[f] and (len(docs_with[f]) >= 2 if multi else cnt[f] >= 5)]
    for f in sorted(keep, key=lambda f: -(len(docs_with[f]) * 10 + cnt[f]))[:25]:
        print(f'  {label[f]}: {cnt[f]}× in {len(docs_with[f])} sources')


def cmd_whoami(a):
    agent = a.agent or os.environ.get('HUB_AGENT')
    p = bridge_policy()
    if p is None: print('No bridge rules found (bridge never started). Reading research/hub-export.json if present.')
    else:
        r = {**{'send': True, 'receive': True, 'hide_docs': []}, **p.get('agents', {}).get(agent or '', {})}
        print(f"Bridge transport: {'STOPPED' if bridge_stopped() else 'on'} · hub→agents {'on' if p.get('outbound', True) else 'off'} · agents→hub {'on' if p.get('inbound', True) else 'off'}")
        if agent: print(f"{agent}: {'can' if r['receive'] else 'CANNOT'} read the hub · {'can send to it' if r['send'] else 'CANNOT send to it (your files will be held for the user)'} · {len(r['hide_docs'])} sources hidden from it")
    ex = load(a.export, agent)
    print('Readable now:', ', '.join(f'{len(ex.get(k, []))} {k}' for k in ('docs', 'nodes', 'links', 'trails', 'data', 'etym')), '· exported', ex.get('exported'))


def cmd_map(a):
    ex = load(a.export, a.agent); nodes = {n['id']: n for n in ex.get('nodes', [])}
    for n in nodes.values():
        print(f"[{n.get('type', '')}/{n.get('era', '') or '-'}] {n['label']}" + (f" — {n['notes'][:120]}" if n.get('notes') else '') + (f" ({n['status']})" if n.get('status') else ''))
    print()
    for l in ex.get('links', []):
        if l['from'] in nodes and l['to'] in nodes:
            print(f"{nodes[l['from']]['label']} —{l.get('label') or 'related'}→ {nodes[l['to']]['label']}" + (f" ({l['status']})" if l.get('status') else ''))


def cmd_trail(a):
    ex = load(a.export, a.agent); trails = sorted(ex.get('trails', []), key=lambda t: t.get('updated', ''), reverse=True)
    if not trails: print('no trails'); return
    t = next((x for x in trails if x['id'] == a.trail), trails[0]) if a.trail else trails[0]
    print(f"# {t['title']}  [{t['id']}]\n> {t.get('question', '')}\n")
    for s in t['steps']:
        print(f"- **{s['kind']}**{' (resolved)' if s.get('resolved') else ''} {s.get('time', '')[:16]}: {s['text']}")


def cmd_data(a):
    for d in load(a.export, a.agent).get('data', []):
        print(f"{d.get('series')}\t{d.get('value')} {d.get('unit', '')}\t{d.get('date', '')}\t{(d.get('quote') or '')[:80]}")


# ---------------- write commands ----------------
def _out(path):
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f: return json.load(f)
    return {'version': 1, 'app': 'research-hub', 'docs': [], 'nodes': [], 'links': [], 'trails': [], 'data': [], 'steps': []}


def _save(path, j):
    os.makedirs(os.path.dirname(os.path.abspath(path)) or '.', exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f: json.dump(j, f, ensure_ascii=False, indent=1)


def _id(p): return f'{p}_{uuid.uuid4().hex[:10]}'
def _now(): return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def _refs(a):
    return [{'t': 'doc', 'id': a.doc, **({'anchor': a.ref} if a.ref else {})}] if getattr(a, 'doc', None) else []


def cmd_add(a):
    j = _out(a.out)
    if a.what == 'node':
        j['nodes'].append({k: v for k, v in {'id': _id('n'), 'label': a.label, 'type': a.type, 'era': a.era, 'discipline': a.discipline, 'notes': a.notes, 'status': a.status, 'by': a.by, 'refs': _refs(a), 'created': _now()}.items() if v not in (None, '')})
    elif a.what == 'link':
        def nid(label):
            for n in j['nodes']:
                if fold(n['label']) == fold(label): return n['id']
            n = {'id': _id('n'), 'label': label, 'type': 'concept', 'by': a.by, 'created': _now()}; j['nodes'].append(n); return n['id']
        j['links'].append({k: v for k, v in {'id': _id('l'), 'from': nid(getattr(a, 'from')), 'to': nid(a.to), 'label': a.label, 'status': a.status, 'by': a.by, 'created': _now()}.items() if v not in (None, '')})
    elif a.what == 'step':
        step = {'id': _id('st'), 'kind': a.kind, 'text': a.text, 'refs': _refs(a), 'time': _now(), 'by': a.by}
        if a.trail: j['trails'].append({'id': a.trail, 'appendSteps': [step]})
        else: j['steps'].append(step)
    elif a.what == 'data':
        j['data'].append({k: v for k, v in {'id': _id('d'), 'series': a.series, 'value': a.value, 'unit': a.unit, 'date': a.date, 'quote': a.quote, 'refs': _refs(a), 'by': a.by, 'created': _now()}.items() if v not in (None, '')})
    elif a.what == 'doc':
        text = open(a.file, encoding='utf-8', errors='replace').read() if a.file else a.text
        j['docs'].append({k: v for k, v in {'id': _id('doc'), 'title': a.title, 'author': a.author, 'date': a.date, 'kind': a.kind, 'era': a.era, 'tags': [t.strip() for t in (a.tags or '').split(',') if t.strip()], 'text': text, 'source': a.source, 'by': a.by, 'added': _now()}.items() if v not in (None, '', [])})
    _save(a.out, j); print(f'added {a.what} → {a.out}')
    p = bridge_policy()
    if p is not None:
        r = p.get('agents', {}).get(a.by, {})
        if bridge_stopped(): print('note: the bridge is stopped — this file waits until the user resumes transport.')
        elif r.get('send') is False: print(f'note: the user has isolated {a.by} from sending — this file will be held for their decision.')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest='cmd', required=True)
    def r(name, f, *args):
        p = sp.add_parser(name); p.set_defaults(f=f)
        p.add_argument('--export', default=None, help='path to hub export (default research/hub-export.json)')
        p.add_argument('--as', dest='agent', default=None, help='your agent name: read through the bridge (isolation, private views)')
        for x in args: x(p)
        return p
    r('stats', cmd_stats); r('whoami', cmd_whoami); r('docs', cmd_docs); r('map', cmd_map); r('data', cmd_data); r('gaps', cmd_gaps)
    r('text', cmd_text, lambda p: p.add_argument('doc'), lambda p: p.add_argument('--ref'), lambda p: p.add_argument('--around', type=int, default=0))
    r('search', cmd_search, lambda p: p.add_argument('query'), lambda p: p.add_argument('--n', type=int, default=15))
    r('xref', cmd_xref, lambda p: p.add_argument('--doc'), lambda p: p.add_argument('--text'), lambda p: p.add_argument('--n', type=int, default=10))
    r('trail', cmd_trail, lambda p: p.add_argument('trail', nargs='?'))
    add = sp.add_parser('add'); add.set_defaults(f=cmd_add)
    add.add_argument('what', choices=['node', 'link', 'step', 'data', 'doc']); add.add_argument('out')
    for k in ('label', 'type', 'era', 'discipline', 'notes', 'status', 'to', 'kind', 'text', 'trail', 'doc', 'ref', 'series', 'value', 'unit', 'date', 'quote', 'title', 'file', 'author', 'tags', 'source'):
        add.add_argument('--' + k)
    add.add_argument('--from', dest='from'); add.add_argument('--by', required=True)
    a = ap.parse_args()
    if a.cmd == 'add':
        a.type = a.type or ('concept' if a.what == 'node' else None); a.kind = a.kind or ('finding' if a.what == 'step' else 'text' if a.what == 'doc' else None)
    elif a.cmd == 'xref' and not (a.doc or a.text):
        ap.error('xref needs --doc or --text')
    a.f(a)


if __name__ == '__main__':
    main()
