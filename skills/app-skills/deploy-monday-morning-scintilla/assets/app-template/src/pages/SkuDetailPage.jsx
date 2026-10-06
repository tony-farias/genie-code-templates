// Per-SKU detail page nested under the Demand Forecast app at /app/demand/sku/:skuId
// (legacy alias /app/sku/:skuId still routed in App.jsx for old bookmarks).
// Shown when a user drills into a specific product from Sales (Top Movers /
// Underperformers / New Items / Detailed Breakdown) or from Demand (Top forecasted).

import { Fragment, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, ComposedChart, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  ArrowLeft, Package, DollarSign, Target, Warehouse, AlertTriangle, Calculator, Sparkles, Activity, Megaphone,
} from 'lucide-react';
import AppHeader from '../components/AppHeader';
import { useApi } from '../lib/api';

const fmt$ = (n) => {
  if (n == null) return '—';
  n = Number(n);
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};
const fmtN = (n) => {
  if (n == null) return '—';
  n = Number(n);
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toLocaleString();
};

function MetricCard({ icon: Icon, title, value, subtitle, trend }) {
  const trendColor = trend == null ? 'text-muted-foreground' : trend >= 0 ? 'text-db-success' : 'text-db-error';
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
        {Icon && <Icon className="w-4 h-4 text-muted-foreground" aria-hidden="true" />}
      </div>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {subtitle && <p className={`text-xs mt-0.5 font-medium ${trendColor}`}>{subtitle}</p>}
    </div>
  );
}

