# Customer deployment architecture

## Runtime

```text
React/Vite SPA
    -> Express REST API
       -> Databricks Statement Execution API -> curated UC layer -> Scintilla feeds
       -> Genie Conversation API             -> page-scoped Genie rooms
       -> Foundation Model endpoint           -> briefs and recommendations
       -> Vector Search (optional)             -> shopper/research notes
       -> Lakebase (optional)                  -> chat, campaigns and action receipts
       -> Multi-Agent Supervisor (optional)    -> routes across Genie rooms
```

## Customer resources

Create resources only after approval:

1. A customer-owned curated schema beside, not inside, the licensed source schema.
2. Serverless SQL warehouse or an approved existing warehouse.
3. Databricks App with environment-specific resource IDs.
4. Genie rooms for sales, demand, e-commerce/inventory, supply chain and measurement as supported by available feeds.
5. Foundation Model endpoint available in the target region.
6. Optional Lakebase database and Vector Search endpoint/index.

## App configuration

Parameterize at minimum:

- `WAREHOUSE_ID`, `CATALOG`, `SCHEMA`
- shared and page-specific `GENIE_SPACE_*` values
- `LLM_MODEL`
- optional `SUPERVISOR_ENDPOINT`
- optional `VECTOR_SEARCH_ENDPOINT`, `VECTOR_SEARCH_INDEX`
- optional `LAKEBASE_HOST`, `LAKEBASE_DB`, `LAKEBASE_USER`

The app runtime receives Databricks OAuth credentials automatically. Mint short-lived tokens for SQL, Genie, Files, model serving and Lakebase. Do not embed a personal access token.

### Critical: resolve WAREHOUSE_ID before deploying

Do not leave `WAREHOUSE_ID` as a placeholder. During deployment, list warehouses
(`w.warehouses.list()`) and select a running serverless SQL warehouse. A placeholder
value causes all SQL endpoints to return 500 (`InvalidParameterValue`).

### Critical: Databricks SDK ChatMessage types

The Foundation Model endpoint proxy (`/api/brief`) must use SDK-typed message objects,
not plain Python dicts. The `serving_endpoints.query()` method serializes messages via
`.as_dict()` — plain dicts raise `AttributeError: 'dict' object has no attribute 'as_dict'`.

Correct pattern:

```python
from databricks.sdk.service.serving import ChatMessage, ChatMessageRole

response = w.serving_endpoints.query(
    name=LLM_MODEL,
    messages=[
        ChatMessage(role=ChatMessageRole.SYSTEM, content=system_msg),
        ChatMessage(role=ChatMessageRole.USER, content=user_msg),
    ],
    max_tokens=1024,
)
```

Never pass `{"role": "system", "content": ...}` — it will 500 at runtime.

### Critical: grant app service principal access

After creating the app, grant its service principal (`application_id` UUID from
`apps get <name>`) the minimum required privileges before the first user visit:

```sql
-- USE CATALOG is typically already granted to `account users` or inherited.
-- Only run this if the SP has no catalog-level access:
-- GRANT USE CATALOG ON CATALOG <catalog> TO `<application_id>`;

-- These two are always required:
GRANT USE SCHEMA ON SCHEMA <catalog>.<curated_schema> TO `<application_id>`;
GRANT SELECT ON SCHEMA <catalog>.<curated_schema> TO `<application_id>`;
```

`USE CATALOG` is often pre-granted at the workspace or account level. If it fails
(permission denied or already exists), skip it — `USE SCHEMA` + `SELECT` are the
two grants the app actually needs to execute queries. Without them, all SQL
endpoints return 500 even if the warehouse ID is valid.

### Critical: grant CAN_USE on the SQL warehouse

The `sql_warehouse` resource binding in `app.yaml` does NOT auto-grant warehouse
access. You must explicitly grant `CAN_USE` via the Permissions API:

```python
from databricks.sdk.service.iam import AccessControlRequest, PermissionLevel

w.warehouses.update_permissions(
    warehouse_id="<warehouse_id>",
    access_control_list=[
        AccessControlRequest(
            service_principal_name="<application_id>",  # UUID, not display name
            permission_level=PermissionLevel.CAN_USE,
        )
    ],
)
```

Note: `service_principal_name` in the Permissions API requires the SP's
`application_id` (UUID), not its display name. The display name (e.g.
`app-5d6faj my-app`) will return `ResourceDoesNotExist`.

## Validation gates

- Inventory: every enabled capability has source tables and required join/metric columns.
- Data: row counts, latest dates and supplier partitions are nonempty; join fanout is measured.
- API: `/api/health` and every enabled dashboard endpoint return 2xx.
- Genie: suggested prompts produce grounded SQL over allowed tables.
- Security: the app service principal has only required catalog, warehouse, room, endpoint and database permissions.
- UX: disabled capabilities are hidden or clearly labeled; no mock result is presented as live.
- Operations: prebuild `dist/`, warm the warehouse asynchronously and configure bounded caches/timeouts.
