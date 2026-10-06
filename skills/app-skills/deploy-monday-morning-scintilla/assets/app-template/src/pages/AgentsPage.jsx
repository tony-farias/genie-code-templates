// Agents — showcase of how autonomous agents can automate manual review work on this data.
// Each agent card shows what it automates, which live tables it reads, and how many items
// are queued for review right now. Running an agent surfaces its findings with a recommended
// action per item and a human-in-the-loop approve / dismiss flow (manual revision).
import { useEffect, useState } from 'react';
import {
  Bot, Sparkles, Loader2, CheckCircle2, XCircle, ChevronRight, Database,
  PackageSearch, Truck, Globe, RotateCcw, LineChart, ShieldCheck, Clock,
} from 'lucide-react';
import AppHeader from '../components/AppHeader';
import { fetchJson } from '../lib/api';

const ICONS = {
  replenishment: PackageSearch, 'oos-diagnosis': PackageSearch, 'supplier-otif': Truck,
  'ecom-fix': Globe, returns: RotateCcw, 'forecast-exception': LineChart,
};
const SEV = {
  high: { label: 'High', color: '#FF3621', bg: 'rgba(255,54,33,0.08)' },
  medium: { label: 'Review', color: '#FBB300', bg: 'rgba(251,179,0,0.10)' },
};

