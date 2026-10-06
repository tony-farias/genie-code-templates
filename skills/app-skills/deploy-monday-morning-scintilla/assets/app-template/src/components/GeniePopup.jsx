// Global Genie assistant — floating button + resizable slide-over panel,
// available on every tab. Talks to the REAL Databricks Genie Conversation API
// (POST /api/genie/ask, multi-turn via conversation_id), so it answers arbitrary
// natural-language questions and returns the SQL + result rows it ran.
import { useState, useRef, useEffect, useCallback } from 'react';
import { Sparkles, X, Send, TrendingUp, Boxes, RotateCcw, Lightbulb, Code2, Maximize2, Minimize2, Plus } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer } from 'recharts';
import { useFilters } from '../lib/filters.jsx';
import { onAskGenie } from '../lib/genieBus';
import { fmtGenieCell } from '../lib/api';

const STARTERS = [
  { icon: Boxes, text: 'Which categories grew or declined the most over the last 4 weeks versus the prior 4 weeks?' },
  { icon: TrendingUp, text: 'Which stores have the lowest in-stock rate right now?' },
  { icon: RotateCcw, text: 'What are my top return reasons, and which items drive them?' },
  { icon: Lightbulb, text: 'How have weekly sales trended over the last 13 weeks?' },
];

// Panel width presets (px). Drag handle also allowed between MIN and MAX.
const MIN_W = 380, MAX_W = 1100, DEFAULT_W = 460;

