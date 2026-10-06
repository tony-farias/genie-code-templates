// Executive Summary — a rich, shareable "live document" generated from the
// live warehouse (/api/report/debrief, honors global filters).
//
// Download / PDF / Email all produce the SAME self-contained rich HTML page:
// full inline CSS + hand-drawn inline SVG charts (no Tailwind, no Recharts, no
// external assets), so it renders identically anywhere — a saved file, a print
// dialog, or an email attachment.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, Legend, LineChart, Line, Area, AreaChart,
  PieChart, Pie, Cell, ReferenceLine, LabelList,
} from 'recharts';
import { X, Download, Share2, Mail, Check, Loader2, FileText, Printer, CheckCircle2, AlertTriangle, Zap, TrendingUp, TrendingDown } from 'lucide-react';
import { useFilters } from '../lib/filters.jsx';

const SERIES = { actual: '#1B6FA8', plan: '#E8A33D', last_year: '#4FA97E' };
const LAVA = '#FF3621';
const NAVY = '#1B3139';
const INK = '#0B2026';
const MUTE = '#5A6F77';
const RULE = '#E7EAEC';
const POS = '#2E7D57';
const NEG = '#B4262A';
const PIE_COLORS = ['#1B3139', '#1B6FA8', '#4FA97E', '#E8A33D', '#8AB4F8', '#A66BFF'];

// The eight questions every Monday morning is really trying to answer
// (MMR deck, slide 3). This report is organized to answer each one.
const QUESTIONS = [
  { tag: 'Performance', q: 'How is my category performing vs plan and vs last year?' },
  { tag: 'Assortment', q: 'Which items should I add, expand, or cut from the shelf?' },
  { tag: 'Promotion', q: 'Did the promo drive incremental lift, or just cannibalize base?' },
  { tag: 'Online penetration', q: 'What share of my category is e-commerce, and where is growth coming from?' },
  { tag: 'Market share', q: 'Am I gaining or losing share, and to whom?' },
  { tag: 'Pricing & AUP', q: 'Is my average unit price holding, or is it under pressure?' },
  { tag: 'Innovation', q: 'How are my new items performing, and which do I scale or kill?' },
  { tag: 'In-stock & OOS', q: 'Where are out-of-stocks costing me sales, and how fast can I fix them?' },
];

