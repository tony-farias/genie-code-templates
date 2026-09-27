#!/usr/bin/env python3
"""Generate deterministic, fictional X12 5010 records for end-to-end tests."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import random
import re

from x12_core import classify_x12


def _isa(sender: str, receiver: str, control: str, date: str, time: str, version: str = "00501") -> str:
    return (
        f"ISA*00*{'':10}*00*{'':10}*ZZ*{sender:<15.15}*ZZ*{receiver:<15.15}*"
        f"{date}*{time}*^*{version}*{control:0>9}*1*T*:"
    )


def _envelope(
    transaction_type: str,
    functional_id: str,
    implementation: str,
    body: list[str],
    control_number: int,
    date: datetime,
) -> str:
    interchange = f"{control_number:09d}"
    group = str(control_number)
    transaction = f"{control_number:04d}"
    date8 = date.strftime("%Y%m%d")
    date6 = date.strftime("%y%m%d")
    time4 = date.strftime("%H%M")
    st = f"ST*{transaction_type}*{transaction}*{implementation}"
    se = f"SE*{len(body) + 2}*{transaction}"
    segments = [
        _isa("SYNTHSENDER", "SYNTHRECEIVER", interchange, date6, time4),
        f"GS*{functional_id}*SYNTHSENDER*SYNTHRECEIVER*{date8}*{time4}*{group}*X*{implementation}",
        st,
        *body,
        se,
        f"GE*1*{group}",
        f"IEA*1*{interchange}",
    ]
    return "~\n".join(segments) + "~"


def build_837p(index: int, amount: int, date: datetime) -> str:
    member_id = f"MEM{index:06d}"
    claim_id = f"CLM{index:08d}"
    body = [
        f"BHT*0019*00*{claim_id}*{date:%Y%m%d}*{date:%H%M}*CH",
        "NM1*41*2*SYNTHETIC SUBMITTER*****46*SYNTH001",
        "PER*IC*TEST CONTACT*TE*5555550100",
        "NM1*40*2*SYNTHETIC RECEIVER*****46*SYNTH002",
        "HL*1**20*1",
        "NM1*85*2*SYNTHETIC HEALTH CLINIC*****XX*1999999999",
        "N3*100 TEST HEALTH WAY",
        "N4*BOSTON*MA*02110",
        "REF*EI*999999999",
        "HL*2*1*22*0",
        "SBR*P*18*******CI",
        f"NM1*IL*1*MEMBER{index}*TEST****MI*{member_id}",
        "N3*200 FICTIONAL AVE",
        "N4*BOSTON*MA*02111",
        "DMG*D8*19800101*U",
        "NM1*PR*2*SYNTHETIC HEALTH PLAN*****PI*PLAN001",
        f"CLM*{claim_id}*{amount}***11:B:1*Y*A*Y*Y",
        "HI*ABK:Z0000",
        "LX*1",
        f"SV1*HC:99213*{amount}*UN*1***1",
        f"DTP*472*D8*{date:%Y%m%d}",
    ]
    return _envelope("837", "HC", "005010X222A1", body, 1000 + index, date)


def build_835(index: int, amount: int, date: datetime) -> str:
    claim_id = f"CLM{index:08d}"
    paid = round(amount * 0.8, 2)
    adjustment = round(amount - paid, 2)
    body = [
        f"BPR*I*{paid:.2f}*C*CHK************{date:%Y%m%d}",
        f"TRN*1*PAY{index:08d}*1999999999",
        "N1*PR*SYNTHETIC HEALTH PLAN*XV*PLAN001",
        "N1*PE*SYNTHETIC HEALTH CLINIC*XX*1999999999",
        "LX*1",
        f"CLP*{claim_id}*1*{amount:.2f}*{paid:.2f}*{adjustment:.2f}*CI*PAYER{index:06d}*11*1",
        f"NM1*QC*1*MEMBER{index}*TEST****MI*MEM{index:06d}",
        f"SVC*HC:99213*{amount:.2f}*{paid:.2f}**1",
        f"DTM*472*{date:%Y%m%d}",
        f"CAS*CO*45*{adjustment:.2f}",
    ]
    return _envelope("835", "HP", "005010X221A1", body, 2000 + index, date)


def build_834(index: int, date: datetime) -> str:
    member_id = f"MEM{index:06d}"
    body = [
        f"BGN*00*ENR{index:08d}*{date:%Y%m%d}*{date:%H%M}****2",
        "N1*P5*SYNTHETIC SPONSOR*FI*999999999",
        "N1*IN*SYNTHETIC HEALTH PLAN*FI*PLAN001",
        "INS*Y*18*021*20*A***FT",
        f"REF*0F*{member_id}",
        f"DTP*356*D8*{date:%Y%m%d}",
        f"NM1*IL*1*MEMBER{index}*TEST****34*{member_id}",
        "PER*IP**TE*5555550101",
        "N3*200 FICTIONAL AVE",
        "N4*BOSTON*MA*02111",
        "DMG*D8*19800101*U",
        "HD*021**HLT*PLAN-GOLD*EMP",
        f"DTP*348*D8*{date:%Y%m%d}",
    ]
    return _envelope("834", "BE", "005010X220A1", body, 3000 + index, date)


def _bad_segment_count(payload: str) -> str:
    return re.sub(r"SE\*\d+\*", "SE*999*", payload, count=1)


def _unsupported_4010(payload: str) -> str:
    return payload.replace("005010X222A1", "004010X098A1").replace("*00501*", "*00401*")


def generate_records(claims: int, seed: int, include_negative: bool) -> list[dict[str, object]]:
    rng = random.Random(seed)
    now = datetime(2026, 1, 15, 12, 0, tzinfo=timezone.utc)
    records: list[dict[str, object]] = []
    for index in range(1, claims + 1):
        amount = rng.randrange(90, 800)
        for transaction_type, builder in (("837", build_837p), ("835", build_835), ("834", build_834)):
            payload = builder(index, amount, now) if transaction_type != "834" else builder(index, now)
            classification = classify_x12(payload)
            records.append(
                {
                    "record_id": f"synthetic-{transaction_type}-{index:05d}",
                    "transaction_type": transaction_type,
                    "edi_payload": payload,
                    "expected_status": "valid",
                    "fingerprint": classification.fingerprint,
                }
            )

    if include_negative and records:
        first_837 = next(record for record in records if record["transaction_type"] == "837")
        invalid_count = _bad_segment_count(str(first_837["edi_payload"]))
        unsupported = _unsupported_4010(str(first_837["edi_payload"]))
        records.extend(
            [
                {
                    "record_id": "synthetic-invalid-se-count",
                    "transaction_type": "837",
                    "edi_payload": invalid_count,
                    "expected_status": "segment_count_mismatch",
                    "fingerprint": classify_x12(invalid_count).fingerprint,
                },
                {
                    "record_id": "synthetic-unsupported-4010",
                    "transaction_type": "837",
                    "edi_payload": unsupported,
                    "expected_status": "unsupported_version",
                    "fingerprint": classify_x12(unsupported).fingerprint,
                },
                {
                    "record_id": "synthetic-empty-payload",
                    "transaction_type": "unknown",
                    "edi_payload": "",
                    "expected_status": "not_x12",
                    "fingerprint": classify_x12("").fingerprint,
                },
            ]
        )
    return records


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--claims", type=int, default=3)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--include-negative", action="store_true")
    args = parser.parse_args()
    if args.claims < 1:
        parser.error("--claims must be at least 1")

    args.output.mkdir(parents=True, exist_ok=True)
    records = generate_records(args.claims, args.seed, args.include_negative)
    jsonl_path = args.output / "synthetic_x12.jsonl"
    with jsonl_path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, sort_keys=True) + "\n")

    summary = {
        "seed": args.seed,
        "claims": args.claims,
        "records": len(records),
        "jsonl": str(jsonl_path),
        "expected_status_counts": {},
    }
    for record in records:
        status = str(record["expected_status"])
        summary["expected_status_counts"][status] = summary["expected_status_counts"].get(status, 0) + 1
    (args.output / "manifest.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")
    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

