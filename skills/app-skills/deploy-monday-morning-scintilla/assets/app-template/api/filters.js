// Global filter helper: vendor + date-range, threaded through every query.
// Query params (from the frontend global filter bar):
//   vendor = vendor_nbr (int) | 'all'
//   range  = 'wtd' | 'lw' | 'l4w' | 'l13w' | 'l52w'  (default l52w)
//   whatif = optional JSON: { salesLift: number(%), instockDelta: number(pp) } for simulations
//
// The retail feeds schema keys time two ways:
//   - daily fact tables use bus_dt (DATE)
//   - weekly fact tables use wm_yr_wk_nbr (INT, retail yr-week e.g. 202606)
// We derive both windows from the max bus_dt in store_sales.

import { runQuery } from './sql.js';

let _cal = null; // { maxDt, maxWk, ranges: {...} }

export async function calendar() {
  if (_cal) return _cal;
  const [r] = await runQuery(`
    SELECT MAX(bus_dt) AS max_dt,
           MAX(wm_yr_wk_nbr) AS max_wk
    FROM store_sales
  `);
  const maxDt = r.max_dt;
  const maxWk = Number(r.max_wk);
  _cal = { maxDt, maxWk };
  return _cal;
}

// Returns { dateClause(col), weekClause(col), label, startDt, weeks }
export async function resolveRange(range) {
  const { maxDt, maxWk } = await calendar();
  const R = (range || 'l52w').toLowerCase();
  // week counts back from the current week
  const weekSpan = { wtd: 1, lw: 1, l4w: 4, l13w: 13, l52w: 52 }[R] ?? 52;
  const dayBack = { wtd: 6, lw: 13, l4w: 27, l13w: 90, l52w: 364 }[R] ?? 364;
  // For "last week" we want the prior completed week, not WTD; approximate with day windows.
  const label = { wtd: 'Week to date', lw: 'Last week', l4w: 'Last 4 weeks', l13w: 'Last 13 weeks', l52w: 'Last 52 weeks' }[R] || 'Last 52 weeks';
  return {
    label,
    // daily fact filter
    dateClause: (col = 'bus_dt') => `${col} BETWEEN DATE_SUB(DATE'${maxDt}', ${dayBack}) AND DATE'${maxDt}'`,
    // weekly fact filter
    weekClause: (col = 'wm_yr_wk_nbr') => `${col} BETWEEN ${maxWk - (weekSpan - 1)} AND ${maxWk}`,
    maxDt, maxWk, weekSpan, dayBack,
  };
}

// Vendor predicate for a given column (default vendor_nbr). Returns '' if all.
export function vendorClause(vendor, col = 'vendor_nbr') {
  if (!vendor || vendor === 'all') return '';
  const v = parseInt(vendor, 10);
  if (Number.isNaN(v)) return '';
  return `AND ${col} = ${v}`;
}

// Category predicate on item_dim.omni_dept_desc (department is the top "category" the
// global filter exposes). Returns '' if all. Column must reference the item_dim alias.
export function categoryClause(category, col = 'i.omni_dept_desc') {
  if (!category || category === 'all') return '';
  const safe = String(category).replace(/'/g, "''");
  return `AND ${col} = '${safe}'`;
}

// Vendor predicate for tables that have wm_item_nbr but NO vendor_nbr column
// (e.g. ecom_returns). Filters via item_dim subquery. Returns '' if all.
export function vendorItemClause(vendor, itemCol = 'wm_item_nbr') {
  if (!vendor || vendor === 'all') return '';
  const v = parseInt(vendor, 10);
  if (Number.isNaN(v)) return '';
  return `AND ${itemCol} IN (SELECT wm_item_nbr FROM item_dim WHERE vendor_nbr = ${v})`;
}

// Category predicate for tables that only have wm_item_nbr (no item_dim join),
// via a subquery. itemCol is the wm_item_nbr column on the outer table.
export function categoryItemClause(category, itemCol = 'wm_item_nbr') {
  if (!category || category === 'all') return '';
  const safe = String(category).replace(/'/g, "''");
  return `AND ${itemCol} IN (SELECT wm_item_nbr FROM item_dim WHERE omni_dept_desc = '${safe}')`;
}

// Parse the standard filter params off a request.
export function parseFilters(req) {
  return {
    vendor: (req.query.vendor || 'all').toString(),
    category: (req.query.category || 'all').toString(),
    store: (req.query.store || 'all').toString(),
    range: (req.query.range || 'l52w').toString(),
    whatif: (() => {
      try { return req.query.whatif ? JSON.parse(req.query.whatif) : null; }
      catch { return null; }
    })(),
  };
}

// Apply what-if multipliers to a numeric value (server-side, transparent).
export function applyWhatIf(value, whatif, kind) {
  if (value == null || !whatif) return value;
  if (kind === 'sales' && whatif.salesLift) return value * (1 + whatif.salesLift / 100);
  return value;
}
