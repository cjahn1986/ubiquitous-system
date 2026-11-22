#!/usr/bin/env python3
"""Research Hub bridge — moves work between the browser hub and the agents, under your control.

Run it instead of `python3 -m http.server`:

    python3 scripts/hub_bridge.py serve            # then open http://localhost:8000/research/

It serves the tools (same address as before, so your browser data stays put) and shares the
repo's research/ folder with the hub:

    hub → agents   the hub's data is written to research/hub-export.json (your exclusions applied,
                   per-agent private views in research/bridge/out/)
    agents → hub   agents write research/hub-import-<agent>.json; the bridge checks each file
                   against your rules and the hub takes it in, then the file moves to
                   research/bridge/delivered/

Every transfer and every change of rules is described in research/bridge/transport.log, on the
hub's 🌉 Bridge page, and in this terminal.

Controls (work whether or not the server is running; the hub's Bridge page does the same):

    hub_bridge.py status                       state, agents, waiting files, recent transfers
    hub_bridge.py stop [--withdraw]            halt all transport (--withdraw: also delete what agents can read)
    hub_bridge.py start                        resume
    hub_bridge.py isolate AGENT… [--only send|receive]    cut agents off (AGENT may be "all")
    hub_bridge.py release AGENT…               reconnect agents ("all" works)
    hub_bridge.py hold PATTERN                 hold agent files matching e.g. "hub-import-test*.json"
    hub_bridge.py unhold PATTERN
    hub_bridge.py exclude [--doc ID] [--tag T] [--collection C] [--kind K]   keep sources off the bridge
    hub_bridge.py include [--doc ID] [--tag T] [--collection C] [--kind K]
    hub_bridge.py log [-n 30] [--follow]
    hub_bridge.py policy                       print the rules as JSON

Emergency stop from anywhere: create the file research/bridge/STOP (delete it to allow transport).

Security: listens on 127.0.0.1 only; the API answers only requests that carry the hub's own header
and a localhost Host, so other web pages cannot reach it. Isolation of agents from *reading* is a
rule the agents follow (they have file access); keeping a source off the bridge entirely means it is
never written to disk for agents at all.
"""
import argparse, fnmatch, hashlib, http.server, json, os, re, shutil, sys, threading, time, urllib.parse, webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / 'tools'
RESEARCH = ROOT / 'research'
BR = RESEARCH / 'bridge'
POLICY = BR / 'policy.json'
STATE = BR / 'inbox-state.json'
LOG = BR / 'transport.log'
STOPFILE = BR / 'STOP'
OUT = BR / 'out'
SHARED = RESEARCH / 'hub-export.json'
DELIVERED, REJECTED, DISCARDED = BR / 'delivered', BR / 'rejected', BR / 'discarded'
AGENTS_DIR = ROOT / '.claude' / 'agents'
RESEARCH_TEAM = ['archivist', 'cross-referencer', 'web-scout', 'classicist', 'etymologist', 'cartographer', 'data-steward', 'trail-keeper']
STORES = ['docs', 'text', 'nodes', 'links', 'trails', 'data', 'etym']
STORE_LABEL = {'docs': 'sources', 'text': 'source text', 'nodes': 'map nodes', 'links': 'map links', 'trails': 'trails', 'data': 'data points', 'etym': 'etymology entries'}
MAX_IN = 25 * 1024 * 1024
MAX_POST = 600 * 1024 * 1024
SETTLE = 2.5          # seconds a file must be unchanged before it counts as finished
CLAIM_TTL = 90
LOCK = threading.RLock()
TERM = {'verbosity': 2, 'quiet': False}


def now(): return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
def human(n): return f'{n / 1e6:.1f} MB' if n >= 1e6 else f'{n / 1e3:.1f} KB' if n >= 1e3 else f'{n} B'
def plural(n, word, pl=None): return f"{n} {word if n == 1 else (pl or word + 's')}"


def atomic_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name('.' + path.name + '.tmp')
    tmp.write_text(text, encoding='utf-8'); os.replace(tmp, path)


# ---------------------------------------------------------------- policy
def default_policy():
    return {'rev': 1, 'transport': True, 'outbound': True, 'inbound': True, 'review': False, 'verbosity': 2,
            'stores': {s: True for s in STORES}, 'exclude': {'docs': [], 'tags': [], 'collections': [], 'kinds': []},
            'agents': {}, 'hold_files': [], 'updated': now(), 'updated_by': 'default'}


_pcache = {'mtime': None, 'p': None}


def load_policy():
    with LOCK:
        try:
            m = POLICY.stat().st_mtime_ns
            if _pcache['mtime'] == m: return json.loads(json.dumps(_pcache['p']))
            p = json.loads(POLICY.read_text(encoding='utf-8'))
        except FileNotFoundError:
            p, m = default_policy(), None
        except json.JSONDecodeError:
            p, m = default_policy(), None
        d = default_policy()
        for k, v in d.items():
            if k not in p: p[k] = v
            elif isinstance(v, dict) and k != 'agents': p[k] = {**v, **p[k]}
        _pcache.update(mtime=m, p=p)
        return json.loads(json.dumps(p))


def save_policy(p, by):
    with LOCK:
        p['rev'] = int(p.get('rev', 0)) + 1; p['updated'] = now(); p['updated_by'] = by
        atomic_write(POLICY, json.dumps(p, ensure_ascii=False, indent=1))
        _pcache['mtime'] = None
        return p


def rule(p, agent):
    r = p.get('agents', {}).get(agent, {})
    return {'send': r.get('send', True), 'receive': r.get('receive', True), 'hide_docs': list(r.get('hide_docs', []))}


