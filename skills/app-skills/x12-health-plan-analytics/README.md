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

## Databricks permissions and compute dependencies

The solution uses four distinct identities. Do not give every identity the union of all privileges:

1. **Deployment identity** — the user or service principal running the CLI and deployment scripts.
2. **Parser job run identity** — the identity under which the bundle job executes. Unless `run_as` is added, this is normally the bundle deployer or job owner.
3. **App service principal** — created and managed by Databricks Apps for fixed dashboard and SIU queries.
4. **Viewer identity** — the signed-in App user whose forwarded token is used only for interactive Genie requests.

### Required workspace capabilities

| Capability | Requirement |
|---|---|
| Unity Catalog | The workspace must be attached to a Unity Catalog metastore. The source and destination catalogs must already exist; this project does not create catalogs. |
| Databricks SQL | One Unity Catalog-enabled SQL warehouse is required. Serverless SQL is recommended. The same warehouse can serve discovery, verification, grants, App queries, and Genie. |
| Classic jobs compute | Classic all-purpose/job compute must be allowed because the pinned parser materializes Spark RDDs that are unavailable through serverless Spark Connect. |
| Databricks Apps | Apps and serverless Apps compute must be enabled in the workspace. |
| AI/BI Genie | Genie must be enabled, and the deployment identity must be allowed to create or update a Space. |
| Workspace files | The deployment identity needs write access to its bundle root and App staging path under `/Workspace/Users/<user>/`. |
| Network egress | The parser cluster needs outbound HTTPS access to GitHub and Python package infrastructure to install the pinned `git+https` parser dependency. |

### Deployment identity permissions

| Stage | Required permissions |
|---|---|
| Authenticate | Workspace access and a named Databricks CLI profile for the intended workspace. |
| Discover source data | `CAN USE` on the selected SQL warehouse; `USE CATALOG` and `USE SCHEMA`; and `SELECT` on candidate source tables or views. Discovery is read-only. |
| Create the destination schema | `USE CATALOG` plus `CREATE SCHEMA` on the destination catalog when the schema does not already exist. If it exists, `USE SCHEMA` is required. |
| Publish pipeline tables | `CREATE TABLE` on the destination schema. For an existing deployment, the job identity must also own the output tables or have sufficient `MODIFY`/`MANAGE` authority to overwrite their schemas and set table properties. |
| Deploy the bundle job | Permission to create jobs, or `CAN MANAGE` on the existing job; permission to create classic job compute or use the customer-approved cluster policy and node type. |
| Use the parser job | `CAN MANAGE RUN` or stronger on the deployed job when the runner is different from the job owner. |
| Verify outputs | `CAN USE` on the SQL warehouse plus `USE CATALOG`, `USE SCHEMA`, and `SELECT` on the generated Bronze, Silver, and Gold tables and relevant `information_schema` metadata. |
| Create or update Genie | Permission to create a Genie Space in the deployment identity's workspace folder, or `CAN MANAGE` on the existing Space; `CAN USE` on the warehouse; and `SELECT` on all configured Gold tables. |
| Create or update the App | Permission to create Databricks Apps, or `CAN MANAGE` on the existing App; `CAN USE` on the bound SQL warehouse; and write access to the App source path in Workspace Files. |
| Grant App data access | The deployment identity must own or have `MANAGE` authority on the destination catalog, schema, and Gold tables so it can grant the App service principal `USE CATALOG`, `USE SCHEMA`, and `SELECT`. If it cannot grant those privileges, a Unity Catalog owner or metastore administrator must perform this step. |

If a separate service principal is configured as the job `run_as` identity, grant that principal the source and destination Unity Catalog permissions above. Granting them only to the person who deploys the bundle is not sufficient.

### Optional synthetic-source permissions

The fictional test-data path is optional and is not needed when an approved customer source already exists.

| Operation | Required permissions |
|---|---|
| Create the test Volume | `USE CATALOG`, `USE SCHEMA`, and `CREATE VOLUME` on the approved schema. |
| Upload JSONL | `WRITE VOLUME` on an existing Volume. The creator of a new Volume receives ownership automatically. |
| Read JSONL with `read_files` | `READ VOLUME` on an existing Volume. |
| Create or replace the synthetic source table | `CREATE TABLE` on the schema and ownership or `MODIFY` authority when replacing an existing table. |
| Execute setup SQL | `CAN USE` on the selected SQL warehouse. |

