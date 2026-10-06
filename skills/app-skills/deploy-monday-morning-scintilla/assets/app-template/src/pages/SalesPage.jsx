// Sales Performance — retail cloud feeds live data.
// Global vendor + date filter drives everything. Three sub-tabs:
//   Executive Summary · Detailed Breakdown · AI Genie
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, BarChart, Bar,
} from 'recharts';
import { Sparkles, TrendingUp, TrendingDown, Package, Truck, Store, Boxes, Star, RotateCcw, Lightbulb, Code2 } from 'lucide-react';
import AppHeader from '../components/AppHeader';
import FilterBar from '../components/FilterBar';
import StoreMap from '../components/StoreMap';
import AskGenieButton from '../components/AskGenieButton';
import TakeActionButton from '../components/TakeActionButton';
import SalesDebriefReport from '../components/SalesDebriefReport';
import { useApi, fmtCurrency, fmtNumber, fmtPct } from '../lib/api';
import { useFilters } from '../lib/filters.jsx';

const LAVA = '#FF3621';
const CATCOLORS = ['#FF3621', '#0B2026', '#00A972', '#FBB300', '#8AB4F8', '#A66BFF'];

function Card({ title, action, children, className = '' }) {
  return (
    <div className={`bg-card rounded-xl border border-border p-5 shadow-sm ${className}`}>
      {title && (
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

function Kpi({ title, value, sub, subColor, ask }) {
  return (
    <div className="group relative bg-card rounded-xl border border-border p-4 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="text-2xl font-bold tabular-nums text-foreground mt-1">{value}</div>
      {sub && <div className={`text-xs mt-1 ${subColor || 'text-muted-foreground'}`}>{sub}</div>}
      {ask && (
        <div className="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <AskGenieButton question={ask} label="Ask" compact title={ask} />
        </div>
      )}
    </div>
  );
}

export default function SalesPage() {
  const [tab, setTab] = useState('exec');
  return (
    <div className="min-h-screen bg-background md:pl-56">
      <AppHeader />
      <FilterBar />
      <div className="px-4 md:px-6 py-5 max-w-[1600px] mx-auto">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-foreground">Monday Morning</h1>
          <p className="text-sm text-muted-foreground font-mono">Retail Insights</p>
        </div>
        <div className="inline-flex rounded-lg bg-accent p-1 mb-5">
          {[['exec', 'Overview'], ['summary', 'Executive Summary'], ['breakdown', 'Detailed Breakdown'], ['genie', 'AI Genie']].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={'px-4 py-1.5 rounded-md text-sm font-medium transition-colors ' + (tab === id ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'exec' && <ExecTab />}
        {tab === 'summary' && <SalesDebriefReport inline />}
        {tab === 'breakdown' && <BreakdownTab />}
        {tab === 'genie' && <GenieTab />}
      </div>
    </div>
  );
}

/* ─────────────────────────── EXECUTIVE SUMMARY ─────────────────────────── */
function ExecTab() {
  const kpis = useApi('/api/dashboard/kpis');
  const k = kpis.data?.[0] || {};
  return (
    <div className="space-y-5">
      {/* AI insight — first-field full-width card */}
      <AiInsightCard />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi title="Total Sales" value={fmtCurrency(k.total_sales)} sub={fmtPct(k.total_sales_vs_plan, { sign: true }) + ' vs prior period'} subColor={k.total_sales_vs_plan >= 0 ? 'text-db-success' : 'text-db-error'}
          ask={k.total_sales_vs_plan >= 0
            ? `Total sales are up ${fmtPct(k.total_sales_vs_plan)} over the last 4 weeks versus the prior 4 weeks. Which categories and channels are driving the growth? Break it down at the category level.`
            : `Total sales are down ${fmtPct(Math.abs(k.total_sales_vs_plan))} over the last 4 weeks versus the prior 4 weeks. Which categories, brands, and stores are driving the decline?`} />
        <Kpi title="Store Sales (BIS)" value={fmtCurrency(k.comp_store_sales)}
          ask="How do brick-and-mortar store sales compare over the last 4 weeks versus the prior 4 weeks, and which stores are underperforming?" />
        <Kpi title="E-commerce Sales" value={fmtCurrency(k.ecommerce_sales)}
          ask="Break down e-commerce sales by channel (delivery, pickup, ship-from-store) over the last 4 weeks, and show the trend versus the prior 4 weeks." />
        <Kpi title="Units Sold" value={fmtNumber(k.transaction_count)}
          ask="How have units sold trended over the last 13 weeks, and how does that compare to the dollar sales trend?" />
        <Kpi title="In-Stock Rate" value={k.in_stock_rate != null ? `${k.in_stock_rate}%` : '—'} subColor={k.in_stock_rate >= 95 ? 'text-db-success' : 'text-db-warning'}
          ask={k.in_stock_rate != null && k.in_stock_rate < 95
            ? `In-stock rate is ${k.in_stock_rate}%, below the 95% target. Which stores and categories have the worst on-shelf availability right now?`
            : `In-stock rate is ${k.in_stock_rate}%. Which stores and categories are at highest risk of falling below the 95% target right now?`} />
        <Kpi title="Avg Unit Retail" value={k.gross_margin != null ? `$${Number(k.gross_margin).toFixed(0)}` : '—'}
          ask="How has average unit retail changed over the last 4 weeks versus the prior 4 weeks, and which categories are seeing the biggest price moves?" />
        <Kpi title="Scan Count" value={fmtNumber(k.customer_traffic)}
          ask="How has scan count (customer traffic) trended over the last 13 weeks, and how does it track with sales?" />
        <Kpi title="On-Shelf Avail." value={k.on_time_delivery != null ? `${k.on_time_delivery}%` : '—'}
          ask="Where are the biggest on-shelf availability gaps right now, and how much sales are they putting at risk?" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <InventoryFlow />
        <ChannelMix />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <MonthlyTrend />
        <SalesByCategory />
      </div>
      <StoreMapCard />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <MoversCard endpoint="/api/dashboard/top-movers" title="Top Movers" up />
        <MoversCard endpoint="/api/dashboard/underperformers" title="Underperformers" />
        <DaysOfSupplyCard />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ReturnsCard />
        <ReviewsCard />
      </div>
    </div>
  );
}

function AiInsightCard() {
  const kpis = useApi('/api/dashboard/kpis');
  const cats = useApi('/api/dashboard/sales-by-category');
  const returns = useApi('/api/returns/summary');
  const otif = useApi('/api/supply/otif');
  const { rangeLabel, vendor } = useFilters();
  const k = kpis.data?.[0];
  const insights = useMemo(() => {
    const out = [];
    if (k) {
      out.push(k.total_sales_vs_plan >= 0
        ? `Sales are up ${fmtPct(k.total_sales_vs_plan)} vs the prior period at ${fmtCurrency(k.total_sales)}.`
        : `Sales are down ${fmtPct(Math.abs(k.total_sales_vs_plan))} vs the prior period; investigate velocity by category.`);
      if (k.in_stock_rate != null) out.push(k.in_stock_rate >= 95
        ? `In-stock is healthy at ${k.in_stock_rate}% — availability isn't capping sales.`
        : `In-stock at ${k.in_stock_rate}% is below the 95% target; on-shelf gaps are likely leaking sales.`);
      const ecomShare = k.ecommerce_sales && k.total_sales ? Math.round(k.ecommerce_sales / k.total_sales * 100) : null;
      if (ecomShare != null) out.push(`E-commerce is ${ecomShare}% of tracked sales (delivery, pickup, ship-from-store).`);
    }
    if (cats.data?.length) out.push(`${cats.data[0].category_name} leads categories at ${fmtCurrency(cats.data[0].total_sales)}.`);
    if (returns.data?.return_rate_pct != null) out.push(`Return rate is ${returns.data.return_rate_pct}%; top reason: ${returns.data.reasons?.[0]?.reason || 'n/a'}.`);
    if (otif.data?.otif != null) out.push(`Supplier OTIF is ${otif.data.otif}% (on-time ${otif.data.on_time}%, in-full ${otif.data.in_full}%).`);
    return out;
  }, [k, cats.data, returns.data, otif.data]);

  // Turn the signals into executable recommendations, each routed to the right
  // work queue via `kind` (see ACTION_TEMPLATES on the server).
  const recommendations = useMemo(() => {
    const recs = [];
    if (k) {
      if (k.in_stock_rate != null && k.in_stock_rate < 95) {
        recs.push({ kind: 'replenishment', text: `Launch replenishment on low-availability stores — in-stock is ${k.in_stock_rate}%, below the 95% target.`,
          detail: `In-stock at ${k.in_stock_rate}%. Prioritize the lowest-availability, highest-sales stores to recover sales at risk.` });
      }
      if (k.total_sales_vs_plan < 0) {
        recs.push({ kind: 'category_review', text: `Open a category deep-dive — sales are down ${fmtPct(Math.abs(k.total_sales_vs_plan))} vs the prior period.`,
          detail: `Total sales ${fmtCurrency(k.total_sales)}, down ${fmtPct(Math.abs(k.total_sales_vs_plan))}. Isolate the declining subcategories and brands.` });
      }
    }
    if (otif.data?.otif != null && otif.data.otif < 92) {
      recs.push({ kind: 'supplier_review', text: `Escalate supplier OTIF — running ${otif.data.otif}%, under the 92% bar.`,
        detail: `OTIF ${otif.data.otif}% (on-time ${otif.data.on_time}%, in-full ${otif.data.in_full}%). Flag chronically late POs before they hit the shelf.` });
    }
    if (returns.data?.return_rate_pct != null && returns.data.reasons?.[0]) {
      recs.push({ kind: 'returns_mitigation', text: `Open a returns mitigation task — top reason "${returns.data.reasons[0].reason}" (${returns.data.reasons[0].pct}%).`,
        detail: `Return rate ${returns.data.return_rate_pct}%. Route "${returns.data.reasons[0].reason}" to the right owner (QA, content, or handling).` });
    }
    return recs.slice(0, 4);
  }, [k, returns.data, otif.data]);

  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-white via-[#FFF7F4] to-[#FFEDE7] rounded-xl border border-db-lava/15 p-5 shadow-sm">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-db-lava to-[#FF7A5C]" />
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-db-lava" />
          <h3 className="text-sm font-semibold text-foreground">AI Insights</h3>
        </div>
        <div className="flex items-center gap-2">
          <AskGenieButton
            question={k && k.total_sales_vs_plan < 0
              ? `Sales are down ${fmtPct(Math.abs(k.total_sales_vs_plan))} vs the prior period. Give me a full diagnosis: which categories, brands, channels, and stores are driving the decline, and what are the top actions to reverse it?`
              : 'Give me a full executive summary of sales performance this period: what is working, what needs attention, and the top recommended actions.'}
            label="Ask Genie"
          />
          <span className="text-[11px] text-muted-foreground ml-1">{vendor === 'all' ? 'All vendors' : 'Selected vendor'} · {rangeLabel}</span>
        </div>
      </div>
      {insights.length === 0 ? (
        <div className="text-xs text-muted-foreground">Analyzing the current view…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-2.5">
          {insights.map((t, i) => (
            <div key={i} className="text-[13px] leading-relaxed text-foreground/80 flex gap-2">
              <span className="text-db-lava mt-0.5 shrink-0">▹</span>{t}
            </div>
          ))}
        </div>
      )}

      {recommendations.length > 0 && (
        <div className="mt-4 pt-4 border-t border-db-lava/10">
          <div className="flex items-center gap-1.5 mb-2.5">
            <Lightbulb className="w-3.5 h-3.5 text-db-warning" />
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recommended Actions</h4>
          </div>
          <div className="space-y-2">
            {recommendations.map((r, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg bg-white/80 border border-border px-3 py-2.5 shadow-sm">
                <span className="text-db-lava mt-0.5 shrink-0">▹</span>
                <span className="flex-1 text-[13px] leading-relaxed text-foreground">{r.text}</span>
                <TakeActionButton kind={r.kind} title={r.text} detail={r.detail} app="sales" className="shrink-0" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InventoryFlow() {
  const { data } = useApi('/api/inventory/flow');
  const icons = { warehouse: Boxes, transit: Truck, onhand: Package, shelf: Store, backroom: Boxes };
  return (
    <Card title="Inventory Flow (units)" action={<AskGenieButton question="Show on-hand inventory by store location area (sales floor, backroom, receiving) for my top items. Where is stock sitting off the sales floor?" label="Ask Genie" compact />}>
      {!data ? <Skel /> : (
        <>
          <div className="flex items-stretch gap-1.5">
            {data.stages.map((s, i) => {
              const Icon = icons[s.id] || Package;
              return (
                <div key={s.id} className="flex items-center gap-1.5 flex-1">
                  <div className="flex-1 rounded-lg border border-border bg-accent/40 p-3 text-center">
                    <Icon className="w-4 h-4 mx-auto text-db-lava mb-1" />
                    <div className="text-lg font-bold tabular-nums text-foreground">{s.formatted}</div>
                    <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{s.label}</div>
                  </div>
                  {i < data.stages.length - 1 && <span className="text-muted-foreground text-sm">→</span>}
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-3 text-xs text-muted-foreground">
            <span>In-stock: <b className="text-foreground">{data.in_stock_pct}%</b></span>
            <span>On-hand retail: <b className="text-foreground">{fmtCurrency(data.on_hand_retail)}</b></span>
            <span>On order: <b className="text-foreground">{fmtNumber(data.on_order)}</b></span>
          </div>
        </>
      )}
    </Card>
  );
}

function ChannelMix() {
  const { data } = useApi('/api/dashboard/channel-mix');
  return (
    <Card title="Sales by Channel" action={<AskGenieButton question="Compare sales across channels (in-store, delivery, pickup, ship-from-store) with average unit retail, and show which channel is growing fastest." label="Ask Genie" compact />}>
      {!data ? <Skel /> : (
        <div className="space-y-2.5">
          {data.map((c, i) => {
            const max = Math.max(...data.map((x) => x.sales));
            return (
              <div key={c.channel}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-medium text-foreground">{c.label}</span>
                  <span className="tabular-nums text-muted-foreground">{fmtCurrency(c.sales)} · AUR ${c.aur}</span>
                </div>
                <div className="h-2.5 rounded-full bg-accent overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(c.sales / max) * 100}%`, background: CATCOLORS[i % CATCOLORS.length] }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function MonthlyTrend() {
  const { data } = useApi('/api/dashboard/monthly-trend');
  return (
    <Card title="Sales Trend" action={<AskGenieButton question="Show the monthly sales trend and call out the inflection points — which months over- or under-performed and why?" label="Ask Genie" compact />}>
      {!data ? <Skel /> : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
            <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={LAVA} stopOpacity={0.3} /><stop offset="100%" stopColor={LAVA} stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} tickFormatter={(m) => m?.slice(5)} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1e6).toFixed(0)}M`} />
            <RTooltip formatter={(v) => fmtCurrency(v)} />
            <Area type="monotone" dataKey="total_sales" stroke={LAVA} strokeWidth={2} fill="url(#g1)" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

function SalesByCategory() {
  const { data } = useApi('/api/dashboard/sales-by-category');
  return (
    <Card title="Sales by Category" action={<AskGenieButton question="Break down sales by category and rank them, showing each category's share of total and its growth vs the prior period." label="Ask Genie" compact />}>
      {!data ? <Skel /> : (
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={data} dataKey="total_sales" nameKey="category_name" cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={2}>
              {data.map((_, i) => <Cell key={i} fill={CATCOLORS[i % CATCOLORS.length]} />)}
            </Pie>
            <RTooltip formatter={(v) => fmtCurrency(v)} />
          </PieChart>
        </ResponsiveContainer>
      )}
      {data && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center">
          {data.map((c, i) => (
            <span key={c.category_name} className="text-[11px] text-muted-foreground flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ background: CATCOLORS[i % CATCOLORS.length] }} />{c.category_name} {fmtCurrency(c.total_sales)}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

function StoreMapCard() {
  const { data } = useApi('/api/stores/map');
  return (
    <Card title={`Store Performance Map${data ? ` · ${data.length} stores` : ''}`} action={<AskGenieButton question="Which stores have the highest sales but lowest in-stock — where am I leaving the most sales on the table due to availability?" label="Ask Genie" compact />}>
      {!data ? <Skel h={300} /> : <StoreMap stores={data} national />}
      {data && <p className="text-[11px] text-muted-foreground mt-2">Bubble size = sales · color = in-stock (green ≥90%, amber ≥80%, red &lt;80%).</p>}
    </Card>
  );
}

function MoversCard({ endpoint, title, up }) {
  const { data } = useApi(endpoint);
  const ask = up
    ? 'What are my top-moving SKUs by sales growth, and what is driving their momentum — promo, seasonality, or distribution?'
    : 'Which SKUs are underperforming the most vs the prior period, and what is the likely cause for each — price, availability, or demand?';
  return (
    <Card title={title} action={<AskGenieButton question={ask} label="Ask Genie" compact />}>
      {!data ? <Skel /> : (
        <ul className="space-y-2">
          {data.map((m) => (
            <li key={m.sku_id} className="flex items-center justify-between text-xs">
              <div className="min-w-0">
                <div className="font-medium text-foreground truncate">{m.sku_name}</div>
                <div className="text-muted-foreground">{m.category_name}</div>
              </div>
              <div className="text-right whitespace-nowrap ml-2">
                <div className="tabular-nums text-foreground">{fmtCurrency(m.total_sales)}</div>
                <div className={(m.vs_py_pct >= 0 ? 'text-db-success' : 'text-db-error') + ' flex items-center gap-0.5 justify-end'}>
                  {m.vs_py_pct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}{fmtPct(m.vs_py_pct, { sign: true })}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DaysOfSupplyCard() {
  const { data } = useApi('/api/inventory/days-of-supply');
  return (
    <Card title="On-Hand Days of Supply" action={<AskGenieButton question="Which categories have too few or too many days of on-hand supply, and where should I rebalance inventory?" label="Ask Genie" compact />}>
      {!data ? <Skel /> : (
        <ul className="space-y-2">
          {data.map((d) => (
            <li key={d.category} className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">{d.category}</span>
              <span className="tabular-nums text-muted-foreground">{d.days_of_supply} days · {fmtNumber(d.on_hand)} u</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ReturnsCard() {
  const { data } = useApi('/api/returns/summary');
  return (
    <Card title="Returns Analysis" action={<div className="flex items-center gap-2"><AskGenieButton question="What is my return rate and the top return reasons? Which SKUs and categories drive the most returns, and what should I do about it?" label="Ask Genie" compact /><RotateCcw className="w-4 h-4 text-muted-foreground" /></div>}>
      {!data ? <Skel /> : (
        <>
          <div className="flex items-baseline gap-3 mb-3">
            <span className="text-3xl font-bold text-db-lava tabular-nums">{data.return_rate_pct}%</span>
            <span className="text-xs text-muted-foreground">return rate · {fmtCurrency(data.return_amt)} on {fmtCurrency(data.sales_amt)} sales</span>
          </div>
          <div className="space-y-1.5">
            {data.reasons.map((r, i) => (
              <div key={r.reason}>
                <div className="flex justify-between text-[11px] mb-0.5"><span className="text-foreground">{r.reason}</span><span className="text-muted-foreground">{r.pct}%</span></div>
                <div className="h-2 rounded-full bg-accent overflow-hidden"><div className="h-full rounded-full" style={{ width: `${r.pct}%`, background: CATCOLORS[i % CATCOLORS.length] }} /></div>
              </div>
            ))}
          </div>
          {data.reasons[0] && (
            <div className="mt-3 bg-accent/40 rounded-lg p-2.5">
              <div className="flex gap-2 text-[12px] text-muted-foreground">
                <Lightbulb className="w-3.5 h-3.5 text-db-warning shrink-0 mt-0.5" />
                <span><b className="text-foreground">{data.reasons[0].reason}</b> drives {data.reasons[0].pct}% of returns. {reasonInsight(data.reasons[0].reason)}</span>
              </div>
              <div className="mt-2.5 flex justify-end">
                <TakeActionButton
                  kind="returns_mitigation"
                  title={`Mitigate returns driven by "${data.reasons[0].reason}"`}
                  detail={`${data.reasons[0].reason} drives ${data.reasons[0].pct}% of returns (rate ${data.return_rate_pct}%). ${reasonInsight(data.reasons[0].reason)}`}
                  app="sales"
                />
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
function reasonInsight(reason) {
  const r = (reason || '').toUpperCase();
  if (r.includes('DAMAGED')) return 'Likely packaging/handling in transit or backroom — review case-pack and pick flow.';
  if (r.includes('DESCRIBED')) return 'Content/attribute mismatch online — audit item copy and imagery.';
  if (r.includes('CHANGED MIND')) return 'Discretionary returns — often price/promo driven, lower operational risk.';
  if (r.includes('DEFECTIVE')) return 'Quality signal — flag to supplier QA and check specific lots.';
  return 'Investigate the driving SKUs and channel.';
}

function ReviewsCard() {
  const { data } = useApi('/api/reviews/summary');
  return (
    <Card title="Reviews & Sentiment" action={<div className="flex items-center gap-2"><AskGenieButton question="Which items have the lowest ratings and most negative reviews, and are those quality issues showing up in returns too?" label="Ask Genie" compact /><Star className="w-4 h-4 text-db-warning" /></div>}>
      {!data ? <Skel /> : (
        <>
          <div className="flex items-center gap-4 mb-3">
            <div><span className="text-3xl font-bold text-foreground tabular-nums">{data.avg_rating}</span><span className="text-muted-foreground text-sm"> / 5</span></div>
            <div className="text-xs text-muted-foreground">{fmtNumber(data.total_reviews)} reviews · {data.items} items<br /><span className="text-db-success">{data.positive} positive</span> · <span className="text-db-error">{data.negative} negative</span></div>
          </div>
          <div className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">Lowest rated (watch)</div>
          <ul className="space-y-1">
            {(data.lowest_rated || []).slice(0, 4).map((t, i) => (
              <li key={i} className="flex justify-between text-xs"><span className="text-foreground truncate">{t.sku_name}</span><span className="tabular-nums text-db-error ml-2">{t.rating}★ ({t.reviews})</span></li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/* ─────────────────────────── DETAILED BREAKDOWN (hierarchy drill + affinity) ─────────────────────────── */
// Inline expand/collapse tree. Aggregates stay visible; children indent under their
// parent. Each expanded node pulls a compact AI insight for that level.
const LEVELS = ['department', 'category', 'subcategory', 'brand', 'sku'];
const NEXT = { department: 'category', category: 'subcategory', subcategory: 'brand', brand: 'sku', sku: null };

function BreakdownTab() {
  const { data } = useApi('/api/breakdown/hierarchy?level=department');
  return (
    <Card title="Detailed Breakdown" action={<span className="text-[11px] text-muted-foreground">Click a row to expand · department → category → subcategory → brand → SKU</span>}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-accent text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 text-left">Hierarchy</th>
              <th className="px-3 py-2 text-right">Sales</th>
              <th className="px-3 py-2 text-right">Units</th>
              <th className="px-3 py-2 text-right">AUR</th>
              <th className="px-3 py-2 text-right">SKUs</th>
              <th className="px-3 py-2 text-right">In-Stock</th>
            </tr>
          </thead>
          <tbody>
            {!data ? (
              <tr><td colSpan={6}><Skel h={240} /></td></tr>
            ) : (
              data.rows.map((r) => <TreeNode key={r.name} row={r} level="department" depth={0} parent={null} />)
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function TreeNode({ row, level, depth, parent }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const nextLevel = NEXT[level];
  const isSku = level === 'sku';
  // fetch children only when opened
  const childQs = open && nextLevel ? `/api/breakdown/hierarchy?level=${nextLevel}&parent=${encodeURIComponent(row.name)}` : null;
  const children = useApi(childQs);
  const insightQs = open && nextLevel ? `/api/breakdown/insight?level=${nextLevel}&parent=${encodeURIComponent(row.name)}` : null;
  const insight = useApi(insightQs);

  return (
    <>
      <tr
        className={'border-t border-border ' + (isSku ? '' : 'cursor-pointer hover:bg-accent/40') + (open ? ' bg-accent/30' : '')}
        onClick={isSku ? undefined : () => setOpen((o) => !o)}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      >
        <td className="px-3 py-2 font-medium text-foreground relative">
          <span style={{ paddingLeft: depth * 16 }} className="inline-flex items-center gap-1">
            {!isSku && <span className={'text-muted-foreground transition-transform ' + (open ? 'rotate-90' : '')}>›</span>}
            {isSku && <span className="w-2.5 inline-block" />}
            {row.name}
          </span>
          {isSku && hover && <AffinityPop skuId={row.sku_id} />}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(row.sales)}</td>
        <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(row.units)}</td>
        <td className="px-3 py-2 text-right tabular-nums">${row.aur}</td>
        <td className="px-3 py-2 text-right tabular-nums">{row.skus}</td>
        <td className={'px-3 py-2 text-right tabular-nums ' + (row.in_stock >= 90 ? 'text-db-success' : row.in_stock >= 80 ? 'text-db-warning' : 'text-db-error')}>{row.in_stock != null ? `${row.in_stock}%` : '—'}</td>
      </tr>
      {open && insight.data?.insight && (
        <tr className="bg-db-navy/5">
          <td colSpan={6} className="px-3 py-1.5" style={{ paddingLeft: (depth + 1) * 16 + 12 }}>
            <span className="text-[11px] text-db-navy/80 flex items-center gap-1.5"><Sparkles className="w-3 h-3 text-db-lava" /> {insight.data.insight}</span>
          </td>
        </tr>
      )}
      {open && (
        children.loading ? (
          <tr><td colSpan={6} className="px-3 py-2" style={{ paddingLeft: (depth + 1) * 16 + 12 }}><span className="text-[11px] text-muted-foreground">Loading {nextLevel}…</span></td></tr>
        ) : (
          (children.data?.rows || []).map((c) => <TreeNode key={c.name} row={c} level={nextLevel} depth={depth + 1} parent={row.name} />)
        )
      )}
    </>
  );
}

// Note: sku rows come from the hierarchy endpoint keyed by item_name; we need the
// numeric sku id to hit affinity. The hierarchy sku level returns name only, so we
// look affinity up by a secondary call keyed on the row when an id is present.
function AffinityPop({ skuId, name }) {
  const { data } = useApi(skuId ? `/api/item/affinity/${skuId}` : null);
  return (
    <div className="absolute left-0 top-full mt-1 z-40 w-72 bg-db-navy text-white rounded-lg shadow-xl border border-white/10 p-3 text-xs" onClick={(e) => e.stopPropagation()}>
      <div className="font-semibold mb-2 flex items-center gap-1.5"><Package className="w-3.5 h-3.5 text-db-lava" /> Frequently bought with</div>
      {!skuId ? <div className="text-white/50">No item id.</div> : !data ? <div className="text-white/50">Loading…</div> : data.length === 0 ? <div className="text-white/50">No affinity data.</div> : (
        <ul className="space-y-1.5">
          {data.map((a) => (
            <li key={a.affinity_sku} className="flex justify-between gap-2">
              <span className="truncate text-white/85">{a.affinity_name}</span>
              <span className="tabular-nums text-white/50 whitespace-nowrap">{fmtNumber(a.baskets)} baskets</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─────────────────────────── AI GENIE (real Databricks Genie) ─────────────────────────── */
const GENIE_STARTERS = [
  'Which categories grew or declined the most over the last 4 weeks versus the prior 4 weeks?',
  'Which stores have the lowest in-stock rate right now?',
  'What are my top return reasons, and which items drive them?',
  'How have weekly sales trended over the last 13 weeks?',
];
function GenieTab() {
  const [q, setQ] = useState('');
  const [msgs, setMsgs] = useState([]); // {role, text, query?, error?}
  const [busy, setBusy] = useState(false);
  const [convId, setConvId] = useState(null);
  const scrollRef = useRef(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs, busy]);

  async function ask(question) {
    if (!question.trim() || busy) return;
    setMsgs((m) => [...m, { role: 'user', text: question }]);
    setQ(''); setBusy(true);
    try {
      const r = await fetch('/api/genie/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: question, conversation_id: convId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      if (j.conversation_id) setConvId(j.conversation_id);
      setMsgs((m) => [...m, { role: 'genie', text: j.answer, query: j.query }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'genie', text: `Genie error: ${e.message}`, error: true }]);
    } finally { setBusy(false); }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Card>
        <div className="flex items-center gap-2 mb-1"><Sparkles className="w-4 h-4 text-db-warning" /><h3 className="text-sm font-semibold text-foreground">Ask Genie</h3><span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-accent">Databricks Genie · live</span></div>
        <p className="text-xs text-muted-foreground mb-3">Ask anything about your data. Genie writes and runs the SQL, and keeps context across follow-up questions.</p>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask(q)} placeholder="Ask Genie anything…" disabled={busy}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-db-lava/40 disabled:opacity-60" />
          <button onClick={() => ask(q)} disabled={busy || !q.trim()} className="rounded-lg bg-db-lava text-white px-4 py-2 text-sm font-medium hover:bg-db-lava/90 disabled:opacity-50">Ask</button>
        </div>
        {msgs.length === 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {GENIE_STARTERS.map((s, i) => (
              <button key={i} onClick={() => ask(s)} className="text-[11px] rounded-full border border-border px-2.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground">{s}</button>
            ))}
          </div>
        )}
      </Card>

      {(msgs.length > 0 || busy) && (
        <Card>
          <div ref={scrollRef} className="space-y-3 max-h-[520px] overflow-y-auto">
            {msgs.map((m, i) => <GenieBubble key={i} m={m} />)}
            {busy && <div className="flex gap-1.5 items-center text-xs text-muted-foreground"><span className="w-2 h-2 rounded-full bg-db-lava animate-bounce" /><span className="w-2 h-2 rounded-full bg-db-lava animate-bounce" style={{ animationDelay: '120ms' }} /><span className="w-2 h-2 rounded-full bg-db-lava animate-bounce" style={{ animationDelay: '240ms' }} /> Genie is thinking…</div>}
          </div>
        </Card>
      )}
    </div>
  );
}

function GenieBubble({ m }) {
  const [showSql, setShowSql] = useState(false);
  if (m.role === 'user') return <div className="flex justify-end"><div className="bg-db-navy text-white rounded-lg rounded-br-sm px-3 py-2 text-sm max-w-[85%]">{m.text}</div></div>;
  const query = m.query;
  const cols = query?.columns || [], rows = query?.rows || [];
  const barData = (rows.length >= 2 && rows.length <= 25 && typeof rows[0]?.[0] === 'string' && !isNaN(Number(rows[0]?.[1])))
    ? rows.map((r) => ({ label: String(r[0]).slice(0, 28), value: Number(r[1]) })) : null;
  return (
    <div className="flex justify-start">
      <div className={`rounded-lg rounded-bl-sm px-3 py-2.5 text-sm w-full ${m.error ? 'bg-db-error/5 border border-db-error/30' : 'bg-accent'}`}>
        <p className={`leading-relaxed whitespace-pre-wrap ${m.error ? 'text-db-error' : 'text-foreground'}`}>{m.text}</p>
        {barData && (
          <div className="mt-2 rounded-lg border border-border p-2 bg-card">
            <ResponsiveContainer width="100%" height={Math.min(340, 26 * barData.length + 40)}>
              <BarChart data={barData} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E7EAEC" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 9, fill: '#5A6F77' }} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 9, fill: '#5A6F77' }} width={140} />
                <RTooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="value" fill="#FF3621" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-muted-foreground text-center">{cols[1]} by {cols[0]}</p>
          </div>
        )}
        {cols.length > 0 && rows.length > 0 && (
          <div className="mt-2 rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-card"><tr>{cols.map((c) => <th key={c} className="text-left p-1.5 font-semibold text-muted-foreground whitespace-nowrap">{c}</th>)}</tr></thead>
              <tbody>{rows.slice(0, 8).map((row, i) => <tr key={i} className="border-t border-border">{row.map((v, j) => <td key={j} className="p-1.5 tabular-nums whitespace-nowrap">{v == null ? '—' : String(v)}</td>)}</tr>)}</tbody>
            </table>
            {rows.length > 8 && <div className="text-[10px] text-muted-foreground p-1.5 border-t border-border">+ {rows.length - 8} more rows</div>}
          </div>
        )}
        {query?.sql && (
          <div className="mt-2 rounded-lg border border-border overflow-hidden">
            <button onClick={() => setShowSql((s) => !s)} className="w-full px-2.5 py-1.5 flex items-center justify-between text-[11px] font-medium text-muted-foreground hover:bg-accent/60">
              <span className="inline-flex items-center gap-1.5"><Code2 className="w-3.5 h-3.5" /> {showSql ? 'Hide SQL' : 'Show SQL'}</span>
            </button>
            {showSql && <pre className="text-[10px] font-mono p-2.5 bg-db-navy text-db-oat-medium overflow-x-auto whitespace-pre-wrap">{query.sql}</pre>}
          </div>
        )}
      </div>
    </div>
  );
}

function Skel({ h = 120 }) {
  return <div className="animate-pulse rounded-lg bg-accent/60" style={{ height: h }} />;
}
