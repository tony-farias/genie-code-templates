// Small "Ask Genie" affordance for any card. Clicking opens the global Genie
// popup pre-seeded with a context-aware question (derived from that card's live
// data) and auto-asks it. Use as a card's `action` slot or inline.
import { Sparkles } from 'lucide-react';
import { askGenie } from '../lib/genieBus';

export default function AskGenieButton({ question, label = 'Ask Genie', title, className = '', compact = false }) {
  if (!question) return null;
  const handle = (e) => {
    e?.stopPropagation?.();
    askGenie(question, label);
  };
  if (compact) {
    return (
      <button
        onClick={handle}
        title={title || question}
        aria-label={`Ask Genie: ${question}`}
        className={`inline-flex items-center gap-1 text-[11px] font-medium text-db-lava hover:text-db-lava/80 transition-colors ${className}`}
      >
        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
        {label}
      </button>
    );
  }
  return (
    <button
      onClick={handle}
      title={title || question}
      aria-label={`Ask Genie: ${question}`}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:border-db-lava hover:text-db-lava hover:bg-db-lava/5 transition-colors ${className}`}
    >
      <Sparkles className="w-3.5 h-3.5 text-db-lava" aria-hidden="true" />
      {label}
    </button>
  );
}