def transport_on(p): return bool(p.get('transport')) and not STOPFILE.exists()


def deep_merge(a, b):
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(a.get(k), dict) and k != 'exclude': deep_merge(a[k], v)
        elif isinstance(v, dict) and k == 'exclude': a[k] = {**a.get(k, {}), **v}
        else: a[k] = v
    return a


def describe_policy_change(old, new):
    """plain-language list of what changed between two policies"""
    out = []
    if transport_on(old) != transport_on(new) or old.get('transport') != new.get('transport'):
        out.append('Transport STARTED — data flows again.' if new.get('transport') else 'Transport STOPPED — nothing goes to the agents and their files wait.')
    for k, on, off in (('outbound', 'Hub → agents is ON: the agents can read your hub.', 'Hub → agents is OFF: nothing new is written for the agents.'),
                       ('inbound', 'Agents → hub is ON: their additions are accepted.', 'Agents → hub is OFF: their files wait.'),
                       ('review', 'Review mode ON: every agent file waits for your approval.', 'Review mode OFF: agent files are delivered automatically.')):
        if old.get(k) != new.get(k): out.append(on if new.get(k) else off)
    for s in STORES:
        a, b = old['stores'].get(s, True), new['stores'].get(s, True)
        if a != b:
            out.append(f"{STORE_LABEL[s].capitalize()} will {'now' if b else 'no longer'} be sent to the agents" + (' (titles and details only).' if s == 'text' and not b else '.'))
    for kind, label in (('docs', 'source'), ('tags', 'tag'), ('collections', 'collection'), ('kinds', 'kind')):
        a, b = set(old['exclude'].get(kind, [])), set(new['exclude'].get(kind, []))
        fmt = (lambda x: f'⟦doc:{x}⟧') if kind == 'docs' else (lambda x: f'“{x}”')
        if b - a: out.append(f"Kept off the bridge: {label} {', '.join(fmt(x) for x in sorted(b - a))}.")
        if a - b: out.append(f"Allowed on the bridge again: {label} {', '.join(fmt(x) for x in sorted(a - b))}.")
    names = set(old.get('agents', {})) | set(new.get('agents', {}))
    for n in sorted(names):
        a, b = rule(old, n), rule(new, n)
        if a['send'] != b['send']: out.append(f"{n}: {'can send to the hub again' if b['send'] else 'isolated from sending — its files will be held'}.")
        if a['receive'] != b['receive']: out.append(f"{n}: {'can read hub data again' if b['receive'] else 'isolated from receiving — it can no longer read hub data'}.")
        ha, hb = set(a['hide_docs']), set(b['hide_docs'])
        if hb - ha: out.append(f"{n}: hidden from it — {', '.join(f'⟦doc:{x}⟧' for x in sorted(hb - ha))}.")
        if ha - hb: out.append(f"{n}: may see again — {', '.join(f'⟦doc:{x}⟧' for x in sorted(ha - hb))}.")
    a, b = set(old.get('hold_files', [])), set(new.get('hold_files', []))
    if b - a: out.append(f"Agent files matching {', '.join(sorted(b - a))} will be held.")
    if a - b: out.append(f"Agent files matching {', '.join(sorted(a - b))} are no longer held.")
    if old.get('verbosity') != new.get('verbosity'): out.append(f"Log detail set to level {new.get('verbosity')}.")
    return out


# ---------------------------------------------------------------- transport log
def log(direction, event, summary, detail='', items=None, **extra):
    e = {'id': str(time.time_ns()), 't': now(), 'dir': direction, 'event': event, 'summary': summary, 'detail': detail, 'items': items or [], **extra}
    with LOCK:
        BR.mkdir(parents=True, exist_ok=True)
        if LOG.exists() and LOG.stat().st_size > 5 * 1024 * 1024:
            os.replace(LOG, LOG.with_suffix('.log.1'))
        with open(LOG, 'a', encoding='utf-8') as f: f.write(json.dumps(e, ensure_ascii=False) + '\n')
    if not TERM['quiet']: print_entry(e, TERM['verbosity'])
    return e


ARROW = {'out': 'hub → agents', 'in': 'agents → hub', 'control': 'control'}
COLOR = {'out': '\033[36m', 'in': '\033[33m', 'control': '\033[35m'}


def detok(s): return re.sub(r'⟦doc:([^⟧]+)⟧', r'source \1', s)


def print_entry(e, v):
    tty = sys.stdout.isatty(); c = COLOR.get(e['dir'], '') if tty else ''; r = '\033[0m' if tty else ''
    print(f"{c}[{e['t'][11:19]}] {ARROW.get(e['dir'], e['dir']):13}{r} {detok(e['summary'])}", flush=True)
    if v >= 2 and e.get('detail'): print(f"{'':25}{detok(e['detail'])}", flush=True)
    if v >= 3 and e.get('items'):
        for it in e['items'][:200]: print(f"{'':27}· {detok(it)}", flush=True)


def read_log(after='0', limit=300):
    if not LOG.exists(): return []
    out = []
    with open(LOG, encoding='utf-8') as f:
        lines = f.readlines()[-4000:]
    for ln in lines:
        try:
            e = json.loads(ln)
            if int(e['id']) > int(after or 0): out.append(e)
        except (ValueError, KeyError): pass
    return out[-limit:]


