# Science agents for Claude Code

Claude Code subagents for chemistry, for botany / molecular biology / pharmacology, and for poppy, cannabis and tobacco, plus a small computational toolkit they use to check numbers and structures instead of recalling them.

## Contents

| Path | What it is |
|---|---|
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
