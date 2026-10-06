// E-commerce Intelligence — digital transactability + content quality.
// Flags non-transactable / low-score items and gives an AI mitigation action per item,
// with a "simulate & act" flow that shows the projected lift and a call-to-action.
import { useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RTooltip } from 'recharts';
import { Globe, AlertTriangle, CheckCircle2, Wrench, ArrowRight, Sparkles, X } from 'lucide-react';
import AppHeader from '../components/AppHeader';
import FilterBar from '../components/FilterBar';
import { useApi, fmtNumber } from '../lib/api';

const COLORS = ['#00A972', '#FF3621'];
function Card({ title, action, children, className = '' }) {
  return (
    <div className={`bg-card rounded-xl border border-border p-5 shadow-sm ${className}`}>
      {title && <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-foreground">{title}</h3>{action}</div>}
      {children}
    </div>
  );
}
const Skel = ({ h = 200 }) => <div className="animate-pulse bg-accent/60 rounded-lg" style={{ height: h }} />;

const LEVER_LABEL = {
  inventory: 'Inventory / availability', setup: 'Item setup', image: 'Missing image', dimensions: 'Missing dimensions',
  prohibited: 'Prohibited', do_not_display: 'Do-not-display', date_range: 'Date range',
};

export default function EcomPage() {
  const overview = useApi('/api/ecom/overview');
  const items = useApi('/api/ecom/action-items');
  const [sim, setSim] = useState(null);
  const o = overview.data;

  const donut = o ? [{ name: 'Transactable', value: o.transactable }, { name: 'Not transactable', value: o.not_transactable }] : [];

  return (
    <div className="min-h-screen bg-background md:pl-56">
      <AppHeader />
      <FilterBar />
      <div className="px-4 md:px-6 py-5 max-w-[1400px] mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Globe className="w-6 h-6 text-db-lava" /> E-commerce Intelligence</h1>
          <p className="text-sm text-muted-foreground">Digital transactability and content quality — what's blocking items from selling online, and how to fix it.</p>
        </div>

        {/* KPI + donut */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <Card className="lg:col-span-1">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Transactable</div>
            <div className="text-3xl font-bold text-db-success tabular-nums mt-1">{o ? `${o.transactable_pct}%` : '—'}</div>
            <div className="text-xs text-muted-foreground mt-1">{o ? `${fmtNumber(o.not_transactable)} store-item rows not transactable` : ''}</div>
            <div className="mt-3 text-[11px] uppercase tracking-wider text-muted-foreground">Avg ATS score</div>
            <div className="text-xl font-semibold text-foreground tabular-nums">{o ? o.avg_ats : '—'}</div>
            <div className="mt-3 text-[11px] uppercase tracking-wider text-muted-foreground">Content below threshold</div>
            <div className="text-xl font-semibold text-db-warning tabular-nums">{o ? fmtNumber(o.content.below_threshold) : '—'} <span className="text-xs text-muted-foreground font-normal">of {o ? fmtNumber(o.content.items) : ''}</span></div>
          </Card>
          <Card title="Transactability" className="lg:col-span-1">
            {!o ? <Skel /> : (
              <ResponsiveContainer width="100%" height={180}>
                <PieChart><Pie data={donut} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70}>
                  {donut.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}</Pie><RTooltip formatter={(v) => fmtNumber(v)} /></PieChart>
              </ResponsiveContainer>
            )}
          </Card>
          <Card title="Why items aren't publishing" className="lg:col-span-2">
            {!o ? <Skel /> : (
              <div className="space-y-2">
                {o.reasons.map((r, i) => {
                  const max = Math.max(...o.reasons.map((x) => x.count));
                  return (
                    <div key={r.lever}>
                      <div className="flex justify-between text-xs mb-0.5"><span className="text-foreground">{LEVER_LABEL[r.lever] || r.lever}</span><span className="text-muted-foreground tabular-nums">{fmtNumber(r.count)}</span></div>
                      <div className="h-2.5 rounded-full bg-accent overflow-hidden"><div className="h-full rounded-full bg-db-lava" style={{ width: `${(r.count / max) * 100}%` }} /></div>
                    </div>
                  );
                })}
                <p className="text-[11px] text-muted-foreground mt-2">The largest lever is where fixing publishes the most items fastest.</p>
              </div>
            )}
          </Card>
        </div>

        {/* Action items */}
        <Card title="Items to Fix — AI Mitigation Actions" action={<span className="text-[11px] text-muted-foreground">{items.data ? `${items.data.length} flagged` : ''}</span>}>
          {items.loading ? <Skel h={280} /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="bg-accent text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 text-left">Item</th><th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2 text-right">Non-transactable</th><th className="px-3 py-2 text-right">ATS</th>
                  <th className="px-3 py-2 text-left">Recommended action</th><th className="px-3 py-2"></th>
                </tr></thead>
                <tbody>
                  {(items.data || []).map((it) => (
                    <tr key={it.sku_id} className="border-t border-border hover:bg-accent/40">
                      <td className="px-3 py-2 font-medium text-foreground">{it.sku_name}<div className="text-muted-foreground font-normal">{it.brand}</div></td>
                      <td className="px-3 py-2 text-muted-foreground">{it.category}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-db-error">{it.nontrans_pct}%</td>
                      <td className="px-3 py-2 text-right tabular-nums">{it.ats}</td>
                      <td className="px-3 py-2 text-muted-foreground"><span className="inline-flex items-center gap-1"><Wrench className="w-3 h-3 text-db-lava" />{it.action}</span></td>
                      <td className="px-3 py-2 text-right"><button onClick={() => setSim(it)} className="inline-flex items-center gap-1 rounded-md bg-db-lava text-white px-2.5 py-1 text-[11px] font-semibold hover:bg-db-lava/90">Simulate <ArrowRight className="w-3 h-3" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {sim && <SimulateModal item={sim} onClose={() => setSim(null)} />}
    </div>
  );
}

function SimulateModal({ item, onClose }) {
  // simple, transparent projection: fixing publishes the non-transactable share,
  // recovering an estimated slice of online demand.
  const recoverPct = Math.round(item.nontrans_pct * 0.7 * 10) / 10; // ~70% of blocked rows recoverable
  const atsLift = Math.min(1, (item.ats || 0.97) + 0.02);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-card rounded-xl border border-border shadow-2xl w-full max-w-lg p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-db-lava font-semibold flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> Mitigation Simulation</div>
            <h3 className="text-lg font-bold text-foreground mt-1">{item.sku_name}</h3>
            <p className="text-xs text-muted-foreground">{item.brand} · {item.category}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-accent rounded"><X className="w-4 h-4" /></button>
        </div>

        <div className="rounded-lg bg-accent/40 p-3 mb-3 text-sm">
          <div className="flex items-center gap-2 text-foreground font-medium mb-1"><AlertTriangle className="w-4 h-4 text-db-warning" /> Current issue</div>
          <p className="text-muted-foreground text-xs">{item.nontrans_pct}% of store-item rows are not transactable online. Recommended action: <b className="text-foreground">{item.action}</b></p>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="rounded-lg border border-border p-3 text-center"><div className="text-[10px] text-muted-foreground uppercase">Recoverable</div><div className="text-xl font-bold text-db-success tabular-nums">+{recoverPct}%</div><div className="text-[10px] text-muted-foreground">of blocked rows</div></div>
          <div className="rounded-lg border border-border p-3 text-center"><div className="text-[10px] text-muted-foreground uppercase">Projected ATS</div><div className="text-xl font-bold text-foreground tabular-nums">{Math.round(atsLift * 100)}%</div><div className="text-[10px] text-muted-foreground">availability score</div></div>
          <div className="rounded-lg border border-border p-3 text-center"><div className="text-[10px] text-muted-foreground uppercase">Effort</div><div className="text-xl font-bold text-foreground">{item.target === 'inventory' ? 'Ops' : item.target === 'content' ? 'Low' : 'Med'}</div><div className="text-[10px] text-muted-foreground">{item.target}</div></div>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">Route this fix to the {item.target === 'inventory' ? 'replenishment' : 'catalog'} team.</div>
          <button onClick={onClose} className="inline-flex items-center gap-1.5 rounded-lg bg-db-lava text-white px-4 py-2 text-sm font-semibold hover:bg-db-lava/90">
            <CheckCircle2 className="w-4 h-4" /> Create action ticket
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">Simulation is illustrative — projections derive from the item's own non-transactable share and ATS score.</p>
      </div>
    </div>
  );
}
