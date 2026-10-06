// Inventory Intelligence — select a DC (shows all its stores + inventory flow, each
// store expandable) or a single store. Replicates the DC → store in-transit flow view,
// KPI tiles, and the hourly movement heatmap. Live data.
import { useEffect, useMemo, useState } from 'react';
import { Database, Warehouse, Store, Truck, ChevronRight, TrendingUp, CheckCircle2, AlertTriangle, Search } from 'lucide-react';
import AppHeader from '../components/AppHeader';
import { fetchJson, fmtNumber } from '../lib/api';

const GOOD = '#00A972', WARN = '#FBB300', CRIT = '#FF3621';
const kfmt = (n) => { n = Number(n || 0); if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M`; if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`; return String(Math.round(n)); };
const cap = (s) => (s || '').split(' ').map((w) => w ? w[0] + w.slice(1).toLowerCase() : '').join(' ');

export default function InventoryIntelPage() {
  const [entities, setEntities] = useState(null);
  const [sel, setSel] = useState(null); // {type:'dc'|'store', id, label}
  const [dcData, setDcData] = useState(null);
  const [storeData, setStoreData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [storeQuery, setStoreQuery] = useState('');
  const [storeResults, setStoreResults] = useState([]);
  const [heatStore, setHeatStore] = useState(null);

  useEffect(() => {
    fetchJson('/api/inv-intel/entities').then((d) => {
      setEntities(d);
      if (d.dcs?.length) selectDc(d.dcs[0]);
    });
  }, []);

  async function selectDc(dc) {
    setSel({ type: 'dc', id: dc.dc_nbr, label: dc.label }); setStoreData(null); setLoading(true);
    const d = await fetchJson(`/api/inv-intel/dc/${dc.dc_nbr}?limit=8`);
    setDcData(d); setLoading(false);
    if (d.stores?.length) setHeatStore(d.stores[0]);
  }
  async function selectStore(s) {
    setSel({ type: 'store', id: s.store_nbr, label: `#${s.store_nbr} ${cap(s.name || s.city)}` });
    setDcData(null); setLoading(true); setStoreResults([]); setStoreQuery('');
    const d = await fetchJson(`/api/inv-intel/store/${s.store_nbr}`);
    setStoreData(d); setLoading(false); setHeatStore({ store_nbr: s.store_nbr, city: s.city });
  }

  useEffect(() => {
    if (storeQuery.length < 2) { setStoreResults([]); return; }
    const t = setTimeout(() => fetchJson(`/api/inv-intel/store-search?q=${encodeURIComponent(storeQuery)}`).then(setStoreResults).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [storeQuery]);

  const kpis = dcData?.kpis || storeData?.kpis;

  return (
    <div className="min-h-screen bg-[#f4f5f7] md:pl-56">
      <AppHeader />
      <div className="px-4 md:px-8 py-6 max-w-[1600px] mx-auto space-y-5">
        {/* Header + selector */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Database className="w-6 h-6 text-db-lava" />
            <h1 className="text-xl font-bold text-foreground">Inventory Intelligence</h1>
            <Selector entities={entities} sel={sel} onDc={selectDc} onStoreSearch={setStoreQuery} storeQuery={storeQuery} storeResults={storeResults} onStore={selectStore} />
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-1.5"><span className="text-db-lava">⚡</span> Live inventory · latest sync</div>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiTile label="Total Units" value={kfmt(kpis?.total_units)} />
          <KpiTile label="In Transit" value={kfmt(kpis?.in_transit)} color="text-db-lava" />
          <KpiTile label="Fill Rate" value={kpis?.fill_rate != null ? `${kpis.fill_rate}%` : '—'} color="text-db-success" />
          <KpiTile label="Expected Orders" value={`${kfmt(kpis?.expected_orders)} units`} sub={sel?.type === 'dc' && dcData ? `${dcData.stores.filter((s) => s.status !== 'good').length} action flag${dcData.stores.filter((s) => s.status !== 'good').length === 1 ? '' : 's'}` : null} />
        </div>

        {/* Inventory Flow */}
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-db-lava" />
              <h3 className="text-sm font-semibold text-foreground">Inventory Flow</h3>
              <span className="text-[10px] font-semibold text-db-lava bg-db-lava/10 rounded-full px-2 py-0.5">● ML INSIGHTS EMBEDDED</span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <Legend color={GOOD}>Good</Legend><Legend color={WARN}>Warning</Legend><Legend color={CRIT}>Critical</Legend>
            </div>
          </div>

          {loading ? <div className="h-64 animate-pulse bg-accent/50 rounded-lg" /> : (
            sel?.type === 'dc' && dcData ? <DcFlow dc={dcData} /> : storeData ? <StoreFlow s={storeData} /> : null
          )}
        </div>

        {/* Heatmap */}
        {heatStore && <HeatmapCard store={heatStore} entities={entities} onPick={(s) => setHeatStore(s)} dcStores={dcData?.stores} />}
      </div>
    </div>
  );
}

function Selector({ entities, sel, onDc, onStoreSearch, storeQuery, storeResults, onStore }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground min-w-[200px] justify-between">
        {sel?.label || 'Select DC or store'} <ChevronRight className={'w-4 h-4 transition-transform ' + (open ? 'rotate-90' : '')} />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-80 bg-card border border-border rounded-lg shadow-xl p-2 max-h-[420px] overflow-y-auto">
          <div className="relative mb-2">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
            <input value={storeQuery} onChange={(e) => onStoreSearch(e.target.value)} placeholder="Search a store # or city…" className="w-full rounded-md border border-border bg-background pl-8 pr-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-db-lava/40" />
          </div>
          {storeResults.length > 0 && (
            <div className="mb-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-1 mb-1">Stores</div>
              {storeResults.map((s) => (
                <button key={s.store_nbr} onClick={() => { onStore(s); setOpen(false); }} className="w-full text-left flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent">
                  <Store className="w-3.5 h-3.5 text-muted-foreground" /> #{s.store_nbr} {cap(s.name)} <span className="text-muted-foreground">· {cap(s.city)}, {s.state}</span>
                </button>
              ))}
            </div>
          )}
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-1 mb-1">Distribution Centers</div>
          {(entities?.dcs || []).map((dc) => (
            <button key={dc.dc_nbr} onClick={() => { onDc(dc); setOpen(false); }} className="w-full text-left flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent">
              <span className="flex items-center gap-2"><Warehouse className="w-3.5 h-3.5 text-db-lava" /> {dc.label}</span>
              <span className="text-muted-foreground">{dc.stores} stores</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function KpiTile({ label, value, sub, color }) {
  return (
    <div className="bg-card rounded-xl border border-border p-5 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={'text-3xl font-bold tabular-nums mt-2 ' + (color || 'text-foreground')}>{value}</div>
      {sub && <div className="text-[11px] text-db-warning font-medium mt-1">{sub}</div>}
    </div>
  );
}
function Legend({ color, children }) { return <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: color }} />{children}</span>; }

function statusColor(s) { return s === 'critical' ? CRIT : s === 'warning' ? WARN : GOOD; }
function statusBg(s) { return s === 'critical' ? 'rgba(255,54,33,0.06)' : s === 'warning' ? 'rgba(251,179,0,0.08)' : 'rgba(0,169,114,0.06)'; }

function DcFlow({ dc }) {
  const [expanded, setExpanded] = useState({});
  return (
    <div className="flex gap-4">
      {/* DC node */}
      <div className="flex flex-col items-center justify-center shrink-0 pt-2">
        <div className="rounded-xl border-2 p-4 text-center w-28" style={{ borderColor: GOOD, background: 'rgba(0,169,114,0.05)' }}>
          <Warehouse className="w-5 h-5 mx-auto mb-1" style={{ color: GOOD }} />
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">DC</div>
          <div className="text-sm font-bold text-foreground">{cap(dc.dc.city || dc.dc.name)}</div>
          <div className="text-lg font-bold" style={{ color: GOOD }}>{kfmt(dc.kpis.total_units)}</div>
        </div>
      </div>

      {/* store rows */}
      <div className="flex-1 space-y-3">
        {dc.stores.map((s) => (
          <div key={s.store_nbr}>
            <div className="flex items-center gap-2">
              {/* in-transit box */}
              <div className="rounded-lg border p-2.5 w-24 text-center shrink-0" style={{ borderColor: statusColor(s.status), background: statusBg(s.status) }}>
                <Truck className="w-4 h-4 mx-auto mb-0.5" style={{ color: statusColor(s.status) }} />
                <div className="text-[9px] uppercase tracking-wide text-muted-foreground">In Transit</div>
                <div className="text-sm font-bold text-foreground">{kfmt(s.in_transit)}</div>
              </div>
              <span className="text-muted-foreground">→</span>
              {/* store box (expandable) */}
              <button onClick={() => setExpanded((e) => ({ ...e, [s.store_nbr]: !e[s.store_nbr] }))}
                className="rounded-lg border border-border bg-card p-2.5 w-36 text-center shrink-0 hover:border-db-lava transition-colors">
                <Store className="w-4 h-4 mx-auto mb-0.5 text-muted-foreground" />
                <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Store</div>
                <div className="text-sm font-bold text-foreground">#{s.store_nbr}</div>
                <div className="text-[11px] text-muted-foreground">{cap(s.city)}</div>
                <ChevronRight className={'w-3 h-3 mx-auto mt-0.5 text-muted-foreground transition-transform ' + (expanded[s.store_nbr] ? 'rotate-90' : '')} />
              </button>
              {/* action strip */}
              <div className="flex-1 rounded-lg border px-4 py-3 flex items-center gap-2 text-[13px]" style={{ borderColor: statusColor(s.status) + '55', background: statusBg(s.status) }}>
                {s.status === 'good' ? <CheckCircle2 className="w-4 h-4" style={{ color: GOOD }} /> : <AlertTriangle className="w-4 h-4" style={{ color: WARN }} />}
                <span className="text-foreground font-medium">{s.action}</span>
                <span className="text-muted-foreground">· <b className="text-foreground">{fmtNumber(s.forecast)} units</b> · {s.timing} ·</span>
                <span style={{ color: s.velocity_pct >= 0 ? GOOD : CRIT }} className="font-medium">Velocity {s.velocity_pct >= 0 ? '+' : ''}{s.velocity_pct}% vs forecast</span>
              </div>
            </div>
            {expanded[s.store_nbr] && (
              <div className="ml-[104px] mt-2 rounded-lg bg-accent/40 border border-border p-3 grid grid-cols-4 gap-3 text-center">
                {[['On Hand', s.on_hand], ['In Transit', s.in_transit], ['Fill Rate', s.fill != null ? s.fill + '%' : '—'], ['Expected Order', s.forecast]].map(([l, v]) => (
                  <div key={l}><div className="text-[10px] uppercase text-muted-foreground">{l}</div><div className="text-sm font-bold text-foreground tabular-nums">{typeof v === 'number' ? fmtNumber(v) : v}</div></div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* totals footer */}
        <div className="flex items-center justify-between pt-3 mt-2 border-t border-border">
          <span className="text-xs text-muted-foreground flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5 text-db-lava" /> Expected order volume · top {dc.shown} stores shown of {dc.kpis.stores}</span>
          <div className="flex items-center gap-4 text-xs">
            {dc.stores.slice(0, 5).map((s) => (
              <div key={s.store_nbr} className="text-center"><div className="text-muted-foreground">#{s.store_nbr}</div><div className={'font-bold tabular-nums ' + (s.status === 'good' ? 'text-db-success' : 'text-db-warning')}>{fmtNumber(s.forecast)}</div></div>
            ))}
            <div className="text-center pl-2 border-l border-border"><div className="text-muted-foreground">TOTAL</div><div className="font-bold text-db-lava tabular-nums">{fmtNumber(dc.kpis.expected_orders)}</div></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StoreFlow({ s }) {
  const stages = [
    { label: 'In Warehouse', qty: s.flow.in_whse, icon: Warehouse },
    { label: 'In Transit', qty: s.flow.in_transit, icon: Truck },
    { label: 'On Hand', qty: s.flow.on_hand, icon: Store },
    { label: 'On Order', qty: s.flow.on_order, icon: Database },
  ];
  return (
    <div>
      <div className="flex items-center gap-2 mb-4 text-sm">
        <Store className="w-4 h-4 text-db-lava" />
        <span className="font-semibold text-foreground">Store #{s.store.store_nbr} · {cap(s.store.name || s.store.city)}</span>
        <span className="text-muted-foreground">{cap(s.store.city)}, {s.store.state} · fulfilled by {s.store.dc_name ? cap(s.store.dc_name) : `DC #${s.store.dc_nbr}`}</span>
      </div>
      <div className="flex items-stretch gap-2">
        {stages.map((st, i) => (
          <div key={st.label} className="flex items-center gap-2 flex-1">
            <div className="flex-1 rounded-xl border border-border bg-card p-4 text-center">
              <st.icon className="w-5 h-5 mx-auto mb-1 text-db-lava" />
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{st.label}</div>
              <div className="text-xl font-bold text-foreground tabular-nums">{kfmt(st.qty)}</div>
            </div>
            {i < stages.length - 1 && <span className="text-muted-foreground">→</span>}
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2 text-sm rounded-lg border border-border bg-accent/40 px-4 py-3">
        <CheckCircle2 className="w-4 h-4 text-db-success" />
        <span className="text-foreground">Fill rate <b>{s.kpis.fill_rate}%</b> · expected next-cycle order <b>{fmtNumber(s.kpis.expected_orders)} units</b>.</span>
      </div>
    </div>
  );
}

function HeatmapCard({ store, entities, onPick, dcStores }) {
  const { data } = useHeatmap(store?.store_nbr);
  const options = (dcStores || []).map((s) => ({ store_nbr: s.store_nbr, city: s.city }));
  return (
    <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-foreground">Inventory Movement Heatmap</h3>
        {options.length > 0 && (
          <select value={store?.store_nbr} onChange={(e) => { const s = options.find((o) => String(o.store_nbr) === e.target.value); if (s) onPick(s); }}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium">
            {options.map((o) => <option key={o.store_nbr} value={o.store_nbr}>#{o.store_nbr} {cap(o.city)}</option>)}
          </select>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-4">Store Throughput Activity — Hourly × Day of Week</p>
      {!data ? <div className="h-52 animate-pulse bg-accent/50 rounded-lg" /> : <Heat grid={data.grid} hours={data.hours} />}
    </div>
  );
}

function useHeatmap(storeNbr) {
  const [data, setData] = useState(null);
  useEffect(() => {
    setData(null);
    if (!storeNbr) return;
    fetchJson(`/api/inv-intel/heatmap/${storeNbr}`).then(setData).catch(() => setData({ grid: [], hours: [] }));
  }, [storeNbr]);
  return { data };
}

function Heat({ grid, hours }) {
  const max = useMemo(() => Math.max(1, ...grid.flatMap((r) => r.cells.map((c) => c.val))), [grid]);
  const color = (v) => { if (!v) return '#fafafa'; const t = Math.pow(v / max, 0.65); return `rgba(224,72,54,${0.08 + t * 0.85})`; };
  return (
    <div className="overflow-x-auto">
      <table className="border-separate" style={{ borderSpacing: 2 }}>
        <thead><tr><th /> {hours.map((h) => <th key={h} className="text-[9px] text-muted-foreground font-normal px-0.5">{String(h).padStart(2, '0')}</th>)}</tr></thead>
        <tbody>
          {grid.map((row) => (
            <tr key={row.dow}>
              <td className="text-[11px] text-muted-foreground pr-2 text-right font-medium">{row.dow.slice(0, 3)}</td>
              {row.cells.map((c) => <td key={c.hr} title={`${row.dow} ${String(c.hr).padStart(2, '0')}:00 — ${fmtNumber(c.val)}`} style={{ background: color(c.val), width: 34, height: 26 }} className="rounded-sm" />)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
