// Reference Architecture — the real cloud-feed → app data path, transformations,
// and the semantic/context layer (metric definitions) that Genie and the UI share.
import {
  Database, GitBranch, BookOpen, Boxes, Layers, Cpu, ArrowRight,
  Server, Sparkles, Network, Search, ShieldCheck, KeyRound, Cloud,
  ShoppingCart, Package, LineChart, Table2, MessageSquare, LayoutGrid,
} from 'lucide-react';
import AppHeader from '../components/AppHeader';
import OntologyGraph from '../components/OntologyGraph';
import { useApi, fmtNumber } from '../lib/api';

function Card({ title, icon, children, className = '' }) {
  const Icon = icon;
  return (
    <div className={`bg-card rounded-xl border border-border p-5 shadow-sm ${className}`}>
      {title && <div className="flex items-center gap-2 mb-3">{Icon && <Icon className="w-4 h-4 text-db-lava" />}<h3 className="text-sm font-semibold text-foreground">{title}</h3></div>}
      {children}
    </div>
  );
}

const LAYERS = [
  { id: 'ingest', name: 'Ingest · Cloud Feed Delivery', color: '#0E8A6A', tables: ['Scintilla US Cloudfeeds', 'daily refresh'], desc: 'Refined and delivered by the provider into Unity Catalog managed tables. Cleansing and conformance happen on the provider side before the data lands.' },
  { id: 'source', name: 'Governed Source · scintilla_us_cloudfeeds', color: '#8A9BA8', tables: ['61 feed tables', 'wm_item_nbr · store_nbr · bus_dt', 'wm_yr_wk_nbr'], desc: 'One flat governed schema is the single source of truth. The app service principal has read only access and nothing is copied out.' },
  { id: 'gold', name: 'App Consumption · Semantics at Query Time', color: '#FBB300', tables: ['22 of 61 tables used', 'metrics computed per query'], desc: 'Joins and business metrics (in-stock %, days of supply, OTIF, return rate) are computed in SQL as each query runs. No persisted aggregates, so every page reflects the latest feed refresh.' },
];

const METRICS = [
  { name: 'Total Sales', def: 'SUM(store_sales.sales_amt) over the selected window and vendor.', src: 'store_sales' },
  { name: 'Store vs E-commerce', def: "Channel split on svc_chnl_nm: BIS = in-store; DELIVERY / PICKUP / SFS = e-commerce.", src: 'store_sales' },
  { name: 'In-Stock Rate', def: '100 × SUM(ty_repl_instock_numerator) / SUM(ty_repl_instock_denominator) on the latest inventory week.', src: 'store_invt' },
  { name: 'Inventory Flow', def: 'Warehouse (ty_in_whse_qty) → In Transit (ty_in_trnst_qty) → On Hand (ty_on_hand_qty) → Shelf/Backroom split by in-stock %.', src: 'store_invt' },
  { name: 'Days of Supply', def: 'On-hand units ÷ average daily units sold, by category.', src: 'store_invt × store_sales' },
  { name: 'Return Rate', def: '100 × SUM(store_returns.rtn_sales_amt) / SUM(store_sales.sales_amt); reasons from ecom_returns.rtn_rsn_desc.', src: 'store_returns, ecom_returns' },
  { name: 'Category Share', def: "Vendor UPC sales ÷ total category UPC sales (upc_sales × upc_attr), same week window.", src: 'upc_sales, upc_attr, item_dim' },
  { name: 'OTIF', def: 'AVG(omni_otif.otif_pct); on-time and in-full are the two component rates.', src: 'omni_otif' },
  { name: 'Item Affinity', def: 'Top co-purchased items by shared basket count (item_affinity.affinity_basket_cnt).', src: 'item_affinity' },
];

