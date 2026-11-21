/* Research Hub — open web sources (keyless, CORS-friendly). Each adapter returns
   [{src, title, url, snippet, meta, importer?}] and fails soft. */
'use strict';
(function (RH) {
const { fetchJSON, fetchText } = RH;
const strip = s => String(s || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'");
const enc = encodeURIComponent;

const SOURCES = RH.WEB_SOURCES = {
  wikipedia: {
    name: 'Wikipedia', icon: '📚', about: 'Encyclopedia articles — the quickest map of a topic.',
    async search(q) {
      const j = await fetchJSON(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc(q)}&srlimit=8&format=json&origin=*`);
      return (j.query?.search || []).map(r => ({ title: r.title, url: 'https://en.wikipedia.org/wiki/' + enc(r.title.replace(/ /g, '_')), snippet: strip(r.snippet), meta: `${r.wordcount} words`,
        importer: () => RH.importWikipedia(r.title) }));
    }
  },
  wikidata: {
    name: 'Wikidata', icon: '🧬', about: 'Structured facts and identities — people, places, works, concepts.',
    async search(q) {
      const j = await fetchJSON(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${enc(q)}&language=en&limit=8&format=json&origin=*`);
      return (j.search || []).map(r => ({ title: r.label, url: r.concepturi, snippet: r.description || '', meta: r.id }));
    }
  },
  wiktionary: {
    name: 'Wiktionary', icon: '🔤', about: 'Words in every language — meanings and etymologies.',
    async search(q) {
      const j = await fetchJSON(`https://en.wiktionary.org/w/api.php?action=query&list=search&srsearch=${enc(q)}&srlimit=8&format=json&origin=*`);
      return (j.query?.search || []).map(r => ({ title: r.title, url: 'https://en.wiktionary.org/wiki/' + enc(r.title), snippet: strip(r.snippet), meta: 'dictionary', word: r.title }));
    }
  },
  openalex: {
    name: 'OpenAlex', icon: '🎓', about: 'Scholarly papers across every discipline (250M+ works).',
    async search(q) {
      const j = await fetchJSON(`https://api.openalex.org/works?search=${enc(q)}&per-page=8`);
      return (j.results || []).map(w => {
        let abs = ''; const ii = w.abstract_inverted_index;
        if (ii) { const pos = []; for (const [word, ps] of Object.entries(ii)) for (const p of ps) pos[p] = word; abs = pos.join(' '); }
        const authors = (w.authorships || []).slice(0, 3).map(a => a.author?.display_name).filter(Boolean).join(', ');
        const url = w.open_access?.oa_url || w.doi || w.id;
        return { title: w.display_name || '(untitled)', url, snippet: abs.slice(0, 400), meta: [authors, w.publication_year, w.primary_location?.source?.display_name, w.open_access?.is_oa ? 'open access' : ''].filter(Boolean).join(' · '),
          importer: () => ({ title: w.display_name, author: authors, date: String(w.publication_year || ''), kind: 'paper', source: url, text: [w.display_name, authors, abs].filter(Boolean).join('\n\n'), tags: ['openalex'] }) };
      });
    }
  },
  crossref: {
    name: 'Crossref', icon: '🔖', about: 'DOIs and bibliographic records for published works.',
    async search(q) {
      const j = await fetchJSON(`https://api.crossref.org/works?query=${enc(q)}&rows=8&select=DOI,title,author,issued,container-title,type`);
      return (j.message?.items || []).map(w => ({ title: (w.title || ['(untitled)'])[0], url: 'https://doi.org/' + w.DOI,
        snippet: (w['container-title'] || [])[0] || '', meta: [(w.author || []).slice(0, 3).map(a => [a.given, a.family].filter(Boolean).join(' ')).join(', '), w.issued?.['date-parts']?.[0]?.[0], w.type].filter(Boolean).join(' · ') }));
    }
  },
  archive: {
    name: 'Internet Archive', icon: '🏛️', about: 'Millions of public-domain books and scans — incl. early (public-domain) Loeb volumes. Full text importable.',
    async search(q) {
      const j = await fetchJSON(`https://archive.org/advancedsearch.php?q=${enc(q)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=date&fl[]=mediatype&fl[]=description&rows=10&output=json`);
      return (j.response?.docs || []).map(d => ({ title: [].concat(d.title || d.identifier)[0], url: 'https://archive.org/details/' + d.identifier,
        snippet: strip([].concat(d.description || '')[0]).slice(0, 300), meta: [[].concat(d.creator || [])[0], (d.date || '').slice(0, 4), d.mediatype].filter(Boolean).join(' · '),
        importer: d.mediatype === 'texts' ? () => RH.importArchiveItem(d.identifier) : null }));
    }
  },
  gutenberg: {
    name: 'Project Gutenberg', icon: '📖', about: '70,000+ free ebooks (via the Gutendex catalogue).',
    async search(q) {
      const j = await fetchJSON(`https://gutendex.com/books/?search=${enc(q)}`);
      return (j.results || []).slice(0, 8).map(b => ({ title: b.title, url: 'https://www.gutenberg.org/ebooks/' + b.id,
        snippet: (b.subjects || []).slice(0, 4).join('; '), meta: [(b.authors || []).map(a => a.name).join(', '), (b.languages || []).join(',')].filter(Boolean).join(' · ') }));
    }
  },
};
RH.webSearch = async function (q, which = Object.keys(SOURCES), onPartial) {
  const out = {};
  await Promise.all(which.map(async k => {
    try { out[k] = { ok: true, items: await SOURCES[k].search(q) }; }
    catch (e) { out[k] = { ok: false, err: String(e.message || e) }; }
    onPartial && onPartial(k, out[k]);
  }));
  return out;
};

/* ----- importers (return a doc draft) ----- */
RH.importWikipedia = async function (title) {
  const j = await fetchJSON(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=plain&titles=${enc(title)}&format=json&origin=*&redirects=1`);
  const p = Object.values(j.query?.pages || {})[0]; if (!p?.extract) throw new Error('No article text');
  return { title: p.title + ' (Wikipedia)', kind: 'web', source: 'https://en.wikipedia.org/wiki/' + enc(p.title.replace(/ /g, '_')), text: p.extract, tags: ['wikipedia'], date: new Date().toISOString().slice(0, 10) };
};
RH.importArchiveItem = async function (id) {
  const m = await fetchJSON(`https://archive.org/metadata/${enc(id)}`);
  const f = (m.files || []).find(x => /_djvu\.txt$/.test(x.name)) || (m.files || []).find(x => /\.txt$/.test(x.name));
  if (!f) throw new Error('No plain-text version in this item');
  const text = await fetchText(`https://archive.org/download/${enc(id)}/${enc(f.name)}`, 60000);
  const md = m.metadata || {};
  return { title: [].concat(md.title || id)[0], author: [].concat(md.creator || [])[0] || '', date: md.date || '', kind: 'book', source: 'https://archive.org/details/' + id, text, tags: ['internet-archive'] };
};
RH.importURLText = async function (url) { // works only where the site allows cross-origin reads
  const t = await fetchText(url); const d = new DOMParser().parseFromString(t, 'text/html');
  d.querySelectorAll('script,style,nav,header,footer,noscript').forEach(e => e.remove());
  return { title: d.title || url, kind: 'web', source: url, text: (d.body?.innerText || d.body?.textContent || '').replace(/\n{3,}/g, '\n\n'), tags: ['web'] };
};

/* ----- word lookups (for the translation matrix & etymology) ----- */
RH.LANGS = { grc: 'Ancient Greek', la: 'Latin', lat: 'Latin', en: 'English', he: 'Hebrew', hbo: 'Biblical Hebrew', arc: 'Aramaic', sa: 'Sanskrit', ar: 'Arabic', akk: 'Akkadian', egy: 'Egyptian',
  enm: 'Middle English', ang: 'Old English', fro: 'Old French', frm: 'Middle French', fr: 'French', 'gem-pro': 'Proto-Germanic', 'ine-pro': 'Proto-Indo-European', 'grk-pro': 'Proto-Hellenic', 'itc-pro': 'Proto-Italic',
  'cel-pro': 'Proto-Celtic', 'sem-pro': 'Proto-Semitic', 'iir-pro': 'Proto-Indo-Iranian', 'sla-pro': 'Proto-Slavic', 'gmw-pro': 'Proto-West Germanic', 'afa-pro': 'Proto-Afroasiatic',
  non: 'Old Norse', goh: 'Old High German', gmh: 'Middle High German', de: 'German', nl: 'Dutch', dum: 'Middle Dutch', odt: 'Old Dutch', got: 'Gothic', osx: 'Old Saxon', ofs: 'Old Frisian',
  it: 'Italian', es: 'Spanish', pt: 'Portuguese', ML: 'Medieval Latin', 'la-med': 'Medieval Latin', 'la-lat': 'Late Latin', 'la-new': 'New Latin', LL: 'Late Latin', 'la-vul': 'Vulgar Latin',
  el: 'Greek', gkm: 'Byzantine Greek', 'grc-koi': 'Koine Greek', sga: 'Old Irish', ga: 'Irish', cy: 'Welsh', fa: 'Persian', peo: 'Old Persian', ae: 'Avestan', pi: 'Pali', hi: 'Hindi',
  ru: 'Russian', cu: 'Old Church Slavonic', lt: 'Lithuanian', hy: 'Armenian', xcl: 'Old Armenian', sux: 'Sumerian', 'cop': 'Coptic', syc: 'Classical Syriac', uga: 'Ugaritic', phn: 'Phoenician', xto: 'Tocharian A', txb: 'Tocharian B', hit: 'Hittite',
  'roa-opt': 'Old Galician-Portuguese', osp: 'Old Spanish', 'xno': 'Anglo-Norman', ota: 'Ottoman Turkish', tr: 'Turkish', zh: 'Chinese', ja: 'Japanese' };
RH.langName = c => RH.LANGS[c] || c;
RH.langCode = name => Object.entries(RH.LANGS).find(([, v]) => v.toLowerCase() === String(name).toLowerCase())?.[0] || name;

RH.wiktWikitext = async function (page) {
  const j = await fetchJSON(`https://en.wiktionary.org/w/api.php?action=parse&page=${enc(page)}&prop=wikitext&format=json&origin=*&redirects=1`);
  if (j.error) throw new Error(j.error.info || 'not found');
  return { title: j.parse.title, text: j.parse.wikitext['*'] };
};
/* return the ==Language== section of a wikitext page */
RH.wiktSection = function (wt, langName) {
  const re = /^==([^=].*?)==\s*$/gm; let m, start = -1, end = wt.length;
  while ((m = re.exec(wt))) { if (start >= 0) { end = m.index; break; } if (m[1].trim() === langName) start = m.index; }
  return start < 0 ? '' : wt.slice(start, end);
};
RH.cleanWikitext = function (s) {
  const ANC = new Set(['inh', 'inh+', 'der', 'der+', 'bor', 'bor+', 'lbor', 'ubor', 'uder', 'calque', 'slbor', 'learned borrowing', 'inherited', 'derived', 'borrowed']);
  const COG = new Set(['cog', 'ncog', 'noncog', 'cognate']);
  const LINK = new Set(['m', 'l', 'mention', 'link', 'm+', 'l-self', 'll']);
  let t = String(s), prev;
  do {
    prev = t;
    t = t.replace(/\{\{([^{}]*)\}\}/g, (all, inner) => {
      const raw = inner.split('|'); const parts = raw.filter(p => !/^[a-z0-9]+=/.test(p)); const name = parts[0].trim();
      const named = Object.fromEntries(raw.filter(p => /^[a-z0-9]+=/.test(p)).map(p => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]));
      const g = named.t || named.gloss || parts[4] || ''; const gloss = g ? ` (“${g}”)` : '';
      if (ANC.has(name)) return `${RH.langName(parts[2])} ${parts[3] || ''}${gloss}`.trim();
      if (COG.has(name)) return `${RH.langName(parts[1])} ${parts[2] || ''}${named.t ? ` (“${named.t}”)` : ''}`.trim();
      if (LINK.has(name)) return `${parts[2] || ''}${named.t ? ` (“${named.t}”)` : ''}`;
      if (name === 'gloss') return `“${parts[1] || ''}”`;
      if (name === 'w') return parts[1] || '';
      return '';
    });
  } while (t !== prev);
  return t.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/'{2,}/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/\(\s*\)/g, '').trim();
};

/* definitions for a word in a language from Wiktionary */
RH.wiktDefine = async function (word, langName) {
  const p = await RH.wiktWikitext(word); const sec = RH.wiktSection(p.text, langName);
  if (!sec) return { title: p.title, defs: [], formOf: [] };
  const defs = [], formOf = [];
  for (const line of sec.split('\n')) {
    if (/^#\s/.test(line)) {
      const f = line.match(/\{\{(?:inflection of|infl of|form of|[a-z ]+ of)\|[^|]*\|([^|}]+)/);
      if (f) formOf.push(f[1]);
      const c = RH.cleanWikitext(line.replace(/^#\s*/, '')); if (c) defs.push(c);
    }
  }
  return { title: p.title, defs: defs.slice(0, 8), formOf: [...new Set(formOf)] };
};

/* morphology via Alpheios (Morpheus for Greek, Whitaker's Words for Latin) */
RH.morph = async function (word, lang) {
  const engine = lang === 'grc' ? 'morpheusgrc' : 'whitakerLat';
  const j = await fetchJSON(`https://morph.alpheios.net/api/v1/analysis/word?word=${enc(word)}&lang=${lang === 'grc' ? 'grc' : 'lat'}&engine=${engine}`, {}, 12000);
  let bodies = j?.RDF?.Annotation?.Body; if (!bodies) return [];
  bodies = [].concat(bodies);
  const v = x => x == null ? '' : typeof x === 'string' ? x : x.$ || '';
  const out = [];
  for (const b of bodies) {
    const e = b?.rest?.entry; if (!e) continue;
    const dict = e.dict || {}; const hd = dict.hdwd ? v(dict.hdwd) : '';
    const means = [].concat(e.mean || []).map(v).filter(Boolean);
    const infl = [].concat(e.infl || []).map(i => [v(i.pofs), v(i.case), v(i.num), v(i.gend), v(i.pers), v(i.tense), v(i.mood), v(i.voice)].filter(Boolean).join(' '));
    out.push({ lemma: hd, pos: v(dict.pofs), mean: means.join('; '), infl: [...new Set(infl)].slice(0, 4) });
  }
  return out;
};
RH.dictLinks = (word, lang) => {
  const w = enc(word);
  const L = [['Wiktionary', `https://en.wiktionary.org/wiki/${w}`], ['Logeion', `https://logeion.uchicago.edu/${w}`]];
  if (lang === 'grc') L.push(['Perseus (LSJ)', `https://www.perseus.tufts.edu/hopper/morph?l=${w}&la=greek`]);
  if (lang === 'la') L.push(['Perseus (Lewis & Short)', `https://www.perseus.tufts.edu/hopper/morph?l=${w}&la=la`]);
  if (lang === 'he') L.push(['Sefaria', `https://www.sefaria.org/search?q=${w}`]);
  return L;
};

})(window.RH);
