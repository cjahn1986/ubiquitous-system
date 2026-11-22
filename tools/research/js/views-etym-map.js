/* Research Hub — views: etymology explorer, mind map + gap finder. */
'use strict';
(function (RH) {
const { $, $$, h, esc, S, toast } = RH;
const V = RH.views;

/* ---------- ETYMOLOGY ---------- */
const FAMILY = l => /pro$/.test(l) ? '#b77cf0' : ['grc', 'grk-pro', 'el', 'gkm', 'grc-koi'].includes(l) ? '#6b93ff' : ['la', 'itc-pro', 'la-med', 'la-lat', 'la-vul', 'la-new', 'ML', 'LL', 'fr', 'fro', 'frm', 'xno', 'it', 'es', 'pt', 'osp'].includes(l) ? '#e0884a'
  : ['en', 'enm', 'ang', 'gem-pro', 'gmw-pro', 'non', 'goh', 'gmh', 'de', 'nl', 'dum', 'got', 'osx', 'ofs'].includes(l) ? '#3ac08a' : ['he', 'hbo', 'arc', 'ar', 'akk', 'sem-pro', 'phn', 'uga', 'syc', 'egy', 'cop'].includes(l) ? '#e6c34a' : ['sa', 'pi', 'hi', 'fa', 'peo', 'ae', 'iir-pro'].includes(l) ? '#ef6b7b' : '#9aa3b2';
const LANG_PICK = [['en', 'English'], ['grc', 'Ancient Greek'], ['la', 'Latin'], ['hbo', 'Biblical Hebrew'], ['he', 'Hebrew'], ['arc', 'Aramaic'], ['sa', 'Sanskrit'], ['ar', 'Arabic'], ['egy', 'Egyptian'], ['akk', 'Akkadian'], ['ang', 'Old English'], ['fro', 'Old French'], ['de', 'German'], ['fr', 'French'], ['ine-pro', 'Proto-Indo-European'], ['gem-pro', 'Proto-Germanic'], ['sem-pro', 'Proto-Semitic']];

V.etym = async function (main, r) {
  const w = (r.params.w || '').trim(); const l = r.params.l || 'en';
  const inp = h('input', { type: 'search', value: w, placeholder: 'A word — logos, salary, Sabbath, *h₂ner-' });
  const ls = RH.select(LANG_PICK.some(x => x[0] === l) ? LANG_PICK : [...LANG_PICK, [l, RH.langName(l)]], l);
  const run = () => inp.value.trim() && RH.go('etym', { w: inp.value.trim(), l: ls.value });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
  const st = RH.etymStats();
  main.append(h('div', { class: 'vh' }, h('h1', {}, '🌱 Etymology engine'), h('p', { class: 'sub' }, 'Trace a word back through its ancestors and out to its relatives. Uses your offline engine data first, then Wiktionary (cached, so lookups keep working offline).')),
    h('div', { class: 'searchbar' }, inp, ls, h('button', { class: 'primary', onclick: run }, 'Trace')),
    h('div', { class: 'enginebar' }, h('span', {}, `🔌 Offline engine: `, h('b', {}, st.engine ? `${st.engine.toLocaleString()} entries loaded` : 'not loaded'), ` · cache: ${st.cache.toLocaleString()} words`),
      h('button', { class: 'sm', onclick: importEngine }, '⤒ Import engine data (JSON / CSV)')));
  if (!w) {
    main.append(h('div', { class: 'card' }, h('p', {}, 'Try: ', ['logos|grc', 'word|en', 'salary|en', 'religion|en', 'sabbath|en', 'philosophy|en', 'mother|en', 'deus|la', 'ψυχή|grc'].map(x => { const [a, b] = x.split('|'); return h('a', { class: 'chip', href: '#/etym?' + new URLSearchParams({ w: a, l: b }) }, a); })),
      h('p', { class: 'muted small' }, 'Select any single word anywhere in the hub and choose 🌱 Etymology to come here.')));
    return;
  }
  const out = h('div', { class: 'etymout' }); main.append(out);
  const chainBox = h('div', { class: 'lineage' }), side = h('div', { class: 'etymside' });
  out.append(chainBox, side);
  chainBox.append(h('p', { class: 'muted' }, 'Tracing…'));
  let first;
  try { first = await RH.etymLookup(w, l); } catch (e) { chainBox.innerHTML = ''; chainBox.append(h('div', { class: 'card err' }, e.message + '. ', h('a', { href: 'https://en.wiktionary.org/wiki/' + encodeURIComponent(w), target: '_blank' }, 'Open Wiktionary ↗'))); return; }
  const draw = chain => {
    chainBox.innerHTML = '';
    chain.forEach((s, i) => {
      if (i) chainBox.append(h('div', { class: 'arrow' }, '↑ ', h('span', {}, chain[i].type || 'from')));
      const e = s.entry; const gl = s.gloss || e?.defs?.[0] || '';
      chainBox.append(h('div', { class: 'lcard', style: `--c:${FAMILY(s.lang)}` },
        h('div', { class: 'll' }, RH.langName(s.lang) || '?'), h('div', { class: 'lw' }, h('a', { href: '#/etym?' + new URLSearchParams({ w: s.word, l: s.lang }) }, s.word || '(word not given)')),
        gl ? h('div', { class: 'lg' }, gl.slice(0, 140)) : '', e?.src === 'engine' ? h('span', { class: 'badge' }, 'offline engine') : ''));
    });
  };
  const chain = await RH.etymLineage(w, l, 10, draw); draw(chain);
  // side: etymology text(s), cognates, roots, parts
  const etyms = first.etyms || [];
  if (first.defs?.length) side.append(h('h4', {}, 'Meaning'), h('ol', { class: 'defs' }, first.defs.map(d => h('li', {}, d))));
  etyms.forEach((et, i) => {
    const summary = et.text || et.rels.filter(x => x.word).map(x => `${x.type} ${RH.langName(x.lang)} ${x.word}${x.gloss ? ` (“${x.gloss}”)` : ''}`).join('; ') || '—';
    side.append(h('h4', {}, etyms.length > 1 ? `Etymology ${i + 1}` : 'Etymology'), h('p', { class: 'etext', 'data-sel': '' }, summary), first.src === 'engine' ? h('p', { class: 'muted small' }, 'Source: your offline etymology engine data.') : h('p', { class: 'muted small' }, 'Source: Wiktionary (cached in this browser).'));
    const grp = t => et.rels.filter(x => x.type === t && x.word);
    const chips = (title, arr) => arr.length ? h('div', {}, h('small', { class: 'muted' }, title), h('div', { class: 'chips' }, arr.map(x => h('a', { class: 'chip', style: `border-color:${FAMILY(x.lang)}`, href: '#/etym?' + new URLSearchParams({ w: x.word, l: x.lang }) }, `${x.word}`, h('small', {}, ' ' + RH.langName(x.lang)))))) : '';
    side.append(chips('Root', grp('root')), chips('Built from', grp('parts')), chips('Cognates (relatives in other languages)', [...grp('cognate'), ...grp('compare')]), chips('Doublets', grp('doublet of')));
  });
  if (!etyms.length) side.append(h('p', { class: 'muted small' }, 'No etymology section for this word in this language.'));
  const allWords = [...new Set(chain.map(s => s.word).filter(Boolean).concat(etyms.flatMap(e => e.rels.filter(x => x.type === 'cognate').map(x => x.word))))];
  side.append(h('h4', {}, 'Use it'), h('div', { class: 'acts' },
    h('button', { class: 'sm', onclick: async () => {
      let prev = null;
      for (const s of chain) { if (!s.word) continue; const n = await RH.addNode(s.word, { type: 'word', notes: `${RH.langName(s.lang)}${s.gloss ? ' — ' + s.gloss : ''}`, era: /pro$/.test(s.lang) ? 'deep' : ['grc', 'la', 'hbo', 'arc', 'akk', 'egy', 'sa'].includes(s.lang) ? 'ancient' : ['enm', 'ang', 'fro', 'goh', 'non'].includes(s.lang) ? 'medieval' : 'modern' }, { quiet: true }); if (prev) await RH.addLink(prev.id, n.id, s.type || 'from'); prev = n; }
      toast(`Lineage of “${w}” added to the map`); await RH.logStep('connection', `Etymology of “${w}”: ${chain.map(s => s.word).filter(Boolean).join(' ← ')}`, []);
    } }, '🧠 Lineage → map'),
    h('button', { class: 'sm', onclick: () => RH.go('search', { q: allWords.join(' ') }) }, '🔍 All forms in archive'),
    h('button', { class: 'sm', onclick: () => RH.trailStepDialog({ kind: 'finding', text: `Etymology of “${w}” (${RH.langName(l)}): ${chain.map(s => `${RH.langName(s.lang)} ${s.word}`).join(' ← ')}` }) }, '🧵 Log'),
    h('a', { class: 'chip', href: 'https://en.wiktionary.org/wiki/' + encodeURIComponent(w), target: '_blank', rel: 'noopener' }, 'Wiktionary ↗')));
};
async function importEngine() {
  const file = h('input', { type: 'file', accept: '.json,.csv,.txt' }); const langs = h('input', { type: 'text', placeholder: 'optional: only these languages, e.g. en, grc, la, hbo' });
  const v = await RH.modal('Import Offline Etymology Engine data', h('div', { class: 'form' },
    h('p', { class: 'small' }, 'Accepts (1) your engine’s JSON — a list of entries with word, lang, etymology text and relations — or (2) the open, Wiktionary-derived ', h('a', { href: 'https://github.com/droher/etymology-db', target: '_blank' }, 'etymology-db'), ' CSV. Large files: subset first with ', h('code', {}, 'scripts/etym.py subset'), '.'),
    RH.field('File', file), RH.field('Languages', langs)), [['Cancel', () => null], ['Import', () => true, 'primary']]);
  if (!v || !file.files[0]) return;
  try { toast('Importing…'); const n = await RH.importEtymData(await file.files[0].text(), { langs: langs.value.split(',').map(s => s.trim()).filter(Boolean) }); toast(`Imported ${n.toLocaleString()} entries into the etymology engine`); RH.rerender(); }
  catch (e) { toast('Import failed: ' + e.message, 7000); }
}

/* ---------- MIND MAP ---------- */
const view = { x: 0, y: 0, k: 1 };
let sim = null;
V.map = async function (main, r) {
  await RH.index.build();
  const colorBy = r.params.c || 'type'; const typeF = r.params.t || ''; const trailF = r.params.trail || '';
  const trail = trailF && S.trails.get(trailF);
  const trailIds = trail ? new Set(trail.steps.flatMap(s => s.refs || []).filter(x => x.t === 'node').map(x => x.id)) : null;
  const top = h('div', { class: 'maptop' },
    h('h1', {}, '🧠 Mind map'),
    h('button', { class: 'primary sm', onclick: async () => { const n = await RH.nodeDialog({}); if (n) RH.rerender(); } }, '＋ Node'),
    h('button', { class: 'sm', id: 'connbtn', title: 'Click one node, then another, to link them' }, '🔗 Connect'),
    (() => { const s = RH.select([['type', 'Color: type'], ['era', 'Color: era'], ['disc', 'Color: discipline']], colorBy); s.onchange = () => RH.go('map', { ...r.params, c: s.value }); return s; })(),
    (() => { const s = RH.select([['', 'All types'], ...Object.entries(RH.NODE_TYPES).map(([k, v]) => [k, v[0]])], typeF); s.onchange = () => RH.go('map', { ...r.params, t: s.value }); return s; })(),
    S.trails.size ? (() => { const s = RH.select([['', 'All trails'], ...[...S.trails.values()].map(t => [t.id, '🧵 ' + t.title])], trailF); s.onchange = () => RH.go('map', { ...r.params, trail: s.value }); return s; })() : '',
    h('button', { class: 'sm', onclick: () => { fit(); } }, '⤢ Fit'),
    h('button', { class: 'sm', onclick: () => showGaps(panel) }, '🕳️ Find gaps'),
    h('button', { class: 'sm', onclick: exportSVG }, '⤓ SVG'));
  const stage = h('div', { class: 'mapstage' }); const panel = h('aside', { class: 'mappanel' });
  main.append(top, h('div', { class: 'mapwrap' }, stage, panel));
  const nodes = [...S.nodes.values()].filter(n => !typeF || n.type === typeF);
  const ids = new Set(nodes.map(n => n.id));
  const links = [...S.links.values()].filter(l => ids.has(l.from) && ids.has(l.to));
  if (!nodes.length) {
    stage.append(h('div', { class: 'mapempty' }, h('p', {}, 'Your map is empty.'), h('p', { class: 'muted small' }, 'Add nodes here, select text anywhere and choose 🧠 Map, or send an etymology lineage over. Double-click the canvas to add a node where you click.'),
      h('button', { class: 'primary', onclick: async () => { await RH.nodeDialog({}); RH.rerender(); } }, '＋ Add first node')));
    showGaps(panel, true); return;
  }
  const discs = [...new Set(nodes.map(n => n.discipline).filter(Boolean))]; const PAL = ['#6b93ff', '#e0884a', '#3ac08a', '#b77cf0', '#e6c34a', '#ef6b7b', '#4ac6d6', '#ff9f43', '#9aa3b2'];
  const eraCol = e => !e ? '#9aa3b2' : `hsl(${30 + (RH.ERA_ORDER[e] / (RH.ERAS.length - 1)) * 200} 70% 58%)`;
  const colorOf = n => colorBy === 'era' ? eraCol(n.era) : colorBy === 'disc' ? (n.discipline ? PAL[discs.indexOf(n.discipline) % PAL.length] : '#9aa3b2') : (RH.NODE_TYPES[n.type]?.[1] || '#9aa3b2');
  const W = stage.clientWidth || 800, H = stage.clientHeight || 560;
  const NS = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'mapsvg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const g = document.createElementNS(NS, 'g'); svg.append(g); stage.append(svg);
  const legend = h('div', { class: 'legend' }); stage.append(legend);
  if (colorBy === 'type') legend.append(...Object.entries(RH.NODE_TYPES).filter(([k]) => nodes.some(n => n.type === k)).map(([k, v]) => h('span', {}, h('i', { style: `background:${v[1]}` }), v[0])));
  else if (colorBy === 'era') legend.append(...RH.ERAS.filter(([k]) => nodes.some(n => n.era === k)).map(([k, v]) => h('span', {}, h('i', { style: `background:${eraCol(k)}` }), v)));
  else legend.append(...discs.map((d, i) => h('span', {}, h('i', { style: `background:${PAL[i % PAL.length]}` }), d)));
  const used = Object.keys(RH.STATUS).filter(k => links.some(l => l.status === k));
  if (used.length) legend.append(h('span', { class: 'lsep' }), ...used.map(k => h('span', { title: RH.STATUS[k][1], html: `<svg width="22" height="8" aria-hidden="true"><line x1="1" y1="4" x2="21" y2="4" class="mlink ${RH.STATUS[k][0]}"/></svg>${k}` })));
  // place new nodes
  const P = new Map(); nodes.forEach((n, i) => { const a = i * 2.39996; P.set(n.id, { x: n.x ?? W / 2 + Math.cos(a) * 30 * Math.sqrt(i + 1), y: n.y ?? H / 2 + Math.sin(a) * 30 * Math.sqrt(i + 1), vx: 0, vy: 0, fixed: !!n.pinned, n }); });
  const deg = new Map(); links.forEach(l => { deg.set(l.from, (deg.get(l.from) || 0) + 1); deg.set(l.to, (deg.get(l.to) || 0) + 1); });
  const lineEls = links.map(l => {
    const ln = document.createElementNS(NS, 'line'); const a = S.nodes.get(l.from), b = S.nodes.get(l.to);
    const bridge = (RH.isOld(a.era) && RH.isNew(b.era)) || (RH.isNew(a.era) && RH.isOld(b.era));
    ln.setAttribute('class', 'mlink' + (bridge ? ' bridge' : '') + (RH.STATUS[l.status] ? ' ' + RH.STATUS[l.status][0] : '') + (l.req ? ' req' : '')); g.append(ln);
    if (l.status || l.verdict) { const ti = document.createElementNS(NS, 'title'); ti.textContent = [l.label, l.status && RH.STATUS[l.status]?.[1], l.verdict?.note].filter(Boolean).join(' · '); ln.append(ti); }
    let tx = null; if (l.label) { tx = document.createElementNS(NS, 'text'); tx.setAttribute('class', 'mlabel'); tx.textContent = l.label; g.append(tx); }
    return { l, ln, tx };
  });
  const nodeEls = nodes.map(n => {
    const gg = document.createElementNS(NS, 'g'); gg.setAttribute('class', 'mnode' + (trailIds && !trailIds.has(n.id) ? ' dim' : '') + (RH.STATUS[n.status] ? ' ' + RH.STATUS[n.status][0] : '') + (n.req ? ' req' : '')); gg.dataset.id = n.id;
    const rad = 7 + Math.min(14, Math.sqrt(deg.get(n.id) || 0) * 4);
    const c = document.createElementNS(NS, n.type === 'question' ? 'rect' : 'circle');
    if (n.type === 'question') { c.setAttribute('x', -rad); c.setAttribute('y', -rad); c.setAttribute('width', rad * 2); c.setAttribute('height', rad * 2); c.setAttribute('rx', 4); c.setAttribute('transform', 'rotate(45)'); } else c.setAttribute('r', rad);
    c.setAttribute('fill', colorOf(n)); const t = document.createElementNS(NS, 'text'); t.setAttribute('y', rad + 13); t.textContent = n.label.length > 32 ? n.label.slice(0, 30) + '…' : n.label;
    const ti = document.createElementNS(NS, 'title'); ti.textContent = [n.label, RH.NODE_TYPES[n.type]?.[0], n.era, n.discipline].filter(Boolean).join(' · ');
    gg.append(c, t, ti); g.append(gg); return { n, gg };
  });
  function paint() {
    g.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
    for (const { l, ln, tx } of lineEls) { const a = P.get(l.from), b = P.get(l.to); ln.setAttribute('x1', a.x); ln.setAttribute('y1', a.y); ln.setAttribute('x2', b.x); ln.setAttribute('y2', b.y); if (tx) { tx.setAttribute('x', (a.x + b.x) / 2); tx.setAttribute('y', (a.y + b.y) / 2 - 3); } }
    for (const { n, gg } of nodeEls) { const p = P.get(n.id); gg.setAttribute('transform', `translate(${p.x},${p.y})`); }
  }
  let alpha = 1; const arr = [...P.values()];
  function tick() {
    const cx = W / 2, cy = H / 2;
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j]; let dx = b.x - a.x, dy = b.y - a.y; let d2 = dx * dx + dy * dy || 0.01; if (d2 > 160000) continue;
      const f = 2200 / d2 * alpha; const d = Math.sqrt(d2); dx /= d; dy /= d; a.vx -= dx * f; a.vy -= dy * f; b.vx += dx * f; b.vy += dy * f;
    }
    for (const { l } of lineEls) { const a = P.get(l.from), b = P.get(l.to); const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1; const f = (d - 120) * 0.03 * alpha; a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f; }
    for (const p of arr) { if (p.fixed || p === drag?.p) { p.vx = p.vy = 0; continue; } p.vx += (cx - p.x) * 0.004 * alpha; p.vy += (cy - p.y) * 0.004 * alpha; p.vx *= 0.6; p.vy *= 0.6; p.x += Math.max(-30, Math.min(30, p.vx)); p.y += Math.max(-30, Math.min(30, p.vy)); }
    alpha *= 0.985; paint();
    if (alpha > 0.02) sim = requestAnimationFrame(tick); else { sim = null; persist(); }
  }
  const persist = RH.debounce(() => { for (const p of arr) { p.n.x = Math.round(p.x); p.n.y = Math.round(p.y); } RH.db.putMany('nodes', arr.map(p => p.n)).catch(() => { }); }, 400);
  const reheat = (a = 0.5) => { alpha = Math.max(alpha, a); if (!sim) sim = requestAnimationFrame(tick); };
  if (sim) cancelAnimationFrame(sim); sim = null;
  const fresh = nodes.some(n => n.x == null); alpha = fresh ? 1 : 0.15; reheat(alpha);
  function fit() {
    const xs = arr.map(p => p.x), ys = arr.map(p => p.y); const minx = Math.min(...xs) - 60, maxx = Math.max(...xs) + 60, miny = Math.min(...ys) - 40, maxy = Math.max(...ys) + 50;
    view.k = Math.max(0.25, Math.min(1.1, W / (maxx - minx), H / (maxy - miny))); view.x = (W - (maxx + minx) * view.k) / 2; view.y = (H - (maxy + miny) * view.k) / 2; paint();
  }
  if (fresh || !r.params.keep) setTimeout(fit, fresh ? 1400 : 20);
  // interaction
  const pt = e => { const b = svg.getBoundingClientRect(); const sx = (e.clientX - b.left) * (W / b.width), sy = (e.clientY - b.top) * (H / b.height); return { sx, sy, x: (sx - view.x) / view.k, y: (sy - view.y) / view.k }; };
  let drag = null, pan = null, connectMode = false, connectFrom = null, moved = false;
  const connBtn = $('#connbtn', main); connBtn.onclick = () => { connectMode = !connectMode; connectFrom = null; connBtn.classList.toggle('on', connectMode); toast(connectMode ? 'Connect: click a node, then another' : 'Connect mode off'); };
  svg.addEventListener('pointerdown', e => {
    const gg = e.target.closest('.mnode'); const q = pt(e); moved = false;
    if (gg) { drag = { p: P.get(gg.dataset.id), ox: q.x - P.get(gg.dataset.id).x, oy: q.y - P.get(gg.dataset.id).y }; svg.setPointerCapture(e.pointerId); }
    else { pan = { sx: q.sx, sy: q.sy, vx: view.x, vy: view.y }; svg.setPointerCapture(e.pointerId); }
  });
  svg.addEventListener('pointermove', e => {
    const q = pt(e);
    if (drag) { moved = true; drag.p.x = q.x - drag.ox; drag.p.y = q.y - drag.oy; paint(); reheat(0.1); }
    else if (pan) { if (Math.abs(q.sx - pan.sx) + Math.abs(q.sy - pan.sy) > 3) moved = true; view.x = pan.vx + q.sx - pan.sx; view.y = pan.vy + q.sy - pan.sy; paint(); }
  });
  svg.addEventListener('pointerup', async e => {
    const gg = e.target.closest('.mnode');
    if (drag && moved) { drag.p.n.pinned = true; drag.p.fixed = true; persist(); }
    if (!moved && gg) {
      const id = gg.dataset.id;
      if (connectMode) {
        if (!connectFrom) { connectFrom = id; gg.classList.add('sel'); toast('Now click the node to connect to'); }
        else if (connectFrom !== id) { const lab = await RH.prompt(`Link “${S.nodes.get(connectFrom).label}” → “${S.nodes.get(id).label}”: how are they related?`, '', { placeholder: 'e.g. derives from, parallels, influenced, same root' }); if (lab !== null) { await RH.addLink(connectFrom, id, lab); await RH.logStep('connection', `${S.nodes.get(connectFrom).label} —${lab || 'related'}→ ${S.nodes.get(id).label}`, [{ t: 'node', id: connectFrom }, { t: 'node', id }]); RH.go('map', { ...r.params, n: id, keep: 1 }); } connectFrom = null; }
      } else { $$('.mnode.sel', svg).forEach(x => x.classList.remove('sel')); gg.classList.add('sel'); showNode(S.nodes.get(id), panel); }
    }
    drag = null; pan = null;
  });
  svg.addEventListener('dblclick', async e => {
    const gg = e.target.closest('.mnode');
    if (gg) { const n = await RH.nodeDialog(S.nodes.get(gg.dataset.id)); if (n) RH.go('map', { ...r.params, n: n.id, keep: 1 }); return; }
    const q = pt(e); const n = await RH.nodeDialog({}); if (n) { n.x = q.x; n.y = q.y; n.pinned = true; await RH.save('nodes', n); RH.go('map', { ...r.params, n: n.id, keep: 1 }); }
  });
  svg.addEventListener('wheel', e => { e.preventDefault(); const q = pt(e); const k = Math.max(0.2, Math.min(4, view.k * (e.deltaY < 0 ? 1.12 : 0.89))); view.x = q.sx - (q.sx - view.x) * (k / view.k); view.y = q.sy - (q.sy - view.y) * (k / view.k); view.k = k; paint(); }, { passive: false });
  function exportSVG() { const clone = svg.cloneNode(true); clone.setAttribute('xmlns', NS); const st = document.createElementNS(NS, 'style'); st.textContent = '.mlink{stroke:#999;stroke-width:1.4}.mlink.bridge{stroke:#e0884a;stroke-width:2.4}.mlabel{font:10px sans-serif;fill:#777;text-anchor:middle}.mnode text{font:12px sans-serif;text-anchor:middle;fill:#333}'; clone.prepend(st); RH.download('mind-map.svg', new XMLSerializer().serializeToString(clone), 'image/svg+xml'); }
  const sel = r.params.n && S.nodes.get(r.params.n);
  if (sel) { showNode(sel, panel); nodeEls.find(x => x.n.id === sel.id)?.gg.classList.add('sel'); } else showGaps(panel, true);
  paint();
};

