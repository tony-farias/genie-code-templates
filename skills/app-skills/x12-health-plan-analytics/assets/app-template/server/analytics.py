from __future__ import annotations

from typing import Literal

from .config import quoted_table, threshold


Basis = Literal["procedure", "diagnosis"]


def validate_basis(value: str) -> Basis:
    if value not in {"procedure", "diagnosis"}:
        raise ValueError("basis must be procedure or diagnosis")
    return value  # type: ignore[return-value]


def benchmark_cte(basis: Basis) -> str:
    claims = quoted_table("claims")
    if basis == "procedure":
        lines = quoted_table("claim_lines")
        events = f"""
            SELECT c.provider_key AS provider,
                   l.procedure_code AS code,
                   l.claim_id,
                   CAST(COALESCE(l.line_amount, 0) AS DOUBLE) AS amount
            FROM {claims} c
            JOIN {lines} l ON c.claim_id = l.claim_id
            WHERE c.provider_key IS NOT NULL
              AND l.procedure_code IS NOT NULL
              AND l.line_amount IS NOT NULL
        """
    else:
        events = f"""
            SELECT provider_key AS provider,
                   principal_diagnosis_code AS code,
                   claim_id,
                   CAST(COALESCE(claim_amount, 0) AS DOUBLE) AS amount
            FROM {claims}
            WHERE provider_key IS NOT NULL
              AND principal_diagnosis_code IS NOT NULL
              AND claim_amount IS NOT NULL
        """

    return f"""
        WITH events AS (
            {events}
        ),
        benchmarks AS (
            SELECT code,
                   AVG(amount) AS benchmark_avg,
                   percentile_approx(amount, 0.25) AS benchmark_p25,
                   percentile_approx(amount, 0.5) AS benchmark_median,
                   percentile_approx(amount, 0.75) AS benchmark_p75
            FROM events
            GROUP BY code
        ),
        provider_codes AS (
            SELECT provider,
                   code,
                   COUNT(DISTINCT claim_id) AS claims,
                   SUM(amount) AS total_cost,
                   AVG(amount) AS avg_cost
            FROM events
            GROUP BY provider, code
        ),
        provider_metrics AS (
            SELECT pc.provider,
                   COUNT(*) AS codes,
                   SUM(pc.claims) AS claims,
                   SUM(pc.total_cost) AS cost,
                   SUM(CASE WHEN pc.avg_cost > b.benchmark_p75 THEN 1 ELSE 0 END) AS hot,
                   SUM(pc.avg_cost * pc.claims) / NULLIF(SUM(pc.claims), 0) AS avg_cost,
                   SUM(b.benchmark_avg * pc.claims) / NULLIF(SUM(pc.claims), 0) AS benchmark_avg,
                   SUM(CASE WHEN pc.avg_cost > b.benchmark_avg
                            THEN (pc.avg_cost - b.benchmark_avg) * pc.claims ELSE 0 END) AS excess_cost
            FROM provider_codes pc
            JOIN benchmarks b USING (code)
            GROUP BY pc.provider
        )
    """


def tier_case(peer_ratio: str = "peer_ratio") -> str:
    high = threshold("high_peer_ratio", 1.5)
    medium = threshold("medium_peer_ratio", 1.2)
    return f"CASE WHEN {peer_ratio} >= {high} THEN 'High' WHEN {peer_ratio} >= {medium} THEN 'Medium' ELSE 'Low' END"


def minimum_codes() -> int:
    return max(1, int(threshold("minimum_codes", 1)))


def minimum_claims() -> int:
    return max(1, int(threshold("minimum_claims", 1)))
