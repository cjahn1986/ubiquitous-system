/* Research Hub — app shell: router, modal, selection toolbar, shared actions. */
'use strict';
(function (RH) {
const { $, $$, h, esc, S, uid, toast } = RH;
RH.views = RH.views || {};

/* ---------- routing ---------- */
RH.go = (path, params) => { location.hash = '#/' + path + (params ? '?' + new URLSearchParams(params) : ''); };
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '') || 'archive';
  const [path, qs] = raw.split('?'); const parts = path.split('/');
  return { view: parts[0], arg: decodeURIComponent(parts.slice(1).join('/')), params: Object.fromEntries(new URLSearchParams(qs || '')) };
}
RH.route = null;
async function render() {
  const r = RH.route = parseHash();
  const view = RH.views[r.view] || RH.views.archive;
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.v === r.view || (r.view === 'doc' && a.dataset.v === 'archive')));
  const main = $('#view'); main.innerHTML = ''; main.scrollTop = 0; window.scrollTo(0, 0);
  try { await view(main, r); } catch (e) { console.error(e); main.append(h('div', { class: 'card err' }, 'Something went wrong: ' + e.message)); }
  document.body.classList.remove('navopen');
}
window.addEventListener('hashchange', render);
RH.rerender = RH.debounce(() => render(), 60);

/* ---------- modal ---------- */
RH.modal = function (title, body, actions = []) {
  return new Promise(res => {
    const close = v => { bg.remove(); res(v); };
    const bg = h('div', { class: 'modal-bg', onclick: e => { if (e.target === bg) close(null); } },
      h('div', { class: 'modal', role: 'dialog' },
        h('div', { class: 'modal-h' }, h('b', {}, title), h('button', { class: 'x', onclick: () => close(null), 'aria-label': 'Close' }, '✕')),
        h('div', { class: 'modal-b' }, body),
        actions.length ? h('div', { class: 'modal-f' }, actions.map(([label, fn, cls]) => h('button', { class: cls || '', onclick: async () => { const v = fn ? await fn() : label; if (v !== false) close(v); } }, label))) : null));
    document.body.append(bg);
    setTimeout(() => bg.querySelector('input,textarea,select')?.focus(), 30);
  });
};
RH.prompt = async (title, value = '', { area = false, placeholder = '' } = {}) => {
  const inp = area ? h('textarea', { rows: 5, placeholder }) : h('input', { type: 'text', placeholder }); inp.value = value;
  if (!area) inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.closest('.modal').querySelector('.primary').click(); });
  const v = await RH.modal(title, inp, [['Cancel', () => null], ['OK', () => inp.value, 'primary']]);
  return v == null ? null : v;
};
RH.field = (label, el, hint) => h('label', { class: 'field' }, h('span', {}, label), el, hint ? h('small', {}, hint) : null);
RH.select = (opts, val) => { const s = h('select', {}); for (const [k, v] of opts) s.append(h('option', { value: k, selected: k === val }, v)); return s; };

