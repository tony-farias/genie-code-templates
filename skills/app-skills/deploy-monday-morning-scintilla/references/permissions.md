# Simplified permissions and preflight

## Core identity model

Use three identities:

1. A platform administrator performs one-time bootstrap.
2. A deployment identity inventories Scintilla, maintains curated objects, and redeploys the existing App.
3. The Databricks-managed App service principal runs shared SQL, Genie, and model calls.

Viewers receive App access through one group. They do not need direct SQL warehouse, Unity Catalog, Genie, or model endpoint permissions in the default shared authorization mode.

## One-time administrator bootstrap

The administrator must:

- create the dedicated curated schema;
- select a running serverless SQL warehouse and ready Foundation Model endpoint;
- create the App or approve reuse of an existing App in the same security boundary;
- bind that warehouse with `CAN USE` and the endpoint with `CAN QUERY`;
- grant the App `application_id` UUID `USE CATALOG`, `USE SCHEMA`, and `SELECT` on the curated schema;
- create or select the supported Genie Spaces and bind each with `CAN RUN`;
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

## App service principal

| Resource | Required permission |
|---|---|
| Selected SQL warehouse | Bound with `CAN USE` |
| Selected Foundation Model endpoint | Bound with `CAN QUERY` |
| Approved Genie Spaces | Bound with `CAN RUN` |
| Curated catalog | `USE CATALOG` |
| Dedicated curated schema | `USE SCHEMA`, `SELECT` |

Do not grant the App service principal access to the licensed source schema. Use curated tables or governed views whose ownership and dependencies have been configured for that boundary.

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
- App service-principal access to the curated namespace.

The deployment-stage check additionally verifies:

- a read-only `SELECT 1 ... LIMIT 1` probe for every selected source feed;
- accessibility of every approved Genie Space;
- exact `CAN RUN` App bindings for those Genie Spaces.

Both stages write only the local JSON report. They do not create, alter, grant, deploy, query a model, or start a Genie conversation. A failed or unverifiable check is blocking.

## Optional services

Lakebase, Vector Search, a multi-agent supervisor, new model endpoints, Spark compute, and new SQL warehouses are outside the simplified core footprint. Analyze their identities, costs, and permissions only after the user explicitly enables the corresponding feature.
