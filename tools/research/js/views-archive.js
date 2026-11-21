/* Research Hub — views: archive, document reader, search, web cross-reference. */
'use strict';
(function (RH) {
const { $, $$, h, esc, S, toast } = RH;
const V = RH.views;
const KIND_ICON = { pdf: '📕', text: '📄', note: '📝', web: '🌐', paper: '🎓', book: '📚', classic: '🏺', image: '🖼️', data: '📊' };
const fmtSize = n => n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n > 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B';
const docLen = d => RH.docText(d).length;

/* ---------- file ingestion ---------- */
async function pdfText(file) {
  const lib = window.pdfjsLib; if (!lib) throw new Error('PDF reader not loaded');
  lib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise; const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent(); let s = '';
    for (const it of tc.items) s += it.str + (it.hasEOL ? '\n' : ' ');
    pages.push(s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim());
  }
  let meta = {}; try { meta = (await pdf.getMetadata()).info || {}; } catch (e) { }
  return { pages, meta };
}
RH.ingestFile = async function (file) {
  const name = file.name.replace(/\.[^.]+$/, ''); const ext = (file.name.split('.').pop() || '').toLowerCase();
  let draft = { title: name, kind: 'text', tags: [], source: 'file: ' + file.name };
  if (ext === 'pdf' || file.type === 'application/pdf') {
    const { pages, meta } = await pdfText(file);
    draft = { ...draft, kind: 'pdf', pages, title: meta.Title?.trim() || name, author: meta.Author || '' };
    if (!pages.join('').trim()) draft.notes = 'No text layer found — this PDF is probably a scan. The original is stored; OCR it elsewhere and add the text as a note, or ask the archivist agent.';
  } else if (/^image\//.test(file.type)) draft = { ...draft, kind: 'image', text: '' };
  else {
    const text = await file.text();
    if (ext === 'xml' && /<TEI[\s>]/.test(text)) { const t = RH.parseTEI(text); draft = { ...draft, kind: 'classic', title: [t.author, t.title].filter(Boolean).join(', ') || name, segments: t.segments, lang: t.lang }; }
    else if (ext === 'html' || ext === 'htm') { const d = new DOMParser().parseFromString(text, 'text/html'); d.querySelectorAll('script,style').forEach(e => e.remove()); draft = { ...draft, kind: 'web', title: d.title || name, text: d.body?.textContent?.replace(/\n{3,}/g, '\n\n') || '' }; }
    else if (ext === 'json' && /"version"/.test(text.slice(0, 200)) && /"docs"/.test(text)) { await RH.importHub(JSON.parse(text)); return null; }
    else draft.text = text;
  }
  const doc = await RH.saveDocDraft(draft);
  if (['pdf', 'image'].includes(draft.kind)) await RH.saveFile(doc.id, file);
  return doc;
};
async function ingestFiles(files) {
  let n = 0;
  for (const f of files) { try { toast(`Reading ${f.name}…`, 1500); if (await RH.ingestFile(f)) n++; } catch (e) { console.error(e); toast(`Could not read ${f.name}: ${e.message}`, 5000); } }
  if (n) { toast(`Added ${n} item${n > 1 ? 's' : ''} to the archive`); RH.rerender(); }
}

/* ---------- metadata editor ---------- */
RH.editDoc = async function (d) {
  const f = {}; const inp = (k, ph = '') => (f[k] = h('input', { type: 'text', value: Array.isArray(d[k]) ? d[k].join(', ') : d[k] || '', placeholder: ph }));
  const notes = f.notes = h('textarea', { rows: 3 }); notes.value = d.notes || '';
  const kind = f.kind = RH.select(Object.keys(KIND_ICON).map(k => [k, KIND_ICON[k] + ' ' + k]), d.kind);
  const era = f.era = RH.select([['', '—'], ...RH.ERAS], d.era || '');
  const ok = await RH.modal('Edit source details', h('div', { class: 'form' }, RH.field('Title', inp('title')), h('div', { class: 'row2' }, RH.field('Author', inp('author')), RH.field('Date', inp('date', 'year, or -400 for 400 BCE'))),
    h('div', { class: 'row2' }, RH.field('Kind', kind), RH.field('Era it concerns', era)), h('div', { class: 'row2' }, RH.field('Discipline(s)', inp('discipline', 'e.g. history, linguistics')), RH.field('Collection', inp('collection', 'a shelf / project'))),
    RH.field('Tags', inp('tags', 'comma-separated')), RH.field('Source / URL', inp('source')), RH.field('Notes', notes)), [['Cancel', () => null], ['Save', () => true, 'primary']]);
  if (!ok) return;
  for (const k of ['title', 'author', 'date', 'discipline', 'collection', 'source', 'notes', 'kind', 'era']) d[k] = f[k].value.trim();
  d.tags = f.tags.value.split(',').map(s => s.trim()).filter(Boolean);
  await RH.save('docs', d); RH.rerender();
};

/* ---------- ARCHIVE ---------- */
V.archive = async function (main, r) {
  const docs = [...S.docs.values()];
  const q = r.params.f || ''; const kindF = r.params.k || ''; const tagF = r.params.t || ''; const colF = r.params.c || ''; const eraF = r.params.e || '';
  const tags = [...new Set(docs.flatMap(d => d.tags || []))].sort(); const cols = [...new Set(docs.map(d => d.collection).filter(Boolean))].sort();
  const fileIn = h('input', { type: 'file', multiple: true, accept: '.pdf,.txt,.md,.html,.htm,.xml,.csv,.json,image/*', style: 'display:none', onchange: e => ingestFiles([...e.target.files]) });
  const setP = (k, v) => RH.go('archive', { ...r.params, [k]: v });
  main.append(h('div', { class: 'vh' }, h('h1', {}, '🗄️ Archive'), h('p', { class: 'sub' }, `${docs.length} source${docs.length === 1 ? '' : 's'} · everything stays in this browser · drop files anywhere on this page`)),
    h('div', { class: 'toolbar' }, fileIn,
      h('button', { class: 'primary', onclick: () => fileIn.click() }, '＋ Add files'),
      h('button', { onclick: addNote }, '📝 Paste text / note'),
      h('button', { onclick: importFromWeb }, '🌐 Import from web'),
      h('button', { onclick: () => RH.go('classics') }, '🏺 From classics library')));
  const flt = h('input', { type: 'search', placeholder: 'Filter by title, author, tag…', value: q, oninput: RH.debounce(e => setP('f', e.target.value), 300) });
  main.append(h('div', { class: 'filters' }, flt,
    RH.select([['', 'All kinds'], ...Object.keys(KIND_ICON).map(k => [k, KIND_ICON[k] + ' ' + k])], kindF), RH.select([['', 'All eras'], ...RH.ERAS], eraF),
    tags.length ? RH.select([['', 'All tags'], ...tags.map(t => [t, '#' + t])], tagF) : '', cols.length ? RH.select([['', 'All collections'], ...cols.map(c => [c, c])], colF) : ''));
  const sels = $$('.filters select', main); const keys = ['k', 'e', ...(tags.length ? ['t'] : []), ...(cols.length ? ['c'] : [])];
  sels.forEach((s, i) => s.onchange = () => setP(keys[i], s.value));
  const fq = RH.fold(q);
  const list = docs.filter(d => (!kindF || d.kind === kindF) && (!eraF || d.era === eraF) && (!tagF || (d.tags || []).includes(tagF)) && (!colF || d.collection === colF) &&
    (!fq || RH.fold([d.title, d.author, d.collection, d.discipline, ...(d.tags || [])].join(' ')).includes(fq))).sort((a, b) => (b.added || '').localeCompare(a.added || ''));
  if (!docs.length) {
    main.append(h('div', { class: 'card empty-state' }, h('h3', {}, 'Your archive is empty — a few ways in:'),
      h('ul', {}, h('li', {}, h('b', {}, 'Drop PDFs, text, HTML or TEI XML'), ' onto this page — their text is extracted and indexed for search.'),
        h('li', {}, h('a', { href: '#/classics' }, 'Classics library'), ' — 2,275 Greek and Latin works (807 with English), loaded straight into the archive.'),
        h('li', {}, h('a', { href: '#/web' }, 'Web search'), ' — import a Wikipedia article or an Internet Archive book (incl. public-domain Loebs).'),
        h('li', {}, 'Or ', h('a', { href: '#', onclick: e => { e.preventDefault(); RH.loadStarter(); } }, 'load a small starter set'), ' to see everything working.'))));
    return;
  }
  const grid = h('div', { class: 'doclist' });
  for (const d of list) grid.append(h('a', { class: 'docrow', href: '#/doc/' + d.id },
    h('span', { class: 'dk' }, KIND_ICON[d.kind] || '📄'),
    h('span', { class: 'dm' }, h('b', {}, d.title), h('small', {}, [d.author, d.date, d.era && RH.ERAS.find(e => e[0] === d.era)?.[1], d.collection].filter(Boolean).join(' · ') || '—'),
      (d.tags || []).length ? h('span', { class: 'tags' }, d.tags.map(t => h('i', {}, '#' + t))) : ''),
    h('span', { class: 'ds' }, fmtSize(docLen(d)))));
  main.append(list.length ? grid : h('p', { class: 'muted' }, 'Nothing matches these filters.'));
};
async function addNote() {
  const title = h('input', { type: 'text', placeholder: 'Title' }); const text = h('textarea', { rows: 12, placeholder: 'Paste or write text here…' });
  const src = h('input', { type: 'text', placeholder: 'Source (book, URL, conversation…)' });
  const v = await RH.modal('Add text or a note', h('div', { class: 'form' }, RH.field('Title', title), RH.field('Text', text), RH.field('Source', src)), [['Cancel', () => null], ['Save', () => true, 'primary']]);
  if (!v || !text.value.trim()) return;
  const d = await RH.saveDocDraft({ title: title.value.trim() || text.value.trim().slice(0, 60), text: text.value, source: src.value, kind: 'note' });
  RH.go('doc/' + d.id);
}
async function importFromWeb() {
  const sel = RH.select([['wikipedia', 'Wikipedia article (title)'], ['archive', 'Internet Archive item (identifier or URL)'], ['url', 'Any web page URL (if the site allows it)']], 'wikipedia');
  const inp = h('input', { type: 'text', placeholder: 'e.g. Logos  ·  loebclassicalli00homeuoft  ·  https://…' });
  const v = await RH.modal('Import from the web', h('div', { class: 'form' }, RH.field('Source', sel), RH.field('What', inp)), [['Cancel', () => null], ['Import', () => true, 'primary']]);
  if (!v || !inp.value.trim()) return;
  try {
    toast('Fetching…');
    const val = inp.value.trim();
    const draft = sel.value === 'wikipedia' ? await RH.importWikipedia(val.replace(/^https?:\/\/[^/]+\/wiki\//, '').replace(/_/g, ' '))
      : sel.value === 'archive' ? await RH.importArchiveItem(val.replace(/^https?:\/\/archive\.org\/details\//, '').split(/[/?#]/)[0]) : await RH.importURLText(val);
    const d = await RH.saveDocDraft(draft); RH.go('doc/' + d.id);
  } catch (e) { toast('Import failed: ' + e.message + (sel.value === 'url' ? ' — many sites block this; copy the text and use “Paste text” instead.' : ''), 7000); }
}
document.addEventListener('dragover', e => { if (RH.route?.view === 'archive' || RH.route?.view === 'doc') { e.preventDefault(); document.body.classList.add('dragging'); } });
document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
document.addEventListener('drop', e => { document.body.classList.remove('dragging'); if (e.dataTransfer?.files?.length && (RH.route?.view === 'archive' || RH.route?.view === 'doc')) { e.preventDefault(); ingestFiles([...e.dataTransfer.files]); } });

/* ---------- DOCUMENT READER ---------- */
V.doc = async function (main, r) {
  const d = S.docs.get(r.arg); if (!d) { main.append(h('p', {}, 'That source is not in the archive. ', h('a', { href: '#/archive' }, 'Back to archive'))); return; }
  await RH.index.build();
  const chunks = RH.chunksOf(d); const hl = r.params.hl ? RH.terms(r.params.hl) : [];
  const head = h('div', { class: 'vh' }, h('div', { class: 'crumbs' }, h('a', { href: '#/archive' }, '← Archive')),
    h('h1', {}, (KIND_ICON[d.kind] || '📄') + ' ' + d.title), h('p', { class: 'sub' }, [d.author, d.date, d.lang && RH.langName(d.lang), d.collection, `${chunks.length} passages`].filter(Boolean).join(' · ')));
  const tb = h('div', { class: 'toolbar' },
    h('button', { onclick: () => RH.editDoc(d) }, '✎ Details'),
    ['pdf', 'image'].includes(d.kind) ? h('button', { onclick: async () => { const b = await RH.getFile(d.id); if (b) window.open(URL.createObjectURL(b)); else toast('Original file not stored'); } }, '↗ Original') : '',
    h('button', { onclick: () => RH.go('matrix', { a: d.id }) }, '⇆ Translation matrix'),
    h('button', { onclick: () => RH.nodeDialog({ label: d.title, type: 'text', era: d.era, refs: [{ t: 'doc', id: d.id }] }) }, '🧠 Add to map'),
    h('button', { onclick: () => RH.trailStepDialog({ kind: 'source', text: 'Reading: ' + d.title, refs: [{ t: 'doc', id: d.id }] }) }, '🧵 Log to trail'),
    h('button', { onclick: () => RH.download(d.title.replace(/[^\w\- ]+/g, '').slice(0, 60) + '.txt', RH.docText(d), 'text/plain') }, '⤓ Text'),
    h('button', { class: 'danger', onclick: async () => { if (confirm(`Delete “${d.title}” from the archive?`)) { await RH.remove('docs', d.id); RH.go('archive'); } } }, 'Delete'));
  main.append(head, tb);
  if (d.notes) main.append(h('div', { class: 'card note' }, d.notes));
  const layout = h('div', { class: 'reader' }); main.append(layout);
  const body = h('div', { class: 'readbody', 'data-sel': '', 'data-doc': d.id, 'data-lang': d.lang === 'grc' ? 'grc' : d.lang === 'lat' ? 'la' : '' });
  const side = h('aside', { class: 'readside' }); layout.append(body, side);
  const tip = h('p', { class: 'hint' }, 'Tip: select any text for cross-reference, web lookup, etymology, mapping, data, or logging to your trail.');
  body.append(tip);
  const PAGE = 250; let shown = 0;
  let startAt = 0; if (r.params.ref) { const i = chunks.findIndex(c => c.ref === r.params.ref); if (i >= 0) startAt = Math.max(0, i - 5); }
  if (startAt) body.append(h('button', { class: 'more', onclick: e => { e.target.remove(); RH.go('doc/' + d.id); } }, `↑ Show from the beginning`));
  const more = h('button', { class: 'more' }, 'Show more ↓');
  function renderMore() {
    const end = Math.min(chunks.length, (shown || startAt) + PAGE); const from = shown || startAt;
    for (let i = from; i < end; i++) {
      const c = chunks[i];
      const p = h('div', { class: 'psg' + (c.ref === r.params.ref ? ' target' : ''), 'data-ref': c.ref, id: 'p-' + i }, h('span', { class: 'pref' }, c.ref), h('div', { class: 'ptext', html: hl.length ? RH.snippet(c.text, hl, 1e9) : esc(c.text).replace(/\n/g, '<br>') }));
      body.insertBefore(p, more);
    }
    shown = end; if (shown >= chunks.length) more.remove();
  }
  more.onclick = renderMore; body.append(more); renderMore();
  if (!chunks.length) body.append(h('p', { class: 'muted' }, 'No text in this item yet.'));
  setTimeout(() => body.querySelector('.target')?.scrollIntoView({ block: 'center' }), 50);

  // side panel: key terms, related docs, what links here
  const kt = RH.index.keyTerms(RH.docText(d).slice(0, 200000), 16);
  side.append(h('h4', {}, 'Distinctive terms'), h('div', { class: 'chips' }, kt.map(t => h('a', { class: 'chip', href: '#/search?' + new URLSearchParams({ q: t, x: d.id }) }, t))));
  const rel = RH.index.related(d.id, 8);
  side.append(h('h4', {}, 'Related in your archive'), rel.length ? h('div', { class: 'rel' }, rel.map(x => h('a', { href: '#/doc/' + x.id, class: 'relrow' }, h('b', {}, S.docs.get(x.id).title), h('small', {}, `${Math.round(x.sim * 100)}% · shared: ${x.shared.slice(0, 5).join(', ')}`)))) : h('p', { class: 'muted small' }, 'Add more sources to see connections.'));
  const nodes = [...S.nodes.values()].filter(n => (n.refs || []).some(x => x.t === 'doc' && x.id === d.id));
  const steps = [...S.trails.values()].flatMap(t => t.steps.filter(s => (s.refs || []).some(x => x.t === 'doc' && x.id === d.id)).map(s => ({ t, s })));
  const data = [...S.data.values()].filter(x => (x.refs || []).some(y => y.t === 'doc' && y.id === d.id));
  if (nodes.length) side.append(h('h4', {}, 'On your map'), h('div', { class: 'chips' }, nodes.map(n => h('a', { class: 'chip', href: '#/map?n=' + n.id }, n.label))));
  if (steps.length) side.append(h('h4', {}, 'In your trails'), ...steps.slice(0, 8).map(({ t, s }) => h('a', { class: 'relrow', href: '#/trails/' + t.id }, h('b', {}, RH.STEP_KINDS[s.kind]?.[0] + ' ' + s.text.slice(0, 80)), h('small', {}, t.title))));
  if (data.length) side.append(h('h4', {}, 'Data points from here'), ...data.slice(0, 8).map(x => h('a', { class: 'relrow', href: '#/data' }, h('b', {}, `${x.series}: ${x.value} ${x.unit || ''}`), h('small', {}, x.date || ''))));
  side.append(h('h4', {}, 'Cross-reference with the web'), h('div', { class: 'chips' }, h('a', { class: 'chip', href: '#/web?' + new URLSearchParams({ q: kt.slice(0, 4).join(' ') }) }, '🌐 ' + kt.slice(0, 4).join(' '))));
};

/* ---------- SEARCH ---------- */
V.search = async function (main, r) {
  const q = r.params.q || ''; const ex = r.params.x || '';
  const inp = h('input', { type: 'search', value: q, placeholder: 'Search the whole archive — "exact phrase", -exclude, prefix*', autofocus: true });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') RH.go('search', { q: inp.value, ...(ex ? { x: ex } : {}) }); });
  main.append(h('div', { class: 'vh' }, h('h1', {}, '🔍 Search & cross-reference'), h('p', { class: 'sub' }, 'Passage-level search across every source; accents and Greek breathings are ignored, so λογος finds λόγος.')),
    h('div', { class: 'searchbar' }, inp, h('button', { class: 'primary', onclick: () => RH.go('search', { q: inp.value, ...(ex ? { x: ex } : {}) }) }, 'Search')));
  if (ex && S.docs.get(ex)) main.append(h('p', { class: 'muted' }, 'Showing matches outside ', h('b', {}, S.docs.get(ex).title), ' · ', h('a', { href: '#/search?' + new URLSearchParams({ q }) }, 'include it')));
  if (!q) { main.append(h('p', { class: 'muted' }, S.docs.size ? 'Type a word, phrase, name or passage.' : 'Your archive is empty — add sources first.')); return; }
  const status = h('p', { class: 'muted' }, 'Indexing…'); main.append(status);
  await RH.index.build(); status.remove();
  const res = RH.index.search(q, { exclude: ex, limit: 120 });
  // concepts on the map that match
  const fq = RH.fold(q); const mapHits = [...S.nodes.values()].filter(n => RH.fold(n.label).includes(fq) || fq.includes(RH.fold(n.label)) && n.label.length > 3).slice(0, 12);
  const top = h('div', { class: 'toolbar' },
    h('span', { class: 'muted' }, `${res.length}${res.length === 120 ? '+' : ''} passages in ${new Set(res.map(x => x.chunk.doc)).size} sources`),
    h('button', { onclick: () => RH.go('web', { q }) }, '🌐 Also search the web'),
    h('button', { onclick: () => RH.nodeDialog({ label: q.replace(/"/g, '') }) }, '🧠 Map this'),
    h('button', { onclick: () => RH.trailStepDialog({ kind: 'finding', text: `Searched archive for “${q}”: ${res.length} passages in ${new Set(res.map(x => x.chunk.doc)).size} sources.` }) }, '🧵 Log'));
  main.append(top);
  if (mapHits.length) main.append(h('div', { class: 'chips' }, h('span', { class: 'muted small' }, 'On your map: '), mapHits.map(n => h('a', { class: 'chip', href: '#/map?n=' + n.id }, n.label))));
  if (!res.length) { main.append(h('div', { class: 'card' }, 'No passages found. ', h('a', { href: '#/web?' + new URLSearchParams({ q }) }, 'Try the open web →'))); return; }
  // group by document, keep order of best hit
  const groups = new Map(); for (const x of res) { if (!groups.has(x.chunk.doc)) groups.set(x.chunk.doc, []); groups.get(x.chunk.doc).push(x); }
  for (const [docId, hits] of groups) {
    const d = S.docs.get(docId); if (!d) continue;
    const card = h('div', { class: 'card hitgroup' }, h('div', { class: 'hg-h' }, h('a', { href: '#/doc/' + docId }, (KIND_ICON[d.kind] || '📄') + ' ' + d.title), h('small', { class: 'muted' }, `${hits.length} passage${hits.length > 1 ? 's' : ''}`)));
    for (const x of hits.slice(0, 4)) card.append(h('div', { class: 'hit', 'data-sel': '', 'data-doc': docId, 'data-ref': x.chunk.ref },
      h('a', { class: 'pref', href: '#/doc/' + docId + '?' + new URLSearchParams({ ref: x.chunk.ref, hl: q }) }, x.chunk.ref), h('span', { html: RH.snippet(x.chunk.text, x.terms) })));
    if (hits.length > 4) card.append(h('a', { class: 'small', href: '#/doc/' + docId + '?' + new URLSearchParams({ hl: q }) }, `+ ${hits.length - 4} more in this source`));
    main.append(card);
  }
};

/* ---------- WEB CROSS-REFERENCE ---------- */
V.web = async function (main, r) {
  const q = r.params.q || ''; const chosen = (r.params.s || 'wikipedia,openalex,archive,wiktionary').split(',');
  const inp = h('input', { type: 'search', value: q, placeholder: 'Term, name, or passage to look up' });
  const boxes = Object.entries(RH.WEB_SOURCES).map(([k, s]) => h('label', { class: 'chk', title: s.about }, h('input', { type: 'checkbox', value: k, checked: chosen.includes(k) }), ` ${s.icon} ${s.name}`));
  const run = () => RH.go('web', { q: inp.value, s: boxes.map(b => b.querySelector('input')).filter(i => i.checked).map(i => i.value).join(',') });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
  main.append(h('div', { class: 'vh' }, h('h1', {}, '🌐 Web cross-reference'), h('p', { class: 'sub' }, 'Open, keyless sources. Each result is checked against your archive, so you can see what you already have and what is new.')),
    h('div', { class: 'searchbar' }, inp, h('button', { class: 'primary', onclick: run }, 'Look up')), h('div', { class: 'chks' }, boxes));
  if (!q) return;
  await RH.index.build();
  const cols = h('div', { class: 'webcols' }); main.append(cols);
  const slots = {};
  for (const k of chosen) { if (!RH.WEB_SOURCES[k]) continue; const s = RH.WEB_SOURCES[k]; slots[k] = h('div', { class: 'card websrc' }, h('h3', {}, `${s.icon} ${s.name}`), h('p', { class: 'muted small' }, 'Searching…')); cols.append(slots[k]); }
  RH.webSearch(q, chosen.filter(k => RH.WEB_SOURCES[k]), (k, res) => {
    const el = slots[k]; el.querySelector('.muted')?.remove();
    if (!res.ok) { el.append(h('p', { class: 'muted small' }, `Unavailable here (${res.err}). It may be blocked on this network or offline.`)); return; }
    if (!res.items.length) { el.append(h('p', { class: 'muted small' }, 'No results.')); return; }
    for (const it of res.items) {
      const inArchive = RH.index.chunks.length ? RH.index.search(RH.index.keyTerms(it.title + ' ' + it.snippet, 6).join(' '), { limit: 1 })[0] : null;
      const refs = [{ t: 'url', id: it.url, label: it.title }];
      el.append(h('div', { class: 'webhit', 'data-sel': '' },
        h('a', { href: it.url, target: '_blank', rel: 'noopener' }, h('b', {}, it.title)), it.meta ? h('small', { class: 'muted' }, ' ' + it.meta) : '',
        it.snippet ? h('p', {}, it.snippet.slice(0, 280)) : '',
        inArchive && inArchive.s > 6 ? h('p', { class: 'xref' }, '↔ In your archive: ', h('a', { href: '#/doc/' + inArchive.chunk.doc + '?' + new URLSearchParams({ ref: inArchive.chunk.ref }) }, `${S.docs.get(inArchive.chunk.doc)?.title} · ${inArchive.chunk.ref}`)) : '',
        h('div', { class: 'acts' },
          it.importer ? h('button', { class: 'sm', onclick: async e => { e.target.disabled = true; e.target.textContent = 'Importing…'; try { const draft = await it.importer(); const d = await RH.saveDocDraft(draft); toast('Saved to archive'); e.target.textContent = '✓ In archive'; e.target.onclick = () => RH.go('doc/' + d.id); e.target.disabled = false; } catch (x) { toast('Import failed: ' + x.message, 5000); e.target.textContent = 'Import failed'; } } }, '⤓ Archive') : '',
          h('button', { class: 'sm', onclick: () => RH.nodeDialog({ label: it.title, notes: it.snippet, refs }) }, '🧠 Map'),
          it.word ? h('button', { class: 'sm', onclick: () => RH.go('etym', { w: it.word }) }, '🌱 Etymology') : '',
          h('button', { class: 'sm', onclick: () => RH.trailStepDialog({ kind: 'source', text: `${it.title} — ${it.url}`, refs }) }, '🧵 Log'))));
    }
  });
};

})(window.RH);
