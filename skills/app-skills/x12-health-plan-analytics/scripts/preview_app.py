#!/usr/bin/env python3
"""Serve the golden frontend with deterministic fictional API responses."""

from __future__ import annotations

import argparse
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parents[1]
PROVIDER = "1588667638"


def dashboard() -> dict[str, object]:
    return {
        "basis": "procedure",
        "kpis": {
            "providers": 1247,
            "codeRows": 98214,
            "claims": 2841970,
            "cost": 483920000,
            "aboveP75": 18440,
            "aboveP75Pct": 18.8,
            "excessCost": 28640000,
        },
        "tiers": [
            {"tier": "High", "providers": 63, "cost": 62400000, "color": "#C62828", "share": 5.1},
            {"tier": "Medium", "providers": 249, "cost": 142800000, "color": "#E65100", "share": 20.0},
            {"tier": "Low", "providers": 935, "cost": 278720000, "color": "#2E7D32", "share": 74.9},
        ],
        "topCodes": [
            {"code": "99215", "providers": 412, "claims": 28412, "excess": 5820000},
            {"code": "99214", "providers": 518, "claims": 38124, "excess": 4610000},
            {"code": "27447", "providers": 84, "claims": 3182, "excess": 3820000},
            {"code": "70553", "providers": 101, "claims": 5820, "excess": 2980000},
            {"code": "29881", "providers": 77, "claims": 2284, "excess": 2410000},
            {"code": "93010", "providers": 295, "claims": 19330, "excess": 1920000},
            {"code": "97110", "providers": 213, "claims": 26190, "excess": 1540000},
            {"code": "36415", "providers": 388, "claims": 42800, "excess": 980000},
        ],
        "outliers": [
            {
                "provider": value,
                "providerName": name,
                "codes": codes,
                "claims": claims,
                "cost": cost,
                "hot": hot,
                "avgCost": average,
                "benchmarkAvgCost": benchmark,
                "peerRatio": ratio,
                "variancePct": round((ratio - 1) * 100, 1),
                "tier": tier,
            }
            for value, name, codes, claims, cost, hot, average, benchmark, ratio, tier in [
                (PROVIDER, "Northstar Orthopedic Group", 41, 2844, 4830000, 19, 1698, 815, 2.08, "High"),
                ("1093741120", "Valley Imaging Partners", 28, 1940, 3420000, 13, 1763, 892, 1.98, "High"),
                ("1962408574", "Harbor Cardiology", 36, 3288, 5180000, 17, 1575, 834, 1.89, "High"),
                ("1427051632", "Meridian Surgical Center", 22, 1162, 2910000, 10, 2504, 1374, 1.82, "High"),
                ("1730182916", "Lakeside Medical Associates", 47, 4812, 4080000, 18, 848, 480, 1.77, "High"),
                ("1871592034", "Pioneer Rehabilitation", 31, 2950, 1890000, 12, 641, 372, 1.72, "High"),
            ]
        ],
        "quality": [
            {"transactionType": "837", "status": "parsed", "records": 160},
            {"transactionType": "835", "status": "parsed", "records": 158},
            {"transactionType": "834", "status": "parsed", "records": 162},
            {"transactionType": "837", "status": "quarantined", "records": 2},
        ],
    }


def provider_detail() -> dict[str, object]:
    services = []
    for index, code in enumerate(["99215", "27447", "29881", "70553", "99214", "97110", "93010", "36415"]):
        claims = 380 - index * 31
        benchmark = 120 + index * 34
        average = benchmark * (2.08 - index * 0.08)
        total = average * claims
        services.append(
            {
                "code": code,
                "description": None,
                "excess": round((average - benchmark) * claims, 2),
                "claims": claims,
                "avgCost": round(average, 2),
                "totalCost": round(total, 2),
                "benchmarkAvgCost": benchmark,
                "benchmarkMedianCost": round(benchmark * 0.94, 2),
                "benchmarkP25": round(benchmark * 0.72, 2),
                "benchmarkP75": round(benchmark * 1.28, 2),
                "variancePct": round((average / benchmark - 1) * 100, 1),
                "aboveP75": average > benchmark * 1.28,
            }
        )
    return {
        "provider": PROVIDER,
        "providerName": "Northstar Orthopedic Group",
        "basis": "procedure",
        "summary": {
            "codeCount": len(services),
            "totalClaims": sum(item["claims"] for item in services),
            "totalCost": round(sum(item["totalCost"] for item in services), 2),
            "avgCostPerClaim": 1698.24,
            "codesAboveBenchmark": 8,
            "codesAboveP75": 7,
            "excessCost": round(sum(item["excess"] for item in services), 2),
            "excessSharePct": 43.7,
            "peerRatio": 2.08,
            "tier": "High",
        },
        "services": services,
    }


def claims() -> dict[str, object]:
    rows = [
        {
            "claimId": f"SYNTH-837-{index:04d}",
            "memberKey": f"7b8c12a94f30{index:02d}f19452b7c901e58c4fb71de9d75b8d4f90532ef3d",
            "serviceDate": f"2026-0{(index % 8) + 1}-{(index % 25) + 1:02d}",
            "diagnosisCode": ["M1711", "M25561", "M545", "S83241A"][index % 4],
            "lines": (index % 4) + 1,
            "deniedLines": 1 if index % 6 == 0 else 0,
            "allowed": 840 + index * 137,
            "paid": 720 + index * 111,
        }
        for index in range(18)
    ]
    return {"provider": PROVIDER, "total": 2844, "shown": len(rows), "truncated": True, "totalAllowed": 4830000, "claims": rows}


