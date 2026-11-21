#!/usr/bin/env python3
"""Offline etymology for the agents (and the slot for the Offline Etymology Engine).

Builds a local SQLite database from either
  * the open, Wiktionary-derived etymology-db CSV (https://github.com/droher/etymology-db), or
  * the Offline Etymology Engine's JSON (a list of {word, lang, etymology?, relations:[{type, lang, word}]}),
then answers lineage / relative questions with no network at all.

  etym.py build SOURCE.csv|SOURCE.json [--db research/etym.sqlite] [--langs en,grc,la,hbo]
  etym.py subset ETYMOLOGY.csv OUT.csv --langs en,grc,la      (shrink before importing into the browser hub)
  etym.py lineage WORD [--lang en] [--db ...]                 ancestors, step by step
  etym.py relatives WORD [--lang en] [--db ...]               cognates, roots, descendants, parts
  etym.py online WORD [--lang en]                             Wiktionary lookup (needs en.wiktionary.org)
"""
import argparse, csv, json, os, re, sqlite3, sys, urllib.parse, urllib.request

DB = os.path.join(os.path.dirname(__file__), '..', 'research', 'etym.sqlite')
ANC = ('inherited_from', 'derived_from', 'borrowed_from', 'learned_borrowing_from', 'semi_learned_borrowing_from', 'calque_of', 'back_formation_from', 'clipping_of', 'blend_of', 'orthographic_borrowing_from', 'unadapted_borrowing_from', 'semantic_loan_of', 'transliteration_of')
csv.field_size_limit(10 ** 8)
NAMES = {'English': 'en', 'Ancient Greek': 'grc', 'Latin': 'la', 'Hebrew': 'he', 'Biblical Hebrew': 'hbo', 'Aramaic': 'arc', 'Sanskrit': 'sa', 'Arabic': 'ar', 'Old English': 'ang', 'Middle English': 'enm', 'Old French': 'fro', 'Proto-Indo-European': 'ine-pro', 'Proto-Germanic': 'gem-pro', 'Proto-Semitic': 'sem-pro', 'Egyptian': 'egy', 'Akkadian': 'akk'}
code = lambda l: NAMES.get(l, l)


