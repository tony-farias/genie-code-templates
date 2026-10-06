// "Take Action" — executes a recommendation. POSTs to /api/actions, which
// persists a work order to Lakebase and returns a concrete receipt (work-order
// id, owner queue, steps, ETA). Shows the receipt in a confirmation modal.
import { useState } from 'react';
import { Zap, Loader2, CheckCircle2, X, ClipboardList, Clock, User } from 'lucide-react';

export default function TakeActionButton({
  kind = 'generic',
  title,
  detail,
  app = 'sales',
  label = 'Take Action',
  compact = false,
  className = '',
}) {
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  async function execute(e) {
    e?.stopPropagation?.();
    if (busy || done) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, title, detail, app }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setReceipt(j.receipt);
      setDone(true);
    } catch (err) {
      setError(err.message || 'Failed to take action');
    } finally {
      setBusy(false);
    }
  }

  const base = compact
    ? `inline-flex items-center gap-1 text-[11px] font-semibold ${done ? 'text-db-success' : 'text-db-lava hover:text-db-lava/80'} transition-colors`
    : `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
        done ? 'bg-db-success/10 text-db-success border border-db-success/30'
             : 'bg-db-lava text-white hover:bg-db-lava/90'
      }`;

  return (
    <>
      <button onClick={execute} disabled={busy} className={`${base} disabled:opacity-60 ${className}`} title={title}>
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          : done ? <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
          : <Zap className="w-3.5 h-3.5" aria-hidden="true" />}
        {busy ? 'Executing…' : done ? 'Action queued' : label}
      </button>
      {error && <span className="ml-2 text-[11px] text-db-error">{error}</span>}
      {receipt && <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}

function ReceiptModal({ receipt, onClose }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-card rounded-2xl border border-border shadow-2xl overflow-hidden animate-[popIn_.18s_ease]">
        <div className="bg-gradient-to-r from-db-navy to-[#12303a] px-5 py-4 flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-db-success/20 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-db-success" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Action queued</h3>
              <p className="text-[11px] text-white/60 font-mono">{receipt.work_order}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded-lg hover:bg-white/10 text-white/70">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-foreground">{receipt.title}</p>
            {receipt.detail && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{receipt.detail}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field icon={ClipboardList} label="Routed to" value={receipt.queue} />
            <Field icon={User} label="Owner" value={receipt.owner} />
            <Field icon={Clock} label="Target ETA" value={receipt.eta_label} />
            <Field icon={CheckCircle2} label="Status" value={receipt.status} valueClass="text-db-success" />
          </div>

          {receipt.steps?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Workflow</p>
              <ol className="space-y-1">
                {receipt.steps.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-foreground">
                    <span className="w-4 h-4 rounded-full bg-db-lava/10 text-db-lava text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                    {s}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground border-t border-border pt-3">
            Logged by {receipt.created_by}
            {receipt.action_id ? ` · persisted (id ${String(receipt.action_id).slice(0, 8)})` : ' · session receipt'}
          </p>
        </div>

        <div className="px-5 pb-5">
          <button onClick={onClose} className="w-full rounded-lg bg-db-lava text-white py-2.5 text-sm font-semibold hover:bg-db-lava/90">
            Done
          </button>
        </div>
      </div>
      <style>{`@keyframes popIn{from{transform:scale(.96);opacity:0}to{transform:scale(1);opacity:1}}`}</style>
    </div>
  );
}

function Field({ icon: Icon, label, value, valueClass = 'text-foreground' }) {
  return (
    <div className="rounded-lg border border-border bg-accent/40 p-2.5">
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="w-3 h-3" aria-hidden="true" /> {label}
      </div>
      <div className={`text-xs font-semibold mt-0.5 ${valueClass}`}>{value}</div>
    </div>
  );
}
