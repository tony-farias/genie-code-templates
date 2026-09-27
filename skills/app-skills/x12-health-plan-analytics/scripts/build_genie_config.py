#!/usr/bin/env python3
"""Build a deterministic, Gold-only Genie serialized_space v2 document."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def stable_id(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:32]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    catalog = manifest["destination"]["catalog"]
    schema = manifest["destination"]["schema"]
    prefix = manifest["destination"]["table_prefix"]
    fq = lambda name: f"{catalog}.{schema}.{prefix}gold_{name}"

    descriptions = {
        "claim_lines": "Curated 837 service lines. Procedure identifiers remain strings and missing source fields remain null.",
        "claims": "Curated 837 claim headers with de-identified member keys, provider keys, amounts, diagnosis codes, and service dates.",
        "data_quality": "Aggregate parser outcomes by X12 transaction type. Contains counts only, never payloads or parser JSON.",
        "enrollments": "Curated 834 coverage elections joined through a de-identified member key.",
        "members": "De-identified member attributes. Direct member identifiers, names, and full dates of birth are excluded.",
        "payments": "Curated 835 claim payment facts, status codes, payer organizations, and payment dates.",
        "providers": "Curated provider identifiers and organization attributes from 837 transactions.",
    }
    tables = [
        {"identifier": fq(name), "description": [description]}
        for name, description in sorted(descriptions.items())
    ]

    questions = [
        "How many claims and total billed amount are in the data?",
        "What is the paid amount and payment rate by claim status?",
        "Which procedure codes have the most service lines?",
        "How many members are enrolled by coverage type?",
        "What percentage of each X12 transaction type parsed successfully?",
    ]
    sample_questions = sorted(
        ({"id": stable_id(f"sample:{question}"), "question": [question]} for question in questions),
        key=lambda value: value["id"],
    )

    instructions = [
        "Use only the configured Gold tables. Never infer facts from table names, memory, or missing values.\n",
        "Member data is de-identified. Do not attempt to identify a person or request raw X12, parser JSON, names, addresses, identifiers, or full dates of birth.\n",
        "Treat claim, procedure, diagnosis, provider, and member identifiers as strings. Preserve leading zeros.\n",
        "Use claims for claim-level totals, claim_lines for procedure utilization, payments for 835 payment facts, enrollments for 834 coverage, and data_quality for parser outcomes.\n",
        "When a requested field is absent, say it is not available. Do not manufacture demographic, clinical, coverage, or financial facts.\n",
    ]
    text_instructions = [{"id": stable_id("instructions:gold-boundary"), "content": instructions}]

    examples = [
        (
            "How many claims and total billed amount are in the data?",
            f"SELECT COUNT(*) AS claim_count, SUM(claim_amount) AS total_billed_amount FROM {fq('claims')}",
            "Use for portfolio-level 837 claim volume and billed amount.",
        ),
        (
            "What is the paid amount and payment rate by claim status?",
            f"SELECT claim_status_code, SUM(charged_amount) AS charged_amount, SUM(paid_amount) AS paid_amount, ROUND(100 * SUM(paid_amount) / NULLIF(SUM(charged_amount), 0), 1) AS payment_rate_pct FROM {fq('payments')} GROUP BY claim_status_code ORDER BY paid_amount DESC",
            "Use for 835 payment performance grouped by status.",
        ),
        (
            "Which procedure codes have the most service lines?",
            f"SELECT procedure_code, COUNT(*) AS service_line_count, SUM(line_amount) AS billed_amount FROM {fq('claim_lines')} GROUP BY procedure_code ORDER BY service_line_count DESC",
            "Use for procedure utilization. Keep procedure_code as a string.",
        ),
        (
            "What percentage of each X12 transaction type parsed successfully?",
            f"SELECT transaction_type, ROUND(100 * SUM(CASE WHEN status = 'parsed' THEN record_count ELSE 0 END) / NULLIF(SUM(record_count), 0), 1) AS parse_success_pct FROM {fq('data_quality')} GROUP BY transaction_type ORDER BY transaction_type",
            "Use only the aggregate data_quality table for parser outcomes.",
        ),
    ]
    example_question_sqls = sorted(({
        "id": stable_id(f"example:{question}"),
        "question": [question],
        "sql": [sql],
        "usage_guidance": [guidance],
        "parameters": [],
    } for question, sql, guidance in examples), key=lambda value: value["id"])

    join_specs = [
        {
            "id": stable_id("join:claims:members"),
            "left": {"identifier": fq("claims"), "alias": "claims"},
            "right": {"identifier": fq("members"), "alias": "members"},
            "sql": ["`claims`.`member_key` = `members`.`member_key`", "--rt=FROM_RELATIONSHIP_TYPE_MANY_TO_ONE--"],
            "instruction": ["Join claims to de-identified member attributes by member_key."],
        },
        {
            "id": stable_id("join:claims:providers"),
            "left": {"identifier": fq("claims"), "alias": "claims"},
            "right": {"identifier": fq("providers"), "alias": "providers"},
            "sql": ["`claims`.`provider_key` = `providers`.`provider_key`", "--rt=FROM_RELATIONSHIP_TYPE_MANY_TO_ONE--"],
            "instruction": ["Join claims to provider organizations by provider_key."],
        },
        {
            "id": stable_id("join:claims:claim_lines"),
            "left": {"identifier": fq("claims"), "alias": "claims"},
            "right": {"identifier": fq("claim_lines"), "alias": "claim_lines"},
            "sql": ["`claims`.`claim_id` = `claim_lines`.`claim_id`", "--rt=FROM_RELATIONSHIP_TYPE_ONE_TO_MANY--"],
            "instruction": ["Join claim headers to their service lines by claim_id."],
        },
        {
            "id": stable_id("join:claims:payments"),
            "left": {"identifier": fq("claims"), "alias": "claims"},
            "right": {"identifier": fq("payments"), "alias": "payments"},
            "sql": ["`claims`.`claim_id` = `payments`.`claim_id`", "--rt=FROM_RELATIONSHIP_TYPE_ONE_TO_MANY--"],
            "instruction": ["Join 837 claims to 835 payment facts by claim_id."],
        },
    ]
    join_specs.sort(key=lambda value: value["id"])

    benchmark_items = examples + [
        (
            "Which providers have the most claims?",
            f"SELECT provider_key, COUNT(*) AS claim_count FROM {fq('claims')} GROUP BY provider_key ORDER BY claim_count DESC",
            "Provider claim volume.",
        ),
        (
            "How many de-identified members are in each state?",
            f"SELECT state_code, COUNT(*) AS member_count FROM {fq('members')} GROUP BY state_code ORDER BY member_count DESC",
            "De-identified member distribution.",
        ),
        (
            "How many enrollment records are there by coverage type?",
            f"SELECT coverage_type_code, COUNT(*) AS enrollment_count FROM {fq('enrollments')} GROUP BY coverage_type_code ORDER BY enrollment_count DESC",
            "834 coverage distribution.",
        ),
        (
            "What billed amount is associated with each diagnosis code?",
            f"SELECT principal_diagnosis_code, SUM(claim_amount) AS billed_amount FROM {fq('claims')} GROUP BY principal_diagnosis_code ORDER BY billed_amount DESC",
            "Claim amounts by diagnosis.",
        ),
        (
            "What are paid amounts by payment month?",
            f"SELECT DATE_TRUNC('month', payment_date) AS payment_month, SUM(paid_amount) AS paid_amount FROM {fq('payments')} GROUP BY DATE_TRUNC('month', payment_date) ORDER BY payment_month",
            "835 payment trend.",
        ),
        (
            "How many records were quarantined for each transaction type?",
            f"SELECT transaction_type, SUM(record_count) AS quarantined_records FROM {fq('data_quality')} WHERE status = 'quarantined' GROUP BY transaction_type ORDER BY transaction_type",
            "Aggregate quarantine counts.",
        ),
    ]
    benchmarks = sorted(({
        "id": stable_id(f"benchmark:{question}"),
        "question": [question],
        "answer": [{"format": "SQL", "content": [sql]}],
    } for question, sql, _ in benchmark_items), key=lambda value: value["id"])

    config = {
        "version": 2,
        "config": {"sample_questions": sample_questions},
        "data_sources": {"tables": tables},
        "instructions": {
            "text_instructions": text_instructions,
            "example_question_sqls": example_question_sqls,
            "join_specs": join_specs,
        },
        "benchmarks": {"questions": benchmarks},
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(config, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "tables": len(tables), "benchmarks": len(benchmarks)}, indent=2))


if __name__ == "__main__":
    main()