def connect(path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    c = sqlite3.connect(path)
    c.execute('CREATE TABLE IF NOT EXISTS rel (lang TEXT, term TEXT, reltype TEXT, rlang TEXT, rterm TEXT, src TEXT)')
    c.execute('CREATE INDEX IF NOT EXISTS i1 ON rel(lang, term)'); c.execute('CREATE INDEX IF NOT EXISTS i2 ON rel(rlang, rterm)')
    c.execute('CREATE TABLE IF NOT EXISTS note (lang TEXT, term TEXT, text TEXT, PRIMARY KEY(lang, term))')
    return c


def cmd_build(a):
    c = connect(a.db); want = {code(x.strip()) for x in a.langs.split(',')} if a.langs else None; n = 0
    if a.source.endswith('.json'):
        data = json.load(open(a.source, encoding='utf-8')); data = data if isinstance(data, list) else data.get('entries', data.get('words', []))
        for r in data:
            w = r.get('word') or r.get('term'); l = code(r.get('lang') or r.get('language') or 'en')
            if not w or (want and l not in want): continue
            if r.get('etymology') or r.get('text'): c.execute('INSERT OR REPLACE INTO note VALUES (?,?,?)', (l, w, r.get('etymology') or r.get('text')))
            for x in r.get('relations') or r.get('rels') or r.get('ancestors') or []:
                if isinstance(x, str): x = {'type': 'derived_from', 'word': x}
                c.execute('INSERT INTO rel VALUES (?,?,?,?,?,?)', (l, w, (x.get('type') or 'derived_from').replace(' ', '_'), code(x.get('lang') or x.get('language') or ''), x.get('word') or x.get('term') or '', 'engine')); n += 1
    else:
        with open(a.source, encoding='utf-8', newline='') as f:
            for r in csv.DictReader(f):
                if want and code(r['lang']) not in want: continue
                c.execute('INSERT INTO rel VALUES (?,?,?,?,?,?)', (code(r['lang']), r['term'], r['reltype'], code(r['related_lang']), r['related_term'], 'etymology-db')); n += 1
                if n % 200000 == 0: c.commit(); print(f'  {n:,} relations…', file=sys.stderr)
    c.commit(); print(f'{n:,} relations → {a.db}')


def cmd_subset(a):
    want = {x.strip() for x in a.langs.split(',')}; n = 0
    with open(a.source, encoding='utf-8', newline='') as f, open(a.out, 'w', encoding='utf-8', newline='') as o:
        rd = csv.DictReader(f); wr = csv.DictWriter(o, fieldnames=rd.fieldnames); wr.writeheader()
        for r in rd:
            if r['lang'] in want or code(r['lang']) in want: wr.writerow(r); n += 1
    print(f'{n:,} rows → {a.out}')


def cmd_lineage(a):
    c = connect(a.db); lang, term, seen, step = code(a.lang), a.word, set(), 0
    note = c.execute('SELECT text FROM note WHERE lang=? AND term=?', (lang, term)).fetchone()
    if note: print(f'Engine note: {note[0]}\n')
    print(f'{lang} {term}')
    while (lang, term) not in seen and step < 15:
        seen.add((lang, term)); step += 1
        rows = c.execute(f"SELECT reltype, rlang, rterm FROM rel WHERE lang=? AND term=? AND reltype IN ({','.join('?' * len(ANC))}) AND rterm != ''", (lang, term, *ANC)).fetchall()
        if not rows: break
        rt, lang, term = rows[0]; print(f'  ↑ {rt.replace("_", " ")}  {lang} {term}' + (f'   (also: {", ".join(f"{r[1]} {r[2]}" for r in rows[1:4])})' if len(rows) > 1 else ''))
    if step == 1 and not c.execute('SELECT 1 FROM rel WHERE lang=? AND term=?', (code(a.lang), a.word)).fetchone():
        print('  (not in the local database — build it first, or try: etym.py online WORD)')


def cmd_relatives(a):
    c = connect(a.db); lang = code(a.lang)
    for rt, rl, t in c.execute('SELECT reltype, rlang, rterm FROM rel WHERE lang=? AND term=? ORDER BY reltype', (lang, a.word)): print(f'{rt.replace("_", " "):28} {rl} {t}')
    print('\nDescendants / words built on it:')
    for l, t, rt in c.execute('SELECT lang, term, reltype FROM rel WHERE rlang=? AND rterm=? LIMIT 60', (lang, a.word)): print(f'  {l} {t}  ({rt.replace("_", " ")})')


def cmd_online(a):
    names = {v: k for k, v in NAMES.items()}; lname = names.get(a.lang, a.lang)
    url = 'https://en.wiktionary.org/w/api.php?' + urllib.parse.urlencode({'action': 'parse', 'page': a.word, 'prop': 'wikitext', 'format': 'json', 'redirects': 1})
    req = urllib.request.Request(url, headers={'User-Agent': 'research-hub-etym/0.1 (personal research tool)'})
    wt = json.load(urllib.request.urlopen(req, timeout=30))['parse']['wikitext']['*']
    m = re.search(rf'^=={re.escape(lname)}==\s*$(.*?)(?=^==[^=]|\Z)', wt, re.M | re.S)
    if not m: sys.exit(f'no {lname} section')
    for em in re.finditer(r'^===+\s*Etymology[^=]*===+\s*$(.*?)(?=^===|\Z)', m.group(1), re.M | re.S):
        body = em.group(1).strip()
        print(re.sub(r'\{\{(?:inh|der|bor|lbor)\|[^|}]*\|([^|}]*)\|([^|}]*)[^}]*\}\}', lambda x: f'{names.get(x.group(1), x.group(1))} {x.group(2)}', body)[:1500]); print()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest='cmd', required=True)
    b = sp.add_parser('build'); b.add_argument('source'); b.add_argument('--db', default=DB); b.add_argument('--langs'); b.set_defaults(f=cmd_build)
    s = sp.add_parser('subset'); s.add_argument('source'); s.add_argument('out'); s.add_argument('--langs', required=True); s.set_defaults(f=cmd_subset)
    for name, fn in (('lineage', cmd_lineage), ('relatives', cmd_relatives)):
        p = sp.add_parser(name); p.add_argument('word'); p.add_argument('--lang', default='en'); p.add_argument('--db', default=DB); p.set_defaults(f=fn)
    o = sp.add_parser('online'); o.add_argument('word'); o.add_argument('--lang', default='en'); o.set_defaults(f=cmd_online)
    a = ap.parse_args(); a.f(a)


if __name__ == '__main__':
    main()
