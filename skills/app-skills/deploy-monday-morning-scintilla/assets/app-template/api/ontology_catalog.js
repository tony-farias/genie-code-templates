// Ontology catalog — the real joins, calculations, and query→visualization
// wiring MINED from this app's own route code (api/routes.scintilla.js) and
// the metric definitions in src/pages/ReferencePage.jsx. This is the substance
// behind the knowledge graph: not a toy model, the actual wiring the app runs.
//
// Kept as data (not re-parsed at runtime) so the graph is fast and stable, but
// every entry here corresponds to a real JOIN / formula / endpoint in the code.

// ── Domain grouping for coloring ─────────────────────────────────────────
export function ontologyGroup(name) {
  if (/prod_dim|_dim$|^dim_|calendar/.test(name)) return 'Dimension';
  if (/store_sales|omni_sales|upc_sales|register_sales/.test(name)) return 'Sales fact';
  if (/invt|inventory|fulfillment|^dc_|oos_/.test(name)) return 'Inventory / Supply';
  if (/forecast|dmnd/.test(name)) return 'Demand';
  if (/return/.test(name)) return 'Returns';
  if (/otif|affinity/.test(name)) return 'Supply chain';
  if (/ecom|digital|transactability|cntnt/.test(name)) return 'E-commerce';
  if (/status/.test(name)) return 'Ops metadata';
  return 'Other';
}

// ── Real joins mined from routes.scintilla.js + verified against the live
// scintilla_us_cloudfeeds schema (join keys confirmed by query). ──────────
export const JOINS = [
  { left: 'store_sales', right: 'item_dim',   key: 'wm_item_nbr', on: 'store_sales.wm_item_nbr = item_dim.wm_item_nbr', type: 'LEFT', card: 'many-to-one', note: 'Every store-sales line enriched with product hierarchy (dept, category, brand).' },
  { left: 'store_sales', right: 'store_dim',  key: 'store_nbr',   on: 'store_sales.store_nbr = store_dim.store_nbr',   type: 'INNER', card: 'many-to-one', note: 'Sales attributed to store geography for the store map + regional cuts.' },
  { left: 'store_invt',  right: 'item_dim',   key: 'wm_item_nbr', on: 'store_invt.wm_item_nbr = item_dim.wm_item_nbr',  type: 'LEFT', card: 'many-to-one', note: 'Inventory rows enriched with product hierarchy for category views.' },
  { left: 'item_affinity', right: 'item_dim', key: 'wm_item_nbr', on: 'item_affinity.wm_item_nbr = item_dim.wm_item_nbr', type: 'INNER', card: 'many-to-one', note: 'Basket co-purchase pairs scoped to a brand via the product hierarchy.' },
  { left: 'store_invt',  right: 'store_sales', key: 'wm_item_nbr', on: 'store_invt.wm_item_nbr = store_sales.wm_item_nbr AND store_invt.wm_yr_wk_nbr = (latest week)', type: 'LEFT', card: 'one-to-one (latest wk)', note: 'Joins on-hand to sales at the latest inventory week for Days of Supply.' },
  { left: 'store_invt',  right: 'dc_alignment', key: 'store_nbr', on: 'store_invt.store_nbr = dc_alignment.store_nbr',  type: 'INNER', card: 'many-to-one', note: 'Maps each store to its distribution center for supply-chain views.' },
  { left: 'store_demand_forecast', right: 'dc_alignment', key: 'store_nbr', on: 'store_demand_forecast.store_nbr = dc_alignment.store_nbr', type: 'INNER', card: 'many-to-one', note: 'Aligns store-level forecast to DC for network planning (Inventory Intel + Agents).' },
  { left: 'dc_alignment', right: 'dc_dim',    key: 'dc_nbr',      on: 'dc_alignment.dc_nbr = dc_dim.dc_nbr',            type: 'INNER', card: 'many-to-one', note: 'DC attributes (name, region) for the distribution network.' },
  { left: 'upc_sales',   right: 'item_dim',   key: 'wm_item_nbr', on: 'upc_sales.wm_item_nbr = item_dim.wm_item_nbr',   type: 'INNER', card: 'many-to-one', note: 'Category-share view: vendor UPC sales joined to product hierarchy for competitive cuts.' },
  { left: 'store_returns', right: 'store_sales', key: 'wm_item_nbr', on: 'store_returns.wm_item_nbr = store_sales.wm_item_nbr', type: 'LEFT', card: 'many-to-many', note: 'Return rate = returns / sales over the same window.' },
  { left: 'digital_transactability', right: 'item_dim', key: 'wm_item_nbr', on: 'digital_transactability.wm_item_nbr = item_dim.wm_item_nbr', type: 'INNER', card: 'many-to-one', note: 'E-commerce transactability signals enriched with the product hierarchy for action items.' },
  { left: 'oos_root_cause', right: 'store_invt', key: 'store_nbr / wm_item_nbr', on: 'oos_root_cause aligned to store_invt on store + item', type: 'LEFT', card: 'many-to-one', note: 'Out-of-stock root cause diagnosis used by the OOS agent.' },
];

