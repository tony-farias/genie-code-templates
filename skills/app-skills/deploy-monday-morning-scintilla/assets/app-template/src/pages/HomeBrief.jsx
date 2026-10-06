// Default landing — a live "Monday Morning" companion console. Greets the user,
// shows the current scope, and pulls up the AI Executive Summary automatically
// (same visual format as the Sales tab). Everything re-runs when the vendor /
// category / range filter changes.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import FilterBar from '../components/FilterBar';
import SalesDebriefReport from '../components/SalesDebriefReport';
import { useFilters } from '../lib/filters.jsx';

const JUMP = [
  ['Sales', '/app/sales'],
  ['Category', '/app/category'],
  ['E-commerce', '/app/ecom'],
  ['Inventory', '/app/inventory'],
  ['Hourly', '/app/hourly'],
  ['Forecast', '/app/forecast'],
  ['Agents', '/app/agents'],
];

export default function HomeBrief() {
  const { vendor, category, rangeLabel } = useFilters();
  const [name, setName] = useState('there');
  const [vendorName, setVendorName] = useState(null);

  useEffect(() => {
    fetch('/api/whoami')
      .then((r) => r.json())
      .then((d) => {
        const email = (d.user || '').toString();
        const first = email.split('@')[0].split(/[._]/)[0];
        setName(first ? first.charAt(0).toUpperCase() + first.slice(1) : 'there');
      })
      .catch(() => {});
  }, []);

  // Resolve the selected vendor's real name for the scope chip.
  useEffect(() => {
    if (!vendor || vendor === 'all') { setVendorName(null); return; }
    fetch('/api/vendors')
      .then((r) => r.json())
      .then((list) => {
        const v = (list || []).find((x) => String(x.vendor_nbr) === String(vendor));
        setVendorName(v ? v.vendor_nm : `Vendor ${vendor}`);
      })
      .catch(() => setVendorName(`Vendor ${vendor}`));
  }, [vendor]);

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const scope = [
    vendorName || 'All vendors',
    category === 'all' ? 'All categories' : category,
    rangeLabel,
  ];

  return (
    <div className="min-h-screen bg-background md:pl-56">
      <AppHeader />
      <FilterBar />
      <div className="px-4 md:px-6 py-6 max-w-[1200px] mx-auto space-y-6">
        {/* Console companion header — light, live, not a dark report block */}
        <div className="rounded-2xl border border-border bg-card shadow-sm p-5 md:p-6 animate-in">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-db-success opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-db-success" />
            </span>
            Live · Monday Morning Companion · {today}
          </div>
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mt-2">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground leading-tight">Good morning, {name}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Here's your live Monday Morning brief. Change the vendor or category above and I'll refresh it instantly.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {scope.map((s) => (
                <span key={s} className="text-[11px] font-medium px-2.5 py-1 rounded-full border border-border bg-background text-foreground">{s}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Executive Summary — the redesigned 8-question analyst report (same
            component as the Sales tab). Auto-runs and re-runs on filter change. */}
        <SalesDebriefReport inline />

        {/* Jump into the details */}
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-3">Dive deeper</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {JUMP.map(([label, to]) => (
              <Link
                key={to}
                to={to}
                className="rounded-xl border border-border bg-card p-4 text-sm font-semibold text-foreground hover:border-db-lava hover:bg-db-accent-tint transition-colors flex items-center justify-between"
              >
                {label}
                <span className="text-db-lava" aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