/* ---------- shared actions ---------- */
RH.findNode = label => { const f = RH.fold(label).trim(); for (const n of S.nodes.values()) if (RH.fold(n.label).trim() === f) return n; return null; };
RH.addNode = async function (label, extra = {}, { quiet = false } = {}) {
  label = String(label || '').trim(); if (!label) return null;
  let n = RH.findNode(label);
  if (n) { Object.assign(n, Object.fromEntries(Object.entries(extra).filter(([k, v]) => v && !n[k]))); if (extra.refs) n.refs = [...(n.refs || []), ...extra.refs]; await RH.save('nodes', n); if (!quiet) toast(`“${label}” is already on the map — updated`); return n; }
  n = { id: uid('n'), label, type: 'concept', era: '', discipline: '', notes: '', refs: [], created: RH.now(), ...extra };
  await RH.save('nodes', n); if (!quiet) toast(`Added “${label}” to the map`);
  return n;
};
RH.addLink = async function (from, to, label = '', extra = {}) {
  if (!from || !to || from === to) return null;
  for (const l of S.links.values()) if ((l.from === from && l.to === to) || (l.from === to && l.to === from)) { if (label && !l.label) { l.label = label; await RH.save('links', l); } return l; }
  const l = { id: uid('l'), from, to, label, created: RH.now(), ...extra }; await RH.save('links', l); return l;
};
RH.nodeDialog = async function (init = {}) {
  const label = h('input', { type: 'text', value: init.label || '' });
  const type = RH.select(Object.entries(RH.NODE_TYPES).map(([k, v]) => [k, v[0]]), init.type || 'concept');
  const era = RH.select([['', '—'], ...RH.ERAS], init.era || '');
  const disc = h('input', { type: 'text', value: init.discipline || '', placeholder: 'e.g. philology, physics, myth' });
  const notes = h('textarea', { rows: 3 }); notes.value = init.notes || '';
  const v = await RH.modal(init.id ? 'Edit node' : 'Add to mind map', h('div', { class: 'form' },
    RH.field('Label', label), h('div', { class: 'row2' }, RH.field('Type', type), RH.field('Era', era)), RH.field('Discipline', disc), RH.field('Notes', notes)),
    [['Cancel', () => null], ['Save', () => ({ label: label.value.trim(), type: type.value, era: era.value, discipline: disc.value.trim(), notes: notes.value }), 'primary']]);
  if (!v || !v.label) return null;
  if (init.id) { const n = S.nodes.get(init.id); Object.assign(n, v); await RH.save('nodes', n); return n; }
  const n = await RH.addNode(v.label, { ...v, refs: init.refs || [] });
  if (init.linkTo) await RH.addLink(init.linkTo, n.id, init.linkLabel || '');
  await RH.logStep('connection', `Mapped “${n.label}”`, [{ t: 'node', id: n.id }, ...(init.refs || [])]);
  return n;
};
RH.dataDialog = async function (init = {}) {
  const series = h('input', { type: 'text', value: init.series || '', placeholder: 'what is measured, e.g. “length of reign (years)”', list: 'rh-series' });
  const dl = h('datalist', { id: 'rh-series' }, [...new Set([...S.data.values()].map(d => d.series))].map(s => h('option', { value: s })));
  const value = h('input', { type: 'text', value: init.value ?? '', placeholder: 'number or short value' });
  const unit = h('input', { type: 'text', value: init.unit || '', placeholder: 'unit' });
  const date = h('input', { type: 'text', value: init.date || '', placeholder: 'when — 2026-11-01, -480, c. 300 BCE' });
  const label = h('input', { type: 'text', value: init.label || '', placeholder: 'label (optional)' });
  const quote = h('textarea', { rows: 2 }); quote.value = init.quote || '';
  const v = await RH.modal('Record a data point', h('div', { class: 'form' }, dl, RH.field('Series', series), h('div', { class: 'row2' }, RH.field('Value', value), RH.field('Unit', unit)),
    h('div', { class: 'row2' }, RH.field('Date / time', date, 'BCE years as negative numbers, e.g. -480'), RH.field('Label', label)), RH.field('Evidence (quote)', quote)),
    [['Cancel', () => null], ['Save', () => ({ series: series.value.trim() || 'untitled', value: value.value.trim(), unit: unit.value.trim(), date: date.value.trim(), label: label.value.trim(), quote: quote.value }), 'primary']]);
  if (!v) return null;
  const d = { id: uid('d'), ...v, refs: init.refs || [], created: RH.now() };
  await RH.save('data', d); toast('Data point recorded');
  await RH.logStep('data', `${d.series}: ${d.value}${d.unit ? ' ' + d.unit : ''}${d.date ? ' (' + d.date + ')' : ''}`, [{ t: 'data', id: d.id }, ...(init.refs || [])]);
  return d;
};
RH.trailStepDialog = async function (init = {}) {
  if (!RH.activeTrail()) { await RH.newTrail(); if (!RH.activeTrail()) return; }
  const kind = RH.select(Object.entries(RH.STEP_KINDS).map(([k, v]) => [k, v[0] + ' ' + v[1]]), init.kind || 'finding');
  const text = h('textarea', { rows: 4 }); text.value = init.text || '';
  const v = await RH.modal(`Add to trail “${RH.activeTrail().title}”`, h('div', { class: 'form' }, RH.field('Kind', kind), RH.field('Text', text)),
    [['Cancel', () => null], ['Add', () => ({ kind: kind.value, text: text.value }), 'primary']]);
  if (v) await RH.logStep(v.kind, v.text, init.refs || [], init.quote ? { quote: init.quote } : {});
};
RH.newTrail = async function () {
  const q = await RH.prompt('New research trail — what are you trying to find out?', '', { placeholder: 'e.g. How does the Greek idea of logos relate to information theory?' });
  if (!q) return null;
  const t = { id: uid('t'), title: q.length > 70 ? q.slice(0, 67) + '…' : q, question: q, steps: [{ id: uid('st'), kind: 'question', text: q, refs: [], time: RH.now() }], created: RH.now(), status: 'open' };
  await RH.save('trails', t); await RH.setMeta('activeTrail', t.id); toast('Trail started — what you save now is logged to it');
  return t;
};
RH.saveDocDraft = async function (draft) {
  const d = { id: uid('doc'), title: draft.title || 'Untitled', author: draft.author || '', date: draft.date || '', kind: draft.kind || 'text', tags: draft.tags || [], era: draft.era || '', discipline: draft.discipline || '',
    collection: draft.collection || '', source: draft.source || '', text: draft.text || '', pages: draft.pages || null, segments: draft.segments || null, lang: draft.lang || '', meta: draft.meta || {}, added: RH.now(), notes: draft.notes || '' };
  await RH.save('docs', d); await RH.logStep('source', `Added source: ${d.title}`, [{ t: 'doc', id: d.id }]);
  return d;
};

