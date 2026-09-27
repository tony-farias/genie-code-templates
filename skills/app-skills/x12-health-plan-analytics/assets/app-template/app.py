from __future__ import annotations

from datetime import date
import logging
from pathlib import Path
import re
from typing import Any, Optional

from databricks.sdk import WorkspaceClient
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from server.analytics import (
    Basis,
    benchmark_cte,
    minimum_claims,
    minimum_codes,
    tier_case,
    validate_basis,
)
from server.config import (
    app_workspace_client,
    load_config,
    quoted_table,
    source_name,
    threshold,
    viewer_workspace_client,
)
from server.genie import ask as ask_genie
from server.sql import as_float, as_int, execute


ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend" / "dist"
PROVIDER_PATTERN = re.compile(r"[A-Za-z0-9_.-]{1,128}")
TIER_COLORS = {"High": "#C62828", "Medium": "#E65100", "Low": "#2E7D32"}
LOGGER = logging.getLogger("x12_health_plan_analytics")

app = FastAPI(title="Health Plan Analytics", version="1.0.1")


def _basis(value: str) -> Basis:
    try:
        return validate_basis(value)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


def _provider(value: str) -> str:
    if not PROVIDER_PATTERN.fullmatch(value):
        raise HTTPException(status_code=400, detail="Invalid provider identifier")
    return value


def _analytics_error(error: Exception) -> HTTPException:
    LOGGER.exception("Curated analytics request failed (%s)", type(error).__name__)
    return HTTPException(status_code=502, detail="Curated analytics are temporarily unavailable")


def _require_feature(name: str) -> None:
    if not bool(load_config().get("features", {}).get(name, True)):
        raise HTTPException(status_code=404, detail=f"Feature not enabled: {name}")


def _tier(peer_ratio: float) -> str:
    if peer_ratio >= threshold("high_peer_ratio", 1.5):
        return "High"
    if peer_ratio >= threshold("medium_peer_ratio", 1.2):
        return "Medium"
    return "Low"


def _round(value: Any, digits: int = 2) -> float:
    return round(as_float(value), digits)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "template_version": str(load_config()["template_version"])}


@app.get("/api/meta")
def meta() -> dict[str, Any]:
    config = load_config()
    branding = config.get("branding", {})
    return {
        "product_name": branding.get("product_name", "FWA Shield"),
        "plan_name": branding.get("plan_name", "Health Plan Analytics"),
        "segment": branding.get("segment", "Governed X12 claims and payment analytics"),
        "template_version": config["template_version"],
        "source": source_name(),
        "genie_url": config.get("genie_url"),
        "features": config.get(
            "features",
            {
                "provider_analysis": True,
                "letters": True,
                "embedded_genie": True,
                "member_utilization": True,
            },
        ),
    }