// ── End-to-end reference architecture ─────────────────────────────────────
// Every node below maps to a real source / table / endpoint in this app:
// app.yaml (warehouse, catalog.schema, Genie space, Lakebase), api/sql.js
// (Statement Execution API), api/ontology_catalog.js (tables + models),
// api/supervisor.js, api/vector_search.js.
const SOURCES = [
  { icon: ShoppingCart, title: 'Retail Cloud Feeds', desc: 'Scintilla US Cloudfeeds: POS store sales, omni and e-commerce sales, UPC market sales, and returns landed into Unity Catalog.', tag: 'wm_item_nbr · store_nbr · bus_dt / wm_yr_wk_nbr' },
  { icon: Package, title: 'Inventory & Supply Feeds', desc: 'Store and hourly inventory positions, fulfillment, DC alignment, and OTIF service levels.', tag: 'store_invt · hourly_store_fulfillment · dc_alignment' },
  { icon: LineChart, title: 'Precomputed Demand Forecast', desc: 'Upstream forecast models land daily store-level demand as governed columns. The app reads them as stored, no live training.', tag: 'dly_dmnd_fcst · store_demand_forecast' },
  { icon: Search, title: 'Digital & Qualitative Signals', desc: 'E-commerce transactability, content scores, out-of-stock root cause, and shopper notes for semantic retrieval.', tag: 'digital_transactability · shopper_notes' },
];

// Verified 2026-09-22 against the live schema and the mounted
// routes.scintilla.js: the app queries 22 of the 61 tables in
// scintilla_us_cloudfeeds. Only tables actually referenced in the route SQL
// are listed here (omni_sales, prod_dim, calendar_dim exist in the feed but
// are NOT queried, so they are intentionally excluded).
const GOLD = [
  { domain: 'Sales & Channel', tables: ['store_sales', 'upc_sales', 'store_returns', 'ecom_returns'] },
  { domain: 'Inventory & Supply', tables: ['store_invt', 'hourly_store_invt', 'store_fulfillment', 'hourly_store_fulfillment', 'dc_alignment', 'dc_dim', 'purchase_order'] },
  { domain: 'Demand', tables: ['dly_dmnd_fcst', 'store_demand_forecast'] },
  { domain: 'Product & Reference', tables: ['item_dim', 'omni_item_dim', 'store_dim', 'upc_attr'] },
  { domain: 'E-com & Service', tables: ['digital_transactability', 'ecom_prod_cntnt_score', 'omni_otif', 'oos_root_cause', 'item_affinity'] },
];

const AI_LAYER = [
  { icon: Cpu, title: 'Foundation Model API', model: 'databricks-claude-sonnet-4-6', desc: 'Executive briefs, drill-down insights, e-commerce actions, and Genie answer summaries.' },
  { icon: Sparkles, title: 'AI/BI Genie', model: '"Monday Morning Sales" space', desc: 'Natural-language questions answered as governed SQL over the curated tables.' },
  { icon: Network, title: 'Agent Bricks Supervisor', model: 'Model Serving endpoint', desc: 'Routes single-domain questions and synthesizes cross-domain answers across the Genie rooms.' },
  { icon: Search, title: 'Vector Search', model: 'monday-morning-vs · bge-large-en', desc: 'Semantic retrieval over shopper_notes_vs_index for qualitative shopper context.' },
];

const APP_TABS = ['Sales', 'Forecast', 'Inventory', 'Hourly', 'Category', 'E-com', 'Agents'];

const FOUNDATION = [
  // sub is filled from /api/architecture/stats so it names the configured schema.
  { icon: ShieldCheck, label: 'Governance', value: 'Unity Catalog', sub: null },
  { icon: KeyRound, label: 'Identity & Access', value: 'Service Principal OAuth (M2M)', sub: 'all-apis scope · read-only on feeds' },
  { icon: Server, label: 'Compute', value: 'Serverless SQL Warehouse', sub: 'Statement Execution API' },
  { icon: Cloud, label: 'App Hosting', value: 'Databricks Apps', sub: 'Node + Express + Vite React SPA' },
  { icon: Database, label: 'Operational Store', value: 'Lakebase (Postgres OLTP)', sub: 'monday_morning_chat · write-back' },
];