// ── Metrics, tagged by how they are derived (audited against the live schema):
//   raw         = a stored column, read directly (no math)
//   aggregation = SUM/AVG of a single raw column
//   computed    = a ratio or multi-column formula the app calculates
export const CALCULATIONS = [
  { name: 'Total Sales',          kind: 'aggregation', formula: 'SUM(store_sales.sales_amt)', tables: ['store_sales'], note: 'sales_amt is a raw column; the app sums it over the window and vendor.' },
  { name: 'Store vs E-commerce',  kind: 'computed', formula: "share of SUM(sales_amt) split on svc_chnl_nm (BIS = in-store; DELIVERY/PICKUP/SFS = e-commerce)", tables: ['store_sales'], note: 'Derived channel bucketing of a raw column, then a share.' },
  { name: 'In-Stock Rate',        kind: 'computed', formula: '100 × SUM(ty_repl_instock_numerator) / SUM(ty_repl_instock_denominator)', tables: ['store_invt'], note: 'Ratio of two raw columns on the latest inventory week.' },
  { name: 'On Hand / Warehouse / In Transit', kind: 'raw', formula: 'ty_on_hand_qty, ty_in_whse_qty, ty_in_trnst_qty', tables: ['store_invt'], note: 'Raw quantity columns, summed. No derivation.' },
  { name: 'On Shelf & Backroom',  kind: 'computed', formula: 'On Shelf = on_hand × in-stock %; Backroom = on_hand − On Shelf', tables: ['store_invt'], note: 'Derived in app code from on-hand and the in-stock rate (max_shelf_qty is a separate raw capacity column).' },
  { name: 'Days of Supply',       kind: 'computed', formula: 'on-hand units ÷ average daily units sold, by category', tables: ['store_invt', 'store_sales'], note: 'Ratio across inventory and sales at the latest week.' },
  { name: 'Return Rate',          kind: 'computed', formula: '100 × SUM(store_returns.rtn_sales_amt) / SUM(store_sales.sales_amt)', tables: ['store_returns', 'store_sales'], note: 'Ratio of two raw sums; e-commerce reasons from ecom_returns.' },
  { name: 'Category Share',       kind: 'computed', formula: 'vendor UPC sales ÷ total category UPC sales', tables: ['upc_sales', 'item_dim'], note: 'Ratio within the same week window.' },
  { name: 'OTIF',                 kind: 'aggregation', formula: 'AVG(omni_otif.otif_pct)', tables: ['omni_otif'], note: 'otif_pct is a raw stored column; the app averages it.' },
  { name: 'Demand Forecast',      kind: 'raw', formula: 'SUM(dly_dmnd_fcst.fcst_tot_dmand_each_qty) vs store_sales actuals; nil-picks from store_fulfillment', tables: ['dly_dmnd_fcst', 'store_sales', 'store_fulfillment'], note: 'Forecast is a precomputed upstream column read as-is; the app does not run a live model.' },
];

