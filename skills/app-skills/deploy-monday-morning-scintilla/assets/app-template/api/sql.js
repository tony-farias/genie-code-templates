// Databricks Statement Execution API client.
// AUTHORIZATION_MODE selects the data identity for request-driven SQL and Genie:
//   user (default) — the signed-in viewer's forwarded token, so Unity Catalog
//                    grants, row filters, and masks apply per viewer. A request
//                    without that token fails; it never falls back to the App.
//   app            — the App service principal for every call.
// Work outside a request (the boot-time warehouse warm-up) uses the App identity.

import { AsyncLocalStorage } from 'node:async_hooks';

const HOST = (process.env.DATABRICKS_HOST || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const WAREHOUSE_ID = process.env.WAREHOUSE_ID;
const CATALOG = process.env.CATALOG;
const SCHEMA = process.env.SCHEMA;
const CLIENT_ID = process.env.DATABRICKS_CLIENT_ID;
const CLIENT_SECRET = process.env.DATABRICKS_CLIENT_SECRET;
const AUTHORIZATION_MODE = process.env.AUTHORIZATION_MODE || 'user';

// TABLE_MAP lets the App read a schema whose tables use different names, without
// creating views or any other object. Each entry becomes a CTE that is prepended
// to the statements that use it, so every query runs unchanged:
//   "store_sales": "fact_store_item_sales"          -> SELECT * FROM <catalog>.<schema>.fact_store_item_sales
//   "upc_sales": {"select": "SELECT ... FROM ..."}  -> a read-only SELECT over existing tables
const TABLE_MAP = parseTableMap(process.env.TABLE_MAP);
const PHYSICAL_TO_LOGICAL = Object.fromEntries(
  Object.entries(TABLE_MAP).filter(([, target]) => target.table).map(([name, target]) => [target.table, name])
);

function parseTableMap(raw) {
  if (!raw || !raw.trim()) return {};
  const map = {};
  for (const [name, target] of Object.entries(JSON.parse(raw))) {
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`TABLE_MAP key "${name}" is not a table name`);
    if (typeof target === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(target)) {
      map[name] = { table: target };
    } else if (target && typeof target.select === 'string'
               && /^\s*(SELECT|WITH)\b/i.test(target.select) && !target.select.includes(';')) {
      map[name] = { select: target.select.trim() };
    } else {
      throw new Error(`TABLE_MAP entry "${name}" must be a table name or {"select": "SELECT ..."}`);
    }
  }
  return map;
}

const quoteIdent = (value) => '`' + String(value).replace(/`/g, '``') + '`';
const mentions = (text, name) => new RegExp(`\\b${name}\\b`).test(text);

// Prepend a CTE for every mapped table the statement (or another included CTE) uses.
export function withTableMap(statement) {
  const used = new Set(Object.keys(TABLE_MAP).filter((name) => mentions(statement, name)));
  for (let grew = true; grew;) {
    grew = false;
    for (const name of [...used]) {
      const body = TABLE_MAP[name].select || '';
      for (const other of Object.keys(TABLE_MAP)) {
        if (!used.has(other) && mentions(body, other)) { used.add(other); grew = true; }
      }
    }
  }
  if (!used.size) return statement;
  // Renames first, so a SELECT entry may build on a renamed table.
  const ordered = [...used].sort((a, b) => Number(Boolean(TABLE_MAP[a].select)) - Number(Boolean(TABLE_MAP[b].select)));
  const ctes = ordered.map((name) => {
    const target = TABLE_MAP[name];
    const body = target.table
      ? `SELECT * FROM ${quoteIdent(CATALOG)}.${quoteIdent(SCHEMA)}.${quoteIdent(target.table)}`
      : target.select;
    return `${name} AS (${body})`;
  }).join(',\n  ');
  const leadingWith = /^\s*WITH\s+/i;
  return leadingWith.test(statement)
    ? statement.replace(leadingWith, `WITH ${ctes},\n  `)
    : `WITH ${ctes}\n${statement}`;
}

// The App's name for a table, given its name in the configured schema.
export function logicalTableName(name) {
  return PHYSICAL_TO_LOGICAL[name] || name;
}

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

// True when the current call runs as the signed-in viewer rather than the App.
export function runsAsViewer() {
  return AUTHORIZATION_MODE === 'user' && Boolean(requestAuthorization.getStore());
}

// Token for Databricks data calls (SQL and Genie) under AUTHORIZATION_MODE.
export async function dataToken() {
  if (AUTHORIZATION_MODE !== 'user' && AUTHORIZATION_MODE !== 'app') {
    throw new Error(`AUTHORIZATION_MODE must be "user" or "app", not "${AUTHORIZATION_MODE}"`);
  }
  if (!runsAsViewer()) return getToken();
  const userToken = requestAuthorization.getStore().userToken;
  if (!userToken) {
    throw new Error(
      'User authorization is not configured: the request has no x-forwarded-access-token. ' +
      'Add the sql and genie user scopes to the App, or set AUTHORIZATION_MODE to "app".'
    );
  }
  return userToken;
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
  statement = withTableMap(statement);
  // A shared cache could cross user authorization boundaries. Only cache
  // App-identity queries; viewer-driven queries always reach UC.
  const cacheKey = params.length || runsAsViewer() ? null : statement;
  if (cacheKey) {
    const hit = _qcache.get(cacheKey);
    if (hit && Date.now() - hit.at < QUERY_CACHE_TTL_MS) return hit.rows;
  }
  const token = await dataToken();
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
