# Ubiquitous System

## 🏛️ Research Hub — `tools/research/index.html`

A research workspace for connecting modern subjects with ancient ones across disciplines, and finding what lies between them. Runs in your browser: offline-capable, open data, no keys, and your data stays with you.

| Piece | What it does |
|---|---|
| **Archive** | Drop in PDFs, text, HTML, TEI XML, notes. Text is extracted and indexed at the passage level. |
| **Search & cross-reference** | Accent-insensitive search across everything (λογος finds λόγος); "related in your archive"; select any passage → find it elsewhere. |
| **Web** | Wikipedia, Wikidata, Wiktionary, OpenAlex, Crossref, Internet Archive, Project Gutenberg. Every result is checked against your archive; import with one click. |
| **Classics** | 2,275 Greek & Latin works (Perseus + First1KGreek, CC BY-SA), 807 with English, loaded on demand. |
| **Translation matrix** | Original and English side by side, aligned by citation. Click a word for grammar, meaning, its likely English counterpart, dictionaries, etymology. Word-by-word interlinear per line. |
| **Etymology** | Lineages and cognates from Wiktionary, cached offline; import slot for the **Offline Etymology Engine**. |
| **Mind map** | Concepts, people, places, texts, words, events, open questions, colored by type, era or discipline. **Gap finder:** pairs your sources mention together but you haven't linked, structural holes, ancient↔modern bridges, recurring names not yet mapped. |
| **Data** | Data points with units and evidence on one BCE→CE timeline; CSV for the Pattern Tracker. |
| **Trails** | Each investigation is a line: question → sources → findings → hypotheses → conclusions. While a trail is active, everything you save is logged to it. |

**Run it with the bridge** (recommended): from the repo folder run `python3 scripts/hub_bridge.py` and open http://localhost:8000/research/. Select text anywhere for the action bar.

**With the agents:** while the hub is open through the bridge, its data is kept in `research/hub-export.json` for the agents, and whatever they write (`research/hub-import-<agent>.json`) shows up in your hub within seconds. 🌉 in the header shows the bridge is connected; the terminal prints one line per transfer. Just ask the conductor in Claude Code. `research/` is git-ignored: your research never gets committed.

*Without the bridge* (`cd tools && python3 -m http.server 8000`, or the GitHub Pages URL) everything works the same, but you move data by hand: *Hub & agents → Export everything* → save as `research/hub-export.json`; import the agents' files with *Import / merge*.

**Licences:** classical texts are CC BY-SA (Perseus Digital Library, Open Greek and Latin); pdf.js is Apache-2.0 (`tools/research/vendor/pdfjs-LICENSE`). The Loeb Classical Library itself is copyrighted, but pre-1929 volumes are public domain and importable from the Internet Archive.

---

# Science agents for Claude Code

Claude Code subagents for chemistry, for botany / molecular biology / pharmacology, and for poppy, cannabis and tobacco, plus a small computational toolkit they use to check numbers and structures instead of recalling them.

## Contents

| Path | What it is |
|---|---|
| `.claude/agents/{archivist,cross-referencer,web-scout,classicist,etymologist,cartographer,data-steward,trail-keeper}.md` | The Research Hub team, one per piece, coordinated by the conductor |
| `scripts/hub.py`, `scripts/classics.py`, `scripts/etym.py` | The research team's hands: read the hub export / write imports; fetch and align classical texts; offline etymology database |
| `.claude/agents/pattern-theorist.md` | The `pattern-theorist`: the science of patterns across nature, society, math and information — complexity, fractals, networks, chaos, scaling laws, morphogenesis, cycles, biomimicry — with the discipline to tell a real pattern from a fooling one |
| `.claude/agents/conductor.md` | The `conductor`: routes questions to the three specialists, combines their answers, and turns them into the simplest explanation and process. **Default main agent in this repo** (via `.claude/settings.json`) |
| `.claude/settings.json` | Sets `"agent": "conductor"`; remove that line to get a plain Claude session |
| `.claude/agents/chemist.md` | The `chemist` subagent: every branch of chemistry |
| `.claude/agents/plant-visionary.md` | The `plant-visionary` subagent: visionary world expert on *Papaver somniferum* and the Papaveraceae, *Cannabis* and the Cannabaceae, *Nicotiana* and the Solanaceae |
| `.claude/agents/botanist-pharmacologist.md` | The `botanist-pharmacologist` subagent: botany, ethnobotany, phytochemistry, molecular biology, pharmacology and toxicology |
| `.claude/skills/chem-tools/SKILL.md` | The `chem-tools` skill: tells Claude when and how to use the toolkit |
| `.claude/skills/chem-tools/chemtool.py` | The toolkit script |

## Setup

```bash
pip install rdkit pubchempy sympy numpy scipy pint mendeleev biopython pandas networkx scikit-learn matplotlib
```

Name lookups use PubChem, so `pubchem.ncbi.nlm.nih.gov` must be reachable (in Claude Code cloud environments, add it to the allowed hosts).

## Network

Live database lookups need these hosts reachable (in Claude Code cloud environments, add them to the allowed hosts): `pubchem.ncbi.nlm.nih.gov`, `eutils.ncbi.nlm.nih.gov`, `blast.ncbi.nlm.nih.gov`, `rest.uniprot.org`, `www.ebi.ac.uk` (ChEMBL), `rest.kegg.jp`, `data.rcsb.org` (PDB), `api.gbif.org`, `clinicaltrials.gov`, `webbook.nist.gov`, `en.wikipedia.org`.
Kew POWO and the IUPHAR Guide to Pharmacology API refuse scripted requests; the agents use GBIF, ChEMBL or web search instead.

## Use

Open this repo in Claude Code and just ask: the conductor answers, calling specialists as needed. Elsewhere, start it with `claude --agent conductor`.

Open this repo in Claude Code and ask, e.g. *"Have the chemist agent explain the mechanism of the Diels–Alder reaction"* or *"Ask the botanist-pharmacologist how hyperforin in St John's wort causes drug interactions."*
To make the agent available in every project, copy `.claude/agents/` and `.claude/skills/` into `~/.claude/`.

### Toolkit commands

```bash
python3 .claude/skills/chem-tools/chemtool.py mw "CuSO4·5H2O"          # molar mass + % composition (formula or SMILES)
python3 .claude/skills/chem-tools/chemtool.py name2smiles caffeine     # name -> SMILES, IUPAC, InChIKey (PubChem)
python3 .claude/skills/chem-tools/chemtool.py props ibuprofen          # logP, TPSA, H-bond donors/acceptors, Lipinski
python3 .claude/skills/chem-tools/chemtool.py element Fe               # element data
python3 .claude/skills/chem-tools/chemtool.py balance "C8H18 + O2 -> CO2 + H2O"
```

`balance` handles neutral species only; ionic redox equations are balanced by half-reactions.

## Beta
This is **v0.1.0-beta**. Browser tools live in `tools/` (installable PWA, works offline);
Claude Code agents live in `.claude/`. See **[BETA.md](BETA.md)** for how to run and what to test.
Live (if GitHub Pages is enabled): https://cjahn1986.github.io/ubiquitous-system/
