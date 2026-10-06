// Thin fetch wrapper + a useApi hook with caching, filter-aware.

import { useEffect, useState } from 'react';
import { useFilters } from './filters.jsx';

const cache = new Map();

const CACHE_TTL = 10 * 60_000; // 10 min — analytics over historical data is stable within a session
export async function fetchJson(path) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.t < CACHE_TTL) return hit.v;
  const r = await fetch(path);
  if (!r.ok) {
    throw new Error(`${path} → ${r.status}: ${await r.text()}`);
  }
  const v = await r.json();
  cache.set(path, { t: Date.now(), v });
  return v;
}

// Append the global filter query string to an /api path.
function withFilters(path, qs) {
  if (!qs) return path;
  return path + (path.includes('?') ? '&' : '?') + qs;
}

// The heavy endpoints behind each tab. When the global filter changes we warm
// these in the background so switching tabs is instant (data already cached).
const PREFETCH_PATHS = [
  '/api/dashboard/kpis', '/api/dashboard/channel-mix', '/api/dashboard/monthly-trend',
  '/api/dashboard/sales-by-category', '/api/dashboard/top-movers', '/api/dashboard/underperformers',
  '/api/inventory/flow', '/api/inventory/days-of-supply',
  '/api/forecast/overview',
  '/api/category/competitive', '/api/category/brand-velocity', '/api/supply/otif',
  '/api/ecom/overview',
];

// Warm the cache for the current filter set. Fire-and-forget, low priority,
// failures ignored (each page still fetches on demand as a fallback).
export function prefetchTabs(qs) {
  for (const p of PREFETCH_PATHS) {
    const full = withFilters(p, qs);
    if (cache.has(full) && Date.now() - cache.get(full).t < CACHE_TTL) continue;
    fetchJson(full).catch(() => {});
  }
}

// Filter-aware data hook. Pass { raw: true } to opt out of global filters.
// path may be null/undefined to skip fetching (conditional queries).
export function useApi(path, opts = {}) {
  const { queryString } = useFilters();
  const fullPath = path == null ? null : (opts.raw ? path : withFilters(path, queryString));
  const [state, setState] = useState({ data: null, error: null, loading: path != null });
  useEffect(() => {
    let live = true;
    if (fullPath == null) { setState({ data: null, error: null, loading: false }); return; }
    setState({ data: null, error: null, loading: true });
    fetchJson(fullPath)
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((error) => live && setState({ data: null, error, loading: false }));
    return () => { live = false; };
  }, [fullPath]);
  return state;
}

// Whole-number formatting only — NO decimals anywhere in the app.
export function fmtCurrency(n, opts = {}) {
  if (n == null) return '—';
  if (Math.abs(n) >= 1_000_000_000) return `$${Math.round(n / 1_000_000_000)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${Math.round(n / 1_000_000)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

export function fmtNumber(n) {
  if (n == null) return '—';
  if (Math.abs(n) >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}K`;
  return Math.round(n).toLocaleString();
}

export function fmtPct(n, opts = {}) {
  if (n == null) return '—';
  const sign = opts.sign && n > 0 ? '+' : '';
  return `${sign}${Math.round(n)}%`;
}

// Exec-level formatting for raw Genie result cells: currency → $K/$M/$B,
// percents, thousands separators, trimmed decimals. IDs / years / week numbers
// stay as plain integers so they don't turn into "$5K" or "5.3K".
export function fmtGenieCell(col, v) {
  if (v == null || v === '') return '—';
  const s = String(v).trim();
  if (!/^-?\d*\.?\d+$/.test(s)) return s; // non-numeric (labels, dates) as-is
  const n = Number(s);
  if (!isFinite(n)) return s;
  const name = String(col).toLowerCase();
  if (/(pct|percent|rate|share|growth|margin|ratio)/.test(name) || name.includes('%'))
    return `${Math.round(n * 10) / 10}%`;
  if (/(yr|year|wk|week|qtr|quarter|month|nbr|number|upc|zip|sku|store_nbr|item)/.test(name) || /\bid\b/.test(name))
    return Number.isInteger(n) ? s : String(n); // identifiers — no formatting
  if (/(sales|amt|amount|revenue|gmv|dollar|\$|cost|price|aur|spend|net|gross)/.test(name))
    return fmtCurrency(n);
  if (Math.abs(n) >= 1000) return fmtNumber(n); // large counts (units, qty)
  return (Math.round(n * 100) / 100).toLocaleString(); // small numbers, trim decimals
}