/* ── whole-number formatters — NO decimals anywhere ── */
function money(n) {
  if (n == null) return '—';
  const a = Math.abs(n); const s = n < 0 ? '-' : '';
  if (a >= 1e9) return `${s}$${Math.round(a / 1e9)}B`;
  if (a >= 1e6) return `${s}$${Math.round(a / 1e6)}M`;
  if (a >= 1e3) return `${s}$${Math.round(a / 1e3)}K`;
  return `${s}$${Math.round(a)}`;
}
function pct(n, sign = false) {
  if (n == null) return '—';
  const r = Math.round(n);
  return `${sign && r > 0 ? '+' : ''}${r}%`;
}
function intNum(n) { return n == null ? '—' : Math.round(n).toLocaleString(); }
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default function SalesDebriefReport({ onClose, inline = false }) {
  const { queryString } = useFilters();
  const [rep, setRep] = useState(null);
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    setRep(null); setErr(null);
    fetch(`/api/report/debrief?${queryString}`)
      .then((r) => r.json())
      .then((j) => { if (live) { if (j.error) setErr(j.error); else setRep(j); } })
      .catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [queryString]);

  const t = rep?.totals;
  const regionChart = useMemo(
    () => (rep?.regions || []).map((r) => ({ region: r.region, actual: r.actual, plan: r.plan, last_year: r.last_year })),
    [rep]
  );

  function openDoc(forPrint) {
    const w = window.open('', '_blank');
    if (!w) return null;
    w.document.write(buildReportHTML(rep, { print: forPrint }));
    w.document.close();
    return w;
  }
  function download() {
    const blob = new Blob([buildReportHTML(rep)], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `executive-summary-${rep?.as_of || 'latest'}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function printPdf() {
    const w = openDoc(true);
    if (w) w.addEventListener('load', () => { w.focus(); w.print(); });
  }
  function email() {
    // Rich email from a browser needs a mail service; the reliable path is to
    // hand the user the rich HTML file to attach, plus a clean text brief in the
    // body. Download the doc, then open their mail client pre-filled.
    download();
    const subject = encodeURIComponent(`${rep?.report_name || 'Sales'} — Executive Summary (${rep?.range_label || ''})`);
    const body = encodeURIComponent(`${briefText(rep)}\n\n— Full formatted report attached (executive-summary-${rep?.as_of || ''}.html). Open it in any browser or print to PDF.`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }
  async function share() {
    const text = briefText(rep);
    if (navigator.share) { try { await navigator.share({ title: 'Executive Summary', text }); return; } catch { /* fall through */ } }
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* no-op */ }
  }

  const toolbar = (
    <div className={`flex items-center gap-2 px-4 py-3 bg-card shadow-sm ${inline ? 'rounded-xl border border-border mb-4' : 'border-b border-border'}`}>
      <FileText className="w-4 h-4 text-db-lava" aria-hidden="true" />
      <span className="text-sm font-semibold text-foreground">Executive Summary</span>
      <span className="text-[11px] text-muted-foreground ml-1 hidden sm:inline">live document</span>
      <div className="ml-auto flex items-center gap-2">
        <ToolbarBtn onClick={share} icon={copied ? Check : Share2} label={copied ? 'Copied' : 'Share'} disabled={!rep} />
        <ToolbarBtn onClick={download} icon={Download} label="Download" disabled={!rep} />
        <ToolbarBtn onClick={printPdf} icon={Printer} label="PDF" disabled={!rep} />
        <ToolbarBtn onClick={email} icon={Mail} label="Email" disabled={!rep} />
        {!inline && (
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground ml-1">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );

  const D = deriveExec(rep);

  const docBody = (
    <div className="mx-auto max-w-4xl bg-white text-[#0B2026] rounded-xl border border-[#E7EAEC] shadow-xl overflow-hidden">
      {!rep && !err && (
        <div className="p-16 text-center text-[#5A6F77]">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3 text-db-lava" />
          Generating the executive summary from live data…
        </div>
      )}
      {err && <div className="p-16 text-center text-db-error text-sm">Couldn’t generate the summary: {err}</div>}

      {rep && D && (
        <div className="px-7 md:px-12 py-9 md:py-11">
          {/* Masthead — white analyst document */}
          <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-[#E7EAEC]">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5A6F77] mb-2">
                <span className="inline-block w-6 h-[2px] bg-db-lava" />{rep.report_name || 'Monday Morning · Retail Insights'}
              </div>
              <h1 className="text-[26px] md:text-[32px] font-bold tracking-tight leading-tight">{rep.title || 'Executive Summary'}</h1>
              <p className="text-[13px] text-[#5A6F77] mt-1.5">{rep.subtitle}</p>
            </div>
            <div className="text-right text-[11px] text-[#5A6F77] leading-relaxed">
              <div className="font-semibold text-[#0B2026]">Prepared for the leadership review</div>
              <div>Data as of {rep.as_of}</div>
              <div>Plan basis: {rep.plan_basis}</div>
            </div>
          </div>

          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[#E7EAEC] border border-[#E7EAEC] rounded-lg overflow-hidden mt-5">
            <KpiCell label="Net Sales" value={money(t.actual)} foot={t.var_to_plan_pct != null ? `${pct(t.var_to_plan_pct, true)} vs plan` : null} tone={t.var_to_plan_pct >= 0 ? 'pos' : 'neg'} />
            <KpiCell label="vs Last Year" value={t.vs_ly_pct != null ? pct(t.vs_ly_pct, true) : '—'} tone={t.vs_ly_pct >= 0 ? 'pos' : 'neg'} />
            <KpiCell label="In-Stock" value={t.in_stock != null ? `${Math.round(t.in_stock)}%` : '—'} tone={t.in_stock >= 95 ? 'pos' : 'warn'} />
            <KpiCell label="E-com Mix" value={t.ecom_pct != null ? `${Math.round(t.ecom_pct)}%` : '—'} />
          </div>

          {/* Question index */}
          <div className="mt-6 rounded-lg border border-[#E7EAEC] bg-[#FAFBFB] px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5A6F77] mb-2">The eight questions this briefing answers</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {QUESTIONS.map((qq, i) => (
                <span key={i} className="text-[12px] text-[#0B2026]"><span className="font-mono text-db-lava font-bold mr-1">{String(i + 1).padStart(2, '0')}</span>{qq.tag}</span>
              ))}
            </div>
          </div>

          {/* Actions this week — funded, sized from the account's own numbers */}
          {D.actions?.length > 0 && (
            <div className="mt-4 rounded-lg border border-db-lava/40 bg-db-lava/[0.04] px-4 py-3.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-db-lava mb-2.5">Actions this week</div>
              <ol className="space-y-2">
                {D.actions.map((a, i) => (
                  <li key={i} className="text-[13px] text-[#0B2026] leading-snug flex gap-2.5">
                    <span className="font-mono text-db-lava font-bold shrink-0">{i + 1}</span>
                    <span className="tabular-nums">{highlight(a)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* ── 01 Performance (by category, not geography) ── */}
          <QSection i={0} takeaway={D.t1} action={D.a1}>
            {D.catsPerf.length > 0 && (
              <ChartCard title="Category net sales — actual vs plan vs last year">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={D.catsPerf} margin={{ top: 8, right: 8, left: 0, bottom: 52 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={RULE} vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: MUTE }} interval={0} angle={-25} textAnchor="end" height={70} />
                    <YAxis tick={{ fontSize: 10, fill: MUTE }} tickFormatter={(v) => `$${Math.round(v / 1e6)}M`} />
                    <RTooltip formatter={(v) => money(v)} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar name="Net Sales" dataKey="actual" fill={SERIES.actual} radius={[3, 3, 0, 0]} />
                    <Bar name="Plan" dataKey="plan" fill={SERIES.plan} radius={[3, 3, 0, 0]} />
                    <Bar name="Last Year" dataKey="last_year" fill={SERIES.last_year} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
            <CatTable cats={D.catsPerf} />
          </QSection>

          {/* ── 02 Assortment ── */}
          <QSection i={1} takeaway={D.t2} action={D.a2}>
            <AssortmentLegend />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <MoverList title="Expand — scaling items" items={D.moversUp} tone="pos" note={MOVER_METHOD} />
              <MoverList title="Review or cut — declining items" items={D.moversDown} tone="neg" note={MOVER_METHOD} />
            </div>
          </QSection>

          {/* ── 03 Promotion (price vs volume) ── */}
          <QSection i={2} takeaway={D.t3} action={D.a3}>
            <ChartCard title="Growth decomposition — volume vs realized price (period over period)">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={D.pvData} layout="vertical" margin={{ top: 6, right: 28, left: 24, bottom: 6 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={RULE} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: MUTE }} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: INK }} width={70} />
                  <ReferenceLine x={0} stroke={MUTE} />
                  <RTooltip formatter={(v) => `${v}%`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="v" radius={[0, 3, 3, 0]}>
                    {D.pvData.map((d, i) => <Cell key={i} fill={(d.v || 0) >= 0 ? POS : NEG} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="text-[11px] text-[#5A6F77] mt-1">No promotion table is tracked in this dataset. This splits the sales change into how much came from selling more units versus a higher realized price — the read a trade analyst uses to judge promo lift versus base cannibalization.</p>
            </ChartCard>
          </QSection>

          {/* ── 04 Online penetration ── */}
          <QSection i={3} takeaway={D.t4} action={D.a4}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              {D.channelMix.length > 0 && (
                <ChartCard title="Sales by channel">
                  <ResponsiveContainer width="100%" height={230}>
                    <PieChart>
                      <Pie data={D.channelMix} dataKey="sales" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={86} paddingAngle={2}>
                        {D.channelMix.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <RTooltip formatter={(v) => money(v)} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartCard>
              )}
              <div className="text-center">
                <div className="text-[52px] font-bold leading-none text-[#1B3139]">{t.ecom_pct != null ? `${Math.round(t.ecom_pct)}%` : '—'}</div>
                <div className="text-[12px] text-[#5A6F77] mt-1">of sales are e-commerce<br />(delivery, pickup, ship-from-store)</div>
              </div>
            </div>
          </QSection>

          {/* ── 05 Market share ── */}
          <QSection i={4} takeaway={D.t5} action={D.a5}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {D.brandShare.length > 0 && (
                <ChartCard title={`Brand share within ${rep.brand_share?.category || 'the top category'}`}>
                  <ColorBars items={D.brandShare.map((b) => ({ name: b.brand, sales: b.sales }))} />
                  <p className="text-[11px] text-[#5A6F77] mt-2">Each brand colored distinctly. Share of sales within the tracked assortment — the private-label versus national-brand read.</p>
                </ChartCard>
              )}
              {rep.categories?.length > 0 && (
                <ChartCard title="Category mix">
                  <ColorBars items={rep.categories} />
                </ChartCard>
              )}
            </div>
          </QSection>

          {/* ── 06 Pricing & AUP ── */}
          <QSection i={5} takeaway={D.t6} action={D.a6}>
            {D.aurTrend.length > 1 ? (
              <ChartCard title="Realized average unit retail (sales ÷ units) by month">
                <div className="flex items-baseline gap-4 mb-2">
                  <div><span className="text-[10px] uppercase tracking-wider text-[#5A6F77]">Current</span> <span className="text-[18px] font-bold tabular-nums text-[#0B2026] ml-1">{t.aur != null ? `$${Math.round(t.aur)}` : '—'}</span></div>
                  {D.aurAvg != null && <div><span className="text-[10px] uppercase tracking-wider text-[#5A6F77]">Period average</span> <span className="text-[18px] font-bold tabular-nums text-db-lava ml-1">${D.aurAvg}</span></div>}
                </div>
                <ResponsiveContainer width="100%" height={210}>
                  <LineChart data={D.aurTrend} margin={{ top: 6, right: 44, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={RULE} />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: MUTE }} tickFormatter={(m) => (m || '').slice(5)} />
                    <YAxis tick={{ fontSize: 10, fill: MUTE }} domain={['auto', 'auto']} tickFormatter={(v) => `$${v}`} />
                    <RTooltip formatter={(v) => `$${v}`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    {D.aurAvg != null && <ReferenceLine y={D.aurAvg} stroke={NAVY} strokeDasharray="5 4" label={{ value: `Avg $${D.aurAvg}`, fontSize: 10, fill: NAVY, position: 'right' }} />}
                    <Line type="monotone" dataKey="aur" name="AUR" stroke={LAVA} strokeWidth={2} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
                <p className="text-[11px] text-[#5A6F77] mt-1">Dashed line = period average AUR (${D.aurAvg}). Points above the line are price-accretive months; below, price is under pressure.</p>
              </ChartCard>
            ) : <p className="text-[13px] text-[#5A6F77]">Average unit retail is {t.aur != null ? `$${Math.round(t.aur)}` : '—'} in the current window{D.aurAvg != null ? ` (period average $${D.aurAvg})` : ''}.</p>}

            {D.aurByBrand.length > 0 && (
              <div className="mt-4">
                <ChartCard title={`Average unit price by brand${rep.aur_by_brand?.category ? ` · ${rep.aur_by_brand.category}` : ''}`}>
                  <ResponsiveContainer width="100%" height={Math.max(180, D.aurByBrand.length * 34 + 30)}>
                    <BarChart data={D.aurByBrand} layout="vertical" margin={{ top: 6, right: 40, left: 8, bottom: 6 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={RULE} horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: MUTE }} tickFormatter={(v) => `$${v}`} />
                      <YAxis type="category" dataKey="brand" tick={{ fontSize: 10, fill: INK }} width={120} />
                      {D.aurAvg != null && <ReferenceLine x={D.aurAvg} stroke={NAVY} strokeDasharray="5 4" label={{ value: `Overall avg $${D.aurAvg}`, fontSize: 9, fill: NAVY, position: 'top' }} />}
                      <RTooltip formatter={(v) => `$${v}`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="aur" radius={[0, 3, 3, 0]}>
                        {D.aurByBrand.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        <LabelList dataKey="aur" position="right" formatter={(v) => `$${v}`} style={{ fontSize: 10, fill: INK }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="text-[11px] text-[#5A6F77] mt-1">Each brand color-coded. Bars past the dashed line price above the overall average; short bars are the value/opening-price brands.</p>
                </ChartCard>
              </div>
            )}
          </QSection>

          {/* ── 07 Innovation / emerging ── */}
          <QSection i={6} takeaway={D.t7} action={D.a7}>
            <MoverList title="Fastest-rising items — scale candidates" items={D.moversUp} tone="pos" showBar note={`${MOVER_METHOD} Item-launch dates are not tracked, so week-over-week acceleration is the available proxy for what is breaking out.`} />
          </QSection>

          {/* ── 08 In-stock & OOS ── */}
          <QSection i={7} takeaway={D.t8} action={D.a8}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
              {D.availability.length > 0 && (
                <ChartCard title="On-shelf availability by category (lowest first)">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={D.availability} layout="vertical" margin={{ top: 4, right: 30, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={RULE} horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: MUTE }} tickFormatter={(v) => `${v}%`} />
                      <YAxis type="category" dataKey="cat" tick={{ fontSize: 10, fill: INK }} width={110} />
                      <ReferenceLine x={95} stroke={NEG} strokeDasharray="3 3" />
                      <RTooltip formatter={(v) => `${v}%`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="in_stock" radius={[0, 3, 3, 0]}>
                        {D.availability.map((d, i) => <Cell key={i} fill={(d.in_stock || 0) >= 95 ? POS : LAVA} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              )}
              <div className="rounded-lg border border-[#E7EAEC] p-4">
                <div className="text-[11px] uppercase tracking-wider text-[#5A6F77]">In-stock rate</div>
                <div className={`text-[40px] font-bold leading-none mt-1 ${t.in_stock >= 95 ? 'text-[#2E7D57]' : 'text-db-lava'}`}>{t.in_stock != null ? `${Math.round(t.in_stock)}%` : '—'}</div>
                <div className="text-[12px] text-[#5A6F77] mt-1">against a 95% target</div>
                {D.atRisk > 0 && <div className="mt-3 text-[13px] text-[#0B2026]">Closing the gap to 98% recovers an estimated <strong>{money(D.atRisk)}</strong> in at-risk sales.</div>}
                {t.return_pct != null && <div className="mt-2 text-[12px] text-[#5A6F77]">Returns are running {Math.round(t.return_pct)}% of sales.</div>}
              </div>
            </div>
          </QSection>

          {/* Footer */}
          <div className="mt-10 pt-4 border-t border-[#E7EAEC] text-[11px] text-[#5A6F77] space-y-1">
            <p>Question framework: category-captain playbooks (Walmart, Kroger, Target) and analyst frameworks (Circana, NielsenIQ, McKinsey, Bain).</p>
            <p>Generated {new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} from {rep.report_name || 'Monday Morning'} · data as of {rep.as_of} · figures reflect the current global filter.</p>
          </div>
        </div>
      )}
    </div>
  );

  if (inline) {
    return (
      <div>
        {toolbar}
        {docBody}
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/50" role="dialog" aria-modal="true">
      {toolbar}
      <div className="flex-1 overflow-y-auto py-6 px-4">
        {docBody}
      </div>
    </div>
  );
}

/* ─────────────── on-screen sub-components ─────────────── */
function SectionHead({ children }) {
  return <h2 className="text-lg font-bold text-foreground border-b-2 border-db-lava pb-1.5 mt-8 mb-3">{children}</h2>;
}
function StatTile({ label, value, foot, tone }) {
  const c = tone === 'pos' ? 'text-db-success' : tone === 'neg' ? 'text-db-error' : tone === 'warn' ? 'text-db-warning' : 'text-muted-foreground';
  return (
    <div className="rounded-xl border border-border bg-card p-3.5 shadow-sm">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xl font-bold tabular-nums text-foreground mt-1">{value}</div>
      {foot && <div className={`text-[11px] mt-0.5 font-medium ${c}`}>{foot}</div>}
    </div>
  );
}
function ToolbarBtn({ onClick, icon: Icon, label, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:border-db-lava hover:text-db-lava hover:bg-db-lava/5 transition-colors disabled:opacity-40">
      <Icon className="w-3.5 h-3.5" aria-hidden="true" /><span className="hidden sm:inline">{label}</span>
    </button>
  );
}
function BriefSection({ section }) {
  const cfg = {
    good: { icon: CheckCircle2, color: 'text-db-success', ring: 'border-db-success/30 bg-db-success/5' },
    warn: { icon: AlertTriangle, color: 'text-db-warning', ring: 'border-db-warning/30 bg-db-warning/5' },
    action: { icon: Zap, color: 'text-db-lava', ring: 'border-db-lava/30 bg-db-lava/5' },
  }[section.tone] || { icon: CheckCircle2, color: 'text-foreground', ring: 'border-border' };
  const Icon = cfg.icon;
  return (
    <div className={`rounded-xl border p-3.5 ${cfg.ring}`}>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className={`w-4 h-4 ${cfg.color}`} aria-hidden="true" />
        <h3 className="text-[13px] font-bold text-foreground">{section.title}</h3>
      </div>
      <ul className="space-y-1.5">
        {section.points.map((p, i) => (
          <li key={i} className="text-[12px] leading-snug text-foreground flex gap-1.5">
            <span className={`${cfg.color} shrink-0`}>▹</span><span>{highlight(p)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
function TotalsTable({ t }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-accent text-muted-foreground">
            <th className="text-left px-3 py-2 font-semibold">Metric</th>
            <th className="text-right px-3 py-2 font-semibold">Actual</th>
            <th className="text-right px-3 py-2 font-semibold">Plan</th>
            <th className="text-right px-3 py-2 font-semibold">Var to Plan</th>
            <th className="text-right px-3 py-2 font-semibold">Last Year</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-border">
            <td className="px-3 py-2.5 font-medium text-foreground">Net Sales</td>
            <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{money(t.actual)}</td>
            <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{t.plan != null ? money(t.plan) : '—'}</td>
            <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${signColor(t.var_to_plan_pct)}`}>
              {t.var_to_plan != null ? `${t.var_to_plan >= 0 ? '+' : ''}${money(t.var_to_plan)} (${pct(t.var_to_plan_pct, true)})` : '—'}
            </td>
            <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{t.last_year != null ? money(t.last_year) : '—'}</td>
          </tr>
          <tr className="border-t border-border">
            <td className="px-3 py-2.5 font-medium text-foreground">Units</td>
            <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{intNum(t.units)}</td>
            <td className="px-3 py-2.5 text-right text-muted-foreground" colSpan={3}>—</td>
          </tr>
          <tr className="border-t border-border">
            <td className="px-3 py-2.5 font-medium text-foreground">Avg Unit Retail</td>
            <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{t.aur != null ? `$${Math.round(t.aur)}` : '—'}</td>
            <td className="px-3 py-2.5 text-right text-muted-foreground" colSpan={3}>—</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
function RegionTable({ regions }) {
  return (
    <div className="overflow-x-auto mt-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-accent text-muted-foreground">
            <th className="text-left px-3 py-2 font-semibold">Region</th>
            <th className="text-right px-3 py-2 font-semibold">Stores</th>
            <th className="text-right px-3 py-2 font-semibold">Net Sales</th>
            <th className="text-right px-3 py-2 font-semibold">Var to Plan</th>
          </tr>
        </thead>
        <tbody>
          {regions.map((r) => (
            <tr key={r.region} className="border-t border-border">
              <td className="px-3 py-2 font-medium text-foreground">{r.region}</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.stores}</td>
              <td className="px-3 py-2 text-right tabular-nums text-foreground">{money(r.actual)}</td>
              <td className={`px-3 py-2 text-right tabular-nums font-medium ${signColor(r.var_to_plan_pct)}`}>{r.var_to_plan_pct != null ? pct(r.var_to_plan_pct, true) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function CategoryBars({ categories }) {
  const max = Math.max(...categories.map((c) => c.sales || 0)) || 1;
  return (
    <div className="space-y-2.5">
      {categories.map((c, i) => (
        <div key={c.name}>
          <div className="flex justify-between text-xs mb-1">
            <span className="font-medium text-foreground truncate">{c.name}</span>
            <span className="tabular-nums text-muted-foreground">{money(c.sales)}</span>
          </div>
          <div className="h-2.5 rounded-full bg-accent overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(c.sales / max) * 100}%`, background: [SERIES.actual, LAVA, SERIES.last_year, SERIES.plan, '#8AB4F8', '#A66BFF'][i % 6] }} />
          </div>
        </div>
      ))}
    </div>
  );
}
// Bars where each row gets its own color + a share-of-total %. Used for brands and
// category mix so each entry is visually distinct (not one flat color).
function ColorBars({ items }) {
  const total = items.reduce((a, b) => a + (b.sales || 0), 0) || 1;
  const max = Math.max(...items.map((c) => c.sales || 0)) || 1;
  return (
    <div className="space-y-2.5">
      {items.map((c, i) => {
        const color = PIE_COLORS[i % PIE_COLORS.length];
        return (
          <div key={c.name}>
            <div className="flex justify-between text-xs mb-1 gap-2">
              <span className="font-medium text-[#0B2026] truncate flex items-center gap-1.5 min-w-0">
                <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />
                <span className="truncate">{c.name}</span>
              </span>
              <span className="tabular-nums text-[#5A6F77] shrink-0">{money(c.sales)} · {Math.round((c.sales || 0) / total * 100)}%</span>
            </div>
            <div className="h-2.5 rounded-full bg-[#F1F3F4] overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${(c.sales / max) * 100}%`, background: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
function signColor(p) { return p == null ? 'text-muted-foreground' : p >= 0 ? 'text-db-success' : 'text-db-error'; }
function highlight(text) {
  if (!text) return null;
  const parts = String(text).split(/(\$[\d.,]+[KMB]?|[+-]?\d+(?:\.\d+)?%)/g);
  return parts.map((p, i) =>
    /^(\$[\d.,]+[KMB]?|[+-]?\d+(?:\.\d+)?%)$/.test(p)
      ? <strong key={i} className="font-bold text-foreground">{p}</strong>
      : <span key={i}>{p}</span>);
}

/* ─────────────── eight-question layout components ─────────────── */
function KpiCell({ label, value, foot, tone }) {
  const c = tone === 'pos' ? 'text-[#2E7D57]' : tone === 'neg' ? 'text-db-error' : tone === 'warn' ? 'text-db-warning' : 'text-[#5A6F77]';
  return (
    <div className="bg-white px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#5A6F77]">{label}</div>
      <div className="text-[22px] font-bold tabular-nums text-[#0B2026] mt-0.5">{value}</div>
      {foot && <div className={`text-[11px] mt-0.5 font-medium ${c}`}>{foot}</div>}
    </div>
  );
}
function QSection({ i, takeaway, action, children }) {
  const { tag, q } = QUESTIONS[i];
  return (
    <section className="py-7 border-t border-[#E7EAEC]">
      <div className="flex items-baseline gap-3 mb-1">
        <span className="font-mono text-[13px] font-bold text-db-lava">{String(i + 1).padStart(2, '0')}</span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5A6F77]">{tag}</span>
      </div>
      <h2 className="text-[19px] md:text-[21px] font-bold text-[#0B2026] leading-snug">{q}</h2>
      {takeaway && <p className="text-[14px] text-[#1B3139] mt-2 mb-4 font-medium tabular-nums">{highlight(takeaway)}</p>}
      <div>{children}</div>
      {action && (
        <div className="mt-4 flex gap-2 rounded-lg bg-[#FAFBFB] border-l-[3px] border-db-lava px-3 py-2.5">
          <span className="text-db-lava font-bold shrink-0">→</span>
          <p className="text-[13px] text-[#0B2026] leading-snug"><span className="font-semibold uppercase tracking-wide text-[11px] text-[#5A6F77] mr-1.5">This week</span>{highlight(action)}</p>
        </div>
      )}
    </section>
  );
}
function CatTable({ cats }) {
  if (!cats?.length) return null;
  return (
    <div className="overflow-x-auto mt-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[#5A6F77] border-b-2 border-[#E7EAEC]">
            <th className="text-left px-3 py-2 font-semibold">Category</th>
            <th className="text-right px-3 py-2 font-semibold">Net Sales</th>
            <th className="text-right px-3 py-2 font-semibold">vs Plan</th>
            <th className="text-right px-3 py-2 font-semibold">vs Last Year</th>
          </tr>
        </thead>
        <tbody>
          {cats.map((c) => (
            <tr key={c.name} className="border-b border-[#F1F3F4]">
              <td className="px-3 py-2 font-medium text-[#0B2026]">{c.name}</td>
              <td className="px-3 py-2 text-right tabular-nums text-[#0B2026]">{money(c.actual)}</td>
              <td className={`px-3 py-2 text-right tabular-nums font-medium ${c.var_to_plan_pct >= 0 ? 'text-[#2E7D57]' : 'text-db-error'}`}>{c.var_to_plan_pct != null ? pct(c.var_to_plan_pct, true) : '—'}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${c.vs_ly_pct >= 0 ? 'text-[#2E7D57]' : 'text-db-error'}`}>{c.vs_ly_pct != null ? pct(c.vs_ly_pct, true) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-[#5A6F77] mt-1.5">Plan = prior comparable period. Grouped by department (omni category), not geography.</p>
    </div>
  );
}
function ChartCard({ title, children }) {
  return (
    <div className="rounded-lg border border-[#E7EAEC] p-4">
      {title && <p className="text-[12px] font-semibold text-[#0B2026] mb-3">{title}</p>}
      {children}
    </div>
  );
}
// Prior → this-week mini trend. Both bars share the same scale, so a growing item
// visibly lengthens and a shrinking item visibly shortens — the direction is obvious
// at a glance, which is what separates the Expand bucket from the Cut bucket.
function MiniTrend({ prev, cur, color }) {
  const max = Math.max(prev || 0, cur || 0, 1);
  const Row = ({ label, val, faded }) => (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] text-[#5A6F77] w-11 shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded bg-[#F1F3F4] overflow-hidden">
        <div className="h-full rounded" style={{ width: `${Math.max(3, (val || 0) / max * 100)}%`, background: color, opacity: faded ? 0.35 : 1 }} />
      </div>
      <span className="text-[9px] tabular-nums text-[#5A6F77] w-10 text-right shrink-0">{money(val)}</span>
    </div>
  );
  return <div className="space-y-1 mt-2"><Row label="Prior wk" val={prev} faded /><Row label="This wk" val={cur} /></div>;
}
function MoverList({ title, items, tone, note }) {
  const col = tone === 'pos' ? '#2E7D57' : '#B4262A';
  const verb = tone === 'pos' ? 'up' : 'down';
  const rec = tone === 'pos' ? 'SCALE' : 'CUT / RESET';
  const Arrow = tone === 'pos' ? '▲' : '▼';
  return (
    <div className="rounded-lg border border-[#E7EAEC] overflow-hidden" style={{ borderTop: `3px solid ${col}` }}>
      <div className="flex items-center justify-between px-4 py-2.5" style={{ background: tone === 'pos' ? 'rgba(46,125,87,0.06)' : 'rgba(180,38,42,0.06)' }}>
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-bold" style={{ color: col }}>{Arrow}</span>
          <span className="text-[12px] font-bold text-[#0B2026]">{title}</span>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color: col, background: tone === 'pos' ? 'rgba(46,125,87,0.12)' : 'rgba(180,38,42,0.12)' }}>{items.length}</span>
      </div>
      <div className="p-4">
        {items.length === 0 ? <p className="text-[12px] text-[#5A6F77]">No items to show in this view.</p> : (
          <ul className="space-y-3.5">
            {items.map((m, i) => {
              const cta = moverCTA(m.growth, m.prev, tone);
              const ctaCol = CTA_COLOR[cta.label] || col;
              const why = `${cta.label}: ${cta.detail}. ${verb} ${Math.abs(m.growth || 0)}% week over week — ${money(m.sales)} this week vs ${money(m.prev)} the prior full week.`;
              return (
                <li key={i} className="text-[12px] pb-3 border-b border-[#F1F3F4] last:border-0 last:pb-0" title={why}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#0B2026] truncate font-medium">{m.name}</span>
                    <span className="tabular-nums font-bold shrink-0" style={{ color: col }}>{Arrow} {pct(m.growth, true)}</span>
                  </div>
                  <div className="text-[10px] text-[#5A6F77] mt-0.5 truncate">{m.category}</div>
                  <MiniTrend prev={m.prev} cur={m.sales} color={col} />
                  {/* per-item call to action */}
                  <div className="flex items-start gap-1.5 mt-1.5">
                    <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0" style={{ color: '#fff', background: ctaCol }}>{cta.label}</span>
                    <span className="text-[10px] text-[#5A6F77] leading-snug">{cta.detail}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {note && <p className="text-[10px] text-[#5A6F77] mt-3 pt-2 border-t border-[#F1F3F4] leading-snug">{note}</p>}
      </div>
    </div>
  );
}
const MOVER_METHOD = 'How this is computed: sales change between the two most recent full sales weeks (partial weeks excluded), for items with a prior-week base above $1,000. Ranked by percent change.';
// The specific merchandising call to action for one item, derived from its
// week-over-week move and its prior-week base. This is the "so what" per SKU.
const CTA_COLOR = { Promote: '#2E7D57', Feature: '#2E7D57', Maintain: '#5A6F77', Reset: '#B26A00', Remove: '#B4262A', Watch: '#5A6F77' };
function moverCTA(growth, prev, tone) {
  const g = growth || 0;
  if (tone === 'pos') {
    if (g >= 50) return { label: 'Promote', detail: 'expand facings, secure supply, feature in-aisle' };
    if (g >= 20) return { label: 'Feature', detail: 'add facings and feature placement' };
    return { label: 'Maintain', detail: 'hold facings, protect in-stock' };
  }
  const small = (prev || 0) < 5000;
  if (g <= -50 || (g <= -30 && small)) return { label: 'Remove', detail: 'delist candidate — clear and reallocate the space' };
  if (g <= -20) return { label: 'Reset', detail: 're-merchandise; check placement, price, and availability' };
  return { label: 'Watch', detail: 'monitor one more week before acting' };
}
// Plain-language definition of the two buckets + the action tiers, shown in-report.
function AssortmentLegend() {
  const Row = ({ c, k, v }) => (
    <div className="flex gap-2 text-[11px] leading-snug">
      <span className="font-bold shrink-0 w-[62px]" style={{ color: c }}>{k}</span>
      <span className="text-[#5A6F77]">{v}</span>
    </div>
  );
  return (
    <div className="rounded-lg border border-[#E7EAEC] bg-[#FAFBFB] p-4 mb-4">
      <div className="text-[11px] text-[#0B2026] mb-2.5">
        <b>Scaling</b> = items with rising week-over-week sales. <b>Cutting</b> = items with declining sales. The call to action for each item is set by how fast it is moving:
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
        <Row c={CTA_COLOR.Promote} k="Promote" v="rising ≥ 50% — expand facings, secure supply" />
        <Row c={CTA_COLOR.Remove} k="Remove" v="down ≥ 50% (or ≥ 30% on a small base) — delist" />
        <Row c={CTA_COLOR.Feature} k="Feature" v="rising 20–50% — add facings, feature placement" />
        <Row c={CTA_COLOR.Reset} k="Reset" v="down 20–50% — re-merchandise, check price & stock" />
        <Row c={CTA_COLOR.Maintain} k="Maintain" v="rising < 20% — hold facings, protect in-stock" />
        <Row c={CTA_COLOR.Watch} k="Watch" v="down < 20% — monitor one more week" />
      </div>
    </div>
  );
}
function channelLabel(c) {
  const m = { DELIVERY: 'Delivery', PICKUP: 'Pickup', SFS: 'Ship-from-store', STORE: 'In-store', 'IN-STORE': 'In-store', BIS: 'In-store', COMP: 'In-store' };
  return m[c] || (c ? c.charAt(0) + c.slice(1).toLowerCase() : 'Other');
}
// Derive each section's data, a crisp number-first takeaway (the "what"), and a
// concrete this-week action (the "so what"). Every claim is sourced from the live
// payload — defendable, explainable, actionable. No filler.
function deriveExec(rep) {
  if (!rep) return null;
  const t = rep.totals || {};
  const pv = rep.price_volume || {};
  const volPct = pv.prev_units ? Math.round((pv.cur_units - pv.prev_units) / pv.prev_units * 100) : null;
  const pricePct = pv.prev_aur ? Math.round((pv.cur_aur - pv.prev_aur) / pv.prev_aur * 100) : null;
  const catsPerf = rep.categories_perf || [];
  const moversUp = rep.movers_up || [];
  const moversDown = rep.movers_down || [];
  const channelMix = (rep.channels || []).map((c) => ({ name: channelLabel(c.channel), sales: c.sales }));
  const brandShare = rep.brand_share?.brands || [];
  const aurTrend = rep.aur_trend || [];
  const aurAvg = aurTrend.length ? Math.round(aurTrend.reduce((a, b) => a + (b.aur || 0), 0) / aurTrend.length) : (t.aur != null ? Math.round(t.aur) : null);
  const aurByBrand = rep.aur_by_brand?.brands || [];
  const availability = rep.availability || [];
  const worstAvail = availability[0];
  const actions = rep.actions_this_week || [];
  const atRisk = (t.actual && t.in_stock != null && t.in_stock < 98) ? Math.round(t.actual * Math.max(0, (98 - t.in_stock) / 100) * 0.5) : 0;

  const ranked = catsPerf.filter((c) => c.var_to_plan_pct != null);
  const worstCat = [...ranked].sort((a, b) => a.var_to_plan_pct - b.var_to_plan_pct)[0];
  const bestCat = [...ranked].sort((a, b) => b.var_to_plan_pct - a.var_to_plan_pct)[0];
  const topEcom = channelMix.filter((c) => /deliver|pickup|ship/i.test(c.name)).sort((a, b) => b.sales - a.sales)[0];
  const bTot = brandShare.reduce((a, b) => a + (b.sales || 0), 0) || 1;

  // Takeaways — number-first, no adjectives.
  const t1 = `${money(t.actual)} net sales · ${t.var_to_plan_pct != null ? `${pct(t.var_to_plan_pct, true)} vs plan` : 'plan n/a'}${t.vs_ly_pct != null ? ` · ${pct(t.vs_ly_pct, true)} vs last year` : ''}.`;
  const t2 = (moversUp.length || moversDown.length) ? `${moversUp.length} items rising, ${moversDown.length} declining week over week.` : 'Not enough weekly movement to rank items.';
  const t3 = (volPct != null && pricePct != null) ? `Units ${pct(volPct, true)}, realized price ${pct(pricePct, true)} vs prior period — growth is ${Math.abs(volPct) >= Math.abs(pricePct) ? 'volume-led' : 'price-led'}.` : 'Price-vs-volume split n/a for this window.';
  const t4 = t.ecom_pct != null ? `E-commerce ${Math.round(t.ecom_pct)}% of sales${topEcom ? ` · ${topEcom.name} largest` : ''}.` : 'E-commerce share n/a.';
  const t5 = brandShare.length ? `${brandShare[0].brand} = ${Math.round(brandShare[0].sales / bTot * 100)}% of ${rep.brand_share?.category || 'top category'} sales.` : 'Brand-level share n/a.';
  const t6 = t.aur != null ? `AUR $${Math.round(t.aur)}${pricePct != null ? ` · ${pct(pricePct, true)} vs prior period` : ''}.` : 'AUR n/a.';
  const t7 = moversUp.length ? `Top riser: ${moversUp[0].name}, ${pct(moversUp[0].growth, true)} week over week.` : 'No breakout items this week.';
  const t8 = t.in_stock != null ? `In-stock ${Math.round(t.in_stock)}%${worstAvail ? ` · weakest ${worstAvail.cat} ${Math.round(worstAvail.in_stock)}%` : ''}.` : 'Availability n/a.';

  // Actions — specific, tied to the number above, doable this week.
  const a1 = (worstCat && worstCat.var_to_plan_pct < 0) ? `Rebalance replenishment and promo support to ${worstCat.name} — ${pct(worstCat.var_to_plan_pct, true)} vs plan, the furthest behind.` : (bestCat ? `Hold the plan; ${bestCat.name} leads at ${pct(bestCat.var_to_plan_pct, true)}.` : null);
  const a2 = (moversUp.length || moversDown.length) ? `Add facings to the ${moversUp.length} risers${moversDown.length ? `; put the ${moversDown.length} decliners on the reset or cut list` : ''}.` : null;
  const a3 = (volPct != null && pricePct != null) ? (Math.abs(pricePct) > Math.abs(volPct) ? `Re-check promo depth — growth is price-led; base volume moved only ${pct(volPct, true)}.` : `Keep the promo cadence — it drove real volume (${pct(volPct, true)} units).`) : null;
  const a4 = topEcom ? `Prioritize ${topEcom.name.toLowerCase()} fulfillment — the largest online channel this week.` : null;
  const a5 = brandShare.length ? `Defend shelf and in-stock against ${brandShare[0].brand} in ${rep.brand_share?.category || 'the top category'}.` : null;
  const a6 = (pricePct != null && pricePct < 0) ? `Investigate price erosion — realized AUR is ${pct(pricePct, true)} vs prior period.` : (t.aur != null ? 'Hold price; AUR is stable versus the prior period.' : null);
  const a7 = moversUp.length ? `Scale ${moversUp[0].name} now — fastest riser at ${pct(moversUp[0].growth, true)}; secure supply and distribution.` : null;
  const a8 = worstAvail ? `Fix availability in ${worstAvail.cat} (${Math.round(worstAvail.in_stock)}%)${atRisk > 0 ? ` — recovers ~${money(atRisk)}` : ''}.` : (atRisk > 0 ? `Lift in-stock toward 98% to recover ~${money(atRisk)} in at-risk sales.` : null);

  return {
    catsPerf, moversUp, moversDown, channelMix, brandShare, aurTrend, aurAvg, aurByBrand, availability, atRisk, actions, worstCat,
    pvData: [{ name: 'Volume', v: volPct }, { name: 'Price', v: pricePct }],
    t1, t2, t3, t4, t5, t6, t7, t8, a1, a2, a3, a4, a5, a6, a7, a8,
  };
}

/* ─────────────── plain-text brief (share / email body) ─────────────── */
function briefText(rep) {
  if (!rep) return '';
  const lines = [`${rep.report_name || 'Sales'} — Executive Summary`, rep.subtitle, ''];
  (rep.narrative || [rep.headline]).forEach((p) => { lines.push(p, ''); });
  (rep.sections || []).forEach((s) => {
    lines.push(s.title.toUpperCase());
    (s.points || []).forEach((p) => lines.push(`  • ${p}`));
    lines.push('');
  });
  return lines.join('\n').trim();
}

/* ─────────────── self-contained rich HTML export ───────────────
   Inline CSS + hand-drawn inline SVG charts so the document renders
   identically as a saved file, a printed PDF, or an email attachment —
   no Tailwind, no Recharts, no external assets. */
function svgGroupedBars(regions) {
  const rows = regions.filter((r) => r.actual != null);
  if (!rows.length) return '';
  const W = 720, H = 300, padL = 56, padR = 12, padT = 12, padB = 70;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const series = [['actual', SERIES.actual], ['plan', SERIES.plan], ['last_year', SERIES.last_year]];
  const max = Math.max(...rows.flatMap((r) => series.map(([k]) => r[k] || 0))) || 1;
  const groupW = plotW / rows.length, barW = Math.min(18, (groupW * 0.7) / 3);
  const y = (v) => padT + plotH - (v / max) * plotH;
  let g = '';
  // gridlines + y labels
  for (let i = 0; i <= 4; i++) {
    const val = (max / 4) * i, yy = y(val);
    g += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="#E7EAEC" stroke-width="1"/>`;
    g += `<text x="${padL - 6}" y="${yy + 3}" text-anchor="end" font-size="10" fill="#5A6F77">$${Math.round(val / 1e6)}M</text>`;
  }
  rows.forEach((r, i) => {
    const gx = padL + i * groupW + groupW / 2;
    series.forEach(([k, color], si) => {
      const v = r[k] || 0, bx = gx - barW * 1.5 + si * barW, by = y(v);
      g += `<rect x="${bx}" y="${by}" width="${barW - 2}" height="${padT + plotH - by}" fill="${color}" rx="2"/>`;
    });
    const label = esc(r.region).length > 12 ? esc(r.region).slice(0, 11) + '…' : esc(r.region);
    g += `<text x="${gx}" y="${H - padB + 14}" text-anchor="end" font-size="9" fill="#5A6F77" transform="rotate(-30 ${gx} ${H - padB + 14})">${label}</text>`;
  });
  const legend = series.map(([k, c], i) =>
    `<g transform="translate(${padL + i * 130},${H - 14})"><rect width="11" height="11" fill="${c}" rx="2"/><text x="16" y="10" font-size="11" fill="#0B2026">${{ actual: 'Net Sales', plan: 'Plan', last_year: 'Last Year' }[k]}</text></g>`
  ).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">${g}${legend}</svg>`;
}
function svgCategoryBars(cats) {
  if (!cats?.length) return '';
  const max = Math.max(...cats.map((c) => c.sales || 0)) || 1;
  const palette = [SERIES.actual, LAVA, SERIES.last_year, SERIES.plan, '#8AB4F8', '#A66BFF'];
  return cats.map((c, i) => `
    <div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <span style="font-weight:600">${esc(c.name)}</span><span style="color:#5A6F77">${money(c.sales)}</span>
      </div>
      <div style="height:10px;border-radius:6px;background:#EEF1F2;overflow:hidden">
        <div style="height:100%;border-radius:6px;width:${Math.round((c.sales / max) * 100)}%;background:${palette[i % 6]}"></div>
      </div>
    </div>`).join('');
}
function buildReportHTML(rep, opts = {}) {
  if (!rep) return '<!doctype html><title>Executive Summary</title><p>No data.</p>';
  const t = rep.totals || {};
  const toneColor = { good: '#00A972', warn: '#B26A00', action: '#FF3621' };
  const sectionsHTML = (rep.sections || []).map((s) => `
    <div style="flex:1;min-width:200px;border:1px solid #E3E7E9;border-left:3px solid ${toneColor[s.tone] || '#DCE0E2'};border-radius:10px;padding:14px;background:#FAFBFB">
      <div style="font-weight:700;font-size:13px;margin-bottom:8px;color:${toneColor[s.tone] || '#0B2026'}">${esc(s.title)}</div>
      <ul style="margin:0;padding-left:16px">${(s.points || []).map((p) => `<li style="font-size:12px;line-height:1.5;margin-bottom:5px;color:#0B2026">${esc(p)}</li>`).join('')}</ul>
    </div>`).join('');
  const narrativeHTML = (rep.narrative || [rep.headline]).map((p) => `<p style="font-size:15px;line-height:1.6;margin:0 0 12px">${esc(p)}</p>`).join('');
  const varCell = t.var_to_plan != null ? `${t.var_to_plan >= 0 ? '+' : ''}${money(t.var_to_plan)} (${pct(t.var_to_plan_pct, true)})` : '—';
  const varColor = (t.var_to_plan_pct ?? 0) >= 0 ? '#00A972' : '#98102A';
  const regionRowsHTML = (rep.regions || []).map((r) => `
    <tr><td style="padding:8px 12px;border-top:1px solid #E3E7E9;font-weight:500">${esc(r.region)}</td>
    <td style="padding:8px 12px;border-top:1px solid #E3E7E9;text-align:right;color:#5A6F77">${r.stores}</td>
    <td style="padding:8px 12px;border-top:1px solid #E3E7E9;text-align:right">${money(r.actual)}</td>
    <td style="padding:8px 12px;border-top:1px solid #E3E7E9;text-align:right;font-weight:600;color:${(r.var_to_plan_pct ?? 0) >= 0 ? '#00A972' : '#98102A'}">${r.var_to_plan_pct != null ? pct(r.var_to_plan_pct, true) : '—'}</td></tr>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(rep.report_name || 'Sales')} — Executive Summary</title>
<style>
  *{box-sizing:border-box} body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#0B2026;background:#F1F3F4}
  .page{max-width:840px;margin:0 auto;background:#fff;box-shadow:0 1px 8px rgba(0,0,0,.08)}
  .masthead{background:linear-gradient(135deg,#0B2026,#12303a);color:#fff;padding:34px 40px 26px}
  .eyebrow{font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:rgba(255,255,255,.6);font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:8px}
  .eyebrow i{display:inline-block;width:24px;height:2px;background:#FF3621}
  h1{font-size:34px;margin:0;letter-spacing:-.02em} .sub{color:rgba(255,255,255,.72);font-size:15px;margin-top:8px}
  .body{padding:26px 40px 40px}
  .tiles{display:flex;gap:12px;flex-wrap:wrap;margin-top:-6px}
  .tile{flex:1;min-width:130px;border:1px solid #E3E7E9;border-radius:10px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
  .tile .l{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#5A6F77;font-weight:600}
  .tile .v{font-size:20px;font-weight:700;margin-top:4px} .tile .f{font-size:11px;font-weight:600;margin-top:2px}
  h2{font-size:18px;border-bottom:2px solid #FF3621;padding-bottom:6px;margin:30px 0 14px}
  table{border-collapse:collapse;width:100%;font-size:14px;margin-top:4px}
  th{background:#F3F5F6;text-align:right;padding:8px 12px;font-size:12px;color:#5A6F77} th:first-child{text-align:left}
  .card{border:1px solid #E3E7E9;border-radius:12px;padding:16px;margin-top:4px}
  .cols{display:flex;gap:16px;flex-wrap:wrap;margin-top:16px}
  .foot{font-size:11px;color:#5A6F77;margin-top:28px;padding-top:14px;border-top:1px solid #E3E7E9}
  @media print{body{background:#fff}.page{box-shadow:none;max-width:none}}
</style></head>
<body><div class="page">
  <div class="masthead">
    <div class="eyebrow"><i></i>${esc(rep.report_name || 'Monday Morning Sales')}</div>
    <h1>${esc(rep.title || 'Executive Summary')}</h1>
    <div class="sub">${esc(rep.subtitle || '')}</div>
  </div>
  <div class="body">
    <div class="tiles">
      <div class="tile"><div class="l">Net Sales</div><div class="v">${money(t.actual)}</div>${t.var_to_plan_pct != null ? `<div class="f" style="color:${varColor}">${pct(t.var_to_plan_pct, true)} vs plan</div>` : ''}</div>
      <div class="tile"><div class="l">Units</div><div class="v">${intNum(t.units)}</div></div>
      <div class="tile"><div class="l">In-Stock</div><div class="v">${t.in_stock != null ? Math.round(t.in_stock) + '%' : '—'}</div></div>
      <div class="tile"><div class="l">E-com Mix</div><div class="v">${t.ecom_pct != null ? Math.round(t.ecom_pct) + '%' : '—'}</div></div>
    </div>

    <h2>Executive Brief</h2>
    ${narrativeHTML}
    <div class="cols">${sectionsHTML}</div>

    <h2>Company Totals</h2>
    <table>
      <thead><tr><th>Metric</th><th>Actual</th><th>Plan</th><th>Var to Plan</th><th>Last Year</th></tr></thead>
      <tbody>
        <tr><td style="padding:10px 12px;font-weight:500">Net Sales</td>
          <td style="padding:10px 12px;text-align:right">${money(t.actual)}</td>
          <td style="padding:10px 12px;text-align:right;color:#5A6F77">${t.plan != null ? money(t.plan) : '—'}</td>
          <td style="padding:10px 12px;text-align:right;font-weight:600;color:${varColor}">${varCell}</td>
          <td style="padding:10px 12px;text-align:right;color:#5A6F77">${t.last_year != null ? money(t.last_year) : '—'}</td></tr>
        <tr><td style="padding:10px 12px;border-top:1px solid #E3E7E9;font-weight:500">Units</td><td style="padding:10px 12px;border-top:1px solid #E3E7E9;text-align:right">${intNum(t.units)}</td><td colspan="3" style="padding:10px 12px;border-top:1px solid #E3E7E9;text-align:right;color:#5A6F77">—</td></tr>
        <tr><td style="padding:10px 12px;border-top:1px solid #E3E7E9;font-weight:500">Avg Unit Retail</td><td style="padding:10px 12px;border-top:1px solid #E3E7E9;text-align:right">${t.aur != null ? '$' + Math.round(t.aur) : '—'}</td><td colspan="3" style="padding:10px 12px;border-top:1px solid #E3E7E9;text-align:right;color:#5A6F77">—</td></tr>
      </tbody>
    </table>
    <p style="font-size:11px;color:#5A6F77;margin-top:6px">Plan basis: ${esc(rep.plan_basis || '')}. Figures reflect the current global filter.</p>

    ${(rep.regions || []).length ? `
    <h2>Regional Sales vs Plan &amp; Last Year</h2>
    <div class="card"><div style="font-weight:600;font-size:14px;margin-bottom:8px">Regional Sales Performance: Actual vs Plan vs Last Year</div>${svgGroupedBars(rep.regions)}</div>
    <table style="margin-top:16px">
      <thead><tr><th>Region</th><th>Stores</th><th>Net Sales</th><th>Var to Plan</th></tr></thead>
      <tbody>${regionRowsHTML}</tbody>
    </table>` : ''}

    ${(rep.categories || []).length ? `
    <h2>Top Categories</h2>
    <div class="card">${svgCategoryBars(rep.categories)}</div>` : ''}

    <div class="foot">Generated ${esc(new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))} from ${esc(rep.report_name || 'Monday Morning')} · data as of ${esc(rep.as_of || '')}.</div>
  </div>
</div></body></html>`;
}