export default function GeniePopup() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]); // {role, text, query?, error?}
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [convId, setConvId] = useState(null);
  const [width, setWidth] = useState(DEFAULT_W);
  const { vendor, category, rangeLabel } = useFilters();
  const scrollRef = useRef(null);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs, busy]);

  const askRef = useRef(null);
  useEffect(() => {
    return onAskGenie(({ question }) => {
      setOpen(true);
      if (question) askRef.current?.(question);
    });
  }, []);

  const ask = useCallback(async (question) => {
    if (!question.trim() || busy) return;
    setMsgs((m) => [...m, { role: 'user', text: question }]);
    setQ(''); setBusy(true);
    try {
      const r = await fetch('/api/genie/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: question, conversation_id: convId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      if (j.conversation_id) setConvId(j.conversation_id);
      setMsgs((m) => [...m, { role: 'genie', text: j.answer, query: j.query }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'genie', text: `Genie error: ${e.message}`, error: true }]);
    } finally { setBusy(false); }
  }, [busy, convId]);
  askRef.current = ask;

  function newChat() { setMsgs([]); setConvId(null); }

  // Drag-to-resize (left edge of the panel).
  const dragging = useRef(false);
  useEffect(() => {
    function onMove(e) {
      if (!dragging.current) return;
      const w = Math.min(MAX_W, Math.max(MIN_W, window.innerWidth - e.clientX));
      setWidth(w);
    }
    function onUp() { dragging.current = false; document.body.style.userSelect = ''; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const wide = width > (MIN_W + MAX_W) / 2;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-db-lava text-white pl-3 pr-4 py-3 shadow-lg hover:bg-db-lava/90 transition-transform hover:scale-105"
        aria-label="Ask Genie"
      >
        <Sparkles className="w-5 h-5" />
        <span className="text-sm font-semibold">Ask Genie</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="relative bg-card border-l border-border shadow-2xl flex flex-col animate-[slideIn_.2s_ease]"
            style={{ width: `min(${width}px, 100vw)` }}>
            {/* drag handle */}
            <div
              onMouseDown={() => { dragging.current = true; document.body.style.userSelect = 'none'; }}
              title="Drag to resize"
              className="absolute left-0 top-0 h-full w-1.5 -ml-0.5 cursor-col-resize hover:bg-db-lava/40 z-10"
            />
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-db-navy text-white">
              <div className="flex items-center gap-2"><Sparkles className="w-5 h-5 text-db-warning" /><span className="font-semibold">Ask Genie</span><span className="text-[10px] text-white/50 px-1.5 py-0.5 rounded bg-white/10">live</span></div>
              <div className="flex items-center gap-1">
                <button onClick={newChat} title="New chat" className="p-1.5 hover:bg-white/10 rounded"><Plus className="w-4 h-4" /></button>
                <button onClick={() => setWidth(wide ? DEFAULT_W : MAX_W)} title={wide ? 'Shrink' : 'Expand'} className="p-1.5 hover:bg-white/10 rounded">{wide ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}</button>
                <button onClick={() => setOpen(false)} className="p-1.5 hover:bg-white/10 rounded"><X className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="px-4 py-2 text-[11px] text-muted-foreground border-b border-border bg-accent/40">
              Databricks Genie · Monday Morning Sales · {vendor === 'all' ? 'all vendors' : 'selected vendor'} · {category === 'all' ? 'all categories' : category} · {rangeLabel}
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {msgs.length === 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground mb-2">Ask anything about your sales, inventory, returns, or stores. Genie writes and runs the SQL live.</p>
                  {STARTERS.map((s, i) => (
                    <button key={i} onClick={() => ask(s.text)} className="w-full text-left flex items-start gap-2 rounded-lg border border-border p-2.5 text-xs hover:bg-accent transition-colors">
                      <s.icon className="w-4 h-4 text-db-lava shrink-0 mt-0.5" />
                      <span className="text-foreground">{s.text}</span>
                    </button>
                  ))}
                </div>
              )}
              {msgs.map((m, i) => <Bubble key={i} m={m} wide={wide} />)}
              {busy && <div className="flex gap-1.5 items-center text-xs text-muted-foreground"><span className="w-2 h-2 rounded-full bg-db-lava animate-bounce" /><span className="w-2 h-2 rounded-full bg-db-lava animate-bounce" style={{ animationDelay: '120ms' }} /><span className="w-2 h-2 rounded-full bg-db-lava animate-bounce" style={{ animationDelay: '240ms' }} /> Genie is thinking…</div>}
            </div>

            <div className="p-3 border-t border-border">
              <div className="flex gap-2">
                <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask(q)}
                  placeholder="Ask Genie anything…" disabled={busy} className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-db-lava/40 disabled:opacity-60" />
                <button onClick={() => ask(q)} disabled={busy || !q.trim()} className="rounded-lg bg-db-lava text-white px-3 py-2 hover:bg-db-lava/90 disabled:opacity-50"><Send className="w-4 h-4" /></button>
              </div>
            </div>
          </div>
        </div>
      )}
      <style>{`@keyframes slideIn{from{transform:translateX(20px);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
    </>
  );
}

function Bubble({ m, wide }) {
  const [showSql, setShowSql] = useState(false);
  if (m.role === 'user') {
    return <div className="flex justify-end"><div className="bg-db-navy text-white rounded-lg rounded-br-sm px-3 py-2 text-sm max-w-[85%]">{m.text}</div></div>;
  }
  const query = m.query;
  return (
    <div className="flex justify-start">
      <div className={`rounded-lg rounded-bl-sm px-3 py-2.5 text-sm w-full ${m.error ? 'bg-db-error/5 border border-db-error/30' : 'bg-accent'}`}>
        <p className={`leading-relaxed whitespace-pre-wrap ${m.error ? 'text-db-error' : 'text-foreground'}`}>{m.text}</p>

        {query && !query.error && (query.columns?.length > 0) && (
          <div className="mt-2.5">
            <AutoViz query={query} wide={wide} />
            <ResultTable query={query} />
          </div>
        )}
        {query?.error && <p className="mt-2 text-[11px] text-db-error">Query error: {query.error}</p>}

        {query?.sql && (
          <div className="mt-2 rounded-lg border border-border overflow-hidden">
            <button onClick={() => setShowSql((s) => !s)} className="w-full px-2.5 py-1.5 flex items-center justify-between text-[11px] font-medium text-muted-foreground hover:bg-accent/60">
              <span className="inline-flex items-center gap-1.5"><Code2 className="w-3.5 h-3.5" /> {showSql ? 'Hide SQL' : 'Show SQL'}</span>
              <span className="font-mono">{query.rows?.length || 0} rows</span>
            </button>
            {showSql && <pre className="text-[10px] font-mono p-2.5 bg-db-navy text-db-oat-medium overflow-x-auto whitespace-pre-wrap">{query.sql}</pre>}
          </div>
        )}
      </div>
    </div>
  );
}

// Render a bar chart when the result looks like [label, number].
function AutoViz({ query, wide }) {
  const cols = query.columns || [], rows = query.rows || [];
  if (rows.length < 2 || rows.length > 25) return null;
  if (typeof rows[0][0] !== 'string' || isNaN(Number(rows[0][1]))) return null;
  const data = rows.map((r) => ({ label: String(r[0]).slice(0, 28), value: Number(r[1]) }));
  return (
    <div className="mb-2 rounded-lg border border-border p-2 bg-card">
      <ResponsiveContainer width="100%" height={Math.min(320, 26 * data.length + 40)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E7EAEC" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 9, fill: '#5A6F77' }} />
          <YAxis type="category" dataKey="label" tick={{ fontSize: 9, fill: '#5A6F77' }} width={wide ? 150 : 90} />
          <RTooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
          <Bar dataKey="value" fill="#FF3621" radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground text-center">{cols[1]} by {cols[0]}</p>
    </div>
  );
}

function ResultTable({ query }) {
  const cols = query.columns || [], rows = (query.rows || []).slice(0, 8);
  return (
    <div className="rounded-lg border border-border overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead className="bg-card"><tr>{cols.map((c) => <th key={c} className="text-left p-1.5 font-semibold text-muted-foreground whitespace-nowrap">{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border">
              {row.map((v, j) => <td key={j} className="p-1.5 tabular-nums whitespace-nowrap">{fmtGenieCell(cols[j], v)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {query.rows?.length > 8 && <div className="text-[10px] text-muted-foreground p-1.5 border-t border-border">+ {query.rows.length - 8} more rows{query.truncated ? ' (first 50)' : ''}</div>}
    </div>
  );
}
