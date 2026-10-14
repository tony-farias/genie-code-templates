---
name: hedis-file-ingestion
description: Ingest a HEDIS/CMS quality-measure star schema into Unity Catalog — claims & enrollment from HEDIS files via Auto Loader, member/provider dimensions from Salesforce Data Cloud (zero-copy), plus computed quality events and measure performance. Use when building or running the "Quality · HEDIS Measures" demo, adding file-based (Auto Loader) claims ingestion, or wiring Salesforce Data Cloud dimensions.
---

# HEDIS file ingestion (Lakeflow)

Builds the HEDIS Quality Measures model behind the app's **Quality · HEDIS Measures** tab.

## When to use
- Demoing **file-based Lakeflow ingestion** (Auto Loader / `cloudFiles`) for claims data.
- Showing **Salesforce Data Cloud** dimensions joined to file-sourced facts.

## Source → connector mapping (claims data)
There is no dedicated "claims" connector. Choose by source:

| Claims source | Connector |
|---|---|
| EDI X12 837/835, CSV, Parquet in S3/ADLS | **Auto Loader / Lakeflow file ingestion** |
| Claims adjudication / EDW database | Lakeflow Connect **database** connector (SQL Server GA) |
| Salesforce operational objects | Lakeflow Connect **Salesforce** connector |

The HEDIS quality layer (`dim_measure`, `fact_quality_events`, `mv_quality_performance`)
is a **Databricks computation**, not a sourced table — build it in the pipeline.

## Architecture
```
HEDIS files ─(Auto Loader)→ bronze_claims / bronze_enrollment ┐
                                                              ├─→ fact_* (gold star) → mv_quality_performance
Salesforce Data Cloud ─(zero-copy)→ dim_member / dim_provider ┘
```
- Land the HEDIS files in a UC Volume and read them with Auto Loader.
- Read the dimensions from a Salesforce Data Cloud zero-copy foreign catalog (or a schema
  standing in for it while no Data Cloud org is available).