function Card({ title, action, icon: Icon, children }) {
  return (
    <div className="bg-card rounded-xl border border-border p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold inline-flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-db-lava" aria-hidden="true" />}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function Badge({ tone = 'neutral', children }) {
  const cls = tone === 'success' ? 'bg-db-success-tint text-db-success border-db-success/30'
    : tone === 'warning' ? 'bg-db-warning-tint text-db-warning border-db-warning/30'
    : tone === 'error' ? 'bg-db-error-tint text-db-error border-db-error/30'
    : 'bg-accent text-foreground border-border';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${cls}`}>{children}</span>;
}

// Body-only component — KPI strip + charts + tables, no page chrome.
// Reused inside DemandPage's "Per-SKU Detail" tab so the SKU view is part of
// the Demand Forecast experience.
export function SkuDetailContent({ skuId }) {
  // Hooks must run unconditionally on every render — keep them all at the top,
  // before any early returns, so Rules of Hooks holds.
  const navigate = useNavigate();
  const { data, loading, error } = useApi(skuId ? `/api/sku/${skuId}` : null);

  if (!skuId) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-accent/30 p-12 text-center">
        <Package className="w-8 h-8 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
        <p className="text-sm text-foreground font-medium">Pick a SKU above to see per-product detail.</p>
        <p className="text-xs text-muted-foreground mt-1">120-day forecast, backtest accuracy, store-level performance, recent anomalies, and pricing/inventory recommendations.</p>
      </div>
    );
  }
  if (loading) return <p className="text-sm text-muted-foreground py-12 text-center">Loading SKU…</p>;
  if (error) return <p className="text-sm text-db-error py-12 text-center">SKU not found.</p>;

  const h = data?.header || {};
  const k = data?.kpis || {};
  const forecast = (data?.forecast || []).map((r) => ({
    date: r.date,
    yhat: r.yhat == null ? null : Number(r.yhat),
    yhat_lower: r.yhat_lower == null ? null : Number(r.yhat_lower),
    yhat_upper: r.yhat_upper == null ? null : Number(r.yhat_upper),
    actual: r.actual == null ? null : Number(r.actual),
  }));
  const bt = (data?.backtest?.days || []).map((r) => ({ date: r.date, actual: Number(r.actual || 0), predicted: Number(r.predicted || 0) }));

  const launchRecoveryCampaign = () => {
    const brief = `Recovery campaign for ${h.sku_name} (${h.sku_id}) in ${h.category_name}. ` +
      `Sales are tracking ${k.backtest_accuracy_pct != null ? `${(100 - Number(k.backtest_accuracy_pct)).toFixed(0)}% below forecast` : 'below forecast'} ` +
      `after a recent forecast-vs-actual divergence. Reach lookalike Meal-Prep + Holiday Host households and competitive ` +
      `switchers in the NJ Tri-State region. Pair a 10% promo with restored planogram facings and replenishment to ${h.brand} stores.`;
    navigate('/app/audience', {
      state: {
        wizardSeed: {
          signal_id: null,
          signal: {
            event_name: `${h.sku_name} recovery`,
            signal_type: 'Competitive',
            relevant_categories: h.category_name,
          },
          brief,
          source_sku_id: h.sku_id,
        },
      },
    });
  };

  return (
    <div className="space-y-5">
      {/* Product header card */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <h2 className="text-xl font-bold text-foreground">{h.sku_name}</h2>
              <span className="font-mono text-xs text-muted-foreground">{h.sku_id}</span>
            </div>
            <p className="text-muted-foreground text-sm mt-1">
              <span className="font-medium text-foreground">{h.brand}</span>
              {' · '}{h.category_name} · {h.subcategory_name}
              {h.upc_code && <> · UPC <span className="font-mono">{h.upc_code}</span></>}
              {h.unit_price && <> · ${Number(h.unit_price).toFixed(0)} list</>}
            </p>
          </div>
          <button
            onClick={launchRecoveryCampaign}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-db-lava hover:bg-db-lava/90 text-white text-xs font-bold shadow-sm transition-colors"
            title="Open the Audience Campaign Wizard pre-seeded with this SKU's recovery brief"
          >
            <Megaphone className="w-3.5 h-3.5" aria-hidden="true" />
            Launch recovery campaign →
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <MetricCard icon={DollarSign} title="MTD Sales" value={fmt$(k.month_sales)} subtitle="Current month" />
            <MetricCard icon={Package} title="MTD Units" value={fmtN(k.month_units)} subtitle="Quantity sold" />
            <MetricCard icon={Activity} title="MTD Margin %" value={k.month_margin_pct ? `${Number(k.month_margin_pct).toFixed(0)}%` : '—'} />
            <MetricCard icon={Sparkles} title="30-day Forecast (units)" value={fmtN(k.forecast_30d_units)} subtitle={fmt$(k.forecast_30d_revenue) + ' projected revenue'} />
            <MetricCard icon={Target} title="Backtest Accuracy" value={k.backtest_accuracy_pct != null ? `${k.backtest_accuracy_pct}%` : '—'} subtitle="vs Nov-Dec 2025 actuals" trend={k.backtest_accuracy_pct ? k.backtest_accuracy_pct - 80 : null} />
            <MetricCard icon={Warehouse} title="In-Stock %" value={k.in_stock_pct != null ? `${Number(k.in_stock_pct).toFixed(0)}%` : '—'} subtitle={`${fmtN(k.on_hand_qty)} on-hand`} trend={k.in_stock_pct ? k.in_stock_pct - 90 : null} />
          </div>

          {/* Forecast chart + backtest side-by-side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card title="Forecast vs Actual — last 60 days + 90-day forward" icon={Sparkles}>
              <p className="text-xs text-muted-foreground mb-2">
                Solid black = actuals from <code className="font-mono">fact_daily_sales</code>.
                Dashed lava = forecast (2025-11-05 backtest vintage for the historical window, latest vintage forward).
                Lava band = 95% prediction interval.
              </p>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={forecast}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#DCE0E2" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#5A6F77' }} tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 11, fill: '#5A6F77' }} />
                  <Tooltip formatter={(v) => v == null ? '—' : v} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="yhat_upper" stroke="none" fill="#FF362118" name="95% interval" />
                  <Area type="monotone" dataKey="yhat_lower" stroke="none" fill="#F9F7F4" />
                  <Line type="monotone" dataKey="yhat" stroke="#FF3621" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Forecast" />
                  <Line type="monotone" dataKey="actual" stroke="#0B2026" strokeWidth={2.5} dot={false} connectNulls={false} name="Actual" />
                </ComposedChart>
              </ResponsiveContainer>
            </Card>

            <Card title="Predicted vs actual (Nov-Dec backtest)" icon={Target}>
              {bt.length === 0 ? (
                <p className="text-sm text-muted-foreground py-12 text-center">No backtest data for this SKU.</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={bt}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#DCE0E2" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#5A6F77' }} tickFormatter={(v) => v.slice(5)} />
                    <YAxis tick={{ fontSize: 11, fill: '#5A6F77' }} />
                    <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="actual" stroke="#0B2026" strokeWidth={2} dot={false} name="Actual" />
                    <Line type="monotone" dataKey="predicted" stroke="#FF3621" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Predicted" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>

          {/* Store-level breakdown */}
          <Card title="Store-level performance" icon={Warehouse}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-accent">
                    {['Store', 'City', '8w Sales', '8w Units', 'In-Stock %', 'Days of Supply', 'On-Hand'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(data.stores || []).map((s) => (
                    <tr key={s.store_id} className="border-t border-border hover:bg-accent/40">
                      <td className="px-3 py-2 font-medium">{s.store_name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{s.city}, {s.state}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt$(s.sales_8w)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(s.units_8w).toLocaleString()}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${s.in_stock_pct < 80 ? 'text-db-error' : s.in_stock_pct < 90 ? 'text-db-warning' : 'text-db-success'}`}>{s.in_stock_pct != null ? `${Number(s.in_stock_pct).toFixed(0)}%` : '—'}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${s.days_of_supply < 5 ? 'text-db-error font-medium' : ''}`}>{s.days_of_supply ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.on_hand_qty ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Outliers + Pricing + Inventory */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card title="Recent anomalies" icon={AlertTriangle}>
              {(data.outliers || []).length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No outlier events for this SKU.</p>
              ) : (
                <div className="space-y-2">
                  {(data.outliers || []).map((o, i) => (
                    <div key={i} className="flex items-start justify-between text-xs p-2 rounded border border-border bg-accent/30">
                      <div>
                        <div className="font-mono">{o.sale_date}</div>
                        <div className="text-muted-foreground">{o.store_name}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium tabular-nums">{o.observed_units} vs {o.expected_units}</div>
                        <div className={`text-[11px] ${o.z_score < 0 ? 'text-db-error' : 'text-db-success'}`}>z = {Number(o.z_score).toFixed(0)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Pricing recommendations" icon={DollarSign}>
              {(data.pricing || []).length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No pricing recommendations.</p>
              ) : (
                <div className="space-y-2">
                  {(data.pricing || []).slice(0, 5).map((p, i) => (
                    <div key={i} className="text-xs p-2.5 rounded border border-border bg-accent/30">
                      <div className="flex justify-between">
                        <span className="font-medium">{p.store_name}</span>
                        <Badge tone={p.pct_change > 0 ? 'success' : p.pct_change < 0 ? 'warning' : 'neutral'}>{p.pct_change > 0 ? '+' : ''}{p.pct_change}%</Badge>
                      </div>
                      <div className="text-muted-foreground tabular-nums mt-1">${p.current_price} → ${p.recommended_price} · lift {p.expected_revenue_lift_pct}% · conf {(p.confidence * 100).toFixed(0)}%</div>
                      <div className="text-[10px] text-muted-foreground italic mt-1">{p.rationale}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Inventory recommendations" icon={Calculator}>
              {(data.inventory || []).length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No inventory recommendations.</p>
              ) : (
                <div className="space-y-2">
                  {(data.inventory || []).slice(0, 5).map((r, i) => {
                    const tone = /URGENT/.test(r.recommendation) ? 'error' : /Reorder/.test(r.recommendation) ? 'warning' : 'success';
                    return (
                      <div key={i} className="text-xs p-2.5 rounded border border-border bg-accent/30">
                        <div className="flex justify-between">
                          <span className="font-medium">{r.store_name}</span>
                          <Badge tone={tone}>order {r.recommended_order_qty}</Badge>
                        </div>
                        <div className="text-muted-foreground tabular-nums mt-1">on-hand {r.current_stock} · reorder {r.reorder_point} · safety {r.safety_stock} · EOQ {r.economic_order_qty}</div>
                        <div className="text-[10px] text-muted-foreground italic mt-1">{r.recommendation}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
      </div>
    </div>
  );
}

// Legacy wrapper for the standalone /app/sku/:skuId route — wraps SkuDetailContent
// with the same chrome as the rest of the suite. New traffic should land on
// /app/demand/sku/:skuId which renders the SkuDetailContent inside the Demand page.
export default function SkuDetailPage() {
  const { skuId } = useParams();
  return (
    <div className="min-h-screen w-full flex flex-col bg-background text-foreground md:pl-56">
      <AppHeader />
      <main aria-label="Demand Forecast — SKU Detail" className="container mx-auto px-4 py-6">
        <div className="space-y-5 animate-in">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Demand Forecast</h1>
              <p className="text-muted-foreground text-sm font-mono">Per-SKU drill-down · <span className="text-db-lava">{skuId}</span></p>
            </div>
            <Link to="/app/demand" className="text-xs text-muted-foreground hover:text-db-lava inline-flex items-center gap-1">
              <ArrowLeft className="w-3 h-3" /> Back to Demand Forecast
            </Link>
          </div>
          <SkuDetailContent skuId={skuId} />
        </div>
      </main>
    </div>
  );
}
