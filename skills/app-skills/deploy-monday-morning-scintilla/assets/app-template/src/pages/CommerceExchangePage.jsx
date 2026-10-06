import { Link } from 'react-router-dom';
import { ShoppingCart, Sparkles, ArrowRight } from 'lucide-react';
import AppHeader from '../components/AppHeader';

function Card({ title, action, children, className = '' }) {
  return (
    <div className={`bg-card rounded-xl border border-border p-5 shadow-sm ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between mb-3">
          {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

// --- tiny inline visuals (no external chart dep, render offline) ---
function Meter({ pct, tone = 'lava' }) {
  const c = tone === 'success' ? 'bg-db-success' : tone === 'info' ? 'bg-db-info' : 'bg-db-lava';
  return (
    <div className="h-2 rounded-full bg-accent overflow-hidden">
      <div className={`h-full rounded-full ${c}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
function Spark({ pts, tone = 'lava' }) {
  const w = 130, h = 30, max = Math.max(...pts), min = Math.min(...pts);
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i / (pts.length - 1)) * w},${h - ((p - min) / ((max - min) || 1)) * (h - 4) - 2}`).join(' ');
  const stroke = tone === 'success' ? '#2DBE60' : tone === 'info' ? '#0B7CB0' : '#FF3621';
  return <svg width={w} height={h}><path d={d} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" /></svg>;
}
function Split({ a, b, aLabel, bLabel }) {
  return (
    <div className="w-full">
      <div className="flex h-2.5 rounded-full overflow-hidden bg-accent">
        <div className="bg-db-success h-full" style={{ width: `${a}%` }} />
        <div className="h-full" style={{ width: `${b}%`, background: 'rgba(120,130,138,.45)' }} />
      </div>
      <div className="flex justify-between text-[10px] mt-1">
        <span className="text-db-success font-semibold">{aLabel} {a}%</span>
        <span className="text-muted-foreground">{bLabel} {b}%</span>
      </div>
    </div>
  );
}

const STATUS = {
  live: { label: 'Live in Monday Morning', cls: 'text-db-success border-db-success/50 bg-db-success/10' },
  enhanced: { label: 'Enhanced by the exchange', cls: 'text-db-info border-db-info/50 bg-db-info/10' },
  new: { label: 'New via the exchange', cls: 'text-db-lava border-db-lava/50 bg-db-lava/10' },
};
const WHO = {
  Retailer: 'text-db-lava border-db-lava/40',
  Shared: 'text-db-info border-db-info/40',
  Brand: 'text-db-success border-db-success/40',
  'Retailer + AI': 'text-db-lava border-db-lava/40',
};
const TIER = { ML: 'text-db-info bg-db-info/15', GenAI: 'text-db-lava bg-db-lava/15', Agent: 'text-db-success bg-db-success/15' };

// Governed scorecard — the operating metrics across the loop. src: 'sci' computes live
// from Scintilla Cloud Feeds on deploy; 'syn' is synthetic (fetched via the exchange in
// production). Values here are representative so the page reads as it will live.
const SCORE = [
  { v: '98%', l: 'Digital in-stock', src: 'sci' },
  { v: '96%', l: 'Content compliance', src: 'sci' },
  { v: '91%', l: 'Transactable items', src: 'sci' },
  { v: '+8 pts', l: 'Share of search', src: 'syn' },
  { v: '3.4x', l: 'Incremental ROAS', src: 'syn' },
  { v: '$1.2M', l: 'GMV at risk', src: 'sci' },
];

// Six-stage loop → capability + data + operating question. Grounded in UC-CGD-2829.
const STAGES = [
  {
    n: '01', name: 'Sense demand', who: 'Retailer', status: 'enhanced', tiers: ['ML'],
    help: 'See true demand — what shoppers search, review and basket alongside your items — instead of planning off shipments.',
    acquired: ['omni_sales', 'ecommerce_metrics'], fetch: ['search terms', 'basket composition', 'cross-brand co-purchase'],
    q: 'What is actually selling and searched, not just shipped?', cadence: 'Daily',
    action: 'Reprioritise the categories that matter this week', human: 'You set the thresholds that trigger action',
    tab: { label: 'Category', path: '/app/category' },
    read: { value: '38%', label: 'search-led demand', src: 'syn', viz: { type: 'meter', pct: 38, tone: 'lava' } },
  },
  {
    n: '02', name: 'Assort & list', who: 'Shared', status: 'live', tiers: ['ML', 'Agent'],
    help: 'Item setup and attribute quality, with an agent mapping attributes and flagging schema conflicts before they surface downstream.',
    acquired: ['prod_dim', 'transactability', 'transactable_pct'], fetch: ['retailer item taxonomy match'],
    q: 'Which items are not transactable, and why?', cadence: 'Weekly',
    action: 'Clear the listing blockers that stop items publishing', human: 'You own assortment strategy',
    tab: { label: 'E-com', path: '/app/ecom' },
    read: { value: '91%', label: 'transactable', sub: '4,120 items · 372 blocked', src: 'sci', viz: { type: 'meter', pct: 91, tone: 'success' } },
  },
  {
    n: '03', name: 'Build content', who: 'Brand', status: 'enhanced', tiers: ['GenAI', 'Agent'],
    help: 'Score product-page content and generate / localise copy grounded in brand and compliance rules — volume moves to the machine, approval stays human.',
    acquired: ['ecom_prod_cntnt_score'], fetch: ['retailer PDP compliance state'],
    q: 'Which items have content gaps hurting conversion?', cadence: 'Weekly',
    action: 'Refresh the failing product content', human: 'You approve claims and brand voice',
    tab: { label: 'E-com', path: '/app/ecom' },
    read: { value: '96%', label: 'content compliance', sub: '214 below threshold', src: 'sci', viz: { type: 'meter', pct: 96, tone: 'success' } },
  },
  {
    n: '04', name: 'Win discovery', who: 'Retailer + AI', status: 'new', tiers: ['ML', 'GenAI', 'Agent'],
    help: 'Share of search, retail-media placement and AI-assistant answer visibility — the one stage all three tiers touch.',
    acquired: [], fetch: ['share of search', 'sponsored placement', 'AI-answer share (Sparky)'],
    q: 'Are we gaining or losing share of search and AI answers?', cadence: 'Weekly',
    action: 'Reallocate content, keywords and media', human: 'You set spend ceilings and define what counts as incremental',
    tab: null,
    read: { value: '31% → 39%', label: 'share of search, 13 wk', src: 'syn', viz: { type: 'spark', pts: [31, 30, 32, 34, 33, 36, 35, 38, 39], tone: 'lava' } },
  },
  {
    n: '05', name: 'Convert & fulfil', who: 'Shared', status: 'live', tiers: ['ML', 'Agent'],
    help: 'Predict the out-of-stock and trigger replenishment before it converts a loyal shopper to a competitor brand.',
    acquired: ['ecom_instock_pct', 'ecom_invt', 'fulfillment', 'oos_root_cause'], fetch: ['retailer delivery-promise state'],
    q: 'Where is availability dropping, and what is it costing?', cadence: 'Daily',
    action: 'Trigger replenishment or suppress the listing', human: 'You adjudicate trade-offs when supply is constrained',
    tab: { label: 'Inventory', path: '/app/inventory' },
    read: { value: '98%', label: 'digital in-stock', sub: '17 items · $1.2M at risk', src: 'sci', viz: { type: 'meter', pct: 98, tone: 'success' } },
  },
  {
    n: '06', name: 'Settle & measure', who: 'Retailer', status: 'enhanced', tiers: ['ML', 'GenAI'],
    help: 'Closed-loop, basket-based incrementality reconciled to one governed number, so the JBP is argued on the retailer’s own data.',
    acquired: ['omni_sales', 'ecom_returns', 'ecom_pct'], fetch: ['basket incrementality', 'deduction detail'],
    q: 'Is retail-media spend incremental, or cannibalising?', cadence: 'Monthly',
    action: 'Shift from reach tactics to incrementality-driving tactics', human: 'You negotiate the JBP on an agreed number',
    tab: { label: 'Sales', path: '/app/sales' },
    read: { value: '62%', label: 'media incremental', src: 'syn', viz: { type: 'split', a: 62, b: 38, aLabel: 'Incremental', bLabel: 'Base' } },
  },
];

const LAYERS = [
  { l: 'Activation', s: 'decide & act', tags: ['Dashboards', 'Genie NL query', 'Agents · recommend & confirm', 'Analytics sub-app'] },
  { l: 'Ontology & Semantics', s: 'one definition', tags: ['share · incrementality · ROAS · availability', 'product ontology · GTIN ↔ item'], hi: true },
  { l: 'Identity', s: 'entity resolution', tags: ['GTIN ↔ wm_item_nbr / catlg_item_id', 'customer & store match'] },
  { l: 'Exchange', s: 'no copies', tags: ['Delta Sharing · open protocol', 'clean rooms', 'row / column governance'] },
  { l: 'Foundation', s: 'one lakehouse', tags: ['Scintilla Cloud Feeds', 'shipment · brand · media · supply', 'retailer share'] },
];

function Chip({ children, className }) {
  return <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${className}`}>{children}</span>;
}
function Viz({ v }) {
  if (v.type === 'meter') return <Meter pct={v.pct} tone={v.tone} />;
  if (v.type === 'spark') return <Spark pts={v.pts} tone={v.tone} />;
  if (v.type === 'split') return <Split a={v.a} b={v.b} aLabel={v.aLabel} bLabel={v.bLabel} />;
  return null;
}