# ---------------------------------------------------------------- agents
def list_agents(p=None):
    p = p or load_policy(); found = {}
    for f in sorted(AGENTS_DIR.glob('*.md')):
        txt = f.read_text(encoding='utf-8', errors='replace')
        m = re.search(r'^name:\s*(.+)$', txt, re.M); d = re.search(r'^description:\s*(.+)$', txt, re.M)
        name = (m.group(1).strip() if m else f.stem)
        desc = d.group(1).strip() if d else ''
        desc = re.split(r'(?<=[.!?])\s', desc)[0][:160]
        team = 'lead' if name == 'conductor' else 'research' if name in RESEARCH_TEAM else 'science'
        found[name] = {'name': name, 'team': team, 'about': desc}
    for n in p.get('agents', {}):
        found.setdefault(n, {'name': n, 'team': 'other', 'about': ''})
    for f in RESEARCH.glob('hub-import-*.json'):
        n = agent_of(f.name); found.setdefault(n, {'name': n, 'team': 'other', 'about': 'seen only as a file writer'})
    for a in found.values(): a.update(rule(p, a['name']))
    order = {'lead': 0, 'research': 1, 'science': 2, 'other': 3}
    return sorted(found.values(), key=lambda a: (order[a['team']], a['name']))


def agent_of(fname):
    m = re.match(r'hub-import-(.+?)\.json$', fname)
    return m.group(1) if m else 'unknown'


# ---------------------------------------------------------------- filtering (mirrors tools/research/js/bridge.js)
def apply_rules(ex, p, agent=None):
    st = {**{s: True for s in STORES}, **p.get('stores', {})}; x = p.get('exclude', {})
    hide, tags, cols, kinds = set(x.get('docs', [])), set(x.get('tags', [])), set(x.get('collections', [])), set(x.get('kinds', []))
    ah = set(rule(p, agent)['hide_docs']) if agent else set()
    W = {'docs': [], 'stores_off': [s for s in STORES if not st[s]], 'steps_scrubbed': 0, 'nodes_scrubbed': 0, 'data_dropped': 0}
    gone, docs = set(), []
    for d in ex.get('docs', []):
        t = next((t for t in d.get('tags', []) if t in tags), None)
        reason = ('sources are not being sent' if not st['docs'] else 'excluded by you' if d.get('id') in hide else f'hidden from {agent}' if d.get('id') in ah
                  else f'tag #{t} excluded' if t else f"collection “{d.get('collection')}” excluded" if d.get('collection') in cols else f"kind “{d.get('kind')}” excluded" if d.get('kind') in kinds else '')
        if reason: gone.add(d.get('id')); W['docs'].append({'id': d.get('id'), 'reason': reason}); continue
        docs.append(d if st['text'] else {k: v for k, v in d.items() if k not in ('text', 'pages', 'segments')})
    hit = lambda refs: any(r.get('t') == 'doc' and r.get('id') in gone for r in refs or [])
    keep = lambda refs: [r for r in refs or [] if not (r.get('t') == 'doc' and r.get('id') in gone)]
    out = {k: v for k, v in ex.items() if k not in ('docs', 'nodes', 'links', 'trails', 'data', 'etym')}
    out['docs'] = docs
    nodes = []
    for n in (ex.get('nodes', []) if st['nodes'] else []):
        if hit(n.get('refs')):
            W['nodes_scrubbed'] += 1; k = keep(n.get('refs'))
            n = {**n, 'refs': k, 'notes': n.get('notes', '') if any(r.get('t') == 'doc' for r in k) else ''}
        nodes.append(n)
    out['nodes'] = nodes
    out['links'] = ex.get('links', []) if st['links'] and st['nodes'] else []
    trails = []
    for t in (ex.get('trails', []) if st['trails'] else []):
        steps = []
        for s in t.get('steps', []):
            if hit(s.get('refs')):
                W['steps_scrubbed'] += 1
                s = {k: v for k, v in s.items() if k != 'quote'}; s.update(text='[withheld: this step refers to a source kept off the bridge]', refs=keep(s.get('refs')))
            steps.append(s)
        trails.append({**t, 'steps': steps})
    out['trails'] = trails
    data = []
    for d in (ex.get('data', []) if st['data'] else []):
        if hit(d.get('refs')): W['data_dropped'] += 1
        else: data.append(d)
    out['data'] = data
    out['etym'] = ex.get('etym', []) if st['etym'] else []
    return out, W


def counts_of(ex):
    return {'docs': len(ex.get('docs', [])), 'text': sum(1 for d in ex.get('docs', []) if d.get('text') or d.get('pages') or d.get('segments')),
            'nodes': len(ex.get('nodes', [])), 'links': len(ex.get('links', [])), 'trails': len(ex.get('trails', [])),
            'steps': sum(len(t.get('steps', [])) for t in ex.get('trails', [])), 'data': len(ex.get('data', [])), 'etym': len(ex.get('etym', []))}


def describe_counts(c, text_on=True):
    src = plural(c['docs'], 'source') + ('' if not c['docs'] else ' (with text)' if text_on and c['text'] else ' (titles and details only)')
    return ', '.join([src, plural(c['nodes'], 'map node'), plural(c['links'], 'link'), f"{plural(c['trails'], 'trail')} ({plural(c['steps'], 'step')})", plural(c['data'], 'data point'), plural(c['etym'], 'etymology entry', 'etymology entries')])


def describe_withheld(W):
    parts = []
    if W['docs']:
        by = {}
        for d in W['docs']: by.setdefault(d['reason'], []).append(d['id'])
        parts += [f"{plural(len(ids), 'source')} ({reason}: {', '.join(f'⟦doc:{i}⟧' for i in ids[:12])}{'…' if len(ids) > 12 else ''})" for reason, ids in by.items()]
    if W['stores_off']: parts.append('not sending ' + ', '.join(STORE_LABEL[s] for s in W['stores_off']))
    if W['steps_scrubbed']: parts.append(f"{plural(W['steps_scrubbed'], 'trail step')} blanked because they cite a withheld source")
    if W['nodes_scrubbed']: parts.append(f"{plural(W['nodes_scrubbed'], 'node')} stripped of references to withheld sources")
    if W['data_dropped']: parts.append(f"{plural(W['data_dropped'], 'data point')} dropped (evidence from a withheld source)")
    return '; '.join(parts)


