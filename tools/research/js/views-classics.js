/* Research Hub — views: classics library and translation matrix. */
'use strict';
(function (RH) {
const { $, $$, h, esc, S, toast } = RH;
const V = RH.views;
const LANG_LABEL = { grc: 'Greek', lat: 'Latin', eng: 'English', heb: 'Hebrew', ger: 'German', fre: 'French', ita: 'Italian', lat_: 'Latin' };
const ll = l => LANG_LABEL[l] || l;
const cat = () => window.CLASSICS_CATALOG || [];

RH.findEditionDoc = urn => [...S.docs.values()].find(d => d.meta?.urn === urn);
RH.loadEdition = async function (work, ed) {
  const have = RH.findEditionDoc(ed.u); if (have) return have;
  toast(`Downloading ${work.a}, ${work.t} (${ll(ed.l)})…`, 4000);
  const xml = await RH.fetchText(ed.p, 90000);
  const t = RH.parseTEI(xml);
  if (!t.segments.length) throw new Error('No text found in this edition');
  return RH.saveDocDraft({ kind: 'classic', title: `${work.a}, ${work.t} — ${ll(ed.l)}${ed.k === 't' ? ' translation' : ''}`, author: work.a, segments: t.segments, lang: ed.l,
    collection: 'Classics', era: 'classical', tags: ['classics', ll(ed.l).toLowerCase()], source: ed.p, notes: ed.d, meta: { work: work.id, urn: ed.u, edition: ed.d, corpus: work.src } });
};

/* ---------- CLASSICS LIBRARY ---------- */
V.classics = async function (main, r) {
  const q = r.params.q || ''; const lang = r.params.l || ''; const en = r.params.en === '1';
  const works = cat();
  main.append(h('div', { class: 'vh' }, h('h1', {}, '🏺 Classics library'), h('p', { class: 'sub' }, `${works.length.toLocaleString()} works from the open Perseus & First1KGreek corpora (CC BY-SA) — ${works.filter(w => w.e.some(e => e.l === 'eng')).length} with English translations. Texts download on demand into your archive.`)));
  if (!works.length) { main.append(h('div', { class: 'card err' }, 'The catalogue file did not load (data/classics-catalog.js).')); return; }
  const inp = h('input', { type: 'search', value: q, placeholder: 'Author or title — Homer, Plato Republic, Cicero, Hermes, Orphic…' });
  const go = p => RH.go('classics', { q: inp.value, l: lang, en: en ? '1' : '', ...p });
  inp.addEventListener('input', RH.debounce(() => go({}), 350));
  const lsel = RH.select([['', 'Greek + Latin'], ['grc', 'Greek'], ['lat', 'Latin']], lang); lsel.onchange = () => go({ l: lsel.value });
  const enb = h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: en, onchange: e => go({ en: e.target.checked ? '1' : '' }) }), ' has English');
  main.append(h('div', { class: 'filters' }, inp, lsel, enb));
  const loaded = [...S.docs.values()].filter(d => d.meta?.work);
  if (loaded.length && !q) {
    const ws = [...new Set(loaded.map(d => d.meta.work))];
    main.append(h('h4', {}, 'In your archive'), h('div', { class: 'chips' }, ws.map(w => { const d = loaded.find(x => x.meta.work === w); return h('a', { class: 'chip', href: '#/matrix?' + new URLSearchParams({ a: d.id }) }, d.author + ', ' + (works.find(x => x.id === w)?.t || '')); })));
  }
  const fq = RH.fold(q).split(/\s+/).filter(Boolean);
  let list = works.filter(w => (!lang || w.lang === lang) && (!en || w.e.some(e => e.l === 'eng')) && (!fq.length || fq.every(t => RH.fold(w.a + ' ' + w.t + ' ' + w.id).includes(t))));
  if (!q) list = list.filter(w => w.e.some(e => e.l === 'eng')).sort((a, b) => b.e.length - a.e.length);
  main.append(h('p', { class: 'muted small' }, q ? `${list.length} matches` : 'Popular starting points (works with the most editions). Search to see all.'));
  const box = h('div', { class: 'worklist' }); main.append(box);
  for (const w of list.slice(0, 150)) {
    const orig = w.e.filter(e => e.l !== 'eng'), tr = w.e.filter(e => e.l === 'eng');
    const edBtn = e => { const have = RH.findEditionDoc(e.u); return h('button', { class: 'sm' + (have ? ' have' : ''), title: e.d, onclick: async ev => {
      ev.target.disabled = true; try { const d = await RH.loadEdition(w, e); RH.go('doc/' + d.id); } catch (x) { toast('Could not load: ' + x.message, 6000); ev.target.disabled = false; } } }, (have ? '✓ ' : '') + ll(e.l) + (e.k === 't' && e.l !== 'eng' ? ' tr.' : '') + ' · ' + e.u.split('.').pop()); };
    box.append(h('div', { class: 'work' }, h('div', {}, h('b', {}, w.t), h('span', { class: 'muted' }, ' — ' + w.a), h('small', { class: 'muted' }, ` · ${w.id} · ${w.src}`)),
      h('div', { class: 'eds' }, [...orig, ...tr].map(edBtn),
        orig.length && tr.length ? h('button', { class: 'sm primary', onclick: async ev => {
          ev.target.disabled = true; ev.target.textContent = 'Loading both…';
          try { const a = await RH.loadEdition(w, orig[0]); const b = await RH.loadEdition(w, tr[0]); RH.go('matrix', { a: a.id, b: b.id }); }
          catch (x) { toast('Could not load: ' + x.message, 6000); ev.target.disabled = false; ev.target.textContent = '⇆ Matrix'; } } }, '⇆ Matrix') : '')));
  }
  if (list.length > 150) box.append(h('p', { class: 'muted small' }, `Showing 150 of ${list.length}. Narrow the search.`));
  main.append(h('div', { class: 'card note small' }, h('b', {}, 'About the Loeb Classical Library: '), 'it is copyrighted (Harvard University Press), so it cannot be bundled. Volumes published before 1929 are public domain in the US and many are scanned on the Internet Archive — use ',
    h('a', { href: '#/web?' + new URLSearchParams({ q: 'Loeb classical library', s: 'archive' }) }, 'Web → Internet Archive'), ' to import their full text. Many Perseus English translations are those same early Loeb translations (e.g. Murray’s Iliad, 1924).'));
};