@app.get("/api/dashboard")
def dashboard(request: Request, basis: str = "procedure") -> dict[str, Any]:
    selected = _basis(basis)
    client = app_workspace_client()
    cte = benchmark_cte(selected)
    try:
        totals = execute(
            client,
            f"""
            {cte}
            SELECT COUNT(DISTINCT pc.provider) AS providers,
                   COUNT(*) AS code_rows,
                   SUM(pc.claims) AS claims,
                   SUM(pc.total_cost) AS cost,
                   SUM(CASE WHEN pc.avg_cost > b.benchmark_p75 THEN 1 ELSE 0 END) AS above_p75,
                   SUM(CASE WHEN pc.avg_cost > b.benchmark_avg
                            THEN (pc.avg_cost - b.benchmark_avg) * pc.claims ELSE 0 END) AS excess_cost
            FROM provider_codes pc
            JOIN benchmarks b USING (code)
            """,
        )
        total = totals[0] if totals else {}
        code_rows = as_int(total.get("code_rows"))
        above_p75 = as_int(total.get("above_p75"))

        tier_rows = execute(
            client,
            f"""
            {cte}, qualified AS (
                SELECT *, avg_cost / NULLIF(benchmark_avg, 0) AS peer_ratio
                FROM provider_metrics
                WHERE codes >= {minimum_codes()} AND claims >= {minimum_claims()}
            )
            SELECT {tier_case()} AS tier,
                   COUNT(*) AS providers,
                   SUM(cost) AS cost
            FROM qualified
            GROUP BY 1
            """,
        )
        tier_by_name = {str(row["tier"]): row for row in tier_rows}
        tier_total = sum(as_int(row.get("providers")) for row in tier_rows) or 1
        tiers = []
        for name in ("High", "Medium", "Low"):
            row = tier_by_name.get(name, {})
            providers = as_int(row.get("providers"))
            tiers.append(
                {
                    "tier": name,
                    "providers": providers,
                    "cost": _round(row.get("cost"), 0),
                    "color": TIER_COLORS[name],
                    "share": round(providers / tier_total * 100, 1),
                }
            )

        top_codes = execute(
            client,
            f"""
            {cte}
            SELECT pc.code,
                   COUNT(DISTINCT pc.provider) AS providers,
                   SUM(pc.claims) AS claims,
                   SUM(CASE WHEN pc.avg_cost > b.benchmark_avg
                            THEN (pc.avg_cost - b.benchmark_avg) * pc.claims ELSE 0 END) AS excess
            FROM provider_codes pc
            JOIN benchmarks b USING (code)
            GROUP BY pc.code
            ORDER BY excess DESC
            LIMIT 8
            """,
        )

        providers_table = quoted_table("providers")
        outliers = execute(
            client,
            f"""
            {cte}, qualified AS (
                SELECT *, avg_cost / NULLIF(benchmark_avg, 0) AS peer_ratio
                FROM provider_metrics
                WHERE codes >= {minimum_codes()} AND claims >= {minimum_claims()}
            )
            SELECT q.provider,
                   p.provider_name,
                   q.codes,
                   q.claims,
                   q.cost,
                   q.hot,
                   q.avg_cost,
                   q.benchmark_avg,
                   q.peer_ratio,
                   {tier_case('q.peer_ratio')} AS tier
            FROM qualified q
            LEFT JOIN {providers_table} p ON q.provider = p.provider_key
            ORDER BY q.peer_ratio DESC, q.cost DESC
            LIMIT 25
            """,
        )

        quality_rows = execute(
            client,
            f"""
            SELECT transaction_type, status, record_count
            FROM {quoted_table('data_quality')}
            ORDER BY transaction_type, status
            """,
        )
    except Exception as error:
        raise _analytics_error(error) from error

    return {
        "basis": selected,
        "kpis": {
            "providers": as_int(total.get("providers")),
            "codeRows": code_rows,
            "claims": as_int(total.get("claims")),
            "cost": _round(total.get("cost"), 0),
            "aboveP75": above_p75,
            "aboveP75Pct": round(above_p75 / code_rows * 100, 1) if code_rows else 0,
            "excessCost": _round(total.get("excess_cost"), 0),
        },
        "tiers": tiers,
        "topCodes": [
            {
                "code": str(row.get("code") or ""),
                "providers": as_int(row.get("providers")),
                "claims": as_int(row.get("claims")),
                "excess": _round(row.get("excess"), 0),
                "description": None,
            }
            for row in top_codes
        ],
        "outliers": [
            {
                "provider": str(row.get("provider") or ""),
                "providerName": row.get("provider_name"),
                "codes": as_int(row.get("codes")),
                "claims": as_int(row.get("claims")),
                "cost": _round(row.get("cost"), 0),
                "hot": as_int(row.get("hot")),
                "avgCost": _round(row.get("avg_cost")),
                "benchmarkAvgCost": _round(row.get("benchmark_avg")),
                "peerRatio": _round(row.get("peer_ratio")),
                "variancePct": (
                    round((as_float(row.get("peer_ratio")) - 1) * 100, 1)
                    if row.get("peer_ratio") is not None
                    else None
                ),
                "tier": str(row.get("tier") or "Low"),
            }
            for row in outliers
        ],
        "quality": [
            {
                "transactionType": str(row.get("transaction_type") or "Unknown"),
                "status": str(row.get("status") or "unknown"),
                "records": as_int(row.get("record_count")),
            }
            for row in quality_rows
        ],
    }


