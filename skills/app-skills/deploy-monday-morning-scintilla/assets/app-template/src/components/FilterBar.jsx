// Global filter bar: vendor selector + date-range pills + what-if simulation.
// Sits under the app header on every analytics page. Drives all data via context.

import { useState } from 'react';
import { Filter, Sliders, X } from 'lucide-react';
import { useApi, fmtCurrency } from '../lib/api';
import { useFilters, RANGE_LABELS } from '../lib/filters.jsx';

export default function FilterBar() {
  const { vendor, setVendor, category, setCategory, range, setRange, whatif, setWhatif } = useFilters();
  const { data: vendors } = useApi('/api/vendors', { raw: true });
  const { data: categories } = useApi('/api/categories' + (vendor && vendor !== 'all' ? `?vendor=${vendor}` : ''), { raw: true });
  const { data: meta } = useApi('/api/meta', { raw: true });
  const [showSim, setShowSim] = useState(false);

  const ranges = meta?.ranges || Object.entries(RANGE_LABELS).map(([id, label]) => ({ id, label }));

  return (
    <div className="sticky top-0 z-30 bg-card/95 backdrop-blur border-b border-border">
      <div className="px-4 md:px-6 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <Filter className="w-3.5 h-3.5 text-db-lava" aria-hidden="true" />
          Filters
        </div>

        {/* Vendor */}
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Vendor</span>
          <select
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-db-lava/40 min-w-[160px]"
          >
            <option value="all">All vendors</option>
            {(vendors || []).map((v) => (
              <option key={v.vendor_nbr} value={v.vendor_nbr}>{v.vendor_nm}</option>
            ))}
          </select>
        </label>

        {/* Category */}
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-db-lava/40 min-w-[150px]"
          >
            <option value="all">All categories</option>
            {(categories || []).map((c) => (
              <option key={c.category} value={c.category}>{c.category}</option>
            ))}
          </select>
        </label>

        {/* Date range pills */}
        <div className="flex items-center gap-1">
          {ranges.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={
                'px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ' +
                (range === r.id ? 'bg-db-navy text-white' : 'text-muted-foreground hover:bg-accent')
              }
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {meta?.max_date && (
            <span className="text-[11px] text-muted-foreground hidden md:inline">
              Data through {meta.max_date}
            </span>
          )}
          <button
            onClick={() => setShowSim((s) => !s)}
            className={
              'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ' +
              (whatif ? 'bg-db-lava text-white' : 'text-db-lava hover:bg-db-accent-tint')
            }
          >
            <Sliders className="w-3.5 h-3.5" aria-hidden="true" />
            What-if
          </button>
        </div>
      </div>

      {/* What-if simulation panel */}
      {showSim && (
        <div className="px-4 md:px-6 pb-3 pt-1 border-t border-border/60 bg-accent/30">
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <Sliders className="w-3.5 h-3.5 text-db-lava" /> Simulation
            </div>
            <SimSlider
              label="Sales lift"
              value={whatif?.salesLift || 0}
              min={-25} max={25} unit="%"
              onChange={(v) => setWhatif((w) => ({ ...(w || {}), salesLift: v }))}
            />
            <SimSlider
              label="In-stock change"
              value={whatif?.instockDelta || 0}
              min={-10} max={10} unit="pp"
              onChange={(v) => setWhatif((w) => ({ ...(w || {}), instockDelta: v }))}
            />
            {whatif && (
              <button onClick={() => setWhatif(null)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-db-error">
                <X className="w-3 h-3" /> Reset
              </button>
            )}
            <span className="text-[11px] text-muted-foreground">Applies live to KPIs across the dashboard.</span>
          </div>
        </div>
      )}
    </div>
  );
}

function SimSlider({ label, value, min, max, unit, onChange }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground whitespace-nowrap">{label}</span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-28 accent-db-lava" />
      <span className={'font-semibold tabular-nums w-12 ' + (value > 0 ? 'text-db-success' : value < 0 ? 'text-db-error' : 'text-muted-foreground')}>
        {value > 0 ? '+' : ''}{value}{unit}
      </span>
    </label>
  );
}
