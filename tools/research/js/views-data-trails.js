/* Research Hub — views: data tracker, research trails, settings (import/export, agents bridge). */
'use strict';
(function (RH) {
const { $, $$, h, esc, S, toast, uid } = RH;
const V = RH.views;

/* ---------- time parsing: ISO dates, years, BCE/CE ---------- */
RH.parseTime = function (s) {
  s = String(s || '').trim(); if (!s) return null;
  let m = s.match(/^(-?\d{1,4})-(\d{1,2})(?:-(\d{1,2}))?/); if (m) return +m[1] + (+m[2] - 1) / 12 + ((+m[3] || 1) - 1) / 365;
  m = s.match(/(\d{1,5})\s*(BCE|BC|B\.C\.|v\.\s*Chr)/i); if (m) return -m[1];
  m = s.match(/(\d{1,5})\s*(CE|AD|A\.D\.)/i) || s.match(/(?:AD|A\.D\.)\s*(\d{1,4})/i); if (m) return +m[1];
  m = s.match(/^(-?\d{1,5})(?:\.\d+)?$/); if (m) return parseFloat(s);
  m = s.match(/(-?\d{3,4})/); if (m) return +m[1];
  return null;
};
const fmtYear = y => y < 0 ? `${Math.round(-y)} BCE` : y < 1000 ? `${Math.round(y)} CE` : String(Math.round(y));

/* ---------- DATA TRACKER ---------- */
V.data = async function (main, r) {
  const all = [...S.data.values()];
  const series = [...new Set(all.map(d => d.series))].sort();
  const pick = r.params.s || '';
  main.append(h('div', { class: 'vh' }, h('h1', {}, '📊 Data tracker'), h('p', { class: 'sub' }, 'Data points pulled from your sources — each keeps its evidence. Dates can be BCE (negative years), so ancient and modern sit on one timeline.')),
    h('div', { class: 'toolbar' }, h('button', { class: 'primary', onclick: async () => { if (await RH.dataDialog({})) RH.rerender(); } }, '＋ Data point'),
      h('button', { onclick: exportPT }, '⤓ CSV for Pattern Tracker'), h('a', { class: 'btn', href: '../pattern-tracker.html' }, '📈 Open Pattern Tracker')));
  if (!all.length) { main.append(h('div', { class: 'card' }, 'No data points yet. Select a passage anywhere and choose 📊 Data, or add one here.')); return; }
  const ssel = RH.select([['', 'All series (timeline)'], ...series.map(s => [s, s])], pick); ssel.onchange = () => RH.go('data', { s: ssel.value });
  main.append(h('div', { class: 'filters' }, ssel));
  const pts = all.filter(d => !pick || d.series === pick).map(d => ({ d, t: RH.parseTime(d.date), v: parseFloat(String(d.value).replace(/[, ]/g, '')) }));
  main.append(chart(pts, !!pick, series));
  const tbl = h('table', { class: 'dtable' }, h('thead', {}, h('tr', {}, ['Series', 'Value', 'Date', 'Label', 'Evidence', ''].map(x => h('th', {}, x)))));
  const tb = h('tbody', {}); tbl.append(tb);
  for (const { d } of pts.sort((a, b) => (a.t ?? 1e9) - (b.t ?? 1e9))) {
    const src = (d.refs || []).find(x => x.t === 'doc' && S.docs.get(x.id));
    tb.append(h('tr', {}, h('td', {}, d.series), h('td', {}, `${d.value} ${d.unit || ''}`), h('td', {}, d.date || '—'), h('td', {}, d.label || ''),
      h('td', { class: 'small' }, d.quote ? `“${d.quote.slice(0, 90)}${d.quote.length > 90 ? '…' : ''}” ` : '', src ? h('a', { href: '#/doc/' + src.id + (src.anchor ? '?ref=' + encodeURIComponent(src.anchor) : '') }, S.docs.get(src.id).title) : ''),
      h('td', {}, h('b', { class: 'x', title: 'Delete', onclick: async () => { if (confirm('Delete this data point?')) { await RH.remove('data', d.id); RH.rerender(); } } }, '✕'))));
  }
  main.append(h('div', { class: 'tablewrap' }, tbl));
};
function chart(pts, single, series) {
  const NS = 'http://www.w3.org/2000/svg'; const W = 900, H = single ? 300 : 120 + 26 * series.length;
  const timed = pts.filter(p => p.t != null); const box = h('div', { class: 'card chart' });
  if (!timed.length) { box.append(h('p', { class: 'muted small' }, 'Add dates to data points to see them on a timeline.')); return box; }
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'chartsvg');
  const t0 = Math.min(...timed.map(p => p.t)), t1 = Math.max(...timed.map(p => p.t)); const pad = (t1 - t0) * 0.05 || 1;
  const X = t => 60 + (t - (t0 - pad)) / ((t1 + pad) - (t0 - pad)) * (W - 80);
  const el = (tag, a, txt) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); if (txt != null) e.textContent = txt; svg.append(e); return e; };
  const ticks = 6; for (let i = 0; i <= ticks; i++) { const t = t0 - pad + i * ((t1 + pad) - (t0 - pad)) / ticks; el('line', { x1: X(t), x2: X(t), y1: 10, y2: H - 24, class: 'grid' }); el('text', { x: X(t), y: H - 8, class: 'tick', 'text-anchor': 'middle' }, fmtYear(t)); }
  if (t0 < 0 && t1 > 0) el('line', { x1: X(0), x2: X(0), y1: 10, y2: H - 24, class: 'zero' });
  if (single && timed.some(p => !isNaN(p.v))) {
    const num = timed.filter(p => !isNaN(p.v)).sort((a, b) => a.t - b.t); const v0 = Math.min(...num.map(p => p.v)), v1 = Math.max(...num.map(p => p.v)); const vp = (v1 - v0) * 0.1 || 1;
    const Y = v => H - 34 - (v - (v0 - vp)) / ((v1 + vp) - (v0 - vp)) * (H - 54);
    el('text', { x: 6, y: Y(v1), class: 'tick' }, String(+v1.toFixed(3))); el('text', { x: 6, y: Y(v0), class: 'tick' }, String(+v0.toFixed(3)));
    el('polyline', { points: num.map(p => `${X(p.t)},${Y(p.v)}`).join(' '), class: 'cline' });
    num.forEach(p => { const c = el('circle', { cx: X(p.t), cy: Y(p.v), r: 4.5, class: 'cdot' }); const ti = document.createElementNS(NS, 'title'); ti.textContent = `${p.d.value} ${p.d.unit || ''} · ${p.d.date}${p.d.label ? ' · ' + p.d.label : ''}`; c.append(ti); });
  } else {
    series.forEach((s, i) => { const y = 24 + i * 26; el('text', { x: 4, y: y + 4, class: 'tick' }, s.length > 9 ? s.slice(0, 8) + '…' : s);
      timed.filter(p => p.d.series === s).forEach(p => { const c = el('circle', { cx: X(p.t), cy: y, r: 5, class: 'cdot', style: `fill:hsl(${(i * 67) % 360} 65% 55%)` }); const ti = document.createElementNS(NS, 'title'); ti.textContent = `${s}: ${p.d.value} ${p.d.unit || ''} · ${p.d.date}`; c.append(ti); }); });
  }
  box.append(svg); return box;
}
function exportPT() {
  const pts = [...S.data.values()].filter(d => /^\d{4}-\d{2}-\d{2}/.test(d.date || '') && !isNaN(parseFloat(d.value)));
  if (!pts.length) { toast('Pattern Tracker needs calendar dates (YYYY-MM-DD) and numeric values — none yet.', 5000); return; }
  const series = [...new Set(pts.map(d => d.series + (d.unit ? ` (${d.unit})` : '')))]; const byDate = new Map();
  for (const d of pts) { const k = d.date.slice(0, 10); if (!byDate.has(k)) byDate.set(k, {}); byDate.get(k)[d.series + (d.unit ? ` (${d.unit})` : '')] = parseFloat(d.value); }
  const rows = [['date', ...series].join(','), ...[...byDate].sort().map(([k, v]) => [k, ...series.map(s => v[s] ?? '')].join(','))];
  RH.download('research-data.csv', rows.join('\n'), 'text/csv');
}

