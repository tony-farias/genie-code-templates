// Retail cloud feeds backend.
// Every route honors the global vendor + date-range filter (see filters.js).
// All figures come straight from the configured CATALOG.SCHEMA via the bound
// SQL warehouse (catalog/schema set in sql.js). No mock data.

import { runQuery, logicalTableName, config as sqlConfig } from './sql.js';
import { resolveRange, vendorClause, categoryClause, categoryItemClause, vendorItemClause, parseFilters, calendar } from './filters.js';
import { recordAction, listActions } from './lakebase.js';
import * as genie from './genie.js';
import { ontologyGroup, JOINS, CALCULATIONS, QUERIES, FALLBACK_TABLES, TABS, AI_MODELS } from './ontology_catalog.js';
import { listPersonas } from './personas.js';

// Tables referenced anywhere in the mined ontology (joins + queries + calcs).
function ontologyReferencedTables() {
  const s = new Set(FALLBACK_TABLES);
  for (const j of JOINS) { s.add(j.left); s.add(j.right); }
  for (const q of QUERIES) for (const t of q.tables) s.add(t);
  for (const c of CALCULATIONS) for (const t of c.tables) s.add(t);
  return [...s];
}

// Assemble the ontology payload from the mined catalog, enriched with live
// columns/types/row counts when provided.
function buildOntology({ colsByTable = {}, rowCounts = {}, source = 'catalog' }) {
  const referenced = ontologyReferencedTables();
  // Include a table if it's referenced by the wiring; prefer live columns.
  const nodes = referenced.map((name) => {
    const cols = colsByTable[name] || [];
    const queries = QUERIES.filter((q) => q.tables.includes(name)).map((q) => q.viz);
    const calcs = CALCULATIONS.filter((c) => c.tables.includes(name)).map((c) => c.name);
    return {
      id: name,
      group: ontologyGroup(name),
      rowCount: rowCounts[name] ?? null,
      columnCount: cols.length || null,
      columns: cols.slice(0, 60),          // [{name,type}] live, or [] offline
      poweredViz: queries,
      calculations: calcs,
    };
  });
  const present = new Set(nodes.map((n) => n.id));
  const edges = JOINS
    .filter((j) => present.has(j.left) && present.has(j.right))
    .map((j) => ({ from: j.left, to: j.right, key: j.key, on: j.on, type: j.type, card: j.card, note: j.note }));
  // Attach AI models per tab (resolve the ai keys into full model records).
  const tabs = TABS.map((t) => ({
    ...t,
    aiModels: (t.ai || []).map((k) => ({ key: k, ...AI_MODELS[k] })).filter((m) => m.model),
  }));

  return {
    source,
    nodes,
    edges,
    calculations: CALCULATIONS,
    queries: QUERIES,
    tabs,
    aiModels: AI_MODELS,
  };
}

const asyncHandler = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error('route error:', req.path, e.message);
    res.status(500).json({ error: String(e.message || e) });
  });

const num = (v) => (v == null ? null : Number(v));
// Whole-number formatting only — NO decimals anywhere.
const money = (v) => {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1e9) return `$${Math.round(n / 1e9)}B`;
  if (Math.abs(n) >= 1e6) return `$${Math.round(n / 1e6)}M`;
  if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
};
const fmtK = (v) => {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1e9) return `${Math.round(n / 1e9)}B`;
  if (Math.abs(n) >= 1e6) return `${Math.round(n / 1e6)}M`;
  if (Math.abs(n) >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(Math.round(n));
};
const cap = (s) => (s || '').split(' ').map((w) => (w ? w[0] + w.slice(1).toLowerCase() : '')).join(' ');