@app.get("/api/siu/providers")
def provider_search(
    request: Request,
    q: str = Query("", max_length=128),
    basis: str = "procedure",
) -> dict[str, Any]:
    _require_feature("provider_analysis")
    selected = _basis(basis)
    term = "".join(character for character in q if character.isalnum())
    if len(term) < 2:
        return {"providers": []}
    client = app_workspace_client()
    providers_table = quoted_table("providers")
    try:
        rows = execute(
            client,
            f"""
            {benchmark_cte(selected)}
            SELECT pm.provider,
                   p.provider_name,
                   pm.claims,
                   pm.cost AS total_cost,
                   pm.codes
            FROM provider_metrics pm
            LEFT JOIN {providers_table} p ON pm.provider = p.provider_key
            WHERE lower(CAST(pm.provider AS STRING)) LIKE lower(:pattern)
               OR lower(COALESCE(p.provider_name, '')) LIKE lower(:pattern)
            ORDER BY pm.claims DESC, pm.cost DESC
            LIMIT 20
            """,
            {"pattern": f"%{term}%"},
        )
    except Exception as error:
        raise _analytics_error(error) from error
    return {
        "providers": [
            {
                "provider": str(row.get("provider") or ""),
                "providerName": row.get("provider_name"),
                "claims": as_int(row.get("claims")),
                "totalCost": _round(row.get("total_cost")),
                "codes": as_int(row.get("codes")),
            }
            for row in rows
        ]
    }


