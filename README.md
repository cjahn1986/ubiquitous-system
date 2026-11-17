# Chemist agent for Claude Code

A Claude Code subagent with expert-level coverage of every branch of chemistry, plus a small computational toolkit it uses to check numbers and structures instead of recalling them.

## Contents

| Path | What it is |
|---|---|
| `.claude/agents/chemist.md` | The `chemist` subagent: scope, working method, safety limits, output style |
| `.claude/skills/chem-tools/SKILL.md` | The `chem-tools` skill: tells Claude when and how to use the toolkit |
| `.claude/skills/chem-tools/chemtool.py` | The toolkit script |

## Setup

```bash
pip install rdkit pubchempy sympy numpy scipy pint mendeleev
```

Name lookups use PubChem, so `pubchem.ncbi.nlm.nih.gov` must be reachable (in Claude Code cloud environments, add it to the allowed hosts).

## Use

Open this repo in Claude Code and ask, e.g. *"Have the chemist agent explain the mechanism of the Diels–Alder reaction."*
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
