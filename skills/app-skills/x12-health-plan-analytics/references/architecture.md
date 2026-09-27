# Architecture

The skill is manifest-driven. Read-only discovery produces a ranked report; a user-confirmed selection becomes the deployment manifest consumed by the parser, App, and Genie deployment scripts.

```text
Genie Code
  -> read-only UC discovery
  -> structural X12 validation
  -> user confirmation
  -> deployment manifest
  -> Bronze raw lineage
  -> Silver parser and quarantine
  -> Silver normalized 837/835/834 tables
  -> Gold health-plan analytics model
       -> versioned Databricks App
       -> curated Genie Agent
       -> end-to-end verification
```

The X12 parser is pinned to a tested commit. The pipeline defaults to `from_edi_exploded` to prevent a single Arrow string from exceeding 2 GB.

The App is copied from the versioned golden source in `assets/app-template`. A run may replace `app-config.json`; it must not regenerate frontend structure, CSS, interaction copy, or API routes. `DESIGN.md` documents the visual vocabulary, `references/app-contract.md` defines behavior, and source, compiled-bundle, and screenshot gates enforce both.