// ── Query → visualization wiring mined from the app's endpoints, corrected
// against the real SQL each endpoint runs. ───────────────────────────────
export const QUERIES = [
  { endpoint: '/api/dashboard/kpis',          viz: 'Sales · headline KPIs',          page: 'Sales',     tables: ['store_sales', 'store_invt'] },
  { endpoint: '/api/dashboard/channel-mix',   viz: 'Sales · channel mix donut',      page: 'Sales',     tables: ['store_sales'] },
  { endpoint: '/api/dashboard/monthly-trend', viz: 'Sales · monthly trend line',     page: 'Sales',     tables: ['store_sales'] },
  { endpoint: '/api/dashboard/sales-by-category', viz: 'Sales · category bars',      page: 'Sales',     tables: ['store_sales', 'item_dim'] },
  { endpoint: '/api/dashboard/top-movers',    viz: 'Sales · top movers',             page: 'Sales',     tables: ['store_sales', 'item_dim'] },
  { endpoint: '/api/dashboard/underperformers', viz: 'Sales · underperformers',      page: 'Sales',     tables: ['store_sales', 'item_dim', 'store_invt'] },
  { endpoint: '/api/stores/map',              viz: 'Sales · store map',              page: 'Sales',     tables: ['store_sales', 'store_dim'] },
  { endpoint: '/api/returns/summary',         viz: 'Sales · returns summary',        page: 'Sales',     tables: ['store_returns', 'store_sales', 'ecom_returns'] },
  { endpoint: '/api/forecast/overview',       viz: 'Forecast · demand vs actuals + CI', page: 'Forecast', tables: ['dly_dmnd_fcst', 'store_sales', 'store_fulfillment', 'store_invt'] },
  { endpoint: '/api/inventory/flow',          viz: 'Inventory · flow ribbon',        page: 'Inventory', tables: ['store_invt'] },
  { endpoint: '/api/inventory/days-of-supply', viz: 'Inventory · days of supply',    page: 'Inventory', tables: ['store_invt', 'store_sales', 'item_dim'] },
  { endpoint: '/api/inv-intel/store-search',  viz: 'Inventory · DC network',         page: 'Inventory', tables: ['store_invt', 'store_demand_forecast', 'dc_alignment', 'dc_dim'] },
  { endpoint: '/api/hourly/heatmap',          viz: 'Hourly · inventory + fulfillment heatmap', page: 'Hourly', tables: ['hourly_store_invt', 'hourly_store_fulfillment', 'item_dim'] },
  { endpoint: '/api/category/competitive',    viz: 'Category · competitive share',   page: 'Category',  tables: ['upc_sales', 'item_dim'] },
  { endpoint: '/api/category/brand-velocity', viz: 'Category · brand velocity',      page: 'Category',  tables: ['store_sales', 'item_dim'] },
  { endpoint: '/api/supply/otif',             viz: 'Category · OTIF gauge',          page: 'Category',  tables: ['omni_otif'] },
  { endpoint: '/api/ecom/overview',           viz: 'E-com · transactability + content score', page: 'E-commerce', tables: ['digital_transactability', 'ecom_prod_cntnt_score', 'item_dim'] },
  { endpoint: '/api/ecom/action-items',       viz: 'E-com · prioritized action items', page: 'E-commerce', tables: ['digital_transactability', 'item_dim'] },
  { endpoint: '/api/agent/summary',           viz: 'Agents · replenishment + OOS findings', page: 'Agents', tables: ['store_invt', 'store_demand_forecast', 'store_sales', 'oos_root_cause'] },
];

// Curated fallback node set (used only when information_schema is not reachable)
// so the graph still renders the real table names + joins offline.
// The 22 tables the mounted routes.scintilla.js actually queries (verified
// 2026-09-22 against the live scintilla_us_cloudfeeds schema). omni_sales,
// prod_dim, and calendar_dim are in the feed but NOT queried, so excluded.
export const FALLBACK_TABLES = [
  'store_sales', 'upc_sales', 'store_returns', 'ecom_returns',
  'store_invt', 'hourly_store_invt', 'store_fulfillment', 'hourly_store_fulfillment',
  'dc_alignment', 'dc_dim', 'purchase_order',
  'dly_dmnd_fcst', 'store_demand_forecast',
  'item_dim', 'omni_item_dim', 'store_dim', 'upc_attr',
  'digital_transactability', 'ecom_prod_cntnt_score', 'omni_otif', 'oos_root_cause', 'item_affinity',
];

