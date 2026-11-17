# Ubiquitous System — project memory

A personal workshop of Claude Code **agents** + browser **tools** for studying
patterns (in nature, society, knowledge) and putting them to use. Built
conversationally; open-data, no-keys, privacy-first ethos throughout.

## Layout
```
.claude/agents/      the agent team (loaded by Claude Code in this repo)
tools/               self-contained browser apps (no build, no deps, open in a browser)
scripts/             Python helpers the agents run (need: numpy scipy pandas networkx
                     scikit-learn sympy rdkit pubchempy mendeleev biopython matplotlib)
README.md            human-facing overview
```

## Agents
- **conductor** — the default agent here (`.claude/settings.json` sets `"agent":"conductor"`).
  Routes a question to the specialists, combines answers, and translates them into the
  simplest explanation + smallest workable process for the user. Calls the four below.
- **chemist** — all of chemistry; uses the `chem-tools` skill for verified numbers/structures.
- **botanist-pharmacologist** — plants, molecular biology, pharmacology; evidence-graded.
- **plant-visionary** — poppy/cannabis/tobacco in depth; history + bold hypotheses, labeled.
- **pattern-theorist** — the science of patterns; **core discipline: test every pattern
  against a null before believing it.** Its hands are `scripts/patterns.py`.

## Tools (in `tools/`, open the file in a browser)
- **index.html** — hub: launches the tools, lists the agents, holds a shared
  "tracked concepts" store (localStorage) with JSON export/import. No lock-in.
- **learning-engine.html** — forgetting curve + spaced-repetition schedule; the
  forgetting curve, spacing effect, testing effect (simplified FSRS-style model).
- **node-explorer.html** — pulls open knowledge nodes (Wikipedia, Wikidata, ConceptNet,
  OpenAlex) and generates **known / adjacent / theoretic** uses. Runs client-side; a
  blocked source degrades gracefully. In-session, only Wikipedia + the allow-listed science
  APIs are reachable (see Network); the rest work in the user's own browser.
- **decision-matrix.html** — interactive weighted decision matrix (mirror of `scripts/decide.py`).

## Scripts (`python3 scripts/<x>.py ...`, run with `-I` on untrusted data)
- **patterns.py** — powerlaw | network | fractal | entropy | cycles | benford. Each returns
  a *verdict vs a null*, not just a number. `--demo` on any command to see it work.
- **decide.py** — weighted decision matrix (SAW + TOPSIS + weight-perturbation stability);
  reports when methods disagree or the ranking is fragile. `--demo` ranks this roadmap.
- **analogy.py** — structural-analogy strength scorer (bridge/surprise/mechanism/specificity);
  ranks which cross-domain analogy is worth testing first. Mirrors the ranker in node-explorer.

## Conventions
- **Commits:** branch off `main` if needed; the human asks before PRs. Commit author
  `cjahn1986`. Append the Claude attribution lines the session's current system reminder
  specifies (they change per session — do not hard-code a model name here).
- **Ethos:** open/free data, no API keys, nothing phoned home; label speculation as
  speculation; grade evidence; never pass a generated hypothesis off as a fact.
- **Network (cloud sessions):** the environment allowlist currently includes en.wikipedia.org
  and science APIs (PubChem, NCBI eutils/BLAST, UniProt, EBI/ChEMBL, KEGG, PDB, GBIF,
  ClinicalTrials, NIST). ConceptNet/Wikidata/OpenAlex are *not* allow-listed in-session but
  work from a normal browser. Env setup script installs the Python stack above.

## Roadmap (ranked by `decide.py --demo`)
1. ~~Serendipity ranker~~ **SHIPPED** — node-explorer now ranks theoretic uses by structural-analogy
   strength; `scripts/analogy.py` is the reproducible agent-side mirror.
2. **"Who already solved this?"** — OpenAlex structural-analog search (taste of the research moonshot). *(next)*
3. PWA / offline-installable workshop (accessibility).
4. Provenance / data "nutrition label" + challenge button.
5. More outside-the-box nodes (Wiktionary, OEIS, folklore).

## North star
A cross-domain **Pattern Engine**: detect the structure in any problem, find the field that
already solved its structural twin, and transfer the solution — rigorously, for anyone.
