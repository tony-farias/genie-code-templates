"""Build the HEDIS Quality Measures data model as `const HEDIS = {...}` for the ERD app.

This documents the HEDIS star schema (HEDIS files + Salesforce Data Cloud dims), with
each entity colored by PROVENANCE via its `kind` (see the STYLE map in index.html):

  file      → ingested from HEDIS files with Auto Loader (green)
  datacloud → sourced from Salesforce Data Cloud, zero-copy (blue)
  measure   → computed HEDIS quality events / performance (purple)
  ref       → reference data (grey)

Output structure matches the other generators so buildTab() renders it.
"""
import json

OUT = "/tmp/hedis_data.js"

# name -> (kind, [fk (col, target) ...], total_cols)
OBJECTS = {
    # gold facts — ingested from HEDIS files via Auto Loader
    "fact_claims":            ("file",      [("member_id", "dim_member"), ("provider_npi", "dim_provider")], 14),
    "fact_enrollment":        ("file",      [("member_id", "dim_member")], 4),
    # dimensions — Salesforce Data Cloud (zero-copy)
    "dim_member":             ("datacloud", [("county_fips", "dim_county")], 10),
    "dim_provider":           ("datacloud", [], 5),
    # computed quality layer
    "fact_quality_events":    ("measure",   [("member_id", "dim_member"), ("measure_id", "dim_measure")], 5),
    "mv_quality_performance": ("measure",   [("measure_id", "dim_measure")], 11),
    # reference
    "dim_measure":            ("ref",       [], 8),
    "dim_county":             ("ref",       [], 4),
}

LABELS = {
    "fact_claims":            "Fact · Claims (HEDIS files)",
    "fact_enrollment":        "Fact · Enrollment (HEDIS files)",
    "dim_member":             "Dim · Member (Data Cloud)",
    "dim_provider":           "Dim · Provider (Data Cloud)",
    "fact_quality_events":    "Fact · Quality Events (computed)",
    "mv_quality_performance": "Measure Performance (computed)",
    "dim_measure":            "Dim · HEDIS Measure (ref)",
    "dim_county":             "Dim · County (ref)",
}

DOMAIN = "HEDIS Quality Measures"
BLURB = (
    "HEDIS/CMS quality-measure star schema. Claims and member-month enrollment are "
    "ingested from HEDIS files via Auto Loader (green); Member and Provider dimensions "
    "are sourced from Salesforce Data Cloud via zero-copy (blue); quality events "
    "(numerator/denominator gaps) and measure performance are computed in the Lakeflow "
    "pipeline (purple); measure and county are reference data (grey). "
    "Green = HEDIS file ingest · Blue = Salesforce Data Cloud · Purple = computed · Grey = reference."
)


def main():
    names = list(OBJECTS)

    edges = []  # (parent, child, col)
    for child, (_, fks, _) in OBJECTS.items():
        for col, parent in fks:
            edges.append((parent, child, col))

    def entity_block(name):
        _, fks, ncols = OBJECTS[name]
        lines = [f"  {name} {{", "    string Id PK"]
        for col, _ in fks:
            lines.append(f"    string {col} FK")
        shown = len(lines) - 1
        if ncols > shown:
            lines.append(f'    string note "{ncols} columns total"')
        lines.append("  }")
        return "\n".join(lines)

    src = ["erDiagram"]
    for parent, child, col in edges:
        src.append(f'  {parent} ||--o{{ {child} : "{col}"')
    for n in names:
        src.append(entity_block(n))

    domain = {
        "name": DOMAIN,
        "blurb": BLURB,
        "tables": sorted(names),
        "ghosts": [],
        "edges": len(edges),
        "mermaid": "\n".join(src),
    }
    table_meta = {
        n: {"cols": OBJECTS[n][2], "domain": DOMAIN, "kind": OBJECTS[n][0], "label": LABELS[n]}
        for n in names
    }
    payload = {
        "domains": [domain],
        "tables": table_meta,
        "hubRefs": {},
        "totals": {"tables": len(names), "edges": len(edges)},
    }
    with open(OUT, "w") as f:
        f.write("const HEDIS = ")
        json.dump(payload, f)
        f.write(";\n")
    print(f"{len(names)} objects, {len(edges)} relationships -> {OUT}")
    for n in sorted(names):
        print(f"  {OBJECTS[n][0]:9}  {n}")


if __name__ == "__main__":
    main()