/* ---------- TRANSLATION MATRIX ---------- */
const wordCache = new Map();
async function lookupWord(word, lang) {
  const k = lang + ':' + word; if (wordCache.has(k)) return wordCache.get(k);
  const p = (async () => {
    const out = { word, lang, morph: [], defs: [], formOf: [], errs: [] };
    const bare = word.replace(/[^\p{L}\p{M}]/gu, '');
    await Promise.all([
      (lang === 'grc' || lang === 'la') ? RH.morph(bare, lang).then(m => out.morph = m).catch(e => out.errs.push('morphology: ' + e.message)) : null,
      RH.wiktDefine(bare, RH.langName(lang)).then(d => { out.defs = d.defs; out.formOf = d.formOf; }).catch(e => out.errs.push('Wiktionary: ' + e.message))]);
    if (!out.defs.length && lang === 'la' && bare !== bare.toLowerCase()) { try { const d = await RH.wiktDefine(bare.toLowerCase(), 'Latin'); out.defs = d.defs; out.formOf = d.formOf; } catch (e) { } }
    if (!out.defs.length && out.formOf[0]) { try { out.lemmaDefs = (await RH.wiktDefine(out.formOf[0], RH.langName(lang))).defs; } catch (e) { } }
    if (!out.defs.length && out.morph[0]?.lemma && !out.lemmaDefs) { try { out.lemmaDefs = (await RH.wiktDefine(out.morph[0].lemma.replace(/\d+$/, ''), RH.langName(lang))).defs; } catch (e) { } }
    return out;
  })();
  wordCache.set(k, p); return p;
}
RH.lookupWord = lookupWord;
const glossTerms = info => RH.terms([...(info.morph || []).map(m => m.mean), ...(info.defs || []), ...(info.lemmaDefs || [])].join(' ')).filter(t => t.length > 2 && !/^(form|plural|singular|genitive|dative|accusative|nominative|vocative|person|present|active|passive|indicative|participle|infinitive|masculine|feminine|neuter|first|second|third|inflection|alternative|aorist|imperfect|perfect|future|middle|subjunctive|optative|imperative)$/.test(t));