def merge_withheld(a, b):
    return {'docs': a.get('docs', []) + [d for d in b.get('docs', []) if d['id'] not in {x['id'] for x in a.get('docs', [])}],
            'stores_off': sorted(set(a.get('stores_off', [])) | set(b.get('stores_off', []))),
            **{k: a.get(k, 0) + b.get(k, 0) for k in ('steps_scrubbed', 'nodes_scrubbed', 'data_dropped')}}


# ---------------------------------------------------------------- outbound
_last = {'shared': None, 'blocked': None}


def withdraw(reason):
    removed = []
    if SHARED.exists(): SHARED.unlink(); removed.append('research/hub-export.json')
    for f in OUT.glob('*.json'): f.unlink(); removed.append(f'research/bridge/out/{f.name}')
    _last['shared'] = None
    if removed:
        log('control', 'withdrawn', f'Withdrew hub data from the agents ({reason}).', 'Deleted ' + ', '.join(removed) + '. Agents can no longer read your hub until transport resumes.', items=removed)
    return removed


def handle_export(payload):
    p = load_policy(); ex = payload.get('export') or {}
    if not transport_on(p) or not p.get('outbound'):
        why = 'transport is stopped' if not transport_on(p) else 'hub → agents is off'
        if _last['blocked'] != why:
            _last['blocked'] = why; log('out', 'blocked', f'Not sent: {why}.', 'The hub offered its data; nothing was written for the agents.')
        return {'written': False, 'reason': why}
    _last['blocked'] = None
    agents = list_agents(p)
    receivers = [a['name'] for a in agents if a['receive']]
    blocked = [a['name'] for a in agents if not a['receive']]
    OUT.mkdir(parents=True, exist_ok=True)
    # per-agent markers and private views
    private = []
    for a in agents:
        marker, view = OUT / f"{a['name']}.isolated", OUT / f"{a['name']}.json"
        if not a['receive']:
            atomic_write(marker, f"{a['name']} is isolated from receiving hub data by the user ({now()}).\n")
            if view.exists(): view.unlink()
            continue
        if marker.exists(): marker.unlink()
        if a['hide_docs']:
            v, W = apply_rules(ex, p, a['name'])
            atomic_write(view, json.dumps(v, ensure_ascii=False, separators=(',', ':')))
            private.append(f"{a['name']} ({plural(len([d for d in W['docs'] if d['reason'].startswith('hidden from')]), 'more source')} hidden)")
        elif view.exists(): view.unlink()
    if not receivers:
        withdraw('every agent is isolated from receiving')
        log('out', 'blocked', 'Not sent: every agent is isolated from receiving.', 'Release an agent on the Bridge page to share your hub again.')
        return {'written': False, 'reason': 'all agents isolated'}
    shared, W = apply_rules(ex, p)
    W = merge_withheld(payload.get('withheld') or {}, W)
    text = json.dumps(shared, ensure_ascii=False, separators=(',', ':'))
    sha = hashlib.sha256(text.encode()).hexdigest()
    if sha == _last['shared'] and SHARED.exists():
        return {'written': False, 'reason': 'unchanged'}
    atomic_write(SHARED, text); _last['shared'] = sha
    c = counts_of(shared); size = len(text.encode())
    summary = f"Sent your hub to {plural(len(receivers), 'agent')}: research/hub-export.json ({human(size)}, sha256 {sha[:10]})" + (f" — after {payload.get('why')}" if payload.get('why') else '') + '.'
    detail = 'Contains ' + describe_counts(c, p['stores'].get('text', True)) + '.'
    wh = describe_withheld(W)
    if wh: detail += ' Withheld: ' + wh + '.'
    if blocked: detail += ' Not readable by (isolated): ' + ', '.join(blocked) + '.'
    if private: detail += ' Private views: ' + ', '.join(private) + '.'
    items = [f"source: {d.get('title', '')[:90]}" for d in shared['docs'][:150]] + [f"node: {n.get('label', '')[:60]}" for n in shared['nodes'][:150]] + [f"trail: {t.get('title', '')[:80]}" for t in shared['trails']]
    log('out', 'sent', summary, detail, items, file='research/hub-export.json', bytes=size, sha=sha, counts=c, withheld=W, receivers=receivers)
    return {'written': True, 'bytes': size, 'sha': sha}


# ---------------------------------------------------------------- inbound
INBOX = {}        # name -> entry
_istate = None


def istate():
    global _istate
    if _istate is None:
        try: _istate = json.loads(STATE.read_text(encoding='utf-8'))
        except (FileNotFoundError, json.JSONDecodeError): _istate = {}
    return _istate


def save_istate(): atomic_write(STATE, json.dumps(istate(), indent=1))


def summarize_import(j):
    c = {k: len(j.get(k) or []) for k in ('docs', 'nodes', 'links', 'trails', 'data', 'etym', 'steps')}
    c['steps'] += sum(len(t.get('appendSteps') or []) for t in j.get('trails') or [])
    bys = sorted({o.get('by') for k in ('docs', 'nodes', 'links', 'data', 'steps') for o in j.get(k) or [] if isinstance(o, dict) and o.get('by')} |
                 {s.get('by') for t in j.get('trails') or [] for s in t.get('appendSteps') or [] if s.get('by')})
    items = ([f"source: {d.get('title', '')[:90]}" for d in j.get('docs') or []] + [f"node: {n.get('label', '')}" + (f" ({n['status']})" if n.get('status') else '') for n in j.get('nodes') or []] +
             [f"link: {l.get('label') or 'related'}" + (f" ({l['status']})" if l.get('status') else '') for l in j.get('links') or []] +
             [f"step [{s.get('kind')}]: {str(s.get('text', ''))[:110]}" for s in (j.get('steps') or []) + [s for t in j.get('trails') or [] for s in t.get('appendSteps') or []]] +
             [f"data: {d.get('series')} = {d.get('value')} {d.get('unit', '')}" for d in j.get('data') or []])
    return c, bys, items