function showNode(n, panel) {
  panel.innerHTML = '';
  const mentions = RH.index.mentions(n.label, 500);
  const links = [...S.links.values()].filter(l => l.from === n.id || l.to === n.id);
  panel.append(h('div', { class: 'np-h' }, h('span', { class: 'dot', style: `background:${RH.NODE_TYPES[n.type]?.[1]}` }), h('h3', {}, n.label)),
    h('p', { class: 'muted small' }, [RH.NODE_TYPES[n.type]?.[0], n.era && RH.ERAS.find(e => e[0] === n.era)?.[1], n.discipline, n.by && 'added by ' + n.by, n.status].filter(Boolean).join(' · ')),
    n.notes ? h('p', { class: 'np-notes', 'data-sel': '' }, n.notes) : '',
    n.verdict ? h('p', { class: 'verdict small' }, `⚖️ ${n.verdict.status}: ${n.verdict.note || ''} `, h('span', { class: 'muted' }, `(${n.verdict.by}, ${String(n.verdict.at).slice(0, 10)})`)) : '',
    h('div', { class: 'acts' },
      h('button', { class: 'sm', onclick: async () => { if (await RH.nodeDialog(n)) RH.go('map', { n: n.id, keep: 1 }); } }, '✎ Edit'),
      h('button', { class: 'sm', onclick: async () => { const m = await RH.nodeDialog({ linkTo: n.id }); if (m) { const lab = await RH.prompt('How is it related?', ''); if (lab) { const l = [...S.links.values()].find(x => x.from === n.id && x.to === m.id); if (l) { l.label = lab; await RH.save('links', l); } } RH.go('map', { n: m.id, keep: 1 }); } } }, '＋ Linked node'),
      h('button', { class: 'sm', onclick: async () => { n.pinned = !n.pinned; await RH.save('nodes', n); toast(n.pinned ? 'Pinned' : 'Unpinned'); } }, n.pinned ? '📌 Unpin' : '📌 Pin'),
      RH.requestBtn(n, 'nodes', 'examine'), n.status ? RH.requestBtn(n, 'nodes', 'debate') : '',
      h('button', { class: 'sm danger', onclick: async () => { if (!confirm(`Delete “${n.label}” and its links?`)) return; for (const l of links) await RH.remove('links', l.id); await RH.remove('nodes', n.id); RH.go('map', { keep: 1 }); } }, 'Delete')),
    h('h4', {}, `In your archive (${mentions.length}${mentions.length === 500 ? '+' : ''} passages)`),
    mentions.length ? h('div', { class: 'rel' }, mentions.slice(0, 5).map(c => { const ch = RH.index.chunks[c]; return h('a', { class: 'relrow', href: '#/doc/' + ch.doc + '?' + new URLSearchParams({ ref: ch.ref, hl: n.label }) }, h('b', {}, S.docs.get(ch.doc)?.title + ' · ' + ch.ref), h('small', { html: RH.snippet(ch.text, RH.terms(n.label), 140) })); })) : h('p', { class: 'muted small' }, 'Not mentioned in any source yet.'),
    h('div', { class: 'chips' },
      h('a', { class: 'chip', href: '#/search?' + new URLSearchParams({ q: `"${n.label}"` }) }, '🔍 Archive'), h('a', { class: 'chip', href: '#/web?' + new URLSearchParams({ q: n.label }) }, '🌐 Web'),
      h('a', { class: 'chip', href: '#/etym?' + new URLSearchParams({ w: n.label.split(/\s+/)[0], l: RH.scriptOf(n.label) === 'grc' ? 'grc' : 'en' }) }, '🌱 Etymology'),
      h('a', { class: 'chip', href: '../node-explorer.html?' + new URLSearchParams({ q: n.label }) }, '🕸️ Node Explorer'),
      h('a', { class: 'chip', href: '#', onclick: e => { e.preventDefault(); RH.trailStepDialog({ kind: 'note', text: n.label + ': ', refs: [{ t: 'node', id: n.id }] }); } }, '🧵 Trail')),
    h('h4', {}, `Connections (${links.length})`),
    links.length ? h('div', { class: 'rel' }, links.map(l => { const o = S.nodes.get(l.from === n.id ? l.to : l.from); return h('div', { class: 'linkrow' }, h('a', { href: '#/map?' + new URLSearchParams({ n: o.id, keep: 1 }) }, (l.from === n.id ? '→ ' : '← ') + o.label), l.label ? h('small', { class: 'muted' }, ' ' + l.label) : '', l.status ? h('span', { class: 'badge st-' + l.status, title: RH.STATUS[l.status]?.[1] || '' }, l.status) : '', ' ', RH.requestBtn(l, 'links', 'debate', true), h('b', { class: 'x', title: 'Remove link', onclick: async () => { await RH.remove('links', l.id); RH.go('map', { n: n.id, keep: 1 }); } }, '✕'),
      l.verdict ? h('div', { class: 'verdict small' }, `⚖️ ${l.verdict.note || l.verdict.status} `, h('span', { class: 'muted' }, `(${l.verdict.by}, ${String(l.verdict.at).slice(0, 10)})`)) : ''); })) : h('p', { class: 'muted small' }, 'No connections yet — use 🔗 Connect, or 🕳️ Find gaps for suggestions.'));
  const refs = (n.refs || []).filter(x => x.t === 'doc' && S.docs.get(x.id));
  if (refs.length) panel.append(h('h4', {}, 'Sources'), h('div', { class: 'rel' }, refs.map(x => h('a', { class: 'relrow', href: '#/doc/' + x.id + (x.anchor ? '?ref=' + encodeURIComponent(x.anchor) : '') }, h('b', {}, S.docs.get(x.id).title), x.anchor ? h('small', {}, x.anchor) : ''))));
}

