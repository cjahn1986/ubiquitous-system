#!/usr/bin/env python3
"""Research Hub bridge — keeps your browser hub and the agents in sync, automatically.

Run it instead of `python3 -m http.server`:

    python3 scripts/hub_bridge.py            # then open http://localhost:8000/research/

It serves the tools at the same address as before (so your browser data is still there) and shares
the repo's research/ folder with the hub:

    hub → agents   as you work, the hub's data is written to research/hub-export.json
    agents → hub   files the agents write (research/hub-import-<agent>.json) are taken into the hub
                   on their own, then moved to research/bridge/delivered/

Each transfer prints one line here. Files that are not valid hub imports go to research/bridge/rejected/.
It listens on 127.0.0.1 only and answers only the hub's own requests, so other web pages can't use it.

Options: --port 8000  --open (open the browser)  --quiet
"""
import argparse, hashlib, http.server, json, os, re, shutil, sys, threading, time, urllib.parse, webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / 'tools'
RESEARCH = ROOT / 'research'
SHARED = RESEARCH / 'hub-export.json'
DELIVERED, REJECTED = RESEARCH / 'bridge' / 'delivered', RESEARCH / 'bridge' / 'rejected'
SETTLE = 2.0                      # a file must be unchanged this long before it counts as finished
CLAIM_TTL = 90                    # seconds a hub has to take in a file it claimed
MAX_IN, MAX_POST = 25 * 1024 * 1024, 600 * 1024 * 1024
LOCK = threading.Lock()
QUIET = [False]
_state = {'sha': None, 'claims': {}, 'failed': {}, 'valid': {}}


def say(direction, text):
    if QUIET[0]: return
    tty = sys.stdout.isatty(); c = {'hub → agents': '\033[36m', 'agents → hub': '\033[33m'}.get(direction, '\033[35m') if tty else ''
    print(f"{c}[{time.strftime('%H:%M:%S')}] {direction:13}{chr(27) + '[0m' if tty else ''} {text}", flush=True)


def human(n): return f'{n / 1e6:.1f} MB' if n >= 1e6 else f'{n / 1e3:.1f} KB' if n >= 1e3 else f'{n} B'
def plural(n, w, p=None): return f"{n} {w if n == 1 else (p or w + 's')}"
def agent_of(name): return (re.match(r'hub-import-(.+?)\.json$', name) or [None, 'unknown'])[1]


def atomic_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name('.' + path.name + '.tmp'); tmp.write_text(text, encoding='utf-8'); os.replace(tmp, path)


def move(f, dest):
    dest.mkdir(parents=True, exist_ok=True); t = dest / (time.strftime('%Y%m%d-%H%M%S-') + f.name)
    shutil.move(str(f), str(t)); return t


# ---------------------------------------------------------------- hub → agents
def write_export(body):
    ex = body.get('export') or {}
    text = json.dumps(ex, ensure_ascii=False, separators=(',', ':'))
    sha = hashlib.sha256(text.encode()).hexdigest()
    with LOCK:
        if sha == _state['sha'] and SHARED.exists(): return {'written': False}
        atomic_write(SHARED, text); _state['sha'] = sha
    steps = sum(len(t.get('steps', [])) for t in ex.get('trails', []))
    what = ', '.join([plural(len(ex.get('docs', [])), 'source'), plural(len(ex.get('nodes', [])), 'node'), plural(len(ex.get('links', [])), 'link'),
                      f"{plural(len(ex.get('trails', [])), 'trail')} ({plural(steps, 'step')})", plural(len(ex.get('data', [])), 'data point')])
    say('hub → agents', f"wrote research/hub-export.json ({human(len(text.encode()))}): {what}" + (f" — after {body['why']}" if body.get('why') else ''))
    return {'written': True}


# ---------------------------------------------------------------- agents → hub
def validate(j):
    if not isinstance(j, dict): return 'not a JSON object'
    for k in ('docs', 'nodes', 'links', 'trails', 'data', 'etym', 'steps'):
        if k in j and not (isinstance(j[k], list) and all(isinstance(o, dict) for o in j[k])): return f'"{k}" must be a list of objects'
    if not any(j.get(k) for k in ('docs', 'nodes', 'links', 'trails', 'data', 'etym', 'steps')): return 'contains nothing to import'
    return ''


def ready_files():
    """agent files that are finished, valid, and not already being taken in"""
    out = []
    with LOCK:
        for f in sorted(RESEARCH.glob('hub-import-*.json')):
            try: st = f.stat()
            except FileNotFoundError: continue
            if time.time() - st.st_mtime < SETTLE: continue
            c = _state['claims'].get(f.name)
            if c and time.time() - c['at'] < CLAIM_TTL: continue
            if _state['failed'].get(f.name) == st.st_mtime_ns: continue       # failed import; retried when the agent rewrites it
            key = (f.name, st.st_mtime_ns)
            if key not in _state['valid']:
                if st.st_size > MAX_IN: err = f'too large ({human(st.st_size)})'
                else:
                    try: err = validate(json.loads(f.read_text(encoding='utf-8')))
                    except (json.JSONDecodeError, UnicodeDecodeError) as x: err = f'not valid JSON ({x})'
                if err:
                    t = move(f, REJECTED); say('agents → hub', f'rejected {f.name} from {agent_of(f.name)}: {err} → research/bridge/rejected/{t.name}'); continue
                _state['valid'][key] = True
            out.append({'file': f.name, 'agent': agent_of(f.name), 'size': st.st_size})
    return out


