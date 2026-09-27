# Health Plan Analytics: X12 Pipeline + App Deploy Skill

Use this Genie Code skill to generate the Health Plan Analytics solution inside a Databricks customer environment and connect it to the customer’s governed X12 data.

The skill discovers a suitable Unity Catalog source, assesses whether it is ready for ingestion, deploys the Databricks X12 parser pipeline, publishes de-identified analytics tables, and configures a consistent Databricks App and Genie Space. The App’s design and behavior come from a versioned golden template, so repeated deployments look and work the same.

## What can I use this App for?

Health Plan Analytics is an accelerator for health plans that want to turn raw X12 transactions into governed payment-integrity workflows without building the ingestion pipeline and user experience from scratch.

| Experience | What it enables |
|---|---|
| Payment Integrity Dashboard | Compare providers against same-code peer benchmarks, quantify cost variance, and identify screening signals |
| SIU Workbench | Review provider-level codes, claims, de-identified member utilization, evidence, and deterministic analysis |
| Ask Genie | Explore the curated Gold tables in natural language while preserving Unity Catalog permissions |
| Governed X12 foundation | Convert raw 837, 835, and 834 transactions into reusable Bronze, Silver, and Gold tables |
| Customer deployment accelerator | Recreate the App and Genie Space in a customer workspace and connect them to customer-owned data |

Provider variance is a screening signal, not a finding of fraud, waste, abuse, or improper billing. The App supports analyst review; it does not replace clinical judgment, claim adjudication, or an investigation.

## What data is needed?

The skill expects raw X12 5010 transactions in a Unity Catalog table or view. It does not use an already-normalized claims table as a substitute for the X12 source.

### Minimum source contract

| Requirement | Needed? | Details |
|---|---:|---|
| Raw X12 payload | Required | One non-null `STRING` or `BINARY` column containing the complete X12 interchange |
| Stable source-record key | Required | A non-null, unique row identifier such as `record_id`, `source_record_id`, `message_id`, or `event_id` |
| Supported transaction | Required | At least one 837, 835, or 834 transaction |
| Supported version | Required for parsing | X12 version beginning with `00501` |
| Unity Catalog access | Required | `USE CATALOG`, `USE SCHEMA`, and `SELECT` for the identity running discovery |
| Transaction-type column | Optional | Helpful for operations, but the skill derives transaction type from `ST01` |
| Ingestion timestamp or source filename | Optional | Useful lineage fields; not required by the parser |

One table or view can contain a mix of 837, 835, and 834 rows. If the customer stores transaction types in separate tables, expose an approved union view with a common payload column and source-record key before deployment.

### Which X12 transactions power which features?

| Transaction | Business content | Resulting analytics |
|---|---|---|
| 837 | Claims and service lines | Provider benchmarking, procedure and diagnosis analysis, claim drilldown |
| 835 | Remittance and payment detail | Paid amounts, adjustments, and payment analysis |
| 834 | Enrollment and coverage | De-identified member and coverage context |

An 837 source is the minimum useful input for the core provider-variance experience. Adding 835 and 834 data enables the corresponding payment and member-context features. Unsupported features are disabled rather than populated with invented data.

### How discovery finds candidate tables

The read-only discovery stage inspects Unity Catalog metadata for `STRING` and `BINARY` columns with signals such as:

- `x12`, `edi`, `837`, `835`, or `834`
- `payload`, `message`, `body`, or `raw`
- generic payload names such as `value`, `content`, `data`, `text`, or `record` when the surrounding table metadata indicates X12

The current automated implementation discovers tables and views. Files in Unity Catalog Volumes should first be exposed through a governed table or view.

## First output: Bronze source-readiness report

Before it creates a pipeline, table, App, or Genie Space, the skill writes `discovery-report.json`. This is a read-only, PHI-safe assessment of the available source candidates.

The earlier discovery implementation included a `confidence` field, but that field measured only the fraction of sampled rows recognized as X12. It did not establish that the table met the complete Bronze input contract. The report now retains that value as `x12_match_ratio` and adds a separate, explainable `bronze_readiness` score.

### Readiness score

| Component | Weight | What is checked |
|---|---:|---|
| X12 payload match | 30 | Sampled non-null payloads recognized as X12 |
| Structural validity | 20 | ISA/IEA, GS/GE, ST/SE, control numbers, and segment counts |
| Supported version | 15 | X12 5010 version evidence |
| Supported transaction type | 15 | 837, 835, or 834 transaction evidence |
| Source-record key | 15 | A generic row key that is non-null and unique in the sample |
| Sample sufficiency | 5 | Enough sampled rows to support the assessment |

This is a deterministic readiness score, not a model-generated probability. Every point is backed by counts and ratios in the report.

| Status | Meaning |
|---|---|
| `ready` | Score is at least 90, the evidence target is met, and no blocking issue exists |
| `needs_review` | The source is plausible, but its score or sample evidence needs review |
| `not_ready` | A required condition is missing, such as identifiable X12, a supported type, or a suitable row key |
| `access_failed` | Metadata identified the candidate, but discovery could not sample it |

