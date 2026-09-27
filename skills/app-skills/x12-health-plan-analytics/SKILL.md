---
name: x12-health-plan-analytics
description: Discover and assess raw 837, 835, or 834 X12 sources in Unity Catalog, deploy the governed parser pipeline, and create the consistent Health Plan Analytics Databricks App and Genie Space. Use for customer X12 healthcare EDI analytics deployments; do not use for generic healthcare tables without raw X12.
---

# X12 Pipeline and Analytics Deployment

Use deterministic scripts and versioned assets from this skill. Do not generate pipeline code, HTML, or CSS from scratch when an asset already exists.

## Workflow

1. Collect the Databricks profile, source catalog, optional schema scope, and SQL warehouse ID.
2. Run `scripts/discover_x12_sources.py` in read-only mode against Unity Catalog tables.
3. Make `discovery-report.json` the first deliverable. Present ranked candidates, payload location, source-record-key evidence, transaction types, access failures, and the deterministic Bronze-readiness score with its component evidence. Distinguish the legacy X12 match ratio from Bronze readiness; neither is permission to deploy. Never display raw payloads or key values.
4. Stop and obtain explicit confirmation of the source table, payload column, primary key, transaction types, and destination. If no candidate is ready, explain the blocking issues before asking for confirmation.
5. Write `deployment-manifest.json` from the confirmed selection. Downstream scripts must use only identifiers from this manifest.
6. For a test deployment, generate fictional records with `scripts/generate_synthetic_x12.py`. Obtain the user's target catalog and schema before any Unity Catalog write.
7. Deploy the parser pinned to a tested X12 parser commit. Default to `from_edi_exploded`, sanitize upstream error previews, and retain source lineage and safe parse failures.
8. Build curated Gold tables before configuring the App or Genie Agent. Do not expose raw X12 or parser JSON to either consumer.
9. Read `DESIGN.md` and `references/app-contract.md`. Copy `assets/app-template` byte-for-byte and generate `app-config.json` only. Disable unsupported functionality with explicit feature flags; never substitute invented data.
10. Verify the App source lock and API contract with `scripts/verify_app_template.py`. Run the visual suite against already-approved baselines when Chrome and ImageMagick are available. Never update locks or baselines during an ordinary deployment.
11. Create or update the Genie Agent from a deterministic version 2 `serialized_space` specification.
12. Deploy with split authorization: fixed SQL analytics use the Gold-only App service principal, while interactive Genie uses a forwarded viewer token with only the `dashboards.genie` scope. Never retry a denied Genie request as the App service principal.
13. Run structural, cardinality, idempotency, App smoke, and Genie benchmark checks.

## Required gates

- Discovery is read-only.
- Bronze readiness is a weighted, sample-based readiness score, not a probability or an automatic source-selection decision.
- No production write occurs before source confirmation.
- Catalog and schema are always user-supplied.
- Raw X12 and PHI never appear in logs, prompts, App responses, or Genie instructions.
- ICD-10, CPT, HCPCS, member IDs, claim IDs, and control numbers remain strings.
- Header-to-line joins use claim-level and source-level keys, not patient identity alone.
- Parser and skill versions are recorded in deployment metadata.
- A discovered but inaccessible source is reported, never silently substituted. A separately approved synthetic source may be used for end-to-end verification.
- App navigation, layout, CSS, routes, and interactions remain fixed for the pinned template version.
- An intentional template change requires a version bump plus separately approved source locks and visual baselines.
- Fixed SQL routes always use the App service principal and may query only configured Gold tables. Genie always uses the forwarded viewer identity; the two modes are explicit and never selected as fallbacks for one another.

Read [references/discovery-rules.md](references/discovery-rules.md) before discovery, [references/x12-output-contract.md](references/x12-output-contract.md) before pipeline work, [references/app-contract.md](references/app-contract.md) before App work, and [references/deployment-permissions.md](references/deployment-permissions.md) before deployment.
