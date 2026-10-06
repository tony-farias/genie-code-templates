// Personalized Home — greets the user, shows persona-scoped insights and
// recommended actions. Persona = vendor.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import { usePersona } from '../lib/persona.jsx';
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Sparkles, ArrowRight,
  ChevronLeft, ChevronRight } from 'lucide-react';

const ICON = { up: TrendingUp, down: TrendingDown, warn: AlertTriangle, watch: AlertTriangle, ok: CheckCircle };

export default function HomePage() {
  const { personas, active, activeId, setActiveId } = usePersona();
  const [name, setName] = useState('there');
  const [insights, setInsights] = useState(null);

  useEffect(() => {
    fetch('/api/whoami').then((r) => r.json()).then((d) => {
      const email = (d.user || '').toString();
      const first = email.split('@')[0].split(/[._]/)[0];
      setName(first ? first.charAt(0).toUpperCase() + first.slice(1) : 'there');
    }).catch(() => {});
  }, []);

  const chosen = activeId && activeId !== 'super' ? active : null;

  const [brief, setBrief] = useState(null);

  useEffect(() => {
    if (!chosen) { setInsights(null); setBrief(null); return; }
    const vendor = chosen.vendor_nbr ?? 'all';
    setInsights(null); setBrief(null);
    fetch(`/api/home/insights?vendor=${vendor}`).then((r) => r.json()).then((d) => d.insights || []).catch(() => []).then((ins) => {
      setInsights(ins);
      // Narrated storytelling brief, fed the real numbers.
      fetch('/api/home/brief', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: chosen.person || name, vendor: chosen.vendor_nm, categories: chosen.categories, insights: ins }),
      }).then((r) => r.json()).then((d) => setBrief(d.brief || '')).catch(() => setBrief(''));
    });
  }, [chosen, name]);

  const urgent = (insights || []).filter((it) => it.kind === 'warn' || it.kind === 'watch');
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  // Stat tiles: the insights as headline numbers (first 4).
  const statTiles = (insights || []).slice(0, 4);

  return (
    <div className="min-h-screen bg-background md:pl-56">
      <AppHeader />
      <div className="px-4 md:px-6 py-8 max-w-[1200px] mx-auto space-y-8">
        {/* Persona selector */}
        <div className="rounded-xl border border-border bg-card p-4">
          <label className="block text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Personalize for</label>
          <select
            value={activeId}
            onChange={(e) => setActiveId(e.target.value)}
            className="w-full md:w-96 px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-db-lava">
            <option value="super">Select a vendor or user…</option>
            {personas.filter((p) => p.id !== 'super').map((p) => (
              <option key={p.id} value={p.id}>{p.person} · {p.title} · {p.vendor_nm}</option>
            ))}
          </select>
        </div>

        {!chosen ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <Sparkles className="w-7 h-7 text-db-lava mx-auto mb-3" />
            <p className="text-sm font-semibold text-foreground">Your Monday Morning Brief</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">Choose a vendor or user above to generate a personalized brief with headline numbers, what needs attention, and recommended actions.</p>
          </div>
        ) : (
        <>
        {/* Brief hero */}
        <div className="rounded-2xl border border-border overflow-hidden bg-gradient-to-br from-db-navy to-[#12303a] text-white p-6 md:p-8 animate-in">
          <div className="flex items-center gap-2 text-white/60 text-[11px] font-semibold uppercase tracking-widest">
            <Sparkles className="w-3.5 h-3.5" /> Monday Morning Brief · {today}
          </div>
          <div className="flex items-center gap-4 mt-3">
            <div className="w-14 h-14 rounded-full bg-db-lava/90 flex items-center justify-center text-white text-lg font-bold shrink-0 ring-2 ring-white/20">
              {chosen.initials || 'SU'}
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold leading-tight">Good morning, {(chosen.person || name).split(' ')[0]}</h1>
              <p className="text-white/70 text-sm">{chosen.title} · {chosen.vendor_nm}{chosen.region ? ` · ${chosen.region}` : ''}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-3">
            {(chosen.categories || []).map((c) => (
              <span key={c} className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/90 border border-white/15">{c}</span>
            ))}
          </div>
          <div className="mt-4 max-w-2xl border-l-2 border-db-lava pl-4">
            {brief == null ? (
              <p className="text-white/50 text-sm italic">Writing your brief…</p>
            ) : (
              <div className="text-white/85 text-sm leading-relaxed space-y-2">
                {brief.split(/\n\n+/).map((para, i) => <p key={i}>{para}</p>)}
              </div>
            )}
          </div>
        </div>

        {/* Headline stat tiles */}
        {insights && insights.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 -mt-2">
            {statTiles.map((t, i) => {
              const Icon = ICON[t.kind] || Sparkles;
              const tone = t.kind === 'warn' ? 'text-db-error' : t.kind === 'up' || t.kind === 'ok' ? 'text-db-success' : 'text-db-warning';
              return (
                <div key={i} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t.metric}</span>
                    <Icon className={`w-4 h-4 ${tone}`} />
                  </div>
                  <p className="text-2xl font-bold tabular-nums text-foreground mt-1">{t.value}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{t.detail}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* What needs attention (priority-ordered insights) */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-db-lava text-white text-xs font-bold">1</span>
            <h2 className="text-sm font-bold uppercase tracking-widest text-foreground">What needs your attention</h2>
          </div>
          {!insights ? <p className="text-xs text-muted-foreground">Loading…</p> : insights.length === 0 ? <p className="text-xs text-muted-foreground">No insights available.</p> : (
            <div className="space-y-5">
              {[
                { label: 'Momentum', items: insights.filter((it) => it.kind === 'up' || it.kind === 'ok') },
                { label: 'Watch-outs', items: insights.filter((it) => it.kind === 'warn' || it.kind === 'watch') },
              ].filter((g) => g.items.length).map((g) => (
                <ScrollRow key={g.label} label={g.label}>
                  {g.items.map((it, i) => {
                    const Icon = ICON[it.kind] || Sparkles;
                    const accent = it.kind === 'warn' ? 'border-l-db-error' : it.kind === 'up' || it.kind === 'ok' ? 'border-l-db-success' : 'border-l-db-warning';
                    return (
                      <div key={i} className={`snap-start shrink-0 w-72 rounded-xl border border-border border-l-4 ${accent} bg-card p-4 shadow-sm`}>
                        <div className="flex items-center gap-2 mb-1">
                          <Icon className="w-4 h-4 text-db-lava" />
                          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{it.metric}</span>
                        </div>
                        <p className="text-lg font-bold text-foreground">{it.value}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{it.detail}</p>
                        {it.cta && <Link to={it.cta.to} className="inline-flex items-center gap-1 text-xs text-db-lava mt-2 hover:underline">{it.cta.label} <ArrowRight className="w-3 h-3" /></Link>}
                      </div>
                    );
                  })}
                </ScrollRow>
              ))}
            </div>
          )}
        </section>

        {/* Recommended actions */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-db-lava text-white text-xs font-bold">2</span>
            <h2 className="text-sm font-bold uppercase tracking-widest text-foreground">Recommended actions</h2>
          </div>
          {!insights ? null : urgent.length === 0 ? <p className="text-xs text-muted-foreground">No urgent actions — everything on track.</p> : (
            <div className="space-y-2">
              {urgent.map((it, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Act on {it.metric}: {it.value}</p>
                    <p className="text-xs text-muted-foreground">{it.detail}</p>
                  </div>
                  {it.cta && <Link to={it.cta.to} className="text-xs px-3 py-1.5 rounded-md bg-db-lava text-white shrink-0">Take action</Link>}
                </div>
              ))}
            </div>
          )}
        </section>
        </>
        )}
      </div>
    </div>
  );
}

// Horizontal, snap-scrolling row with left/right controls. Cards live in one
// section but can be paged left/right.
function ScrollRow({ label, children }) {
  const ref = useRef(null);
  const nudge = (dir) => ref.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
        <div className="flex gap-1">
          <button aria-label="Scroll left" onClick={() => nudge(-1)} className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-border bg-card hover:bg-accent text-muted-foreground">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button aria-label="Scroll right" onClick={() => nudge(1)} className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-border bg-card hover:bg-accent text-muted-foreground">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div ref={ref} className="flex gap-3 overflow-x-auto snap-x scroll-smooth pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
    </div>
  );
}