export default function ReferencePage() {
  const { data } = useApi('/api/architecture/stats', { raw: true });
  const { data: onto } = useApi('/api/architecture/ontology', { raw: true });
  return (
    <div className="min-h-screen bg-background md:pl-56">
      <AppHeader />
      <div className="px-4 md:px-6 py-6 max-w-[1200px] mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><GitBranch className="w-6 h-6 text-db-lava" /> Reference Architecture</h1>
          <p className="text-sm text-muted-foreground">How cloud feeds become live, governed analytics — and the shared metric definitions behind every number.</p>
        </div>

        {/* ── End-to-end reference architecture (the system at a glance) ── */}
        <Card title="Data Intelligence Platform — End-to-End Reference Architecture" icon={Layers}>
          <p className="text-xs text-muted-foreground mb-4">
            How Scintilla retail cloud feeds become a live, governed, AI-powered application. Everything runs on one Databricks platform, governed by Unity Catalog, with no data copied out of the lakehouse.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_28px_1.9fr_28px_1fr] gap-3 items-stretch">
            {/* LEFT · Data sources */}
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-db-info mb-1">Data Sources</div>
              {SOURCES.map((s) => (
                <div key={s.title} className="rounded-lg border border-border bg-background p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <s.icon className="w-4 h-4 text-db-info shrink-0" />
                    <span className="text-xs font-semibold text-foreground">{s.title}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">{s.desc}</p>
                  <p className="text-[10px] font-mono text-db-info mt-1 break-all">{s.tag}</p>
                </div>
              ))}
            </div>

            {/* arrow */}
            <div className="hidden lg:flex items-center justify-center text-muted-foreground" aria-hidden="true"><ArrowRight className="w-5 h-5" /></div>

            {/* CENTER · Databricks platform */}
            <div className="rounded-xl border-2 border-db-lava/30 bg-db-accent-tint/40 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-sm bg-db-lava" aria-hidden="true" />
                <span className="text-xs font-bold text-foreground">Databricks Data Intelligence Platform</span>
              </div>

              {/* honest flow: governed feed → query-time semantic layer */}
              <div className="flex items-center flex-wrap gap-1.5 text-[10px]">
                <span className="font-semibold px-2 py-1 rounded" style={{ color: '#0E8A6A', background: '#0E8A6A18' }}>Governed cloud feed · 61 tables</span>
                <ArrowRight className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
                <span className="font-semibold px-2 py-1 rounded" style={{ color: '#FF3621', background: '#FF362115' }}>App semantic layer · joins and metrics in SQL, computed per query</span>
                <span className="text-muted-foreground ml-1">no copied tables, one source of truth</span>
              </div>

              {/* Governed feed tables the app queries */}
              <div className="rounded-lg border border-db-warning/40 bg-card p-2.5">
                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                  <Table2 className="w-3.5 h-3.5 text-db-warning shrink-0" aria-hidden="true" />
                  <span className="text-[11px] font-bold text-foreground">Governed feed tables the app queries</span>
                  <span className="text-[10px] font-mono text-muted-foreground">22 of 61 in scintilla_us_cloudfeeds</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {GOLD.map((g) => (
                    <div key={g.domain} className="rounded border border-border bg-background p-2">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">{g.domain}</div>
                      <div className="flex flex-wrap gap-1">
                        {g.tables.map((t) => (
                          <code key={t} className="text-[9px] font-mono bg-accent rounded px-1 py-0.5 text-foreground">{t}</code>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-2 leading-snug">
                  The app reads these governed feed tables directly and computes every metric in SQL as each query runs: joins, in-stock rate, days of supply, OTIF, and return rate all happen on the fly with no intermediate tables. Medallion refinement is managed upstream by the Scintilla feed provider, not in this schema. The other 39 feed tables (planogram, traits, RFID, tender, e-com inventory, order feeds) are not queried.
                </p>
              </div>

              {/* Compute + Mosaic AI */}
              <div className="rounded-lg border border-db-lava/30 bg-card p-2.5">
                <div className="flex items-center gap-1.5 mb-2">
                  <Cpu className="w-3.5 h-3.5 text-db-lava" aria-hidden="true" />
                  <span className="text-[11px] font-bold text-foreground">Compute and Mosaic AI</span>
                </div>
                <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-semibold text-foreground bg-accent rounded px-2 py-1">
                  <Server className="w-3 h-3 text-db-lava" aria-hidden="true" /> Serverless SQL Warehouse · Statement Execution API
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {AI_LAYER.map((a) => (
                    <div key={a.title} className="rounded border border-border bg-background p-2">
                      <div className="flex items-center gap-1.5">
                        <a.icon className="w-3.5 h-3.5 text-db-lava shrink-0" aria-hidden="true" />
                        <span className="text-[11px] font-semibold text-foreground">{a.title}</span>
                      </div>
                      <div className="text-[9px] font-mono text-db-lava mt-0.5 break-all">{a.model}</div>
                      <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">{a.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* arrow */}
            <div className="hidden lg:flex items-center justify-center text-muted-foreground" aria-hidden="true"><ArrowRight className="w-5 h-5" /></div>

            {/* RIGHT · Consumers */}
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-db-success mb-1">Applications & Consumers</div>
              <div className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-center gap-2 mb-2">
                  <LayoutGrid className="w-4 h-4 text-db-success shrink-0" aria-hidden="true" />
                  <span className="text-xs font-semibold text-foreground">Monday Morning Lakehouse App</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {APP_TABS.map((t) => (
                    <span key={t} className="text-[10px] font-medium bg-accent rounded px-1.5 py-0.5 text-foreground">{t}</span>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-center gap-2 mb-1">
                  <MessageSquare className="w-4 h-4 text-db-success shrink-0" aria-hidden="true" />
                  <span className="text-xs font-semibold text-foreground">Ask Genie</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">Conversational surface embedded in every tab, backed by the supervisor and domain Genie rooms.</p>
              </div>
              <div className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Boxes className="w-4 h-4 text-db-success shrink-0" aria-hidden="true" />
                  <span className="text-xs font-semibold text-foreground">Take Action work orders</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">Recommendations write back to Lakebase, so actions persist outside the read-only feed.</p>
              </div>
            </div>
          </div>

          {/* Platform foundation bar */}
          <div className="mt-3 rounded-xl bg-db-navy text-white p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-white/60 mb-2">Platform Foundation</div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
              {FOUNDATION.map((f) => (
                <div key={f.label} className="rounded-lg bg-white/5 border border-white/10 p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <f.icon className="w-3.5 h-3.5 text-db-lava shrink-0" aria-hidden="true" />
                    <span className="text-[10px] font-bold uppercase tracking-wide text-white/60">{f.label}</span>
                  </div>
                  <div className="text-xs font-semibold text-white">{f.value}</div>
                  <div className="text-[10px] font-mono text-white/50 mt-0.5 break-all">
                    {f.sub ?? (data?.source ? `${data.source.catalog}.${data.source.schema}` : '—')}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* production path */}
          <div className="mt-3 rounded-lg border border-db-info/30 bg-db-info-tint p-3 flex gap-2 items-start">
            <ShieldCheck className="w-4 h-4 text-db-info shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-[11px] text-foreground leading-snug">
              <b>Where the semantics live, and the production path.</b> Today the metric definitions live in app SQL (api/routes.scintilla.js) and in the Genie space instructions, the same definitions in two places. The production pattern is to promote them into Unity Catalog as metric views or a governed gold view layer, so the app, Genie, and BI tools all read one governed definition. A first version of that layer already exists in this workspace as scintilla_app_ro (28 governed views, currently unused since the app was pointed at the feed directly).
            </p>
          </div>
        </Card>

        {/* knowledge graph — per-tab ontology: joins, calculations, AI models */}
        <Card title="Data & AI Ontology — how each tab joins data, calculates metrics, and applies AI" icon={GitBranch}>
          {onto
            ? <OntologyGraph data={onto} />
            : <p className="text-xs text-muted-foreground py-8 text-center">Loading ontology…</p>}
        </Card>

        {/* live stats strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            ['Sales rows', data?.counts?.store_sales],
            ['Inventory rows', data?.counts?.store_invt],
            ['Items', data?.counts?.items],
            ['Stores', data?.counts?.stores],
            ['Hourly rows', data?.counts?.hourly_ff],
          ].map(([l, v]) => (
            <div key={l} className="bg-card rounded-xl border border-border p-4 text-center shadow-sm">
              <div className="text-xl font-bold text-foreground tabular-nums">{v != null ? fmtNumber(v) : '…'}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{l}</div>
            </div>
          ))}
        </div>

        {/* medallion flow */}
        <Card title="Data Flow — Feed to App" icon={Database}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {LAYERS.map((L, i) => (
              <div key={L.id} className="relative">
                <div className="rounded-lg border border-border p-4 h-full" style={{ borderTopColor: L.color, borderTopWidth: 3 }}>
                  <div className="flex items-center gap-2 mb-2"><Boxes className="w-4 h-4" style={{ color: L.color }} /><span className="font-semibold text-sm text-foreground">{L.name}</span></div>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-2">{L.desc}</p>
                  <div className="flex flex-wrap gap-1">
                    {L.tables.map((t) => <span key={t} className="text-[10px] font-mono bg-accent rounded px-1.5 py-0.5 text-foreground">{t}</span>)}
                  </div>
                </div>
                {i < LAYERS.length - 1 && <ArrowRight className="hidden md:block absolute -right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />}
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground bg-accent/40 rounded-lg p-2.5">
            <Cpu className="w-4 h-4 text-db-lava shrink-0" />
            The app runs on <b className="text-foreground mx-1">Databricks Apps</b> and queries the governed feed tables live via the SQL Statement Execution API on a serverless warehouse, so every page load reflects the latest feed refresh{data?.max_date ? ` (data through ${data.max_date})` : ''}.
          </div>
        </Card>

        {/* transformations */}
        <Card title="Key Transformations" icon={Layers}>
          <ul className="space-y-2 text-sm">
            {[
              ['Product hierarchy', 'item_dim flattens omni_seg → omni_dept → omni_catg → omni_subcatg → brand_nm → sku into a drillable tree.'],
              ['Channel normalization', 'svc_chnl_nm mapped to In-Store (BIS) vs e-commerce (Delivery / Pickup / SFS) for consistent channel reporting.'],
              ['Fiscal calendar join', 'wm_yr_wk_nbr aligns daily bus_dt facts to the 4-5-4 retail calendar for week-to-date and 52-week windows.'],
              ['Inventory position', 'store_invt latest-week snapshot resolves warehouse / transit / on-hand / shelf into a single flow, with in-stock ratio.'],
              ['Market attribution', 'upc_attr maps UPCs to categories so a vendor can be measured against the whole market, not just its own sales.'],
              ['Governed access', 'The app service principal holds read only grants on the feed schema in Unity Catalog and every query runs through it. A governed view layer (scintilla_app_ro) also exists in the workspace, but the app no longer depends on it.'],
            ].map(([h, d]) => (
              <li key={h} className="flex gap-2"><span className="text-db-lava mt-1">▹</span><span><b className="text-foreground">{h}.</b> <span className="text-muted-foreground">{d}</span></span></li>
            ))}
          </ul>
        </Card>

        {/* semantic / context layer */}
        <Card title="Context Layer — Metric Definitions" icon={BookOpen}>
          <p className="text-xs text-muted-foreground mb-3">The shared semantic layer. Every KPI, chart, and Genie answer computes from these exact definitions, so the number is the same everywhere.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="bg-accent text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 text-left">Metric</th><th className="px-3 py-2 text-left">Definition</th><th className="px-3 py-2 text-left">Source</th>
              </tr></thead>
              <tbody>
                {METRICS.map((m) => (
                  <tr key={m.name} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-semibold text-foreground whitespace-nowrap">{m.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{m.def}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-db-lava whitespace-nowrap">{m.src}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* refresh status */}
        {data?.refresh?.length > 0 && (
          <Card title="Feed Refresh Status" icon={Database}>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {data.refresh.map((r) => (
                <div key={r.table} className="flex items-center justify-between text-xs border border-border rounded-lg px-3 py-2">
                  <span className="font-mono text-foreground truncate">{r.table}</span>
                  <span className={'ml-2 shrink-0 ' + (String(r.status).toLowerCase().includes('success') || String(r.status).toLowerCase().includes('complete') ? 'text-db-success' : 'text-muted-foreground')}>{r.status} · {r.date}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