// ── Per-tab views ─────────────────────────────────────────────────────────
// The app's real navigation tabs. Each names the business question it answers,
// the tables it reads, the calculations it drives, and the AI models behind its
// recommendations. This is what makes the ontology readable tab-by-tab instead
// of one hairball. Tables/calcs are derived from QUERIES + CALCULATIONS above.
export const TABS = [
  {
    id: 'sales', label: 'Sales', accent: '#1B3139',
    question: 'Where is revenue growing or slipping, across store and omni channels, by category and store?',
    tables: ['store_sales', 'omni_item_dim', 'item_dim', 'store_dim', 'store_returns', 'ecom_returns', 'upc_sales'],
    calculations: ['Total Sales', 'Store vs E-commerce', 'Return Rate'],
    ai: ['exec-brief', 'breakdown-insight'],
  },
  {
    id: 'forecast', label: 'Forecast', accent: '#E39400',
    question: 'What is projected demand versus actuals, and where is fulfillment falling short?',
    tables: ['dly_dmnd_fcst', 'store_sales', 'store_fulfillment', 'store_invt'],
    calculations: ['Demand Forecast'],
    ai: [],  // forecast is precomputed upstream; no live model call
  },
  {
    id: 'inventory', label: 'Inventory', accent: '#C4432B',
    question: 'How healthy is on-shelf availability, and what should be replenished first?',
    tables: ['store_invt', 'store_sales', 'item_dim', 'store_demand_forecast', 'dc_alignment', 'dc_dim'],
    calculations: ['In-Stock Rate', 'On Hand / Warehouse / In Transit', 'On Shelf & Backroom', 'Days of Supply'],
    ai: ['exec-brief', 'breakdown-insight'],
  },
  {
    id: 'hourly', label: 'Hourly Stats', accent: '#2272B4',
    question: 'How do store inventory and fulfillment move hour by hour?',
    tables: ['hourly_store_invt', 'hourly_store_fulfillment', 'item_dim'],
    calculations: [],
    ai: [],
  },
  {
    id: 'category', label: 'Category', accent: '#8A63D2',
    question: 'How does the vendor compete on share, brand velocity, and service levels?',
    tables: ['upc_sales', 'item_dim', 'store_sales', 'omni_otif'],
    calculations: ['Category Share', 'OTIF'],
    ai: ['breakdown-insight'],
  },
  {
    id: 'ecom', label: 'E-com', accent: '#0E8A6A',
    question: 'How transactable and content-ready is the digital assortment, and what actions lift it?',
    tables: ['digital_transactability', 'ecom_prod_cntnt_score', 'item_dim', 'ecom_returns'],
    calculations: [],
    ai: ['ecom-actions', 'shopper-notes'],
  },
  {
    id: 'agents', label: 'Agents', accent: '#FF3621',
    question: 'Autonomous agents flag replenishment risk and diagnose out-of-stocks, plus ask anything in natural language.',
    tables: ['store_invt', 'store_demand_forecast', 'store_sales', 'oos_root_cause', 'item_dim'],
    calculations: [],
    ai: ['genie', 'supervisor', 'genie-summary'],
  },
];