def describe_import_counts(c):
    parts = [plural(c[k], lab) for k, lab in (('docs', 'source'), ('nodes', 'map node'), ('links', 'link'), ('steps', 'trail step'), ('data', 'data point'), ('etym', 'etymology entry')) if c.get(k)]
    if c.get('trails') and not c.get('steps'): parts.append(plural(c['trails'], 'trail'))
    return ', '.join(parts) or 'nothing'


def validate(j):
    if not isinstance(j, dict): return 'not a JSON object'
    for k in ('docs', 'nodes', 'links', 'trails', 'data', 'etym', 'steps'):
        if k in j and not (isinstance(j[k], list) and all(isinstance(o, dict) for o in j[k])): return f'"{k}" must be a list of objects'
    if not any(j.get(k) for k in ('docs', 'nodes', 'links', 'trails', 'data', 'etym', 'steps')): return 'contains nothing to import'
    return ''


def move(f, dest, prefix=True):
    dest.mkdir(parents=True, exist_ok=True)
    target = dest / ((time.strftime('%Y%m%d-%H%M%S-') if prefix else '') + f.name)
    shutil.move(str(f), str(target)); return target


def evaluate(e, p):
    if e.get('claim') and time.time() - e['claim']['at'] < CLAIM_TTL: return 'delivering', 'the hub is taking it in'
    e.pop('claim', None)
    if e.get('failed') and not e.get('released'): return 'held', f"the hub could not import it: {e['failed']}"
    if not transport_on(p): return 'waiting', 'transport is stopped'
    if not p.get('inbound'): return 'waiting', 'agents → hub is off'
    if e.get('pinned') : return 'held', 'held by you'
    if e.get('released'): return 'ready', 'released by you'
    if not rule(p, e['agent'])['send']: return 'held', f"{e['agent']} is isolated from sending"
    iso = [b for b in e['by'] if not rule(p, b)['send']]
    if iso and len(iso) == len(e['by']) and e['by']: return 'held', f"written by isolated agent{'s' if len(iso) > 1 else ''} {', '.join(iso)}"
    pat = next((x for x in p.get('hold_files', []) if fnmatch.fnmatch(e['file'], x)), None)
    if pat: return 'held', f'matches your hold rule “{pat}”'
    if p.get('review'): return 'held', 'awaiting your review'
    return 'ready', ''


def scan_inbox():
    p = load_policy(); seen = set()
    with LOCK:
        for f in sorted(RESEARCH.glob('hub-import-*.json')):
            try: st = f.stat()
            except FileNotFoundError: continue
            seen.add(f.name); e = INBOX.get(f.name)
            if not e or e['mtime'] != st.st_mtime_ns or e['size'] != st.st_size:
                e = {'file': f.name, 'mtime': st.st_mtime_ns, 'size': st.st_size, 'agent': agent_of(f.name), 'status': 'settling', 'reason': 'still being written', 'parsed': False, 'by': []}
                saved = istate().get(f.name)
                if saved and saved.get('mtime') == st.st_mtime_ns: e.update({k: saved[k] for k in ('pinned', 'released') if k in saved})
                INBOX[f.name] = e
            if time.time() - st.st_mtime_ns / 1e9 < SETTLE: continue
            if not e['parsed']:
                if st.st_size > MAX_IN: err = f'too large ({human(st.st_size)} > {human(MAX_IN)})'
                else:
                    try: j = json.loads(f.read_text(encoding='utf-8')); err = validate(j)
                    except (json.JSONDecodeError, UnicodeDecodeError) as x: err = f'not valid JSON ({x})'
                if err:
                    t = move(f, REJECTED); INBOX.pop(f.name, None)
                    log('in', 'rejected', f"Rejected {f.name} from {e['agent']}: {err}.", f'Moved to research/bridge/rejected/{t.name}. Nothing entered the hub.', agent=e['agent'], file=f.name)
                    continue
                c, bys, items = summarize_import(j)
                e.update(parsed=True, counts=c, by=bys, items=items, status='new')
                log('in', 'arrived', f"{e['agent']} wrote {f.name} ({human(st.st_size)}): {describe_import_counts(c)}.",
                    (f"Written by: {', '.join(bys)}. " if bys and bys != [e['agent']] else '') + 'Checking it against your rules…', items, agent=e['agent'], file=f.name, bytes=st.st_size, counts=c)
            status, reason = evaluate(e, p)
            if (status, reason) != (e['status'], e['reason']):
                old = e['status']; e['status'], e['reason'] = status, reason
                if status == 'held': log('in', 'held', f"Holding {f.name} from {e['agent']}: {reason}.", 'Deliver, keep holding, or discard it on the Bridge page.', agent=e['agent'], file=f.name)
                elif status == 'waiting': log('in', 'waiting', f"{f.name} is waiting: {reason}.", 'It will be delivered when transport resumes (if your rules allow).', agent=e['agent'], file=f.name)
                elif status == 'ready' and old in ('held', 'waiting'): log('in', 'ready', f"{f.name} is cleared for delivery" + (f' ({reason})' if reason else '') + '.', agent=e['agent'], file=f.name)
        for name in list(INBOX):
            if name not in seen and INBOX[name]['status'] != 'delivering': INBOX.pop(name)