export default function AgentsPage() {
  const [agents, setAgents] = useState(null);
  const [active, setActive] = useState(null); // agent id being run
  const [runState, setRunState] = useState({}); // id -> {loading, findings, agent}
  const [decisions, setDecisions] = useState({}); // `${id}:${idx}` -> 'approved'|'dismissed'

  useEffect(() => {
    fetchJson('/api/agents/roster').then((d) => setAgents(d.agents)).catch(() => setAgents([]));
  }, []);

  async function runAgent(a) {
    setActive(a.id);
    if (runState[a.id]?.findings) return; // cached
    setRunState((s) => ({ ...s, [a.id]: { loading: true } }));
    try {
      const d = await fetchJson(`/api/agents/run/${a.id}`);
      setRunState((s) => ({ ...s, [a.id]: { loading: false, findings: d.findings, agent: d.agent } }));
    } catch {
      setRunState((s) => ({ ...s, [a.id]: { loading: false, findings: [], error: true } }));
    }
  }

  const totalQueue = agents ? agents.reduce((t, a) => t + (a.queue || 0), 0) : 0;
  const cur = active ? runState[active] : null;
  const curAgent = agents?.find((a) => a.id === active);

  return (
    <div className="min-h-screen bg-background md:pl-56">
      <AppHeader />
      <div className="px-4 md:px-6 py-5 max-w-[1400px] mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Bot className="w-6 h-6 text-db-lava" /> Agents</h1>
          <p className="text-sm text-muted-foreground">Autonomous agents that watch the live data and do the first pass of manual review work. Each one surfaces what needs attention and drafts the action. A human approves or dismisses.</p>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Agents deployed" value={agents ? agents.length : '—'} icon={Bot} />
          <Stat label="Items queued for review" value={agents ? totalQueue.toLocaleString() : '—'} color="text-db-lava" icon={Clock} />
          <Stat label="Human-in-the-loop" value="100%" color="text-db-success" icon={ShieldCheck} sub="Every action needs approval" />
          <Stat label="Data source" value="Live" color="text-db-success" icon={Database} sub="Queried on each run" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* Roster */}
          <div className="lg:col-span-2 space-y-3">
            {!agents && <><Skel /><Skel /><Skel /></>}
            {agents?.map((a) => {
              const Icon = ICONS[a.id] || Bot;
              const isActive = active === a.id;
              return (
                <button key={a.id} onClick={() => runAgent(a)}
                  className={'w-full text-left rounded-xl border p-4 transition-all ' + (isActive ? 'border-db-lava shadow-md bg-card' : 'border-border bg-card hover:border-db-lava/50 hover:shadow-sm')}>
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg p-2 shrink-0" style={{ background: a.color + '18' }}>
                      <Icon className="w-5 h-5" style={{ color: a.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-foreground text-sm">{a.name}</span>
                        <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 shrink-0" style={{ background: a.color + '18', color: a.color }}>{(a.queue || 0).toLocaleString()} queued</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{a.tagline}</p>
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        {a.tables.map((t) => <span key={t} className="text-[10px] font-mono text-muted-foreground bg-accent/60 rounded px-1.5 py-0.5">{t}</span>)}
                      </div>
                      <div className="flex items-center gap-1 mt-2 text-[11px] font-medium" style={{ color: a.color }}>
                        {isActive && cur?.loading ? <><Loader2 className="w-3 h-3 animate-spin" /> Running…</> : <><Sparkles className="w-3 h-3" /> Run agent <ChevronRight className="w-3 h-3" /></>}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Run panel */}
          <div className="lg:col-span-3">
            <div className="rounded-xl border border-border bg-card shadow-sm min-h-[400px]">
              {!active && (
                <div className="h-[400px] flex flex-col items-center justify-center text-center px-8">
                  <Bot className="w-10 h-10 text-muted-foreground/40 mb-3" />
                  <p className="text-sm font-medium text-foreground">Select an agent to run it</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm">Each agent scans the live data and returns the items it thinks need review, with a recommended action you can approve or dismiss.</p>
                </div>
              )}
              {active && (
                <div>
                  <div className="flex items-center justify-between border-b border-border px-5 py-4">
                    <div>
                      <div className="font-semibold text-foreground flex items-center gap-2"><Sparkles className="w-4 h-4 text-db-lava" /> {curAgent?.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {cur?.loading ? 'Scanning live data…' : cur?.findings ? `${cur.findings.length} items flagged for review` : ''}
                      </div>
                    </div>
                    {cur?.findings && <ReviewProgress agentId={active} findings={cur.findings} decisions={decisions} />}
                  </div>

                  <div className="p-4 space-y-3 max-h-[560px] overflow-y-auto">
                    {cur?.loading && <><Skel h={72} /><Skel h={72} /><Skel h={72} /></>}
                    {!cur?.loading && cur?.findings?.length === 0 && (
                      <div className="text-sm text-muted-foreground text-center py-12">Nothing needs review right now. This agent is clear.</div>
                    )}
                    {!cur?.loading && cur?.findings?.map((f, i) => {
                      const key = `${active}:${i}`;
                      const dec = decisions[key];
                      const sev = SEV[f.severity] || SEV.medium;
                      return (
                        <div key={key} className={'rounded-lg border p-4 transition-all ' + (dec ? 'opacity-60 border-border' : 'border-border')} style={!dec ? { borderLeftColor: sev.color, borderLeftWidth: 3 } : {}}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm text-foreground">{f.entity}</span>
                                {!dec && <span className="text-[10px] font-semibold rounded px-1.5 py-0.5" style={{ background: sev.bg, color: sev.color }}>{sev.label}</span>}
                                {dec === 'approved' && <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 bg-db-success/10 text-db-success flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Approved</span>}
                                {dec === 'dismissed' && <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 bg-accent text-muted-foreground flex items-center gap-1"><XCircle className="w-3 h-3" /> Dismissed</span>}
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">{f.signal}</div>
                              <div className="flex items-start gap-1.5 mt-2 text-xs">
                                <Sparkles className="w-3.5 h-3.5 text-db-lava shrink-0 mt-0.5" />
                                <span className="text-foreground"><span className="text-muted-foreground">Recommended action:</span> {f.action}</span>
                              </div>
                              {f.confidence != null && (
                                <div className="flex items-center gap-2 mt-2">
                                  <div className="h-1 w-24 rounded-full bg-accent overflow-hidden"><div className="h-full rounded-full" style={{ width: `${f.confidence}%`, background: sev.color }} /></div>
                                  <span className="text-[10px] text-muted-foreground">{f.confidence}% confidence</span>
                                </div>
                              )}
                            </div>
                            {!dec && (
                              <div className="flex flex-col gap-1.5 shrink-0">
                                <button onClick={() => setDecisions((d) => ({ ...d, [key]: 'approved' }))} className="text-xs font-medium rounded-md px-3 py-1.5 bg-db-success text-white hover:opacity-90 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Approve</button>
                                <button onClick={() => setDecisions((d) => ({ ...d, [key]: 'dismissed' }))} className="text-xs font-medium rounded-md px-3 py-1.5 border border-border text-muted-foreground hover:bg-accent">Dismiss</button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewProgress({ agentId, findings, decisions }) {
  const done = findings.filter((_, i) => decisions[`${agentId}:${i}`]).length;
  const approved = findings.filter((_, i) => decisions[`${agentId}:${i}`] === 'approved').length;
  return (
    <div className="text-right">
      <div className="text-xs text-muted-foreground">{done}/{findings.length} reviewed</div>
      <div className="text-[11px] text-db-success font-medium">{approved} approved</div>
    </div>
  );
}

function Stat({ label, value, sub, color, icon: Icon }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        {Icon && <Icon className="w-4 h-4 text-muted-foreground/50" />}
      </div>
      <div className={'text-2xl font-bold tabular-nums mt-1 ' + (color || 'text-foreground')}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

const Skel = ({ h = 120 }) => <div className="animate-pulse bg-accent/60 rounded-xl" style={{ height: h }} />;
