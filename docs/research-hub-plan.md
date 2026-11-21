# Research Hub — game plan

**Purpose (in the user's words):** connect modern subjects with ancient subjects across many
disciplines and find what exists *between* them — to fill in the gaps of what I don't know, or
think I know but don't yet understand.

**Approach:** grow it inside Ubiquitous System, keeping its ethos — offline-first browser app,
open data, no keys, your data stays in your browser, speculation labeled as speculation.

## The pieces

| # | Piece | Where | What it does |
|---|---|---|---|
| 1 | **Archive** | `tools/research/` | Store PDFs, text, web pages, notes, classical texts. Tags, collections, era, discipline. Files kept in your browser (IndexedDB). |
| 2 | **Search + cross-reference** | `tools/research/` | Full-text, accent-insensitive search across the whole archive at passage level; "what else in my archive talks about this passage?"; shared distinctive terms between documents. |
| 3 | **Web cross-reference** | `tools/research/` | Send a term or passage to Wikipedia, Wiktionary, OpenAlex, Crossref, Internet Archive; save hits into the archive or onto the map. |
| 4 | **Classics library** | `tools/research/` + `data/` | Browsable catalogue of the open Perseus + First1KGreek corpora (Greek, Latin, with English where it exists); load any work into the archive. |
| 5 | **Translation matrix** | `tools/research/` | Original and English side-by-side, aligned section by section; click any word for morphology, lemma, gloss and dictionary links; interlinear table for a line. Works for any two archive docs, too. |
| 6 | **Etymology** | `tools/research/` | Word ancestry trees from Wiktionary (inherited / derived / borrowed / cognates), expandable; **import slot for the Offline Etymology Engine** (checked first, works offline). |
| 7 | **Mind map** | `tools/research/` | Nodes (concepts, people, places, words, texts, events, data points) and labeled links, tagged by era; **gap finder** (missing links, unmapped concepts in your archive, ancient↔modern bridges). |
| 8 | **Data tracker** | `tools/research/` | Data points with value, date, unit and source; timeline; export to Pattern Tracker. |
| 9 | **Research trail** | `tools/research/` | Each investigation is a linear timeline (question → source → finding → hypothesis → conclusion) whose steps link out to any doc, node or data point; open threads surfaced. |
| 10 | **Agents** | `.claude/agents/` | One specialist per piece, coordinated by the conductor; they read the hub's export and write importable additions back. |
| 11 | **Scripts** | `scripts/` | `hub.py` (search, cross-ref, gaps on an export), `classics.py` (fetch + align texts), `etym.py` (offline etymology DB build/query). |

## Build order
1. Archive + search + cross-reference (everything else plugs into it).
2. Classics catalogue + translation matrix.
3. Etymology (with engine import slot).
4. Mind map + gap finder, data tracker, research trail.
5. Agents + scripts, bridge file format.
6. Hub/README/CLAUDE.md updates, offline caching, browser test pass.

## Bridge format (app ⇄ agents)
The app exports `research-hub-export.json` (`{version, docs, chunks?, nodes, links, trails, data, etym}`).
Agents write `hub-import-*.json` with the same keys holding only *additions*; the app's
**Import** merges them (by id). Agent-made items carry `"by": "<agent-name>"` and, where
speculative, `"status": "hypothesis"`.

## Open slots
- Offline Etymology Engine: format adapter in `scripts/etym.py` + app import; drop the engine's data in when located.
- Loeb: not open-licensed; public-domain early Loeb scans can be added as PDFs to the archive.
