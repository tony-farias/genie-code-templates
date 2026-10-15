# Customer deployment architecture

## Simplified core runtime

User authorization (default):

```text
Viewer group -> Databricks App CAN USE
                    |
                    v
              React/Vite SPA
                    |
                    v
              Express REST API
                    |
                    +-> viewer token (x-forwarded-access-token) -> serverless SQL warehouse
                    |                                              -> curated UC schema
                    +-> viewer token (x-forwarded-access-token) -> approved Genie Spaces
                    +-> App service principal -> Foundation Model endpoint
```

The App requests the `sql:restricted-query` and `genie` user scopes. Unity Catalog applies each viewer's grants, row filters, and masks, and SQL results are never cached across viewers. The deployment identity builds curated objects and deploys App code but is not used by the running App.

App authorization replaces both viewer-token branches with the App service principal:

```text
Viewer -> Databricks App -> App service principal -> SQL warehouse -> curated UC schema
                         +-> App service principal -> approved Genie Spaces
                         +-> App service principal -> Foundation Model endpoint
```

In App mode, viewers receive no direct data or compute permissions.

## Existing resources

The core deployment consumes, rather than provisions:

1. A customer-owned curated schema outside the licensed source schema.
2. A running serverless SQL warehouse.
3. A Databricks App with its managed service principal.
4. Approved Genie Spaces supported by the licensed feeds.
5. A ready Foundation Model endpoint available in the target region.
6. A viewer group with `CAN USE` on the App.

Lakebase, Vector Search, a multi-agent supervisor, new catalogs, new warehouses, new model endpoints, and Spark compute are not part of the core footprint. Add one only after a separate opt-in plan, permission check, and approval.

## App reuse

Reusing an existing App means redeploying that same App. Its managed service principal remains attached to it. Do not attach that principal to a new App or reuse it across customers, workspaces, or security boundaries.

Before reuse:

- confirm the App belongs to the same customer and data boundary;
- verify the deployment identity has `CAN MANAGE`;
- require exact warehouse and model endpoint bindings, plus the approved Genie bindings in App mode;
- verify the service principal holds no data access beyond its mode: none in user mode, only the curated boundary in App mode;
- have an administrator revoke unrelated historical grants.

## App configuration

The golden template's `app.yaml` carries placeholders that `scripts/render_app.py` fills; no other file changes. See [app-contract.md](app-contract.md).

- `WAREHOUSE_ID`, `CATALOG`, and `SCHEMA`;
- `AUTHORIZATION_MODE` (`user` by default, or `app`);
- `GENIE_SPACE_ID`;
- `LLM_MODEL`;
- optional `OUTCOME_MAPS_URL`;
- the App name and viewer group used by deployment automation, outside `app.yaml`.

Do not include Lakebase, Vector Search, or supervisor settings in the core configuration. Do not copy resource IDs from another workspace.

## Resource bindings

Configure resources through the Databricks Apps API:

- SQL warehouse: `CAN USE`;
- Foundation Model endpoint: `CAN QUERY`;
- each approved Genie Space: `CAN RUN` (App mode only).

Do not rely on a `resources` section in `app.yaml`. Use the App's `application_id` UUID for Unity Catalog grants. In App mode, the App receives `USE CATALOG`, `USE SCHEMA`, and `SELECT` only on the dedicated curated schema; in user mode it receives no Unity Catalog grants.

The default user-authorization design requests only `sql:restricted-query` and `genie`, and grants the approved viewer group the warehouse, curated-data, and Genie privileges. App authorization requests no SQL or Genie scopes and grants those privileges to the App service principal instead.

## Curated data boundary

Do not query licensed Scintilla feeds directly from the App. Build documented curated tables or governed views at stable grains, such as:

- daily sales by item, location, and channel;
- inventory by item, location, and day;
- weekly plan and actuals;
- supported forecast and e-commerce metrics;
- executive weekly aggregates;
- product, store, date, and category dimensions.

Views avoid unnecessary copies of very large facts, but their owners must retain the required source privileges. Materialize only where measured performance requires it.

## Foundation Model calls

Use SDK-typed messages:

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

Plain dictionaries are not accepted by SDK versions that serialize messages through `.as_dict()`.

## Validation gates

- Permissions: both preflight stages return `ready: true`.
- Template: `verify_app_template.py` passes, including the reproducible UI build when npm is available.
- Inventory: every `REQUIRED_TABLES` entry exists with the required join/metric columns.
- Data: row counts, latest dates, supplier partitions, and join fanout are validated.
- UI parity and API: `verify_deployment.py` returns `ready: true`, so the served shell and every asset match the lock and every parameterless UI GET route returns JSON 2xx.
- Genie: approved prompts produce grounded SQL over curated objects only.
- Model: briefs use the bound endpoint and approved evidence.
- Security: runtime calls use the selected identity mode and only preflight-approved resources; user-authorized SQL is tested with a real signed-in viewer and never served from a cross-user cache.
- UX: no mock result is presented as live.
