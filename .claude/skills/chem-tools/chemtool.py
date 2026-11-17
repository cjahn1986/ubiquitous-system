#!/usr/bin/env python3
"""chemtool — small chemistry command-line toolkit.

Commands:
  mw <formula|SMILES>        Molar mass, exact mass, elemental composition
  name2smiles <name>         Look up a compound by name on PubChem
  props <SMILES|name>        Molecular descriptors (RDKit) + PubChem identifiers
  element <symbol|name|Z>    Element data (mendeleev)
  balance "<reactants> -> <products>"   Balance a chemical equation
"""
import re
try:
    from rdkit import RDLogger
    RDLogger.DisableLog("rdApp.*")
except ImportError:
    pass
import sys
from collections import Counter

# ---------- formula parsing (handles parentheses, hydrates, charges) ----------

def _parse(formula):
    tokens = re.findall(r"([A-Z][a-z]?|\(|\)|\[|\]|\d+)", formula)
    stack = [Counter()]
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t in "([":
            stack.append(Counter())
        elif t in ")]":
            group = stack.pop()
            mult = 1
            if i + 1 < len(tokens) and tokens[i + 1].isdigit():
                mult = int(tokens[i + 1]); i += 1
            for k, v in group.items():
                stack[-1][k] += v * mult
        elif t.isdigit():
            raise ValueError(f"unexpected number in {formula!r}")
        else:
            n = 1
            if i + 1 < len(tokens) and tokens[i + 1].isdigit():
                n = int(tokens[i + 1]); i += 1
            stack[-1][t] += n
        i += 1
    return stack[0]


def parse_formula(formula):
    """'CuSO4·5H2O' or 'CuSO4.5H2O' -> Counter of atoms."""
    formula = re.sub(r"[+-]\d*$|\^.*$", "", formula.strip())  # drop charge
    total = Counter()
    for part in re.split(r"[·.*]", formula):
        m = re.match(r"^(\d+)(.*)$", part)
        mult, body = (int(m.group(1)), m.group(2)) if m else (1, part)
        for k, v in _parse(body).items():
            total[k] += v * mult
    return total


def looks_like_formula(s):
    return bool(re.fullmatch(r"[A-Z][A-Za-z0-9()\[\]·.*+-]*", s)) and not re.search(r"[=#@/\\]", s)


# ---------- commands ----------

def cmd_mw(arg):
    from mendeleev import element
    from rdkit import Chem
    from rdkit.Chem import Descriptors, rdMolDescriptors

    atoms = None
    mol = None
    if looks_like_formula(arg):
        try:
            atoms = parse_formula(arg)
            for sym in atoms:
                element(sym)  # raises if unknown
        except Exception:
            atoms = None
    if atoms is None:
        mol = Chem.MolFromSmiles(arg)
        if mol is None:
            sys.exit(f"Could not read {arg!r} as a formula or SMILES.")
        formula = rdMolDescriptors.CalcMolFormula(mol)
        atoms = parse_formula(formula)
        print(f"SMILES:   {arg}\nFormula:  {formula}")
    else:
        print(f"Formula:  {arg}")

    masses = {s: element(s).atomic_weight for s in atoms}
    mw = sum(masses[s] * n for s, n in atoms.items())
    print(f"Molar mass: {mw:.4f} g/mol")
    if mol is not None:
        print(f"Monoisotopic (exact) mass: {Descriptors.ExactMolWt(mol):.5f} Da")
    print("\nElement   Count   Mass %")
    for s, n in sorted(atoms.items(), key=lambda x: (x[0] != "C", x[0] != "H", x[0])):
        print(f"{s:<8}  {n:>5}   {100 * masses[s] * n / mw:6.2f}")


def _pubchem_by_name(name):
    import urllib.error
    import pubchempy as pcp
    try:
        hits = pcp.get_compounds(name, "name")
    except (urllib.error.URLError, pcp.PubChemHTTPError) as e:
        sys.exit(f"PubChem unreachable ({e}). Check that pubchem.ncbi.nlm.nih.gov "
                 "is allowed by the network, or pass a SMILES string instead.")
    if not hits:
        sys.exit(f"No PubChem match for {name!r}.")
    return hits[0]


def _smiles_of(c):
    return getattr(c, "connectivity_smiles", None) or getattr(c, "isomeric_smiles", None) or c.canonical_smiles


def cmd_name2smiles(name):
    c = _pubchem_by_name(name)
    print(f"Name:      {name}")
    print(f"IUPAC:     {c.iupac_name}")
    print(f"SMILES:    {getattr(c, 'smiles', None) or _smiles_of(c)}")
    print(f"Formula:   {c.molecular_formula}")
    print(f"MW:        {c.molecular_weight} g/mol")
    print(f"InChIKey:  {c.inchikey}")
    print(f"PubChem:   https://pubchem.ncbi.nlm.nih.gov/compound/{c.cid}")


