/* Research Hub — core: namespace, storage (IndexedDB), state, text normalisation, search index.
   Classic script (no modules) so the hub also opens straight from a file. */
'use strict';
window.RH = window.RH || {};
(function (RH) {

/* ---------- small utilities ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (p = 'x') => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const now = () => new Date().toISOString();
const debounce = (f, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}
function toast(msg, ms = 2600) {
  const t = h('div', { class: 'toast' }, msg); document.body.append(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}
function download(name, text, type = 'application/json') {
  const u = URL.createObjectURL(new Blob([text], { type })); const a = h('a', { href: u, download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000);
}
async function fetchJSON(url, opt = {}, ms = 15000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { ...opt, signal: c.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
async function fetchText(url, ms = 30000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); }
  finally { clearTimeout(t); }
}
Object.assign(RH, { $, $$, esc, uid, now, debounce, h, toast, download, fetchJSON, fetchText });

/* ---------- vocabularies ---------- */
RH.ERAS = [
  ['deep', 'Deep past / prehistory'], ['ancient', 'Ancient'], ['classical', 'Classical'],
  ['late-antique', 'Late antique'], ['medieval', 'Medieval'], ['early-modern', 'Early modern'],
  ['modern', 'Modern'], ['contemporary', 'Contemporary'], ['timeless', 'Timeless / cross-era']];
RH.ERA_ORDER = Object.fromEntries(RH.ERAS.map(([k], i) => [k, i]));
RH.isOld = e => ['deep', 'ancient', 'classical', 'late-antique', 'medieval'].includes(e);
RH.isNew = e => ['early-modern', 'modern', 'contemporary'].includes(e);
RH.NODE_TYPES = {
  concept: ['Concept', '#6b93ff'], person: ['Person', '#e0884a'], place: ['Place', '#3ac08a'],
  text: ['Text / source', '#b77cf0'], word: ['Word / root', '#e6c34a'], event: ['Event', '#ef6b7b'],
  symbol: ['Symbol / motif', '#4ac6d6'], data: ['Data point', '#9aa3b2'], question: ['Open question', '#ff9f43']};
RH.STEP_KINDS = {
  question: ['❓', 'Question'], source: ['📄', 'Source'], finding: ['🔎', 'Finding'],
  hypothesis: ['💡', 'Hypothesis'], connection: ['🔗', 'Connection'], data: ['📊', 'Data'],
  conclusion: ['✅', 'Conclusion'], note: ['📝', 'Note']};

/* ---------- storage ---------- */
const DB_NAME = 'research-hub', DB_VER = 1;
const STORES = ['docs', 'files', 'nodes', 'links', 'trails', 'data', 'etym', 'meta'];
let dbp = null;
function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (!('indexedDB' in window)) return rej(new Error('IndexedDB unavailable'));
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => { for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: s === 'etym' ? 'key' : 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode), s = t.objectStore(store); let out;
    Promise.resolve(fn(s)).then(v => { out = v; });
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
RH.db = {
  all: store => tx(store, 'readonly', s => req(s.getAll())),
  get: (store, id) => tx(store, 'readonly', s => req(s.get(id))),
  put: (store, obj) => tx(store, 'readwrite', s => { s.put(obj); }),
  putMany: (store, arr) => tx(store, 'readwrite', s => { for (const o of arr) s.put(o); }),
  del: (store, id) => tx(store, 'readwrite', s => { s.delete(id); }),
  clear: store => tx(store, 'readwrite', s => { s.clear(); }),
};
// Memory fallback if IndexedDB is blocked (private windows etc.) — the hub still works for the session.
let memOnly = false;
RH.persistOK = () => !memOnly;

/* ---------- state ---------- */
const S = RH.S = { docs: new Map(), nodes: new Map(), links: new Map(), trails: new Map(), data: new Map(), etym: new Map(), meta: {} };
const listeners = {};
RH.on = (ev, f) => (listeners[ev] = listeners[ev] || []).push(f);
RH.emit = (ev, d) => (listeners[ev] || []).forEach(f => { try { f(d); } catch (e) { console.error(e); } });

async function save(store, obj) {
  obj.updated = now();
  S[store].set(obj[store === 'etym' ? 'key' : 'id'], obj);
  if (!memOnly) { try { await RH.db.put(store, obj); } catch (e) { console.warn(e); memOnly = true; toast('Browser storage unavailable — working in memory for this session. Export to keep your work.', 6000); } }
  RH.emit('change', { store, obj });
  if (store === 'docs') { RH.index.dirty = true; RH.index.ver++; }
  return obj;
}
async function remove(store, id) {
  S[store].delete(id);
  if (!memOnly) try { await RH.db.del(store, id); if (store === 'docs') await RH.db.del('files', id); } catch (e) { console.warn(e); }
  RH.emit('change', { store, id, removed: true });
  if (store === 'docs') { RH.index.dirty = true; RH.index.ver++; }
}
RH.save = save; RH.remove = remove;
RH.saveFile = async (id, blob) => { if (!memOnly) try { await RH.db.put('files', { id, blob }); } catch (e) { console.warn(e); } };
RH.getFile = async id => { try { return (await RH.db.get('files', id))?.blob; } catch (e) { return null; } };
RH.setMeta = async (k, v) => { S.meta[k] = v; if (!memOnly) try { await RH.db.put('meta', { id: k, v }); } catch (e) { } RH.emit('meta', k); };

RH.load = async function () {
  try {
    await openDB();
    for (const s of ['docs', 'nodes', 'links', 'trails', 'data', 'etym']) for (const o of await RH.db.all(s)) S[s].set(o[s === 'etym' ? 'key' : 'id'], o);
    for (const m of await RH.db.all('meta')) S.meta[m.id] = m.v;
  } catch (e) { console.warn(e); memOnly = true; }
};

/* ---------- active research trail (continuity) ---------- */
RH.activeTrail = () => S.trails.get(S.meta.activeTrail);
RH.logStep = async function (kind, text, refs = [], extra = {}) {
  const t = RH.activeTrail(); if (!t) return null;
  const step = { id: uid('st'), kind, text, refs, time: now(), ...extra };
  t.steps.push(step); await save('trails', t); toast(`Added to trail “${t.title}”`);
  return step;
};
/* A ref is {t: 'doc'|'node'|'data'|'chunk'|'url', id, label?, anchor?} */
RH.refLabel = r => {
  if (r.t === 'doc') return S.docs.get(r.id)?.title || r.label || 'document';
  if (r.t === 'node') return S.nodes.get(r.id)?.label || r.label || 'node';
  if (r.t === 'data') { const d = S.data.get(r.id); return d ? `${d.series}: ${d.value}${d.unit ? ' ' + d.unit : ''}` : r.label || 'data'; }
  return r.label || r.id;
};

/* ---------- text normalisation (Greek, Latin, Hebrew, any script) ---------- */
const STOP = new Set(('a an and are as at be been but by for from had has have he her his i if in into is it its of on or our she so than that the their them then there these they this to was we were what when which who will with you your not no nor do does did can could would should may might must shall upon also such only other more most some any all one two three ' +
  'et in est non ad cum quod qui quae ut sed si de ex a ab per ne nec aut atque ac enim autem esse sunt sit erat iam tamen ' +
  'και δε το τον την του των τη τω τοις ταις ο η οι αι εν εις μεν γαρ ουκ ου ως επι προς δ τ γ κ τε αν εκ περι ουδε αλλα αλλ μη').split(' '));
RH.fold = s => String(s || '').normalize('NFD').replace(/[̀-֑ͯ-ׇ]/g, '').replace(/ς/g, 'σ').toLowerCase()
  .replace(/[ϐ]/g, 'β').replace(/[ϑ]/g, 'θ').replace(/ſ/g, 's').replace(/æ/g, 'ae').replace(/œ/g, 'oe');
RH.tokens = s => (RH.fold(s).match(/[\p{L}\p{N}]+/gu) || []);
RH.terms = s => RH.tokens(s).filter(t => t.length > 1 && !STOP.has(t));
RH.scriptOf = s => /[Ͱ-Ͽἀ-῿]/.test(s) ? 'grc' : /[֐-׿]/.test(s) ? 'he' : /[؀-ۿ]/.test(s) ? 'ar' : /[ऀ-ॿ]/.test(s) ? 'sa' : 'latn';

/* ---------- chunking ---------- */
function chunkText(text, max = 700) {
  const paras = String(text || '').split(/\n\s*\n|\r\n\r\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = []; let cur = '';
  for (const p of paras) {
    if (p.length > max * 1.6) { // split long paragraph on sentence boundaries
      if (cur) { out.push(cur); cur = ''; }
      let buf = '';
      for (const s of p.split(/(?<=[.;·!?])\s+/)) { if ((buf + ' ' + s).length > max && buf) { out.push(buf); buf = s; } else buf = buf ? buf + ' ' + s : s; }
      if (buf) out.push(buf);
    } else if ((cur + '\n' + p).length > max && cur) { out.push(cur); cur = p; }
    else cur = cur ? cur + '\n' + p : p;
  }
  if (cur) out.push(cur);
  return out;
}
RH.chunksOf = function (doc) {
  if (doc.segments?.length) return doc.segments.map((s, i) => ({ doc: doc.id, i, ref: s.ref, text: s.text }));
  if (doc.pages?.length) { const o = []; doc.pages.forEach((p, pi) => chunkText(p).forEach(t => o.push({ doc: doc.id, i: o.length, ref: 'p. ' + (pi + 1), page: pi + 1, text: t }))); return o; }
  return chunkText(doc.text).map((t, i) => ({ doc: doc.id, i, ref: '¶' + (i + 1), text: t }));
};
RH.docText = doc => doc.segments?.length ? doc.segments.map(s => s.text).join('\n\n') : doc.pages?.length ? doc.pages.join('\n\n') : (doc.text || '');

/* ---------- search index (BM25 over passages) ---------- */
const IX = RH.index = {
  dirty: true, chunks: [], post: new Map(), len: [], avg: 1, df: new Map(), docTerms: new Map(), building: null,
  ver: 0,
  async build(force) {
    if (this.building) { await this.building; return this.dirty ? this.build() : undefined; }
    if (!this.dirty && !force) return;
    const startVer = this.ver;
    const run = async () => {
      const chunks = [], post = new Map(), len = [], docTerms = new Map();
      let n = 0;
      for (const doc of S.docs.values()) {
        const dt = new Map();
        for (const c of RH.chunksOf(doc)) {
          const id = chunks.length; chunks.push(c);
          const ts = RH.terms(c.text); len.push(ts.length);
          const tf = new Map(); for (const t of ts) tf.set(t, (tf.get(t) || 0) + 1);
          for (const [t, f] of tf) { let p = post.get(t); if (!p) post.set(t, p = []); p.push(id, f); dt.set(t, (dt.get(t) || 0) + f); }
        }
        docTerms.set(doc.id, dt);
        if (++n % 25 === 0) await new Promise(r => setTimeout(r));
      }
      const df = new Map(); for (const dt of docTerms.values()) for (const t of dt.keys()) df.set(t, (df.get(t) || 0) + 1);
      Object.assign(this, { chunks, post, len, avg: len.reduce((a, b) => a + b, 0) / Math.max(1, len.length), docTerms, df, dirty: this.ver !== startVer });
      RH.emit('indexed');
    };
    this.building = run().finally(() => { this.building = null; });
    return this.building;
  },
  idf(t) { const N = this.chunks.length, n = (this.post.get(t)?.length || 0) / 2; return Math.log(1 + (N - n + 0.5) / (n + 0.5)); },
  /* query: free text; supports "quoted phrases", -exclude, prefix* ; opts: {exclude: docId, filter: chunk=>bool, limit} */
  search(q, opts = {}) {
    const phrases = [...String(q).matchAll(/"([^"]+)"/g)].map(m => RH.fold(m[1]).replace(/\s+/g, ' ').trim());
    const rest = String(q).replace(/"[^"]*"/g, ' ');
    const neg = [...rest.matchAll(/(?:^|\s)-([\p{L}\p{N}]+)/gu)].map(m => RH.fold(m[1]));
    const posRaw = rest.replace(/(?:^|\s)-[\p{L}\p{N}]+/gu, ' ');
    let terms = [...RH.terms(posRaw), ...phrases.flatMap(p => RH.terms(p))];
    const prefixes = [...posRaw.matchAll(/([\p{L}\p{N}]+)\*/gu)].map(m => RH.fold(m[1]));
    for (const p of prefixes) for (const t of this.post.keys()) if (t.startsWith(p) && t !== p) terms.push(t);
    terms = [...new Set(terms)];
    if (!terms.length) return [];
    const k1 = 1.4, b = 0.75, score = new Map(), hits = new Map();
    for (const t of terms) {
      const p = this.post.get(t); if (!p) continue; const idf = this.idf(t);
      for (let i = 0; i < p.length; i += 2) {
        const c = p[i], f = p[i + 1];
        score.set(c, (score.get(c) || 0) + idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * this.len[c] / this.avg)));
        hits.set(c, (hits.get(c) || 0) + 1);
      }
    }
    let res = [...score].map(([c, s]) => ({ c, s: s * (1 + 0.5 * ((hits.get(c) - 1) / Math.max(1, terms.length))), chunk: this.chunks[c] }));
    if (phrases.length || neg.length) res = res.filter(r => { const f = RH.fold(r.chunk.text).replace(/\s+/g, ' '); return phrases.every(p => f.includes(p)) && !neg.some(n => RH.terms(f).includes(n)); });
    if (opts.exclude) res = res.filter(r => r.chunk.doc !== opts.exclude);
    if (opts.filter) res = res.filter(r => opts.filter(r.chunk));
    res.sort((a, b) => b.s - a.s);
    return res.slice(0, opts.limit || 60).map(r => ({ ...r, terms }));
  },
  /* distinctive terms of a text, by tf·idf against the archive */
  keyTerms(text, n = 12) {
    const tf = new Map(); for (const t of RH.terms(text)) if (t.length > 2) tf.set(t, (tf.get(t) || 0) + 1);
    return [...tf].map(([t, f]) => [t, f * this.idf(t)]).sort((a, b) => b[1] - a[1]).slice(0, n).map(x => x[0]);
  },
  /* doc ↔ doc similarity on tf-idf vectors (top terms) */
  docVector(id, top = 250) {
    const dt = this.docTerms.get(id); if (!dt) return new Map(); const N = Math.max(1, S.docs.size);
    return new Map([...dt].map(([t, f]) => [t, (1 + Math.log(f)) * Math.log(1 + N / (this.df.get(t) || 1))]).sort((a, b) => b[1] - a[1]).slice(0, top));
  },
  related(id, n = 10) {
    const a = this.docVector(id); const na = Math.hypot(...a.values()) || 1; const out = [];
    for (const other of S.docs.keys()) {
      if (other === id) continue; const bv = this.docVector(other); let dot = 0; const shared = [];
      for (const [t, w] of a) { const w2 = bv.get(t); if (w2) { dot += w * w2; shared.push([t, w * w2]); } }
      if (!dot) continue; const nb = Math.hypot(...bv.values()) || 1;
      out.push({ id: other, sim: dot / (na * nb), shared: shared.sort((x, y) => y[1] - x[1]).slice(0, 8).map(x => x[0]) });
    }
    return out.sort((x, y) => y.sim - x.sim).slice(0, n);
  },
  /* how many passages mention a label (as phrase), and which */
  mentions(label, limit = 400) {
    const ts = RH.terms(label); if (!ts.length) return [];
    let cand = null;
    for (const t of ts) { const p = this.post.get(t); if (!p) return []; const set = new Set(); for (let i = 0; i < p.length; i += 2) set.add(p[i]); cand = cand ? new Set([...cand].filter(x => set.has(x))) : set; }
    const phrase = ts.join(' '), out = [];
    for (const c of cand) { if (ts.length === 1 || RH.terms(this.chunks[c].text).join(' ').includes(phrase)) out.push(c); if (out.length >= limit) break; }
    return out;
  }
};

/* highlight query terms in a snippet */
RH.snippet = function (text, terms, len = 260) {
  const t = String(text); const f = RH.fold(t);
  let at = -1; for (const term of terms || []) { const i = f.indexOf(term); if (i >= 0 && (at < 0 || i < at)) at = i; }
  let start = Math.max(0, (at < 0 ? 0 : at) - 80); let s = t.slice(start, start + len);
  let html = esc(s); if (terms?.length) {
    // highlight by folding each word
    html = s.split(/([\p{L}\p{N}]+)/u).map(w => /[\p{L}\p{N}]/u.test(w) && terms.includes(RH.fold(w)) ? `<mark>${esc(w)}</mark>` : esc(w)).join('');
  }
  return (start > 0 ? '… ' : '') + html + (start + len < t.length ? ' …' : '');
};

})(window.RH);