V.matrix = async function (main, r) {
  const docs = [...S.docs.values()];
  const A = S.docs.get(r.params.a), Bp = S.docs.get(r.params.b);
  let B = Bp;
  if (A && !B && A.meta?.work) B = docs.find(d => d.meta?.work === A.meta.work && d.id !== A.id && (d.lang === 'eng') !== (A.lang === 'eng'));
  const opts = [['', '— choose —'], ...docs.map(d => [d.id, d.title])];
  const sa = RH.select(opts, A?.id || ''), sb = RH.select(opts, B?.id || '');
  const go = () => RH.go('matrix', { a: sa.value, b: sb.value }); sa.onchange = go; sb.onchange = go;
  main.append(h('div', { class: 'vh' }, h('h1', {}, '⇆ Translation matrix'), h('p', { class: 'sub' }, 'Original and translation side by side, aligned by citation. Click any word in the original for its grammar, dictionary meaning, likely English counterpart and etymology.')),
    h('div', { class: 'filters' }, RH.field('Original', sa), RH.field('Translation', sb), h('button', { onclick: () => { const t = sa.value; sa.value = sb.value; sb.value = t; go(); } }, '⇄ Swap')));
  if (!A) { main.append(h('div', { class: 'card' }, 'Pick two documents, or start from the ', h('a', { href: '#/classics' }, 'Classics library'), ' (⇆ Matrix loads a work with its English translation).')); return; }
  if (A && !B && A.meta?.work) {
    const w = cat().find(x => x.id === A.meta.work); const tr = w?.e.find(e => e.l === 'eng');
    if (tr) main.append(h('div', { class: 'card' }, 'This work has an English translation available: ', h('button', { class: 'primary sm', onclick: async () => { const b = await RH.loadEdition(w, tr); RH.go('matrix', { a: A.id, b: b.id }); } }, 'Load ' + tr.u)));
  }
  const segA = A.segments?.length ? A.segments : null, segB = B?.segments?.length ? B.segments : null;
  const al = B ? (segA && segB ? RH.alignSegments(segA, segB) : RH.alignPlain(RH.docText(A), RH.docText(B))) : { rows: (segA || RH.chunksOf(A)).map(s => ({ ref: s.ref, a: [s], b: [] })), method: 'original only' };
  const langA = A.lang === 'grc' ? 'grc' : (A.lang === 'lat' || A.lang === 'la') ? 'la' : RH.scriptOf(RH.docText(A).slice(0, 500)) === 'grc' ? 'grc' : A.lang === 'eng' ? 'en' : 'la';
  const groups = [...new Set(al.rows.map(x => x.ref.split('.')[0]))];
  const g = r.params.g && groups.includes(r.params.g) ? r.params.g : groups[0];
  const gsel = RH.select(groups.map(x => [x, (A.segments ? 'Book/section ' : '¶ ') + x]), g); gsel.onchange = () => RH.go('matrix', { a: A.id, b: B?.id || '', g: gsel.value });
  main.append(h('div', { class: 'toolbar' }, h('span', { class: 'muted small' }, `Alignment: ${al.method} · ${al.rows.length} rows`), groups.length > 1 ? gsel : '',
    h('label', { class: 'chk' }, h('input', { type: 'checkbox', onchange: e => main.querySelector('.matrix').classList.toggle('hide-b', e.target.checked) }), ' hide translation'),
    h('button', { onclick: () => RH.trailStepDialog({ kind: 'source', text: `Reading ${A.title}${B ? ' with ' + B.title : ''} (${g})`, refs: [{ t: 'doc', id: A.id }, ...(B ? [{ t: 'doc', id: B.id }] : [])] }) }, '🧵 Log')));
  const wrap = h('div', { class: 'matrixwrap' }); main.append(wrap);
  const table = h('div', { class: 'matrix' }); const panel = h('aside', { class: 'wordpanel' }, h('p', { class: 'muted small' }, 'Click a word in the original.'));
  wrap.append(table, panel);
  const rows = al.rows.filter(x => x.ref.split('.')[0] === g || groups.length === 1);
  const LIMIT = 400;
  const tokenize = t => esc(t).split(/([\p{L}\p{M}]+)/u).map(w => /^[\p{L}\p{M}]+$/u.test(w) ? `<span class="w">${w}</span>` : w).join('');
  rows.slice(0, LIMIT).forEach((row, i) => {
    const ca = h('div', { class: 'mc a', 'data-sel': '', 'data-doc': A.id, 'data-ref': row.ref, 'data-lang': langA, html: row.a.map(s => (row.a.length > 1 ? `<sup>${esc(s.ref.split('.').pop())}</sup> ` : '') + tokenize(s.text)).join(row.a.length > 1 ? '<br>' : ' ') });
    const cb = h('div', { class: 'mc b', 'data-sel': '', 'data-doc': B?.id || '', 'data-ref': row.ref, html: row.b.map(s => esc(s.text)).join(' ') || '<span class="muted">—</span>' });
    const il = h('button', { class: 'sm ghost', title: 'Interlinear word-by-word for this row' }, '⋮⋮');
    const ilBox = h('div', { class: 'interlinear' });
    il.onclick = () => interlinear(row, ilBox, langA);
    table.append(h('div', { class: 'mrow', 'data-i': i }, h('div', { class: 'mref' }, row.ref, il), ca, cb, ilBox));
  });
  if (rows.length > LIMIT) table.append(h('p', { class: 'muted small' }, `Showing the first ${LIMIT} rows of this section.`));
  table.addEventListener('click', async e => {
    const w = e.target.closest('.w'); if (!w) return;
    $$('.w.on', table).forEach(x => x.classList.remove('on')); w.classList.add('on');
    const row = w.closest('.mrow'); $$('.mc.b mark', table).forEach(m => m.replaceWith(m.textContent));
    showWord(w.textContent, langA, panel, row?.querySelector('.mc.b'), A);
  });
};