export default function CommerceExchangePage() {
  return (
    <div className="min-h-screen bg-background md:pl-56">
      <AppHeader />
      <div className="px-4 md:px-6 py-5 max-w-[1400px] mx-auto space-y-5">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ShoppingCart className="w-6 h-6 text-db-lava" /> Commerce Exchange
          </h1>
          <p className="text-sm text-muted-foreground">
            How we help at every step of the e-commerce loop. Each stage is a working capability on the Scintilla Cloud Feeds foundation, extended by the governed retailer demand-signal exchange (UC-CGD-2829).
          </p>
        </div>

        {/* Governed scorecard */}
        <Card title="Governed scorecard · this week">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {SCORE.map((k, i) => (
              <div key={i} className="rounded-lg border border-border bg-accent/30 p-3">
                <div className="flex items-center justify-between">
                  <span className={`text-2xl font-bold tabular-nums ${k.src === 'sci' ? 'text-db-success' : 'text-db-lava'}`}>{k.v}</span>
                  <span className={`w-2 h-2 rounded-full ${k.src === 'sci' ? 'bg-db-success' : 'bg-db-lava'}`} title={k.src === 'sci' ? 'Live from Scintilla' : 'Synthetic / fetched'} />
                </div>
                <div className="text-[11px] text-muted-foreground mt-1 leading-tight">{k.l}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-db-success" /> Live from Scintilla Cloud Feeds</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-db-lava" /> Synthetic — fetched via the exchange in production</span>
          </div>
        </Card>

        {/* Per-stage capability cards */}
        <div className="space-y-3">
          {STAGES.map((s) => (
            <div key={s.n} id={`stage-${s.n}`} className="bg-card rounded-xl border border-border shadow-sm p-5 scroll-mt-4">
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr),minmax(0,1fr),minmax(0,1fr)] gap-5">
                {/* left: identity + how we help */}
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-lg font-mono text-db-lava font-bold">{s.n}</span>
                    <span className="text-base font-bold text-foreground">{s.name}</span>
                    <Chip className={WHO[s.who]}>{s.who}</Chip>
                    <Chip className={STATUS[s.status].cls}>{STATUS[s.status].label}</Chip>
                  </div>
                  <p className="text-sm text-foreground/90 mt-2 leading-relaxed">{s.help}</p>
                  <div className="flex items-center gap-1.5 mt-2.5">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">How it runs</span>
                    {s.tiers.map((t) => (
                      <span key={t} className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${TIER[t]}`}>{t}</span>
                    ))}
                  </div>
                </div>

                {/* middle: data acquired vs fetched */}
                <div className="lg:border-l lg:border-border lg:pl-5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Data it runs on</div>
                  {s.acquired.length > 0 && (
                    <div className="mb-2">
                      <div className="text-[11px] font-semibold text-db-success mb-1">Acquired · Scintilla</div>
                      <div className="flex flex-wrap gap-1">
                        {s.acquired.map((t) => (
                          <span key={t} className="text-[10px] font-mono text-db-success bg-db-success/10 border border-db-success/30 rounded px-1.5 py-0.5">{t}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <div className="text-[11px] font-semibold text-db-lava mb-1">Fetch · retailer exchange</div>
                    <div className="flex flex-wrap gap-1">
                      {s.fetch.map((t) => (
                        <span key={t} className="text-[10px] text-db-lava bg-db-lava/10 border border-db-lava/30 rounded px-1.5 py-0.5">{t}</span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* right: operating question + action + link */}
                <div className="lg:border-l lg:border-border lg:pl-5 flex flex-col">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Ask Genie</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-db-lava bg-db-lava/10 border border-db-lava/30 rounded px-1.5 py-0.5">{s.cadence}</span>
                  </div>
                  <p className="text-sm font-semibold text-foreground leading-snug">“{s.q}”</p>
                  <div className="flex items-start gap-1.5 mt-2 text-xs text-muted-foreground">
                    <ArrowRight className="w-3.5 h-3.5 text-db-lava shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{s.action}</span>
                  </div>
                  <div className="mt-auto pt-3 flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground italic">{s.human}</span>
                    {s.tab ? (
                      <Link to={s.tab.path} className="text-[11px] font-semibold text-db-lava hover:underline whitespace-nowrap">Open {s.tab.label} →</Link>
                    ) : (
                      <span className="text-[11px] font-semibold text-db-lava whitespace-nowrap">New here</span>
                    )}
                  </div>
                </div>
              </div>

              {/* reading now — populated data */}
              <div className="mt-4 pt-3 border-t border-border flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Reading now</span>
                  <span className={`w-1.5 h-1.5 rounded-full ${s.read.src === 'sci' ? 'bg-db-success' : 'bg-db-lava'}`} />
                  <span className="text-lg font-bold text-foreground tabular-nums">{s.read.value}</span>
                  <span className="text-xs text-muted-foreground">{s.read.label}</span>
                </div>
                <div className="flex-1 min-w-[120px] max-w-[300px]"><Viz v={s.read.viz} /></div>
                {s.read.sub && <span className="text-[11px] text-muted-foreground shrink-0">{s.read.sub}</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Live example: Genie over the governed share */}
        <Card title="Live example · Genie over the governed share">
          <div className="space-y-2">
            <div className="ml-auto max-w-[80%] rounded-lg bg-db-lava text-white text-xs font-medium px-3 py-2">
              Where is availability dropping on Walmart.com in Snacks this week, and what is it costing?
            </div>
            <div className="rounded-lg border border-border bg-accent/40 px-3 py-2 max-w-[85%]">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-db-lava mb-1">
                <Sparkles className="w-3 h-3" /> Genie · stage 05
              </div>
              <p className="text-xs text-foreground leading-relaxed">
                17 items slipped below 95% in-stock, about $1.2M weekly GMV at risk, driven by two fulfillment centers. Draft replenishment is ready for your approval.
              </p>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">Autonomy ceiling: recommend-and-confirm. The system proposes; a human approves.</p>
        </Card>

        {/* Reference architecture */}
        <Card title="Reference architecture · governed exchange to agent">
          <div className="space-y-2">
            {LAYERS.map((row, i) => (
              <div key={i} className={`flex flex-col md:flex-row md:items-center gap-2 md:gap-4 rounded-lg border p-3 ${row.hi ? 'border-db-lava bg-db-lava/10' : 'border-border bg-accent/30'}`}>
                <div className="md:w-48 shrink-0">
                  <div className={`text-sm font-bold ${row.hi ? 'text-db-lava' : 'text-foreground'}`}>{row.l}</div>
                  <div className="text-[11px] text-muted-foreground">{row.s}</div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {row.tags.map((t, j) => (
                    <span key={j} className="text-[11px] font-medium text-muted-foreground bg-card border border-border rounded px-2 py-0.5">{t}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            Unity Catalog governs every layer: lineage, access and audit from raw share to agent action. An open-protocol share survives either side changing clouds.
          </p>
        </Card>
      </div>
    </div>
  );
}
