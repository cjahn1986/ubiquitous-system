/* Research Hub — etymology: Wiktionary parsing, local/offline engine store, lineage building. */
'use strict';
(function (RH) {
const { S } = RH;

const REL = {
  inh: 'inherited from', 'inh+': 'inherited from', der: 'derived from', 'der+': 'derived from', uder: 'derived from', bor: 'borrowed from', 'bor+': 'borrowed from',
  lbor: 'learned borrowing from', slbor: 'semi-learned borrowing from', ubor: 'borrowed from', calque: 'calque of', cog: 'cognate', ncog: 'cognate', noncog: 'compare', root: 'root', af: 'parts', affix: 'parts',
  compound: 'parts', prefix: 'parts', suffix: 'parts', confix: 'parts', surf: 'parts', blend: 'blend of', clipping: 'clipping of', back: 'back-formation from', doublet: 'doublet of'
};
const ANCESTRAL = new Set(['inherited from', 'derived from', 'borrowed from', 'learned borrowing from', 'semi-learned borrowing from', 'calque of', 'back-formation from', 'clipping of', 'blend of']);
RH.ETYM_ANCESTRAL = ANCESTRAL;
RH.etymKey = (lang, word) => `${lang}:${String(word).replace(/^\*/, '*')}`;

/** Parse one language section's Etymology subsections. Returns [{text, rels:[{type, lang, word, gloss}]}] */
RH.parseEtymSection = function (sec, langCode) {
  const out = [];
  const re = /^===+\s*Etymology(?:\s*\d+)?\s*===+\s*$/gm; let m; const idx = [];
  while ((m = re.exec(sec))) idx.push(m.index + m[0].length);
  for (const start of idx) {
    const rest = sec.slice(start); const stop = rest.search(/^===/m); const body = stop < 0 ? rest : rest.slice(0, stop);
    const rels = [];
    for (const t of body.matchAll(/\{\{([^{}]*)\}\}/g)) {
      const raw = t[1].split('|'); const parts = raw.filter(p => !/^[a-z0-9]+=/.test(p)); const name = parts[0].trim();
      const named = Object.fromEntries(raw.filter(p => /^[a-z0-9]+=/.test(p)).map(p => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]));
      const type = REL[name]; if (!type) continue;
      if (type === 'parts') { const lang = parts[1]; parts.slice(2).filter(Boolean).forEach(w => rels.push({ type, lang, word: w })); continue; }
      if (type === 'cognate' || type === 'compare') { if (parts[2]) rels.push({ type, lang: parts[1], word: parts[2], gloss: named.t || '' }); continue; }
      if (type === 'root') { parts.slice(3).filter(Boolean).forEach(w => rels.push({ type, lang: parts[2], word: w })); continue; }
      if (type === 'doublet') { if (parts[2]) rels.push({ type, lang: parts[1], word: parts[2] }); continue; }
      if (parts[2] && parts[3]) rels.push({ type, lang: parts[2], word: parts[3], gloss: named.t || named.gloss || parts[4] || '' });
      else if (parts[2]) rels.push({ type, lang: parts[2], word: '', gloss: '' }); // language only ("from Latin")
    }
    out.push({ text: RH.cleanWikitext(body.replace(/\n+/g, ' ')), rels });
  }
  return out;
};

/** Look up one word: local store (offline engine / cache) first, then Wiktionary. */
RH.etymLookup = async function (word, lang = 'en', { online = true } = {}) {
  const key = RH.etymKey(lang, word);
  const local = S.etym.get(key);
  if (local && (local.src !== 'wiktionary' || !online || local.etyms?.length)) return local;
  if (!online) return local || null;
  const name = RH.langName(lang);
  let page = word;
  if (word.startsWith('*')) page = `Reconstruction:${name}/${word.slice(1)}`;
  const p = await RH.wiktWikitext(page);
  let sec = RH.wiktSection(p.text, name);
  if (!sec && word.startsWith('*')) sec = p.text; // reconstruction pages hold one language
  if (!sec) throw new Error(`Wiktionary has no ${name} entry for “${word}”`);
  const etyms = RH.parseEtymSection(sec, lang);
  const defs = sec.split('\n').filter(l => /^#\s/.test(l)).slice(0, 4).map(l => RH.cleanWikitext(l.replace(/^#\s*/, ''))).filter(Boolean);
  const entry = { key, word, lang, etyms, defs, src: 'wiktionary', fetched: RH.now() };
  await RH.save('etym', entry);
  return entry;
};

/** Build a lineage: follow the first ancestral relation of each step. */
RH.etymLineage = async function (word, lang, depth = 8, onStep) {
  const chain = []; const seen = new Set(); let cur = { word, lang, type: 'start' };
  for (let i = 0; i < depth && cur; i++) {
    const k = RH.etymKey(cur.lang, cur.word); if (seen.has(k)) break; seen.add(k);
    let e = null; try { e = cur.word ? await RH.etymLookup(cur.word, cur.lang) : null; } catch (x) { e = null; }
    const step = { ...cur, entry: e }; chain.push(step); onStep && onStep(chain);
    const rels = e?.etyms?.[0]?.rels || [];
    const anc = rels.filter(r => ANCESTRAL.has(r.type));
    // the first ancestor with a word, after skipping the item itself
    const next = anc.find(r => r.word && RH.etymKey(r.lang, r.word) !== k);
    if (!next) break;
    // intermediate ancestors listed in the same sentence ("from ME x, from OE y") → take them in order, then continue from the last
    const ordered = anc.filter(r => r.word);
    if (ordered.length > 1) {
      for (const r of ordered.slice(0, -1)) { const kk = RH.etymKey(r.lang, r.word); if (!seen.has(kk)) { seen.add(kk); chain.push({ ...r, entry: S.etym.get(kk) || null, inline: true }); } }
      onStep && onStep(chain);
      cur = ordered[ordered.length - 1];
    } else cur = next;
  }
  return chain;
};

/* ---------- offline engine import ---------- */
/* Accepts:
   1) JSON array (or {entries:[…]}) of {word|term, lang|language, etymology|text?, relations|rels|ancestors?: [{type, lang, word}|"word"]}
   2) etymology-db CSV (Wiktionary-derived): term_id,lang,term,reltype,related_term_id,related_lang,related_term,...
   Languages may be names or codes. Returns count imported. */
RH.importEtymData = async function (text, { langs } = {}) {
  const want = langs?.length ? new Set(langs.map(l => RH.langCode(l))) : null;
  const entries = new Map();
  const ent = (lang, word) => { const k = RH.etymKey(lang, word); let e = entries.get(k) || S.etym.get(k); if (!e || e.src === 'wiktionary') e = { key: k, word, lang, etyms: [{ text: '', rels: [] }], defs: [], src: 'engine' }; entries.set(k, e); return e; };
  const trimmed = text.trimStart();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let j = JSON.parse(text); if (!Array.isArray(j)) j = j.entries || j.words || Object.values(j);
    for (const r of j) {
      const word = r.word || r.term || r.lemma; const lang = RH.langCode(r.lang || r.language || 'en'); if (!word) continue;
      if (want && !want.has(lang)) continue;
      const e = ent(lang, word); const et = e.etyms[0];
      if (r.etymology || r.text) et.text = r.etymology || r.text;
      if (r.definition || r.defs) e.defs = [].concat(r.definition || r.defs);
      for (const x of [].concat(r.relations || r.rels || r.ancestors || [])) {
        if (typeof x === 'string') et.rels.push({ type: 'derived from', lang: '', word: x });
        else et.rels.push({ type: x.type || x.reltype || 'derived from', lang: RH.langCode(x.lang || x.language || ''), word: x.word || x.term || '', gloss: x.gloss || '' });
      }
    }
  } else {
    const lines = text.split(/\r?\n/); const hdr = lines[0].split(',').map(s => s.trim());
    const col = n => hdr.indexOf(n);
    const [cl, ct, cr, crl, crt] = ['lang', 'term', 'reltype', 'related_lang', 'related_term'].map(col);
    if (ct < 0 || cr < 0) throw new Error('Unrecognised CSV: expected etymology-db columns (lang, term, reltype, related_lang, related_term)');
    const map = { inherited_from: 'inherited from', derived_from: 'derived from', borrowed_from: 'borrowed from', learned_borrowing_from: 'learned borrowing from', semi_learned_borrowing_from: 'semi-learned borrowing from',
      calque_of: 'calque of', cognate_of: 'cognate', has_root: 'root', has_affix: 'parts', has_prefix: 'parts', has_suffix: 'parts', compound_of: 'parts', has_confix: 'parts', doublet_with: 'doublet of', back_formation_from: 'back-formation from', clipping_of: 'clipping of', blend_of: 'blend of', etymologically_related_to: 'compare' };
    const parse = line => { const out = []; let cur = '', q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]) continue; const f = parse(lines[i]);
      const lang = RH.langCode(f[cl]); if (want && !want.has(lang)) continue;
      const e = ent(lang, f[ct]); e.etyms[0].rels.push({ type: map[f[cr]] || f[cr].replace(/_/g, ' '), lang: RH.langCode(f[crl]), word: f[crt] });
      if (i % 50000 === 0) await new Promise(r => setTimeout(r));
    }
  }
  const arr = [...entries.values()];
  for (const e of arr) S.etym.set(e.key, e);
  try { await RH.db.putMany('etym', arr); } catch (x) { console.warn(x); }
  RH.emit('change', { store: 'etym' });
  return arr.length;
};
RH.etymStats = () => { let engine = 0, cache = 0; for (const e of S.etym.values()) e.src === 'engine' ? engine++ : cache++; return { engine, cache }; };

})(window.RH);
