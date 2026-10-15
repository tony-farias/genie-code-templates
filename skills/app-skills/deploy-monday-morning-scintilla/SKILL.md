---
name: deploy-monday-morning-scintilla
description: Discover Walmart Scintilla Cloud Feeds, run a blocking permissions preflight, assess readiness, and deploy the golden Monday Morning retail-intelligence App byte-for-byte against a pre-provisioned Databricks footprint. Use when asked to recreate, migrate, validate, or deploy Monday Morning against customer-licensed Scintilla data.
---

# Deploy Monday Morning on Scintilla

Recreate Monday Morning without assuming that every customer licenses the same Cloud Feeds. Default to the simplified core architecture; optional services require a separate decision and permission review.

Every deployment ships the same UI. The App is the locked golden template in `assets/app-template`; a run may change only the `app.yaml` env values through `scripts/render_app.py`. Read [references/app-contract.md](references/app-contract.md) before deploying.

## Simplified footprint

Require these existing resources before deployment:

- one running serverless SQL warehouse;
- one ready Foundation Model endpoint;
- the licensed Scintilla schema the viewers can already read. In user mode the App reads it directly, and a table map covers tables that use different names, so no views or other objects are created. Use a customer-owned curated schema only for App mode or for a feed that needs more than a rename or a read-only join;
- one Databricks App with its Databricks-managed service principal;
- approved Genie Spaces for the capabilities being deployed;
- one viewer group with `CAN USE` on the App.

Model serving always uses the App service principal. SQL and Genie run under one authorization mode, rendered as `AUTHORIZATION_MODE`:

- **User authorization (default):** the App requests the `sql` and `genie` user scopes, and SQL and Genie run with each viewer's forwarded `x-forwarded-access-token`. Viewers keep their existing warehouse access, Unity Catalog grants, row filters, and masks. The App service principal needs no Unity Catalog data grants and no Genie access.
- **App authorization:** the App service principal queries the curated schema and runs Genie; viewers need only `CAN USE` on the App. Choose it only when the viewers cannot be granted the curated data.

In user mode a request without a forwarded token fails; it never falls back to the App identity. Never combine user-authorized SQL with a cross-user result cache. Do not provision Lakebase, Vector Search, a supervisor endpoint, a new catalog, or Spark compute in the core deployment.

## Workflow