def claim(name):
    with LOCK:
        f = RESEARCH / name
        if not re.fullmatch(r'hub-import-[^/\\]+\.json', name) or not f.exists(): return 404, {'error': 'no such file'}
        c = _state['claims'].get(name)
        if c and time.time() - c['at'] < CLAIM_TTL: return 409, {'error': 'another hub tab is taking it in'}
        token = hashlib.sha1(f'{name}{time.time_ns()}'.encode()).hexdigest()[:12]
        _state['claims'][name] = {'token': token, 'at': time.time(), 'mtime': f.stat().st_mtime_ns}
        return 200, {'token': token, 'agent': agent_of(name), 'content': json.loads(f.read_text(encoding='utf-8'))}


def ack(body):
    name = body.get('file', '')
    with LOCK:
        c = _state['claims'].get(name)
        if not c or c['token'] != body.get('token'): return 409, {'error': 'not claimed by this tab'}
        _state['claims'].pop(name, None); f = RESEARCH / name
        if body.get('result') != 'delivered':
            _state['failed'][name] = c['mtime']
            say('agents → hub', f"the hub could not take in {name}: {body.get('error')} — left in research/ (retried if the agent rewrites it)"); return 200, {'ok': True}
        if not f.exists(): return 200, {'ok': True}
        if f.stat().st_mtime_ns != c['mtime']:
            say('agents → hub', f'{name} changed while being taken in — delivering the new version next'); return 200, {'ok': True}
        t = move(f, DELIVERED)
    parts = []
    for k, w in (('docs', 'source'), ('nodes', 'node'), ('links', 'link'), ('trails', 'trail'), ('steps', 'trail step'), ('data', 'data point'), ('etym', 'etymology entry')):
        v = (body.get('merged') or {}).get(k)
        if v: n, u = v.get('new', 0), v.get('updated', 0); parts.append(plural(n + u, w, 'etymology entries' if k == 'etym' else None) + (f' ({u} merged with existing)' if u else ''))
    say('agents → hub', f"took in {name} from {agent_of(name)}: {', '.join(parts) or 'nothing new'} → research/bridge/delivered/{t.name}")
    return 200, {'ok': True}


# ---------------------------------------------------------------- server
class Handler(http.server.SimpleHTTPRequestHandler):
    server_version = 'ResearchHubBridge/1'
    def __init__(self, *a, **k): super().__init__(*a, directory=str(TOOLS), **k)
    def log_message(self, *a): pass

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        if self.path.startswith('/bridge/'): self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _ours(self):
        port = self.server.server_address[1]; ok = (f'localhost:{port}', f'127.0.0.1:{port}', f'[::1]:{port}')
        o = self.headers.get('Origin')
        return self.headers.get('Host') in ok and self.headers.get('X-Hub-Bridge') == '1' and (o is None or o in tuple('http://' + x for x in ok))

    def _json(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if not path.startswith('/bridge/'): return super().do_GET()
        if not self._ours(): return self._json(403, {'error': 'forbidden'})
        if path == '/bridge/status':
            st = SHARED.stat() if SHARED.exists() else None
            return self._json(200, {'bridge': 'research-hub', 'version': 1, 'incoming': ready_files(), 'export': {'bytes': st.st_size, 'mtime': st.st_mtime} if st else None})
        return self._json(404, {'error': 'unknown endpoint'})

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if not path.startswith('/bridge/') or not self._ours(): return self._json(403, {'error': 'forbidden'})
        n = int(self.headers.get('Content-Length') or 0)
        if n > MAX_POST: return self._json(413, {'error': 'too large'})
        try: body = json.loads(self.rfile.read(n) or b'{}')
        except json.JSONDecodeError as x: return self._json(400, {'error': str(x)})
        if path == '/bridge/export': return self._json(200, write_export(body))
        if path == '/bridge/claim': return self._json(*claim(body.get('file', '')))
        if path == '/bridge/ack': return self._json(*ack(body))
        return self._json(404, {'error': 'unknown endpoint'})


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--port', type=int, default=8000); ap.add_argument('--open', action='store_true'); ap.add_argument('--quiet', action='store_true')
    a = ap.parse_args(); QUIET[0] = a.quiet
    RESEARCH.mkdir(exist_ok=True)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', a.port), Handler)
    url = f'http://localhost:{a.port}/research/'
    print(f'🌉 Research Hub bridge: open {url}\n   hub data → {SHARED.relative_to(ROOT)} · agent files ← research/hub-import-*.json · Ctrl-C to stop', flush=True)
    if a.open: threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try: srv.serve_forever()
    except KeyboardInterrupt: print('\nbridge stopped')
    finally: srv.server_close()


if __name__ == '__main__':
    main()