/* ---------- RESEARCH TRAILS ---------- */
V.trails = async function (main, r) {
  if (r.arg) return trailDetail(main, S.trails.get(r.arg));
  const list = [...S.trails.values()].sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  main.append(h('div', { class: 'vh' }, h('h1', {}, '🧵 Research trails'), h('p', { class: 'sub' }, 'Each investigation is a line: question → sources → findings → hypotheses → conclusions. While a trail is active, what you save anywhere is logged to it, so the thread never breaks.')),
    h('div', { class: 'toolbar' }, h('button', { class: 'primary', onclick: async () => { const t = await RH.newTrail(); if (t) RH.go('trails/' + t.id); } }, '＋ New trail')));
  if (!list.length) { main.append(h('div', { class: 'card' }, 'No trails yet. Start one with the question you are chasing.')); return; }
  for (const t of list) {
    const active = S.meta.activeTrail === t.id; const k = c => t.steps.filter(s => s.kind === c).length;
    main.append(h('a', { class: 'card trailcard' + (active ? ' active' : ''), href: '#/trails/' + t.id }, h('b', {}, t.title), active ? h('span', { class: 'badge' }, 'active') : '', t.status === 'closed' ? h('span', { class: 'badge' }, 'closed') : '',
      h('small', { class: 'muted' }, ` ${t.steps.length} steps · ${k('source')} sources · ${k('finding')} findings · ${k('hypothesis')} hypotheses · updated ${(t.updated || t.created).slice(0, 10)}`),
      h('div', { class: 'spark' }, t.steps.map(s => h('i', { title: RH.STEP_KINDS[s.kind]?.[1], class: 'k-' + s.kind })))));
  }
};
async function trailDetail(main, t) {
  if (!t) { main.append(h('p', {}, 'Trail not found. ', h('a', { href: '#/trails' }, 'All trails'))); return; }
  const active = S.meta.activeTrail === t.id;
  main.append(h('div', { class: 'vh' }, h('div', { class: 'crumbs' }, h('a', { href: '#/trails' }, '← Trails')), h('h1', {}, '🧵 ' + t.title), t.question !== t.title ? h('p', { class: 'sub' }, t.question) : ''),
    h('div', { class: 'toolbar' },
      h('button', { class: active ? '' : 'primary', onclick: async () => { await RH.setMeta('activeTrail', active ? null : t.id); RH.rerender(); } }, active ? '⏸ Stop logging here' : '▶ Make active'),
      h('button', { onclick: () => RH.go('map', { trail: t.id }) }, '🧠 Show on map'),
      h('button', { onclick: async () => { const v = await RH.prompt('Rename trail', t.title); if (v) { t.title = v; await RH.save('trails', t); RH.rerender(); } } }, '✎ Rename'),
      h('button', { onclick: async () => { t.status = t.status === 'closed' ? 'open' : 'closed'; await RH.save('trails', t); RH.rerender(); } }, t.status === 'closed' ? 'Reopen' : '✓ Close'),
      h('button', { onclick: () => RH.download(t.title.replace(/[^\w\- ]+/g, '').slice(0, 50) + '.md', trailMarkdown(t), 'text/markdown') }, '⤓ Markdown'),
      h('button', { class: 'danger', onclick: async () => { if (confirm('Delete this trail?')) { await RH.remove('trails', t.id); if (active) await RH.setMeta('activeTrail', null); RH.go('trails'); } } }, 'Delete')));
  const layout = h('div', { class: 'trailwrap' }); const line = h('ol', { class: 'timeline' }); const side = h('aside', { class: 'trailside' }); layout.append(line, side); main.append(layout);
  t.steps.forEach((s, i) => {
    const [ic, nm] = RH.STEP_KINDS[s.kind] || ['•', s.kind];
    const txt = h('div', { class: 'st-text', 'data-sel': '', contenteditable: 'true', spellcheck: 'true' }, s.text);
    txt.addEventListener('blur', async () => { if (txt.textContent !== s.text) { s.text = txt.textContent; await RH.save('trails', t); } });
    line.append(h('li', { class: 'step k-' + s.kind + (s.resolved ? ' resolved' : '') }, h('span', { class: 'st-ic' }, ic),
      h('div', { class: 'st-b' }, h('div', { class: 'st-h' }, h('b', {}, nm), h('small', { class: 'muted' }, ' ' + new Date(s.time).toLocaleString()), s.by ? h('span', { class: 'badge' }, s.by) : '',
        h('span', { class: 'st-acts' },
          (s.kind === 'question' || s.kind === 'hypothesis') ? h('button', { class: 'sm ghost', title: 'Mark answered / tested', onclick: async () => { s.resolved = !s.resolved; await RH.save('trails', t); RH.rerender(); } }, s.resolved ? '↺' : '✓') : '',
          i ? h('button', { class: 'sm ghost', title: 'Move up', onclick: async () => { [t.steps[i - 1], t.steps[i]] = [t.steps[i], t.steps[i - 1]]; await RH.save('trails', t); RH.rerender(); } }, '↑') : '',
          h('button', { class: 'sm ghost', title: 'Delete step', onclick: async () => { t.steps.splice(i, 1); await RH.save('trails', t); RH.rerender(); } }, '✕'))),
        txt, (s.refs || []).length ? h('div', { class: 'chips' }, s.refs.map(refChip)) : '')));
  });
  // add step inline
  const kind = RH.select(Object.entries(RH.STEP_KINDS).map(([k, v]) => [k, v[0] + ' ' + v[1]]), 'finding'); const ta = h('textarea', { rows: 2, placeholder: 'Next step: what did you find, suspect, or decide?' });
  line.append(h('li', { class: 'step add' }, h('span', { class: 'st-ic' }, '＋'), h('div', { class: 'st-b' }, h('div', { class: 'row2' }, kind, h('button', { class: 'primary sm', onclick: async () => { if (!ta.value.trim()) return; t.steps.push({ id: uid('st'), kind: kind.value, text: ta.value.trim(), refs: [], time: RH.now() }); await RH.save('trails', t); RH.rerender(); } }, 'Add step')), ta)));
  // side: open threads + where to go next
  const open = t.steps.filter(s => (s.kind === 'question' || s.kind === 'hypothesis') && !s.resolved);
  side.append(h('h4', {}, `Open threads (${open.length})`), open.length ? h('div', { class: 'rel' }, open.map(s => h('div', { class: 'gap' }, RH.STEP_KINDS[s.kind][0] + ' ' + s.text.slice(0, 140)))) : h('p', { class: 'muted small' }, 'All questions and hypotheses are marked resolved.'));
  await RH.index.build();
  const docIds = new Set(t.steps.flatMap(s => s.refs || []).filter(x => x.t === 'doc').map(x => x.id));
  const nodeIds = new Set(t.steps.flatMap(s => s.refs || []).filter(x => x.t === 'node').map(x => x.id));
  const nextDocs = new Map(); for (const id of docIds) for (const x of RH.index.related(id, 5)) if (!docIds.has(x.id)) nextDocs.set(x.id, Math.max(nextDocs.get(x.id) || 0, x.sim));
  side.append(h('h4', {}, 'Sources to read next'), nextDocs.size ? h('div', { class: 'rel' }, [...nextDocs].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, sim]) => h('a', { class: 'relrow', href: '#/doc/' + id }, h('b', {}, S.docs.get(id).title), h('small', {}, `${Math.round(sim * 100)}% similar to sources in this trail`)))) : h('p', { class: 'muted small' }, 'Log sources to this trail to get reading suggestions.'));
  const G = RH.findGaps(); const gl = G.comention.filter(x => nodeIds.has(x.a.id) || nodeIds.has(x.b.id)).slice(0, 6);
  side.append(h('h4', {}, 'Connections to test'), gl.length ? h('div', { class: 'rel' }, gl.map(x => h('a', { class: 'relrow', href: '#/search?' + new URLSearchParams({ q: `"${x.a.label}" "${x.b.label}"` }) }, h('b', {}, `${x.a.label} ↔ ${x.b.label}`), h('small', {}, `${x.c} shared passages`)))) : h('p', { class: 'muted small' }, 'Map concepts from this trail to see suggested links.'));
  const q = RH.index.keyTerms(t.steps.filter(s => ['question', 'finding', 'hypothesis', 'conclusion', 'note', 'connection'].includes(s.kind)).map(s => s.text).join(' '), 5).join(' ');
  if (q) side.append(h('h4', {}, 'Search outward'), h('div', { class: 'chips' }, h('a', { class: 'chip', href: '#/search?' + new URLSearchParams({ q }) }, '🔍 ' + q), h('a', { class: 'chip', href: '#/web?' + new URLSearchParams({ q }) }, '🌐 ' + q)));
}
function refChip(x) {
  const lab = RH.refLabel(x);
  const href = x.t === 'doc' ? '#/doc/' + x.id + (x.anchor ? '?ref=' + encodeURIComponent(x.anchor) : '') : x.t === 'node' ? '#/map?' + new URLSearchParams({ n: x.id, keep: 1 }) : x.t === 'data' ? '#/data' : x.t === 'url' ? x.id : '#';
  return h('a', { class: 'chip', href, target: x.t === 'url' ? '_blank' : null }, ({ doc: '📄 ', node: '🧠 ', data: '📊 ', url: '🌐 ' }[x.t] || '') + lab.slice(0, 50) + (x.anchor ? ' · ' + x.anchor : ''));
}
function trailMarkdown(t) {
  const L = [`# ${t.title}`, '', `> ${t.question}`, '', `_Exported from Research Hub ${new Date().toISOString().slice(0, 10)}_`, ''];
  for (const s of t.steps) { const [ic, nm] = RH.STEP_KINDS[s.kind] || ['•', s.kind]; L.push(`## ${ic} ${nm}${s.resolved ? ' (resolved)' : ''} — ${s.time.slice(0, 16).replace('T', ' ')}`, '', s.text, ''); if (s.refs?.length) L.push('Refs: ' + s.refs.map(x => RH.refLabel(x) + (x.anchor ? ` (${x.anchor})` : '')).join('; '), ''); }
  return L.join('\n');
}

