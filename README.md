# Science agents for Claude Code

Claude Code subagents for chemistry and for botany / molecular biology / pharmacology, plus a small computational toolkit they use to check numbers and structures instead of recalling them.

## Contents

| Path | What it is |
|---|---|
| `.claude/agents/chemist.md` | The `chemist` subagent: every branch of chemistry |
| `.claude/agents/botanist-pharmacologist.md` | The `botanist-pharmacologist` subagent: botany, ethnobotany, phytochemistry, molecular biology, pharmacology and toxicology |
| `.claude/skills/chem-tools/SKILL.md` | The `chem-tools` skill: tells Claude when and how to use the toolkit |
| `.claude/skills/chem-tools/chemtool.py` | The toolkit script |

## Setup

```bash
pip install rdkit pubchempy sympy numpy scipy pint mendeleev biopython pandas
```

Name lookups use PubChem, so `pubchem.ncbi.nlm.nih.gov` must be reachable (in Claude Code cloud environments, add it to the allowed hosts).

## Use

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