/* ---------- GAP FINDER ---------- */
RH.findGaps = function () {
  const nodes = [...S.nodes.values()]; const links = [...S.links.values()];
  const linked = new Set(links.flatMap(l => [l.from + '|' + l.to, l.to + '|' + l.from]));
  const nb = new Map(nodes.map(n => [n.id, new Set()])); links.forEach(l => { nb.get(l.from)?.add(l.to); nb.get(l.to)?.add(l.from); });
  // 1) co-mentioned in the archive but not linked
  const ment = new Map(nodes.map(n => [n.id, new Set(RH.index.mentions(n.label, 3000))]));
  const comention = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j]; if (linked.has(a.id + '|' + b.id)) continue;
    const A = ment.get(a.id), B = ment.get(b.id); if (!A.size || !B.size) continue;
    let c = 0; const ex = []; for (const x of A.size < B.size ? A : B) if ((A.size < B.size ? B : A).has(x)) { c++; if (ex.length < 3) ex.push(x); }
    if (c) comention.push({ a, b, c, ex, docs: new Set(ex.map(x => RH.index.chunks[x].doc)).size });
  }
  comention.sort((x, y) => y.c - x.c);
  // 2) structural holes: share ≥2 neighbours, not linked
  const triads = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j]; if (linked.has(a.id + '|' + b.id)) continue;
    const s = [...nb.get(a.id)].filter(x => nb.get(b.id).has(x)); if (s.length >= 2) triads.push({ a, b, shared: s.map(x => S.nodes.get(x)) });
  }
  triads.sort((x, y) => y.shared.length - x.shared.length);
  // 3) ancient ↔ modern
  const bridges = links.filter(l => { const a = S.nodes.get(l.from), b = S.nodes.get(l.to); return a && b && ((RH.isOld(a.era) && RH.isNew(b.era)) || (RH.isNew(a.era) && RH.isOld(b.era))); });
  const noBridge = nodes.filter(n => (RH.isOld(n.era) || RH.isNew(n.era)) && ![...nb.get(n.id)].some(x => { const o = S.nodes.get(x); return o && (RH.isOld(n.era) ? RH.isNew(o.era) : RH.isOld(o.era)); }));
  // 4) unmapped: names / terms recurring across ≥2 sources, not on the map
  const onMap = new Set(nodes.map(n => RH.fold(n.label)));
  const names = new Map(); const lower = new Map(); const multi = S.docs.size > 1;
  for (const doc of S.docs.values()) {
    const seen = new Set(); const txt = RH.docText(doc).slice(0, 400000);
    for (const m of txt.matchAll(/(?<=[\s(“"'])([a-z\u03b1-\u03c9][\p{Ll}\p{M}]{3,})/gu)) { const f = RH.fold(m[1]); lower.set(f, (lower.get(f) || 0) + 1); }
    for (const m of txt.matchAll(/\b([A-Z\u0391-\u03A9][\p{Ll}\p{M}]{3,}(?:\s+(?:of\s+|the\s+)?[A-Z\u0391-\u03A9][\p{Ll}\p{M}]{3,}){0,2})(?![\p{L}.])/gu)) {
      const k = m[1]; const f = RH.fold(k); if (onMap.has(f)) continue;
      let e = names.get(f); if (!e) names.set(f, e = { label: k, n: 0, docs: 0 }); e.n++; if (!seen.has(f)) { seen.add(f); e.docs++; }
    }
  }
  // a name: capitalised far more often than not, and (if you have several sources) recurring across them
  const unmapped = [...names].filter(([f, x]) => (lower.get(f) || 0) < 0.3 * x.n && (multi ? x.docs >= 2 : x.n >= 5)).map(([, x]) => x)
    .sort((a, b) => b.docs * 10 + b.n - (a.docs * 10 + a.n)).slice(0, 25);
  const isolated = nodes.filter(n => !nb.get(n.id).size);
  const openQs = [...S.trails.values()].flatMap(t => t.steps.filter(s => (s.kind === 'question' || s.kind === 'hypothesis') && !s.resolved).map(s => ({ t, s })));
  const awaiting = [...links.filter(l => ['hypothesis', 'contested'].includes(l.status)).map(l => ({ l })), ...nodes.filter(n => ['hypothesis', 'contested'].includes(n.status)).map(n => ({ n }))];
  return { awaiting, comention: comention.slice(0, 20), triads: triads.slice(0, 15), bridges, noBridge: noBridge.slice(0, 20), unmapped, isolated: isolated.slice(0, 20), openQs: openQs.slice(0, 15) };
};
function showGaps(panel, intro) {
  panel.innerHTML = '';
  const G = RH.findGaps();
  panel.append(h('h3', {}, '🕳️ Gaps & bridges'), h('p', { class: 'muted small' }, intro ? 'Click a node for details. Here is what your map and archive suggest is missing:' : 'Suggestions to test — not facts. Each comes with its evidence.'));
  const sec = (title, items, render, empty) => { panel.append(h('h4', {}, `${title} (${items.length})`)); panel.append(items.length ? h('div', { class: 'rel' }, items.map(render)) : h('p', { class: 'muted small' }, empty)); };
  const linkBtn = (a, b, label) => h('button', { class: 'sm', onclick: async e => { const lab = await RH.prompt(`Link “${a.label}” and “${b.label}” — how?`, label || ''); if (lab === null) return; await RH.addLink(a.id, b.id, lab, { status: 'hypothesis' }); await RH.logStep('hypothesis', `${a.label} ↔ ${b.label}${lab ? ': ' + lab : ''}`, [{ t: 'node', id: a.id }, { t: 'node', id: b.id }]); e.target.textContent = '✓ linked'; e.target.disabled = true; } }, '🔗 Link');
  sec('Hypotheses awaiting a verdict', G.awaiting, x => x.l ? h('div', { class: 'gap' }, h('b', {}, `${S.nodes.get(x.l.from)?.label} — ${S.nodes.get(x.l.to)?.label}`), h('small', { class: 'muted' }, ` ${x.l.label || ''} · ${x.l.status}`), h('div', { class: 'acts' }, RH.requestBtn(x.l, 'links', 'debate')))
    : h('div', { class: 'gap' }, h('a', { href: '#/map?' + new URLSearchParams({ n: x.n.id, keep: 1 }) }, x.n.label), h('small', { class: 'muted' }, ' · ' + x.n.status), h('div', { class: 'acts' }, RH.requestBtn(x.n, 'nodes', 'debate'))), 'No untested hypotheses. Links you mark as hypotheses (dashed) appear here for the advocate and skeptic.');
  sec('Mentioned together in your sources, not linked', G.comention, x => h('div', { class: 'gap' }, h('b', {}, `${x.a.label} ↔ ${x.b.label}`), h('small', { class: 'muted' }, ` ${x.c} passage${x.c > 1 ? 's' : ''}`),
    h('div', { class: 'acts' }, h('a', { class: 'chip', href: '#/search?' + new URLSearchParams({ q: `"${x.a.label}" "${x.b.label}"` }) }, 'see passages'), linkBtn(x.a, x.b))), 'Add sources and nodes — pairs that appear in the same passages show up here.');
  sec('Share neighbours but aren’t linked (structural holes)', G.triads, x => h('div', { class: 'gap' }, h('b', {}, `${x.a.label} ↔ ${x.b.label}`), h('small', { class: 'muted' }, ' both connect to ' + x.shared.slice(0, 3).map(s => s.label).join(', ')), h('div', { class: 'acts' }, linkBtn(x.a, x.b))), 'None yet.');
  sec('Ancient ↔ modern bridges found', G.bridges, l => h('div', { class: 'gap' }, h('b', {}, `${S.nodes.get(l.from).label} — ${S.nodes.get(l.to).label}`), l.label ? h('small', { class: 'muted' }, ' ' + l.label) : ''), 'Tag nodes with an era to see bridges across time (orange links on the map).');
  sec('Missing a bridge across time', G.noBridge, n => h('div', { class: 'gap' }, h('a', { href: '#/map?' + new URLSearchParams({ n: n.id, keep: 1 }) }, n.label), h('small', { class: 'muted' }, RH.isOld(n.era) ? ' — what is its modern counterpart?' : ' — what is its ancient precursor?'),
    h('div', { class: 'acts' }, h('a', { class: 'chip', href: '#/web?' + new URLSearchParams({ q: n.label + (RH.isOld(n.era) ? ' modern' : ' ancient origins') }) }, '🌐 look'))), 'None — or no eras tagged yet.');
  sec('Recurring in your sources, not on the map', G.unmapped, x => h('div', { class: 'gap' }, h('b', {}, x.label), h('small', { class: 'muted' }, ` ${x.n}× in ${x.docs} source${x.docs > 1 ? 's' : ''}`),
    h('div', { class: 'acts' }, h('button', { class: 'sm', onclick: async e => { await RH.addNode(x.label, { refs: [] }); e.target.textContent = '✓ added'; e.target.disabled = true; } }, '＋ Map'), h('a', { class: 'chip', href: '#/search?' + new URLSearchParams({ q: `"${x.label}"` }) }, 'passages'))), 'Nothing recurring yet.');
  sec('Unconnected nodes', G.isolated, n => h('div', { class: 'gap' }, h('a', { href: '#/map?' + new URLSearchParams({ n: n.id, keep: 1 }) }, n.label)), 'Every node has at least one connection.');
  sec('Open questions & hypotheses in your trails', G.openQs, ({ t, s }) => h('div', { class: 'gap' }, h('a', { href: '#/trails/' + t.id }, RH.STEP_KINDS[s.kind][0] + ' ' + s.text.slice(0, 120))), 'No open questions.');
}

})(window.RH);