### Parser job run identity

The job reads the confirmed source and creates or overwrites Bronze, Silver, and Gold Delta tables. Its run identity therefore needs:

- `USE CATALOG` and `USE SCHEMA` on the source namespace;
- `SELECT` on the confirmed source table or view;
- `USE CATALOG` and `CREATE SCHEMA` on the destination catalog because the parser notebook executes `CREATE SCHEMA IF NOT EXISTS`;
- `USE SCHEMA` on the destination schema once it exists;
- `CREATE TABLE` on the destination schema;
- ownership or sufficient `MODIFY`/`MANAGE` authority for previously created output tables;
- permission to use the configured classic compute policy and node type.

The run identity does not need access to Databricks Apps or Genie.

### App service principal

`scripts/deploy_app.py` creates or updates the App, retrieves its Databricks-managed service principal, binds the selected warehouse with `CAN USE`, and grants only:

- `USE CATALOG` on the destination catalog;
- `USE SCHEMA` on the destination schema;
- `SELECT` on the seven configured Gold tables: `claims`, `claim_lines`, `members`, `providers`, `payments`, `enrollments`, and `data_quality`.

The App service principal must not receive `SELECT` on the customer source, Bronze raw X12, Silver parser JSON, or quarantine tables.

### App viewer permissions

| App capability | Viewer requirements |
|---|---|
| Dashboard and SIU Workbench | `CAN USE` on the Databricks App. These fixed SQL routes execute as the App service principal, so viewers do not inherit access to Bronze or Silver data. |
| Embedded Genie | `CAN USE` on the App, permission to run the configured Genie Space, `CAN USE` on its SQL warehouse, and `USE CATALOG`, `USE SCHEMA`, and `SELECT` on the configured Gold tables. |
| Forwarded identity | The App requests only the `dashboards.genie` user API scope. A missing or denied viewer token is returned as an error and is never replaced with the App service-principal identity. |

Share the App and Genie Space with the intended users or groups after deployment. Creation does not automatically grant every workspace user access.

### Compute configuration

| Component | Required configuration | Purpose |
|---|---|---|
| X12 parser job | Databricks Runtime `16.4.x-scala2.12`, `SINGLE_USER` data security mode, Standard runtime engine, one worker, and one driver | Runs structural validation, the pinned parser, normalization, and Bronze/Silver/Gold publication |
| Default AWS node type | `m5d.large` for both driver and worker | Repository default for the small demonstration workload |
| Azure or GCP deployment | Override `node_type_id` with an available equivalent permitted by the customer's cluster policy | The default `m5d.large` identifier is AWS-specific |
| SQL warehouse | One running Unity Catalog-enabled warehouse; Serverless is recommended | Discovery, optional source loading, verification, grants, App SQL, and Genie SQL |
| Databricks Apps compute | Databricks-managed serverless Apps compute | Runs the FastAPI application and installs its pinned Python runtime dependencies |
| Genie | Uses the configured SQL warehouse; no separate Spark cluster is required | Generates and executes governed SQL over Gold tables |

The bundle limits the parser job to one concurrent run and a one-hour task timeout. Larger source volumes may require a larger driver/worker node type, more workers, or a longer timeout; those changes should be made through bundle variables or an approved customer cluster policy rather than by changing the App template.

### Runtime and build dependencies

| Location | Dependencies |
|---|---|
| Parser cluster | Spark/PySpark from DBR 16.4 and `databricksx12` installed from the pinned GitHub commit |
| App runtime | Python, `fastapi==0.115.12`, `uvicorn[standard]==0.34.2`, and `databricks-sdk==0.60.0` |
| Deployment workstation | A current Databricks CLI exposing `bundle`, `apps`, `sync`, and `fs`; Python 3.10+; and `databricks-sdk==0.60.0` |
| Frontend build | Node.js 20 LTS and npm; React 19.1, TypeScript 5.8.3, and Vite 6.4.3 are locked in `package-lock.json` |
| Optional visual regression | Chrome or Chromium plus ImageMagick's `magick` executable |

No GPU, Model Serving endpoint, Vector Search index, Lakebase database, or serverless Spark pipeline is required for this solution.

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
