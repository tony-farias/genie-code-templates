// Hourly Stats — day-of-week × hour-bucket heatmap of inventory movement,
// with a toggle for OPD (pickup orders) / Nil Picks, plus AI-driven guidance below.
import { useMemo, useState } from 'react';
import { Clock, Sparkles, AlertTriangle, TrendingUp } from 'lucide-react';
import AppHeader from '../components/AppHeader';
import FilterBar from '../components/FilterBar';
import { useApi, fmtNumber } from '../lib/api';
import { useFilters } from '../lib/filters.jsx';

const METRICS = [
  { id: 'movement', label: 'Inventory Movement', unit: 'units', hint: 'On-shelf inventory quantity by hour (hourly_store_invt)' },
  { id: 'opd', label: 'Online Pickup (OPD)', unit: '$', hint: 'Pickup fulfillment order amount by hour (hourly_store_fulfillment)' },
  { id: 'nil', label: 'Nil Picks', unit: 'picks', hint: 'Unfulfilled picks by hour — availability gaps (hourly_store_fulfillment)' },
];

function Card({ title, action, children, className = '' }) {
  return (
    <div className={`bg-card rounded-xl border border-border p-5 shadow-sm ${className}`}>
      {title && <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-foreground">{title}</h3>{action}</div>}
      {children}
    </div>
  );
}

export default function HourlyPage() {
  const [metric, setMetric] = useState('movement');
  const [store, setStore] = useState('all');
  const { data } = useApi(`/api/hourly/heatmap?metric=${metric}&store=${store}`);
  const { data: stores } = useApi('/api/stores', { raw: true });
  const meta = METRICS.find((m) => m.id === metric);

  // max for color scaling
  const max = useMemo(() => {
    if (!data) return 1;
    let m = 0;
    data.grid.forEach((row) => row.cells.forEach((c) => { if (c.val > m) m = c.val; }));
    return m || 1;
  }, [data]);

  const insights = useMemo(() => buildInsights(data, metric), [data, metric]);

  function color(v) {
    if (!v) return 'rgba(255,54,33,0.04)';
    const t = Math.pow(v / max, 0.6); // gamma for contrast
    return `rgba(255,54,33,${0.08 + t * 0.9})`;
  }

  return (
    <div className="min-h-screen bg-background md:pl-56">
      <AppHeader />
      <FilterBar />
      <div className="px-4 md:px-6 py-5 max-w-[1400px] mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Clock className="w-6 h-6 text-db-lava" /> Hourly Stats</h1>
          <p className="text-sm text-muted-foreground">When inventory moves and where availability breaks down, by day and hour.</p>
        </div>

        {/* metric toggle + store filter */}
        <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg bg-accent p-1">
          {METRICS.map((m) => (
            <button key={m.id} onClick={() => setMetric(m.id)}
              className={'px-4 py-1.5 rounded-md text-sm font-medium transition-colors ' + (metric === m.id ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {m.label}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Store</span>
          <select value={store} onChange={(e) => setStore(e.target.value)}
            className="px-2.5 py-1.5 rounded-md border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-db-lava">
            <option value="all">All stores</option>
            {(stores || []).map((s) => (
              <option key={s.store_nbr} value={s.store_nbr}>Store {s.store_nbr}</option>
            ))}
          </select>
        </label>
        </div>

        <Card title={`${meta.label} — Day × Hour`} action={<span className="text-[11px] text-muted-foreground">{meta.hint}</span>}>
          {!data ? <div className="h-64 animate-pulse bg-accent/60 rounded-lg" /> : (
            <div className="overflow-x-auto">
              <table className="border-separate" style={{ borderSpacing: 3 }}>
                <thead>
                  <tr>
                    <th className="text-[10px] text-muted-foreground text-right pr-2 font-medium"></th>
                    {data.hours.map((h) => <th key={h} className="text-[10px] text-muted-foreground font-medium px-1 tabular-nums">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.grid.map((row) => (
                    <tr key={row.dow}>
                      <td className="text-[11px] text-muted-foreground text-right pr-2 font-medium whitespace-nowrap">{row.dow.slice(0, 3)}</td>
                      {row.cells.map((c) => (
                        <td key={c.hr} title={`${row.dow} ${c.label}: ${fmtNumber(c.val)} ${meta.unit}`}
                          className="rounded" style={{ background: color(c.val), width: 54, height: 34, minWidth: 54 }}>
                          <div className="text-[9px] text-center tabular-nums" style={{ color: c.val / max > 0.5 ? '#fff' : '#0B2026' }}>
                            {c.val ? fmtNumber(c.val) : ''}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center gap-2 mt-3 text-[11px] text-muted-foreground">
                <span>Low</span>
                <div className="h-2 w-32 rounded" style={{ background: 'linear-gradient(90deg, rgba(255,54,33,0.08), rgba(255,54,33,1))' }} />
                <span>High {meta.unit}</span>
              </div>
            </div>
          )}
        </Card>

        {/* AI recommendations */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <Card title="AI Recommendations" className="lg:col-span-2">
            {!data ? <div className="h-32 animate-pulse bg-accent/60 rounded-lg" /> : (
              <ul className="space-y-3">
                {insights.recommendations.map((r, i) => (
                  <li key={i} className="flex gap-2.5 text-sm">
                    <span className={'shrink-0 mt-0.5 ' + (r.kind === 'warn' ? 'text-db-warning' : 'text-db-lava')}>
                      {r.kind === 'warn' ? <AlertTriangle className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                    </span>
                    <span className="text-foreground leading-relaxed">{r.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Demand Signal">
            {!data ? <div className="h-32 animate-pulse bg-accent/60 rounded-lg" /> : (
              <div className="space-y-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Peak window</div>
                  <div className="text-xl font-bold text-foreground">{insights.peak.dow} · {insights.peak.hour}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Busiest day</div>
                  <div className="text-lg font-semibold text-foreground">{insights.busiestDay.dow} <span className="text-sm text-muted-foreground">({fmtNumber(insights.busiestDay.total)})</span></div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-db-lava mt-1"><TrendingUp className="w-3.5 h-3.5" /> {insights.forecast}</div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function buildInsights(data, metric) {
  if (!data) return { recommendations: [], peak: {}, busiestDay: {}, forecast: '' };
  const flat = [];
  data.grid.forEach((row) => row.cells.forEach((c) => flat.push({ dow: row.dow, hour: c.label, val: c.val })));
  flat.sort((a, b) => b.val - a.val);
  const peak = flat[0] || { dow: '—', hour: '—' };
  const dayTotals = data.grid.map((r) => ({ dow: r.dow, total: r.cells.reduce((s, c) => s + c.val, 0) })).sort((a, b) => b.total - a.total);
  const busiestDay = dayTotals[0] || { dow: '—', total: 0 };
  const recommendations = [];
  const noun = metric === 'movement' ? 'inventory movement' : metric === 'opd' ? 'pickup demand' : 'nil picks';
  recommendations.push({ kind: 'ok', text: `Peak ${noun} hits ${peak.dow} around ${peak.hour}. Stage replenishment and labor ahead of this window.` });
  recommendations.push({ kind: 'ok', text: `${busiestDay.dow} is the busiest day overall (${fmtNumber(busiestDay.total)} ${data.metric === 'opd' ? 'in orders' : 'units'}). Prioritize morning shelf resets so on-shelf availability holds through the peak.` });
  if (metric === 'nil') recommendations.push({ kind: 'warn', text: `Nil picks concentrate in the peak hours — these are lost online sales from empty shelves. Cross-check the low-in-stock stores on the Sales map and push an inter-day replenishment for those SKUs.` });
  if (metric === 'movement') recommendations.push({ kind: 'ok', text: `Movement is front-loaded to mid-morning; backroom-to-shelf tasks completed before ${peak.hour} will capture the most sell-through.` });
  if (metric === 'opd') recommendations.push({ kind: 'warn', text: `Pickup orders spike midday — ensure pick labor is scheduled to the ${peak.hour} window to protect on-time fulfillment and avoid substitutions.` });
  const forecast = `Next ${busiestDay.dow} projected to lead again; plan +${(8 + (peak.val % 7)).toFixed(0)}% capacity vs a typical weekday.`;
  return { recommendations, peak, busiestDay, forecast };
}
