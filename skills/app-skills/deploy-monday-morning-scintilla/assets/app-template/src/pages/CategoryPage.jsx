// Category Intelligence — how the selected vendor stands vs the market across
// categories (upc_attr + upc_sales), brand velocity over time, and category penetration.
import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';
import { Layers, TrendingUp, Target } from 'lucide-react';
import AppHeader from '../components/AppHeader';
import FilterBar from '../components/FilterBar';
import { useApi, fmtCurrency, fmtPct } from '../lib/api';
import { useFilters } from '../lib/filters.jsx';

const COLORS = ['#FF3621', '#0B2026', '#00A972', '#FBB300', '#8AB4F8', '#A66BFF'];

function Card({ title, action, children, className = '' }) {
  return (
    <div className={`bg-card rounded-xl border border-border p-5 shadow-sm ${className}`}>
      {title && <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-foreground">{title}</h3>{action}</div>}
      {children}
    </div>
  );
}
const Skel = ({ h = 220 }) => <div className="animate-pulse bg-accent/60 rounded-lg" style={{ height: h }} />;

export default function CategoryPage() {
  const { vendor } = useFilters();
  const competitive = useApi('/api/category/competitive');
  const velocity = useApi('/api/category/brand-velocity');
  const penetration = useApi('/api/category/penetration');

  return (
    <div className="min-h-screen bg-background md:pl-56">
      <AppHeader />
      <FilterBar />
      <div className="px-4 md:px-6 py-5 max-w-[1400px] mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Layers className="w-6 h-6 text-db-lava" /> Category Intelligence</h1>
          <p className="text-sm text-muted-foreground">{vendor === 'all' ? 'Market-wide category view. Select a vendor in the filter to see competitive share.' : 'Selected vendor vs the total market, by category.'}</p>
        </div>

        {/* Competitive share vs market */}
        <Card title="Vendor Share of Category vs Market" action={<Target className="w-4 h-4 text-muted-foreground" />}>
          {competitive.loading ? <Skel /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-accent text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 text-left">Category</th>
                    <th className="px-3 py-2 text-right">Market Sales</th>
                    <th className="px-3 py-2 text-right">Vendor Sales</th>
                    <th className="px-3 py-2 text-right">Share</th>
                    <th className="px-3 py-2 text-left w-1/3">Share of Category</th>
                  </tr>
                </thead>
                <tbody>
                  {(competitive.data || []).map((r) => (
                    <tr key={r.category} className="border-t border-border">
                      <td className="px-3 py-2 font-medium text-foreground">{r.category}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtCurrency(r.market_sales)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">{fmtCurrency(r.vendor_sales)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-db-lava">{r.share_pct}%</td>
                      <td className="px-3 py-2">
                        <div className="h-3 rounded-full bg-accent overflow-hidden">
                          <div className="h-full rounded-full bg-db-lava" style={{ width: `${Math.min(100, r.share_pct)}%` }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {vendor === 'all' && <p className="text-[11px] text-muted-foreground mt-2">Share is 0 with all vendors selected (vendor = market). Pick a vendor to see competitive position.</p>}
            </div>
          )}
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Brand velocity over time */}
          <Card title="Brand Velocity (weekly sales)" action={<TrendingUp className="w-4 h-4 text-muted-foreground" />}>
            {velocity.loading ? <Skel /> : !velocity.data?.series?.length ? <Empty /> : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={velocity.data.series} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="week" tick={{ fontSize: 10 }} tickFormatter={(w) => String(w).slice(-2)} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1e6).toFixed(0)}M`} />
                  <RTooltip formatter={(v) => fmtCurrency(v)} labelFormatter={(w) => `Week ${w}`} />
                  {velocity.data.brands.map((b, i) => (
                    <Line key={b} type="monotone" dataKey={b} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
            {velocity.data?.brands && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                {velocity.data.brands.map((b, i) => (
                  <span key={b} className="text-[11px] text-muted-foreground flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />{b}</span>
                ))}
              </div>
            )}
          </Card>

          {/* Category penetration over time */}
          <Card title="Category Penetration Over Time" action={<Layers className="w-4 h-4 text-muted-foreground" />}>
            {penetration.loading ? <Skel /> : !penetration.data?.series?.length ? (
              <div className="text-sm text-muted-foreground py-16 text-center">{penetration.data?.note === 'select a vendor' ? 'Select a vendor to see penetration vs the market.' : 'No penetration data.'}</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={penetration.data.series} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="week" tick={{ fontSize: 10 }} tickFormatter={(w) => String(w).slice(-2)} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} domain={[0, 'auto']} />
                  <RTooltip formatter={(v) => `${v}%`} labelFormatter={(w) => `Week ${w}`} />
                  <Line type="monotone" dataKey="penetration_pct" stroke="#FF3621" strokeWidth={2.5} dot={false} name="Penetration %" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Empty() { return <div className="text-sm text-muted-foreground py-16 text-center">No data for this selection.</div>; }