def watcher(stop_evt):
    stop_seen = STOPFILE.exists()
    while not stop_evt.is_set():
        try:
            s = STOPFILE.exists()
            if s != stop_seen:
                stop_seen = s
                log('control', 'stopfile', 'Emergency STOP file found — all transport halted.' if s else 'Emergency STOP file removed — transport follows your rules again.', str(STOPFILE.relative_to(ROOT)))
            scan_inbox()
        except Exception as x:  # keep the bridge alive
            print('watcher error:', x, file=sys.stderr)
        stop_evt.wait(1.0)


def claim(name):
    p = load_policy()
    with LOCK:
        scan_inbox(); e = INBOX.get(name)
        if not e: return 404, {'error': 'no such file waiting'}
        if e['status'] != 'ready': return 409, {'error': f"not ready: {e['status']} — {e['reason']}"}
        j = json.loads((RESEARCH / name).read_text(encoding='utf-8'))
        dropped = {}
        if not e.get('released'):
            iso = {b for b in e['by'] if not rule(p, b)['send']}
            if iso:
                for k in ('docs', 'nodes', 'links', 'data', 'steps'):
                    keep = [o for o in j.get(k) or [] if o.get('by') not in iso]; dropped[k] = len(j.get(k) or []) - len(keep); j[k] = keep
                for t in j.get('trails') or []:
                    if t.get('appendSteps'): t['appendSteps'] = [s for s in t['appendSteps'] if s.get('by') not in iso]
        token = hashlib.sha1(f'{name}{time.time_ns()}'.encode()).hexdigest()[:12]
        e['claim'] = {'token': token, 'at': time.time()}; e['status'], e['reason'] = 'delivering', 'the hub is taking it in'
        return 200, {'token': token, 'content': j, 'agent': e['agent'], 'dropped': {k: v for k, v in dropped.items() if v}}


def ack(body):
    name, token, result = body.get('file'), body.get('token'), body.get('result')
    with LOCK:
        e = INBOX.get(name)
        if not e or (e.get('claim') or {}).get('token') != token: return 409, {'error': 'not claimed by this hub (another tab may have taken it)'}
        f = RESEARCH / name
        if result == 'delivered':
            t = move(f, DELIVERED); INBOX.pop(name, None); istate().pop(name, None); save_istate()
            m = body.get('merged') or {}
            parts = []
            for k, lab in (('docs', 'source'), ('nodes', 'map node'), ('links', 'link'), ('trails', 'trail'), ('steps', 'trail step'), ('data', 'data point'), ('etym', 'etymology entry')):
                v = m.get(k)
                if not v: continue
                new, upd = (v.get('new', 0), v.get('updated', 0)) if isinstance(v, dict) else (v, 0)
                parts.append(plural(new + upd, lab) + (f' ({new} new, {upd} merged with existing)' if upd else ''))
            note = body.get('note') or ''
            log('in', 'delivered', f"Delivered {name} from {e['agent']} into the hub: {', '.join(parts) or 'nothing new'}.",
                (note + ' ' if note else '') + f'Moved to research/bridge/delivered/{t.name}.', e.get('items', []), agent=e['agent'], file=name, merged=m)
            return 200, {'ok': True}
        e.pop('claim', None); e['failed'] = str(body.get('error') or 'unknown error')[:300]; e['status'] = 'held'; e['reason'] = f"the hub could not import it: {e['failed']}"
        log('in', 'failed', f"The hub could not import {name} from {e['agent']}: {e['failed']}.", 'The file stays in research/ and is held.', agent=e['agent'], file=name)
        return 200, {'ok': True}


def file_action(action, name):
    with LOCK:
        e = INBOX.get(name); f = RESEARCH / name
        if not e or not f.exists(): return 404, {'error': 'no such file waiting'}
        if action == 'discard':
            t = move(f, DISCARDED); INBOX.pop(name, None); istate().pop(name, None); save_istate()
            log('in', 'discarded', f"Discarded {name} from {e['agent']} — nothing from it entered the hub.", f'Moved to research/bridge/discarded/{t.name} (recoverable).', agent=e['agent'], file=name)
            return 200, {'ok': True}
        if action == 'release':
            e['released'] = True; e.pop('pinned', None); e.pop('failed', None)
            istate()[name] = {'mtime': e['mtime'], 'released': True}; save_istate()
            log('in', 'released', f"You released {name} from {e['agent']} for delivery.", 'It bypasses agent isolation, hold rules and review for this version of the file only.', agent=e['agent'], file=name)
        elif action == 'hold':
            e['pinned'] = True; e.pop('released', None)
            istate()[name] = {'mtime': e['mtime'], 'pinned': True}; save_istate()
            log('in', 'pinned', f"You are holding {name} from {e['agent']}.", 'It will not be delivered until you release it.', agent=e['agent'], file=name)
        e['status'] = 'recheck'
        return 200, {'ok': True}


# ---------------------------------------------------------------- control actions (shared by CLI and server)
def change_policy(mutator, by):
    with LOCK:
        old = load_policy(); new = json.loads(json.dumps(old)); mutator(new)
        changes = describe_policy_change(old, new)
        if not changes: return old, []
        p = save_policy(new, by)
    log('control', 'policy', f"Rules changed from the {by}: " + changes[0] + (f' (+{len(changes) - 1} more)' if len(changes) > 1 else ''), ' '.join(changes[1:]), changes if len(changes) > 1 else [], by=by)
    return p, changes


