// Genie Conversational API helper. Uses the same SP OAuth token as the SQL helper.

const HOST = (process.env.DATABRICKS_HOST || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const SPACE_ID = process.env.GENIE_SPACE_ID;
const CLIENT_ID = process.env.DATABRICKS_CLIENT_ID;
const CLIENT_SECRET = process.env.DATABRICKS_CLIENT_SECRET;

// Per-page Genie spaces (Pass 2). Each page's AI Genie tab can target its own
// space via these env vars; until they're set, everything falls back to the
// shared GENIE_SPACE_ID so behavior is unchanged.
const SPACE_BY_APP = {
  sales:       process.env.GENIE_SPACE_SALES,
  demand:      process.env.GENIE_SPACE_DEMAND,
  audience:    process.env.GENIE_SPACE_AUDIENCE,
  instore:     process.env.GENIE_SPACE_INSTORE,
  measurement: process.env.GENIE_SPACE_MEASUREMENT,
};
export function spaceForApp(appKey) {
  return (appKey && SPACE_BY_APP[appKey]) || SPACE_ID;
}

let cachedToken = null;
let tokenExpiresAt = 0;

export async function getToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60_000) return cachedToken;
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const r = await fetch(`https://${HOST}/oidc/v1/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'all-apis' }),
  });
  if (!r.ok) throw new Error(`token: ${r.status} ${await r.text()}`);
  const j = await r.json();
  cachedToken = j.access_token;
  tokenExpiresAt = now + (j.expires_in || 3600) * 1000;
  return cachedToken;
}

async function genieFetch(path, init = {}) {
  if (!SPACE_ID) throw new Error('GENIE_SPACE_ID env var not set');
  const token = await getToken();
  const r = await fetch(`https://${HOST}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`genie ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function startConversation(content, spaceId = SPACE_ID) {
  return genieFetch(`/api/2.0/genie/spaces/${spaceId}/start-conversation`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

export async function sendMessage(conversationId, content, spaceId = SPACE_ID) {
  return genieFetch(`/api/2.0/genie/spaces/${spaceId}/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

export async function getMessage(conversationId, messageId, spaceId = SPACE_ID) {
  return genieFetch(`/api/2.0/genie/spaces/${spaceId}/conversations/${conversationId}/messages/${messageId}`);
}

export async function getQueryResult(conversationId, messageId, attachmentId, spaceId = SPACE_ID) {
  return genieFetch(
    `/api/2.0/genie/spaces/${spaceId}/conversations/${conversationId}/messages/${messageId}/attachments/${attachmentId}/query-result`
  );
}

// Wait for a message to reach a terminal state. Genie sometimes leaves status as
// ASKING_AI even after attachments are populated. We give it more time when
// text.content hasn't appeared yet (text often arrives 5-20s after the query
// attachment). Previous version bailed after ~4.5s, returning answer=null.
export async function waitForMessage(conversationId, messageId, opts = {}) {
  const timeout = opts.timeoutMs || 90_000;
  const spaceId = opts.spaceId || SPACE_ID;
  const deadline = Date.now() + timeout;
  let stableCount = 0;
  let last = null;
  while (Date.now() < deadline) {
    const m = await getMessage(conversationId, messageId, spaceId);
    if (m.status === 'COMPLETED' || m.status === 'FAILED' || m.status === 'CANCELLED') return m;
    const attachments = m.attachments || [];
    const hasAttachments = attachments.length > 0;
    const hasText = attachments.some((a) => a.text?.content);
    if (hasAttachments) {
      const stable = last && last.status === m.status
                     && JSON.stringify(last.attachments) === JSON.stringify(m.attachments);
      stableCount = stable ? stableCount + 1 : 0;
      // When text is present, return after 3 stable polls (~4.5s) — quick path.
      // When text is missing, wait longer (16 stable polls ~24s) for Genie to finish.
      const requiredStable = hasText ? 3 : 16;
      if (stableCount >= requiredStable) return m;
    }
    last = m;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return last || { status: 'TIMEOUT', attachments: [] };
}

export async function getCuratedQuestions() {
  return genieFetch(`/api/2.0/data-rooms/${SPACE_ID}/curated-questions`);
}

// Use the data-rooms list (richer than the genie/spaces one — includes user_id)
// so the caller can filter to conversations the current SP actually owns
// (the detail endpoint 403s on conversations owned by someone else).
export async function listConversations() {
  return genieFetch(`/api/2.0/data-rooms/${SPACE_ID}/conversations`);
}

let cachedUserId = null;
export async function getCurrentUserId() {
  if (cachedUserId) return cachedUserId;
  try {
    const r = await genieFetch('/api/2.0/preview/scim/v2/Me');
    cachedUserId = r?.id ? Number(r.id) : null;
  } catch (e) {
    console.error('[genie/me]', e);
  }
  return cachedUserId;
}

export async function getConversation(conversationId) {
  return genieFetch(`/api/2.0/data-rooms/${SPACE_ID}/conversations/${conversationId}`);
}

export const config = { SPACE_ID, HOST };
