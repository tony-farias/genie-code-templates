# Golden App contract

The Monday Morning App is a versioned product asset, not a generated design. `assets/app-template` holds the only approved source and its compiled UI build. `assets/app-template/template-lock.json` records the SHA-256 of every file, and `scripts/app_contract.py` is the machine-readable form of this contract.

## Generation boundary

A skill run may change only the `app.yaml` env values, and only through `scripts/render_app.py`. Every other file, including the compiled `dist/` UI, ships byte-for-byte. Do not ask an LLM to restyle, rearrange, rebuild, or rewrite React, HTML, CSS, backend routes, or interaction copy during deployment.

The configurable values are:

| Setting | Required | Purpose |
|---|---|---|
| `WAREHOUSE_ID` | yes | Serverless SQL warehouse the App queries |
| `CATALOG`, `SCHEMA` | yes | Schema the App reads: the licensed schema (user mode) or a curated one |
| `AUTHORIZATION_MODE` | yes | `user` (default) runs SQL and Genie as the signed-in viewer; `app` runs them as the App service principal |
| `GENIE_SPACE_ID` | yes | Approved Genie Space behind "Ask Genie" |
| `LLM_MODEL` | yes | Foundation Model endpoint name |
| `OUTCOME_MAPS_URL` | no | Sidebar link back to the Outcome Maps deck; empty hides it |
| `TABLE_MAP` | no | JSON map from the App's table names to differently named tables in `CATALOG.SCHEMA`, or to a read-only `SELECT`; `{}` when names already match. Rendered from `--table-map` |

## Why the UI cannot drift

- The UI is the committed `dist/` build. `scripts/verify_app_template.py` rebuilds it from the locked source and lockfile in a clean directory and requires a byte-identical result.
- `package.json` has no `build` script. Databricks Apps runs `npm run build` during deployment when one exists, so its absence keeps the platform from rebuilding the UI. Maintainers build with `npm run build:ui`.
- `app.yaml` refuses to start when `dist/index.html` is missing instead of building a replacement.
- `scripts/render_app.py` refuses to render from a drifted template and verifies its output against the lock.
- `scripts/verify_deployment.py` downloads the served shell and every hashed asset from the running App and compares each with the lock.

## Stable surfaces

Sidebar navigation, in order: Home, Sales, Forecast, Inventory, Hourly Stats, Category, E-com, Agents, Commerce Exchange, then Personalized and Architecture. The legacy routes `/app/summary` (redirects to Sales) and `/app/sku/:skuId` remain routed.

The App has no per-feature flags. Every page queries `CATALOG.SCHEMA`, so every table in `REQUIRED_TABLES` must exist there under its own name or through `TABLE_MAP`. Each mapped table becomes a CTE prepended to the statements that use it, so no view or other object is created. A missing feed is a deployment blocker; never hide, stub, or regenerate a page to work around it.

## Stable API routes

The UI calls these routes; `verify_app_template.py` proves each is mounted, and that the UI calls nothing else.

| Method | Routes |
|---|---|
| GET | `/api/health`, `/api/whoami`, `/api/meta`, `/api/vendors`, `/api/personas`, `/api/categories`, `/api/stores`, `/api/stores/map` |
| GET | `/api/home/insights`, `/api/dashboard/{kpis,channel-mix,monthly-trend,sales-by-category,top-movers,underperformers}` |
| GET | `/api/breakdown/{hierarchy,insight}`, `/api/returns/summary`, `/api/reviews/summary`, `/api/report/debrief` |
| GET | `/api/inventory/{flow,days-of-supply}`, `/api/supply/otif`, `/api/forecast/overview`, `/api/hourly/heatmap` |
| GET | `/api/category/{competitive,brand-velocity,penetration}`, `/api/ecom/{overview,action-items}` |
| GET | `/api/inv-intel/{entities,store-search}`, `/api/agents/roster`, `/api/actions`, `/api/architecture/{stats,ontology}` |
| GET (path parameter) | `/api/agents/run/:id`, `/api/inv-intel/{dc/:dcNbr,store/:storeNbr,heatmap/:storeNbr}`, `/api/item/affinity/:skuId` |
| POST | `/api/actions`, `/api/genie/ask`, `/api/home/brief` |

`verify_deployment.py` calls every parameterless GET and requires JSON 2xx. It never calls POST routes.

Known gap: the legacy SKU detail page requests `/api/sku/:skuId`, which the backend does not mount. The recorded build has the same behavior; fixing it is a template change.

## Change control

The template uses semantic versions. A visual, route, schema, or interaction change requires:

1. Edit the source under `assets/app-template` (not `dist/`).
2. Update `scripts/app_contract.py` if pages, routes, settings, or tables change, and bump `TEMPLATE_VERSION`.
3. Run `python3 scripts/verify_app_template.py --update-lock` to rebuild `dist/` and approve the new hashes.
4. Run `python3 scripts/verify_app_template.py` and `python3 -m unittest discover -s tests`.
5. Inspect every page in a running App before committing.

Ordinary deployments run the gates without `--update-lock`. A mismatch is a deployment failure, not an invitation to regenerate the UI.
