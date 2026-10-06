// PostgreSQL connection helper for Lakebase Autoscale.
// Reuses the monday_morning_chat database.
//
// Auth: prefer a static LAKEBASE_PASSWORD when one is set, but by default
// authenticate with the app's runtime service-principal OAuth token (the same
// DATABRICKS_CLIENT_ID / DATABRICKS_CLIENT_SECRET the SQL warehouse uses).
// Databricks Lakebase accepts that OAuth token as the Postgres password, so no
// static secret needs to be committed or set at deploy time. The token is
// short-lived, so pg's `password` function re-mints it per new connection.

import pg from 'pg';
const { Pool } = pg;

const DB_HOST = (process.env.DATABRICKS_HOST || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const CLIENT_ID = process.env.DATABRICKS_CLIENT_ID;
const CLIENT_SECRET = process.env.DATABRICKS_CLIENT_SECRET;

const HOST = process.env.LAKEBASE_HOST;
const DB = process.env.LAKEBASE_DB || 'monday_morning_chat';
// When authenticating via OAuth, the Postgres user is the service principal's
// client id (defaults to the app's own injected DATABRICKS_CLIENT_ID).
const USER = process.env.LAKEBASE_USER || CLIENT_ID;
const PASSWORD = process.env.LAKEBASE_PASSWORD;
// Treat the committed placeholder as "unset" so we fall through to OAuth.
const HAS_STATIC_PW = PASSWORD && PASSWORD !== 'SET_AT_DEPLOY_TIME';

let _tok = null;
let _tokExp = 0;
async function mintOAuthToken() {
  const now = Date.now();
  if (_tok && now < _tokExp - 60_000) return _tok;
  if (!DB_HOST || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('cannot mint Lakebase OAuth token: DATABRICKS_HOST/CLIENT_ID/CLIENT_SECRET not set');
  }
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const r = await fetch(`https://${DB_HOST}/oidc/v1/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'all-apis' }),
  });
  if (!r.ok) throw new Error(`lakebase token mint failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  _tok = j.access_token;
  _tokExp = now + (j.expires_in || 3600) * 1000;
  return _tok;
}

let pool = null;

export function getPool() {
  if (pool) return pool;
  if (!HOST || !USER) {
    console.warn('[lakebase] LAKEBASE_HOST/USER missing; persistence will be disabled');
    return null;
  }
  // Either a static password, or an async function that mints/refreshes the SP
  // OAuth token per connection. Without OAuth creds AND without a static
  // password there's nothing to authenticate with, so stay disabled.
  if (!HAS_STATIC_PW && (!DB_HOST || !CLIENT_ID || !CLIENT_SECRET)) {
    console.warn('[lakebase] no LAKEBASE_PASSWORD and no OAuth creds; persistence disabled');
    return null;
  }
  pool = new Pool({
    host: HOST,
    port: 5432,
    database: DB,
    user: USER,
    password: HAS_STATIC_PW ? PASSWORD : mintOAuthToken,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => console.error('[lakebase] pool error:', err));
  return pool;
}

export async function query(sql, params = []) {
  const p = getPool();
  if (!p) throw new Error('Lakebase not configured');
  const r = await p.query(sql, params);
  return r;
}

// ── Action log ("Take Action") ───────────────────────────────────────
// Each recommendation the user executes is persisted here as a work order,
// so actions survive refresh and can be listed back. The source warehouse is
// read-only (scintilla_app_ro), so this is where the real side effect lives.

let _actionSchemaReady = null;
export async function ensureActionSchema() {
  if (_actionSchemaReady) return _actionSchemaReady;
  _actionSchemaReady = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS action_log (
        action_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        work_order   TEXT NOT NULL,
        app_key      TEXT,
        kind         TEXT NOT NULL,
        title        TEXT NOT NULL,
        detail       TEXT,
        payload      JSONB,
        status       TEXT NOT NULL DEFAULT 'QUEUED',
        created_by   TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_action_log_created ON action_log (created_at DESC)`);
  })().catch((e) => { _actionSchemaReady = null; throw e; });
  return _actionSchemaReady;
}

export async function recordAction({ workOrder, appKey = null, kind, title, detail = null, payload = null, createdBy = null }) {
  await ensureActionSchema();
  const r = await query(
    `INSERT INTO action_log (work_order, app_key, kind, title, detail, payload, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING action_id, work_order, status, created_at`,
    [workOrder, appKey, kind, title, detail, payload ? JSON.stringify(payload) : null, createdBy]
  );
  return r.rows[0];
}

export async function listActions(limit = 50) {
  await ensureActionSchema();
  const r = await query(
    `SELECT action_id, work_order, app_key, kind, title, detail, status, created_by, created_at
       FROM action_log ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return r.rows;
}

// ── Campaign session helpers ─────────────────────────────────────────

export async function createSession({ signalId = null, parsedIntent = null }) {
  const r = await query(
    `INSERT INTO campaign_sessions (signal_id, parsed_intent, status)
     VALUES ($1, $2, 'intent') RETURNING session_id, created_at`,
    [signalId, parsedIntent ? JSON.stringify(parsedIntent) : null]
  );
  return r.rows[0];
}

export async function getSession(sessionId) {
  const r = await query(`SELECT * FROM campaign_sessions WHERE session_id = $1`, [sessionId]);
  return r.rows[0] || null;
}

export async function updateSession(sessionId, fields) {
  const cols = [];
  const vals = [];
  let i = 1;
  for (const [k, v] of Object.entries(fields)) {
    cols.push(`${k} = $${i++}`);
    vals.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
  }
  if (!cols.length) return;
  cols.push(`updated_at = NOW()`);
  vals.push(sessionId);
  await query(
    `UPDATE campaign_sessions SET ${cols.join(', ')} WHERE session_id = $${i}`,
    vals
  );
}

export async function recordActivation({ campaignId, sessionId, payload, activatedBy }) {
  const r = await query(
    `INSERT INTO activation_log (campaign_id, session_id, payload, activated_by)
     VALUES ($1, $2, $3, $4) RETURNING activation_id, activated_at`,
    [campaignId, sessionId, JSON.stringify(payload), activatedBy || 'unknown']
  );
  return r.rows[0];
}

export async function recordPerformance({ campaignId, sessionId, name, totalSpend, segments, channelAlloc, projectedRoi }) {
  await query(
    `INSERT INTO campaign_performance (
       campaign_id, session_id, campaign_name, total_spend,
       segments_used, channel_allocation, projected_roi, status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
     ON CONFLICT (campaign_id) DO UPDATE SET
       total_spend = EXCLUDED.total_spend,
       segments_used = EXCLUDED.segments_used,
       channel_allocation = EXCLUDED.channel_allocation`,
    [campaignId, sessionId, name, totalSpend, JSON.stringify(segments), JSON.stringify(channelAlloc), projectedRoi]
  );
}

export async function listPerformance(limit = 50) {
  const r = await query(
    `SELECT campaign_id, campaign_name, total_spend, total_reach, conversion_rate,
            roi_multiplier, channel_allocation, segments_used, activated_at, status
       FROM campaign_performance
       ORDER BY activated_at DESC NULLS LAST LIMIT $1`,
    [limit]
  );
  return r.rows;
}

// ── Per-app Genie chat history ("memory space") ──────────────────────
// Each app (sales / demand / audience / measurement) gets its own scoped
// conversation history, keyed by app_key. The Databricks Genie space is
// shared across apps, so we link each Lakebase session to its Genie
// conversation_id to preserve multi-turn context, but the sidebar history
// shown in each app is filtered to that app only.

let _chatSchemaReady = null;

// Lazily create the chat-history tables once per process. CREATE TABLE IF NOT
// EXISTS is idempotent, so this is safe to call on every history operation.
export async function ensureChatSchema() {
  if (_chatSchemaReady) return _chatSchemaReady;
  _chatSchemaReady = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS genie_chat_sessions (
        session_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        app_key               TEXT NOT NULL,
        user_key              TEXT,
        title                 TEXT,
        genie_conversation_id TEXT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // user_key was added after the initial checkpoint-18 schema — backfill it
    // on already-created tables. Sessions are scoped by (app_key, user_key) so
    // each viewer only sees their own history within an app.
    await query(`ALTER TABLE genie_chat_sessions ADD COLUMN IF NOT EXISTS user_key TEXT`);
    await query(`
      CREATE TABLE IF NOT EXISTS genie_chat_messages (
        message_id  BIGSERIAL PRIMARY KEY,
        session_id  UUID NOT NULL REFERENCES genie_chat_sessions(session_id) ON DELETE CASCADE,
        app_key     TEXT NOT NULL,
        role        TEXT NOT NULL,
        content     TEXT,
        payload     JSONB,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_genie_sessions_app_user
                 ON genie_chat_sessions (app_key, user_key, updated_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_genie_messages_session
                 ON genie_chat_messages (session_id, created_at)`);
  })().catch((e) => {
    // Reset so a transient failure can be retried on the next call.
    _chatSchemaReady = null;
    throw e;
  });
  return _chatSchemaReady;
}

// Start a new per-app, per-user chat session. title is derived from the first
// question; userKey is the viewer's identity (email) from the app's auth headers.
export async function createChatSession({ appKey, userKey = null, title = null, genieConversationId = null }) {
  await ensureChatSchema();
  const r = await query(
    `INSERT INTO genie_chat_sessions (app_key, user_key, title, genie_conversation_id)
     VALUES ($1, $2, $3, $4)
     RETURNING session_id, app_key, user_key, title, genie_conversation_id, created_at, updated_at`,
    [appKey, userKey, title ? title.slice(0, 120) : null, genieConversationId]
  );
  return r.rows[0];
}

// Append a message to a session and bump the session's updated_at. Also
// backfills title / genie_conversation_id on the session when first available.
export async function appendChatMessage({ sessionId, appKey, role, content, payload = null }) {
  await ensureChatSchema();
  await query(
    `INSERT INTO genie_chat_messages (session_id, app_key, role, content, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [sessionId, appKey, role, content || null, payload ? JSON.stringify(payload) : null]
  );
  await query(`UPDATE genie_chat_sessions SET updated_at = NOW() WHERE session_id = $1`, [sessionId]);
}

export async function setSessionGenieConversation(sessionId, genieConversationId) {
  await ensureChatSchema();
  await query(
    `UPDATE genie_chat_sessions
       SET genie_conversation_id = COALESCE(genie_conversation_id, $2)
     WHERE session_id = $1`,
    [sessionId, genieConversationId]
  );
}

// List sessions for one app + viewer, newest first, with a message count.
export async function listChatSessions(appKey, userKey = null, limit = 50) {
  await ensureChatSchema();
  const r = await query(
    `SELECT s.session_id, s.title, s.genie_conversation_id, s.created_at, s.updated_at,
            COUNT(m.message_id) AS message_count
       FROM genie_chat_sessions s
       LEFT JOIN genie_chat_messages m ON m.session_id = s.session_id
      WHERE s.app_key = $1 AND s.user_key IS NOT DISTINCT FROM $2
      GROUP BY s.session_id
      ORDER BY s.updated_at DESC
      LIMIT $3`,
    [appKey, userKey, limit]
  );
  return r.rows;
}

// Load one session's full message history (scoped to app + viewer).
export async function getChatSession(sessionId, appKey = null, userKey = null) {
  await ensureChatSchema();
  const s = await query(
    `SELECT session_id, app_key, user_key, title, genie_conversation_id, created_at, updated_at
       FROM genie_chat_sessions WHERE session_id = $1`,
    [sessionId]
  );
  if (!s.rows.length) return null;
  if (appKey && s.rows[0].app_key !== appKey) return null;
  if (userKey != null && s.rows[0].user_key !== userKey) return null;
  const m = await query(
    `SELECT message_id, role, content, payload, created_at
       FROM genie_chat_messages
      WHERE session_id = $1
      ORDER BY created_at, message_id`,
    [sessionId]
  );
  return { ...s.rows[0], messages: m.rows };
}

export async function deleteChatSession(sessionId, appKey = null, userKey = null) {
  await ensureChatSchema();
  // ON DELETE CASCADE removes the messages. Build the WHERE clause dynamically
  // so a viewer can only delete their own sessions.
  const conds = ['session_id = $1'];
  const vals = [sessionId];
  if (appKey) { vals.push(appKey); conds.push(`app_key = $${vals.length}`); }
  if (userKey != null) { vals.push(userKey); conds.push(`user_key = $${vals.length}`); }
  const r = await query(`DELETE FROM genie_chat_sessions WHERE ${conds.join(' AND ')}`, vals);
  return r.rowCount > 0;
}
