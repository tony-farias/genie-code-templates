# Simplified permissions and preflight

## Core identity model

Use three identities:

1. A platform administrator performs one-time bootstrap.
2. A deployment identity inventories Scintilla, maintains curated objects, and redeploys the existing App.
3. At runtime, the signed-in viewer runs SQL and Genie in user mode (the default); the Databricks-managed App service principal runs them in App mode. The App service principal always runs model calls.

Viewers receive App access through one group. In user mode they also need warehouse, curated Unity Catalog, and Genie access through that group. In App mode they need no direct data or compute permissions.

## One-time administrator bootstrap

The administrator must:

- create the dedicated curated schema;
- select a running serverless SQL warehouse and ready Foundation Model endpoint;
- create the App or approve reuse of an existing App in the same security boundary;
- bind that warehouse with `CAN USE` and the endpoint with `CAN QUERY`;
- create or select the supported Genie Spaces;
- in user mode, set the App's user authorization scopes to `sql` and `genie`, and grant the viewer group the permissions in [User authorization](#user-authorization-default);
- in App mode, grant the App `application_id` UUID `USE CATALOG`, `USE SCHEMA`, and `SELECT` on the curated schema, and bind each Genie Space with `CAN RUN`;
- grant the deployment identity `CAN MANAGE` on the App;
- grant the viewer group `CAN USE` on the App;
- review and revoke stale App-service-principal grants before an existing App is reused.

The administrator can then leave the recurring deployment path. The deployment identity does not need catalog ownership, Unity Catalog `MANAGE`, warehouse `CAN MANAGE`, endpoint `CAN MANAGE`, App creation, or permission-grant authority.

## Recurring deployment identity

| Resource | Required permission |
|---|---|
| Licensed source catalog | `USE CATALOG` |
| Licensed source schema | `USE SCHEMA` |
| Selected Scintilla feeds | `SELECT` |
| Curated catalog | `USE CATALOG` |
| Pre-created curated schema | `USE SCHEMA`, `CREATE TABLE`, `MODIFY`, `SELECT` |
| SQL warehouse | `CAN USE` |
| Existing App | `CAN MANAGE` |
| Approved Genie Spaces | Access sufficient to inspect and validate them |
| App staging path | Write access in Workspace Files |

`CREATE SCHEMA`, `CREATE CATALOG`, and Unity Catalog `MANAGE` are deliberately excluded.

## User authorization (default)

SQL and Genie run with each viewer's forwarded `x-forwarded-access-token`, so Unity Catalog applies the viewer's own grants, row filters, and masks, and audit logs record the viewer. Set the App's user authorization scopes to exactly `sql` and `genie` (the platform adds its default `iam` read scopes). Do not use `sql:restricted-query`: its tokens can submit a statement but cannot fetch the result, so any query that runs past the Statement Execution API's 50-second wait fails with a 403. The App sends only `SELECT` statements, and Unity Catalog still limits every query to the viewer's own privileges. Viewers consent to these scopes the first time they open the App. Scope changes on an existing App may not reach viewers who already consented; test a changed scope set on a new App.

| Resource | Viewer group permission |
|---|---|
| App | `CAN USE` |
| Selected SQL warehouse | `CAN USE` |
| Curated catalog | `USE CATALOG` |
| Dedicated curated schema | `USE SCHEMA`, `SELECT` |
| Approved Genie Spaces | `CAN RUN` |

| Resource | App service principal permission |
|---|---|
| Selected SQL warehouse | Bound with `CAN USE` (boot-time warm-up only) |
| Selected Foundation Model endpoint | Bound with `CAN QUERY` |

The App service principal needs no Unity Catalog data grants and no Genie access. A request without a forwarded token fails rather than falling back to the App identity. User-authorized query results are never cached across viewers, so pages query the warehouse on every load.

## App authorization

Use this mode only when the viewers cannot be granted the curated data. Viewers need only `CAN USE` on the App.

| Resource | App service principal permission |
|---|---|
| Selected SQL warehouse | Bound with `CAN USE` |
| Selected Foundation Model endpoint | Bound with `CAN QUERY` |
| Approved Genie Spaces | Bound with `CAN RUN` |
| Curated catalog | `USE CATALOG` |
| Dedicated curated schema | `USE SCHEMA`, `SELECT` |

The App must request no SQL or Genie user scopes.

In either mode, do not grant the App service principal access to the licensed source schema. Use curated tables or governed views whose ownership and dependencies have been configured for that boundary.

## Existing App reuse

An App service principal is lifecycle-managed by its App. It is not a portable credential or a general deployment service principal.

- **Allowed:** redeploy the same App and retain its service principal, after confirming the same customer, workspace, data boundary, bindings, and grants.
- **Not allowed:** attach the existing App's service principal to a new App, copy its credentials, or reuse it across customers.
- **New App:** have an administrator create the App. Databricks creates a new managed service principal, which must receive the bootstrap bindings and grants before deployment.

Reusing an App reduces setup work but carries accumulated-permission risk. Resource-binding checks detect unexpected warehouse, model, and supplied Genie bindings. They cannot enumerate every historical privilege across the metastore, so an administrator must review stale Unity Catalog grants separately.

## Preflight behavior

The inventory-stage check verifies:

- CLI authentication and caller identity;
- running serverless warehouse and successful read-only SQL execution;
- write access to the caller's Workspace Files home used for App staging;
- source catalog/schema visibility;
- curated namespace effective privileges;
- ready model endpoint;
- existing App, managed service principal, caller `CAN MANAGE`, and viewer-group `CAN USE`;
- exact warehouse and model resource bindings;
- that the App's user scopes match `--authorization-mode`; user mode then checks the viewer group's warehouse `CAN USE` and curated-schema privileges (counting grants to `account users`), while App mode checks the App principal's curated-schema privileges.

The deployment-stage check additionally verifies:

- a read-only `SELECT 1 ... LIMIT 1` probe for every selected source feed;
- accessibility of every approved Genie Space;
- `CAN RUN` for the viewer group (user mode) or exact `CAN RUN` App bindings (App mode) on those Genie Spaces; user mode warns about Genie bindings the App identity does not need.

Both stages write only the local JSON report. They do not create, alter, grant, deploy, query a model, or start a Genie conversation. A failed or unverifiable check is blocking.

## Optional services

Lakebase, Vector Search, a multi-agent supervisor, new model endpoints, Spark compute, and new SQL warehouses are outside the simplified core footprint. Analyze their identities, costs, and permissions only after the user explicitly enables the corresponding feature.