1. Collect the named CLI profile, licensed source catalog/schema, warehouse ID, model endpoint, App name, and viewer group. Collect a pre-created curated catalog/schema only if the deployment needs one (App mode, or a feed that a table map cannot cover).
2. Ask whether the user wants to redeploy the existing App and retain that App's managed service principal. Reuse is allowed only for the same customer, workspace, and security boundary. Reuse the App itself; never detach its service principal or assign it to a different App. If the answer is no, have an administrator create a new empty App. Also confirm the authorization mode: user authorization unless the customer explicitly chooses App authorization.
3. Read [references/permissions.md](references/permissions.md). Run the read-only inventory-stage preflight before inspecting feeds:

   ```bash
   python3 scripts/check_scintilla_permissions.py \
     --profile <profile> \
     --stage inventory \
     --source-catalog <licensed-catalog> \
     --source-schema <scintilla-schema> \
     --table-map table-map.json \
     --warehouse-id <warehouse-id> \
     --model-endpoint <endpoint-name> \
     --app-name <existing-app-name> \
     --viewer-group <group-name> \
     --authorization-mode user \
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

6. Read [references/cloud-feeds.md](references/cloud-feeds.md). Map feeds using column and grain evidence, not names alone. Every table in `REQUIRED_TABLES` (`scripts/app_contract.py`) must be available. When the customer's tables use different names, write `table-map.json` instead of creating views: map each App name to the existing table (`"store_sales": "fact_store_item_sales"`), or to a single read-only `SELECT` when a column needs a join (`"upc_sales": {"select": "SELECT ... FROM fact_upc_sales u LEFT JOIN ..."}`). The App reads those tables as they are. If a feed is missing, stop and report it: the golden UI has no feature flags, so never hide, stub, or regenerate a page to work around a missing feed.
7. Read [references/architecture.md](references/architecture.md). Produce a customer-specific core plan covering the table map (or curated objects, if any), App configuration, Genie Spaces, validation, costs, and rollback. Have an administrator create or bind any missing Genie Spaces before the deployment gate.
8. Rerun the preflight at the deployment stage with every confirmed source table and approved Genie Space. Stop unless `ready` is `true`:

   ```bash
   python3 scripts/check_scintilla_permissions.py \
     --profile <profile> \
     --stage deployment \
     --source-catalog <licensed-catalog> \
     --source-schema <scintilla-schema> \
     --source-table <confirmed-table> \
     --table-map table-map.json \
     --warehouse-id <warehouse-id> \
     --model-endpoint <endpoint-name> \
     --app-name <existing-app-name> \
     --viewer-group <group-name> \
     --authorization-mode user \
     --genie-space-id <approved-space-id> \
     --output /tmp/scintilla-deployment-permissions.json
   ```

   Pass every `REQUIRED_TABLES` entry as `--source-table`; repeat `--genie-space-id` as needed.
9. Present the final plan and obtain approval before creating or replacing curated objects or deploying App code.
10. Verify the golden template, render it with resolved IDs only, and deploy the rendered tree unchanged. Render outside any Git worktree, and sync to a new, empty workspace folder:

    ```bash
    python3 scripts/verify_app_template.py   # add --skip-build when npm is unavailable
    python3 scripts/render_app.py \
      --warehouse-id <warehouse-id> \
      --catalog <licensed-catalog> \
      --schema <scintilla-schema> \
      --table-map table-map.json \
      --authorization-mode user \
      --genie-space-id <approved-space-id> \
      --model-endpoint <endpoint-name> \
      --output /tmp/monday-morning-app
    databricks sync /tmp/monday-morning-app <workspace-source-path> --full --profile <profile>
    databricks apps deploy <app-name> --source-code-path <workspace-source-path> --mode SNAPSHOT --profile <profile>
    ```

11. Prove the running App serves the golden UI byte-for-byte and every parameterless UI API route returns JSON. Stop unless `ready` is `true`:

    ```bash
    python3 scripts/verify_deployment.py \
      --profile <profile> \
      --app-name <app-name> \
      --output /tmp/monday-morning-ui-parity.json
    ```

12. Treat Lakebase, Vector Search, and a supervisor as separate opt-in expansions. Re-run permission analysis and obtain approval before provisioning any of them.
13. Validate row counts, dates, join fanout, model responses, and Genie grounding as a viewer, and confirm the runtime identity matches the authorization mode.

## Authorization rules

- The deployment identity reads licensed feeds and does not need `MANAGE` on the source. When the App reads the licensed schema directly, the deployment creates nothing and needs only `USE SCHEMA` and `SELECT`. It creates or updates objects only in a dedicated curated schema, and only when one is used.
- In user mode (the default), the App's user authorization scopes are exactly `sql` and `genie`. The viewer group needs `CAN USE` on the warehouse, `USE CATALOG`, `USE SCHEMA`, and `SELECT` on the schema the App reads (the licensed schema, or a curated one), and `CAN RUN` on the approved Genie Spaces. The App service principal keeps only `CAN USE` on the warehouse (boot-time warm-up) and `CAN QUERY` on the model endpoint.
- In App mode, the App requests no SQL or Genie user scopes. The App service principal receives `CAN USE` on the selected warehouse, `CAN QUERY` on the selected model endpoint, `CAN RUN` on only the approved Genie Spaces, and `USE CATALOG`, `USE SCHEMA`, and `SELECT` on only the curated schema.
- Render and preflight with the same `--authorization-mode`; the preflight fails when the App's scopes do not match it.
- Bind resources with the Databricks Apps API; do not rely on a `resources` block in `app.yaml`.
- Request `sql`, not `sql:restricted-query`. `sql:restricted-query` is not enough: its tokens can submit a statement but cannot fetch the result, so any query that runs past the Statement Execution API's 50-second wait fails with a 403. The App sends only `SELECT` statements, and Unity Catalog still limits every query to the viewer's own privileges. Use `genie`, not the deprecated `dashboards.genie`.
- Reusing an App preserves its service principal and historical grants. The preflight rejects unexpected warehouse, model, or Genie bindings, but an administrator must also review and revoke stale grants elsewhere in Unity Catalog.

## Guardrails

- Run and pass the applicable preflight before inventory or deployment. Never silently continue after a failed or unverifiable check.
- Treat Scintilla data as customer-licensed and supplier-scoped. Do not copy it across customers or metastores.
- Never reuse an App or its service principal across customers, workspaces, or security boundaries.
- Never create a new catalog as a fallback. When a curated namespace is needed, a platform administrator must pre-create it. Do not create views only to rename tables; use the table map.
- Do not synthesize a missing licensed feed and present it as Scintilla. Stop and report the gap.
- Never edit, restyle, regenerate, or rebuild the App during a deployment. Deploy only `render_app.py` output, and never run `verify_app_template.py --update-lock` as part of a deployment.
- Treat a failed template, render, or UI-parity check as a deployment failure, not an invitation to fix the UI.
- Preserve source grain. Aggregate only in documented curated views or tables, when they are used.
- Parameterize catalog, schema, warehouse, Genie IDs, model endpoint, App name, and viewer group.
- Never commit credentials, customer identifiers, or workspace-specific resource IDs.
- Make destructive replacement or cleanup a separately approved step.
- Resolve every resource ID before deployment; placeholders are deployment blockers.
- Use SDK-typed `ChatMessage` objects when calling `serving_endpoints.query()`.
- Use the App's `application_id` UUID—not its display name—for Unity Catalog grants.

## Application source

`assets/app-template` is the only approved source: a React/Vite SPA with an Express API, its committed `dist/` build, and `template-lock.json`. It derives from `https://github.com/akash-jaiswal_data/retaildemo`, but deployments never fetch or adapt that repository. Template changes follow the change control in [references/app-contract.md](references/app-contract.md).
