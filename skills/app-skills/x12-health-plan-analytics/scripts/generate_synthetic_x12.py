#!/usr/bin/env python3
"""Generate deterministic, fictional X12 5010 records for end-to-end tests."""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
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


# Fictional reference data. Names, plans, and addresses are invented, and every NPI
# fails the NPI check digit, so no value can belong to a real provider.
PROVIDER_NAMES = [
    "BLUE HARBOR FAMILY PRACTICE", "CEDAR RIDGE INTERNAL MEDICINE", "NORTHWIND COMMUNITY CLINIC",
    "JUNIPER VALLEY MEDICAL GROUP", "SILVERLAKE PRIMARY CARE", "MAPLE GROVE HEALTH PARTNERS",
    "IRONWOOD ORTHOPEDIC ASSOCIATES", "SEASIDE CARDIOLOGY GROUP", "PINECREST PEDIATRICS",
    "RIVERBEND URGENT CARE", "GOLDEN MEADOW PHYSICAL THERAPY", "LAUREL HILL DIAGNOSTICS",
    "STONEBRIDGE FAMILY MEDICINE", "WILLOW CREEK HEALTH CENTER", "BRIGHTWATER IMAGING",
    "ASPEN TRAIL MEDICAL", "HARBOR LIGHT BEHAVIORAL HEALTH", "COPPER CANYON CLINIC",
    "EVERGREEN WELLNESS GROUP", "FOXGLOVE WOMENS HEALTH", "GRANITE PEAK SPORTS MEDICINE",
    "HOLLOW OAK INTERNAL MEDICINE", "INDIGO BAY PRIMARY CARE", "JASPER LAKE LABORATORY",
    "KESTREL POINT FAMILY CARE", "LANTERN HOUSE GERIATRICS", "MEADOWBROOK RHEUMATOLOGY",
    "NIGHTINGALE HOME HEALTH", "ORCHARD LANE PEDIATRICS", "PRAIRIE WIND MEDICAL GROUP",
]
# Providers that bill well above same-code peers, so the App's peer-variance views have signal.
OUTLIER_PROVIDERS = {3, 11, 22}
STATES = ["MA", "CT", "NY", "NJ", "PA", "VA", "NH", "RI"]
PROCEDURES = {  # CPT/HCPCS code -> typical fictional charge
    "99213": 125, "99214": 185, "99215": 255, "99203": 165, "93000": 60, "80053": 45,
    "36415": 18, "97110": 95, "71046": 110, "85025": 30, "20610": 140, "96372": 40,
}
DIAGNOSES = ["Z0000", "I10", "R079", "E119", "Z79899", "M5450", "J069", "E785", "F419", "K219", "N390", "M25561"]
PLANS = [("HLT", "FICTIONAL-GOLD"), ("HLT", "FICTIONAL-SILVER"), ("HLT", "FICTIONAL-BRONZE"),
         ("DEN", "FICTIONAL-DENTAL"), ("VIS", "FICTIONAL-VISION")]


def fictional_npi(number: int) -> str:
    """A 10-digit NPI-shaped identifier whose check digit is deliberately wrong."""
    base = f"18800{number:04d}"
    digits = [int(d) for d in "80840" + base]
    total = 0
    for position, digit in enumerate(reversed(digits)):
        doubled = digit * 2 if position % 2 == 0 else digit
        total += doubled - 9 if doubled > 9 else doubled
    valid_check = (10 - total % 10) % 10
    return base + str((valid_check + 5) % 10)


def claim_profile(index: int, rng: random.Random, start: datetime) -> dict[str, object]:
    """Deterministic fictional facts shared by one member's 837, 835, and 834."""
    provider = rng.randint(1, len(PROVIDER_NAMES))
    service_date = start + timedelta(days=rng.randint(0, 364))
    codes = list(PROCEDURES)
    lines = []
    for _ in range(rng.choice((1, 1, 2, 2, 3))):
        code = rng.choice(codes)
        factor = rng.uniform(1.7, 2.3) if provider in OUTLIER_PROVIDERS and code.startswith("99") else rng.uniform(0.85, 1.15)
        units = 1 if code.startswith("99") else rng.choice((1, 1, 2))
        lines.append({"code": code, "units": units, "amount": round(PROCEDURES[code] * factor * units, 2)})
    roll = rng.random()
    status = "4" if roll < 0.07 else "2" if roll < 0.10 else "1"
    charged = round(sum(line["amount"] for line in lines), 2)
    paid = 0.0 if status == "4" else round(charged * rng.uniform(0.62, 0.88), 2)
    patient = 0.0 if status == "4" else round(min(charged - paid, rng.uniform(0, 45)), 2)
    plan = rng.choice(PLANS)
    return {
        "provider": provider,
        "provider_name": PROVIDER_NAMES[provider - 1],
        "npi": fictional_npi(provider),
        "provider_state": STATES[(provider - 1) % len(STATES)],
        "member_id": f"FXM{index:07d}",
        "claim_id": f"FXC{index:09d}",
        "birth_date": datetime(rng.randint(1945, 2012), rng.randint(1, 12), rng.randint(1, 28)),
        "gender": rng.choices(("F", "M", "U"), weights=(48, 48, 4))[0],
        "member_state": rng.choice(STATES),
        "diagnosis": rng.choice(DIAGNOSES),
        "service_date": service_date,
        "lines": lines,
        "status": status,
        "charged": charged,
        "paid": paid,
        "patient": patient,
        "plan": plan,
        "coverage_start": datetime(service_date.year, 1, 1),
        "terminated": rng.random() < 0.08,
    }