async function showWord(word, lang, panel, bcell, doc) {
  panel.innerHTML = ''; panel.append(h('h3', { class: 'wp-word', lang }, word), h('p', { class: 'muted small' }, 'Looking up…'));
  const info = await lookupWord(word, lang); panel.querySelector('.muted')?.remove();
  const lemma = info.morph[0]?.lemma?.replace(/\d+$/, '') || info.formOf[0] || word;
  if (info.morph.length) panel.append(h('h4', {}, 'Grammar'), ...info.morph.slice(0, 4).map(m => h('div', { class: 'morph' }, h('b', { lang }, m.lemma), ' ', h('i', {}, m.pos), m.mean ? h('div', {}, m.mean) : '', m.infl.length ? h('small', { class: 'muted' }, m.infl.join(' | ')) : '')));
  const defs = info.defs.length ? info.defs : info.lemmaDefs || [];
  if (defs.length) panel.append(h('h4', {}, info.defs.length ? 'Meaning' : `Meaning of ${lemma}`), h('ol', { class: 'defs' }, defs.slice(0, 6).map(d => h('li', {}, d))));
  if (info.formOf.length) panel.append(h('p', { class: 'small' }, 'Form of: ', info.formOf.map(f => h('b', { lang }, f + ' '))));
  if (!info.morph.length && !defs.length) panel.append(h('p', { class: 'muted small' }, info.errs.length ? 'Lookups unavailable here (' + info.errs.join('; ') + '). Use the dictionary links below.' : 'No entry found. Try the dictionaries below.'));
  // probable English counterpart
  if (bcell) {
    const gt = new Set(glossTerms(info).map(t => t.slice(0, 5))); let hits = 0;
    if (gt.size) { bcell.innerHTML = bcell.innerHTML.replace(/(?<![<\w])([A-Za-z]{3,})(?![^<]*>)/g, m => gt.has(RH.fold(m).slice(0, 5)) ? (hits++, `<mark>${m}</mark>`) : m); }
    panel.append(h('p', { class: 'small muted' }, hits ? `Highlighted ${hits} probable English counterpart${hits > 1 ? 's' : ''} (a dictionary-based guess, not an alignment).` : 'No obvious English counterpart in this row.'));
  }
  panel.append(h('h4', {}, 'Dictionaries'), h('div', { class: 'chips' }, RH.dictLinks(lemma, lang).map(([n, u]) => h('a', { class: 'chip', href: u, target: '_blank', rel: 'noopener' }, n + ' ↗'))));
  panel.append(h('div', { class: 'acts' },
    h('button', { class: 'sm', onclick: () => RH.go('etym', { w: lemma, l: lang }) }, '🌱 Etymology'),
    h('button', { class: 'sm', onclick: () => RH.go('search', { q: word }) }, '🔍 In archive'),
    h('button', { class: 'sm', onclick: () => RH.nodeDialog({ label: lemma, type: 'word', era: 'classical', notes: defs.slice(0, 2).join('; '), refs: doc ? [{ t: 'doc', id: doc.id }] : [] }) }, '🧠 Map word')));
}

async function interlinear(row, box, lang) {
  if (box.childElementCount) { box.innerHTML = ''; return; }
  const words = row.a.flatMap(s => s.text.match(/[\p{L}\p{M}]+/gu) || []).slice(0, 80);
  const grid = h('div', { class: 'ilgrid' }); box.append(h('p', { class: 'muted small' }, 'Word-by-word (lemma · grammar · gloss) — machine lookups, check doubtful ones in the dictionaries.'), grid);
  const cells = words.map(w => { const c = h('div', { class: 'il' }, h('b', { lang }, w), h('small', { class: 'muted' }, '…')); grid.append(c); return c; });
  let i = 0; const worker = async () => { while (i < words.length) { const k = i++; const info = await lookupWord(words[k], lang); const m = info.morph[0];
    const gl = (m?.mean || info.defs[0] || info.lemmaDefs?.[0] || '').replace(/\s*\(.*?\)\s*/g, ' ').split(/[;,]/)[0].trim();
    cells[k].querySelector('small').textContent = [m?.lemma?.replace(/\d+$/, ''), m?.infl?.[0], gl].filter(Boolean).join(' · ') || '?'; } };
  await Promise.all([worker(), worker(), worker()]);
}

})(window.RH);
