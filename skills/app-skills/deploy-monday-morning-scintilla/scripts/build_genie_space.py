#!/usr/bin/env python3
"""Build the Monday Morning Genie Space as a deterministic serialized_space v2 document.

The space covers the Scintilla tables behind every question the App sends to Genie. Table
names go through the same table map the App uses, so a customer's differently
named tables need no views. Instructions, joins, and example SQL encode the
App's own definitions (net sales, in-stock rate, category, channels) so Genie
answers the App's questions directly instead of asking for clarification.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

TITLE = "Monday Morning Sales"
DESCRIPTION = """Retail performance for a consumer brand selling through Walmart, built on Scintilla Cloud Feeds: daily store and item sales by channel, store inventory and in-stock, store and e-commerce returns, item and store attributes.

**Capabilities:**
- Net sales, units, and average unit retail by category, brand, item, store, channel, and Walmart week.
- Period-over-period growth, such as the last 4 weeks versus the prior 4.
- Store in-stock rates from replenishment in-stock measures, and on-hand days of supply.
- Return volume, amounts, and rate, and e-commerce return reasons by item.
- Customer ratings and review counts by item.

**Limitations:**
- Store returns carry reason codes only; reason descriptions come from e-commerce returns.
- Inventory by store location area (sales floor, backroom), forecasts, and purchase orders are not in this space."""

# Tables the App's Ask Genie prompts rely on, with what Genie needs to know about each.
TABLES = {
    "store_sales": (
        "Daily store x item sales by channel. sales_amt is net sales in dollars, qty is units, aur is average unit "
        "retail, scan_cnt is scans. bus_dt is the business date and wm_yr_wk_nbr the Walmart fiscal week. "
        "svc_chnl_nm is the channel: BIS is in-store; PICKUP, DELIVERY, and SFS (ship from store) are e-commerce. "
        "vendor_nbr and vendor_nm identify the supplier."
    ),
    "item_dim": (
        "Item master keyed by wm_item_nbr. omni_dept_desc is the category the App shows (for example BEAUTY, "
        "OTC PHARMACY); omni_catg_desc is the subcategory, omni_subcatg_desc the next level, brand_nm the brand, "
        "item_name the item. vendor_nbr and vendor_nm identify the supplier."
    ),
    "omni_item_dim": (
        "Omnichannel item attributes, one row per wm_item_nbr. Use it only for customer ratings: cust_ratg_avg_val "
        "is the average rating (1 to 5) and cust_ratg_cnt the number of reviews. Use item_dim for every other item "
        "attribute."
    ),
    "store_dim": (
        "Store attributes keyed by store_nbr: store_nm, city_nm, state_prov_cd, region_nm, market_nm, and "
        "open_status_desc."
    ),
    "store_invt": (
        "Store x item inventory, one snapshot per business date. In-stock rate is 100 * SUM(ty_repl_instock_numerator) / "
        "SUM(ty_repl_instock_denominator). ty_on_hand_qty is units on hand in the store, ty_in_trnst_qty units in transit "
        "to it, ty_in_whse_qty units in Walmart distribution centers (DC), and ty_on_order_qty units on order. "
        "bkrm_adj_qty is a backroom adjustment, not backroom stock. "
        "'Right now' means the latest bus_dt in this table."
    ),
    "store_returns": (
        "Store returns by return date (rtn_dt): rtn_qty units and rtn_sales_amt dollars, with a numeric reason "
        "code rtn_rsn_cd only."
    ),
    "ecom_returns": (
        "E-commerce returns by bus_dt: rtn_rsn_desc is the return reason, tot_rtn_qty units and tot_rtn_amt "
        "dollars returned, keyed to items by wm_item_nbr. It has no vendor column; filter a supplier through "
        "item_dim.vendor_nbr."
    ),
}

INSTRUCTIONS = [
    "Sales means net sales dollars (store_sales.sales_amt) unless the question asks for units (qty).",
    "When no time range is given, use the most recent 4 full weeks; when comparing, compare them with the prior 4 "
    "weeks. 'Right now', 'current', and 'latest' mean the latest bus_dt in the table being queried.",
    "Category means item_dim.omni_dept_desc. Subcategory means omni_catg_desc. Brand means brand_nm.",
    "E-commerce sales are channels PICKUP, DELIVERY, and SFS; in-store sales are channel BIS.",
    "Return reasons come from ecom_returns.rtn_rsn_desc. Store returns have codes only. Return rate is "
    "100 * SUM(store_returns.rtn_sales_amt) / SUM(store_sales.sales_amt) over the same dates (rtn_dt and bus_dt).",
    "Days of supply is on-hand units on the latest store_invt bus_dt divided by average daily units sold over the "
    "last 28 days. store_invt holds one snapshot per day, so never add on-hand units across dates.",
    "Rank lowest-rated items among those with more than 20 reviews (omni_item_dim.cust_ratg_cnt > 20).",
    "This space has no store location areas (sales floor, backroom, receiving). For location questions, say that detail "
    "is not recorded and show the supply pipeline by item instead: DC, in transit, on hand, and on order. Never relabel "
    "store_invt columns as location areas.",
    "For lowest, highest, top, bottom, best, or worst stores, items, or SKUs, return only the first 20 rows "
    "(ORDER BY the measure, then LIMIT 20) unless the question asks for another number. Category breakdowns may "
    "list every category.",
    "Use wm_yr_wk_nbr for weekly trends and label weeks with their first business date.",
    "Trends over time are totals per week or month unless the question names categories, brands, stores, or channels.",
    "Answer directly with these defaults. Do not ask a clarifying question when a default applies.",
]


# Every fixed question the App sends to Genie: the Ask Genie prompts and suggestions, and the Sales page card
# and KPI buttons. KPI questions that embed live values are omitted. tests/test_genie_space.py keeps this in
# step with the App source.
APP_QUESTIONS = (
    "Which categories grew or declined the most over the last 4 weeks versus the prior 4 weeks?",
    "Which stores have the lowest in-stock rate right now?",
    "What are my top return reasons, and which items drive them?",
    "How have weekly sales trended over the last 13 weeks?",
    "What were my total sales by category over the last 4 weeks?",
    "How do e-commerce sales compare to in-store sales over the last 4 weeks?",
    "How do brick-and-mortar store sales compare over the last 4 weeks versus the prior 4 weeks, and which stores are "
    "underperforming?",
    "Break down e-commerce sales by channel (delivery, pickup, ship-from-store) over the last 4 weeks, and show the "
    "trend versus the prior 4 weeks.",
    "How have units sold trended over the last 13 weeks, and how does that compare to the dollar sales trend?",
    "How has average unit retail changed over the last 4 weeks versus the prior 4 weeks, and which categories are "
    "seeing the biggest price moves?",
    "How has scan count (customer traffic) trended over the last 13 weeks, and how does it track with sales?",
    "Where are the biggest on-shelf availability gaps right now, and how much sales are they putting at risk?",
    "Show on-hand inventory by store location area (sales floor, backroom, receiving) for my top items. Where is "
    "stock sitting off the sales floor?",
    "Compare sales across channels (in-store, delivery, pickup, ship-from-store) with average unit retail, and show "
    "which channel is growing fastest.",
    "Show the monthly sales trend and call out the inflection points — which months over- or under-performed and why?",
    "Break down sales by category and rank them, showing each category's share of total and its growth vs the prior "
    "period.",
    "Which stores have the highest sales but lowest in-stock — where am I leaving the most sales on the table due to "
    "availability?",
    "What are my top-moving SKUs by sales growth, and what is driving their momentum — promo, seasonality, or "
    "distribution?",
    "Which SKUs are underperforming the most vs the prior period, and what is the likely cause for each — price, "
    "availability, or demand?",
    "Which categories have too few or too many days of on-hand supply, and where should I rebalance inventory?",
    "What is my return rate and the top return reasons? Which SKUs and categories drive the most returns, and what "
    "should I do about it?",
    "Which items have the lowest ratings and most negative reviews, and are those quality issues showing up in "
    "returns too?",
)
# The App appends this to every question (GENIE_GUIDANCE in api/routes.scintilla.js).
APP_GUIDANCE = (
    ' [Answering guidance: interpret "the prior period" or any unspecified time range as the most recent 4 full '
    'weeks compared with the prior 4 weeks. When the question asks about categories, use the category level, not '
    'subcategories; otherwise do not split the answer by category. Give your best answer directly using sensible '
    'defaults; do NOT reply with a clarifying question.]'
)


def stable_id(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:32]


def physical_tables(catalog: str, schema: str, table_map: dict) -> dict[str, str]:
    """Fully qualified table names after the App's table map."""
    resolved = {}
    for name in TABLES:
        target = table_map.get(name, name)
        if isinstance(target, dict):
            raise SystemExit(
                f"{name} is mapped to a SELECT; a Genie Space needs a real table. Map it to a table or view."
            )
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", str(target)):
            raise SystemExit(f"Invalid table name for {name}: {target}")
        resolved[name] = f"{catalog}.{schema}.{target}"
    return resolved