def set_agents(p, names, send=None, receive=None):
    targets = [a['name'] for a in list_agents(p)] if names == ['all'] else names
    for n in targets:
        r = p.setdefault('agents', {}).setdefault(n, {})
        if send is not None: r['send'] = send
        if receive is not None: r['receive'] = receive


# ---------------------------------------------------------------- HTTP server
class Handler(http.server.SimpleHTTPRequestHandler):
    server_version = 'ResearchHubBridge/1'

    def __init__(self, *a, **k): super().__init__(*a, directory=str(TOOLS), **k)

    def log_message(self, fmt, *args):
        if TERM['verbosity'] >= 4: super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        if self.path.startswith('/bridge/'): self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _ok_origin(self):
        port = self.server.server_address[1]
        host = self.headers.get('Host', '')
        if host not in (f'localhost:{port}', f'127.0.0.1:{port}', f'[::1]:{port}'): return False
        if self.headers.get('X-Hub-Bridge') != '1': return False
        o = self.headers.get('Origin')
        return o is None or o in (f'http://localhost:{port}', f'http://127.0.0.1:{port}', f'http://[::1]:{port}')

    def _json(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)

    def _body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n > MAX_POST: raise ValueError('request too large')
        return json.loads(self.rfile.read(n) or b'{}')

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if not u.path.startswith('/bridge/'): return super().do_GET()
        if not self._ok_origin(): return self._json(403, {'error': 'forbidden'})
        q = urllib.parse.parse_qs(u.query)
        if u.path == '/bridge/status': return self._json(200, status())
        if u.path == '/bridge/log': return self._json(200, {'entries': read_log(q.get('after', ['0'])[0], int(q.get('limit', ['300'])[0]))})
        if u.path == '/bridge/peek':
            name = q.get('file', [''])[0]
            if not re.fullmatch(r'hub-import-[^/\\]+\.json', name) or not (RESEARCH / name).exists(): return self._json(404, {'error': 'no such file'})
            return self._json(200, {'content': json.loads((RESEARCH / name).read_text(encoding='utf-8'))})
        return self._json(404, {'error': 'unknown endpoint'})

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if not u.path.startswith('/bridge/') or not self._ok_origin(): return self._json(403, {'error': 'forbidden'})
        try: body = self._body()
        except (ValueError, json.JSONDecodeError) as x: return self._json(400, {'error': str(x)})
        if u.path == '/bridge/export': return self._json(200, handle_export(body))
        if u.path == '/bridge/claim': return self._json(*claim(body.get('file', '')))
        if u.path == '/bridge/ack': return self._json(*ack(body))
        if u.path == '/bridge/policy':
            patch = body.get('patch') or {}
            p, ch = change_policy(lambda p: deep_merge(p, patch), 'hub')
            return self._json(200, {'policy': p, 'changes': ch})
        if u.path == '/bridge/action':
            a = body.get('action')
            if a in ('discard', 'release', 'hold'): return self._json(*file_action(a, body.get('file', '')))
            if a == 'stop':
                p, ch = change_policy(lambda p: p.update(transport=False), 'hub')
                if body.get('withdraw'): withdraw('you stopped the bridge and withdrew the data')
                return self._json(200, {'policy': p})
            if a == 'start':
                p, ch = change_policy(lambda p: p.update(transport=True), 'hub')
                if STOPFILE.exists(): return self._json(200, {'policy': p, 'warning': 'The emergency STOP file still exists: delete research/bridge/STOP to resume.'})
                return self._json(200, {'policy': p})
            if a == 'withdraw': withdraw('you asked'); return self._json(200, {'ok': True})
            if a == 'isolate':
                p, ch = change_policy(lambda p: set_agents(p, body.get('agents') or [], body.get('send'), body.get('receive')), 'hub')
                return self._json(200, {'policy': p, 'changes': ch})
            if a == 'shutdown':
                log('control', 'shutdown', 'Bridge shut down from the hub.', 'Restart it with: python3 scripts/hub_bridge.py serve')
                self._json(200, {'ok': True}); threading.Thread(target=self.server.shutdown, daemon=True).start(); return
        return self._json(404, {'error': 'unknown endpoint'})


def status():
    p = load_policy(); scan_inbox()
    pend = {}
    for e in INBOX.values(): pend[e['agent']] = pend.get(e['agent'], 0) + 1
    last = {}
    for e in read_log(limit=1000):
        if e.get('agent'): last[e['agent']] = e['t']
    agents = list_agents(p)
    for a in agents: a.update(pending=pend.get(a['name'], 0), last=last.get(a['name']))
    shared = SHARED.stat() if SHARED.exists() else None
    return {'bridge': 'research-hub', 'version': 1, 'transport': transport_on(p), 'stopfile': STOPFILE.exists(), 'policy': p, 'agents': agents,
            'inbox': [{k: e.get(k) for k in ('file', 'agent', 'status', 'reason', 'size', 'counts', 'by', 'items', 'released', 'pinned')} for e in sorted(INBOX.values(), key=lambda e: e['file'])],
            'export': {'path': 'research/hub-export.json', 'bytes': shared.st_size, 'mtime': shared.st_mtime} if shared else None,
            'paths': {'root': str(ROOT), 'research': str(RESEARCH)}}


