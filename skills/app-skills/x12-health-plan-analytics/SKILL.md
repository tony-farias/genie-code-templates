---
name: x12-health-plan-analytics
description: Discover raw 837, 835, or 834 X12 data in Unity Catalog tables or Volume files, score how well it matches the X12 parser's input, run a blocking permissions preflight, deploy the pinned x12-edi-parser pipeline to Bronze, Silver, and Gold, create the Health Plan Analytics Genie Space, and deploy the golden FWA Shield App byte-for-byte. Use for customer X12 healthcare EDI analytics deployments; do not use for generic healthcare tables without raw X12.
---

# X12 Health Plan Analytics

Turn a customer's raw X12 transactions into governed Gold tables, a Genie Space, and the FWA Shield App. Use the deterministic scripts and versioned assets in this skill; never generate pipeline code, HTML, or CSS from scratch when an asset exists.

Every deployment ships the same UI. The App is the locked golden template in `assets/app-template`; a run may change only `app-config.json`, through `scripts/render_app.py`. Read [references/app-contract.md](references/app-contract.md) before deploying.

## Footprint

Require these before deployment:

- raw X12 5010 data: a Volume directory of X12 files (the parser's native input, one file per row) or a Unity Catalog table or view with one payload per row and a stable source-record key;
- a target catalog and schema for Bronze, Silver, and Gold, supplied by the user;
- a SQL warehouse;
- classic job compute for the parser, whose final JSON step uses RDD APIs that serverless Spark Connect cannot run;
- a Databricks App (`deploy_app.py` creates it when absent) and one viewer group.

Choose the data identity for App SQL and Genie explicitly:

- **User authorization (default):** the App requests the `sql` and `genie` user scopes, and Gold SQL and Genie run with each viewer's forwarded `x-forwarded-access-token`. Viewers keep their own grants, row filters, and masks. The App service principal needs no Unity Catalog data grants. A request without a viewer token fails; it never falls back to the App identity.
- **App authorization:** the App service principal reads Gold and runs Genie; viewers need only `CAN USE` on the App. Choose it only when viewers cannot be granted the Gold tables.

Request `sql`, not `sql:restricted-query`: restricted tokens can submit a statement but cannot fetch its result, so any query that runs past the 50-second Statement Execution wait fails with a 403.

## Workflow

1. Collect the named CLI profile, the source catalog (and optional schema scope), the target catalog and schema, the SQL warehouse ID, the App name, the viewer group, and the authorization mode.
2. Read [references/deployment-permissions.md](references/deployment-permissions.md). Run the read-only inventory-stage preflight:

   ```bash
   python3 scripts/check_x12_permissions.py \
     --profile <profile> --stage inventory \
     --target-catalog <catalog> --target-schema <schema> \
     --warehouse-id <warehouse-id> --app-name <app-name> \
     --authorization-mode user --viewer-group <group> \
     --output preflight-inventory.json
   ```

3. Read [references/discovery-rules.md](references/discovery-rules.md). Run read-only discovery across tables and Volumes. Add `--parser-dry-run` when a clone of the pinned parser commit is on `PYTHONPATH`; it parses the sample in memory and reports counts only:

   ```bash
   PYTHONPATH=<x12-edi-parser-clone> python3 scripts/discover_x12_sources.py \
     --profile <profile> --warehouse-id <warehouse-id> \
     --catalog <catalog> [--schema <schema>] --parser-dry-run \
     --output discovery-report.json
   ```

4. Make `discovery-report.json` the first deliverable. For each ranked candidate, present:
   - the match likelihood band and score;
   - the readiness components with their evidence;
   - feature coverage: which App and Genie capabilities its 837, 835, and 834 mix can power;
   - the parser dry-run counts;
   - blocking issues and warnings.

   Never display raw payloads, file paths, or key values.
5. Stop and obtain explicit confirmation of the source (table, payload column, and key, or Volume path), transaction types, target namespace, and authorization mode. If no candidate is ready, explain the blocking issues first.
6. Write `deployment-manifest.json` from the confirmed selection with `scripts/build_deployment_manifest.py`. Every later script uses only identifiers from this manifest.
7. For a test deployment, generate fictional records with `scripts/generate_synthetic_x12.py` and land them with `scripts/deploy_synthetic_source.py --files` (one raw `.x12` file per transaction in a Volume). Obtain the target catalog and schema before any write.
8. Rerun the preflight with `--stage deployment` and the confirmed `--source-volume-path` or `--source-table`. Stop unless `ready` is `true`.
9. Deploy and run the parser bundle job (`databricks.yml`, `resources/x12_pipeline_job.yml`), passing either `source_volume_path` or `source_table`/`payload_column`/`primary_key_column`, plus the target namespace and table prefix. The parser is pinned to a tested commit and defaults to `from_edi_exploded`.
10. Run `scripts/verify_deployment.py` for structural, cardinality, and idempotency checks.
11. Build and deploy the Genie Space: `scripts/build_genie_config.py`, then `scripts/deploy_genie.py --viewer-group <group>`, then `scripts/smoke_test_genie.py`.
12. Read `DESIGN.md`. Verify the golden template, render it from the manifest and state, and deploy:

    ```bash
    python3 scripts/verify_app_template.py        # add --skip-build when npm is unavailable
    python3 scripts/render_app.py --manifest deployment-manifest.json --state deployment-state.json --output build/app
    python3 scripts/deploy_app.py --profile <profile> --manifest deployment-manifest.json \
      --app-dir build/app --state deployment-state.json --viewer-group <group>
    ```

13. Prove the running App serves the golden UI byte-for-byte and its read-only API answers. Stop unless `ready` is `true`:

    ```bash
    python3 scripts/verify_app_parity.py --profile <profile> --app-name <app-name> --output app-parity.json
    ```

    Run `scripts/visual_regression.py` against `scripts/preview_app.py` when Chrome and ImageMagick are available.
14. Validate as a viewer. In user mode, the warehouse query history must show the App's statements running as the viewer, not the App service principal.

## Required gates

- Discovery and the preflight are read-only.
- The match likelihood band derives from a deterministic, sample-based readiness score. It is neither a probability nor an automatic source selection.
- No production write occurs before source confirmation.
- Catalog and schema are always user-supplied.
- Raw X12 and PHI never appear in logs, prompts, App responses, or Genie instructions.
- ICD-10, CPT, HCPCS, member IDs, claim IDs, and control numbers remain strings.
- Header-to-line joins use claim-level and source-level keys, not patient identity alone.
- Parser and skill versions are recorded in deployment metadata.
- A discovered but inaccessible source is reported, never silently substituted. A separately approved synthetic source may be used for end-to-end verification.
- Curated Gold tables exist before the App or Genie Space is configured. Neither consumer sees raw X12 or parser JSON.
- App navigation, layout, CSS, routes, and interactions stay fixed for the pinned template version. An intentional template change requires a version bump, a new source lock (`verify_app_template.py --update-lock`), and approved visual baselines. Never update locks or baselines during an ordinary deployment.
- Render and preflight with the same authorization mode. In user mode the App requests exactly `sql` and `genie`, and the App service principal holds no data grants. In App mode the App requests no user scopes.

Read [references/discovery-rules.md](references/discovery-rules.md) before discovery, [references/x12-output-contract.md](references/x12-output-contract.md) before pipeline work, [references/app-contract.md](references/app-contract.md) before App work, and [references/deployment-permissions.md](references/deployment-permissions.md) before deployment.