def examples(t: dict[str, str]) -> list[tuple[str, str, str]]:
    """(question, SQL, guidance) pairs; the first four are the App's Ask Genie prompts."""
    return [
        (
            "Which categories grew or declined the most over the last 4 weeks versus the prior 4 weeks?",
            f"WITH b AS (SELECT MAX(bus_dt) AS d FROM {t['store_sales']}) "
            f"SELECT i.omni_dept_desc AS category, "
            f"ROUND(SUM(CASE WHEN s.bus_dt > DATE_SUB(b.d, 28) THEN s.sales_amt END), 0) AS last_4_weeks_sales, "
            f"ROUND(SUM(CASE WHEN s.bus_dt <= DATE_SUB(b.d, 28) THEN s.sales_amt END), 0) AS prior_4_weeks_sales, "
            f"ROUND(100 * (SUM(CASE WHEN s.bus_dt > DATE_SUB(b.d, 28) THEN s.sales_amt END) / "
            f"NULLIF(SUM(CASE WHEN s.bus_dt <= DATE_SUB(b.d, 28) THEN s.sales_amt END), 0) - 1), 1) AS change_pct "
            f"FROM {t['store_sales']} s CROSS JOIN b JOIN {t['item_dim']} i ON s.wm_item_nbr = i.wm_item_nbr "
            f"WHERE s.bus_dt > DATE_SUB(b.d, 56) GROUP BY i.omni_dept_desc ORDER BY change_pct DESC",
            "Category growth: last 4 weeks versus the prior 4, from the latest business date.",
        ),
        (
            "Which stores have the lowest in-stock rate right now?",
            f"WITH b AS (SELECT MAX(bus_dt) AS d FROM {t['store_invt']}) "
            f"SELECT v.store_nbr, d.store_nm, d.city_nm, d.state_prov_cd, "
            f"ROUND(100 * SUM(v.ty_repl_instock_numerator) / NULLIF(SUM(v.ty_repl_instock_denominator), 0), 1) AS in_stock_pct "
            f"FROM {t['store_invt']} v CROSS JOIN b LEFT JOIN {t['store_dim']} d ON v.store_nbr = d.store_nbr "
            f"WHERE v.bus_dt = b.d GROUP BY v.store_nbr, d.store_nm, d.city_nm, d.state_prov_cd "
            f"HAVING SUM(v.ty_repl_instock_denominator) > 0 ORDER BY in_stock_pct ASC LIMIT 20",
            "In-stock rate on the latest inventory date, lowest first.",
        ),
        (
            "What are my top return reasons, and which items drive them?",
            f"WITH b AS (SELECT MAX(bus_dt) AS d FROM {t['ecom_returns']}) "
            f"SELECT r.rtn_rsn_desc AS return_reason, i.item_name, i.brand_nm, "
            f"SUM(r.tot_rtn_qty) AS units_returned, ROUND(SUM(r.tot_rtn_amt), 0) AS amount_returned "
            f"FROM {t['ecom_returns']} r CROSS JOIN b LEFT JOIN {t['item_dim']} i ON r.wm_item_nbr = i.wm_item_nbr "
            f"WHERE r.bus_dt > DATE_SUB(b.d, 28) AND r.rtn_rsn_desc IS NOT NULL "
            f"GROUP BY r.rtn_rsn_desc, i.item_name, i.brand_nm ORDER BY units_returned DESC LIMIT 25",
            "E-commerce return reasons by item over the last 4 weeks.",
        ),
        (
            "How have weekly sales trended over the last 13 weeks?",
            f"SELECT wm_yr_wk_nbr AS walmart_week, MIN(bus_dt) AS week_start, ROUND(SUM(sales_amt), 0) AS net_sales, "
            f"SUM(qty) AS units, SUM(scan_cnt) AS scans FROM {t['store_sales']} "
            f"WHERE bus_dt > DATE_SUB((SELECT MAX(bus_dt) FROM {t['store_sales']}), 91) "
            f"GROUP BY wm_yr_wk_nbr ORDER BY walmart_week",
            "Weekly totals of net sales, units, and scans for the last 13 weeks; also answers units and scan-count trends.",
        ),
        (
            "What were my total sales by category over the last 4 weeks?",
            f"SELECT i.omni_dept_desc AS category, ROUND(SUM(s.sales_amt), 0) AS net_sales, SUM(s.qty) AS units "
            f"FROM {t['store_sales']} s JOIN {t['item_dim']} i ON s.wm_item_nbr = i.wm_item_nbr "
            f"WHERE s.bus_dt > DATE_SUB((SELECT MAX(bus_dt) FROM {t['store_sales']}), 28) "
            f"GROUP BY i.omni_dept_desc ORDER BY net_sales DESC",
            "Net sales by category for the last 4 weeks.",
        ),
        (
            "How do e-commerce sales compare to in-store sales over the last 4 weeks?",
            f"SELECT CASE WHEN svc_chnl_nm = 'BIS' THEN 'In-store' ELSE 'E-commerce' END AS channel_group, "
            f"ROUND(SUM(sales_amt), 0) AS net_sales, SUM(qty) AS units FROM {t['store_sales']} "
            f"WHERE bus_dt > DATE_SUB((SELECT MAX(bus_dt) FROM {t['store_sales']}), 28) "
            f"GROUP BY 1 ORDER BY net_sales DESC",
            "In-store (BIS) versus e-commerce (PICKUP, DELIVERY, SFS) net sales.",
        ),
        # Exact App questions that Genie otherwise tends to split by category.
        (
            "How do brick-and-mortar store sales compare over the last 4 weeks versus the prior 4 weeks, and which "
            "stores are underperforming?",
            f"WITH b AS (SELECT MAX(bus_dt) AS d FROM {t['store_sales']}), "
            f"s AS (SELECT s.store_nbr, SUM(CASE WHEN s.bus_dt > DATE_SUB(b.d, 28) THEN s.sales_amt END) AS last_4, "
            f"SUM(CASE WHEN s.bus_dt <= DATE_SUB(b.d, 28) THEN s.sales_amt END) AS prior_4 "
            f"FROM {t['store_sales']} s CROSS JOIN b WHERE s.svc_chnl_nm = 'BIS' AND s.bus_dt > DATE_SUB(b.d, 56) "
            f"GROUP BY s.store_nbr) "
            f"SELECT s.store_nbr, d.store_nm, d.city_nm, d.state_prov_cd, ROUND(s.last_4, 0) AS last_4_weeks_sales, "
            f"ROUND(s.prior_4, 0) AS prior_4_weeks_sales, ROUND(100 * (s.last_4 / s.prior_4 - 1), 1) AS change_pct, "
            f"ROUND(100 * (SUM(s.last_4) OVER () / SUM(s.prior_4) OVER () - 1), 1) AS all_stores_change_pct "
            f"FROM s LEFT JOIN {t['store_dim']} d ON s.store_nbr = d.store_nbr WHERE s.prior_4 > 0 "
            f"ORDER BY change_pct ASC LIMIT 20",
            "In-store (BIS) sales by store, last 4 weeks versus prior 4; the 20 weakest stores and the all-store change.",
        ),
        (
            "Break down e-commerce sales by channel (delivery, pickup, ship-from-store) over the last 4 weeks, and show "
            "the trend versus the prior 4 weeks.",
            f"WITH b AS (SELECT MAX(bus_dt) AS d FROM {t['store_sales']}) "
            f"SELECT s.svc_chnl_nm AS channel, "
            f"ROUND(SUM(CASE WHEN s.bus_dt > DATE_SUB(b.d, 28) THEN s.sales_amt END), 0) AS last_4_weeks_sales, "
            f"ROUND(SUM(CASE WHEN s.bus_dt <= DATE_SUB(b.d, 28) THEN s.sales_amt END), 0) AS prior_4_weeks_sales, "
            f"ROUND(100 * (SUM(CASE WHEN s.bus_dt > DATE_SUB(b.d, 28) THEN s.sales_amt END) / "
            f"NULLIF(SUM(CASE WHEN s.bus_dt <= DATE_SUB(b.d, 28) THEN s.sales_amt END), 0) - 1), 1) AS change_pct "
            f"FROM {t['store_sales']} s CROSS JOIN b WHERE s.svc_chnl_nm IN ('DELIVERY', 'PICKUP', 'SFS') "
            f"AND s.bus_dt > DATE_SUB(b.d, 56) GROUP BY s.svc_chnl_nm ORDER BY last_4_weeks_sales DESC",
            "E-commerce channels, last 4 weeks versus prior 4, one row per channel.",
        ),
        (
            "How have units sold trended over the last 13 weeks, and how does that compare to the dollar sales trend?",
            f"SELECT wm_yr_wk_nbr AS walmart_week, MIN(bus_dt) AS week_start, SUM(qty) AS units, "
            f"ROUND(SUM(sales_amt), 0) AS net_sales, ROUND(SUM(sales_amt) / NULLIF(SUM(qty), 0), 2) AS avg_unit_retail "
            f"FROM {t['store_sales']} WHERE bus_dt > DATE_SUB((SELECT MAX(bus_dt) FROM {t['store_sales']}), 91) "
            f"GROUP BY wm_yr_wk_nbr ORDER BY walmart_week",
            "Weekly totals of units and dollars for the last 13 weeks, not split by category.",
        ),
        (
            "How has scan count (customer traffic) trended over the last 13 weeks, and how does it track with sales?",
            f"SELECT wm_yr_wk_nbr AS walmart_week, MIN(bus_dt) AS week_start, SUM(scan_cnt) AS scans, "
            f"ROUND(SUM(sales_amt), 0) AS net_sales, ROUND(SUM(sales_amt) / NULLIF(SUM(scan_cnt), 0), 2) AS sales_per_scan "
            f"FROM {t['store_sales']} WHERE bus_dt > DATE_SUB((SELECT MAX(bus_dt) FROM {t['store_sales']}), 91) "
            f"GROUP BY wm_yr_wk_nbr ORDER BY walmart_week",
            "Weekly totals of scans and sales for the last 13 weeks, not split by category.",
        ),
        (
            "Show the monthly sales trend and call out the inflection points — which months over- or under-performed "
            "and why?",
            f"WITH m AS (SELECT DATE_TRUNC('MONTH', bus_dt) AS month_start, SUM(sales_amt) AS net_sales, SUM(qty) AS units "
            f"FROM {t['store_sales']} "
            f"WHERE bus_dt >= ADD_MONTHS(DATE_TRUNC('MONTH', (SELECT MAX(bus_dt) FROM {t['store_sales']})), -12) "
            f"GROUP BY DATE_TRUNC('MONTH', bus_dt)) "
            f"SELECT DATE(month_start) AS month_start, ROUND(net_sales, 0) AS net_sales, units, "
            f"ROUND(100 * (net_sales / NULLIF(LAG(net_sales) OVER (ORDER BY month_start), 0) - 1), 1) "
            f"AS change_vs_prior_month_pct FROM m ORDER BY month_start",
            "Monthly totals for the last 12 months with month-over-month change; the latest month may be partial.",
        ),
        (
            "Which categories have too few or too many days of on-hand supply, and where should I rebalance inventory?",
            f"WITH vel AS (SELECT i.omni_dept_desc AS category, SUM(s.qty) / 28.0 AS daily_units "
            f"FROM {t['store_sales']} s JOIN {t['item_dim']} i ON s.wm_item_nbr = i.wm_item_nbr "
            f"WHERE s.bus_dt > DATE_SUB((SELECT MAX(bus_dt) FROM {t['store_sales']}), 28) GROUP BY i.omni_dept_desc), "
            f"inv AS (SELECT i.omni_dept_desc AS category, SUM(v.ty_on_hand_qty) AS on_hand_units "
            f"FROM {t['store_invt']} v JOIN {t['item_dim']} i ON v.wm_item_nbr = i.wm_item_nbr "
            f"WHERE v.bus_dt = (SELECT MAX(bus_dt) FROM {t['store_invt']}) GROUP BY i.omni_dept_desc) "
            f"SELECT inv.category, inv.on_hand_units, ROUND(vel.daily_units, 0) AS avg_daily_units, "
            f"ROUND(inv.on_hand_units / NULLIF(vel.daily_units, 0), 1) AS days_of_supply "
            f"FROM inv JOIN vel ON inv.category = vel.category ORDER BY days_of_supply",
            "Days of supply by category: latest on-hand snapshot over average daily units for 28 days.",
        ),
        (
            "Show on-hand inventory by store location area (sales floor, backroom, receiving) for my top items. Where is "
            "stock sitting off the sales floor?",
            f"WITH top AS (SELECT wm_item_nbr, SUM(sales_amt) AS sales FROM {t['store_sales']} "
            f"WHERE bus_dt > DATE_SUB((SELECT MAX(bus_dt) FROM {t['store_sales']}), 28) "
            f"GROUP BY wm_item_nbr ORDER BY sales DESC LIMIT 20) "
            f"SELECT i.item_name, i.brand_nm, ROUND(top.sales, 0) AS last_4_weeks_sales, "
            f"SUM(v.ty_in_whse_qty) AS in_distribution_centers, SUM(v.ty_in_trnst_qty) AS in_transit_to_stores, "
            f"SUM(v.ty_on_hand_qty) AS on_hand_in_stores, SUM(v.ty_on_order_qty) AS on_order "
            f"FROM top JOIN {t['store_invt']} v ON v.wm_item_nbr = top.wm_item_nbr "
            f"JOIN {t['item_dim']} i ON i.wm_item_nbr = top.wm_item_nbr "
            f"WHERE v.bus_dt = (SELECT MAX(bus_dt) FROM {t['store_invt']}) "
            f"GROUP BY i.item_name, i.brand_nm, top.sales ORDER BY last_4_weeks_sales DESC LIMIT 20",
            "Location areas are not recorded; show the supply pipeline for the top 20 items by sales instead.",
        ),
        (
            "Which items have the lowest ratings and most negative reviews, and are those quality issues showing up "
            "in returns too?",
            f"WITH b AS (SELECT MAX(bus_dt) AS d FROM {t['ecom_returns']}), "
            f"r AS (SELECT r.wm_item_nbr, SUM(r.tot_rtn_qty) AS units_returned, ROUND(SUM(r.tot_rtn_amt), 0) AS amount_returned "
            f"FROM {t['ecom_returns']} r CROSS JOIN b WHERE r.bus_dt > DATE_SUB(b.d, 28) GROUP BY r.wm_item_nbr) "
            f"SELECT o.item_name, o.brand_nm, ROUND(o.cust_ratg_avg_val, 1) AS avg_rating, "
            f"CAST(o.cust_ratg_cnt AS BIGINT) AS reviews, COALESCE(r.units_returned, 0) AS units_returned_4_weeks, "
            f"COALESCE(r.amount_returned, 0) AS amount_returned_4_weeks "
            f"FROM {t['omni_item_dim']} o LEFT JOIN r ON o.wm_item_nbr = r.wm_item_nbr "
            f"WHERE o.cust_ratg_cnt > 20 ORDER BY o.cust_ratg_avg_val ASC, o.cust_ratg_cnt DESC LIMIT 20",
            "Lowest-rated items with more than 20 reviews, and their e-commerce returns over the last 4 weeks.",
        ),
    ]