/* ---------- selection toolbar ---------- */
let selTip = null;
function hideTip() { selTip?.remove(); selTip = null; }
document.addEventListener('mouseup', e => setTimeout(() => onSel(e), 10));
document.addEventListener('touchend', e => setTimeout(() => onSel(e), 300));
document.addEventListener('mousedown', e => { if (selTip && !selTip.contains(e.target)) hideTip(); });
function selContext() {
  const sel = window.getSelection(); if (!sel || sel.isCollapsed) return null;
  const text = sel.toString().trim(); if (!text || text.length > 4000) return null;
  const node = sel.anchorNode?.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
  const host = node?.closest?.('[data-sel]'); if (!host) return null;
  const docId = node.closest('[data-doc]')?.dataset.doc; const ref = node.closest('[data-ref]')?.dataset.ref;
  const lang = node.closest('[data-lang]')?.dataset.lang || '';
  return { text, docId, ref, lang, rect: sel.getRangeAt(0).getBoundingClientRect() };
}
function onSel(e) {
  if (selTip?.contains(e.target)) return;
  const c = selContext(); hideTip(); if (!c) return;
  const refs = c.docId ? [{ t: 'doc', id: c.docId, anchor: c.ref }] : [];
  const one = !/\s/.test(c.text) && c.text.length < 40;
  const word = c.text.replace(/[^\p{L}\p{M}\p{N}'*-]/gu, '');
  const lang = c.lang || (RH.scriptOf(c.text) === 'grc' ? 'grc' : 'en');
  const btn = (label, title, fn) => h('button', { title, onclick: () => { hideTip(); fn(); } }, label);
  selTip = h('div', { class: 'seltip' },
    btn('🔗 Cross-ref', 'Find this in the rest of your archive', () => RH.go('search', { q: c.text.length > 120 ? RH.index.keyTerms(c.text, 8).join(' ') : c.text, x: c.docId || '' })),
    btn('🌐 Web', 'Look this up on the open web', () => RH.go('web', { q: c.text.slice(0, 200) })),
    one ? btn('🌱 Etymology', 'Trace where this word comes from', () => RH.go('etym', { w: word, l: lang === 'grc' ? 'grc' : lang === 'la' ? 'la' : 'en' })) : null,
    btn('🧠 Map', 'Add as a node on your mind map', () => RH.nodeDialog({ label: c.text.slice(0, 80), refs, notes: c.text.length > 80 ? c.text : '' })),
    btn('📊 Data', 'Record a data point from this passage', () => RH.dataDialog({ quote: c.text, refs })),
    btn('🧵 Trail', 'Log this to your active research trail', () => RH.trailStepDialog({ text: `“${c.text.slice(0, 600)}”`, refs, quote: c.text })));
  document.body.append(selTip);
  const r = c.rect; const w = selTip.offsetWidth;
  selTip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  selTip.style.top = (r.top + scrollY - selTip.offsetHeight - 8 < scrollY + 4 ? r.bottom + scrollY + 8 : r.top + scrollY - selTip.offsetHeight - 8) + 'px';
}

/* ---------- header bits ---------- */
function renderTrailPill() {
  const t = RH.activeTrail(); const el = $('#trailpill');
  el.innerHTML = ''; el.append(t ? h('a', { href: '#/trails/' + t.id, title: 'Active research trail — saves are logged here' }, '🧵 ', h('span', {}, t.title), h('b', {}, ` · ${t.steps.length}`))
    : h('a', { href: '#', onclick: e => { e.preventDefault(); RH.newTrail(); } }, '🧵 Start a trail'));
}
RH.on('meta', renderTrailPill); RH.on('change', ({ store }) => { if (store === 'trails') renderTrailPill(); });

/* ---------- boot ---------- */
RH.boot = async function () {
  await RH.load();
  renderTrailPill();
  $('#gsearch').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.value.trim()) RH.go('search', { q: e.target.value.trim() }); });
  $('#navbtn').onclick = () => document.body.classList.toggle('navopen');
  if (!RH.persistOK()) toast('Browser storage is blocked here — work is kept in memory only. Use Settings → Export.', 7000);
  RH.index.build();
  RH.on('change', ({ store }) => { if (store === 'docs') { RH.index.dirty = true; } });
  await render();
};

})(window.RH);