def serve(a):
    TERM['verbosity'] = a.verbosity; TERM['quiet'] = a.quiet
    for d in (BR, OUT, DELIVERED): d.mkdir(parents=True, exist_ok=True)
    if not POLICY.exists(): save_policy(default_policy(), 'default')
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', a.port), Handler)
    stop_evt = threading.Event(); threading.Thread(target=watcher, args=(stop_evt,), daemon=True).start()
    p = load_policy(); url = f'http://localhost:{a.port}/research/'
    print(f'🌉 Research Hub bridge on {url}  (serving {TOOLS.relative_to(ROOT)}/, sharing {RESEARCH.relative_to(ROOT)}/)')
    print(f"   transport {'ON' if transport_on(p) else 'STOPPED'} · Ctrl-C to quit · log: {LOG.relative_to(ROOT)}")
    log('control', 'started', f'Bridge started on {url}.', f"Transport is {'on' if transport_on(p) else 'stopped'}; rules from {POLICY.relative_to(ROOT)} (rev {p['rev']}).")
    if a.open: threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try: srv.serve_forever()
    except KeyboardInterrupt: log('control', 'shutdown', 'Bridge stopped from the terminal.', '')
    finally: stop_evt.set(); srv.server_close()


# ---------------------------------------------------------------- CLI
def cli_status(a):
    s = status(); p = s['policy']
    print(f"Transport: {'ON' if s['transport'] else 'STOPPED'}{' (emergency STOP file present)' if s['stopfile'] else ''} · hub→agents {'on' if p['outbound'] else 'off'} · agents→hub {'on' if p['inbound'] else 'off'} · review {'on' if p['review'] else 'off'}")
    off = [STORE_LABEL[k] for k, v in p['stores'].items() if not v]
    print('Not sending:', ', '.join(off) if off else 'nothing withheld by type')
    x = p['exclude']; print(f"Kept off the bridge: {len(x['docs'])} sources, tags {x['tags'] or '-'}, collections {x['collections'] or '-'}, kinds {x['kinds'] or '-'}")
    print(f"Export for agents: {human(s['export']['bytes']) + ' at ' + time.strftime('%H:%M:%S', time.localtime(s['export']['mtime'])) if s['export'] else 'none (nothing shared right now)'}")
    print('\nAgents:')
    for ag in s['agents']:
        flags = []
        if not ag['send']: flags.append('cannot send')
        if not ag['receive']: flags.append('cannot read hub')
        if ag['hide_docs']: flags.append(f"{len(ag['hide_docs'])} sources hidden")
        print(f"  {ag['name']:24} {ag['team']:9} {'; '.join(flags) or 'connected'}{'  · ' + str(ag['pending']) + ' file(s) waiting' if ag['pending'] else ''}")
    if s['inbox']:
        print('\nAgent files:')
        for e in s['inbox']: print(f"  {e['file']:40} {e['status']:10} {e['reason']}")
    print('\nRecent transport:')
    for e in read_log(limit=8): print_entry(e, 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest='cmd', required=True)
    s = sp.add_parser('serve'); s.add_argument('--port', type=int, default=8000); s.add_argument('--verbosity', '-V', type=int, default=2, choices=[1, 2, 3, 4]); s.add_argument('--quiet', action='store_true'); s.add_argument('--open', action='store_true')
    sp.add_parser('status'); sp.add_parser('start'); sp.add_parser('policy')
    st = sp.add_parser('stop'); st.add_argument('--withdraw', action='store_true')
    i = sp.add_parser('isolate'); i.add_argument('agents', nargs='+'); i.add_argument('--only', choices=['send', 'receive'])
    r = sp.add_parser('release'); r.add_argument('agents', nargs='+')
    for n in ('hold', 'unhold'): sp.add_parser(n).add_argument('pattern')
    for n in ('exclude', 'include'):
        e = sp.add_parser(n)
        for k in ('doc', 'tag', 'collection', 'kind'): e.add_argument('--' + k, action='append', default=[])
    lg = sp.add_parser('log'); lg.add_argument('-n', type=int, default=30); lg.add_argument('--follow', '-f', action='store_true'); lg.add_argument('--verbosity', '-V', type=int, default=2)
    a = ap.parse_args()
    if a.cmd == 'serve': return serve(a)
    if a.cmd == 'status': return cli_status(a)
    if a.cmd == 'policy': return print(json.dumps(load_policy(), indent=1, ensure_ascii=False))
    if a.cmd == 'log':
        last = '0'
        for e in read_log(limit=a.n): print_entry(e, a.verbosity); last = e['id']
        while a.follow:
            time.sleep(1)
            for e in read_log(last): print_entry(e, a.verbosity); last = e['id']
        return
    if a.cmd == 'stop':
        change_policy(lambda p: p.update(transport=False), 'terminal')
        if a.withdraw: withdraw('you stopped the bridge from the terminal and withdrew the data')
    elif a.cmd == 'start':
        change_policy(lambda p: p.update(transport=True), 'terminal')
        if STOPFILE.exists(): print('Note: the emergency STOP file still exists — delete research/bridge/STOP to resume.')
    elif a.cmd == 'isolate':
        change_policy(lambda p: set_agents(p, a.agents, None if a.only == 'receive' else False, None if a.only == 'send' else False), 'terminal')
    elif a.cmd == 'release':
        change_policy(lambda p: set_agents(p, a.agents, True, True), 'terminal')
    elif a.cmd in ('hold', 'unhold'):
        def m(p):
            s = set(p.get('hold_files', [])); (s.add if a.cmd == 'hold' else s.discard)(a.pattern); p['hold_files'] = sorted(s)
        change_policy(m, 'terminal')
    elif a.cmd in ('exclude', 'include'):
        def m(p):
            for key, vals in (('docs', a.doc), ('tags', a.tag), ('collections', a.collection), ('kinds', a.kind)):
                s = set(p['exclude'].get(key, []))
                for v in vals: (s.add if a.cmd == 'exclude' else s.discard)(v)
                p['exclude'][key] = sorted(s)
        change_policy(m, 'terminal')
    TERM['quiet'] = True
    cli_status(a)


if __name__ == '__main__':
    main()