def build(catalog: str, schema: str, table_map: dict) -> dict:
    t = physical_tables(catalog, schema, table_map)
    pairs = examples(t)
    joins = [
        ("store_sales", "item_dim", "wm_item_nbr", "Sales to item attributes."),
        ("store_sales", "store_dim", "store_nbr", "Sales to store attributes."),
        ("store_invt", "store_dim", "store_nbr", "Inventory to store attributes."),
        ("store_invt", "item_dim", "wm_item_nbr", "Inventory to item attributes."),
        ("store_returns", "item_dim", "wm_item_nbr", "Store returns to item attributes."),
        ("store_returns", "store_dim", "store_nbr", "Store returns to store attributes."),
        ("ecom_returns", "item_dim", "wm_item_nbr", "E-commerce returns to item attributes."),
        ("ecom_returns", "omni_item_dim", "wm_item_nbr", "E-commerce returns to item ratings."),
    ]
    return {
        "version": 2,
        "config": {"sample_questions": sorted(
            ({"id": stable_id(f"sample:{q}"), "question": [q]} for q, _, _ in pairs[:4]),
            key=lambda item: item["id"],
        )},
        "data_sources": {"tables": sorted(
            ({"identifier": t[name], "description": [text]} for name, text in TABLES.items()),
            key=lambda item: item["identifier"],
        )},
        "instructions": {
            "text_instructions": [{"id": stable_id("instructions:monday-morning"), "content": [line + "\n" for line in INSTRUCTIONS]}],
            "example_question_sqls": sorted(({
                "id": stable_id(f"example:{q}"), "question": [q], "sql": [sql], "usage_guidance": [g], "parameters": [],
            } for q, sql, g in pairs), key=lambda item: item["id"]),
            "join_specs": sorted(({
                "id": stable_id(f"join:{left}:{right}"),
                "left": {"identifier": t[left], "alias": left},
                "right": {"identifier": t[right], "alias": right},
                "sql": [f"`{left}`.`{key}` = `{right}`.`{key}`", "--rt=FROM_RELATIONSHIP_TYPE_MANY_TO_ONE--"],
                "instruction": [note],
            } for left, right, key, note in joins), key=lambda item: item["id"]),
        },
        "benchmarks": {"questions": sorted(({
            "id": stable_id(f"benchmark:{q}"), "question": [q], "answer": [{"format": "SQL", "content": [sql]}],
        } for q, sql, _ in pairs), key=lambda item: item["id"])},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", required=True, help="Catalog the App reads")
    parser.add_argument("--schema", required=True, help="Schema the App reads")
    parser.add_argument("--table-map", type=Path, help="The same table-map.json passed to render_app.py")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    table_map = json.loads(args.table_map.read_text(encoding="utf-8")) if args.table_map else {}
    space = build(args.catalog, args.schema, table_map)
    args.output.write_text(json.dumps(space, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "title": TITLE,
        "tables": [item["identifier"] for item in space["data_sources"]["tables"]],
        "examples": len(space["instructions"]["example_question_sqls"]),
        "benchmarks": len(space["benchmarks"]["questions"]),
    }, indent=2))


if __name__ == "__main__":
    main()
