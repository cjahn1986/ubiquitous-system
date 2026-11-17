---
name: chem-tools
description: Chemistry calculation toolkit — molar/exact mass and percent composition from a formula or SMILES, compound name → structure (SMILES, IUPAC, InChIKey) via PubChem, molecular descriptors (logP, TPSA, H-bond donors/acceptors, Lipinski), element data, and equation balancing. Use whenever a chemistry answer depends on a number or a structure that should be computed or looked up rather than recalled.
---

# chem-tools

Run the bundled script with Python 3. It needs `rdkit pubchempy sympy mendeleev`; if an import fails, run:

```bash
pip install -q rdkit pubchempy sympy numpy scipy pint mendeleev
```

Script path: `.claude/skills/chem-tools/chemtool.py` (relative to the project root).

| Task | Command |
|---|---|
| Molar mass + % composition (formula, hydrate, or SMILES) | `python3 chemtool.py mw "CuSO4·5H2O"` · `python3 chemtool.py mw "CC(=O)Oc1ccccc1C(=O)O"` |
| Name → SMILES / IUPAC / InChIKey (PubChem, needs network) | `python3 chemtool.py name2smiles caffeine` |
| Descriptors, drug-likeness (SMILES or name) | `python3 chemtool.py props ibuprofen` |
| Element data | `python3 chemtool.py element Fe` · `... element 26` · `... element iron` |
| Balance an equation | `python3 chemtool.py balance "C8H18 + O2 -> CO2 + H2O"` |

## Notes
- Formulas are case-sensitive (`Co` = cobalt, `CO` = carbon monoxide). Parentheses and hydrate dots (`·`, `.`, `*`) are supported.
- Atomic weights come from `mendeleev` (IUPAC standard values); quote them to sensible significant figures.
- Balancing handles neutral species only; for redox in solution with charges, balance by half-reactions by hand (or with sympy) and say so.
- For anything outside these commands (unit conversions with `pint`, equilibrium/kinetics with `scipy`, symbolic work with `sympy`), write a short Python snippet directly.
- Tell the user which command(s) you ran and their output.