def _provider_detail(client: WorkspaceClient, provider: str, basis: Basis) -> dict[str, Any]:
    rows = execute(
        client,
        f"""
        {benchmark_cte(basis)}
        SELECT pc.code,
               pc.claims,
               pc.total_cost,
               pc.avg_cost,
               b.benchmark_avg,
               b.benchmark_median,
               b.benchmark_p25,
               b.benchmark_p75,
               p.provider_name
        FROM provider_codes pc
        JOIN benchmarks b USING (code)
        LEFT JOIN {quoted_table('providers')} p ON pc.provider = p.provider_key
        WHERE pc.provider = :provider
        ORDER BY pc.total_cost DESC
        """,
        {"provider": provider},
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Provider not found for this benchmark basis")

    services = []
    total_cost = 0.0
    total_claims = 0
    weighted_provider = 0.0
    weighted_benchmark = 0.0
    excess_cost = 0.0
    above_benchmark = 0
    above_p75 = 0
    for row in rows:
        claims = as_int(row.get("claims"))
        avg_cost = as_float(row.get("avg_cost"))
        benchmark_avg = as_float(row.get("benchmark_avg"))
        total = as_float(row.get("total_cost"))
        p75 = as_float(row.get("benchmark_p75"))
        variance = ((avg_cost - benchmark_avg) / benchmark_avg * 100) if benchmark_avg else None
        excess = max(avg_cost - benchmark_avg, 0) * claims
        total_cost += total
        total_claims += claims
        weighted_provider += avg_cost * claims
        weighted_benchmark += benchmark_avg * claims
        excess_cost += excess
        above_benchmark += int(avg_cost > benchmark_avg)
        above_p75 += int(avg_cost > p75)
        services.append(
            {
                "code": str(row.get("code") or ""),
                "description": None,
                "excess": round(excess, 2),
                "claims": claims,
                "avgCost": round(avg_cost, 2),
                "totalCost": round(total, 2),
                "benchmarkAvgCost": round(benchmark_avg, 2),
                "benchmarkMedianCost": _round(row.get("benchmark_median")),
                "benchmarkP25": _round(row.get("benchmark_p25")),
                "benchmarkP75": round(p75, 2),
                "variancePct": round(variance, 1) if variance is not None else None,
                "aboveP75": avg_cost > p75,
            }
        )

    peer_ratio = weighted_provider / weighted_benchmark if weighted_benchmark else 0
    return {
        "provider": provider,
        "providerName": rows[0].get("provider_name"),
        "basis": basis,
        "summary": {
            "codeCount": len(services),
            "totalClaims": total_claims,
            "totalCost": round(total_cost, 2),
            "avgCostPerClaim": round(total_cost / total_claims, 2) if total_claims else 0,
            "codesAboveBenchmark": above_benchmark,
            "codesAboveP75": above_p75,
            "excessCost": round(excess_cost, 2),
            "excessSharePct": round(excess_cost / total_cost * 100, 1) if total_cost else 0,
            "peerRatio": round(peer_ratio, 2),
            "tier": _tier(peer_ratio),
        },
        "services": services,
    }


@app.get("/api/siu/provider/{provider}")
def provider_detail(provider: str, request: Request, basis: str = "procedure") -> dict[str, Any]:
    _require_feature("provider_analysis")
    selected_provider = _provider(provider)
    selected_basis = _basis(basis)
    try:
        return _provider_detail(app_workspace_client(), selected_provider, selected_basis)
    except HTTPException:
        raise
    except Exception as error:
        raise _analytics_error(error) from error


@app.get("/api/siu/provider/{provider}/claims")
def provider_claims(provider: str, request: Request) -> dict[str, Any]:
    _require_feature("provider_analysis")
    selected_provider = _provider(provider)
    claims = quoted_table("claims")
    lines = quoted_table("claim_lines")
    payments = quoted_table("payments")
    client = app_workspace_client()
    try:
        summary_rows = execute(
            client,
            f"""
            SELECT COUNT(*) AS claims, SUM(COALESCE(claim_amount, 0)) AS allowed
            FROM {claims}
            WHERE provider_key = :provider
            """,
            {"provider": selected_provider},
        )
        rows = execute(
            client,
            f"""
            WITH line_summary AS (
                SELECT claim_id, COUNT(*) AS lines
                FROM {lines}
                GROUP BY claim_id
            ), payment_summary AS (
                SELECT claim_id,
                       SUM(COALESCE(paid_amount, 0)) AS paid,
                       SUM(CASE WHEN claim_status_code IN ('4', '22', '23') THEN 1 ELSE 0 END) AS denied
                FROM {payments}
                GROUP BY claim_id
            )
            SELECT c.claim_id,
                   c.member_key,
                   c.service_date,
                   c.principal_diagnosis_code,
                   COALESCE(l.lines, 0) AS lines,
                   COALESCE(p.denied, 0) AS denied,
                   COALESCE(c.claim_amount, 0) AS allowed,
                   COALESCE(p.paid, 0) AS paid
            FROM {claims} c
            LEFT JOIN line_summary l ON c.claim_id = l.claim_id
            LEFT JOIN payment_summary p ON c.claim_id = p.claim_id
            WHERE c.provider_key = :provider
            ORDER BY c.claim_amount DESC NULLS LAST, c.service_date DESC NULLS LAST
            LIMIT 500
            """,
            {"provider": selected_provider},
        )
    except Exception as error:
        raise _analytics_error(error) from error
    summary = summary_rows[0] if summary_rows else {}
    total = as_int(summary.get("claims"))
    return {
        "provider": selected_provider,
        "total": total,
        "shown": len(rows),
        "truncated": total > len(rows),
        "totalAllowed": _round(summary.get("allowed")),
        "claims": [
            {
                "claimId": str(row.get("claim_id") or ""),
                "memberKey": str(row.get("member_key") or ""),
                "serviceDate": str(row["service_date"]) if row.get("service_date") else None,
                "diagnosisCode": row.get("principal_diagnosis_code"),
                "lines": as_int(row.get("lines")),
                "deniedLines": as_int(row.get("denied")),
                "allowed": _round(row.get("allowed")),
                "paid": _round(row.get("paid")),
            }
            for row in rows
        ],
    }


def _provider_members(client: WorkspaceClient, provider: str) -> dict[str, Any]:
    claims = quoted_table("claims")
    members = quoted_table("members")
    rows = execute(
        client,
        f"""
        WITH population AS (
            SELECT member_key, SUM(COALESCE(claim_amount, 0)) AS total_allowed
            FROM {claims}
            WHERE member_key IS NOT NULL
            GROUP BY member_key
        ), population_stats AS (
            SELECT percentile_approx(total_allowed, 0.5) AS median_allowed
            FROM population
        ), provider_members AS (
            SELECT member_key,
                   COUNT(*) AS claims,
                   SUM(COALESCE(claim_amount, 0)) AS provider_allowed
            FROM {claims}
            WHERE provider_key = :provider AND member_key IS NOT NULL
            GROUP BY member_key
        ), detail AS (
            SELECT pm.member_key,
                   pm.claims,
                   pm.provider_allowed,
                   p.total_allowed,
                   p.total_allowed / NULLIF(s.median_allowed, 0) AS utilization_index,
                   m.birth_year,
                   m.gender_code,
                   m.state_code
            FROM provider_members pm
            JOIN population p ON pm.member_key = p.member_key
            CROSS JOIN population_stats s
            LEFT JOIN {members} m ON pm.member_key = m.member_key
        )
        SELECT *, COUNT(*) OVER () AS total_members
        FROM detail
        ORDER BY utilization_index DESC NULLS LAST
        LIMIT 500
        """,
        {"provider": provider},
    )
    total = as_int(rows[0].get("total_members")) if rows else 0
    utilization = [as_float(row.get("utilization_index")) for row in rows if row.get("utilization_index") is not None]
    sorted_utilization = sorted(utilization)
    median = None
    if sorted_utilization:
        midpoint = len(sorted_utilization) // 2
        median = (
            sorted_utilization[midpoint]
            if len(sorted_utilization) % 2
            else (sorted_utilization[midpoint - 1] + sorted_utilization[midpoint]) / 2
        )
    return {
        "provider": provider,
        "total": total,
        "shown": len(rows),
        "truncated": total > len(rows),
        "summary": {
            "members": total,
            "scored": len(utilization),
            "avgUtilizationIndex": round(sum(utilization) / len(utilization), 2) if utilization else None,
            "medianUtilizationIndex": round(median, 2) if median is not None else None,
            "highUtilization": sum(value >= 2 for value in utilization),
        },
        "members": [
            {
                "memberKey": str(row.get("member_key") or ""),
                "claims": as_int(row.get("claims")),
                "allowed": _round(row.get("provider_allowed")),
                "birthYear": as_int(row.get("birth_year")) if row.get("birth_year") is not None else None,
                "genderCode": row.get("gender_code"),
                "stateCode": row.get("state_code"),
                "utilizationIndex": _round(row.get("utilization_index")) if row.get("utilization_index") is not None else None,
                "totalAllowed": _round(row.get("total_allowed")) if row.get("total_allowed") is not None else None,
            }
            for row in rows
        ],
    }


@app.get("/api/siu/provider/{provider}/member-list")
def provider_member_list(provider: str, request: Request) -> dict[str, Any]:
    _require_feature("member_utilization")
    selected_provider = _provider(provider)
    try:
        return _provider_members(app_workspace_client(), selected_provider)
    except Exception as error:
        raise _analytics_error(error) from error


@app.get("/api/siu/provider/{provider}/members")
def provider_member_summary(provider: str, request: Request) -> dict[str, Any]:
    _require_feature("member_utilization")
    details = provider_member_list(provider, request)
    return {"provider": details["provider"], **details["summary"]}


def _analysis(client: WorkspaceClient, provider: str, basis: Basis) -> dict[str, Any]:
    detail = _provider_detail(client, provider, basis)
    members = _provider_members(client, provider)
    summary = detail["summary"]
    services = sorted(detail["services"], key=lambda service: service["excess"], reverse=True)
    top = [service for service in services if service["excess"] > 0][:5]
    utilization = members["summary"].get("avgUtilizationIndex")
    narrative = [
        f"Provider {provider} appears across {summary['codeCount']:,} {basis} codes and "
        f"{summary['totalClaims']:,} code-level claim observations, totaling ${summary['totalCost']:,.0f}.",
        f"The claim-weighted amount ratio is {summary['peerRatio']}× the peer benchmark for the same codes. "
        f"{summary['codesAboveBenchmark']:,} codes exceed the peer average and "
        f"{summary['codesAboveP75']:,} exceed the peer 75th percentile.",
        f"Positive variance above the peer average totals ${summary['excessCost']:,.0f}. "
        "This is a prioritization estimate, not a validated recovery amount.",
    ]
    if utilization is not None:
        narrative.append(
            f"The provider's de-identified member panel has an average utilization index of {utilization}× "
            "the population median. This is utilization context, not a clinical risk score."
        )

    findings: list[str] = []
    if top:
        first = top[0]
        findings.append(
            f"Code {first['code']} is the largest variance contributor: {first['claims']:,} observations at "
            f"${first['avgCost']:,.2f} versus a peer average of ${first['benchmarkAvgCost']:,.2f}."
        )
        concentration = sum(service["excess"] for service in top)
        if summary["excessCost"]:
            findings.append(
                f"The top {len(top)} codes account for {concentration / summary['excessCost'] * 100:.0f}% "
                "of measured positive variance."
            )
    findings.append(
        f"{summary['codesAboveP75']:,} of {summary['codeCount']:,} codes exceed the peer 75th percentile."
    )

    recommendations = []
    if top:
        recommendations.append(
            "Review source claims for the largest variance codes: " + ", ".join(service["code"] for service in top[:3]) + "."
        )
    recommendations.extend(
        [
            "Confirm that peer comparisons use an appropriate provider specialty, geography, and service mix.",
            "Review adjacent periods to distinguish a persistent pattern from a small-volume or one-time event.",
            "Use the notification draft to request supporting context before any payment action.",
            "Use the provider-scoped Genie panel for follow-up SQL analysis against the curated tables.",
        ]
    )
    return {
        "provider": provider,
        "basis": basis,
        "summary": narrative,
        "findings": findings,
        "recommendations": recommendations,
        "savingsOpportunity": summary["excessCost"],
    }


@app.get("/api/siu/provider/{provider}/analysis")
def provider_analysis(provider: str, request: Request, basis: str = "procedure") -> dict[str, Any]:
    _require_feature("provider_analysis")
    selected_provider = _provider(provider)
    selected_basis = _basis(basis)
    try:
        return _analysis(app_workspace_client(), selected_provider, selected_basis)
    except HTTPException:
        raise
    except Exception as error:
        raise _analytics_error(error) from error


@app.get("/api/siu/provider/{provider}/letter")
def provider_letter(provider: str, request: Request, basis: str = "procedure") -> dict[str, Any]:
    _require_feature("letters")
    selected_provider = _provider(provider)
    selected_basis = _basis(basis)
    try:
        detail = _provider_detail(app_workspace_client(), selected_provider, selected_basis)
    except HTTPException:
        raise
    except Exception as error:
        raise _analytics_error(error) from error
    config = load_config()
    plan_name = config.get("branding", {}).get("plan_name", "Health Plan Analytics")
    summary = detail["summary"]
    services = sorted(
        (service for service in detail["services"] if (service["variancePct"] or 0) > 0),
        key=lambda service: service["variancePct"] or 0,
        reverse=True,
    )[:8]
    lines = [
        f"Date: {date.today():%B %d, %Y}",
        "",
        f"Provider ID: {selected_provider}",
        "",
        "RE: Comparative billing review, amount variance relative to peers",
        "",
        "Dear Provider,",
        "",
        f"As part of {plan_name}'s routine payment-integrity program, we compare billed amounts "
        f"against peer benchmarks for the same {selected_basis} codes. This draft summarizes the "
        "screening results and invites your response.",
        "",
        "SUMMARY OF REVIEW",
        "",
        f"  Codes reviewed:                 {summary['codeCount']:,}",
        f"  Claim observations:             {summary['totalClaims']:,}",
        f"  Total billed amount:            ${summary['totalCost']:,.2f}",
        f"  Average amount per observation: ${summary['avgCostPerClaim']:,.2f}",
        f"  Peer ratio:                     {summary['peerRatio']}x",
        f"  Codes above peer average:       {summary['codesAboveBenchmark']:,}",
        f"  Codes above peer 75th pct:      {summary['codesAboveP75']:,}",
        "",
    ]
    if services:
        lines.extend(["CODES WITH THE LARGEST VARIANCE", "", "  Code       Claims    Your avg    Peer avg    Variance"])
        for service in services:
            lines.append(
                f"  {service['code']:<10} {service['claims']:>6,} "
                f"${service['avgCost']:>10,.2f} ${service['benchmarkAvgCost']:>10,.2f} "
                f"{service['variancePct']:>9.1f}%"
            )
        lines.append("")
    lines.extend(
        [
            "WHAT THIS MEANS",
            "",
            "An amount above a peer benchmark is a screening signal, not a finding of improper billing. "
            "Specialty, case mix, geography, contract terms, and site of service may explain variation.",
            "",
            "REQUESTED ACTION",
            "",
            "Please review the codes above and provide any clinical, contractual, or operational context "
            "that should be considered. No payment adjustment or recovery action is being taken as a "
            "result of this draft.",
            "",
            "Sincerely,",
            "Special Investigations Unit",
            str(plan_name),
            "",
            "Draft generated for internal review. Verify all figures before sending.",
        ]
    )
    return {
        "provider": selected_provider,
        "basis": selected_basis,
        "generatedOn": date.today().isoformat(),
        "letter": "\n".join(lines),
    }


class GenieAsk(BaseModel):
    message: str
    conversation_id: Optional[str] = None


class ProviderAsk(GenieAsk):
    basis: str = "procedure"


@app.post("/api/genie/ask")
def genie_ask(body: GenieAsk, request: Request) -> dict[str, Any]:
    _require_feature("embedded_genie")
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="A question is required")
    try:
        return ask_genie(viewer_workspace_client(request), body.message.strip(), body.conversation_id)
    except Exception as error:
        raise HTTPException(status_code=502, detail="Genie is temporarily unavailable") from error


@app.post("/api/siu/provider/{provider}/genie")
def provider_genie(provider: str, body: ProviderAsk, request: Request) -> dict[str, Any]:
    _require_feature("embedded_genie")
    selected_provider = _provider(provider)
    selected_basis = _basis(body.basis)
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="A question is required")
    prompt = (
        f"Using only curated tables in {source_name()}, analyze provider {selected_provider}. "
        f"Use the {selected_basis} code basis when relevant. Question: {body.message.strip()}"
    )
    try:
        return ask_genie(viewer_workspace_client(request), prompt, body.conversation_id)
    except Exception as error:
        raise HTTPException(status_code=502, detail="Genie is temporarily unavailable") from error


if FRONTEND.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND / "assets"), name="assets")

    @app.get("/{path:path}")
    def frontend(path: str) -> FileResponse:
        return FileResponse(FRONTEND / "index.html")