/* ---------- SETTINGS / BRIDGE ---------- */
RH.exportHub = function ({ withText = true } = {}) {
  const docs = [...S.docs.values()].map(d => withText ? d : { ...d, text: undefined, pages: undefined, segments: undefined });
  return { version: 1, app: 'research-hub', exported: RH.now(), docs, nodes: [...S.nodes.values()], links: [...S.links.values()], trails: [...S.trails.values()], data: [...S.data.values()], etym: [...S.etym.values()].filter(e => e.src === 'engine').length > 5000 ? [] : [...S.etym.values()] };
};
RH.importHub = async function (j, { quiet = false } = {}) {
  if (!j || typeof j !== 'object') throw new Error('Not a Research Hub file');
  const m = {}; const bump = (store, kind) => { (m[store] = m[store] || { new: 0, updated: 0 })[kind]++; };
  const addSteps = async (t, steps) => { t.steps.push(...steps.map(s => ({ id: uid('st'), time: RH.now(), refs: [], ...s }))); await RH.save('trails', t); (m.steps = m.steps || { new: 0, updated: 0 }).new += steps.length; };
  for (const store of ['docs', 'nodes', 'links', 'trails', 'data', 'etym']) {
    for (const o of j[store] || []) {
      const key = store === 'etym' ? 'key' : 'id'; if (!o[key]) o[key] = uid(store[0]);
      if (store === 'trails' && o.appendSteps) {
        const t = S.trails.get(o.id) || RH.activeTrail();
        if (t) await addSteps(t, o.appendSteps); else { const nt = { id: o.id, title: 'Steps from the agents', question: 'Steps the agents logged while no trail was active', steps: [], created: RH.now(), status: 'open' }; await RH.save('trails', nt); bump('trails', 'new'); await addSteps(nt, o.appendSteps); }
        continue;
      }
      const prev = S[store].get(o[key]); const merged = prev && store === 'docs' && !o.text && !o.pages && !o.segments ? { ...prev, ...o, text: prev.text, pages: prev.pages, segments: prev.segments } : { ...(prev || {}), ...o };
      if (store === 'nodes' && !prev) { const same = RH.findNode(o.label || ''); if (same) { Object.assign(same, Object.fromEntries(Object.entries(o).filter(([k, v]) => k !== 'id' && v && !same[k]))); await RH.save('nodes', same); for (const l of j.links || []) { if (l.from === o.id) l.from = same.id; if (l.to === o.id) l.to = same.id; } bump('nodes', 'updated'); continue; } }
      if (store === 'trails') merged.steps = merged.steps || [];
      await RH.save(store, merged); bump(store, prev ? 'updated' : 'new');
    }
  }
  // agent "steps" go to the active trail
  if (j.steps?.length) {
    let t = RH.activeTrail();
    if (!t) { t = { id: uid('t'), title: 'Steps from the agents', question: 'Steps the agents logged while no trail was active', steps: [], created: RH.now(), status: 'open' }; await RH.save('trails', t); bump('trails', 'new'); }
    await addSteps(t, j.steps);
  }
  RH.index.dirty = true;
  const said = Object.entries(m).map(([k, v]) => `${v.new + v.updated} ${k}`).join(', ');
  if (!quiet) toast(said ? 'Imported: ' + said : 'Nothing new to import');
  return m;
};
V.settings = async function (main) {
  const c = { docs: S.docs.size, nodes: S.nodes.size, links: S.links.size, trails: S.trails.size, data: S.data.size, etym: S.etym.size };
  let est = ''; try { const e = await navigator.storage?.estimate?.(); if (e) est = `${(e.usage / 1e6).toFixed(1)} MB used of ~${(e.quota / 1e9).toFixed(1)} GB available`; } catch (x) { }
  const file = h('input', { type: 'file', accept: '.json', style: 'display:none', onchange: async e => { try { await RH.importHub(JSON.parse(await e.target.files[0].text())); RH.rerender(); } catch (x) { toast('Import failed: ' + x.message, 6000); } } });
  main.append(h('div', { class: 'vh' }, h('h1', {}, '⚙️ Hub & agents'), h('p', { class: 'sub' }, `${c.docs} sources · ${c.nodes} nodes · ${c.links} links · ${c.trails} trails · ${c.data} data points · ${c.etym} etymology entries${est ? ' · ' + est : ''}`)),
    h('div', { class: 'cards2' },
      h('div', { class: 'card' }, h('h3', {}, 'Back up & move'), h('p', { class: 'small muted' }, 'Everything lives in this browser. Export regularly; the file is plain JSON you own. Original PDFs/images are not included — keep those files.'),
        h('div', { class: 'acts' }, h('button', { class: 'primary', onclick: () => RH.download(`research-hub-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(RH.exportHub())) }, '⤓ Export everything'),
          h('button', { onclick: () => RH.download('research-hub-export-light.json', JSON.stringify(RH.exportHub({ withText: false }))) }, '⤓ Export without texts'), file, h('button', { onclick: () => file.click() }, '⤒ Import / merge')),
        h('div', { class: 'acts' }, h('button', { onclick: async () => { const ok = await navigator.storage?.persist?.(); toast(ok ? 'Storage marked persistent — the browser will not evict it' : 'The browser did not grant persistent storage (it may still keep it)'); } }, '🔒 Ask browser to keep data'))),
      h('div', { class: 'card' }, h('h3', {}, 'Work with the agents'), h('p', { class: 'small' }, 'In Claude Code (in this repo), the ', h('b', {}, 'conductor'), ' leads a research team — archivist, cross-referencer, web-scout, classicist, etymologist, cartographer, data-steward and trail-keeper.'),
        h('p', { class: 'small' }, h('b', {}, 'Easiest: '), 'run ', h('code', {}, 'python3 scripts/hub_bridge.py'), ' and open the hub through it. Your hub and the agents then stay in sync by themselves (🌉 in the header shows it is connected). Without it:'),
        h('ol', { class: 'small' }, h('li', {}, 'Export everything and save it as ', h('code', {}, 'research/hub-export.json'), ' in the repo folder.'), h('li', {}, 'Ask the conductor anything (“find what connects Heraclitus’ logos to information theory in my archive”).'),
          h('li', {}, 'Agents write ', h('code', {}, 'research/hub-import-*.json'), ' — import it here; their additions are marked with the agent’s name, and hypotheses are labeled.'))),
      h('div', { class: 'card' }, h('h3', {}, 'Ubiquitous System'), h('p', { class: 'small muted' }, 'Share concepts with the Node Explorer and the hub’s tracked-concepts list.'),
        h('div', { class: 'acts' }, h('button', { onclick: () => { try { const k = 'ube.concepts'; const s = new Set(JSON.parse(localStorage.getItem(k) || '[]')); [...S.nodes.values()].filter(n => n.type === 'concept').forEach(n => s.add(n.label)); localStorage.setItem(k, JSON.stringify([...s])); toast(`Shared ${s.size} concepts`); } catch (e) { toast('Could not write shared concepts'); } } }, '→ Share my concepts'),
          h('button', { onclick: async () => { let a = []; try { a = JSON.parse(localStorage.getItem('ube.concepts') || '[]'); } catch (e) { } for (const x of a) await RH.addNode(x, {}, { quiet: true }); toast(`Brought in ${a.length} concepts`); } }, '← Bring in tracked concepts'), h('a', { class: 'btn', href: '../index.html' }, 'Open the workshop hub'))),
      h('div', { class: 'card' }, h('h3', {}, 'Start fresh'), h('p', { class: 'small muted' }, 'Load a small, real starter set (needs a connection), or wipe this browser’s hub data.'),
        h('div', { class: 'acts' }, h('button', { onclick: RH.loadStarter }, '✨ Load starter set'), h('button', { class: 'danger', onclick: async () => { if (!confirm('Delete ALL Research Hub data in this browser? Export first if you want to keep it.')) return; for (const s of ['docs', 'files', 'nodes', 'links', 'trails', 'data', 'etym', 'meta']) { try { await RH.db.clear(s); } catch (e) { } } location.reload(); } }, 'Wipe all')))));
};

/* starter set: real, public sources — fetched live; offline fallback uses two public-domain passages */
RH.loadStarter = async function () {
  toast('Loading starter set…', 4000);
  const t = { id: uid('t'), title: 'What connects the ancient logos to modern information?', question: 'What connects the ancient idea of logos (word, reason, account) to the modern idea of information?', steps: [], created: RH.now(), status: 'open' };
  t.steps.push({ id: uid('st'), kind: 'question', text: t.question, refs: [], time: RH.now() });
  await RH.save('trails', t); await RH.setMeta('activeTrail', t.id);
  const got = [];
  for (const title of ['Logos', 'Heraclitus', 'Information theory', 'Gospel of John']) { try { got.push(await RH.saveDocDraft({ ...(await RH.importWikipedia(title)), era: title === 'Information theory' ? 'modern' : 'ancient' })); } catch (e) { } }
  if (!got.length) {
    await RH.saveDocDraft({ title: 'John 1:1–5 (King James Version, 1611 — public domain)', kind: 'text', era: 'ancient', tags: ['starter'], source: 'KJV', text: 'In the beginning was the Word, and the Word was with God, and the Word was God.\n\nThe same was in the beginning with God.\n\nAll things were made by him; and without him was not any thing made that was made.\n\nIn him was life; and the life was the light of men.\n\nAnd the light shineth in darkness; and the darkness comprehended it not.' });
    await RH.saveDocDraft({ title: 'Heraclitus, fragment 1 (tr. John Burnet, Early Greek Philosophy, 1920 — public domain)', kind: 'text', era: 'ancient', tags: ['starter'], source: 'Burnet 1920', text: 'Though this Word is true evermore, yet men are as unable to understand it when they hear it for the first time as before they have heard it at all. For, though all things come to pass in accordance with this Word, men seem as if they had no experience of them, when they make trial of words and deeds such as I set forth, dividing each thing according to its nature and showing how it truly is.' });
  }
  const a = await RH.addNode('Logos', { type: 'concept', era: 'ancient', discipline: 'philosophy' }, { quiet: true });
  const b = await RH.addNode('Heraclitus', { type: 'person', era: 'ancient', discipline: 'philosophy' }, { quiet: true });
  const c = await RH.addNode('Information', { type: 'concept', era: 'modern', discipline: 'information theory' }, { quiet: true });
  const d = await RH.addNode('Word', { type: 'word', era: 'timeless', discipline: 'linguistics' }, { quiet: true });
  await RH.addLink(b.id, a.id, 'first philosophical use'); await RH.addLink(a.id, d.id, 'translated as');
  await RH.addLink(a.id, c.id, '? (to investigate)', { status: 'hypothesis' });
  t.steps.push({ id: uid('st'), kind: 'hypothesis', text: 'Logos (“account, ratio, word”) and information (“that which reduces uncertainty”) may share a structure: both name an ordering principle that makes the world intelligible. Test against the sources.', refs: [{ t: 'node', id: a.id }, { t: 'node', id: c.id }], time: RH.now() });
  await RH.save('trails', t); RH.index.dirty = true;
  toast(`Starter set loaded${got.length ? ` (${got.length} Wikipedia articles)` : ' (offline version)'} — see Trails and the Map`, 5000);
  RH.go('trails/' + t.id);
};

})(window.RH);