// ── AI / model layer — the real models powering recommendations ───────────
// Every entry corresponds to a real model call in the app. `input`/`output`
// and `replicate` make this prescriptive: a customer can rebuild each capability
// in their own workspace by following the steps.
export const AI_MODELS = {
  'exec-brief': {
    model: 'databricks-claude-sonnet-4-6', kind: 'Foundation Model API',
    label: 'Executive brief', where: 'api/llm.js → serving-endpoints/databricks-claude-sonnet-4-6/invocations',
    desc: 'Turns the tab\'s KPIs into a plain-language executive brief and recommended actions.',
    input: 'The tab\'s computed KPIs (sales, in-stock, returns, OTIF) as a compact JSON context.',
    output: 'A short executive narrative plus 2 to 4 prioritized actions.',
    replicate: [
      'Enable the pay-per-token Foundation Model API in your workspace (or provision a Claude endpoint).',
      'Send the tab KPIs as the user message with a system prompt that asks for a brief + actions.',
      'Call POST /serving-endpoints/databricks-claude-sonnet-4-6/invocations with the app service principal token.',
      'Render the returned text in the AI insights panel.',
    ],
  },
  'breakdown-insight': {
    model: 'databricks-claude-sonnet-4-6', kind: 'Foundation Model API',
    label: 'Drill-down insight', where: 'api/llm.js → generateBreakdownInsight',
    desc: 'Explains the standout signal as you drill into a category or store hierarchy node.',
    input: 'The rows at the current hierarchy level (category or store) with their deltas.',
    output: 'One or two sentences naming the standout mover and why.',
    replicate: [
      'Reuse the same Claude serving endpoint.',
      'Pass the drill-down rows and ask for the single most important signal.',
      'Cache by hierarchy node so you do not re-call on every expand.',
    ],
  },
  'ecom-actions': {
    model: 'databricks-claude-sonnet-4-6', kind: 'Foundation Model API',
    label: 'E-commerce action items', where: '/api/ecom/action-items',
    desc: 'Generates prioritized digital-channel actions from transactability and content-score signals.',
    input: 'digital_transactability + ecom_prod_cntnt_score aggregates per item.',
    output: 'A ranked list of concrete merchandising / content actions.',
    replicate: [
      'Aggregate transactability and content score by item.',
      'Prompt Claude to rank the biggest gaps into actions.',
      'Return the list to the E-com action-items panel.',
    ],
  },
  'shopper-notes': {
    model: 'databricks-bge-large-en', kind: 'Vector Search',
    label: 'Shopper-note retrieval', where: 'api/vector_search.js → shopper_notes_vs_index',
    desc: 'Semantic retrieval over shopper notes (bge-large-en embeddings) for qualitative context.',
    input: 'A natural-language query embedded with bge-large-en.',
    output: 'The most semantically similar shopper notes.',
    replicate: [
      'Create a Delta table of shopper notes.',
      'Build a Vector Search index with the databricks-bge-large-en embedding model (Delta Sync).',
      'Query the index endpoint with the user text; the app embeds and retrieves top-k.',
    ],
  },
  'genie': {
    model: 'AI/BI Genie', kind: 'Genie space',
    label: 'Ask Genie', where: 'api/genie.js → Conversation API',
    desc: 'Natural-language questions answered as governed SQL over the curated tables.',
    input: 'A user question in natural language, scoped to the tab\'s tables.',
    output: 'Generated SQL, a result set, and a short answer.',
    replicate: [
      'Create a Genie space over the tab\'s tables and add sample questions + instructions.',
      'Grant the app service principal CAN RUN on the space.',
      'Call the Genie Conversation API (start conversation, send message, poll for result).',
    ],
  },
  'genie-summary': {
    model: 'databricks-claude-sonnet-4-6', kind: 'Foundation Model API',
    label: 'Answer summarization', where: 'api/llm.js → summarizeGenieResponse',
    desc: 'Summarizes Genie\'s query result into an executive-readable takeaway.',
    input: 'Genie\'s query result rows + the original question.',
    output: 'A one-paragraph executive summary of the answer.',
    replicate: [
      'Take the Genie result and question.',
      'Prompt Claude for a concise executive summary.',
      'Show it above the raw result table.',
    ],
  },
  'supervisor': {
    model: 'Agent Bricks · Multi-Agent Supervisor', kind: 'Model Serving endpoint',
    label: 'Multi-agent supervisor', where: 'api/supervisor.js → /invocations',
    desc: 'Routes single-domain questions and synthesizes cross-domain ones across the Genie rooms.',
    input: 'A user question; the supervisor decides which domain Genie rooms to consult.',
    output: 'A synthesized cross-domain answer.',
    replicate: [
      'Build per-domain Genie rooms (sales, demand, inventory, ...).',
      'Create an Agent Bricks multi-agent supervisor that treats each room as a subagent.',
      'Serve it as a Model Serving endpoint and call /invocations with a chat payload.',
    ],
  },
};