def build_837p(index: int, claim: dict[str, object], date: datetime) -> str:
    lines: list[str] = []
    for number, line in enumerate(claim["lines"], start=1):
        lines += [
            f"LX*{number}",
            f"SV1*HC:{line['code']}*{line['amount']:.2f}*UN*{line['units']}***1",
            f"DTP*472*D8*{claim['service_date']:%Y%m%d}",
        ]
    body = [
        f"BHT*0019*00*{claim['claim_id']}*{date:%Y%m%d}*{date:%H%M}*CH",
        "NM1*41*2*FICTIONAL CLAIMS EXCHANGE*****46*FXSUB001",
        "PER*IC*DEMO CONTACT*TE*5555550199",
        "NM1*40*2*FICTIONAL PLAN RECEIVER*****46*FXRCV001",
        "HL*1**20*1",
        f"NM1*85*2*{claim['provider_name']}*****XX*{claim['npi']}",
        "N3*100 DEMONSTRATION WAY",
        f"N4*DEMO CITY*{claim['provider_state']}*00000",
        f"REF*EI*{claim['npi'][:9]}",
        "HL*2*1*22*0",
        "SBR*P*18*******CI",
        f"NM1*IL*1*FICTIONAL{index}*MEMBER****MI*{claim['member_id']}",
        "N3*200 SYNTHETIC AVENUE",
        f"N4*DEMO CITY*{claim['member_state']}*00001",
        f"DMG*D8*{claim['birth_date']:%Y%m%d}*{claim['gender']}",
        "NM1*PR*2*FICTIONAL REGIONAL HEALTH PLAN*****PI*FXPLAN01",
        f"CLM*{claim['claim_id']}*{claim['charged']:.2f}***11:B:1*Y*A*Y*Y",
        f"HI*ABK:{claim['diagnosis']}",
        *lines,
    ]
    return _envelope("837", "HC", "005010X222A1", body, 1000 + index, date)


def build_835(index: int, claim: dict[str, object], date: datetime) -> str:
    charged, paid, patient = claim["charged"], claim["paid"], claim["patient"]
    contractual = round(charged - paid - patient, 2)
    adjustments = [f"CAS*CO*{'50' if claim['status'] == '4' else '45'}*{contractual:.2f}"]
    if patient:
        adjustments.append(f"CAS*PR*2*{patient:.2f}")
    services = []
    for line in claim["lines"]:
        share = line["amount"] / charged if charged else 0
        services += [
            f"SVC*HC:{line['code']}*{line['amount']:.2f}*{paid * share:.2f}**{line['units']}",
            f"DTM*472*{claim['service_date']:%Y%m%d}",
        ]
    body = [
        f"BPR*I*{paid:.2f}*C*CHK************{date:%Y%m%d}",
        f"TRN*1*PAY{index:08d}*1999999990",
        "N1*PR*FICTIONAL REGIONAL HEALTH PLAN*XV*FXPLAN01",
        f"N1*PE*{claim['provider_name']}*XX*{claim['npi']}",
        "LX*1",
        f"CLP*{claim['claim_id']}*{claim['status']}*{charged:.2f}*{paid:.2f}*{patient:.2f}*CI*PAYER{index:06d}*11*1",
        *adjustments,
        f"NM1*QC*1*FICTIONAL{index}*MEMBER****MI*{claim['member_id']}",
        *services,
    ]
    return _envelope("835", "HP", "005010X221A1", body, 2000 + index, date)


def build_834(index: int, claim: dict[str, object], date: datetime) -> str:
    coverage, plan = claim["plan"]
    body = [
        f"BGN*00*ENR{index:08d}*{date:%Y%m%d}*{date:%H%M}****2",
        "N1*P5*FICTIONAL EMPLOYER GROUP*FI*999999990",
        "N1*IN*FICTIONAL REGIONAL HEALTH PLAN*FI*FXPLAN01",
        f"INS*Y*18*{'024' if claim['terminated'] else '021'}*20*A***FT",
        f"REF*0F*{claim['member_id']}",
        f"DTP*356*D8*{claim['coverage_start']:%Y%m%d}",
        f"NM1*IL*1*FICTIONAL{index}*MEMBER****34*{claim['member_id']}",
        "PER*IP**TE*5555550101",
        "N3*200 SYNTHETIC AVENUE",
        f"N4*DEMO CITY*{claim['member_state']}*00001",
        f"DMG*D8*{claim['birth_date']:%Y%m%d}*{claim['gender']}",
        f"HD*{'024' if claim['terminated'] else '021'}**{coverage}*{plan}*EMP",
        f"DTP*348*D8*{claim['coverage_start']:%Y%m%d}",
        *([f"DTP*349*D8*{claim['service_date']:%Y%m%d}"] if claim["terminated"] else []),
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
        claim = claim_profile(index, rng, datetime(2025, 1, 1))
        for transaction_type, builder in (("837", build_837p), ("835", build_835), ("834", build_834)):
            payload = builder(index, claim, now)
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

