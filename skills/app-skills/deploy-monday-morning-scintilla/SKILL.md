---
name: deploy-monday-morning-scintilla
description: Discover Walmart Scintilla Cloud Feeds, run a blocking permissions preflight, assess readiness, and deploy the Monday Morning retail-intelligence App against a pre-provisioned Databricks footprint. Use when asked to recreate, migrate, validate, or deploy Monday Morning against customer-licensed Scintilla data.
---

# Deploy Monday Morning on Scintilla

Recreate Monday Morning without assuming that every customer licenses the same Cloud Feeds. Default to the simplified shared-data architecture; optional services require a separate decision and permission review.

## Simplified footprint

Require these existing resources before deployment:

- one running serverless SQL warehouse;
- one ready Foundation Model endpoint;
- one customer-owned curated schema outside the licensed source schema;
- one Databricks App with its Databricks-managed service principal;
- approved Genie Spaces for the capabilities being deployed;
- one viewer group with `CAN USE` on the App.

Use SQL, Genie, and model serving through the App service principal. Viewers need only `CAN USE` on the App when every viewer is authorized for the same supplier-scoped curated data. Do not provision Lakebase, Vector Search, a supervisor endpoint, a new catalog, or Spark compute in the core deployment.

## Workflow

1. Collect the named CLI profile, licensed source catalog/schema, pre-created curated catalog/schema, warehouse ID, model endpoint, App name, and viewer group.
2. Ask whether the user wants to redeploy the existing App and retain that App's managed service principal. Reuse is allowed only for the same customer, workspace, and security boundary. Reuse the App itself; never detach its service principal or assign it to a different App. If the answer is no, have an administrator create and bootstrap a new empty App, then restart this workflow with its name.
3. Read [references/permissions.md](references/permissions.md). Run the read-only inventory-stage preflight before inspecting feeds:

   ```bash
   python3 scripts/check_scintilla_permissions.py \
     --profile <profile> \
     --stage inventory \
     --source-catalog <licensed-catalog> \
     --source-schema <scintilla-schema> \
     --curated-catalog <customer-catalog> \
     --curated-schema <curated-schema> \
     --warehouse-id <warehouse-id> \
     --model-endpoint <endpoint-name> \
     --app-name <existing-app-name> \
     --viewer-group <group-name> \
     --output /tmp/scintilla-permissions.json
   ```

4. Inspect every failed check and remediation. Stop unless `ready` is `true`. The preflight performs no Databricks writes, grants, deployment, model query, or Genie conversation.
5. Run the read-only feed inventory:

   ```bash
   python3 scripts/inventory_scintilla.py \
     --profile <profile> \
     --catalog <licensed-catalog> \
     --schema <scintilla-schema> \
     --warehouse-id <warehouse-id> \
     --output /tmp/scintilla-readiness.md
   ```

6. Read [references/cloud-feeds.md](references/cloud-feeds.md). Map supported capabilities using column and grain evidence, not names alone. Select only feeds used by enabled features.
7. Read [references/architecture.md](references/architecture.md). Produce a customer-specific core plan covering curated views/tables, App configuration, Genie Spaces, validation, costs, and rollback. Have an administrator create or bind any missing Genie Spaces before the deployment gate.
8. Rerun the preflight at the deployment stage with every confirmed source table and approved Genie Space. Stop unless `ready` is `true`:

   ```bash
   python3 scripts/check_scintilla_permissions.py \
     --profile <profile> \
     --stage deployment \
     --source-catalog <licensed-catalog> \
     --source-schema <scintilla-schema> \
     --source-table <confirmed-table> \
     --curated-catalog <customer-catalog> \
     --curated-schema <curated-schema> \
     --warehouse-id <warehouse-id> \
     --model-endpoint <endpoint-name> \
     --app-name <existing-app-name> \
     --viewer-group <group-name> \
     --genie-space-id <approved-space-id> \
     --output /tmp/scintilla-deployment-permissions.json
   ```

   Repeat `--source-table` and `--genie-space-id` as needed.
9. Present the final plan and obtain approval before creating or replacing curated objects or deploying App code.
10. Deploy the core experience in phases: sales/inventory dashboard, supported expansion pages, then page-scoped Genie and grounded briefs. Features without licensed source evidence remain disabled.
11. Treat Lakebase, Vector Search, and a supervisor as separate opt-in expansions. Re-run permission analysis and obtain approval before provisioning any of them.
12. Validate row counts, dates, join fanout, every enabled API route, model responses, Genie grounding, App health, and the App service principal's runtime boundary.

## Authorization rules

- The deployment identity may read licensed feeds and create or update objects only in the dedicated curated schema. It does not need `MANAGE` on the source.
- The App service principal receives `CAN USE` on the selected warehouse, `CAN QUERY` on the selected model endpoint, `CAN RUN` on only the approved Genie Spaces, and `USE CATALOG`, `USE SCHEMA`, and `SELECT` on only the curated schema.
- Bind resources with the Databricks Apps API; do not rely on a `resources` block in `app.yaml`.
- The default shared authorization mode does not request delegated SQL or Genie user scopes. Use delegated identity only when per-user audit, row filters, or differing data entitlements are explicit requirements; then create a separate group-based permission plan.
- Reusing an App preserves its service principal and historical grants. The preflight rejects unexpected warehouse, model, or Genie bindings, but an administrator must also review and revoke stale grants elsewhere in Unity Catalog.

## Guardrails

- Run and pass the applicable preflight before inventory or deployment. Never silently continue after a failed or unverifiable check.
- Treat Scintilla data as customer-licensed and supplier-scoped. Do not copy it across customers or metastores.
- Never reuse an App or its service principal across customers, workspaces, or security boundaries.
- Never create a new catalog as a fallback. A platform administrator must pre-create the curated namespace.
- Do not synthesize a missing licensed feed and present it as Scintilla. Disable the capability or propose a clearly labeled substitute.
- Preserve source grain. Aggregate only in documented curated views or tables.
- Parameterize catalog, schema, warehouse, Genie IDs, model endpoint, App name, and viewer group.
- Never commit credentials, customer identifiers, or workspace-specific resource IDs.
- Make destructive replacement or cleanup a separately approved step.
- Resolve every resource ID before deployment; placeholders are deployment blockers.
- Use SDK-typed `ChatMessage` objects when calling `serving_endpoints.query()`.
- Use the App's `application_id` UUID—not its display name—for Unity Catalog grants.

## Application source

The original source is `https://github.com/akash-jaiswal_data/retaildemo`. The known implementation is React/Vite with an Express API. Treat it as a template: remove environment-specific IDs and configure only the preflight-approved resources. If the source is unavailable, preserve the API contracts in [references/architecture.md](references/architecture.md); do not invent unsupported data or functionality.