The report ranks candidates and recommends the strongest one for review. It never selects a source automatically, never prints raw payloads or key values, and never authorizes a write. The user must explicitly confirm the table, payload column, source-record key, transaction types, and destination before deployment continues.

Example summary:

```json
{
  "stage": "bronze_source_readiness",
  "read_only": true,
  "write_performed": false,
  "confirmation_required": true,
  "summary": {
    "recommended_candidate": {
      "table": "customer_catalog.claims.raw_x12",
      "payload_column": "edi_payload",
      "source_record_key_column": "record_id",
      "transaction_types": ["834", "835", "837"],
      "bronze_readiness_score": 100.0,
      "bronze_readiness_status": "ready"
    },
    "next_action": "review_and_confirm_source"
  }
}
```

## What the skill builds

| Stage | Assets | Safety boundary |
|---|---|---|
| Discovery | Ranked candidates, Bronze-readiness evidence, hashes, transaction types, and structural errors | Read-only; no payload or key values in the report |
| Test source | Deterministic fictional 837P, 835, and 834 records plus malformed cases | Explicitly synthetic; no real patient data |
| Bronze | Raw payload, source identity, payload hash, transaction types, and detected version | Restricted from the App and Genie |
| Silver | Sanitized parser JSON, claim headers and lines, remittance, enrollment, and quarantine | Parser errors are retained without source payload previews |
| Gold | De-identified members, providers, claims, claim lines, payments, enrollments, and data quality | No raw X12, parser JSON, names, addresses, full DOB, or direct member ID |
| Experiences | Versioned React/FastAPI App and deterministic Genie `serialized_space` v2 | Gold tables only; source-lock and visual-regression gates |

```text
Unity Catalog tables or views
  -> read-only discovery and Bronze-readiness report
  -> explicit customer confirmation
  -> Bronze raw lineage
  -> pinned X12 parser and quarantine
  -> normalized Silver tables
  -> de-identified Gold analytics
       -> Health Plan Analytics App
       -> curated Genie Space
```

The parser is pinned to commit `ac6d84d3f322310816a55a43569242afe295b4c5` and invoked through `from_edi_exploded`. The parser job uses a small classic cluster because its final JSON materialization depends on Spark RDD APIs. Discovery, App queries, and Genie use serverless SQL.

## Deployment workflow

1. Authenticate to the customer workspace and select a SQL warehouse.
2. Run read-only discovery for the approved catalog and optional schema scope.
3. Deliver and review `discovery-report.json`, including the Bronze-readiness score and any blockers.
4. Obtain explicit confirmation of the source table, payload column, source-record key, transaction types, and destination.
5. Build the immutable `deployment-manifest.json`.
6. Deploy and run the pinned X12 parser pipeline.
7. Verify structure, cardinality, quarantine behavior, and idempotency.
8. Publish the curated Gold tables.
9. Create or update the Genie Space from the deterministic specification.
10. Verify the pinned App source and approved visual baselines.
11. Generate only `app-config.json`, deploy the App, and run App and Genie smoke tests.

The App uses split authorization. Fixed dashboard and SIU queries run as the App service principal, which receives read-only access only to the approved Gold tables and selected warehouse. Interactive Genie requests use the forwarded viewer identity with only the `dashboards.genie` scope. A denied viewer request is never retried as the App service principal.

## Run discovery directly

```bash
python scripts/discover_x12_sources.py \
  --profile <databricks-profile> \
  --warehouse-id <sql-warehouse-id> \
  --catalog <source-catalog> \
  --schema <optional-source-schema> \
  --output discovery-report.json
```

Running this command performs no writes in the customer catalog. The only file it creates is the local report path supplied with `--output`.

## App consistency contract

`DESIGN.md` defines the visual vocabulary, and `assets/app-template` is the golden source. A deployment may generate `app-config.json`; it must not regenerate React, HTML, CSS, routes, or interaction copy. Source locks, API-contract tests, and approved screenshots prevent per-run design drift.

## Local validation

```bash
uv run python -m unittest discover -s tests -v
uv run python scripts/generate_synthetic_x12.py \
  --output output/synthetic-x12 --claims 3 --seed 42 --include-negative
cd assets/app-template/frontend && npm run typecheck && npm run build
cd ../../.. && python scripts/verify_app_template.py
```

For visual review, start the fictional-data preview and run the approved screenshot suite from another terminal:

```bash
python scripts/preview_app.py --port 4173
python scripts/visual_regression.py --base-url http://127.0.0.1:4173
```

## References

- [Architecture](references/architecture.md)
- [Discovery and Bronze-readiness rules](references/discovery-rules.md)
- [X12 output contract](references/x12-output-contract.md)
- [Golden App contract](references/app-contract.md)
- [Design system](DESIGN.md)
- [Deployment permissions](references/deployment-permissions.md)
- [Databricks X12 EDI parser](https://github.com/databricks-industry-solutions/x12-edi-parser)
- [Databricks Genie APIs](https://docs.databricks.com/aws/en/genie/conversation-api)
