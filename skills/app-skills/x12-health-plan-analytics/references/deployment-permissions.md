# Deployment permissions

The deploying identity needs `USE CATALOG`, `USE SCHEMA`, and `SELECT` on confirmed source objects. Creating outputs additionally requires `CREATE SCHEMA`, `CREATE TABLE`, and `CREATE VOLUME` only where selected by the user.

The App service principal receives:

- `USE CATALOG` and `USE SCHEMA` on the Gold namespace.
- `SELECT` on approved Gold tables or views.
- `CAN USE` on the selected SQL warehouse.

It does not receive access to raw X12, Silver parser JSON, or quarantine payloads.

The App uses its service principal for deterministic dashboard and SIU SQL routes. These routes expose a fixed, shared, de-identified dataset and can query only the configured Gold tables through the selected warehouse. Their authorization mode does not change based on request headers.

Interactive Genie routes use the forwarded viewer token and request only the `dashboards.genie` user API scope. Each viewer needs permission to use the configured Genie Space. A missing or denied viewer token is returned as an error and is never retried under the App service principal.

The Genie Space uses the same curated Gold boundary. Deployment requires the Genie management API, a SQL warehouse, and permissions to create or update the Space.
