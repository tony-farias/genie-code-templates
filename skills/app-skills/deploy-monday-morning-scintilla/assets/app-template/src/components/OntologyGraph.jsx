import { useEffect, useMemo, useRef, useState } from 'react';
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY,
} from 'd3-force';
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom';
import { Sparkles, Cpu, Search as SearchIcon, GitMerge, Calculator, Boxes } from 'lucide-react';

// Domain palette — muted, executive, works light + dark.
const GROUP_COLOR = {
  'Dimension':          '#4A6FA5',
  'Sales fact':         '#B3402E',
  'Inventory / Supply': '#C67B1E',
  'Demand':             '#7A5EA6',
  'Returns':            '#B84A78',
  'Supply chain':       '#2E8B6F',
  'E-commerce':         '#1E7A5E',
  'Ops metadata':       '#7A8290',
  'Other':              '#5B6472',
};

const KIND_BADGE = {
  raw:         'bg-db-info-tint text-db-info',
  aggregation: 'bg-db-warning-tint text-db-warning',
  computed:    'bg-db-accent-tint text-db-lava',
};

const W = 860, H = 540;

export default function OntologyGraph({ data }) {
  const { nodes = [], edges = [], calculations = [], queries = [], tabs = [], source } = data || {};
  const svgRef = useRef(null);
  const simRef = useRef(null);
  const simNodesRef = useRef([]);

  const [activeTab, setActiveTab] = useState('sales');
  const [sel, setSel] = useState(null);
  const [selEdge, setSelEdge] = useState(null);
  const [traceViz, setTraceViz] = useState(null);
  const [query, setQuery] = useState('');
  const [positions, setPositions] = useState({});
  const [transform, setTransform] = useState('');
  const [expandedModel, setExpandedModel] = useState(null);

  const tab = tabs.find((t) => t.id === activeTab) || tabs[0];
  const tabTableSet = useMemo(() => new Set(tab?.tables || []), [tab]);

  // Nodes/edges visible in the current tab, filtered further by search.
  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inTab = nodes.filter((n) => tabTableSet.has(n.id));
    const visible = inTab.filter((n) =>
      !q || n.id.toLowerCase().includes(q) ||
      (n.columns || []).some((c) => (c.name || c).toLowerCase().includes(q)));
    const ids = new Set(visible.map((n) => n.id));
    const vEdges = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
    return { nodes: visible, edges: vEdges };
  }, [nodes, edges, tabTableSet, query]);

  const tabCalcs = useMemo(
    () => calculations.filter((c) => (tab?.calculations || []).includes(c.name)),
    [calculations, tab]);
  // Map a query's page label to a tab id so each tab lists only its own viz.
  const PAGE_TO_TAB = { Sales: 'sales', Forecast: 'forecast', Inventory: 'inventory', Hourly: 'hourly', Category: 'category', 'E-commerce': 'ecom', Agents: 'agents' };
  const tabQueries = useMemo(
    () => queries.filter((qr) => PAGE_TO_TAB[qr.page] === activeTab),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queries, activeTab]);

  const traceTables = useMemo(() => {
    if (!traceViz) return null;
    const qr = queries.find((x) => x.viz === traceViz);
    return qr ? new Set(qr.tables) : null;
  }, [traceViz, queries]);

  const nodeRadius = (n) => {
    const rc = n.rowCount;
    if (!rc) return 24;
    return Math.max(20, Math.min(46, 14 + Math.log10(rc) * 4.6));
  };

  // d3-force computes positions into React state (React owns all rendering).
  useEffect(() => {
    if (!view.nodes.length) { setPositions({}); return; }
    const simNodes = view.nodes.map((n, i) => ({
      id: n.id,
      x: W / 2 + Math.cos((i / view.nodes.length) * 6.283) * 200,
      y: H / 2 + Math.sin((i / view.nodes.length) * 6.283) * 150,
    }));
    const byId = Object.fromEntries(simNodes.map((n) => [n.id, n]));
    const simLinks = view.edges
      .filter((e) => byId[e.from] && byId[e.to])
      .map((e) => ({ source: e.from, target: e.to }));
    simNodesRef.current = simNodes;

    const sim = forceSimulation(simNodes)
      .force('link', forceLink(simLinks).id((d) => d.id).distance(170).strength(0.25))
      .force('charge', forceManyBody().strength(-900))
      .force('center', forceCenter(W / 2, H / 2))
      .force('x', forceX(W / 2).strength(0.05))
      .force('y', forceY(H / 2).strength(0.07))
      .force('collide', forceCollide().radius(52));
    simRef.current = sim;
    sim.on('tick', () => {
      const p = {};
      for (const n of simNodes) p[n.id] = { x: n.x, y: n.y };
      setPositions(p);
    });

    if (svgRef.current) {
      const svg = select(svgRef.current);
      const zb = d3zoom().scaleExtent([0.4, 3]).on('zoom', (ev) => setTransform(ev.transform.toString()));
      svg.call(zb);
      svg.on('dblclick.zoom', null);
    }
    return () => sim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, view.nodes.map((n) => n.id).join(','), view.edges.length]);

  const startDrag = (id) => (e) => {
    e.preventDefault();
    const svg = svgRef.current;
    const node = simNodesRef.current.find((n) => n.id === id);
    if (!node || !svg) return;
    const pt = svg.createSVGPoint();
    const move = (ev) => {
      pt.x = ev.clientX; pt.y = ev.clientY;
      const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
      node.fx = loc.x; node.fy = loc.y;
      simRef.current?.alphaTarget(0.3).restart();
    };
    const up = () => {
      node.fx = null; node.fy = null;
      simRef.current?.alphaTarget(0);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const changeTab = (id) => {
    setActiveTab(id); setSel(null); setSelEdge(null); setTraceViz(null); setQuery(''); setTransform('');
    if (svgRef.current) select(svgRef.current).call(d3zoom().transform, zoomIdentity);
  };

  const selNode = view.nodes.find((n) => n.id === sel);
  const selEdgeObj = selEdge != null ? view.edges[selEdge] : null;

  const isDimmed = (id) => {
    if (traceTables) return !traceTables.has(id);
    if (sel) return !(id === sel || view.edges.some((e) =>
      (e.from === sel && e.to === id) || (e.to === sel && e.from === id)));
    return false;
  };

  const kindIcon = (kind) => kind === 'Vector Search' ? SearchIcon
    : kind === 'Genie space' ? Sparkles : Cpu;

  return (
    <div>
      {/* ── Tab rail ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-border mb-4 overflow-x-auto pb-px">
        {tabs.map((t) => {
          const on = t.id === activeTab;
          return (
            <button key={t.id} onClick={() => changeTab(t.id)}
              className={`px-3.5 py-2 text-sm whitespace-nowrap rounded-t-lg border-b-2 transition-colors ${
                on ? 'font-semibold text-foreground' : 'text-muted-foreground border-transparent hover:text-foreground'}`}
              style={on ? { borderColor: t.accent, color: t.accent } : {}}>
              {t.label}
            </button>
          );
        })}
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ml-auto shrink-0 ${
          source === 'live' ? 'bg-db-success-tint text-db-success' : 'bg-db-info-tint text-db-info'}`}>
          {source === 'live' ? '● Live from Unity Catalog' : '○ Reference model'}
        </span>
      </div>

      {tab && (
        <>
          {/* ── Executive hero for the tab ─────────────────────────── */}
          <div className="rounded-xl border border-border p-4 mb-4"
               style={{ background: `linear-gradient(90deg, ${tab.accent}0F, transparent)` }}>
            <div className="flex items-start gap-3">
              <div className="w-1 self-stretch rounded-full shrink-0" style={{ background: tab.accent }} />
              <div className="flex-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{tab.label} · what powers this tab</p>
                <p className="text-base font-semibold text-foreground mt-0.5">{tab.question}</p>
                <div className="flex flex-wrap gap-4 mt-3 text-xs">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Boxes className="w-3.5 h-3.5" style={{ color: tab.accent }} /> {tab.tables.length} tables</span>
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground"><GitMerge className="w-3.5 h-3.5" style={{ color: tab.accent }} /> {view.edges.length} joins</span>
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Calculator className="w-3.5 h-3.5" style={{ color: tab.accent }} /> {tabCalcs.length} calculations</span>
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Sparkles className="w-3.5 h-3.5" style={{ color: tab.accent }} /> {tab.aiModels?.length || 0} AI models</span>
                </div>
              </div>
            </div>

            {/* AI model chips */}
            {tab.aiModels?.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 mt-4">
                {tab.aiModels.map((m) => {
                  const Icon = kindIcon(m.kind);
                  const open = expandedModel === m.key;
                  return (
                    <div key={m.key} className="rounded-lg border border-border bg-card p-2.5">
                      <div className="flex items-center gap-1.5">
                        <Icon className="w-3.5 h-3.5 text-db-lava shrink-0" />
                        <span className="text-xs font-semibold text-foreground">{m.label}</span>
                      </div>
                      <code className="font-mono text-[10px] text-db-info block mt-1">{m.model}</code>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{m.kind} · {m.desc}</p>
                      {(m.input || m.replicate) && (
                        <button onClick={() => setExpandedModel(open ? null : m.key)}
                          className="text-[10px] font-semibold text-db-lava mt-1.5 hover:underline">
                          {open ? '− Hide how to replicate' : '+ How to replicate this'}
                        </button>
                      )}
                      {open && (
                        <div className="mt-2 pt-2 border-t border-border space-y-1.5">
                          {m.input && <p className="text-[10px] text-muted-foreground"><span className="font-semibold text-foreground">Input:</span> {m.input}</p>}
                          {m.output && <p className="text-[10px] text-muted-foreground"><span className="font-semibold text-foreground">Output:</span> {m.output}</p>}
                          {m.where && <p className="text-[10px] text-muted-foreground"><span className="font-semibold text-foreground">Called at:</span> <code className="font-mono">{m.where}</code></p>}
                          {m.replicate && (
                            <ol className="text-[10px] text-muted-foreground list-decimal ml-3.5 space-y-0.5 mt-1">
                              {m.replicate.map((s, i) => <li key={i}>{s}</li>)}
                            </ol>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Graph + detail ─────────────────────────────────────── */}
          <div className="flex items-center gap-2 mb-2">
            <div className="relative">
              <SearchIcon className="w-3.5 h-3.5 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
              <input value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tables or columns…"
                className="text-xs pl-7 pr-2.5 py-1.5 rounded-md border border-border bg-background text-foreground w-56 focus:outline-none focus:ring-1 focus:ring-db-lava" />
            </div>
            {traceViz && (
              <button onClick={() => setTraceViz(null)} className="text-[11px] px-2 py-1 rounded-md bg-db-accent-tint text-db-lava">
                Tracing: {traceViz} · clear
              </button>
            )}
            <span className="text-[11px] text-muted-foreground ml-auto">Drag bubbles · scroll to zoom · click a node or join</span>
          </div>

          <div className="flex flex-col lg:flex-row gap-4">
            <div className="lg:w-[62%]">
              <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
                   className="w-full h-auto rounded-xl border border-border bg-background touch-none"
                   role="img" aria-label={`Knowledge graph for the ${tab.label} tab`}>
                <g transform={transform}>
                  {view.edges.map((e, i) => {
                    const a = positions[e.from], b = positions[e.to];
                    if (!a || !b) return null;
                    const active = selEdge === i || (sel && (e.from === sel || e.to === sel));
                    const faded = (sel || selEdge != null || traceTables) && !active;
                    return (
                      <g key={i}>
                        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                          stroke={active ? tab.accent : '#9AA3AF'}
                          strokeWidth={active ? 3 : 1.5}
                          strokeOpacity={faded ? 0.1 : 0.5}
                          style={{ cursor: 'pointer' }}
                          onClick={() => { setSelEdge(i); setSel(null); setTraceViz(null); }} />
                        {active && (
                          <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} fontSize="10" fontWeight="600"
                                fill={tab.accent} textAnchor="middle" style={{ pointerEvents: 'none' }}>{e.key}</text>
                        )}
                      </g>
                    );
                  })}
                  {view.nodes.map((n) => {
                    const p = positions[n.id];
                    if (!p) return null;
                    const r = nodeRadius(n);
                    const active = sel === n.id;
                    return (
                      <g key={n.id} transform={`translate(${p.x},${p.y})`}
                         style={{ cursor: 'grab', opacity: isDimmed(n.id) ? 0.18 : 1, transition: 'opacity .2s' }}
                         onPointerDown={startDrag(n.id)}
                         onClick={() => { setSel(active ? null : n.id); setSelEdge(null); setTraceViz(null); }}>
                        <circle r={r + 3} fill={GROUP_COLOR[n.group] || GROUP_COLOR.Other} opacity={0.14} />
                        <circle r={r} fill={GROUP_COLOR[n.group] || GROUP_COLOR.Other}
                                stroke={active ? '#fff' : 'rgba(255,255,255,.7)'} strokeWidth={active ? 3 : 1.5} />
                        {n.rowCount != null ? (
                          <>
                            <text y="-1" fontSize="11" fontWeight="700" textAnchor="middle" fill="#fff"
                                  style={{ pointerEvents: 'none' }}>{fmtRows(n.rowCount)}</text>
                            <text y="10" fontSize="8" textAnchor="middle" fill="rgba(255,255,255,.85)"
                                  style={{ pointerEvents: 'none' }}>rows</text>
                          </>
                        ) : (
                          <text y="4" fontSize="8.5" fontWeight="600" textAnchor="middle" fill="rgba(255,255,255,.9)"
                                style={{ pointerEvents: 'none' }}>{n.group.split(' ')[0]}</text>
                        )}
                        <text y={r + 14} fontSize="11" fontWeight="600" textAnchor="middle"
                              className="fill-foreground" style={{ pointerEvents: 'none' }}>{n.id}</text>
                      </g>
                    );
                  })}
                </g>
              </svg>
            </div>

            {/* detail panel */}
            <div className="lg:w-[38%]">
              {selEdgeObj ? (
                <div className="rounded-xl border-2 p-4 space-y-2" style={{ borderColor: tab.accent }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: tab.accent }}>Join</p>
                  <p className="text-sm font-mono font-semibold text-foreground">{selEdgeObj.from} ⋈ {selEdgeObj.to}</p>
                  <code className="font-mono text-[11px] block p-2 rounded-lg bg-background border border-border text-foreground">{selEdgeObj.on}</code>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] pt-1">
                    <span><span className="text-muted-foreground">Type</span> <code className="font-mono">{selEdgeObj.type}</code></span>
                    <span><span className="text-muted-foreground">Key</span> <code className="font-mono text-db-info">{selEdgeObj.key}</code></span>
                    <span><span className="text-muted-foreground">Cardinality</span> {selEdgeObj.card}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground italic pt-1">{selEdgeObj.note}</p>
                </div>
              ) : selNode ? (
                <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ background: GROUP_COLOR[selNode.group] }} />
                    <code className="font-mono text-sm font-bold text-foreground">{selNode.id}</code>
                  </div>
                  <p className="text-[11px] text-muted-foreground -mt-1">
                    {selNode.group}
                    {selNode.rowCount != null ? ` · ${selNode.rowCount.toLocaleString()} rows` : ''}
                    {selNode.columnCount ? ` · ${selNode.columnCount} columns` : ''}
                  </p>
                  {selNode.calculations?.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Feeds calculations</p>
                      <div className="flex flex-wrap gap-1">
                        {selNode.calculations.map((c) => (
                          <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-db-warning-tint text-db-warning">{c}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {selNode.poweredViz?.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Powers visualizations</p>
                      <ul className="space-y-0.5">
                        {selNode.poweredViz.map((v) => (
                          <li key={v}><button onClick={() => setTraceViz(v)} className="text-xs text-db-lava hover:underline text-left">→ {v}</button></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {selNode.columns?.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Columns ({selNode.columns.length}{selNode.columnCount > selNode.columns.length ? ` of ${selNode.columnCount}` : ''})</p>
                      <div className="max-h-48 overflow-y-auto pr-1 space-y-px">
                        {selNode.columns.map((c) => (
                          <div key={c.name || c} className="flex items-baseline justify-between text-[11px] gap-2 py-px">
                            <code className="font-mono text-foreground">{c.name || c}</code>
                            {c.type && <span className="text-muted-foreground shrink-0 text-[10px]">{c.type}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Calculations for the tab, shown by default */}
                  {tabCalcs.length > 0 && (
                    <div className="rounded-xl border border-border bg-card p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Metrics · {tab.label} <span className="normal-case font-normal">(raw field vs computed)</span></p>
                      <div className="space-y-2.5">
                        {tabCalcs.map((c) => (
                          <div key={c.name}>
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${KIND_BADGE[c.kind] || 'bg-db-neutral-200 text-muted-foreground'}`}>{c.kind || 'metric'}</span>
                              <p className="text-xs font-semibold text-foreground">{c.name}</p>
                            </div>
                            <code className="font-mono text-[10px] block mt-1 p-1.5 rounded bg-background border border-border text-db-info whitespace-pre-wrap">{c.formula}</code>
                            {c.note && <p className="text-[10px] text-muted-foreground mt-0.5">{c.note}</p>}
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-3 pt-2 border-t border-border">
                        <span className="font-semibold">raw</span> = stored column read directly ·
                        <span className="font-semibold"> aggregation</span> = SUM/AVG of one column ·
                        <span className="font-semibold"> computed</span> = ratio or multi-column formula
                      </p>
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground text-center px-2">Click a bubble for its columns and types. Click a join line for the real ON condition. {tabCalcs.length === 0 && 'This tab reads raw fields only — no derived metrics.'}</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Query → Viz for this tab ────────────────────────────── */}
          {tabQueries.length > 0 && (
            <div className="mt-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Visualizations on the {tab.label} tab and the tables behind them</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {tabQueries.map((qr) => (
                  <button key={qr.endpoint} onClick={() => setTraceViz(qr.viz)}
                    className={`text-left rounded-lg border p-2.5 transition-colors ${traceViz === qr.viz ? 'border-db-lava bg-db-accent-tint' : 'border-border bg-card hover:border-db-lava/40'}`}>
                    <p className="text-xs font-semibold text-foreground">{qr.viz}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {qr.tables.map((t) => (
                        <code key={t} className="font-mono text-[9px] px-1 py-0.5 rounded bg-background border border-border text-muted-foreground">{t}</code>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function fmtRows(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}
