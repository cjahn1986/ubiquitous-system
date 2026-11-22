/* Research Hub — bridge client. Active only when the hub is served by scripts/hub_bridge.py.
   Sends the hub to the agents (after your exclusions), takes in the agents' files (after your rules),
   and gives you the 🌉 Bridge page: stop/start, isolate agents, keep sources off, and a verbose transport log. */
'use strict';
(function (RH) {
const { $, $$, h, esc, S, toast } = RH;
const V = RH.views;
const STORES = ['docs', 'text', 'nodes', 'links', 'trails', 'data', 'etym'];
const STORE_LABEL = { docs: 'Sources', text: 'Source text (off = titles and details only)', nodes: 'Mind-map nodes', links: 'Mind-map links', trails: 'Research trails', data: 'Data points', etym: 'Etymology cache' };
const CHANGE_LABEL = { docs: 'sources', nodes: 'map nodes', links: 'map links', trails: 'trails', data: 'data points', etym: 'etymology' };
const B = RH.bridge = { on: false, lost: false, s: null, lastLog: '0', log: [], why: new Set(), pushTimer: null, lastPush: null, pushing: false, delivering: false, sig: '' };

/* ---------- API ---------- */
async function api(path, body) {
  const r = await fetch('/bridge/' + path, { method: body ? 'POST' : 'GET', cache: 'no-store', headers: { 'X-Hub-Bridge': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}
B.api = api;
const P = () => B.s?.policy || { stores: {}, exclude: {}, agents: {} };
const rule = (p, a) => ({ send: true, receive: true, hide_docs: [], ...(p.agents?.[a] || {}) });
B.canSend = () => B.on && !B.lost && B.s?.transport && P().outbound;

/* ---------- your rules, applied in the browser so excluded sources never leave it (mirrors hub_bridge.py) ---------- */
B.applyRules = function (ex, p) {
  const st = Object.fromEntries(STORES.map(s => [s, p.stores?.[s] !== false])); const x = p.exclude || {};
  const hide = new Set(x.docs || []), tags = new Set(x.tags || []), cols = new Set(x.collections || []), kinds = new Set(x.kinds || []);
  const W = { docs: [], stores_off: STORES.filter(s => !st[s]), steps_scrubbed: 0, nodes_scrubbed: 0, data_dropped: 0 };
  const gone = new Set(), docs = [];
  for (const d of ex.docs || []) {
    const t = (d.tags || []).find(t => tags.has(t));
    const reason = !st.docs ? 'sources are not being sent' : hide.has(d.id) ? 'excluded by you' : t ? `tag #${t} excluded` : cols.has(d.collection) ? `collection “${d.collection}” excluded` : kinds.has(d.kind) ? `kind “${d.kind}” excluded` : '';
    if (reason) { gone.add(d.id); W.docs.push({ id: d.id, reason }); continue; }
    docs.push(st.text ? d : Object.fromEntries(Object.entries(d).filter(([k]) => !['text', 'pages', 'segments'].includes(k))));
  }
  const hit = refs => (refs || []).some(r => r.t === 'doc' && gone.has(r.id));
  const keep = refs => (refs || []).filter(r => !(r.t === 'doc' && gone.has(r.id)));
  const out = { ...ex, docs };
  out.nodes = !st.nodes ? [] : (ex.nodes || []).map(n => { if (!hit(n.refs)) return n; W.nodes_scrubbed++; const k = keep(n.refs); return { ...n, refs: k, notes: k.some(r => r.t === 'doc') ? n.notes : '' }; });
  out.links = st.links && st.nodes ? ex.links || [] : [];
  out.trails = !st.trails ? [] : (ex.trails || []).map(t => ({ ...t, steps: (t.steps || []).map(s => { if (!hit(s.refs)) return s; W.steps_scrubbed++; const { quote, ...rest } = s; return { ...rest, text: '[withheld: this step refers to a source kept off the bridge]', refs: keep(s.refs) }; }) }));
  out.data = !st.data ? [] : (ex.data || []).filter(d => { if (hit(d.refs)) { W.data_dropped++; return false; } return true; });
  out.etym = st.etym ? ex.etym || [] : [];
  return { ex: out, withheld: W };
};
B.docState = function (d) {
  const p = P(), x = p.exclude || {};
  if ((x.docs || []).includes(d.id)) return { off: true, why: 'kept off the bridge' };
  const t = (d.tags || []).find(t => (x.tags || []).includes(t)); if (t) return { off: true, why: `tag #${t} is kept off` };
  if ((x.collections || []).includes(d.collection)) return { off: true, why: `collection “${d.collection}” is kept off` };
  if ((x.kinds || []).includes(d.kind)) return { off: true, why: `kind “${d.kind}” is kept off` };
  const hiddenFrom = Object.entries(p.agents || {}).filter(([, r]) => (r.hide_docs || []).includes(d.id)).map(([a]) => a);
  return { off: false, hiddenFrom };
};

/* ---------- transport ---------- */
B.schedule = why => { if (!B.on) return; if (why) B.why.add(why); clearTimeout(B.pushTimer); B.pushTimer = setTimeout(() => B.push(), 3500); };
B.push = async function (why) {
  clearTimeout(B.pushTimer); B.pushTimer = null;
  if (why) B.why.add(why);
  if (!B.canSend()) return;
  if (B.pushing) { B.schedule(); return; }
  B.pushing = true; const reasons = [...B.why]; B.why.clear();
  try {
    const { ex, withheld } = B.applyRules(RH.exportHub(), P());
    B.lastPushResult = await api('export', { export: ex, withheld, why: reasons.join(', ') });
    B.lastPush = Date.now();
  } catch (e) { console.warn('bridge push failed', e); reasons.forEach(r => B.why.add(r)); }
  finally { B.pushing = false; paintPill(); }
};
async function pullLog(initial) {
  const r = await api(`log?after=${B.lastLog}&limit=${initial ? 250 : 300}`);
  if (r.entries?.length) { B.log.push(...r.entries); B.log = B.log.slice(-600); B.lastLog = r.entries[r.entries.length - 1].id; return true; }
  return false;
}
const summ = m => Object.entries(m || {}).map(([k, v]) => `${v.new + v.updated} ${CHANGE_LABEL[k] || k}`).join(', ') || 'nothing new';
async function deliver(file) {
  let c; try { c = await api('claim', { file }); } catch (e) { return false; }
  B.receiving = c.agent;
  try {
    const merged = await RH.importHub(c.content, { quiet: true });
    const dropped = Object.entries(c.dropped || {}).map(([k, v]) => `${v} ${k}`).join(', ');
    await api('ack', { file, token: c.token, result: 'delivered', merged, note: dropped ? `Left out items written by isolated agents: ${dropped}.` : '' });
    toast(`🌉 From ${c.agent}: ${summ(merged)}`);
    softRefresh(); return true;
  } catch (e) {
    await api('ack', { file, token: c.token, result: 'failed', error: e.message }).catch(() => { });
    toast(`🌉 Could not take in ${file}: ${e.message}`, 6000); return false;
  } finally { B.receiving = null; }
}
async function deliverReady() {
  if (B.delivering || !B.s) return;
  const ready = (B.s.inbox || []).filter(e => e.status === 'ready'); if (!ready.length) return;
  B.delivering = true; try { for (const e of ready) await deliver(e.file); } finally { B.delivering = false; }
}
function softRefresh() {
  const v = RH.route?.view; if (!['map', 'trails', 'archive', 'data'].includes(v)) return;
  const a = document.activeElement; if (document.querySelector('.modal-bg') || (a && a.closest('#view') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) || a?.isContentEditable) return;
  RH.rerender();
}
const sigOf = s => JSON.stringify([s.transport, s.policy.outbound, s.policy.stores, s.policy.exclude, Object.entries(s.policy.agents || {}).map(([a, r]) => [a, r.receive, r.hide_docs])]);
async function poll() {
  clearTimeout(B.pollTimer);
  if (!B.on) return;
  if (document.hidden) { B.pollTimer = setTimeout(poll, 4000); return; }
  try {
    const s = await api('status'); const wasLost = B.lost; B.lost = false; B.s = s;
    const sig = sigOf(s);
    if (sig !== B.sig) { const first = !B.sig; B.sig = sig; if (!first) B.push('your bridge rules changed'); }
    if (wasLost) B.push('the bridge came back');
    const fresh = await pullLog();
    await deliverReady();
    paintPill(); if (RH.route?.view === 'bridge') fill(fresh);
  } catch (e) { B.lost = true; paintPill(); if (RH.route?.view === 'bridge') fill(); }
  B.pollTimer = setTimeout(poll, B.lost ? 8000 : 3000);
}
B.refresh = poll;
B.setPolicy = async patch => { const r = await api('policy', { patch }); B.s.policy = r.policy; await poll(); return r; };
B.action = async (action, extra = {}) => { const r = await api('action', { action, ...extra }); if (r.warning) toast(r.warning, 7000); await poll(); return r; };

B.start = async function () {
  if (!/^https?:$/.test(location.protocol)) return;
  try { const s = await api('status'); if (s?.bridge !== 'research-hub') return; B.s = s; } catch (e) { return; }
  B.on = true; B.sig = sigOf(B.s);
  document.body.classList.add('has-bridge');
  await pullLog(true).catch(() => { });
  RH.on('change', ({ store }) => B.schedule(B.receiving ? `taking in ${B.receiving}’s additions` : `changes to ${CHANGE_LABEL[store] || store}`));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  paintPill(); B.push('the hub connected'); poll();
  if (RH.route?.view === 'bridge') RH.rerender();
};

/* ---------- header pill ---------- */
function paintPill() {
  const el = $('#bridgepill'); if (!el) return; el.innerHTML = '';
  if (!B.on) return;
  const waiting = (B.s?.inbox || []).filter(e => ['held', 'waiting'].includes(e.status)).length;
  const [cls, label] = B.lost ? ['off', 'Bridge offline'] : !B.s.transport ? ['stop', 'Bridge stopped'] : (!P().outbound || !P().inbound) ? ['part', 'Bridge one-way'] : ['ok', 'Bridge on'];
  el.append(h('a', { href: '#/bridge', class: 'bp ' + cls, title: 'Research Hub ⇄ agents — open the Bridge page' }, '🌉 ', h('span', {}, label), waiting ? h('b', {}, ` · ${waiting} waiting`) : ''));
}

/* ---------- helpers for the page ---------- */
const detok = s => esc(s || '').replace(/⟦doc:([^⟧]+)⟧/g, (m, id) => { const d = S.docs.get(id); return d ? `<i>“${esc(d.title)}”</i>` : '<i>a source no longer in your archive</i>'; });
const ago = t => { if (!t) return '—'; const s = (Date.now() - new Date(t).getTime()) / 1000; return s < 60 ? `${Math.round(s)}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString(); };
const toggle = (checked, onchange, label, title) => h('label', { class: 'tg', title: title || '' }, h('input', { type: 'checkbox', checked, onchange: e => onchange(e.target.checked) }), h('span', { class: 'sw' }), label ? h('span', {}, label) : '');
const verb = () => +(localStorage.getItem('rh.bridge.v') || P().verbosity || 2);
const countsText = c => !c ? '' : Object.entries({ docs: 'source', nodes: 'node', links: 'link', steps: 'trail step', data: 'data point', etym: 'etymology entry', trails: 'trail' }).filter(([k]) => c[k]).map(([k, w]) => `${c[k]} ${w}${c[k] > 1 ? 's' : ''}`).join(', ');
async function chooseDocs(title, selected) {
  const docs = [...S.docs.values()].sort((a, b) => a.title.localeCompare(b.title)); const sel = new Set(selected);
  const f = h('input', { type: 'search', placeholder: 'Filter…' }); const list = h('div', { class: 'checklist' });
  const draw = () => { const q = RH.fold(f.value); list.innerHTML = ''; for (const d of docs) if (!q || RH.fold(d.title).includes(q)) list.append(h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: sel.has(d.id), onchange: e => e.target.checked ? sel.add(d.id) : sel.delete(d.id) }), ' ' + d.title)); };
  f.oninput = draw; draw();
  const ok = await RH.modal(title, h('div', { class: 'form' }, f, list), [['Cancel', () => null], ['Save', () => true, 'primary']]);
  return ok ? [...sel] : null;
}

/* ---------- the 🌉 Bridge page ---------- */
const sections = {};
V.bridge = async function (main) {
  main.append(h('div', { class: 'vh' }, h('h1', {}, '🌉 Bridge'), h('p', { class: 'sub' }, 'What moves between your hub and the agents — and your controls over it. Nothing crosses unless these rules allow it, and every crossing is described below.')));
  if (!B.on) {
    main.append(h('div', { class: 'card' }, h('h3', {}, 'The bridge is not connected'),
      h('p', {}, 'This page works when the hub is opened through the bridge program on your computer. In a terminal, in the repository folder, run:'),
      h('pre', { class: 'cmd' }, 'python3 scripts/hub_bridge.py serve'),
      h('p', {}, 'then open ', h('code', {}, 'http://localhost:8000/research/'), '. It is the same address as before, so your hub data is still there. Without the bridge, use Hub & agents → Export / Import.'),
      h('button', { onclick: async () => { await B.start(); if (!B.on) toast('Still not connected'); } }, 'Check again')));
    return;
  }
  for (const k of ['head', 'out', 'agents', 'inbox', 'log']) { sections[k] = h('div', { class: 'card brsec', id: 'br-' + k }); main.append(sections[k]); }
  fill(true);
};
function fill(logChanged = true) {
  if (RH.route?.view !== 'bridge' || !sections.head?.isConnected) return;
  const busy = el => el.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && document.activeElement.type !== 'checkbox';
  const R = { head: fillHead, out: fillOut, agents: fillAgents, inbox: fillInbox, log: fillLog };
  for (const [k, f] of Object.entries(R)) { if (k === 'log' && !logChanged && sections.log.childElementCount) continue; if (!busy(sections[k])) { const y = sections[k].querySelector('.scroll')?.scrollTop; sections[k].innerHTML = ''; f(sections[k]); if (y) { const sc = sections[k].querySelector('.scroll'); if (sc) sc.scrollTop = y; } } }
}
function fillHead(el) {
  const s = B.s, p = P();
  const state = B.lost ? ['off', '⚪ Bridge offline', 'The hub cannot reach the bridge program. Start it again in the terminal; this page reconnects by itself.']
    : !s.transport ? ['stop', '🔴 Transport STOPPED', s.stopfile ? 'The emergency STOP file research/bridge/STOP exists. Delete it (and press Start) to resume.' : 'Nothing goes to the agents and their files wait. Your hub keeps working normally.']
      : ['ok', '🟢 Transport ON', `Hub → agents ${p.outbound ? 'on' : 'OFF'} · agents → hub ${p.inbound ? 'on' : 'OFF'}${p.review ? ' · every agent file waits for your review' : ''}`];
  el.append(h('div', { class: 'brhead ' + state[0] }, h('div', {}, h('h2', {}, state[1]), h('p', { class: 'small' }, state[2]),
    h('p', { class: 'small muted' }, s.export ? `Agents can read: research/hub-export.json · ${(s.export.bytes / 1e6).toFixed(2)} MB · written ${ago(s.export.mtime * 1000)}` : 'Agents can read: nothing (no export on disk)', B.pushing ? ' · sending…' : '')),
    h('div', { class: 'acts' },
      s.transport ? h('button', { class: 'danger', onclick: () => B.action('stop') }, '⏹ Stop transport') : h('button', { class: 'primary', disabled: B.lost, onclick: () => B.action('start') }, '▶ Start transport'),
      h('button', { class: 'danger', disabled: B.lost, title: 'Stop, and delete everything the agents could read', onclick: async () => { if (confirm('Stop transport AND delete the hub data the agents can read (research/hub-export.json and private views)? Your hub itself is not touched.')) await B.action('stop', { withdraw: true }); } }, '⏹ Stop & withdraw'),
      h('button', { disabled: !B.canSend(), onclick: () => B.push('you pressed Send now') }, '⇡ Send now'),
      h('button', { disabled: B.lost, title: 'End the bridge program', onclick: async () => { if (confirm('Shut down the bridge program? You will need to start it again in the terminal.')) { await B.action('shutdown').catch(() => { }); B.lost = true; paintPill(); fill(); } } }, '⏻ Shut down'))));
  el.append(h('div', { class: 'tgrow' },
    toggle(p.outbound, v => B.setPolicy({ outbound: v }), 'Hub → agents', 'Write your hub (after your exclusions) where the agents can read it'),
    toggle(p.inbound, v => B.setPolicy({ inbound: v }), 'Agents → hub', 'Accept the agents’ additions into your hub'),
    toggle(p.review, v => B.setPolicy({ review: v }), 'Review every agent file first', 'Agent files wait for your Deliver button')));
}
function fillOut(el) {
  const p = P(), x = p.exclude || {};
  el.append(h('h3', {}, '⇡ What leaves the hub'), h('p', { class: 'small muted' }, 'Kept-off sources never leave your browser. Trail steps that cite them are blanked, map nodes lose the reference, and data points quoting them are dropped.'));
  el.append(h('div', { class: 'tggrid' }, STORES.map(k => toggle(p.stores?.[k] !== false, v => B.setPolicy({ stores: { [k]: v } }), STORE_LABEL[k]))));
  const ex = (x.docs || []).map(id => S.docs.get(id)).filter(Boolean);
  el.append(h('h4', {}, `Sources kept off the bridge (${ex.length})`),
    h('div', { class: 'chips' }, ex.map(d => h('span', { class: 'chip off' }, '🔒 ' + d.title.slice(0, 60), h('b', { class: 'x', title: 'Allow on the bridge again', onclick: () => B.setPolicy({ exclude: { docs: (x.docs || []).filter(i => i !== d.id) } }) }, '✕'))),
      h('button', { class: 'sm', onclick: async () => { const v = await chooseDocs('Keep these sources off the bridge', x.docs || []); if (v) B.setPolicy({ exclude: { docs: v } }); } }, '＋ Choose sources…')));
  const tags = [...new Set([...S.docs.values()].flatMap(d => d.tags || []))].sort(), cols = [...new Set([...S.docs.values()].map(d => d.collection).filter(Boolean))].sort(), kinds = [...new Set([...S.docs.values()].map(d => d.kind))].sort();
  const pick = (key, label, opts, fmt) => h('div', { class: 'exrow' }, h('span', { class: 'small' }, label), (x[key] || []).map(v => h('span', { class: 'chip off' }, fmt(v), h('b', { class: 'x', onclick: () => B.setPolicy({ exclude: { [key]: (x[key] || []).filter(i => i !== v) } }) }, '✕'))),
    (() => { const avail = opts.filter(o => !(x[key] || []).includes(o)); if (!avail.length) return ''; const s = RH.select([['', '＋ add…'], ...avail.map(o => [o, fmt(o)])], ''); s.onchange = () => s.value && B.setPolicy({ exclude: { [key]: [...(x[key] || []), s.value] } }); return s; })());
  el.append(h('h4', {}, 'Keep off by group'), pick('tags', 'Tags:', tags, t => '#' + t), pick('collections', 'Collections:', cols, c => c), pick('kinds', 'Kinds:', kinds, k => k));
}
function fillAgents(el) {
  const agents = B.s.agents || [];
  el.append(h('div', { class: 'secthead' }, h('h3', {}, '🤖 Agents'), h('div', { class: 'acts' },
    h('button', { class: 'sm danger', onclick: () => B.action('isolate', { agents: ['all'], send: false, receive: false }) }, 'Isolate all'),
    h('button', { class: 'sm', onclick: () => B.action('isolate', { agents: ['all'], send: true, receive: true }) }, 'Release all'))),
    h('p', { class: 'small muted' }, '“Reads hub” off: the agent gets no data (its tools refuse). “Sends” off: its files are held at the bridge. Hidden sources: a private view without them.'));
  const tb = h('tbody', {});
  const team = { lead: 'Lead', research: 'Research team', science: 'Science team', other: 'Other writers' }; let last = '';
  for (const a of agents) {
    if (a.team !== last) { last = a.team; tb.append(h('tr', { class: 'grp' }, h('td', { colspan: 5 }, team[a.team] || a.team))); }
    const iso = !a.send && !a.receive;
    tb.append(h('tr', { class: iso ? 'iso' : '' },
      h('td', {}, h('b', {}, a.name), iso ? h('span', { class: 'badge' }, 'isolated') : '', h('div', { class: 'small muted' }, a.about)),
      h('td', {}, toggle(a.receive, v => B.setPolicy({ agents: { [a.name]: { receive: v } } }), '', 'Can read your hub')),
      h('td', {}, toggle(a.send, v => B.setPolicy({ agents: { [a.name]: { send: v } } }), '', 'Can send additions to your hub')),
      h('td', {}, h('button', { class: 'sm ghost', onclick: async () => { const v = await chooseDocs(`Hide sources from ${a.name}`, a.hide_docs || []); if (v) B.setPolicy({ agents: { [a.name]: { hide_docs: v } } }); } }, a.hide_docs?.length ? `🔒 ${a.hide_docs.length}` : '—')),
      h('td', { class: 'small' }, a.pending ? h('b', {}, `${a.pending} waiting · `) : '', ago(a.last))));
  }
  el.append(h('div', { class: 'tablewrap' }, h('table', { class: 'brtable' }, h('thead', {}, h('tr', {}, ['Agent', 'Reads hub', 'Sends', 'Hidden', 'Activity'].map(x => h('th', {}, x)))), tb)));
}
function fillInbox(el) {
  const inbox = B.s.inbox || [], p = P();
  el.append(h('h3', {}, `⇣ Incoming from agents (${inbox.length})`));
  if (!inbox.length) el.append(h('p', { class: 'small muted' }, 'No agent files waiting. Agents write research/hub-import-<agent>.json; delivered files move to research/bridge/delivered/.'));
  for (const e of inbox) {
    el.append(h('div', { class: 'inrow st-' + e.status },
      h('div', {}, h('span', { class: 'pill' }, e.status), ' ', h('b', {}, e.file), h('span', { class: 'muted small' }, ` from ${e.agent}`), h('div', { class: 'small' }, countsText(e.counts) || '…', e.reason ? h('span', { class: 'muted' }, ' — ' + e.reason) : '')),
      h('div', { class: 'acts' },
        h('button', { class: 'sm', onclick: () => viewFile(e) }, 'View'),
        ['held', 'waiting'].includes(e.status) ? h('button', { class: 'sm primary', disabled: !B.s.transport || !p.inbound, title: !B.s.transport ? 'Start transport first' : '', onclick: () => B.action('release', { file: e.file }) }, 'Deliver') : '',
        e.status !== 'delivering' && !e.pinned ? h('button', { class: 'sm', onclick: () => B.action('hold', { file: e.file }) }, 'Hold') : '',
        h('button', { class: 'sm danger', onclick: async () => { if (confirm(`Discard ${e.file}? Nothing from it enters the hub (the file is kept in research/bridge/discarded/).`)) B.action('discard', { file: e.file }); } }, 'Discard'))));
  }
  const pats = p.hold_files || []; const inp = h('input', { type: 'text', placeholder: 'e.g. hub-import-test*.json' });
  el.append(h('h4', {}, 'Always hold files matching'), h('div', { class: 'exrow' }, pats.map(x => h('span', { class: 'chip off' }, x, h('b', { class: 'x', onclick: () => B.setPolicy({ hold_files: pats.filter(y => y !== x) }) }, '✕'))),
    inp, h('button', { class: 'sm', onclick: () => inp.value.trim() && B.setPolicy({ hold_files: [...pats, inp.value.trim()] }) }, 'Add rule')));
}
async function viewFile(e) {
  let raw = null; try { raw = (await api('peek?file=' + encodeURIComponent(e.file))).content; } catch (x) { }
  const pre = h('pre', { class: 'raw', style: 'display:none' }, raw ? JSON.stringify(raw, null, 1).slice(0, 200000) : '(could not read the file)');
  await RH.modal(`${e.file} — from ${e.agent}`, h('div', {}, h('p', { class: 'small' }, `${e.status}${e.reason ? ' — ' + e.reason : ''}. Written by: ${(e.by || []).join(', ') || e.agent}.`),
    h('ul', { class: 'itemlist' }, (e.items || []).slice(0, 300).map(i => h('li', {}, i))), h('button', { class: 'sm', onclick: ev => { pre.style.display = pre.style.display ? '' : 'none'; ev.target.textContent = pre.style.display ? 'Show raw file' : 'Hide raw file'; } }, 'Show raw file'), pre), [['Close', () => null]]);
}
function fillLog(el) {
  const f = localStorage.getItem('rh.bridge.f') || '', fa = localStorage.getItem('rh.bridge.a') || '', v = verb();
  const fs = RH.select([['', 'All transport'], ['out', 'Hub → agents'], ['in', 'Agents → hub'], ['control', 'Controls & rules']], f); fs.onchange = () => { localStorage.setItem('rh.bridge.f', fs.value); fill(true); };
  const agents = [...new Set(B.log.map(e => e.agent).filter(Boolean))].sort();
  const as = RH.select([['', 'All agents'], ...agents.map(a => [a, a])], fa); as.onchange = () => { localStorage.setItem('rh.bridge.a', as.value); fill(true); };
  const vs = RH.select([['1', 'Detail: summary'], ['2', 'Detail: full description'], ['3', 'Detail: every item']], String(v)); vs.onchange = () => { localStorage.setItem('rh.bridge.v', vs.value); fill(true); };
  el.append(h('div', { class: 'secthead' }, h('h3', {}, '📜 Transport log'), h('div', { class: 'acts' }, fs, as, vs)),
    h('p', { class: 'small muted' }, 'Every crossing and every rule change, newest first. The full record is research/bridge/transport.log (also: python3 scripts/hub_bridge.py log -f).'));
  const list = h('div', { class: 'loglist scroll' }); el.append(list);
  const rows = B.log.filter(e => (!f || e.dir === f) && (!fa || e.agent === fa)).slice(-250).reverse();
  if (!rows.length) list.append(h('p', { class: 'small muted' }, 'Nothing yet.'));
  for (const e of rows) {
    list.append(h('div', { class: 'logrow d-' + e.dir },
      h('div', { class: 'lh' }, h('span', { class: 'lt' }, new Date(e.t).toLocaleTimeString()), h('span', { class: 'ld' }, { out: '⇡ hub → agents', in: '⇣ agents → hub', control: '⚙ control' }[e.dir] || e.dir), e.agent ? h('span', { class: 'badge' }, e.agent) : ''),
      h('div', { class: 'ls', html: detok(e.summary) }),
      v >= 2 && e.detail ? h('div', { class: 'ldt small', html: detok(e.detail) }) : '',
      v >= 3 && e.items?.length ? h('details', { class: 'small' }, h('summary', {}, `${e.items.length} item${e.items.length > 1 ? 's' : ''}`), h('ul', { class: 'itemlist' }, e.items.slice(0, 300).map(i => h('li', { html: detok(i) })))) : ''));
  }
}

/* ---------- hooks into existing pages ---------- */
const origDoc = V.doc;
V.doc = async function (main, r) {
  await origDoc(main, r);
  const d = S.docs.get(r.arg); if (!B.on || !d) return;
  const st = B.docState(d); const tb = main.querySelector('.toolbar'); if (!tb) return;
  const label = st.off ? '🔒 Off the bridge' : st.hiddenFrom.length ? `🔒 Hidden from ${st.hiddenFrom.length} agent${st.hiddenFrom.length > 1 ? 's' : ''}` : '🌉 On the bridge';
  tb.insertBefore(h('button', { class: st.off || st.hiddenFrom.length ? 'on' : '', title: st.off ? st.why : 'Who can see this source', onclick: () => docBridgeDialog(d) }, label), tb.children[1] || null);
};
async function docBridgeDialog(d) {
  const p = P(), x = p.exclude || {}; const st = B.docState(d);
  const mode = (x.docs || []).includes(d.id) ? 'off' : st.hiddenFrom?.length ? 'some' : 'on';
  const radios = [['on', '🌉 Share with the agents'], ['off', '🔒 Keep off the bridge entirely (never written for any agent)'], ['some', '🔒 Hide from specific agents only']];
  const box = h('div', { class: 'form' }); let cur = mode;
  const agents = (B.s.agents || []).filter(a => a.name !== 'conductor');
  const checks = h('div', { class: 'checklist' + (mode === 'some' ? '' : ' dim') }, agents.map(a => h('label', { class: 'chk' }, h('input', { type: 'checkbox', value: a.name, checked: (st.hiddenFrom || []).includes(a.name) }), ' ' + a.name)));
  for (const [k, lab] of radios) box.append(h('label', { class: 'chk' }, h('input', { type: 'radio', name: 'bm', value: k, checked: k === mode, onchange: () => { cur = k; checks.classList.toggle('dim', k !== 'some'); } }), ' ' + lab));
  box.append(checks);
  if (st.off && !(x.docs || []).includes(d.id)) box.append(h('p', { class: 'small muted' }, `Note: this source is already kept off because its ${st.why}.`));
  const ok = await RH.modal(`Bridge: “${d.title.slice(0, 60)}”`, box, [['Cancel', () => null], ['Save', () => true, 'primary']]);
  if (!ok) return;
  const docs = new Set(x.docs || []); cur === 'off' ? docs.add(d.id) : docs.delete(d.id);
  const chosen = new Set(cur === 'some' ? $$('input[type=checkbox]', checks).filter(i => i.checked).map(i => i.value) : []);
  const agentsPatch = {};
  for (const a of agents) { const hd = new Set(rule(p, a.name).hide_docs); const had = hd.has(d.id); chosen.has(a.name) ? hd.add(d.id) : hd.delete(d.id); if (had !== hd.has(d.id)) agentsPatch[a.name] = { hide_docs: [...hd] }; }
  await B.setPolicy({ exclude: { docs: [...docs] }, ...(Object.keys(agentsPatch).length ? { agents: agentsPatch } : {}) });
  toast(cur === 'off' ? 'Kept off the bridge — it will not be written for any agent' : cur === 'some' ? `Hidden from ${chosen.size} agent${chosen.size === 1 ? '' : 's'}` : 'Shared with the agents');
  RH.rerender();
}
const origArchive = V.archive;
V.archive = async function (main, r) {
  await origArchive(main, r); if (!B.on) return;
  for (const a of $$('a.docrow', main)) { const d = S.docs.get(a.getAttribute('href').replace('#/doc/', '')); if (!d) continue; const st = B.docState(d); if (st.off || st.hiddenFrom.length) a.querySelector('.dm b')?.prepend(h('span', { title: st.off ? st.why : 'hidden from ' + st.hiddenFrom.join(', ') }, '🔒 ')); }
};

})(window.RH);