def cmd_props(arg):
    from rdkit import Chem
    from rdkit.Chem import Crippen, Descriptors, Lipinski, rdMolDescriptors

    mol = Chem.MolFromSmiles(arg)
    if mol is None:
        c = _pubchem_by_name(arg)
        smiles = getattr(c, "smiles", None) or _smiles_of(c)
        print(f"(resolved {arg!r} via PubChem CID {c.cid})")
        mol = Chem.MolFromSmiles(smiles)
    rows = [
        ("Canonical SMILES", Chem.MolToSmiles(mol)),
        ("Formula", rdMolDescriptors.CalcMolFormula(mol)),
        ("MW (g/mol)", f"{Descriptors.MolWt(mol):.3f}"),
        ("Exact mass (Da)", f"{Descriptors.ExactMolWt(mol):.5f}"),
        ("cLogP (Crippen)", f"{Crippen.MolLogP(mol):.2f}"),
        ("TPSA (Å²)", f"{rdMolDescriptors.CalcTPSA(mol):.1f}"),
        ("H-bond donors", Lipinski.NumHDonors(mol)),
        ("H-bond acceptors", Lipinski.NumHAcceptors(mol)),
        ("Rotatable bonds", Lipinski.NumRotatableBonds(mol)),
        ("Rings / aromatic", f"{rdMolDescriptors.CalcNumRings(mol)} / {rdMolDescriptors.CalcNumAromaticRings(mol)}"),
        ("Stereocentres", len(Chem.FindMolChiralCenters(mol, includeUnassigned=True))),
        ("Formal charge", Chem.GetFormalCharge(mol)),
        ("InChIKey", Chem.MolToInchiKey(mol)),
    ]
    for k, v in rows:
        print(f"{k:<18} {v}")
    viol = sum([Descriptors.MolWt(mol) > 500, Crippen.MolLogP(mol) > 5,
                Lipinski.NumHDonors(mol) > 5, Lipinski.NumHAcceptors(mol) > 10])
    print(f"{'Lipinski Ro5':<18} {viol} violation(s)")


def cmd_element(arg):
    from mendeleev import element
    e = element(int(arg)) if arg.isdigit() else element(arg.capitalize() if len(arg) <= 2 else arg.title())
    fields = [
        ("Name", e.name), ("Symbol", e.symbol), ("Z", e.atomic_number),
        ("Atomic weight", e.atomic_weight), ("Group / period", f"{e.group_id} / {e.period}"),
        ("Block", e.block), ("Electron config", e.ec.to_str() if hasattr(e, "ec") else e.econf),
        ("Electronegativity (Pauling)", e.en_pauling),
        ("1st ionization (eV)", e.ionenergies.get(1)),
        ("Electron affinity (eV)", e.electron_affinity),
        ("Atomic radius (pm)", e.atomic_radius),
        ("Common oxidation states", getattr(e, "oxistates", None)),
        ("Melting point (K)", e.melting_point), ("Boiling point (K)", e.boiling_point),
        ("Density (g/cm³)", e.density), ("Discovered", f"{e.discoverers}" + (f" ({e.discovery_year})" if e.discovery_year else "")),
    ]
    for k, v in fields:
        print(f"{k:<28} {v}")


def cmd_balance(eq):
    import sympy as sp
    lhs, rhs = re.split(r"\s*(?:->|→|=)\s*", eq)
    reac = [s.strip() for s in lhs.split("+")]
    prod = [s.strip() for s in rhs.split("+")]
    species = reac + prod
    comps = [parse_formula(s) for s in species]
    elements = sorted(set().union(*comps))
    M = sp.Matrix([[c[e] * (1 if i < len(reac) else -1) for i, c in enumerate(comps)] for e in elements])
    null = M.nullspace()
    if len(null) != 1:
        sys.exit(f"Equation has {len(null)} independent solutions — cannot balance uniquely.")
    v = null[0]
    lcm = sp.ilcm(*[x.q for x in v])
    coeffs = [int(x * lcm) for x in v]
    if all(c < 0 for c in coeffs):
        coeffs = [-c for c in coeffs]
    if any(c <= 0 for c in coeffs):
        sys.exit("No all-positive solution; check the species.")
    fmt = lambda cs, ss: " + ".join(f"{'' if c == 1 else c}{s}" for c, s in zip(cs, ss))
    print(fmt(coeffs[:len(reac)], reac) + " -> " + fmt(coeffs[len(reac):], prod))


COMMANDS = {"mw": cmd_mw, "name2smiles": cmd_name2smiles, "props": cmd_props,
            "element": cmd_element, "balance": cmd_balance}

if __name__ == "__main__":
    if len(sys.argv) < 3 or sys.argv[1] not in COMMANDS:
        sys.exit(__doc__)
    COMMANDS[sys.argv[1]](" ".join(sys.argv[2:]))
