// Databricks Statement Execution API client.
// Uses the signed-in viewer's scoped token for request-driven SQL so Unity
// Catalog row filters, masks, and grants are enforced per user. Background
// work without a request can fall back to the App service principal.

import { AsyncLocalStorage } from 'node:async_hooks';

const HOST = (process.env.DATABRICKS_HOST || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const WAREHOUSE_ID = process.env.WAREHOUSE_ID;
const CATALOG = process.env.CATALOG;
const SCHEMA = process.env.SCHEMA;
const CLIENT_ID = process.env.DATABRICKS_CLIENT_ID;
const CLIENT_SECRET = process.env.DATABRICKS_CLIENT_SECRET;

let cachedToken = null;
let tokenExpiresAt = 0;
const requestAuthorization = new AsyncLocalStorage();

// Databricks Apps user authorization forwards a short-lived, scope-limited
// token on each request. Keeping it in AsyncLocalStorage lets the existing
// source-backed query helpers honor the signed-in viewer's Unity Catalog
// policies without threading a token through every route and helper call.
export function withUserAuthorization(req, _res, next) {
  const userToken = req.get('x-forwarded-access-token') || null;
  requestAuthorization.run({ userToken }, next);
}

async function getToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60_000) return cachedToken;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'all-apis',
  });
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const r = await fetch(`https://${HOST}/oidc/v1/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!r.ok) throw new Error(`token mint failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  cachedToken = j.access_token;
  tokenExpiresAt = now + (j.expires_in || 3600) * 1000;
  return cachedToken;
}

async function getQueryToken() {
  return requestAuthorization.getStore()?.userToken || getToken();
}

function rowsToObjects(result) {
  const cols = (result?.manifest?.schema?.columns || []).map((c) => c.name);
  const data = result?.result?.data_array || [];
  return data.map((row) => {
    const obj = {};
    cols.forEach((c, i) => {
      const v = row[i];
      const t = result.manifest.schema.columns[i].type_name;
      if (v == null) obj[c] = null;
      else if (['INT', 'BIGINT', 'SHORT', 'LONG'].includes(t)) obj[c] = Number(v);
      else if (['FLOAT', 'DOUBLE', 'DECIMAL'].includes(t)) obj[c] = Number(v);
      else if (t === 'BOOLEAN') obj[c] = v === true || v === 'true';
      else obj[c] = v;
    });
    return obj;
  });
}

// In-memory result cache. Demo data is effectively static between refreshes, so
// serving identical queries from memory for a few minutes makes page loads (and
// the auto-running Executive Summary) snappy without any staleness that matters
// for a demo. Parameterized queries are never cached.
const _qcache = new Map(); // statement -> { at, rows }
const QUERY_CACHE_TTL_MS = 5 * 60_000;

export function clearQueryCache() { _qcache.clear(); }

export async function runQuery(statement, params = []) {
  if (!WAREHOUSE_ID) throw new Error('WAREHOUSE_ID env var not set');
  if (!CATALOG || !SCHEMA) throw new Error('CATALOG and SCHEMA env vars must be set');
  if (!HOST) throw new Error('DATABRICKS_HOST env var not set');
  const userToken = requestAuthorization.getStore()?.userToken || null;
  // A shared cache could cross user authorization boundaries. Only cache
  // background/App-identity queries; viewer-driven queries always reach UC.
  const cacheKey = params.length || userToken ? null : statement;
  if (cacheKey) {
    const hit = _qcache.get(cacheKey);
    if (hit && Date.now() - hit.at < QUERY_CACHE_TTL_MS) return hit.rows;
  }
  const token = userToken || await getQueryToken();
  const payload = {
    warehouse_id: WAREHOUSE_ID,
    statement,
    catalog: CATALOG,
    schema: SCHEMA,
    // Wait up to the API max, then CONTINUE (don't CANCEL) so a cold-starting
    // warehouse or a heavy query doesn't get killed — we poll below until it
    // reaches a terminal state. This is the fix for intermittent 500s /
    // "could not generate" errors on the first request after the app is idle.
    wait_timeout: '50s',
    on_wait_timeout: 'CONTINUE',
    format: 'JSON_ARRAY',
    disposition: 'INLINE',
  };
  if (params.length) payload.parameters = params;

  const r = await fetch(`https://${HOST}/api/2.0/sql/statements`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`sql HTTP ${r.status}: ${await r.text()}`);
  let j = await r.json();

  // Poll while the statement is still pending/running (cold warehouse, big scan).
  const statementId = j.statement_id;
  const deadline = Date.now() + 110_000; // overall ceiling ~110s
  while (['PENDING', 'RUNNING'].includes(j.status?.state) && Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 2000));
    const p = await fetch(`https://${HOST}/api/2.0/sql/statements/${statementId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!p.ok) throw new Error(`sql poll HTTP ${p.status}: ${await p.text()}`);
    j = await p.json();
  }

  if (j.status?.state !== 'SUCCEEDED') {
    const err = j.status?.error?.message || j.status?.state || 'unknown';
    throw new Error(`sql failed: ${err}`);
  }
  const rows = rowsToObjects(j);
  if (cacheKey) _qcache.set(cacheKey, { at: Date.now(), rows });
  return rows;
}

export const config = { CATALOG, SCHEMA, WAREHOUSE_ID, HOST };