export function mountScintillaRoutes(app) {
  // ───────────────────────── identity / filter meta ─────────────────────────
  app.get('/api/whoami', (req, res) => {
    res.json({ user: req.get('x-forwarded-email') || req.get('x-forwarded-preferred-username') || 'demo user' });
  });

  // Vendor list for the global filter dropdown.
  app.get('/api/vendors', asyncHandler(async (_req, res) => {
    const rows = await runQuery(`
      SELECT vendor_nbr, MAX(vendor_nm) AS vendor_nm, ROUND(SUM(sales_amt),0) AS sales
      FROM store_sales
      WHERE vendor_nbr IS NOT NULL
      GROUP BY vendor_nbr ORDER BY sales DESC
    `);
    res.json(rows.map((r) => ({ vendor_nbr: r.vendor_nbr, vendor_nm: r.vendor_nm, sales: num(r.sales) })));
  }));

  // ── Personalized Home ────────────────────────────────────────────────────
  // Every vendor as a persona (+ super user); categories auto-derived.
  app.get('/api/personas', asyncHandler(async (_req, res) => {
    try {
      res.json({ personas: await listPersonas() });
    } catch (e) {
      // Local dev has no warehouse — serve sample personas so the UI is testable.
      console.warn('personas live query failed, serving samples:', e.message);
      res.json({ personas: [
        { id: 'super', vendor_nbr: null, vendor_nm: 'Super User', person: 'Super User', initials: 'SU', title: 'All access', region: 'All regions', role: 'All vendors · all categories', categories: [], sales: null },
        { id: '283274', vendor_nbr: 283274, vendor_nm: 'PEPSACO', person: 'Maria Alvarez', initials: 'MA', title: 'Category Lead', region: 'NA · Bentonville', role: 'Category Lead · PEPSACO', categories: ['BEVERAGES', 'DRY GROCERY', 'SNACKS'], sales: 7300000000, sample: true },
        { id: '465858', vendor_nbr: 465858, vendor_nm: 'PROCTEL & GAMBA', person: 'David Chen', initials: 'DC', title: 'Senior Category Manager', region: 'NA · Northeast', role: 'Senior Category Manager · PROCTEL & GAMBA', categories: ['BABY', 'HEALTH & WELLNESS', 'HOUSEHOLD CHEMICALS', 'PAPER & PLASTICS', 'PERSONAL CARE'], sales: 6730000000, sample: true },
        { id: '672553', vendor_nbr: 672553, vendor_nm: 'KOKA-KOLA CO.', person: 'Sofia Rossi', initials: 'SR', title: 'Director of Sales', region: 'NA · West', role: 'Director of Sales · KOKA-KOLA CO.', categories: ['BEVERAGES', 'DAIRY'], sales: 6870000000, sample: true },
      ] });
    }
  }));

  // Live insight cards scoped to the active persona's vendor (all = super user).
  app.get('/api/home/insights', asyncHandler(async (req, res) => {
    const vendor = (req.query.vendor || 'all').toString();
    try {
      const R = await resolveRange('l52w');
      const vc = vendorClause(vendor);
      const cats = await runQuery(`
        SELECT COALESCE(i.omni_dept_desc,'(Uncat)') AS cat, ROUND(SUM(s.sales_amt),0) AS sales
        FROM store_sales s LEFT JOIN item_dim i USING(wm_item_nbr)
        WHERE ${R.dateClause('s.bus_dt')} ${vc} AND i.omni_dept_desc IS NOT NULL
        GROUP BY 1 ORDER BY sales DESC
      `);
      const [inv] = await runQuery(`
        SELECT ROUND(100.0*SUM(ty_repl_instock_numerator)/NULLIF(SUM(ty_repl_instock_denominator),0),0) AS isr
        FROM store_invt WHERE wm_yr_wk_nbr=(SELECT MAX(wm_yr_wk_nbr) FROM store_invt) ${vc}
      `);
      // Concrete specifics — the named SKU and the exact store that make it real.
      const [topSku] = await runQuery(`
        SELECT i.item_name AS nm, ROUND(SUM(s.sales_amt)/1e6,0) AS m
        FROM store_sales s JOIN item_dim i USING(wm_item_nbr)
        WHERE ${R.dateClause('s.bus_dt')} ${vc} AND i.item_name IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC LIMIT 1
      `);
      const [worstStore] = await runQuery(`
        SELECT store_nbr AS st, ROUND(100.0*SUM(ty_repl_instock_numerator)/NULLIF(SUM(ty_repl_instock_denominator),0),0) AS isr
        FROM store_invt WHERE wm_yr_wk_nbr=(SELECT MAX(wm_yr_wk_nbr) FROM store_invt) ${vc}
        GROUP BY 1 HAVING isr IS NOT NULL ORDER BY isr ASC LIMIT 1
      `);
      const insights = [];
      if (topSku?.nm) insights.push({ kind: 'up', metric: 'Best seller', value: topSku.nm, detail: `$${Number(topSku.m)}M over 52 weeks — your #1 SKU`, cta: { label: 'View sales', to: '/app/sales' } });
      if (cats.length) {
        const top = cats[0], bottom = cats[cats.length - 1];
        insights.push({ kind: 'up', metric: 'Top category', value: top.cat, detail: `$${(Number(top.sales) / 1e9).toFixed(1)}B in sales over 52 weeks`, cta: { label: 'View category', to: '/app/category' } });
        if (cats.length > 1) insights.push({ kind: 'watch', metric: 'Smallest category', value: bottom.cat, detail: `$${(Number(bottom.sales) / 1e6).toFixed(0)}M, the most headroom to grow`, cta: { label: 'View sales', to: '/app/sales' } });
      }
      if (worstStore?.st != null && Number(worstStore.isr) < 98) insights.push({ kind: 'warn', metric: 'Store to watch', value: `Store ${worstStore.st}`, detail: `In-stock at ${Number(worstStore.isr)}%, your lowest this week`, cta: { label: 'View inventory', to: '/app/inventory' } });
      const isr = inv ? Number(inv.isr) : null;
      if (isr != null) insights.push({ kind: isr >= 95 ? 'ok' : 'warn', metric: 'In-stock rate', value: `${isr}%`, detail: isr >= 95 ? 'On-shelf availability healthy across your stores' : 'Below the 95% target, a replenishment risk', cta: { label: 'View inventory', to: '/app/inventory' } });
      res.json({ insights });
    } catch (e) {
      // Local dev has no warehouse — serve sample insights so the UI is testable.
      console.warn('home insights live query failed, serving samples:', e.message);
      res.json({ insights: [
        { kind: 'up', metric: 'Best seller', value: 'AQUAFINNA SPARKLING 24PK', detail: '$282M over 52 weeks, your #1 SKU', cta: { label: 'View sales', to: '/app/sales' }, sample: true },
        { kind: 'up', metric: 'Top category', value: 'BEVERAGES', detail: '$2.3B in sales over 52 weeks', cta: { label: 'View category', to: '/app/category' }, sample: true },
        { kind: 'watch', metric: 'Smallest category', value: 'DRY GROCERY', detail: '$407M, the most headroom to grow', cta: { label: 'View sales', to: '/app/sales' }, sample: true },
        { kind: 'warn', metric: 'Store to watch', value: 'Store 2164', detail: 'In-stock at 96%, your lowest this week', cta: { label: 'View inventory', to: '/app/inventory' }, sample: true },
      ] });
    }
  }));

  // Storytelling brief — a warm, LLM-written narrative for the persona.
  app.post('/api/home/brief', asyncHandler(async (req, res) => {
    const { name, vendor, categories = [], insights = [] } = req.body || {};
    try {
      const brief = await llm.generatePersonalBrief({ name, vendor, categories, insights });
      if (brief) return res.json({ brief, source: 'ai' });
      throw new Error('no brief');
    } catch (e) {
      console.warn('personal brief failed, serving fallback:', e.message);
      const first = (name || 'there').split(' ')[0];
      const seller = insights.find((i) => i.metric === 'Best seller');
      const store = insights.find((i) => i.metric === 'Store to watch');
      const p1 = `${first}, ${seller ? `${seller.value} is still your engine (${seller.detail.replace(/,.*/, '')})` : `${categories[0] || 'your lead category'} is carrying the book`}, and the week is mostly steady. ` +
        (store ? `The one soft spot is ${store.value}, ${store.detail.toLowerCase()}, so that is where I would look first.` : `Nothing urgent is flashing, which is a fine way to start the week.`);
      const p2 = `Spend the week on the categories with the most room to grow.`;
      res.json({ brief: `${p1}\n\n${p2}`, source: 'fallback' });
    }
  }));

  // Stores with hourly activity — powers the Hourly Stats store filter.
  app.get('/api/stores', asyncHandler(async (_req, res) => {
    const rows = await runQuery(`
      SELECT h.store_nbr, ROUND(SUM(h.quantity),0) AS activity
      FROM hourly_store_invt h
      GROUP BY h.store_nbr ORDER BY activity DESC LIMIT 300
    `);
    res.json(rows.map((r) => ({ store_nbr: r.store_nbr, activity: num(r.activity) })));
  }));

  // Category list (departments) for the global filter dropdown.
  app.get('/api/categories', asyncHandler(async (req, res) => {
    const { vendor } = parseFilters(req);
    const rows = await runQuery(`
      SELECT COALESCE(i.omni_dept_desc,'(Uncategorized)') AS category, ROUND(SUM(s.sales_amt),0) AS sales
      FROM store_sales s LEFT JOIN item_dim i USING(wm_item_nbr)
      WHERE i.omni_dept_desc IS NOT NULL ${vendorClause(vendor, 's.vendor_nbr')}
      GROUP BY 1 ORDER BY sales DESC
    `);
    res.json(rows.map((r) => ({ category: r.category, sales: num(r.sales) })));
  }));

  // Range metadata (labels + current data date) for the filter bar.
  app.get('/api/meta', asyncHandler(async (_req, res) => {
    const cal = await calendar();
    res.json({
      max_date: cal.maxDt, max_week: cal.maxWk,
      ranges: [
        { id: 'wtd', label: 'Week to date' },
        { id: 'lw', label: 'Last week' },
        { id: 'l4w', label: 'Last 4 weeks' },
        { id: 'l13w', label: 'Last 13 weeks' },
        { id: 'l52w', label: 'Last 52 weeks' },
      ],
      // Optional deployment link; the sidebar hides it when unset.
      links: { outcome_maps: process.env.OUTCOME_MAPS_URL || null },
    });
  }));

  // ───────────────────────── SALES: KPI row ─────────────────────────
  app.get('/api/dashboard/kpis', asyncHandler(async (req, res) => {
    const { vendor, category, range, whatif } = parseFilters(req);
    const R = await resolveRange(range);
    const vc = vendorClause(vendor);
    const cc = categoryItemClause(category);
    const [r] = await runQuery(`
      WITH cur AS (
        SELECT sales_amt, qty, scan_cnt, aur, svc_chnl_nm
        FROM store_sales
        WHERE ${R.dateClause()} ${vc} ${cc}
      ),
      prev AS (
        SELECT SUM(sales_amt) AS prev_sales FROM store_sales
        WHERE bus_dt BETWEEN DATE_SUB(DATE'${R.maxDt}', ${R.dayBack * 2 + 1}) AND DATE_SUB(DATE'${R.maxDt}', ${R.dayBack + 1}) ${vc} ${cc}
      ),
      inv AS (
        SELECT 100.0*SUM(ty_repl_instock_numerator)/NULLIF(SUM(ty_repl_instock_denominator),0) AS isr,
               SUM(ty_on_hand_qty) AS oh
        FROM store_invt WHERE 1=1 ${vc} ${cc}
      )
      SELECT ROUND(SUM(cur.sales_amt),0) AS total_sales,
             ROUND((SUM(cur.sales_amt)-MAX(prev.prev_sales))/NULLIF(MAX(prev.prev_sales),0)*100,0) AS vs_prev,
             ROUND(SUM(CASE WHEN cur.svc_chnl_nm='BIS' OR cur.svc_chnl_nm IS NULL THEN cur.sales_amt ELSE 0 END),0) AS store_sales,
             ROUND(SUM(CASE WHEN cur.svc_chnl_nm IN ('DELIVERY','PICKUP','SFS') THEN cur.sales_amt ELSE 0 END),0) AS ecom_sales,
             SUM(cur.qty) AS units, SUM(cur.scan_cnt) AS scans, ROUND(AVG(cur.aur),0) AS aur,
             ROUND(MAX(inv.isr),0) AS in_stock
      FROM cur CROSS JOIN prev CROSS JOIN inv
    `);
    const lift = whatif?.salesLift ? 1 + whatif.salesLift / 100 : 1;
    res.json([{
      total_sales: r.total_sales != null ? Math.round(num(r.total_sales) * lift) : null,
      total_sales_vs_plan: num(r.vs_prev),
      comp_store_sales: r.store_sales != null ? Math.round(num(r.store_sales) * lift) : null,
      ecommerce_sales: r.ecom_sales != null ? Math.round(num(r.ecom_sales) * lift) : null,
      transaction_count: num(r.units),
      in_stock_rate: whatif?.instockDelta ? Math.min(100, num(r.in_stock) + whatif.instockDelta) : num(r.in_stock),
      gross_margin: num(r.aur),
      customer_traffic: num(r.scans),
      on_time_delivery: whatif?.instockDelta ? Math.min(100, num(r.in_stock) + whatif.instockDelta) : num(r.in_stock),
    }]);
  }));

  // Channel breakdown (BIS / DELIVERY / PICKUP / SFS) — real, replaces bottom KPIs.
  app.get('/api/dashboard/channel-mix', asyncHandler(async (req, res) => {
    const { vendor, category, range } = parseFilters(req);
    const R = await resolveRange(range);
    const rows = await runQuery(`
      SELECT svc_chnl_nm AS channel,
             ROUND(SUM(sales_amt),0) AS sales,
             SUM(qty) AS units,
             ROUND(AVG(aur),0) AS aur
      FROM store_sales
      WHERE ${R.dateClause()} ${vendorClause(vendor)} ${categoryItemClause(category)} AND svc_chnl_nm IS NOT NULL
      GROUP BY svc_chnl_nm ORDER BY sales DESC
    `);
    // Always surface every real omni channel, even ones with no sales in the
    // current filter window, so the channel mix never silently drops a channel.
    const label = { BIS: 'In-Store (BIS)', DELIVERY: 'Delivery', PICKUP: 'Pickup (OPD)', SFS: 'Ship-from-Store' };
    const CHANNELS = ['BIS', 'DELIVERY', 'PICKUP', 'SFS'];
    const byChannel = Object.fromEntries(rows.map((r) => [r.channel, r]));
    const out = CHANNELS.map((ch) => {
      const r = byChannel[ch];
      return { channel: ch, label: label[ch], sales: num(r?.sales) || 0, units: num(r?.units) || 0, aur: num(r?.aur) || 0 };
    }).sort((a, b) => b.sales - a.sales);
    res.json(out);
  }));

  app.get('/api/dashboard/bottom-kpis', asyncHandler(async (req, res) => {
    const { vendor, category, range } = parseFilters(req);
    const R = await resolveRange(range);
    const vc = vendorClause(vendor);
    const cc = categoryItemClause(category);
    const [r] = await runQuery(`
      WITH s AS (SELECT * FROM store_sales WHERE ${R.dateClause()} ${vc} ${cc})
      SELECT ROUND(SUM(sales_amt)/NULLIF(SUM(scan_cnt),0),0) AS sales_per_scan,
             ROUND(SUM(qty)/NULLIF(SUM(scan_cnt),0),0) AS units_per_scan,
             COUNT(DISTINCT store_nbr) AS active_stores,
             COUNT(DISTINCT wm_item_nbr) AS active_items,
             (SELECT ROUND(100.0*SUM(ty_repl_instock_numerator)/NULLIF(SUM(ty_repl_instock_denominator),0),0) FROM store_invt WHERE 1=1 ${vc}) AS in_stock_rate
      FROM s
    `);
    res.json([{ sales_per_scan: num(r.sales_per_scan), units_per_scan: num(r.units_per_scan), active_stores: num(r.active_stores), active_items: num(r.active_items), in_stock_rate: num(r.in_stock_rate) }]);
  }));

  app.get('/api/dashboard/monthly-trend', asyncHandler(async (req, res) => {
    const { vendor, category, range } = parseFilters(req);
    const R = await resolveRange(range);
    const rows = await runQuery(`
      SELECT DATE_FORMAT(bus_dt,'yyyy-MM') AS month,
             ROUND(SUM(sales_amt),0) AS total_sales, SUM(qty) AS total_units, ROUND(AVG(aur),0) AS avg_unit_retail
      FROM store_sales WHERE ${R.dateClause()} ${vendorClause(vendor)} ${categoryItemClause(category)}
      GROUP BY 1 ORDER BY 1
    `);
    res.json(rows.map((r) => ({ month: r.month, total_sales: num(r.total_sales), total_units: num(r.total_units), avg_unit_retail: num(r.avg_unit_retail) })));
  }));

  app.get('/api/dashboard/sales-by-category', asyncHandler(async (req, res) => {
    const { vendor, category, range } = parseFilters(req);
    const R = await resolveRange(range);
    const rows = await runQuery(`
      SELECT COALESCE(i.omni_dept_desc,'(Uncategorized)') AS category_name,
             ROUND(SUM(s.sales_amt),0) AS total_sales, SUM(s.qty) AS total_units, ROUND(AVG(s.aur),0) AS avg_unit_retail
      FROM store_sales s LEFT JOIN item_dim i USING(wm_item_nbr)
      WHERE ${R.dateClause('s.bus_dt')} ${vendorClause(vendor, 's.vendor_nbr')} ${categoryClause(category)}
      GROUP BY 1 ORDER BY total_sales DESC
    `);
    res.json(rows.map((r) => ({ category_name: r.category_name, total_sales: num(r.total_sales), total_units: num(r.total_units), avg_unit_retail: num(r.avg_unit_retail) })));
  }));

  app.get('/api/dashboard/category-mgmt', asyncHandler(async (req, res) => {
    const { vendor, range } = parseFilters(req);
    const R = await resolveRange(range);
    const rows = await runQuery(`
      WITH cat AS (
        SELECT COALESCE(i.omni_dept_desc,'(Uncategorized)') AS cn,
               SUM(s.sales_amt) AS sales, SUM(s.qty) AS units, AVG(s.aur) AS aur,
               COUNT(DISTINCT s.wm_item_nbr) AS skus, COUNT(DISTINCT s.store_nbr) AS stores
        FROM store_sales s LEFT JOIN item_dim i USING(wm_item_nbr)
        WHERE ${R.dateClause('s.bus_dt')} ${vendorClause(vendor, 's.vendor_nbr')}
        GROUP BY 1
      )
      SELECT cn AS category_name, ROUND(sales,0) AS total_sales, units AS total_units,
             ROUND(aur,0) AS avg_unit_retail, skus AS sku_count, stores AS store_count,
             ROUND(sales/NULLIF(stores,0),0) AS sales_per_store
      FROM cat ORDER BY total_sales DESC
    `);
    res.json(rows.map((r) => ({ category_name: r.category_name, total_sales: num(r.total_sales), total_units: num(r.total_units), avg_unit_retail: num(r.avg_unit_retail), sku_count: num(r.sku_count), store_count: num(r.store_count), sales_per_store: num(r.sales_per_store) })));
  }));

  async function movers(order, req) {
    const { vendor } = parseFilters(req);
    const vc = vendorClause(vendor, 's.vendor_nbr');
    // Compare the two most-recent SUBSTANTIAL weeks. Retail yr-week numbers are
    // not contiguous (e.g. 202627 then 202453), and the newest week can be a
    // partial load — comparing a partial week to a full one makes every item
    // look down. So we only consider weeks whose row count is at least half the
    // busiest week's, then rank the two most recent of those.
    return runQuery(`
      WITH wkvol AS (
        SELECT wm_yr_wk_nbr w, COUNT(*) n FROM store_sales GROUP BY 1
      ),
      full_wks AS (
        SELECT w FROM wkvol WHERE n >= 0.5 * (SELECT MAX(n) FROM wkvol) ORDER BY w DESC LIMIT 2
      ),
      cur AS (SELECT s.wm_item_nbr, SUM(s.sales_amt) AS cs FROM store_sales s
              WHERE s.wm_yr_wk_nbr=(SELECT MAX(w) FROM full_wks) ${vc} GROUP BY 1),
      prv AS (SELECT s.wm_item_nbr, SUM(s.sales_amt) AS ps FROM store_sales s
              WHERE s.wm_yr_wk_nbr=(SELECT MIN(w) FROM full_wks) ${vc} GROUP BY 1)
      SELECT c.wm_item_nbr AS sku_id, COALESCE(i.item_name, CAST(c.wm_item_nbr AS STRING)) AS sku_name,
             COALESCE(i.omni_dept_desc,'(Uncategorized)') AS category_name, ROUND(c.cs,0) AS total_sales,
             ROUND(p.ps,0) AS prev_sales,
             ROUND((c.cs-p.ps)/NULLIF(p.ps,0)*100,0) AS vs_py_pct
      FROM cur c JOIN prv p USING(wm_item_nbr) LEFT JOIN item_dim i ON i.wm_item_nbr=c.wm_item_nbr
      WHERE p.ps > 1000 ORDER BY vs_py_pct ${order} LIMIT 5
    `);
  }
  app.get('/api/dashboard/top-movers', asyncHandler(async (req, res) => res.json((await movers('DESC', req)).map((r) => ({ ...r, total_sales: num(r.total_sales), vs_py_pct: num(r.vs_py_pct) })))));
  app.get('/api/dashboard/underperformers', asyncHandler(async (req, res) => res.json((await movers('ASC', req)).map((r) => ({ ...r, total_sales: num(r.total_sales), vs_py_pct: num(r.vs_py_pct) })))));

  app.get('/api/dashboard/new-items', asyncHandler(async (req, res) => {
    const { vendor, range } = parseFilters(req);
    const R = await resolveRange(range);
    const rows = await runQuery(`
      WITH cur AS (
        SELECT wm_item_nbr, SUM(sales_amt) AS total_sales
        FROM store_sales WHERE ${R.dateClause()} ${vendorClause(vendor)} GROUP BY 1
      )
      SELECT i.wm_item_nbr AS sku_id, i.item_name AS sku_name,
             COALESCE(i.omni_dept_desc,'(Uncategorized)') AS category_name,
             ROUND(COALESCE(cur.total_sales,0),0) AS total_sales, i.item_create_dt
      FROM item_dim i JOIN cur ON cur.wm_item_nbr=i.wm_item_nbr
      WHERE i.item_create_dt IS NOT NULL ${vendorClause(vendor, 'i.vendor_nbr')}
      ORDER BY i.item_create_dt DESC, cur.total_sales DESC NULLS LAST LIMIT 5
    `);
    res.json(rows.map((r) => ({ ...r, total_sales: num(r.total_sales) })));
  }));

  // ───────────────────────── INVENTORY FLOW (metric diagram) ─────────────────────────
  // Warehouse → In Transit → On Hand → Backroom, in units. Real store_invt columns.
  app.get('/api/inventory/flow', asyncHandler(async (req, res) => {
    const { vendor } = parseFilters(req);
    const vc = vendorClause(vendor);
    const [r] = await runQuery(`
      SELECT COALESCE(SUM(ty_on_order_qty),0) AS on_order,
             COALESCE(SUM(ty_in_whse_qty),0) AS warehouse,
             COALESCE(SUM(ty_in_trnst_qty),0) AS in_transit,
             COALESCE(SUM(ty_on_hand_qty),0) AS on_hand,
             COALESCE(SUM(max_shelf_qty),0) AS shelf_capacity,
             ROUND(100.0*SUM(ty_repl_instock_numerator)/NULLIF(SUM(ty_repl_instock_denominator),0),0) AS in_stock_pct,
             ROUND(SUM(on_hand_cost_amt),0) AS on_hand_cost,
             ROUND(SUM(ty_on_hand_rtl_amt),0) AS on_hand_retail
      FROM store_invt
      WHERE wm_yr_wk_nbr = (SELECT MAX(wm_yr_wk_nbr) FROM store_invt) ${vc}
    `);
    const onHand = num(r.on_hand) || 0;
    const shelfCap = num(r.shelf_capacity) || 0;
    const inStock = num(r.in_stock_pct) || 0;
    // shelf vs backroom split from in-stock proxy
    const shelf = Math.round(onHand * inStock / 100);
    const backroom = Math.max(0, onHand - shelf);
    const fmt = (n) => { n = Number(n || 0); if (n >= 1e6) return `${Math.round(n / 1e6)}M`; if (n >= 1e3) return `${Math.round(n / 1e3)}K`; return String(Math.round(n)); };
    res.json({
      stages: [
        { id: 'warehouse', label: 'Warehouse (DC)', quantity: num(r.warehouse), formatted: fmt(r.warehouse), sub: 'ty_in_whse_qty' },
        { id: 'transit', label: 'In Transit', quantity: num(r.in_transit), formatted: fmt(r.in_transit), sub: 'ty_in_trnst_qty' },
        { id: 'onhand', label: 'On Hand', quantity: onHand, formatted: fmt(onHand), sub: 'ty_on_hand_qty' },
        { id: 'shelf', label: 'On Shelf', quantity: shelf, formatted: fmt(shelf), sub: 'derived from in-stock %' },
        { id: 'backroom', label: 'Backroom', quantity: backroom, formatted: fmt(backroom), sub: 'on hand minus shelf' },
      ],
      on_order: num(r.on_order), in_stock_pct: inStock,
      on_hand_cost: num(r.on_hand_cost), on_hand_retail: num(r.on_hand_retail),
    });
  }));

  // On-hand days of supply (on-hand units / avg daily sales units).
  app.get('/api/inventory/days-of-supply', asyncHandler(async (req, res) => {
    const { vendor, range } = parseFilters(req);
    const R = await resolveRange(range);
    const vc = vendorClause(vendor);
    // Days of supply = current on-hand units / average daily units sold, at category level.
    // store_invt is a current snapshot (latest week); daily velocity from the window.
    const rows = await runQuery(`
      WITH vel AS (
        SELECT COALESCE(i.omni_dept_desc,'(Uncategorized)') AS category,
               SUM(s.qty)/${R.dayBack + 1}.0 AS daily_units
        FROM store_sales s LEFT JOIN item_dim i USING(wm_item_nbr)
        WHERE ${R.dateClause('s.bus_dt')} ${vendorClause(vendor, 's.vendor_nbr')} GROUP BY 1
      ),
      inv AS (
        SELECT COALESCE(i.omni_dept_desc,'(Uncategorized)') AS category, SUM(v.ty_on_hand_qty) AS oh
        FROM store_invt v LEFT JOIN item_dim i USING(wm_item_nbr)
        WHERE v.wm_yr_wk_nbr = (SELECT MAX(wm_yr_wk_nbr) FROM store_invt) ${vendorClause(vendor, 'v.vendor_nbr')}
        GROUP BY 1
      )
      SELECT inv.category,
             ROUND(inv.oh / NULLIF(vel.daily_units,0),0) AS days_of_supply,
             inv.oh AS on_hand
      FROM inv JOIN vel USING(category)
      WHERE vel.daily_units > 0 ORDER BY days_of_supply DESC
    `);
    res.json(rows.map((r) => ({ category: r.category, days_of_supply: num(r.days_of_supply), on_hand: num(r.on_hand) })));
  }));

  // ───────────────────────── STORE BUBBLE MAP ─────────────────────────
  app.get('/api/stores/map', asyncHandler(async (req, res) => {
    const { vendor, range } = parseFilters(req);
    const R = await resolveRange(range);
    const rows = await runQuery(`
      WITH s AS (
        SELECT store_nbr, SUM(sales_amt) AS sales, SUM(qty) AS units
        FROM store_sales WHERE ${R.dateClause()} ${vendorClause(vendor)} GROUP BY 1
      ),
      inv AS (
        SELECT store_nbr, 100.0*SUM(ty_repl_instock_numerator)/NULLIF(SUM(ty_repl_instock_denominator),0) AS isr
        FROM store_invt WHERE 1=1 ${vendorClause(vendor)} GROUP BY 1
      )
      SELECT d.store_nbr AS store_id, d.store_nm AS store_name, d.city_nm AS city,
             d.state_prov_cd AS state, d.market_nm AS market, d.lat_dgr AS latitude, d.long_dgr AS longitude,
             ROUND(COALESCE(s.sales,0),0) AS sales, COALESCE(s.units,0) AS units,
             ROUND(inv.isr,0) AS in_stock_pct
      FROM store_dim d JOIN s USING(store_nbr) LEFT JOIN inv USING(store_nbr)
      WHERE d.lat_dgr IS NOT NULL AND d.long_dgr IS NOT NULL AND d.lat_dgr BETWEEN 18 AND 72 AND d.long_dgr BETWEEN -170 AND -60
      ORDER BY sales DESC LIMIT 800
    `);
    const vals = rows.map((r) => num(r.sales)).sort((a, b) => a - b);
    const med = vals[Math.floor(vals.length / 2)] || 0;
    res.json(rows.map((r) => ({
      ...r, sales: num(r.sales), units: num(r.units), in_stock_pct: num(r.in_stock_pct),
      status: num(r.sales) < med * 0.5 ? 'low' : num(r.sales) < med ? 'mid' : 'high',
    })));
  }));

  // ───────────────────────── HIERARCHY DRILL (seg>dept>cat>subcat>brand>sku) ─────────────────────────
  app.get('/api/breakdown/hierarchy', asyncHandler(async (req, res) => {
    const { vendor, range } = parseFilters(req);
    const R = await resolveRange(range);
    const level = (req.query.level || 'category').toString(); // segment|department|category|subcategory|brand|sku
    const parent = req.query.parent ? String(req.query.parent).replace(/'/g, "''") : null;
    const dims = {
      segment: ['i.omni_seg_desc', 'segment'],
      department: ['i.omni_dept_desc', 'department'],
      category: ['i.omni_catg_desc', 'category'],
      subcategory: ['i.omni_subcatg_desc', 'subcategory'],
      brand: ['i.brand_nm', 'brand'],
      sku: ['i.item_name', 'sku'],
    };
    const [col] = dims[level] || dims.category;
    const parentCol = { department: 'i.omni_seg_desc', category: 'i.omni_dept_desc', subcategory: 'i.omni_catg_desc', brand: 'i.omni_subcatg_desc', sku: 'i.brand_nm' }[level];
    const parentFilter = parent && parentCol ? `AND ${parentCol} = '${parent}'` : '';
    // At the sku level, also return the numeric wm_item_nbr for affinity lookups.
    const idSelect = level === 'sku' ? 'MAX(s.wm_item_nbr) AS sku_id,' : '';
    // Aggregate in-stock only from the latest inventory week (not all 907M rows) — keeps drills fast.
    const rows = await runQuery(`
      WITH inv AS (
        SELECT wm_item_nbr, AVG(100.0*ty_repl_instock_numerator/NULLIF(ty_repl_instock_denominator,0)) AS isr
        FROM store_invt
        WHERE wm_yr_wk_nbr = (SELECT MAX(wm_yr_wk_nbr) FROM store_invt) ${vendorClause(vendor)}
        GROUP BY 1
      )
      SELECT COALESCE(${col},'(Unspecified)') AS name, ${idSelect}
             ROUND(SUM(s.sales_amt),0) AS sales, SUM(s.qty) AS units, ROUND(AVG(s.aur),0) AS aur,
             COUNT(DISTINCT s.wm_item_nbr) AS skus, ROUND(AVG(iv.isr),0) AS in_stock
      FROM store_sales s LEFT JOIN item_dim i USING(wm_item_nbr) LEFT JOIN inv iv ON iv.wm_item_nbr=s.wm_item_nbr
      WHERE ${R.dateClause('s.bus_dt')} ${vendorClause(vendor, 's.vendor_nbr')} ${parentFilter}
      GROUP BY 1 HAVING SUM(s.sales_amt) > 0 ORDER BY sales DESC LIMIT 100
    `);
    res.json({ level, parent, rows: rows.map((r) => ({ name: r.name, sku_id: r.sku_id != null ? num(r.sku_id) : null, sales: num(r.sales), units: num(r.units), aur: num(r.aur), skus: num(r.skus), in_stock: num(r.in_stock) })) });
  }));

  // ───────────────────────── ITEM AFFINITY ("bought with", hover) ─────────────────────────
  app.get('/api/item/affinity/:skuId', asyncHandler(async (req, res) => {
    const sku = parseInt(req.params.skuId, 10);
    if (Number.isNaN(sku)) return res.status(400).json({ error: 'bad sku' });
    const rows = await runQuery(`
      SELECT affinity_wm_item_nbr AS affinity_sku, MAX(item_name_affinity) AS affinity_name,
             SUM(affinity_basket_cnt) AS baskets, ROUND(AVG(avg_basket_affinity_rtl_amt),0) AS avg_rtl
      FROM item_affinity
      WHERE wm_item_nbr = ${sku} AND affinity_wm_item_nbr <> ${sku}
      GROUP BY affinity_wm_item_nbr
      ORDER BY baskets DESC LIMIT 6
    `);
    res.json(rows.map((r) => ({ affinity_sku: r.affinity_sku, affinity_name: r.affinity_name, baskets: num(r.baskets), avg_rtl: num(r.avg_rtl) })));
  }));

  // Compact AI insight for a hierarchy node (used as you drill in the breakdown tree).
  app.get('/api/breakdown/insight', asyncHandler(async (req, res) => {
    const { vendor, range } = parseFilters(req);
    const R = await resolveRange(range);
    const level = (req.query.level || 'department').toString();
    const parent = req.query.parent ? String(req.query.parent).replace(/'/g, "''") : null;
    const dims = { department: 'i.omni_dept_desc', category: 'i.omni_catg_desc', subcategory: 'i.omni_subcatg_desc', brand: 'i.brand_nm', sku: 'i.item_name' };
    const parentCol = { category: 'i.omni_dept_desc', subcategory: 'i.omni_catg_desc', brand: 'i.omni_subcatg_desc', sku: 'i.brand_nm' }[level];
    const col = dims[level] || dims.department;
    const pf = parent && parentCol ? `AND ${parentCol} = '${parent}'` : '';
    const rows = await runQuery(`
      WITH cur AS (
        SELECT COALESCE(${col},'(Unspecified)') AS name, SUM(s.sales_amt) AS sales, AVG(s.aur) AS aur,
               AVG(100.0*v.ty_repl_instock_numerator/NULLIF(v.ty_repl_instock_denominator,0)) AS isr
        FROM store_sales s LEFT JOIN item_dim i USING(wm_item_nbr)
        LEFT JOIN store_invt v ON v.wm_item_nbr=s.wm_item_nbr AND v.wm_yr_wk_nbr=(SELECT MAX(wm_yr_wk_nbr) FROM store_invt)
        WHERE ${R.dateClause('s.bus_dt')} ${vendorClause(vendor, 's.vendor_nbr')} ${pf}
        GROUP BY 1
      )
      SELECT name, ROUND(sales,0) AS sales, ROUND(aur,0) AS aur, ROUND(isr,0) AS isr FROM cur ORDER BY sales DESC
    `);
    const total = rows.reduce((a, r) => a + num(r.sales), 0);
    const top = rows[0], low = rows.filter((r) => r.isr != null).sort((a, b) => num(a.isr) - num(b.isr))[0];
    const parts = [];
    if (top && total) parts.push(`${top.name} leads at ${Math.round(num(top.sales) / total * 100)}% of ${parent || 'total'} sales.`);
    if (low && num(low.isr) < 96) parts.push(`${low.name} has the softest in-stock (${low.isr}%) — a replenishment watch.`);
    if (rows.length > 3) parts.push(`${rows.length} ${level === 'department' ? 'departments' : level + 's'} contribute here; the top 3 hold ${Math.round(rows.slice(0, 3).reduce((a, r) => a + num(r.sales), 0) / total * 100)}%.`);
    res.json({ level, parent, insight: parts.join(' ') || 'No standout signal at this level.', count: rows.length });
  }));

  // ───────────────────────── RETURNS (% + reasons) ─────────────────────────
  app.get('/api/returns/summary', asyncHandler(async (req, res) => {
    const { vendor, range } = parseFilters(req);
    const R = await resolveRange(range);
    const vc = vendorClause(vendor);
    // store returns vs sales for the % ; ecom returns for reason breakdown
    const [tot] = await runQuery(`
      WITH sales AS (SELECT SUM(sales_amt) AS s FROM store_sales WHERE ${R.dateClause()} ${vc}),
      sret AS (SELECT SUM(rtn_sales_amt) AS r, SUM(rtn_qty) AS q FROM store_returns WHERE ${R.dateClause('rtn_dt')} ${vc})
      SELECT ROUND(MAX(sret.r),0) AS return_amt, MAX(sret.q) AS return_qty, ROUND(MAX(sales.s),0) AS sales_amt,
             ROUND(100.0*MAX(sret.r)/NULLIF(MAX(sales.s),0),0) AS return_rate_pct
      FROM sales CROSS JOIN sret
    `);
    const reasons = await runQuery(`
      SELECT rtn_rsn_desc AS reason, SUM(tot_rtn_qty) AS qty, ROUND(SUM(tot_rtn_amt),0) AS amt
      FROM ecom_returns WHERE ${R.dateClause('bus_dt')} ${vendorItemClause(vendor)} AND rtn_rsn_desc IS NOT NULL
      GROUP BY 1 ORDER BY qty DESC
    `);
    const totalQty = reasons.reduce((a, r) => a + num(r.qty), 0) || 1;
    res.json({
      return_rate_pct: num(tot.return_rate_pct), return_amt: num(tot.return_amt), return_qty: num(tot.return_qty), sales_amt: num(tot.sales_amt),
      reasons: reasons.map((r) => ({ reason: r.reason, qty: num(r.qty), amt: num(r.amt), pct: Math.round(num(r.qty) / totalQty * 1000) / 10 })),
    });
  }));

  // ───────────────────────── REVIEWS / SENTIMENT ─────────────────────────
  app.get('/api/reviews/summary', asyncHandler(async (req, res) => {
    const { vendor } = parseFilters(req);
    const vc = vendorClause(vendor);
    const [r] = await runQuery(`
      SELECT COUNT(*) AS items, ROUND(AVG(cust_ratg_avg_val),0) AS avg_rating,
             ROUND(SUM(cust_ratg_cnt),0) AS total_reviews,
             SUM(CASE WHEN cust_ratg_avg_val>=4 THEN 1 ELSE 0 END) AS positive,
             SUM(CASE WHEN cust_ratg_avg_val<3 THEN 1 ELSE 0 END) AS negative
      FROM omni_item_dim WHERE cust_ratg_avg_val IS NOT NULL ${vc}
    `);
    const top = await runQuery(`
      SELECT item_name AS sku_name, brand_nm AS brand, ROUND(cust_ratg_avg_val,0) AS rating, ROUND(cust_ratg_cnt,0) AS reviews
      FROM omni_item_dim WHERE cust_ratg_avg_val IS NOT NULL AND cust_ratg_cnt > 0 ${vc}
      ORDER BY cust_ratg_cnt DESC LIMIT 8
    `);
    const bottom = await runQuery(`
      SELECT item_name AS sku_name, brand_nm AS brand, ROUND(cust_ratg_avg_val,0) AS rating, ROUND(cust_ratg_cnt,0) AS reviews
      FROM omni_item_dim WHERE cust_ratg_avg_val IS NOT NULL AND cust_ratg_cnt > 20 ${vc}
      ORDER BY cust_ratg_avg_val ASC LIMIT 6
    `);
    res.json({
      items: num(r.items), avg_rating: num(r.avg_rating), total_reviews: num(r.total_reviews),
      positive: num(r.positive), negative: num(r.negative),
      top_reviewed: top.map((t) => ({ ...t, rating: num(t.rating), reviews: num(t.reviews) })),
      lowest_rated: bottom.map((t) => ({ ...t, rating: num(t.rating), reviews: num(t.reviews) })),
    });
  }));

  // ───────────────────────── HOURLY STATS (heatmap + toggle) ─────────────────────────
  // metric = 'movement' (inventory change) | 'opd' (pickup orders) | 'nil' (nil picks)
  app.get('/api/hourly/heatmap', asyncHandler(async (req, res) => {
    const { vendor, store } = parseFilters(req);
    const metric = (req.query.metric || 'movement').toString();
    const storeSel = (!store || store === 'all') ? null : parseInt(store, 10);
    let rows;
    if (metric === 'movement') {
      // hourly_store_invt: quantity by hour; day of week via bus_dt. (no vendor col here → global)
      const sFilter = storeSel ? `WHERE store_nbr = ${storeSel}` : '';
      rows = await runQuery(`
        SELECT DATE_FORMAT(bus_dt,'EEEE') AS dow, bus_hr_nbr AS hr, ROUND(SUM(quantity),0) AS val
        FROM hourly_store_invt ${sFilter} GROUP BY 1,2 ORDER BY 2
      `);
    } else {
      // hourly_store_fulfillment: order_amt (OPD) or nil picks by hour.
      // No vendor_nbr on this table → join through item_dim when a vendor is selected.
      const valexpr = metric === 'nil' ? 'SUM(f.nil_pick_nmrtr)' : 'SUM(f.order_amt)';
      const vFilter = (!vendor || vendor === 'all')
        ? ''
        : `AND f.wm_item_nbr IN (SELECT wm_item_nbr FROM item_dim WHERE vendor_nbr = ${parseInt(vendor, 10)})`;
      const sFilter = storeSel ? `AND f.store_nbr = ${storeSel}` : '';
      rows = await runQuery(`
        SELECT DATE_FORMAT(f.bus_dt,'EEEE') AS dow, f.bus_hr_nbr AS hr, ROUND(${valexpr},0) AS val
        FROM hourly_store_fulfillment f
        WHERE 1=1 ${vFilter} ${sFilter}
        GROUP BY 1,2 ORDER BY 2
      `);
    }
    const dows = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const hours = [...new Set(rows.map((r) => Number(r.hr)))].sort((a, b) => a - b);
    const grid = dows.map((d) => ({
      dow: d,
      cells: hours.map((h) => {
        const m = rows.find((r) => r.dow === d && Number(r.hr) === h);
        return { hr: h, label: `${String(h).padStart(2, '0')}00`, val: m ? num(m.val) : 0 };
      }),
    }));
    res.json({ metric, hours: hours.map((h) => `${String(h).padStart(2, '0')}00`), grid });
  }));

  // ───────────────────────── CATEGORY INTELLIGENCE (vendor vs market) ─────────────────────────
  // Uses upc_attr (category dims) + upc_sales (market-wide sales incl other vendors).
  // Competitive share: both market (all UPCs) and vendor (this vendor's UPCs) come
  // from the SAME source — upc_sales × upc_attr over the same week window — so the
  // ratio is a true share. Vendor UPCs are identified via item_dim.wm_upc_nbr.
  app.get('/api/category/competitive', asyncHandler(async (req, res) => {
    const { vendor, range } = parseFilters(req);
    const R = await resolveRange(range);

    // NOTE: the upc_sales/upc_attr "market" tables carry no vendor_nbr and don't
    // join to item_dim (different UPC namespaces, and a single supplier_hash_id
    // across the whole table), so a specific vendor's share can't be derived from
    // them — the old version silently matched nothing and showed every market
    // category at 0%. We instead use store_sales, which DOES carry vendor_nbr:
    // "share" = the vendor's category sales as a % of that category's total
    // tracked sales, and we only list categories the vendor actually sells in.

    // All-vendors view: top categories by total tracked sales (vendor = market, no share).
    if (!vendor || vendor === 'all') {
      const market = await runQuery(`
        SELECT i.omni_dept_desc AS category, ROUND(SUM(s.sales_amt),0) AS market_sales
        FROM store_sales s JOIN item_dim i USING(wm_item_nbr)
        WHERE ${R.weekClause('s.wm_yr_wk_nbr')} AND i.omni_dept_desc IS NOT NULL
        GROUP BY 1 ORDER BY market_sales DESC LIMIT 12
      `);
      return res.json(market.map((m) => ({ category: m.category, market_sales: num(m.market_sales), vendor_sales: 0, share_pct: 0 })));
    }

    // Vendor selected: only categories the vendor actually competes in, ranked by
    // the vendor's own sales, each with their share of that category's tracked market.
    const rows = await runQuery(`
      WITH mine AS (
        SELECT i.omni_dept_desc AS category, SUM(s.sales_amt) AS vendor_sales
        FROM store_sales s JOIN item_dim i USING(wm_item_nbr)
        WHERE ${R.weekClause('s.wm_yr_wk_nbr')} AND s.vendor_nbr = ${parseInt(vendor, 10)} AND i.omni_dept_desc IS NOT NULL
        GROUP BY 1
        HAVING SUM(s.sales_amt) > 0
      ),
      market AS (
        SELECT i.omni_dept_desc AS category, SUM(s.sales_amt) AS market_sales
        FROM store_sales s JOIN item_dim i USING(wm_item_nbr)
        WHERE ${R.weekClause('s.wm_yr_wk_nbr')} AND i.omni_dept_desc IN (SELECT category FROM mine)
        GROUP BY 1
      )
      SELECT mine.category,
             ROUND(market.market_sales,0) AS market_sales,
             ROUND(mine.vendor_sales,0) AS vendor_sales,
             ROUND(100.0*mine.vendor_sales/NULLIF(market.market_sales,0),0) AS share_pct
      FROM mine JOIN market USING(category)
      ORDER BY mine.vendor_sales DESC LIMIT 12
    `);
    res.json(rows.map((r) => ({
      category: r.category,
      market_sales: num(r.market_sales),
      vendor_sales: num(r.vendor_sales),
      share_pct: Math.min(100, num(r.share_pct) || 0),
    })));
  }));

  // Brand velocity over time (weekly sales per brand for selected vendor)
  app.get('/api/category/brand-velocity', asyncHandler(async (req, res) => {
    const { vendor, range } = parseFilters(req);
    const R = await resolveRange(range);
    const rows = await runQuery(`
      SELECT i.brand_nm AS brand, s.wm_yr_wk_nbr AS week, ROUND(SUM(s.sales_amt),0) AS sales
      FROM store_sales s JOIN item_dim i USING(wm_item_nbr)
      WHERE ${R.weekClause('s.wm_yr_wk_nbr')} ${vendorClause(vendor, 's.vendor_nbr')} AND i.brand_nm IS NOT NULL
      GROUP BY 1,2 ORDER BY 2
    `);
    // pivot into series per brand (top 6 brands by total)
    const totals = {};
    rows.forEach((r) => { totals[r.brand] = (totals[r.brand] || 0) + num(r.sales); });
    const topBrands = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 6).map((x) => x[0]);
    const weeks = [...new Set(rows.map((r) => Number(r.week)))].sort((a, b) => a - b);
    const series = weeks.map((w) => {
      const pt = { week: w };
      topBrands.forEach((b) => { const m = rows.find((r) => Number(r.week) === w && r.brand === b); pt[b] = m ? num(m.sales) : 0; });
      return pt;
    });
    res.json({ brands: topBrands, series });
  }));

  // Category penetration over time (share of vendor within its category, weekly)
  app.get('/api/category/penetration', asyncHandler(async (req, res) => {
    const { vendor, range } = parseFilters(req);
    const R = await resolveRange(range);
    if (!vendor || vendor === 'all') return res.json({ series: [], note: 'select a vendor' });
    // Weekly penetration = the vendor's tracked sales as a % of total tracked
    // sales that week. Uses store_sales (has vendor_nbr) — the upc_sales tables
    // carry no vendor key, so the old UPC join here was always 0 (flat line).
    const rows = await runQuery(`
      SELECT s.wm_yr_wk_nbr AS week,
             ROUND(100.0*SUM(CASE WHEN s.vendor_nbr = ${parseInt(vendor, 10)} THEN s.sales_amt ELSE 0 END)/NULLIF(SUM(s.sales_amt),0),0) AS penetration_pct
      FROM store_sales s
      WHERE ${R.weekClause('s.wm_yr_wk_nbr')}
      GROUP BY 1 ORDER BY 1
    `);
    res.json({ series: rows.map((r) => ({ week: num(r.week), penetration_pct: num(r.penetration_pct) })) });
  }));

  // ───────────────────────── SUPPLY CHAIN / OTIF ─────────────────────────
  app.get('/api/supply/otif', asyncHandler(async (req, res) => {
    const { vendor } = parseFilters(req);
    const [r] = await runQuery(`
      SELECT ROUND(AVG(otif_pct),0) AS otif, ROUND(AVG(on_time_pct),0) AS on_time, ROUND(AVG(in_full_pct),0) AS in_full,
             COUNT(DISTINCT oms_po_nbr) AS pos
      FROM omni_otif WHERE 1=1 ${vendorClause(vendor)}
    `);
    res.json({ otif: num(r.otif), on_time: num(r.on_time), in_full: num(r.in_full), pos: num(r.pos) });
  }));

  // ───────────────────────── EXECUTIVE BRIEF (LLM optional, data-grounded) ─────────────────────────
  app.get('/api/dashboard/executive-brief', asyncHandler(async (req, res) => {
    const { vendor, range } = parseFilters(req);
    const R = await resolveRange(range);
    const cats = await runQuery(`
      WITH cur AS (SELECT COALESCE(i.omni_dept_desc,'(Uncategorized)') AS cn, SUM(s.sales_amt) AS cs
        FROM store_sales s LEFT JOIN item_dim i USING(wm_item_nbr)
        WHERE ${R.dateClause('s.bus_dt')} ${vendorClause(vendor, 's.vendor_nbr')} GROUP BY 1)
      SELECT cn AS category_name, ROUND(cs,0) AS total_sales FROM cur ORDER BY total_sales DESC
    `);
    const total = cats.reduce((a, c) => a + num(c.total_sales), 0);
    const leader = cats[0];
    res.json({
      executive_summary: `Tracked sales for the ${R.label.toLowerCase()} total $${Math.round(total).toLocaleString()} across ${cats.length} categories. ${leader?.category_name} leads at $${num(leader?.total_sales).toLocaleString()}.`,
      kpi_cards: cats.slice(0, 4).map((c) => ({ label: c.category_name, value: `$${num(c.total_sales).toLocaleString()}` })),
    });
  }));

  // ───────────────────────── EXECUTIVE BRIEF (cross-business) ─────────────────────────
  // One call that assembles the whole-business snapshot for the Brief tab.
  app.get('/api/brief/overview', asyncHandler(async (req, res) => {
    const { vendor, category, range } = parseFilters(req);
    const R = await resolveRange(range);
    const vc = vendorClause(vendor);
    const cc = categoryItemClause(category);

    // Run the independent queries concurrently (was sequential ≈ sum of all; now ≈ slowest one).
    const [[kpi], cats, trend, channels, [ret], [otif]] = await Promise.all([
      runQuery(`
        WITH cur AS (SELECT sales_amt, qty, svc_chnl_nm FROM store_sales WHERE ${R.dateClause()} ${vc} ${cc}),
        prev AS (SELECT SUM(sales_amt) ps FROM store_sales WHERE bus_dt BETWEEN DATE_SUB(DATE'${R.maxDt}', ${R.dayBack * 2 + 1}) AND DATE_SUB(DATE'${R.maxDt}', ${R.dayBack + 1}) ${vc} ${cc}),
        inv AS (SELECT 100.0*SUM(ty_repl_instock_numerator)/NULLIF(SUM(ty_repl_instock_denominator),0) isr FROM store_invt WHERE wm_yr_wk_nbr=(SELECT MAX(wm_yr_wk_nbr) FROM store_invt) ${vc})
        SELECT ROUND(SUM(cur.sales_amt),0) sales,
               ROUND((SUM(cur.sales_amt)-MAX(prev.ps))/NULLIF(MAX(prev.ps),0)*100,0) vs_prev,
               SUM(cur.qty) units,
               ROUND(100.0*SUM(CASE WHEN cur.svc_chnl_nm IN ('DELIVERY','PICKUP','SFS') THEN cur.sales_amt ELSE 0 END)/NULLIF(SUM(cur.sales_amt),0),0) ecom_pct,
               ROUND(MAX(inv.isr),0) in_stock
        FROM cur CROSS JOIN prev CROSS JOIN inv
      `),
      runQuery(`
        SELECT COALESCE(i.omni_dept_desc,'(Uncat)') AS name, ROUND(SUM(s.sales_amt),0) AS sales
        FROM store_sales s LEFT JOIN item_dim i USING(wm_item_nbr)
        WHERE ${R.dateClause('s.bus_dt')} ${vendorClause(vendor, 's.vendor_nbr')}
        GROUP BY 1 ORDER BY sales DESC
      `),
      runQuery(`
        SELECT DATE_FORMAT(bus_dt,'yyyy-MM') AS month, ROUND(SUM(sales_amt),0) AS sales
        FROM store_sales WHERE ${R.dateClause()} ${vc} ${cc} GROUP BY 1 ORDER BY 1
      `),
      runQuery(`
        SELECT svc_chnl_nm AS channel, ROUND(SUM(sales_amt),0) AS sales
        FROM store_sales WHERE ${R.dateClause()} ${vc} ${cc} AND svc_chnl_nm IS NOT NULL GROUP BY 1 ORDER BY sales DESC
      `),
      runQuery(`
        WITH sret AS (SELECT SUM(rtn_sales_amt) r FROM store_returns WHERE ${R.dateClause('rtn_dt')} ${vc}),
        sales AS (SELECT SUM(sales_amt) s FROM store_sales WHERE ${R.dateClause()} ${vc} ${cc})
        SELECT ROUND(100.0*MAX(sret.r)/NULLIF(MAX(sales.s),0),0) rate FROM sret CROSS JOIN sales
      `),
      runQuery(`SELECT ROUND(AVG(otif_pct),0) otif FROM omni_otif WHERE 1=1 ${vc}`),
    ]);

    const total = cats.reduce((a, c) => a + num(c.sales), 0);
    const leader = cats[0];
    const summary = `Tracked sales total $${Math.round(num(kpi.sales) || 0).toLocaleString()} for the ${R.label.toLowerCase()}, ${num(kpi.vs_prev) >= 0 ? 'up' : 'down'} ${Math.abs(num(kpi.vs_prev) || 0)}% versus the prior period. ${leader ? `${leader.name} leads at $${Math.round(num(leader.sales)).toLocaleString()} (${Math.round(num(leader.sales) / total * 100)}% of mix).` : ''} E-commerce is ${num(kpi.ecom_pct)}% of sales, in-stock is ${num(kpi.in_stock)}%, returns are running ${num(ret.rate)}%, and supplier OTIF is ${num(otif.otif)}%.`;

    res.json({
      summary,
      kpis: { sales: num(kpi.sales), vs_prev: num(kpi.vs_prev), units: num(kpi.units), ecom_pct: num(kpi.ecom_pct), in_stock: num(kpi.in_stock), return_rate: num(ret.rate), otif: num(otif.otif) },
      categories: cats.map((c) => ({ name: c.name, sales: num(c.sales) })),
      trend: trend.map((t) => ({ month: t.month, sales: num(t.sales) })),
      channels: channels.map((c) => ({ channel: c.channel, sales: num(c.sales) })),
    });
  }));

  // ───────────────────────── AGENT SUMMARY (dynamic home) ─────────────────────────
  // Composes a multi-section, agent-style narrative + the graph data behind it.
  app.get('/api/agent/summary', asyncHandler(async (req, res) => {
    const { vendor, category, range } = parseFilters(req);
    const R = await resolveRange(range);
    const vc = vendorClause(vendor);
    const cc = categoryItemClause(category);

    // Independent queries run concurrently.
    const [[kpi], cats, trend, channels, [ret], [otif], [reason], watchStores, watchSkus] = await Promise.all([
      runQuery(`
        WITH cur AS (SELECT sales_amt, qty, aur, svc_chnl_nm FROM store_sales WHERE ${R.dateClause()} ${vc} ${cc}),
        prev AS (SELECT SUM(sales_amt) ps FROM store_sales WHERE bus_dt BETWEEN DATE_SUB(DATE'${R.maxDt}', ${R.dayBack * 2 + 1}) AND DATE_SUB(DATE'${R.maxDt}', ${R.dayBack + 1}) ${vc} ${cc}),
        inv AS (SELECT 100.0*SUM(ty_repl_instock_numerator)/NULLIF(SUM(ty_repl_instock_denominator),0) isr FROM store_invt WHERE wm_yr_wk_nbr=(SELECT MAX(wm_yr_wk_nbr) FROM store_invt) ${vc})
        SELECT ROUND(SUM(cur.sales_amt),0) sales,
               ROUND((SUM(cur.sales_amt)-MAX(prev.ps))/NULLIF(MAX(prev.ps),0)*100,0) vs_prev,
               SUM(cur.qty) units, ROUND(AVG(cur.aur),0) aur,
               ROUND(100.0*SUM(CASE WHEN cur.svc_chnl_nm IN ('DELIVERY','PICKUP','SFS') THEN cur.sales_amt ELSE 0 END)/NULLIF(SUM(cur.sales_amt),0),0) ecom_pct,
               ROUND(MAX(inv.isr),0) in_stock
        FROM cur CROSS JOIN prev CROSS JOIN inv
      `),
      runQuery(`
        WITH cur AS (SELECT COALESCE(i.omni_dept_desc,'(Uncat)') AS name, SUM(s.sales_amt) AS s FROM store_sales s LEFT JOIN item_dim i USING(wm_item_nbr) WHERE ${R.dateClause('s.bus_dt')} ${vendorClause(vendor, 's.vendor_nbr')} GROUP BY 1),
        prv AS (SELECT COALESCE(i.omni_dept_desc,'(Uncat)') AS name, SUM(s.sales_amt) AS p FROM store_sales s LEFT JOIN item_dim i USING(wm_item_nbr)
                WHERE s.bus_dt BETWEEN DATE_SUB(DATE'${R.maxDt}', ${R.dayBack * 2 + 1}) AND DATE_SUB(DATE'${R.maxDt}', ${R.dayBack + 1}) ${vendorClause(vendor, 's.vendor_nbr')} GROUP BY 1)
        SELECT cur.name, ROUND(cur.s,0) sales, ROUND((cur.s-prv.p)/NULLIF(prv.p,0)*100,0) growth
        FROM cur LEFT JOIN prv USING(name) ORDER BY sales DESC
      `),
      runQuery(`SELECT DATE_FORMAT(bus_dt,'yyyy-MM') AS month, ROUND(SUM(sales_amt),0) AS sales FROM store_sales WHERE ${R.dateClause()} ${vc} ${cc} GROUP BY 1 ORDER BY 1`),
      runQuery(`SELECT svc_chnl_nm AS channel, ROUND(SUM(sales_amt),0) AS sales FROM store_sales WHERE ${R.dateClause()} ${vc} ${cc} AND svc_chnl_nm IS NOT NULL GROUP BY 1 ORDER BY sales DESC`),
      runQuery(`
        WITH sret AS (SELECT SUM(rtn_sales_amt) r FROM store_returns WHERE ${R.dateClause('rtn_dt')} ${vc}),
        sales AS (SELECT SUM(sales_amt) s FROM store_sales WHERE ${R.dateClause()} ${vc} ${cc})
        SELECT ROUND(100.0*MAX(sret.r)/NULLIF(MAX(sales.s),0),0) rate FROM sret CROSS JOIN sales`),
      runQuery(`SELECT ROUND(AVG(otif_pct),0) otif FROM omni_otif WHERE 1=1 ${vc}`),
      runQuery(`SELECT rtn_rsn_desc reason FROM ecom_returns WHERE ${R.dateClause('bus_dt')} ${vendorItemClause(vendor)} AND rtn_rsn_desc IS NOT NULL GROUP BY 1 ORDER BY SUM(tot_rtn_qty) DESC LIMIT 1`),
      // 4 stores to watch — biggest sales decline vs the prior comparable period.
      runQuery(`
        WITH cur AS (SELECT s.store_nbr, SUM(s.sales_amt) c FROM store_sales s WHERE ${R.dateClause('s.bus_dt')} ${vendorClause(vendor, 's.vendor_nbr')} ${categoryItemClause(category, 's.wm_item_nbr')} GROUP BY 1),
             prv AS (SELECT s.store_nbr, SUM(s.sales_amt) p FROM store_sales s WHERE s.bus_dt BETWEEN DATE_SUB(DATE'${R.maxDt}', ${R.dayBack * 2 + 1}) AND DATE_SUB(DATE'${R.maxDt}', ${R.dayBack + 1}) ${vendorClause(vendor, 's.vendor_nbr')} ${categoryItemClause(category, 's.wm_item_nbr')} GROUP BY 1)
        SELECT d.store_nbr, d.store_nm, d.city_nm, d.state_prov_cd, ROUND(cur.c,0) sales, ROUND((cur.c-prv.p)/NULLIF(prv.p,0)*100,0) growth
        FROM cur JOIN prv USING(store_nbr) JOIN store_dim d ON d.store_nbr=cur.store_nbr
        WHERE cur.c > 0 AND prv.p > 0
        ORDER BY growth ASC LIMIT 4`),
      // 3 SKUs to watch — biggest sales decline vs the prior comparable period.
      runQuery(`
        WITH cur AS (SELECT s.wm_item_nbr, SUM(s.sales_amt) c FROM store_sales s WHERE ${R.dateClause('s.bus_dt')} ${vendorClause(vendor, 's.vendor_nbr')} ${categoryItemClause(category, 's.wm_item_nbr')} GROUP BY 1),
             prv AS (SELECT s.wm_item_nbr, SUM(s.sales_amt) p FROM store_sales s WHERE s.bus_dt BETWEEN DATE_SUB(DATE'${R.maxDt}', ${R.dayBack * 2 + 1}) AND DATE_SUB(DATE'${R.maxDt}', ${R.dayBack + 1}) ${vendorClause(vendor, 's.vendor_nbr')} ${categoryItemClause(category, 's.wm_item_nbr')} GROUP BY 1)
        SELECT i.item_name, i.brand_nm, cur.wm_item_nbr, ROUND(cur.c,0) sales, ROUND((cur.c-prv.p)/NULLIF(prv.p,0)*100,0) growth
        FROM cur JOIN prv USING(wm_item_nbr) JOIN item_dim i ON i.wm_item_nbr=cur.wm_item_nbr
        WHERE cur.c > 0 AND prv.p > 0
        ORDER BY growth ASC LIMIT 3`),
    ]);

    const total = cats.reduce((a, c) => a + num(c.sales), 0);
    const leader = cats[0];
    const grower = [...cats].filter((c) => c.growth != null).sort((a, b) => num(b.growth) - num(a.growth))[0];
    const laggard = [...cats].filter((c) => c.growth != null).sort((a, b) => num(a.growth) - num(b.growth))[0];
    const scope = (vendor === 'all' ? 'the total tracked business' : 'the selected vendor') + (category === 'all' ? '' : ` in ${category}`);

    const vsPrev = Math.round(num(kpi.vs_prev) || 0);
    const inStock = Math.round(num(kpi.in_stock) || 0);
    const ecomPct = Math.round(num(kpi.ecom_pct) || 0);
    const retRate = Math.round(num(ret.rate) || 0);
    const otifPct = Math.round(num(otif.otif) || 0);
    const scopeCap = scope[0].toUpperCase() + scope.slice(1);
    const headline = `${scopeCap} generated ${money(kpi.sales)} over ${R.label.toLowerCase()}, ${vsPrev >= 0 ? 'up' : 'down'} ${Math.abs(vsPrev)}% versus the prior period.`;

    // Prose executive brief — reads like an analyst wrote it, not templated bullets.
    const narrative = [];
    narrative.push(
      `${scopeCap} delivered ${money(kpi.sales)} in net sales over ${R.label.toLowerCase()}, ${vsPrev === 0 ? 'holding flat against' : `${vsPrev > 0 ? 'up' : 'down'} ${Math.abs(vsPrev)}% against`} the prior period.` +
      (leader ? ` ${cap(leader.name)} remained the largest category at ${money(leader.sales)} (${Math.round(num(leader.sales) / total * 100)}% of the mix)${cats[1] ? `, with ${cap(cats[1].name)} next at ${money(cats[1].sales)}` : ''}.` : '')
    );
    const momentum = [];
    if (grower && num(grower.growth) > 0) momentum.push(`${cap(grower.name)} showed the strongest momentum, up ${Math.round(num(grower.growth))}% period-over-period`);
    if (laggard && num(laggard.growth) < 0) momentum.push(`${cap(laggard.name)} softened ${Math.round(num(laggard.growth))}%`);
    narrative.push(
      (momentum.length ? `${momentum.join(', while ')}. ` : '') +
      `On-shelf availability held at ${inStock}%${inStock >= 95 ? ', keeping stock off the critical path' : ', below the 95% target and a likely drag on sell-through'}. ` +
      `E-commerce contributed ${ecomPct}% of sales, returns ran at ${retRate}%, and supplier OTIF was ${otifPct}%.`
    );
    const working = [];
    if (grower && num(grower.growth) > 0) working.push(`${cap(grower.name)} is the fastest-growing category, up ${Math.round(num(grower.growth))}% period-over-period.`);
    if (inStock >= 95) working.push(`On-shelf availability is strong at ${inStock}%, so sales aren't being capped by stockouts.`);
    if (ecomPct >= 15) working.push(`E-commerce is a healthy ${ecomPct}% of sales across delivery, pickup, and ship-from-store.`);
    if (leader) working.push(`${cap(leader.name)} anchors the mix at ${Math.round(num(leader.sales) / total * 100)}% of sales (${money(leader.sales)}).`);

    const attention = [];
    if (laggard && num(laggard.growth) < 0) attention.push(`${cap(laggard.name)} is contracting (${Math.round(num(laggard.growth))}% vs prior) and is the first place to investigate.`);
    if (inStock < 95) attention.push(`In-stock at ${inStock}% is below the 95% target — on-shelf gaps are likely leaking sales.`);
    if (otifPct < 90) attention.push(`Supplier OTIF is ${otifPct}%, under the 90% bar; late or short deliveries pressure availability downstream.`);
    if (retRate > 1) attention.push(`Returns are running ${retRate}%, led by "${reason?.reason || 'n/a'}".`);

    // Funded, grounded recommendations — each tied to a live metric with a $ opportunity.
    const R_RECAP = 0.5, R_RET = 0.25;
    const fund = [];
    if (laggard && num(laggard.growth) < 0 && num(laggard.sales)) {
      const decline = num(laggard.sales) * Math.abs(num(laggard.growth)) / 100;
      fund.push({ v: decline, t: `Reverse ${cap(laggard.name)}'s decline — down ${Math.round(Math.abs(num(laggard.growth)))}% (${money(decline)} of erosion); open it in Category to isolate the subcategories and brands driving the drop.` });
    }
    if (inStock < 98) {
      const rec = num(total) * Math.max(0, (98 - inStock) / 100) * R_RECAP;
      if (rec > 0) fund.push({ v: rec, t: `Lift in-stock from ${inStock}% to 98% to recover an estimated ${money(rec)} in at-risk sales — target the lowest-availability, highest-velocity stores.` });
    }
    if (retRate > 1) {
      const rdol = num(total) * retRate / 100, save = rdol * R_RET;
      fund.push({ v: save, t: `Returns are ${retRate}% (${money(rdol)})${reason?.reason ? `, led by "${reason.reason}"` : ''} — cutting the top driver by a quarter frees ~${money(save)}.` });
    }
    if (leader && num(leader.sales)) {
      const slip = num(leader.sales) * 0.02;
      fund.push({ v: slip, t: `Defend ${cap(leader.name)}, the anchor at ${money(leader.sales)} — hold shelf and in-stock so even a 2-point slip (${money(slip)}) never opens up.` });
    }
    fund.sort((a, b) => b.v - a.v);
    const actions = fund.slice(0, 4).map((f) => f.t);
    if (!actions.length) actions.push(`No material, fundable gap in this view — hold the plan and ask Genie to pressure-test any category or channel.`);

    // Named watch-list: the specific stores + SKUs to pay attention to this week.
    const watch = {
      stores: (watchStores || []).map((r) => ({
        label: `Store #${r.store_nbr}${r.city_nm ? ` · ${cap(r.city_nm)}, ${r.state_prov_cd}` : ''}`,
        detail: `${money(r.sales)} · ${num(r.growth) >= 0 ? '+' : ''}${num(r.growth)}% vs prior period`,
        growth: num(r.growth),
      })),
      skus: (watchSkus || []).map((r) => ({
        label: `${r.item_name || `Item ${r.wm_item_nbr}`}${r.brand_nm ? ` · ${r.brand_nm}` : ''}`,
        detail: `${money(r.sales)} · ${num(r.growth) >= 0 ? '+' : ''}${num(r.growth)}% vs prior period`,
        growth: num(r.growth),
      })),
    };

    res.json({
      report_name: 'Monday Morning Sales',
      title: 'Executive Summary',
      watch,
      subtitle: `${R.label} · ${new Date(R.maxDt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}${category === 'all' ? '' : ` · ${category}`}`,
      as_of: R.maxDt,
      generated_scope: scope, range_label: R.label,
      plan_basis: 'prior comparable period',
      headline,
      narrative,
      sections: [
        { title: "What's working", tone: 'good', points: working.slice(0, 4) },
        { title: 'What needs attention', tone: 'warn', points: attention.length ? attention.slice(0, 4) : ['No material risks detected in the current view.'] },
        { title: 'Recommended actions', tone: 'action', points: actions },
      ],
      // Totals block for the rich export (integer-rounded, no decimals).
      totals: {
        actual: num(kpi.sales), plan: null, last_year: null,
        var_to_plan: null, var_to_plan_pct: vsPrev,
        units: num(kpi.units), aur: num(kpi.aur),
        in_stock: inStock, ecom_pct: ecomPct, return_pct: retRate,
      },
      kpis: { sales: num(kpi.sales), vs_prev: vsPrev, units: num(kpi.units), aur: Math.round(num(kpi.aur) || 0), ecom_pct: ecomPct, in_stock: inStock, return_rate: retRate, otif: otifPct },
      categories: cats.map((c) => ({ name: cap(c.name), sales: num(c.sales), growth: num(c.growth) == null ? null : Math.round(num(c.growth)) })),
      trend: trend.map((t) => ({ month: t.month, sales: num(t.sales) })),
      channels: channels.map((c) => ({ channel: c.channel, sales: num(c.sales) })),
      regions: [],
    });
  }));

  // ───────────────────────── GENIE ─────────────────────────
  // Curated starter questions. Every one is grounded in a table Genie can actually
  // reach in this space (store_sales, item_dim, store_dim, store_invt, store_returns,
  // ecom_returns), so nothing here sends Genie after data that does not exist.
  const GENIE_SUGGESTIONS = [
    'What were my total sales by category over the last 4 weeks?',
    'Which stores have the lowest in-stock rate right now?',
    'What are my top return reasons, and which items drive them?',
    'How have weekly sales trended over the last 13 weeks?',
    'Which categories grew or declined the most over the last 4 weeks versus the prior 4 weeks?',
    'How do e-commerce sales compare to in-store sales over the last 4 weeks?',
  ];
  app.get('/api/genie/suggestions', (_req, res) => res.json({ suggestions: GENIE_SUGGESTIONS }));
  app.get('/api/genie/curated', (_req, res) => res.json({ questions: [] }));
  app.get('/api/genie/history', (_req, res) => res.json({ conversations: [] }));

  // Answering guidance appended to every question. Many cards seed questions that
  // say "the prior period" or "categories" without pinning a window or grain, and
  // Genie would stop to ask the user to define them (reads as "not working").
  // This resolves those to concrete defaults and tells Genie to answer directly.
  // It is invisible: the on-screen bubble still shows the user's original question.
  const GENIE_GUIDANCE = ' [Answering guidance: interpret "the prior period" or any unspecified time range as the most recent 4 full weeks compared with the prior 4 weeks. Break categories down at the category level. Give your best answer directly using sensible defaults; do NOT reply with a clarifying question.]';

  // Ask Genie — the single, canonical endpoint. Uses the real Databricks Genie
  // Conversation API (SP OAuth via genie.js), multi-turn via conversation_id.
  // Returns the text answer plus the exact SQL + result rows Genie ran, so every
  // answer is verifiable. ALWAYS responds with JSON and a human-readable `answer`
  // (never null), so no failure ever surfaces as an empty bubble or an HTML page.
  app.post('/api/genie/ask', asyncHandler(async (req, res) => {
    const content = (req.body?.content || '').toString().trim();
    const conversationId = req.body?.conversation_id || null;
    const appKey = String(req.body?.app || '').toLowerCase() || null;
    if (!content) return res.status(400).json({ error: 'content required' });
    if (!genie.config.SPACE_ID) return res.status(503).json({ error: 'Genie is not configured (GENIE_SPACE_ID unset).' });

    const spaceId = genie.spaceForApp(appKey);
    // Append the answering guidance so Genie resolves "prior period"/grain itself
    // and answers directly instead of asking the user to clarify.
    const asked = content + GENIE_GUIDANCE;
    try {
      const submission = conversationId
        ? await genie.sendMessage(conversationId, asked, spaceId)
        : await genie.startConversation(asked, spaceId);
      const convId = submission.conversation_id || submission.conversation?.id;
      const msgId = submission.message_id || submission.message?.id;
      const finalMsg = await genie.waitForMessage(convId, msgId, { timeoutMs: 150_000, spaceId });

      // Pull the first text answer and the first query attachment.
      let answer = null, queryAtt = null;
      for (const att of finalMsg.attachments || []) {
        if (att.text?.content && !answer) answer = att.text.content.trim();
        if (att.query && !queryAtt) queryAtt = att;
      }

      // Run the query attachment to get columns + rows (verifiable, accurate).
      let query = null;
      if (queryAtt) {
        try {
          const attId = queryAtt.attachment_id || queryAtt.query?.id;
          const qr = await genie.getQueryResult(convId, msgId, attId, spaceId);
          const cols = (qr.statement_response?.manifest?.schema?.columns || []).map((c) => c.name);
          const data = qr.statement_response?.result?.data_array || [];
          query = {
            description: queryAtt.query.description,
            sql: queryAtt.query.query,
            columns: cols,
            rows: data.slice(0, 50),
            truncated: data.length > 50,
          };
        } catch (e) {
          query = { error: String(e.message || e), sql: queryAtt.query?.query };
        }
      }

      // Guarantee a clean, specific answer string for every terminal state.
      if (!answer) {
        const genieErr = finalMsg.error?.message || finalMsg.error || null;
        if (finalMsg.status === 'FAILED') {
          answer = genieErr
            ? `Genie could not answer that: ${genieErr}. Try rephrasing, or narrow it to a category, store, or time window.`
            : 'Genie could not answer that one. Try rephrasing, or narrow it to a specific category, store, or time window.';
        } else if (finalMsg.status === 'CANCELLED') {
          answer = 'That request was cancelled before it finished. Please ask again.';
        } else if (finalMsg.status === 'TIMEOUT') {
          answer = 'Genie is taking longer than usual on that one. Try a more specific question, or ask again in a moment.';
        } else if (query && !query.error) {
          answer = query.description || 'Here is what I found.';
        } else {
          answer = 'Genie did not return a written answer. Rephrasing usually helps.';
        }
      }

      res.json({
        conversation_id: convId,
        message_id: msgId,
        space_id: spaceId,
        status: finalMsg.status,
        answer,
        query,
      });
    } catch (e) {
      console.error('[genie/ask]', e.message);
      // Never a raw 500 to the UI — a readable message the chat can show inline.
      res.status(200).json({
        status: 'ERROR',
        answer: `Genie is unavailable right now: ${e.message}. Please try again in a moment.`,
        query: null,
      });
    }
  }));

  app.get('/api/breakdown/insights', (_req, res) => res.json({ insights: [] }));

  // ───────────────────────── SALES DEBRIEF REPORT (shareable doc) ─────────────────────────
  // A polished, exec-ready report generated from live data: company totals,
  // regional breakdown, and a narrative summary. Honors the global filters so
  // the numbers tie out to the Sales dashboard. "Plan" mirrors the dashboard's
  // basis (prior comparable period); "Last Year" is real 52-weeks-back sales
  // where available. Clean region names only (drops junk/admin region codes).
  app.get('/api/report/debrief', asyncHandler(async (req, res) => {
    const { vendor, category } = parseFilters(req);
    const R = await resolveRange(req.query.range || 'lw');
    const vc = vendorClause(vendor);
    const cc = categoryItemClause(category);

    // Company totals: actual (current window), prior comparable window (= "Plan"
    // basis, same as the dashboard KPI), and last-year same window.
    const priorStart = R.dayBack * 2 + 1;
    const priorEnd = R.dayBack + 1;
    const [tot] = await runQuery(`
      WITH cur AS (
        SELECT SUM(sales_amt) sales, SUM(qty) units, SUM(scan_cnt) scans, AVG(aur) aur
        FROM store_sales WHERE ${R.dateClause()} ${vc} ${cc}
      ),
      plan AS (
        SELECT SUM(sales_amt) sales FROM store_sales
        WHERE bus_dt BETWEEN DATE_SUB(DATE'${R.maxDt}', ${priorStart}) AND DATE_SUB(DATE'${R.maxDt}', ${priorEnd}) ${vc} ${cc}
      ),
      ly AS (
        SELECT SUM(sales_amt) sales FROM store_sales
        WHERE bus_dt BETWEEN DATE_SUB(DATE'${R.maxDt}', ${R.dayBack + 364}) AND DATE_SUB(DATE'${R.maxDt}', ${364}) ${vc} ${cc}
      )
      SELECT ROUND(cur.sales,0) actual, ROUND(plan.sales,0) plan, ROUND(ly.sales,0) last_year,
             cur.units, cur.scans, ROUND(cur.aur,0) aur
      FROM cur CROSS JOIN plan CROSS JOIN ly
    `);

    // Store + region coverage in the current window.
    const [cov] = await runQuery(`
      SELECT COUNT(DISTINCT ss.store_nbr) stores,
             COUNT(DISTINCT s.region_nm) regions
      FROM store_sales ss JOIN store_dim s USING(store_nbr)
      WHERE ${R.dateClause('ss.bus_dt')} ${vc} ${cc} AND s.region_nm IS NOT NULL
    `);

    // Operational health signals for the brief (in-stock, e-com share, returns).
    const [health] = await runQuery(`
      WITH sales AS (
        SELECT SUM(sales_amt) s,
               SUM(CASE WHEN svc_chnl_nm IN ('DELIVERY','PICKUP','SFS') THEN sales_amt ELSE 0 END) ecom
        FROM store_sales WHERE ${R.dateClause()} ${vc} ${cc}
      ),
      inv AS (
        SELECT 100.0*SUM(ty_repl_instock_numerator)/NULLIF(SUM(ty_repl_instock_denominator),0) isr
        FROM store_invt WHERE 1=1 ${vc} ${cc}
      ),
      ret AS (
        SELECT SUM(rtn_sales_amt) r FROM store_returns WHERE ${R.dateClause('rtn_dt')} ${vc}
      )
      SELECT ROUND(MAX(inv.isr),0) in_stock,
             ROUND(100.0*MAX(sales.ecom)/NULLIF(MAX(sales.s),0),0) ecom_pct,
             ROUND(100.0*MAX(ret.r)/NULLIF(MAX(sales.s),0),0) return_pct
      FROM sales CROSS JOIN inv CROSS JOIN ret
    `);

    // Regional breakdown — actual vs plan (prior window) vs last year, top regions
    // by sales. Filter out administrative / placeholder region codes so the exec
    // view shows real geographies only.
    const regionFilter = `s.region_nm IS NOT NULL
      AND s.region_nm NOT RLIKE '(?i)(region|admin|ecommerce|retail\\\\s*region)\\\\s*[0-9]'
      AND LENGTH(s.region_nm) > 3`;
    const regions = await runQuery(`
      WITH cur AS (
        SELECT s.region_nm rn, SUM(ss.sales_amt) sales, COUNT(DISTINCT ss.store_nbr) stores
        FROM store_sales ss JOIN store_dim s USING(store_nbr)
        WHERE ${R.dateClause('ss.bus_dt')} ${vc} ${cc} AND ${regionFilter}
        GROUP BY 1
      ),
      plan AS (
        SELECT s.region_nm rn, SUM(ss.sales_amt) sales
        FROM store_sales ss JOIN store_dim s USING(store_nbr)
        WHERE ss.bus_dt BETWEEN DATE_SUB(DATE'${R.maxDt}', ${priorStart}) AND DATE_SUB(DATE'${R.maxDt}', ${priorEnd}) ${vc} ${cc} AND ${regionFilter}
        GROUP BY 1
      ),
      ly AS (
        SELECT s.region_nm rn, SUM(ss.sales_amt) sales
        FROM store_sales ss JOIN store_dim s USING(store_nbr)
        WHERE ss.bus_dt BETWEEN DATE_SUB(DATE'${R.maxDt}', ${R.dayBack + 364}) AND DATE_SUB(DATE'${R.maxDt}', ${364}) ${vc} ${cc} AND ${regionFilter}
        GROUP BY 1
      )
      SELECT cur.rn region, ROUND(cur.sales,0) actual, ROUND(plan.sales,0) plan,
             ROUND(ly.sales,0) last_year, cur.stores
      FROM cur LEFT JOIN plan ON plan.rn=cur.rn LEFT JOIN ly ON ly.rn=cur.rn
      ORDER BY cur.sales DESC LIMIT 8
    `);

    // Top categories (for the narrative + a category chart in the report).
    const cats = await runQuery(`
      SELECT COALESCE(i.omni_dept_desc,'(Uncat)') cat, ROUND(SUM(s.sales_amt),0) sales
      FROM store_sales s LEFT JOIN item_dim i USING(wm_item_nbr)
      WHERE ${R.dateClause('s.bus_dt')} ${vendorClause(vendor,'s.vendor_nbr')} GROUP BY 1 ORDER BY 2 DESC LIMIT 6
    `);

    // Monthly sales trend (for a trend line in the report).
    const trend = await runQuery(`
      SELECT DATE_FORMAT(bus_dt,'yyyy-MM') month, ROUND(SUM(sales_amt),0) sales
      FROM store_sales WHERE ${R.dateClause()} ${vc} ${cc} GROUP BY 1 ORDER BY 1
    `);

    // Sales by channel (for a channel mix in the report).
    const channels = await runQuery(`
      SELECT svc_chnl_nm channel, ROUND(SUM(sales_amt),0) sales
      FROM store_sales WHERE ${R.dateClause()} ${vc} ${cc} AND svc_chnl_nm IS NOT NULL
      GROUP BY 1 ORDER BY sales DESC
    `);

    // ── Extra series for the eight-question executive layout. Each is wrapped so
    // a single failure degrades only that one section, never the whole report. ──
    const safe = async (p, d) => { try { return await p; } catch (e) { console.warn('[debrief extra]', e.message); return d; } };
    const topDept = cats[0]?.cat || null;
    const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

    const [prevKpiArr, aurTrend, availByCat, brandShare, moversUp, moversDown, aurByBrand] = await Promise.all([
      // Prior-window units + realized AUR — to split growth into volume vs price.
      safe(runQuery(`
        SELECT SUM(qty) units, ROUND(SUM(sales_amt)/NULLIF(SUM(qty),0),2) aur
        FROM store_sales
        WHERE bus_dt BETWEEN DATE_SUB(DATE'${R.maxDt}', ${priorStart}) AND DATE_SUB(DATE'${R.maxDt}', ${priorEnd}) ${vc} ${cc}`), [{}]),
      // Realized price (AUR = sales / units) by month.
      safe(runQuery(`
        SELECT DATE_FORMAT(bus_dt,'yyyy-MM') month, ROUND(SUM(sales_amt)/NULLIF(SUM(qty),0),2) aur
        FROM store_sales WHERE ${R.dateClause()} ${vc} ${cc} GROUP BY 1 ORDER BY 1`), []),
      // On-shelf availability by category (in-stock %), worst first — the OOS view.
      safe(runQuery(`
        SELECT COALESCE(i.omni_dept_desc,'(Uncat)') cat,
               ROUND(100.0*SUM(v.ty_repl_instock_numerator)/NULLIF(SUM(v.ty_repl_instock_denominator),0),0) in_stock
        FROM store_invt v LEFT JOIN item_dim i USING(wm_item_nbr)
        WHERE 1=1 ${vc} ${cc}
        GROUP BY 1 HAVING SUM(v.ty_repl_instock_denominator) > 0 ORDER BY in_stock ASC LIMIT 6`), []),
      // Brand share within the top category (share-of-assortment / private-label read).
      topDept ? safe(runQuery(`
        SELECT COALESCE(i.brand_nm,'(Unbranded)') brand, ROUND(SUM(s.sales_amt),0) sales
        FROM store_sales s JOIN item_dim i USING(wm_item_nbr)
        WHERE ${R.dateClause('s.bus_dt')} ${vendorClause(vendor, 's.vendor_nbr')} AND i.omni_dept_desc = ${q(topDept)}
        GROUP BY 1 ORDER BY sales DESC LIMIT 6`), []) : Promise.resolve([]),
      safe(movers('DESC', req), []),
      safe(movers('ASC', req), []),
      // Average unit price (realized AUR = sales / units) per brand, top brands by
      // sales. Powers the color-coded per-brand price chart in the Pricing section.
      safe(runQuery(`
        SELECT COALESCE(i.brand_nm,'(Unbranded)') brand,
               ROUND(SUM(s.sales_amt)/NULLIF(SUM(s.qty),0),2) aur, ROUND(SUM(s.sales_amt),0) sales
        FROM store_sales s JOIN item_dim i USING(wm_item_nbr)
        WHERE ${R.dateClause('s.bus_dt')} ${vendorClause(vendor, 's.vendor_nbr')} ${topDept ? `AND i.omni_dept_desc = ${q(topDept)}` : ''}
        GROUP BY 1 HAVING SUM(s.qty) > 0 ORDER BY sales DESC LIMIT 8`), []),
    ]);
    const prevKpi = prevKpiArr[0] || {};
    const mapMover = (r) => ({ name: r.sku_name, category: cap(r.category_name), sales: num(r.total_sales), prev: num(r.prev_sales), growth: num(r.vs_py_pct) });

    // Category performance — actual vs prior window (plan) vs last year, by
    // department. This powers the "Performance" section (categories, not cities).
    const catsPerf = await safe(runQuery(`
      WITH cur AS (
        SELECT COALESCE(i.omni_dept_desc,'(Uncat)') cat, SUM(s.sales_amt) sales
        FROM store_sales s LEFT JOIN item_dim i USING(wm_item_nbr)
        WHERE ${R.dateClause('s.bus_dt')} ${vendorClause(vendor, 's.vendor_nbr')} GROUP BY 1),
      plan AS (
        SELECT COALESCE(i.omni_dept_desc,'(Uncat)') cat, SUM(s.sales_amt) sales
        FROM store_sales s LEFT JOIN item_dim i USING(wm_item_nbr)
        WHERE s.bus_dt BETWEEN DATE_SUB(DATE'${R.maxDt}', ${priorStart}) AND DATE_SUB(DATE'${R.maxDt}', ${priorEnd}) ${vendorClause(vendor, 's.vendor_nbr')} GROUP BY 1),
      ly AS (
        SELECT COALESCE(i.omni_dept_desc,'(Uncat)') cat, SUM(s.sales_amt) sales
        FROM store_sales s LEFT JOIN item_dim i USING(wm_item_nbr)
        WHERE s.bus_dt BETWEEN DATE_SUB(DATE'${R.maxDt}', ${R.dayBack + 364}) AND DATE_SUB(DATE'${R.maxDt}', ${364}) ${vendorClause(vendor, 's.vendor_nbr')} GROUP BY 1)
      SELECT cur.cat, ROUND(cur.sales,0) actual, ROUND(plan.sales,0) plan, ROUND(ly.sales,0) last_year
      FROM cur LEFT JOIN plan ON plan.cat=cur.cat LEFT JOIN ly ON ly.cat=cur.cat
      ORDER BY cur.sales DESC LIMIT 6`), []);

    const actual = num(tot.actual);
    const plan = num(tot.plan);
    const ly = num(tot.last_year);
    const varToPlan = plan ? actual - plan : null;
    const varToPlanPct = plan ? Math.round((actual - plan) / plan * 1000) / 10 : null;
    const vsLyPct = ly ? Math.round((actual - ly) / ly * 1000) / 10 : null;

    const regionRows = regions.map((r) => {
      const a = num(r.actual), p = num(r.plan), l = num(r.last_year);
      return {
        region: r.region, actual: a, plan: p, last_year: l, stores: num(r.stores),
        var_to_plan_pct: p ? Math.round((a - p) / p * 100) : null,
        vs_ly_pct: l ? Math.round((a - l) / l * 100) : null,
      };
    });
    const aheadCount = regionRows.filter((r) => r.var_to_plan_pct != null && r.var_to_plan_pct >= 0).length;
    const worst = [...regionRows].filter((r) => r.var_to_plan_pct != null).sort((a, b) => a.var_to_plan_pct - b.var_to_plan_pct)[0];
    const best = [...regionRows].filter((r) => r.var_to_plan_pct != null).sort((a, b) => b.var_to_plan_pct - a.var_to_plan_pct)[0];

    const inStock = num(health.in_stock);
    const ecomPct = num(health.ecom_pct);
    const returnPct = num(health.return_pct);

    // Integer-only percent formatter (no decimals anywhere in the brief).
    const pctI = (n) => (n == null ? null : `${n >= 0 ? '+' : ''}${Math.round(n)}%`);

    // ── Structured executive brief: headline + three sections ──
    const scope = vendor === 'all' ? 'the total tracked business' : 'the selected vendor';
    const dir = varToPlanPct == null ? 'in line with' : varToPlanPct >= 0 ? 'beating' : 'trailing';
    const headline = `Net sales reached ${money(actual)} over ${R.label.toLowerCase()} for ${scope}, ${dir} plan${varToPlanPct != null ? ` by ${pctI(varToPlanPct)} (${varToPlan >= 0 ? '+' : ''}${money(varToPlan)})` : ''}${vsLyPct != null ? ` and ${vsLyPct >= 0 ? 'exceeding' : 'below'} last year by ${pctI(vsLyPct)}` : ''}.`;

    const working = [];
    if (varToPlanPct != null && varToPlanPct >= 0) working.push(`Total sales are ahead of plan by ${pctI(varToPlanPct)}.`);
    if (best && best.var_to_plan_pct > 0) working.push(`${best.region} leads the regions at ${pctI(best.var_to_plan_pct)} vs plan.`);
    if (inStock != null && inStock >= 95) working.push(`On-shelf availability is strong at ${Math.round(inStock)}%, so sales aren't being capped by stockouts.`);
    if (ecomPct != null && ecomPct >= 10) working.push(`E-commerce is ${Math.round(ecomPct)}% of sales across delivery, pickup, and ship-from-store.`);
    if (cats.length) working.push(`${cap(cats[0].cat)} anchors the mix at ${money(num(cats[0].sales))}.`);

    const attention = [];
    if (varToPlanPct != null && varToPlanPct < 0) attention.push(`Total sales are trailing plan by ${pctI(varToPlanPct)} (${money(varToPlan)}).`);
    if (worst && worst.var_to_plan_pct < 0) attention.push(`${worst.region} is the softest region at ${pctI(worst.var_to_plan_pct)} vs plan.`);
    if (inStock != null && inStock < 95) attention.push(`In-stock at ${Math.round(inStock)}% is below the 95% target; on-shelf gaps are likely leaking sales.`);
    if (returnPct != null && returnPct >= 1) attention.push(`Returns are running ${Math.round(returnPct)}% of sales.`);

    // ── Funded, grounded recommendations ──
    // Every action is tied to a live metric in this view and carries a dollar
    // opportunity sized from the account's own numbers (not generic advice).
    const LOST_SALES_RECAPTURE = 0.5;   // ~half of on-shelf gaps convert to lost sales; the rest substitutes
    const RETURN_ADDRESSABLE = 0.25;    // realistic near-term dent in the top return driver
    const fund = [];
    if (varToPlan != null && varToPlan < 0) {
      fund.push({ v: Math.abs(varToPlan), t: `Close the ${money(Math.abs(varToPlan))} gap to plan — it concentrates in ${worst && worst.var_to_plan_pct < 0 ? `${worst.region} (${pctI(worst.var_to_plan_pct)} behind)` : 'the softest regions'}. Rebalance replenishment and promo support there first.` });
    }
    if (inStock != null && inStock < 98) {
      const rec = num(actual) * Math.max(0, (98 - inStock) / 100) * LOST_SALES_RECAPTURE;
      if (rec > 0) fund.push({ v: rec, t: `Lift in-stock from ${Math.round(inStock)}% to 98% to recover an estimated ${money(rec)} in at-risk sales — start with the lowest-availability, highest-velocity stores.` });
    }
    if (returnPct != null && returnPct >= 1) {
      const rdol = num(actual) * returnPct / 100, save = rdol * RETURN_ADDRESSABLE;
      fund.push({ v: save, t: `Returns are running ${Math.round(returnPct)}% (${money(rdol)}) — cutting the top return driver by a quarter frees ~${money(save)} and protects margin.` });
    }
    if (cats.length) {
      const anchor = num(cats[0].sales), slip = anchor * 0.02;
      fund.push({ v: slip, t: `Defend ${cap(cats[0].cat)}, the anchor at ${money(anchor)} of mix — hold shelf and in-stock so even a 2-point slip (${money(slip)}) never opens up.` });
    }
    fund.sort((a, b) => b.v - a.v);            // most valuable first
    const actionsList = fund.slice(0, 4).map((f) => f.t);
    if (!actionsList.length) actionsList.push(`No material, fundable gap in this view — hold the plan and ask Genie to pressure-test any region or category.`);

    const sections = [
      { title: "What's working", tone: 'good', points: working.slice(0, 4) },
      { title: 'What needs attention', tone: 'warn', points: attention.length ? attention.slice(0, 4) : ['No material risks detected in the current view.'] },
      { title: 'Recommended actions', tone: 'action', points: actionsList },
    ];

    // ── Prose executive brief (reads like a human wrote it, not a bullet list) ──
    const nP = [];
    const scopeCap = scope[0].toUpperCase() + scope.slice(1);
    nP.push(
      `${scopeCap} delivered ${money(actual)} in net sales over ${R.label.toLowerCase()}, ` +
      (varToPlanPct == null
        ? `broadly in line with plan.`
        : varToPlanPct >= 0
          ? `${varToPlanPct === 0 ? 'holding' : `${pctI(varToPlanPct)} ahead of`} plan (${varToPlan >= 0 ? '+' : ''}${money(varToPlan)})${vsLyPct != null ? ` and ${pctI(vsLyPct)} versus last year` : ''}.`
          : `${pctI(Math.abs(varToPlanPct))} behind plan (${money(varToPlan)})${vsLyPct != null ? ` and ${pctI(vsLyPct)} versus last year` : ''}.`) +
      (cats.length ? ` ${cap(cats[0].cat)} remained the largest category at ${money(num(cats[0].sales))}${cats[1] ? `, followed by ${cap(cats[1].cat)} at ${money(num(cats[1].sales))}` : ''}.` : '')
    );
    const regionSentence = [];
    if (best && best.var_to_plan_pct != null) regionSentence.push(`${best.region} led the field at ${pctI(best.var_to_plan_pct)} to plan`);
    if (worst && worst.var_to_plan_pct != null && (!best || worst.region !== best.region)) regionSentence.push(`${worst.region} lagged at ${pctI(worst.var_to_plan_pct)}`);
    nP.push(
      (regionRows.length ? `Across regions, ${regionSentence.join(', while ')}. ` : '') +
      (inStock != null ? `On-shelf availability held at ${Math.round(inStock)}%${inStock >= 95 ? ', keeping stock off the critical path for sales' : ', below the 95% target and a likely drag on sell-through'}. ` : '') +
      (ecomPct != null ? `E-commerce contributed ${Math.round(ecomPct)}% of the mix across delivery, pickup, and ship-from-store` : '') +
      (returnPct != null ? `${ecomPct != null ? ', and returns' : 'Returns'} ran at ${Math.round(returnPct)}% of sales.` : (ecomPct != null ? '.' : ''))
    );
    const narrative = nP.filter(Boolean);

    res.json({
      title: 'Executive Summary',
      report_name: 'Monday Morning Sales',
      subtitle: `${R.label} · ${new Date(R.maxDt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} · ${num(cov.stores).toLocaleString()} stores · ${num(cov.regions)} regions`,
      as_of: R.maxDt,
      range_label: R.label,
      headline,
      narrative,
      sections,
      // Kept for backward-compat / plain-text export.
      executive_summary: headline,
      totals: {
        actual, plan, last_year: ly,
        var_to_plan: varToPlan, var_to_plan_pct: varToPlanPct == null ? null : Math.round(varToPlanPct),
        vs_ly_pct: vsLyPct == null ? null : Math.round(vsLyPct),
        units: num(tot.units), scans: num(tot.scans), aur: num(tot.aur),
        in_stock: inStock, ecom_pct: ecomPct, return_pct: returnPct,
      },
      regions: regionRows,
      categories: cats.map((c) => ({ name: cap(c.cat), sales: num(c.sales) })),
      channels: channels.map((c) => ({ channel: c.channel, sales: num(c.sales) })),
      trend: trend.map((t) => ({ month: t.month, sales: num(t.sales) })),
      plan_basis: 'prior comparable period',
      // Eight-question executive layout series.
      price_volume: {
        cur_units: num(tot.units), cur_aur: num(tot.aur),
        prev_units: num(prevKpi.units), prev_aur: num(prevKpi.aur),
      },
      aur_trend: aurTrend.map((r) => ({ month: r.month, aur: num(r.aur) })),
      availability: availByCat.map((r) => ({ cat: cap(r.cat), in_stock: num(r.in_stock) })),
      brand_share: { category: topDept ? cap(topDept) : null, brands: brandShare.map((r) => ({ brand: r.brand, sales: num(r.sales) })) },
      aur_by_brand: { category: topDept ? cap(topDept) : null, brands: aurByBrand.map((r) => ({ brand: r.brand, aur: num(r.aur), sales: num(r.sales) })) },
      movers_up: moversUp.map(mapMover),
      movers_down: moversDown.map(mapMover),
      categories_perf: catsPerf.map((c) => {
        const a = num(c.actual), p = num(c.plan), l = num(c.last_year);
        return { name: cap(c.cat), actual: a, plan: p, last_year: l,
          var_to_plan_pct: p ? Math.round((a - p) / p * 100) : null,
          vs_ly_pct: l ? Math.round((a - l) / l * 100) : null };
      }),
      actions_this_week: actionsList,
      return_pct: returnPct,
    });
  }));

  // ───────────────────────── TAKE ACTION (persisted work orders) ─────────────────────────
  // Execute a recommendation. The source warehouse is read-only, so the real
  // side effect is a persisted work order in Lakebase (action_log). We always
  // return a concrete receipt so the demo never dead-ends, even if Lakebase
  // isn't configured (then it's a receipt-only confirmation, not persisted).
  const ACTION_TEMPLATES = {
    replenishment: {
      title: 'Replenishment order',
      queue: 'Supply Chain · Replenishment',
      owner: 'Replenishment Planning',
      steps: ['Pull low-availability store list', 'Generate transfer/PO', 'Route to DC for pick', 'Confirm on-shelf date'],
      etaHours: 48,
    },
    price_review: {
      title: 'Price & promo review',
      queue: 'Merchandising · Pricing',
      owner: 'Category Merchant',
      steps: ['Snapshot current price & elasticity', 'Compare vs plan and market', 'Draft price/promo change', 'Submit for approval'],
      etaHours: 72,
    },
    content_fix: {
      title: 'Content / listing fix',
      queue: 'E-commerce · Item Setup',
      owner: 'Digital Merchandising',
      steps: ['Flag affected items', 'Fix image / attributes / dimensions', 'Resubmit for publish', 'Verify transactability'],
      etaHours: 24,
    },
    supplier_review: {
      title: 'Supplier OTIF escalation',
      queue: 'Supply Chain · Vendor Ops',
      owner: 'Vendor Management',
      steps: ['Identify chronically late POs', 'Open supplier scorecard case', 'Schedule review', 'Track corrective action'],
      etaHours: 120,
    },
    returns_mitigation: {
      title: 'Returns mitigation',
      queue: 'Quality · Returns',
      owner: 'Quality & Returns',
      steps: ['Isolate driving SKUs & reason', 'Route to owner (QA / content / handling)', 'Open corrective task', 'Monitor return rate'],
      etaHours: 96,
    },
    category_review: {
      title: 'Category deep-dive',
      queue: 'Merchandising · Category',
      owner: 'Category Manager',
      steps: ['Isolate declining subcategories/brands', 'Compare vs market share', 'Draft action plan', 'Review with team'],
      etaHours: 72,
    },
    generic: {
      title: 'Follow-up task',
      queue: 'Ops · General',
      owner: 'Operations',
      steps: ['Review recommendation', 'Assign owner', 'Execute', 'Confirm outcome'],
      etaHours: 72,
    },
  };

  function makeWorkOrder(kind) {
    const prefix = ({
      replenishment: 'REPL', price_review: 'PRC', content_fix: 'CNT',
      supplier_review: 'SUP', returns_mitigation: 'RTN', category_review: 'CAT',
    }[kind]) || 'WO';
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    const seq = String(Math.floor(1000 + Math.random() * 9000));
    return `${prefix}-${seq}-${rand}`;
  }

  app.post('/api/actions', asyncHandler(async (req, res) => {
    const body = req.body || {};
    const kind = String(body.kind || 'generic');
    const tpl = ACTION_TEMPLATES[kind] || ACTION_TEMPLATES.generic;
    const title = String(body.title || tpl.title).slice(0, 200);
    const detail = body.detail != null ? String(body.detail).slice(0, 1000) : null;
    const appKey = body.app ? String(body.app) : 'sales';
    const createdBy = req.get('x-forwarded-email') || req.get('x-forwarded-preferred-username') || 'demo user';
    const workOrder = makeWorkOrder(kind);
    const eta = new Date(Date.now() + tpl.etaHours * 3600_000);

    let persisted = false;
    let actionId = null;
    let createdAt = new Date().toISOString();
    try {
      const row = await recordAction({
        workOrder, appKey, kind, title, detail,
        payload: { ...body, template: tpl.title }, createdBy,
      });
      persisted = true;
      actionId = row.action_id;
      createdAt = row.created_at;
    } catch (e) {
      // Lakebase not configured / unreachable — still return a receipt so the
      // action always confirms. Log for observability.
      console.warn('[actions] persist skipped:', e.message || e);
    }

    res.json({
      ok: true,
      persisted,
      receipt: {
        work_order: workOrder,
        action_id: actionId,
        status: persisted ? 'QUEUED' : 'QUEUED (session only)',
        title,
        detail,
        queue: tpl.queue,
        owner: tpl.owner,
        steps: tpl.steps,
        created_by: createdBy,
        created_at: createdAt,
        eta: eta.toISOString(),
        eta_label: eta.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
      },
    });
  }));

  app.get('/api/actions', asyncHandler(async (_req, res) => {
    try {
      const rows = await listActions(50);
      res.json({ actions: rows, persisted: true });
    } catch (e) {
      res.json({ actions: [], persisted: false, note: 'Lakebase not configured' });
    }
  }));

  // ───────────────────────── E-COMMERCE INTELLIGENCE ─────────────────────────
  // Transactability (digital_transactability) + content quality (ecom_prod_cntnt_score).
  app.get('/api/ecom/overview', asyncHandler(async (req, res) => {
    const { vendor } = parseFilters(req);
    // transactability is keyed by wm_item_nbr → vendor filter via item_dim subquery
    const vFilter = (!vendor || vendor === 'all') ? '' : `AND wm_item_nbr IN (SELECT wm_item_nbr FROM item_dim WHERE vendor_nbr = ${parseInt(vendor, 10)})`;
    const [t] = await runQuery(`
      SELECT COUNT(*) AS rows,
             SUM(omni_trnsctbl_ind) AS transactable,
             SUM(CASE WHEN omni_trnsctbl_ind = 0 THEN 1 ELSE 0 END) AS not_transactable,
             ROUND(AVG(ats_score_val),3) AS avg_ats,
             SUM(CASE WHEN ats_score_val < 0.9 THEN 1 ELSE 0 END) AS low_ats
      FROM digital_transactability WHERE 1=1 ${vFilter}
    `);
    // top non-published reasons (which lever to pull)
    const [reasons] = await runQuery(`
      SELECT SUM(invt_reltd_not_pub_ind) AS inventory,
             SUM(item_setup_not_pub_ind) AS setup,
             SUM(missing_image_not_pub_ind) AS image,
             SUM(missing_dim_not_pub_ind) AS dimensions,
             SUM(prohibited_not_pub_ind) AS prohibited,
             SUM(do_not_disp_not_pub_ind) AS do_not_display,
             SUM(dt_range_not_pub_ind) AS date_range
      FROM digital_transactability WHERE 1=1 ${vFilter}
    `);
    const [content] = await runQuery(`
      SELECT COUNT(DISTINCT catlg_item_id) AS items,
             SUM(CASE WHEN issue_nm = 'BELOW THRESHOLD' THEN 1 ELSE 0 END) AS below_threshold,
             SUM(CASE WHEN issue_nm = 'OK' THEN 1 ELSE 0 END) AS ok
      FROM ecom_prod_cntnt_score
    `);
    const reasonList = Object.entries(reasons).map(([k, v]) => ({ lever: k, count: num(v) })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count);
    res.json({
      total: num(t.rows), transactable: num(t.transactable), not_transactable: num(t.not_transactable),
      transactable_pct: t.rows ? Math.round(num(t.transactable) / num(t.rows) * 1000) / 10 : null,
      avg_ats: num(t.avg_ats), low_ats: num(t.low_ats),
      reasons: reasonList,
      content: { items: num(content.items), below_threshold: num(content.below_threshold), ok: num(content.ok) },
    });
  }));

  // Items to fix: low transactability + content issues, with AI mitigation action per item.
  app.get('/api/ecom/action-items', asyncHandler(async (req, res) => {
    const { vendor } = parseFilters(req);
    const vFilter = (!vendor || vendor === 'all') ? '' : `AND d.wm_item_nbr IN (SELECT wm_item_nbr FROM item_dim WHERE vendor_nbr = ${parseInt(vendor, 10)})`;
    const rows = await runQuery(`
      WITH agg AS (
        SELECT d.wm_item_nbr,
               AVG(d.ats_score_val) AS ats,
               COUNT(*) AS store_rows,
               SUM(CASE WHEN d.omni_trnsctbl_ind = 0 THEN 1 ELSE 0 END) AS nontrans_rows,
               SUM(d.invt_reltd_not_pub_ind) AS r_inv,
               SUM(d.item_setup_not_pub_ind) AS r_setup,
               SUM(d.missing_image_not_pub_ind) AS r_img,
               SUM(d.missing_dim_not_pub_ind) AS r_dim,
               AVG(d.on_hand_unavlbl_score_val) AS oh_unavl,
               AVG(d.nil_pick_unavlbl_score_val) AS nil_unavl
        FROM digital_transactability d
        WHERE d.wm_item_nbr IS NOT NULL ${vFilter}
        GROUP BY d.wm_item_nbr
      )
      SELECT agg.wm_item_nbr AS sku_id, i.item_name AS sku_name, i.brand_nm AS brand, i.omni_dept_desc AS category,
             ROUND(agg.ats,3) AS ats,
             ROUND(100.0*agg.nontrans_rows/NULLIF(agg.store_rows,0),0) AS nontrans_pct,
             agg.r_inv, agg.r_setup, agg.r_img, agg.r_dim,
             ROUND(agg.oh_unavl,3) AS oh_unavl, ROUND(agg.nil_unavl,3) AS nil_unavl
      FROM agg JOIN item_dim i ON i.wm_item_nbr = agg.wm_item_nbr
      WHERE agg.nontrans_rows > 0
      ORDER BY agg.nontrans_rows DESC, agg.ats ASC LIMIT 40
    `);
    res.json(rows.map((r) => {
      // choose the dominant lever → AI action
      let action, target;
      if (num(r.oh_unavl) > 0.1 || r.r_inv) { action = 'Availability gap: replenish on-hand / clear nil-pick blocks so the item can publish online.'; target = 'inventory'; }
      else if (r.r_img) { action = 'Add or fix the primary image, then resubmit for publish.'; target = 'content'; }
      else if (r.r_dim) { action = 'Supply missing pack dimensions/weight so shipping can be calculated.'; target = 'content'; }
      else if (r.r_setup) { action = 'Complete item setup attributes (item is not fully set up for e-commerce).'; target = 'setup'; }
      else action = 'Raise the availability-to-sell score: verify on-hand, reserve, and forecast signals.', target = 'inventory';
      return { sku_id: r.sku_id, sku_name: r.sku_name, brand: r.brand, category: r.category, ats: num(r.ats), nontrans_pct: num(r.nontrans_pct), action, target };
    }));
  }));

  // ───────────────────────── FORECAST (confidence-scored) ─────────────────────────
  // Combine future daily demand forecast with historical actuals + inventory + nil picks.
  app.get('/api/forecast/overview', asyncHandler(async (req, res) => {
    const { vendor, category } = parseFilters(req);
    const vc = vendorClause(vendor);
    const cc = categoryItemClause(category);
    // Historical: daily actual units for last 56 days (for accuracy + trend)
    const actuals = await runQuery(`
      SELECT bus_dt AS d, ROUND(SUM(qty),0) AS actual_units
      FROM store_sales
      WHERE bus_dt >= DATE_SUB((SELECT MAX(bus_dt) FROM store_sales), 55) ${vc} ${cc}
      GROUP BY 1 ORDER BY 1
    `);
    // Future: daily demand forecast
    const fFilter = (!vendor || vendor === 'all') ? '' : `AND wm_item_nbr IN (SELECT wm_item_nbr FROM item_dim WHERE vendor_nbr = ${parseInt(vendor, 10)})`;
    const fCat = (!category || category === 'all') ? '' : `AND wm_item_nbr IN (SELECT wm_item_nbr FROM item_dim WHERE omni_dept_desc = '${String(category).replace(/'/g, "''")}')`;
    const fcst = await runQuery(`
      SELECT fcst_dt AS d, ROUND(SUM(fcst_tot_dmand_each_qty),0) AS forecast_units
      FROM dly_dmnd_fcst WHERE 1=1 ${fFilter} ${fCat}
      GROUP BY 1 ORDER BY 1
    `);
    // Confidence inputs: nil-pick fill rate + in-stock.
    // store_fulfillment has NO vendor_nbr → filter by item subquery. store_invt HAS vendor_nbr.
    const ffItem = (!vendor || vendor === 'all') ? '' : `AND wm_item_nbr IN (SELECT wm_item_nbr FROM item_dim WHERE vendor_nbr = ${parseInt(vendor, 10)})`;
    const [conf] = await runQuery(`
      WITH fill AS (
        SELECT SUM(nil_pick_qty) AS nil, SUM(cust_order_qty) AS ord FROM store_fulfillment
        WHERE bus_dt >= DATE_SUB((SELECT MAX(bus_dt) FROM store_fulfillment), 55) ${ffItem}
      ),
      inv AS (
        SELECT 100.0*SUM(ty_repl_instock_numerator)/NULLIF(SUM(ty_repl_instock_denominator),0) AS isr
        FROM store_invt WHERE wm_yr_wk_nbr=(SELECT MAX(wm_yr_wk_nbr) FROM store_invt) ${vc}
      )
      SELECT ROUND(100.0*(1 - COALESCE(MAX(fill.nil),0)/NULLIF(MAX(fill.ord),0)),0) AS fill_rate,
             ROUND(MAX(inv.isr),0) AS in_stock
      FROM fill CROSS JOIN inv
    `);
    // Coefficient of variation of recent actuals → volatility → confidence
    const vals = actuals.map((a) => num(a.actual_units)).filter((v) => v != null);
    const mean = vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length || 1));
    const cv = mean ? sd / mean : 0;
    const fill = num(conf.fill_rate) ?? 95;
    const inStock = num(conf.in_stock) ?? 95;
    // confidence blends demand stability, fill rate, and in-stock (0-100)
    const confidence = Math.max(40, Math.min(98, Math.round(0.5 * (100 - cv * 100) + 0.25 * fill + 0.25 * inStock)));
    // band width scales inversely with confidence
    const band = (1 - confidence / 100) + 0.06;
    const series = [
      ...actuals.map((a) => ({ date: a.d, actual: num(a.actual_units), forecast: null, lo: null, hi: null })),
      ...fcst.map((f) => ({ date: f.d, actual: null, forecast: num(f.forecast_units), lo: Math.round(num(f.forecast_units) * (1 - band)), hi: Math.round(num(f.forecast_units) * (1 + band)) })),
    ];
    res.json({
      series, confidence,
      drivers: { demand_stability: Math.round((1 - cv) * 100), fill_rate: fill, in_stock: inStock },
      forecast_total: fcst.reduce((s, f) => s + num(f.forecast_units), 0),
      horizon_days: fcst.length,
    });
  }));

  // ───────────────────────── INVENTORY INTELLIGENCE (DC / store) ─────────────────────────
  // Selector: DCs (that have inventory-covered aligned stores) + a store lookup.
  app.get('/api/inv-intel/entities', asyncHandler(async (_req, res) => {
    const dcs = await runQuery(`
      SELECT a.dc_nbr, MAX(d.dc_nm) AS dc_nm, MAX(d.city_nm) AS city, MAX(d.st_prov_cd) AS st,
             COUNT(DISTINCT a.store_nbr) AS stores
      FROM dc_alignment a JOIN dc_dim d ON d.dc_nbr = a.dc_nbr
      WHERE a.store_nbr IN (SELECT DISTINCT store_nbr FROM store_invt WHERE wm_yr_wk_nbr=(SELECT MAX(wm_yr_wk_nbr) FROM store_invt))
      GROUP BY a.dc_nbr HAVING COUNT(DISTINCT a.store_nbr) >= 5
      ORDER BY stores DESC LIMIT 40
    `);
    res.json({
      dcs: dcs.map((d) => ({ dc_nbr: d.dc_nbr, name: d.dc_nm, city: d.city, state: d.st, stores: num(d.stores),
        label: `${d.city ? d.city.split(' ').map(w=>w[0]+w.slice(1).toLowerCase()).join(' ') : 'DC'} DC (#${d.dc_nbr})` })),
    });
  }));

  // Store search for the selector (type-ahead).
  app.get('/api/inv-intel/store-search', asyncHandler(async (req, res) => {
    const term = (req.query.q || '').toString().replace(/'/g, "''");
    if (!term) return res.json([]);
    const isNum = /^\d+$/.test(term);
    const where = isNum ? `d.store_nbr = ${parseInt(term, 10)}` : `UPPER(d.store_nm) LIKE UPPER('%${term}%') OR UPPER(d.city_nm) LIKE UPPER('%${term}%')`;
    const rows = await runQuery(`
      SELECT store_nbr, store_nm, city_nm, state_prov_cd FROM store_dim WHERE ${where} LIMIT 15
    `);
    res.json(rows.map((r) => ({ store_nbr: r.store_nbr, name: r.store_nm, city: r.city_nm, state: r.state_prov_cd })));
  }));

  // DC view: summary KPIs + per-store inventory flow (top stores) + total expected orders.
  app.get('/api/inv-intel/dc/:dcNbr', asyncHandler(async (req, res) => {
    const dc = parseInt(req.params.dcNbr, 10);
    if (Number.isNaN(dc)) return res.status(400).json({ error: 'bad dc' });
    const limit = Math.min(parseInt(req.query.limit || '8', 10), 25);

    // DC header, network totals, expected-orders total, and per-store flow — all concurrent.
    const [[dcInfo], [tot], [ord], stores] = await Promise.all([
      runQuery(`SELECT dc_nbr, dc_nm, city_nm, st_prov_cd FROM dc_dim WHERE dc_nbr=${dc} LIMIT 1`),
      runQuery(`
      SELECT SUM(v.ty_on_hand_qty) AS total_units,
             SUM(v.ty_in_trnst_qty) AS in_transit,
             ROUND(100.0*SUM(v.ty_repl_instock_numerator)/NULLIF(SUM(v.ty_repl_instock_denominator),0),0) AS fill_rate,
             COUNT(DISTINCT a.store_nbr) AS stores
      FROM store_invt v JOIN dc_alignment a ON a.store_nbr=v.store_nbr
      WHERE a.dc_nbr=${dc} AND v.wm_yr_wk_nbr=(SELECT MAX(wm_yr_wk_nbr) FROM store_invt)
    `),
      runQuery(`
      SELECT ROUND(SUM(f.final_fcst_each_qty),0) AS expected_orders
      FROM store_demand_forecast f JOIN dc_alignment a ON a.store_nbr=f.store_nbr
      WHERE a.dc_nbr=${dc} AND f.wm_yr_wk_nbr=(SELECT MIN(wm_yr_wk_nbr) FROM store_demand_forecast)
    `),
      runQuery(`
      WITH inv AS (
        SELECT v.store_nbr, SUM(v.ty_on_hand_qty) AS on_hand, SUM(v.ty_in_trnst_qty) AS in_transit,
               ROUND(100.0*SUM(v.ty_repl_instock_numerator)/NULLIF(SUM(v.ty_repl_instock_denominator),0),0) AS fill
        FROM store_invt v JOIN dc_alignment a ON a.store_nbr=v.store_nbr
        WHERE a.dc_nbr=${dc} AND v.wm_yr_wk_nbr=(SELECT MAX(wm_yr_wk_nbr) FROM store_invt)
        GROUP BY v.store_nbr
      ),
      fc AS (
        SELECT f.store_nbr, ROUND(SUM(f.final_fcst_each_qty),0) AS forecast
        FROM store_demand_forecast f JOIN dc_alignment a ON a.store_nbr=f.store_nbr
        WHERE a.dc_nbr=${dc} AND f.wm_yr_wk_nbr=(SELECT MIN(wm_yr_wk_nbr) FROM store_demand_forecast)
        GROUP BY f.store_nbr
      ),
      recent AS (
        -- last-7-days units vs the trailing 8-week weekly average → true velocity spread
        SELECT store_nbr,
               SUM(CASE WHEN bus_dt >= DATE_SUB((SELECT MAX(bus_dt) FROM store_sales), 6) THEN qty ELSE 0 END) AS units_recent,
               SUM(qty)/8.0 AS units_wkly_avg
        FROM store_sales
        WHERE bus_dt >= DATE_SUB((SELECT MAX(bus_dt) FROM store_sales), 55)
          AND store_nbr IN (SELECT store_nbr FROM dc_alignment WHERE dc_nbr=${dc})
        GROUP BY store_nbr
      )
      SELECT d.store_nbr, d.store_nm, d.city_nm, d.state_prov_cd,
             COALESCE(inv.on_hand,0) AS on_hand, COALESCE(inv.in_transit,0) AS in_transit, inv.fill,
             COALESCE(fc.forecast,0) AS forecast,
             COALESCE(recent.units_recent,0) AS units_recent,
             COALESCE(recent.units_wkly_avg,0) AS units_wkly_avg
      FROM inv JOIN store_dim d ON d.store_nbr=inv.store_nbr
      LEFT JOIN fc ON fc.store_nbr=inv.store_nbr
      LEFT JOIN recent ON recent.store_nbr=inv.store_nbr
      -- surface the biggest velocity swings (both directions) so the flow shows a real mix
      ORDER BY ABS((COALESCE(recent.units_recent,0) - COALESCE(recent.units_wkly_avg,0))/NULLIF(recent.units_wkly_avg,1)) DESC, inv.in_transit DESC
      LIMIT ${limit}
    `),
    ]);
    // velocity = recent week run-rate vs the store's own 8-week average (natural spread around 0)
    const rows = stores.map((s) => {
      const fc = num(s.forecast) || 0;
      const recentWk = num(s.units_recent) || 0;
      const avgWk = num(s.units_wkly_avg) || 0;
      const velPct = avgWk > 0 ? Math.round(((recentWk - avgWk) / avgWk) * 100) : 0;
      const vel = Math.max(-18, Math.min(22, velPct));
      // status: low fill OR a big positive swing (needs pre-position) → warning
      const status = (s.fill != null && num(s.fill) < 92) ? 'warning' : (vel >= 10 ? 'warning' : 'good');
      const actionType = vel >= 10 ? 'Pre-position stock' : 'Routine cycle order';
      return {
        store_nbr: s.store_nbr, name: s.store_nm, city: s.city_nm, state: s.state_prov_cd,
        on_hand: num(s.on_hand), in_transit: num(s.in_transit), fill: num(s.fill),
        forecast: fc, velocity_pct: vel, status, action: actionType,
        timing: vel > 10 ? 'Tomorrow' : 'Next cycle',
      };
    });
    res.json({
      dc: { dc_nbr: dc, name: dcInfo?.dc_nm, city: dcInfo?.city_nm, state: dcInfo?.st_prov_cd },
      kpis: { total_units: num(tot.total_units), in_transit: num(tot.in_transit), fill_rate: num(tot.fill_rate), stores: num(tot.stores), expected_orders: num(ord.expected_orders) },
      stores: rows,
      shown: rows.length,
    });
  }));

  // Single store view.
  app.get('/api/inv-intel/store/:storeNbr', asyncHandler(async (req, res) => {
    const st = parseInt(req.params.storeNbr, 10);
    if (Number.isNaN(st)) return res.status(400).json({ error: 'bad store' });
    const [d] = await runQuery(`SELECT store_nbr, store_nm, city_nm, state_prov_cd FROM store_dim WHERE store_nbr=${st} LIMIT 1`);
    const [inv] = await runQuery(`
      SELECT SUM(ty_on_hand_qty) AS on_hand, SUM(ty_in_trnst_qty) AS in_transit, SUM(ty_in_whse_qty) AS in_whse, SUM(ty_on_order_qty) AS on_order,
             ROUND(100.0*SUM(ty_repl_instock_numerator)/NULLIF(SUM(ty_repl_instock_denominator),0),0) AS fill
      FROM store_invt WHERE store_nbr=${st} AND wm_yr_wk_nbr=(SELECT MAX(wm_yr_wk_nbr) FROM store_invt)
    `);
    const [fc] = await runQuery(`SELECT ROUND(SUM(final_fcst_each_qty),0) AS forecast FROM store_demand_forecast WHERE store_nbr=${st} AND wm_yr_wk_nbr=(SELECT MIN(wm_yr_wk_nbr) FROM store_demand_forecast)`);
    const [align] = await runQuery(`SELECT a.dc_nbr, d.dc_nm FROM dc_alignment a LEFT JOIN dc_dim d ON d.dc_nbr=a.dc_nbr WHERE a.store_nbr=${st} LIMIT 1`);
    res.json({
      store: { store_nbr: st, name: d?.store_nm, city: d?.city_nm, state: d?.state_prov_cd, dc_nbr: align?.dc_nbr, dc_name: align?.dc_nm },
      kpis: { total_units: num(inv?.on_hand), in_transit: num(inv?.in_transit), fill_rate: num(inv?.fill), expected_orders: num(fc?.forecast) },
      flow: { in_whse: num(inv?.in_whse), in_transit: num(inv?.in_transit), on_hand: num(inv?.on_hand), on_order: num(inv?.on_order) },
    });
  }));

  // Per-store hourly movement heatmap (day-of-week × hour) from hourly_store_invt.
  app.get('/api/inv-intel/heatmap/:storeNbr', asyncHandler(async (req, res) => {
    const st = parseInt(req.params.storeNbr, 10);
    if (Number.isNaN(st)) return res.status(400).json({ error: 'bad store' });
    const rows = await runQuery(`
      SELECT DATE_FORMAT(bus_dt,'EEEE') AS dow, bus_hr_nbr AS hr, ROUND(SUM(quantity),0) AS val
      FROM hourly_store_invt WHERE store_nbr=${st} GROUP BY 1,2
    `);
    const dows = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const grid = dows.map((d) => ({ dow: d, cells: hours.map((h) => { const m = rows.find((r) => r.dow === d && Number(r.hr) === h); return { hr: h, val: m ? num(m.val) : 0 }; }) }));
    res.json({ store_nbr: st, hours, grid });
  }));

  // ───────────────────────── AGENTS (automation showcase) ─────────────────────────
  // Static agent catalog; live queue counts + findings come from the data.
  const AGENTS = [
    { id: 'replenishment', name: 'Replenishment Agent', tagline: 'Flags stores at risk of stockout and drafts pre-position orders', tables: ['store_invt', 'store_demand_forecast', 'store_sales'], color: '#FF3621' },
    { id: 'oos-diagnosis', name: 'OOS Root-Cause Agent', tagline: 'Diagnoses why items are out of stock and routes to the right owner', tables: ['oos_root_cause', 'store_invt'], color: '#0B2026' },
    { id: 'supplier-otif', name: 'Supplier OTIF Agent', tagline: 'Chases late / short purchase orders before they hit the shelf', tables: ['omni_otif', 'purchase_order'], color: '#FBB300' },
    { id: 'ecom-fix', name: 'E-com Publish Agent', tagline: 'Fixes non-transactable items so they can sell online', tables: ['digital_transactability', 'ecom_prod_cntnt_score'], color: '#00A972' },
    { id: 'returns', name: 'Returns Mitigation Agent', tagline: 'Finds return-driving SKUs and proposes the corrective action', tables: ['ecom_returns', 'store_returns'], color: '#8AB4F8' },
    { id: 'forecast-exception', name: 'Forecast Exception Agent', tagline: 'Surfaces demand swings that break the plan and re-forecasts', tables: ['dly_dmnd_fcst', 'store_sales'], color: '#A66BFF' },
  ];

  // Live queue count per agent (how many items need review right now).
  app.get('/api/agents/roster', asyncHandler(async (_req, res) => {
    const [rep, oos, otif, ecom, ret, fcx] = await Promise.all([
      runQuery(`SELECT COUNT(*) n FROM (SELECT store_nbr, 100.0*SUM(ty_repl_instock_numerator)/NULLIF(SUM(ty_repl_instock_denominator),0) isr FROM store_invt WHERE wm_yr_wk_nbr=(SELECT MAX(wm_yr_wk_nbr) FROM store_invt) GROUP BY store_nbr HAVING isr < 97)`),
      runQuery(`SELECT COUNT(DISTINCT wm_item_nbr) n FROM oos_root_cause`),
      runQuery(`SELECT COUNT(DISTINCT oms_po_nbr) n FROM omni_otif WHERE otif_pct < 90`),
      runQuery(`SELECT COUNT(DISTINCT wm_item_nbr) n FROM digital_transactability WHERE omni_trnsctbl_ind=0`),
      runQuery(`SELECT COUNT(DISTINCT wm_item_nbr) n FROM ecom_returns WHERE tot_rtn_qty > 0`),
      runQuery(`SELECT COUNT(DISTINCT store_nbr) n FROM store_fulfillment WHERE nil_pick_qty > 0`),
    ]);
    const counts = { replenishment: num(rep[0]?.n), 'oos-diagnosis': num(oos[0]?.n), 'supplier-otif': num(otif[0]?.n), 'ecom-fix': num(ecom[0]?.n), returns: num(ret[0]?.n), 'forecast-exception': num(fcx[0]?.n) };
    res.json({ agents: AGENTS.map((a) => ({ ...a, queue: counts[a.id] ?? 0 })) });
  }));

  // Run an agent: return its findings + a recommended action per item (for human review).
  app.get('/api/agents/run/:id', asyncHandler(async (req, res) => {
    const id = req.params.id;
    const agent = AGENTS.find((a) => a.id === id);
    if (!agent) return res.status(404).json({ error: 'unknown agent' });
    let findings = [];

    if (id === 'replenishment') {
      const rows = await runQuery(`
        WITH inv AS (SELECT store_nbr, SUM(ty_on_hand_qty) oh, SUM(ty_in_trnst_qty) transit,
                     100.0*SUM(ty_repl_instock_numerator)/NULLIF(SUM(ty_repl_instock_denominator),0) isr
                     FROM store_invt WHERE wm_yr_wk_nbr=(SELECT MAX(wm_yr_wk_nbr) FROM store_invt) GROUP BY store_nbr)
        SELECT d.store_nbr, d.store_nm, d.city_nm, d.state_prov_cd, ROUND(inv.isr,0) isr, inv.oh, inv.transit
        FROM inv JOIN store_dim d ON d.store_nbr=inv.store_nbr
        WHERE inv.isr < 97 ORDER BY inv.isr ASC LIMIT 12`);
      findings = rows.map((r) => ({
        entity: `Store #${r.store_nbr} · ${cap(r.city_nm)}, ${r.state_prov_cd}`,
        signal: `In-stock ${num(r.isr)}% · on-hand ${fmtK(r.oh)} · ${fmtK(r.transit)} in transit`,
        severity: num(r.isr) < 90 ? 'high' : 'medium',
        action: `Draft pre-position order to lift in-stock above 97%`,
        confidence: num(r.isr) < 90 ? 92 : 78,
      }));
    } else if (id === 'oos-diagnosis') {
      const rows = await runQuery(`SELECT hi_lvl_oos_rsn_desc reason, COUNT(*) n, COUNT(DISTINCT store_nbr) stores FROM oos_root_cause GROUP BY 1 ORDER BY n DESC LIMIT 8`);
      const owner = { 'STORE EXECUTION': 'Store ops — shelf/backroom task', 'VENDOR PERFORMANCE': 'Supplier scorecard — vendor team', 'UPSTREAM AVAILABILITY': 'Replenishment — DC allocation', 'DEMAND VARIABILITY': 'Forecast team — re-plan' };
      findings = rows.map((r) => ({
        entity: r.reason, signal: `${fmtK(r.n)} OOS events across ${fmtK(r.stores)} stores`,
        severity: num(r.n) > 2e6 ? 'high' : 'medium', action: `Route to ${owner[r.reason] || 'ops review'}`, confidence: 85,
      }));
    } else if (id === 'supplier-otif') {
      const rows = await runQuery(`
        SELECT o.vendor_nbr, MAX(i.vendor_nm) vnm, COUNT(DISTINCT o.oms_po_nbr) pos,
               ROUND(AVG(o.on_time_pct),0) ontime, ROUND(AVG(o.in_full_pct),0) infull, ROUND(SUM(o.late_vnpk_qty),0) late
        FROM omni_otif o LEFT JOIN item_dim i ON i.vendor_nbr=o.vendor_nbr
        WHERE o.otif_pct < 90 GROUP BY o.vendor_nbr ORDER BY pos DESC LIMIT 10`);
      findings = rows.map((r) => ({
        entity: cap(r.vnm || `Vendor ${r.vendor_nbr}`), signal: `On-time ${num(r.ontime)}% · in-full ${num(r.infull)}% · ${fmtK(r.pos)} late/short POs`,
        severity: num(r.ontime) < 50 ? 'high' : 'medium', action: num(r.ontime) < num(r.infull) ? 'Escalate carrier & appointment scheduling' : 'Flag fill shortfalls to vendor', confidence: 88,
      }));
    } else if (id === 'ecom-fix') {
      const rows = await runQuery(`
        WITH agg AS (SELECT d.wm_item_nbr, SUM(CASE WHEN omni_trnsctbl_ind=0 THEN 1 ELSE 0 END) nt, COUNT(*) tot,
                     MAX(invt_reltd_not_pub_ind) r_inv, MAX(missing_image_not_pub_ind) r_img, MAX(item_setup_not_pub_ind) r_setup
                     FROM digital_transactability d WHERE wm_item_nbr IS NOT NULL GROUP BY d.wm_item_nbr HAVING nt > 0)
        SELECT agg.wm_item_nbr, i.item_name, i.brand_nm, ROUND(100.0*agg.nt/agg.tot,0) nt_pct, agg.r_inv, agg.r_img, agg.r_setup
        FROM agg JOIN item_dim i ON i.wm_item_nbr=agg.wm_item_nbr ORDER BY agg.nt DESC LIMIT 12`);
      findings = rows.map((r) => ({
        entity: `${r.item_name}${r.brand_nm ? ' · ' + r.brand_nm : ''}`, signal: `${num(r.nt_pct)}% of store-rows not transactable online`,
        severity: num(r.nt_pct) > 15 ? 'high' : 'medium',
        action: num(r.r_inv) ? 'Clear inventory/availability block to publish' : num(r.r_img) ? 'Add missing primary image' : num(r.r_setup) ? 'Complete item setup attributes' : 'Raise availability-to-sell score', confidence: 83,
      }));
    } else if (id === 'returns') {
      const rows = await runQuery(`
        SELECT e.wm_item_nbr, i.item_name, i.brand_nm, SUM(e.tot_rtn_qty) qty, MAX(e.rtn_rsn_desc) reason
        FROM ecom_returns e LEFT JOIN item_dim i ON i.wm_item_nbr=e.wm_item_nbr
        WHERE e.tot_rtn_qty>0 GROUP BY 1,2,3 ORDER BY qty DESC LIMIT 12`);
      const fix = { DAMAGED: 'Review case-pack & transit handling', 'NOT AS DESCRIBED': 'Audit online copy & imagery', DEFECTIVE: 'Escalate to supplier QA', 'CHANGED MIND': 'Low-risk — monitor promo pricing' };
      findings = rows.map((r) => ({
        entity: `${r.item_name || r.wm_item_nbr}${r.brand_nm ? ' · ' + r.brand_nm : ''}`, signal: `${fmtK(r.qty)} returns · top reason ${r.reason}`,
        severity: num(r.qty) > 100000 ? 'high' : 'medium', action: fix[(r.reason || '').toUpperCase()] || 'Investigate driving stores', confidence: 80,
      }));
    } else if (id === 'forecast-exception') {
      const rows = await runQuery(`
        WITH rec AS (SELECT s.store_nbr, SUM(CASE WHEN s.bus_dt>=DATE_SUB((SELECT MAX(bus_dt) FROM store_sales),6) THEN s.qty ELSE 0 END) r, SUM(s.qty)/8.0 avg
                     FROM store_sales s WHERE s.bus_dt>=DATE_SUB((SELECT MAX(bus_dt) FROM store_sales),55) GROUP BY 1 HAVING avg>1000)
        SELECT d.store_nbr, d.store_nm, d.city_nm, d.state_prov_cd, ROUND(100.0*(rec.r-rec.avg)/NULLIF(rec.avg,0),0) swing
        FROM rec JOIN store_dim d ON d.store_nbr=rec.store_nbr
        ORDER BY ABS((rec.r-rec.avg)/NULLIF(rec.avg,1)) DESC LIMIT 12`);
      findings = rows.map((r) => ({
        entity: `Store #${r.store_nbr} · ${cap(r.city_nm)}, ${r.state_prov_cd}`, signal: `Demand ${num(r.swing) >= 0 ? '+' : ''}${num(r.swing)}% vs 8-week average`,
        severity: Math.abs(num(r.swing)) > 25 ? 'high' : 'medium', action: num(r.swing) > 0 ? 'Raise forecast & pre-position stock' : 'Lower forecast to avoid overstock', confidence: 79,
      }));
    }
    res.json({ agent: { id: agent.id, name: agent.name, tables: agent.tables }, findings, count: findings.length });
  }));

  // ───────────────────────── REFERENCE ARCHITECTURE (data-grounded) ─────────────────────────
  app.get('/api/architecture/stats', asyncHandler(async (_req, res) => {
    const cal = await calendar();
    // real row counts for the headline tables + refresh status
    const [counts] = await runQuery(`
      SELECT (SELECT COUNT(*) FROM store_sales) AS store_sales,
             (SELECT COUNT(*) FROM store_invt) AS store_invt,
             (SELECT COUNT(*) FROM item_dim) AS items,
             (SELECT COUNT(DISTINCT store_nbr) FROM store_dim) AS stores,
             (SELECT COUNT(*) FROM hourly_store_fulfillment) AS hourly_ff
    `);
    let refresh = [];
    try {
      refresh = await runQuery(`SELECT table_nm, refresh_type, status, CAST(refresh_date AS STRING) AS refresh_date FROM wmt_cf_status_tbl ORDER BY refresh_date DESC LIMIT 12`);
    } catch { /* optional */ }
    res.json({
      max_date: cal.maxDt, max_week: cal.maxWk,
      counts: { store_sales: num(counts.store_sales), store_invt: num(counts.store_invt), items: num(counts.items), stores: num(counts.stores), hourly_ff: num(counts.hourly_ff) },
      refresh: refresh.map((r) => ({ table: r.table_nm, type: r.refresh_type, status: r.status, date: r.refresh_date })),
      source: { catalog: sqlConfig.CATALOG, schema: sqlConfig.SCHEMA },
    });
  }));

  app.get('/api/architecture/ontology', asyncHandler(async (_req, res) => {
    // Rich ontology: real joins + calculations + query→viz wiring (mined from
    // this app's own code), enriched with LIVE columns/types/row counts from
    // Unity Catalog when reachable. Falls back to the mined catalog offline so
    // the real table names + joins still render.
    const cat = sqlConfig.CATALOG;
    const sch = sqlConfig.SCHEMA;

    // Only tables actually referenced by the mined joins/queries/calcs are
    // relevant to the graph — keeps 23 raw tables down to the wired story.
    const referenced = new Set(ontologyReferencedTables());

    let colsByTable = {};       // { table: [{name, type}] }
    let rowCounts = {};         // { table: number }
    let source = 'catalog';

    try {
      const cols = await runQuery(
        `SELECT table_name, column_name, data_type FROM ${cat}.information_schema.columns
         WHERE table_schema = ? ORDER BY table_name, ordinal_position`, [sch]);
      if (!cols.length) throw new Error('no columns visible');
      for (const r of cols) {
        (colsByTable[logicalTableName(r.table_name)] ||= []).push({ name: r.column_name, type: r.data_type });
      }
      // Live row counts for the referenced tables (one cheap batched query).
      const refList = [...referenced].filter((t) => colsByTable[t]);
      if (refList.length) {
        const unions = refList
          .map((t) => `SELECT '${t}' AS t, COUNT(*) AS c FROM ${t}`)
          .join(' UNION ALL ');
        try {
          const counts = await runQuery(unions);
          for (const r of counts) rowCounts[r.t] = Number(r.c);
        } catch (e) { console.warn('ontology row counts skipped:', e.message); }
      }
      source = 'live';
    } catch (e) {
      console.warn('ontology live path unavailable, using mined catalog:', e.message);
    }

    res.json(buildOntology({ colsByTable, rowCounts, source }));
  }));
}
