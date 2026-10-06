// Forecast — blends future daily demand forecast with historical actuals, and scores
// confidence from demand stability + fill rate + in-stock. Shows a confidence band.
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { LineChart as LineIcon, Gauge, ShieldCheck, Boxes } from 'lucide-react';
import AppHeader from '../components/AppHeader';
import FilterBar from '../components/FilterBar';
import { useApi, fmtNumber } from '../lib/api';
import { useFilters } from '../lib/filters.jsx';

function Card({ title, action, children, className = '' }) {
  return (
    <div className={`bg-card rounded-xl border border-border p-5 shadow-sm ${className}`}>
      {title && <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-foreground">{title}</h3>{action}</div>}
      {children}
    </div>
  );
}
const Skel = ({ h = 320 }) => <div className="animate-pulse bg-accent/60 rounded-lg" style={{ height: h }} />;

export default function ForecastPage() {
  const { data, loading, error } = useApi('/api/forecast/overview');
  const { rangeLabel } = useFilters();
  const conf = data?.confidence ?? 0;
  const confColor = conf >= 85 ? 'text-db-success' : conf >= 70 ? 'text-db-warning' : 'text-db-error';
  const series = Array.isArray(data?.series) ? data.series : [];
  const hasData = series.length > 0;
  const firstForecast = series.find((s) => s.forecast != null)?.date;

  return (
    <div className="min-h-screen bg-background md:pl-56">
      <AppHeader />
      <FilterBar />
      <div className="px-4 md:px-6 py-5 max-w-[1400px] mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><LineIcon className="w-6 h-6 text-db-lava" /> Demand Forecast</h1>
          <p className="text-sm text-muted-foreground">Daily demand forecast fused with actual sales, inventory, and nil picks — with a confidence score.</p>
        </div>

        {/* confidence + drivers */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <Card className="lg:col-span-1 flex flex-col items-center justify-center text-center">
            <Gauge className={`w-6 h-6 ${confColor} mb-1`} />
            <div className={`text-4xl font-bold tabular-nums ${confColor}`}>{loading ? '—' : `${conf}%`}</div>
            <div className="text-xs text-muted-foreground mt-1">Forecast confidence</div>
          </Card>
          <Driver icon={Boxes} label="Demand stability" value={data?.drivers?.demand_stability} suffix="%" hint="Lower day-to-day volatility → higher confidence" />
          <Driver icon={ShieldCheck} label="Fill rate" value={data?.drivers?.fill_rate} suffix="%" hint="Orders fulfilled without nil picks" />
          <Driver icon={Boxes} label="In-stock" value={data?.drivers?.in_stock} suffix="%" hint="Replenishment in-stock on latest week" />
        </div>

        <Card title="Actual vs Forecast (daily units)" action={<span className="text-[11px] text-muted-foreground">{data ? `${data.horizon_days || 0}-day horizon · ${fmtNumber(data.forecast_total || 0)} units forecast` : ''}</span>}>
          {loading ? <Skel /> : !hasData ? (
            <div className="text-sm text-muted-foreground py-16 text-center">No forecast data for this filter selection.{error ? ' (data error)' : ''}</div>
          ) : (
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart data={series} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs><linearGradient id="band" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FF3621" stopOpacity={0.18} /><stop offset="100%" stopColor="#FF3621" stopOpacity={0.02} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={(d) => d?.slice(5)} minTickGap={24} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1e6).toFixed(0)}M`} />
                <RTooltip formatter={(v, n) => [v == null ? '—' : fmtNumber(v), n]} />
                {/* confidence band */}
                <Area dataKey="hi" stroke="none" fill="url(#band)" />
                <Area dataKey="lo" stroke="none" fill="#fff" />
                <Line dataKey="actual" stroke="#0B2026" strokeWidth={2} dot={false} name="Actual" connectNulls />
                <Line dataKey="forecast" stroke="#FF3621" strokeWidth={2.5} strokeDasharray="5 4" dot={false} name="Forecast" connectNulls />
                {firstForecast && <ReferenceLine x={firstForecast} stroke="#98A2B3" strokeDasharray="2 2" label={{ value: 'today', fontSize: 10, fill: '#98A2B3' }} />}
              </ComposedChart>
            </ResponsiveContainer>
          )}
          <div className="flex items-center gap-4 mt-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-db-navy inline-block" /> Actual</span>
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ background: '#FF3621' }} /> Forecast</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm inline-block" style={{ background: 'rgba(255,54,33,0.18)' }} /> Confidence band (±{data ? Math.round((1 - conf / 100) * 100 + 6) : '—'}%)</span>
          </div>
        </Card>

        <Card title="How the confidence score is built">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Confidence blends three live signals: <b className="text-foreground">demand stability</b> (inverse of day-to-day sales volatility over the last 8 weeks),
            <b className="text-foreground"> fill rate</b> (share of customer orders fulfilled without a nil pick, from <span className="font-mono text-xs">store_fulfillment</span>),
            and <b className="text-foreground">in-stock</b> (replenishment in-stock on the latest inventory week). The band around the forecast widens as confidence drops,
            so a low-confidence horizon visibly carries more risk. Forecast units come from <span className="font-mono text-xs">dly_dmnd_fcst</span>; actuals from <span className="font-mono text-xs">store_sales</span>.
          </p>
        </Card>
      </div>
    </div>
  );
}

function Driver({ icon: Icon, label, value, suffix, hint }) {
  return (
    <Card>
      <div className="flex items-center gap-2 mb-1"><Icon className="w-4 h-4 text-db-lava" /><span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span></div>
      <div className="text-2xl font-bold text-foreground tabular-nums">{value != null ? `${value}${suffix || ''}` : '—'}</div>
      <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>
    </Card>
  );
}
