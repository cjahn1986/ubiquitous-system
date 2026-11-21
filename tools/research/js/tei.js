/* Research Hub — TEI/CTS parsing and original↔translation alignment. */
'use strict';
(function (RH) {

const SKIP = new Set(['note', 'bibl', 'del', 'teiHeader', 'figure', 'gap', 'ref', 'fw', 'pb', 'lb', 'cb', 'milestone', 'head']);

function local(el) { return el.localName || el.nodeName; }
function textOf(el) {
  let out = '';
  for (const n of el.childNodes) {
    if (n.nodeType === 3) out += n.nodeValue;
    else if (n.nodeType === 1) {
      const ln = local(n);
      if (SKIP.has(ln)) { if (ln === 'lb') out += ' '; continue; }
      const t = textOf(n);
      out += (ln === 'p' || ln === 'l' || ln === 'sp' || ln === 'div') ? '\n' + t + '\n' : t;
    }
  }
  return out;
}
const clean = s => s.replace(/[ \t\r]+/g, ' ').replace(/ *\n[\n ]*/g, '\n').trim();
const isPart = el => el.nodeType === 1 && local(el) === 'div' && (el.getAttribute('type') === 'textpart' || el.getAttribute('n') != null && el.getAttribute('type') !== 'edition' && el.getAttribute('type') !== 'translation');

/** Parse a CTS TEI XML string → {title, author, lang, levels, segments:[{ref, text}]} */
RH.parseTEI = function (xml) {
  const d = new DOMParser().parseFromString(xml, 'application/xml');
  if (d.getElementsByTagName('parsererror').length) throw new Error('Not valid XML');
  const g = (tag) => d.getElementsByTagNameNS('*', tag)[0];
  const title = clean(g('title')?.textContent || '');
  const author = clean(g('author')?.textContent || '');
  const body = g('body'); if (!body) throw new Error('No <body> in TEI');
  const top = [...body.children].find(e => local(e) === 'div') || body;
  const lang = top.getAttribute('xml:lang') || d.documentElement.getAttribute('xml:lang') || '';
  const levels = [...d.getElementsByTagNameNS('*', 'cRefPattern')].map(c => c.getAttribute('n')).reverse();
  const segs = [];
  function walk(el, path) {
    const kids = [...el.children].filter(isPart);
    if (kids.length) { for (const k of kids) walk(k, [...path, k.getAttribute('n') || '?']); return; }
    // leaf: verse lines become their own segments
    const lines = [...el.getElementsByTagNameNS('*', 'l')];
    if (lines.length > 3 && lines.filter(l => l.getAttribute('n')).length) {
      let last = 0;
      for (const l of lines) { const n = l.getAttribute('n'); const num = n || String(++last); if (n && /^\d+$/.test(n)) last = +n; const t = clean(textOf(l)); if (t) segs.push({ ref: [...path, num].join('.'), text: t }); }
      return;
    }
    const t = clean(textOf(el)); if (t) segs.push({ ref: path.join('.') || '1', text: t });
  }
  walk(top, []);
  return { title, author, lang, levels, segments: segs };
};

/** Align two segment lists. Returns rows [{ref, a:[seg], b:[seg]}] */
RH.alignSegments = function (A, B) {
  const depth = s => s.ref.split('.').length;
  const mode = arr => { const c = {}; arr.forEach(s => c[depth(s)] = (c[depth(s)] || 0) + 1); return +Object.entries(c).sort((x, y) => y[1] - x[1])[0]?.[0] || 1; };
  const merge = (arr, dep) => { // collapse deeper refs to a given depth
    const out = []; const m = new Map();
    for (const s of arr) { const r = s.ref.split('.').slice(0, dep).join('.'); let x = m.get(r); if (!x) { x = { ref: r, text: '', parts: [] }; m.set(r, x); out.push(x); } x.parts.push(s); x.text += (x.text ? ' ' : '') + s.text; }
    return out;
  };
  let a = A, b = B; const da = mode(A), db = mode(B);
  // exact match at the shallower common depth
  const dep = Math.min(da, db);
  const ma = da > dep ? merge(A, dep) : A, mb = db > dep ? merge(B, dep) : B;
  const bm = new Map(mb.map(s => [s.ref, s]));
  const exact = ma.filter(s => bm.has(s.ref)).length;
  if (exact >= 0.6 * Math.max(ma.length, mb.length)) {
    const rows = [], seen = new Set();
    for (const s of ma) { const t = bm.get(s.ref); rows.push({ ref: s.ref, a: [s], b: t ? [t] : [] }); if (t) seen.add(t.ref); }
    for (const t of mb) if (!seen.has(t.ref)) rows.push({ ref: t.ref, a: [], b: [t] });
    return { rows, method: `matched by citation (${dep === 1 ? 'top level' : 'level ' + dep})` };
  }
  // range alignment: same parent, numeric last component (e.g. Greek lines vs English "cards")
  const split = s => { const p = s.ref.split('.'); return { g: p.slice(0, -1).join('.'), n: parseInt(p[p.length - 1], 10) }; };
  const coarse = a.length <= b.length ? a : b, fine = coarse === a ? b : a;
  const byGroup = new Map();
  for (const s of fine) { const { g, n } = split(s); if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push({ n, s }); }
  const cg = new Map(); for (const s of coarse) { const { g } = split(s); if (!cg.has(g)) cg.set(g, []); cg.get(g).push(s); }
  const rows = [];
  let numeric = 0;
  for (const [g, list] of cg) {
    const f = byGroup.get(g) || [];
    list.forEach((s, i) => {
      const n0 = split(s).n, n1 = i + 1 < list.length ? split(list[i + 1]).n : Infinity;
      if (!isNaN(n0)) numeric++;
      const parts = f.filter(x => x.n >= n0 && x.n < n1).map(x => x.s);
      rows.push(coarse === a ? { ref: s.ref, a: [s], b: parts } : { ref: s.ref, a: parts, b: [s] });
    });
  }
  if (numeric > 0.6 * coarse.length) return { rows, method: 'matched by line/section ranges' };
  // last resort: proportional alignment
  const out = []; const r = fine.length / Math.max(1, coarse.length);
  coarse.forEach((s, i) => { const parts = fine.slice(Math.round(i * r), Math.round((i + 1) * r)); out.push(coarse === a ? { ref: s.ref, a: [s], b: parts } : { ref: s.ref, a: parts, b: [s] }); });
  return { rows: out, method: 'approximate (proportional) — citation schemes differ' };
};

/** Plain-text alignment for any two documents: by paragraph, or by line. */
RH.alignPlain = function (ta, tb) {
  const split = t => { const p = t.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean); return p.length > 1 ? p : t.split('\n').map(x => x.trim()).filter(Boolean); };
  const A = split(ta).map((t, i) => ({ ref: String(i + 1), text: t })), B = split(tb).map((t, i) => ({ ref: String(i + 1), text: t }));
  const n = Math.max(A.length, B.length), rows = [];
  for (let i = 0; i < n; i++) rows.push({ ref: String(i + 1), a: A[i] ? [A[i]] : [], b: B[i] ? [B[i]] : [] });
  return { rows, method: A.length === B.length ? 'paragraph by paragraph' : `paragraph by paragraph (counts differ: ${A.length} vs ${B.length})` };
};

})(window.RH);
