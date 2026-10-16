# Deployment permissions

Run `scripts/check_x12_permissions.py` at the inventory stage (before discovery) and the deployment stage (before any write). It is read-only and blocks on any failed check.

## Deployment identity

| Resource | Required permission |
|---|---|
| Source table or view | `USE CATALOG`, `USE SCHEMA`, `SELECT` |
| Source Volume | `USE CATALOG`, `USE SCHEMA`, `READ VOLUME` |
| Target catalog | `USE CATALOG`, plus `CREATE SCHEMA` only if the target schema does not exist |
| Target schema | `USE SCHEMA`, `CREATE TABLE`, `MODIFY`, `SELECT` (and `CREATE VOLUME` for a synthetic test source) |
| SQL warehouse | `CAN USE` |
| Parser job | Rights to create a classic job cluster, or a cluster policy the identity may use |
| App | `CAN MANAGE` on an existing App, or the right to create one |

## User authorization (default)

Gold SQL and Genie run with each viewer's forwarded token, so Unity Catalog applies the viewer's own grants, row filters, and masks, and audit logs record the viewer. The App requests exactly the `sql` and `genie` user scopes. Do not use `sql:restricted-query`: its tokens cannot fetch the result of a statement that runs past the 50-second Statement Execution wait. Scope changes on an existing App may not reach viewers who already consented, so test a changed scope set on a new App.

| Resource | Viewer group permission |
|---|---|
| App | `CAN USE` |
| SQL warehouse | `CAN USE` |
| Target catalog | `USE CATALOG` |
| Target schema (Gold tables) | `USE SCHEMA`, `SELECT` |
| Genie Space | `CAN RUN` |

The App service principal keeps only its warehouse binding and holds no Unity Catalog data grants. `deploy_app.py --viewer-group` grants the Gold privileges and App access; `deploy_genie.py --viewer-group` grants Genie `CAN RUN`.

## App authorization

The App service principal receives `USE CATALOG`, `USE SCHEMA`, and `SELECT` on the Gold tables, `CAN USE` on the warehouse, and `CAN RUN` on the Genie Space; `deploy_app.py` grants these in App mode. Viewers need only `CAN USE` on the App. The App requests no user scopes.

In either mode, neither the App nor its viewers receive access to raw X12, Silver parser JSON, or quarantine payloads.
