# Customer deployment architecture

## Simplified core runtime

```text
Viewer group -> Databricks App CAN USE
                    |
                    v
              React/Vite SPA
                    |
                    v
              Express REST API
                    |
                    +-> App service principal -> serverless SQL warehouse
                    |                              -> curated UC schema
                    +-> App service principal -> approved Genie Spaces
                    +-> App service principal -> Foundation Model endpoint
```

The App service principal is the shared runtime identity. The deployment identity builds curated objects and deploys App code but is not used by the running App. Viewers do not receive direct data or compute permissions unless the customer explicitly selects a delegated per-user authorization design.

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
- require exact warehouse, model endpoint, and approved Genie bindings;
- verify the service principal has access only to the curated data boundary needed here;
- have an administrator revoke unrelated historical grants.

## App configuration

Parameterize at minimum:

- `WAREHOUSE_ID`, `CATALOG`, and `SCHEMA`;
- shared and page-specific `GENIE_SPACE_*` IDs;
- `LLM_MODEL`;
- the App name and viewer group used by deployment automation.

Do not include Lakebase, Vector Search, or supervisor settings in the core configuration. Do not copy resource IDs from another workspace.

## Resource bindings

Configure resources through the Databricks Apps API:

- SQL warehouse: `CAN USE`;
- Foundation Model endpoint: `CAN QUERY`;
- each approved Genie Space: `CAN RUN`.

Do not rely on a `resources` section in `app.yaml`. Use the App's `application_id` UUID for Unity Catalog grants. The App receives `USE CATALOG`, `USE SCHEMA`, and `SELECT` only on the dedicated curated schema.

The default shared-identity design does not request delegated SQL or Genie scopes. If per-user auditing, row filters, or different data entitlements are required, switch explicitly to delegated identity and grant a viewer group the required warehouse, Genie, and curated-data privileges.

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
- Inventory: every enabled capability has source tables and required join/metric columns.
- Data: row counts, latest dates, supplier partitions, and join fanout are validated.
- API: `/api/health` and every enabled route return 2xx.
- Genie: approved prompts produce grounded SQL over curated objects only.
- Model: briefs use the bound endpoint and approved evidence.
- Security: runtime calls use the App service principal and only preflight-approved resources.
- UX: unavailable capabilities are disabled; no mock result is presented as live.