def members() -> dict[str, object]:
    rows = [
        {
            "memberKey": f"4ac718f26d{index:02d}e1237e9561f5c29d07d71f71bdf76f3a7de812219fe4",
            "claims": 12 - (index % 5),
            "allowed": 14800 - index * 310,
            "birthYear": 1948 + index,
            "genderCode": "F" if index % 2 else "M",
            "stateCode": ["NY", "NJ", "CT"][index % 3],
            "utilizationIndex": round(3.2 - index * 0.11, 2),
            "totalAllowed": 22800 - index * 430,
        }
        for index in range(18)
    ]
    return {
        "provider": PROVIDER,
        "total": 912,
        "shown": len(rows),
        "truncated": True,
        "summary": {"members": 912, "scored": 912, "avgUtilizationIndex": 1.48, "medianUtilizationIndex": 1.12, "highUtilization": 144},
        "members": rows,
    }


def analysis() -> dict[str, object]:
    return {
        "provider": PROVIDER,
        "basis": "procedure",
        "summary": [
            "Provider 1588667638 appears across 41 procedure codes and 2,844 claim observations, totaling $4.8M.",
            "The claim-weighted amount ratio is 2.08× the peer benchmark for the same codes. Nineteen codes exceed the peer 75th percentile.",
            "Positive variance above the peer average totals $2.1M. This is a prioritization estimate, not a validated recovery amount.",
        ],
        "findings": [
            "Code 99215 is the largest variance contributor, with an average amount 108% above its peer benchmark.",
            "The top five codes account for 78% of measured positive variance.",
        ],
        "recommendations": [
            "Review source claims for the largest variance codes: 99215, 27447, and 29881.",
            "Confirm the comparison uses an appropriate specialty, geography, and service mix.",
            "Review adjacent periods before deciding whether to escalate.",
        ],
        "savingsOpportunity": 2110000,
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory: str, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def log_message(self, format: str, *args: object) -> None:
        return

    def json_response(self, value: object, status: int = HTTPStatus.OK) -> None:
        payload = json.dumps(value).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/meta":
            return self.json_response(
                {
                    "product_name": "FWA Shield",
                    "plan_name": "Health Plan Analytics",
                    "segment": "Governed X12 claims and payment analytics",
                    "template_version": "1.0.1",
                    "source": "health_plan_demo.x12_analytics",
                    "genie_url": "https://example.invalid/genie",
                    "features": {"provider_analysis": True, "letters": True, "embedded_genie": True, "member_utilization": True},
                }
            )
        if path == "/api/dashboard":
            return self.json_response(dashboard())
        if path == "/api/siu/providers":
            return self.json_response({"providers": [dashboard()["outliers"][0]]})
        if path == f"/api/siu/provider/{PROVIDER}":
            return self.json_response(provider_detail())
        if path == f"/api/siu/provider/{PROVIDER}/claims":
            return self.json_response(claims())
        if path in {f"/api/siu/provider/{PROVIDER}/member-list", f"/api/siu/provider/{PROVIDER}/members"}:
            return self.json_response(members())
        if path == f"/api/siu/provider/{PROVIDER}/analysis":
            return self.json_response(analysis())
        if path == f"/api/siu/provider/{PROVIDER}/letter":
            return self.json_response(
                {
                    "provider": PROVIDER,
                    "basis": "procedure",
                    "generatedOn": "2026-09-25",
                    "letter": "Date: September 25, 2026\n\nProvider ID: 1588667638\n\nRE: Comparative billing review\n\nDear Provider,\n\nThis fictional draft demonstrates the reviewer workflow. No message is sent automatically.",
                }
            )
        if path.startswith("/api/"):
            return self.json_response({"detail": "Unknown mock endpoint"}, HTTPStatus.NOT_FOUND)
        if path == "/" or not (Path(self.directory) / path.lstrip("/")).is_file():
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length) or b"{}")
        parsed = urlparse(self.path)
        if parsed.path == "/api/genie/ask" or parsed.path.endswith("/genie"):
            return self.json_response(
                {
                    "conversation_id": body.get("conversation_id") or "fictional-conversation",
                    "message_id": "fictional-message",
                    "text": "This fictional preview response is grounded in the curated X12 Gold model.",
                    "table": {"columns": ["metric", "value"], "rows": [["Claims reviewed", 2844], ["Peer ratio", "2.08x"]]},
                }
            )
        return self.json_response({"detail": "Unknown mock endpoint"}, HTTPStatus.NOT_FOUND)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--dist", type=Path, default=ROOT / "assets" / "app-template" / "frontend" / "dist")
    args = parser.parse_args()
    if not (args.dist / "index.html").exists():
        raise SystemExit(f"Build the frontend first; no index.html found under {args.dist}")
    handler = lambda *values, **kwargs: Handler(*values, directory=str(args.dist), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    print(f"Previewing {args.dist} at http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
