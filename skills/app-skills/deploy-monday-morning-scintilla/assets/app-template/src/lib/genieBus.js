// Tiny pub/sub so any card's "Ask Genie" button can open the global Genie
// popup pre-seeded with a context-aware question and auto-ask it. The popup
// (mounted once at app level) subscribes; cards publish.

const listeners = new Set();

// Fire from a card. `question` is auto-asked; `label` (optional) is a short
// human tag for what the user clicked (used only for analytics/telemetry).
export function askGenie(question, label = null) {
  for (const cb of listeners) cb({ question, label });
}

export function onAskGenie(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
