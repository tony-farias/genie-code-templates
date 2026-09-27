#!/usr/bin/env python3
"""Capture and compare deterministic App screenshots from the local preview."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
BASELINES = ROOT / "tests" / "visual-baselines"
PAGES = {
    "dashboard-desktop": ("/", 1440, 1000),
    "siu-desktop": ("/?page=siu&provider=1588667638", 1440, 1100),
    "genie-desktop": ("/?page=genie", 1440, 1000),
    "dashboard-mobile": ("/", 390, 844),
}


def executable(*candidates: str) -> str:
    for candidate in candidates:
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
        if Path(candidate).exists():
            return candidate
    raise RuntimeError(f"None of these executables was found: {', '.join(candidates)}")


def capture(chrome: str, url: str, width: int, height: int, output: Path) -> None:
    result = subprocess.run(
        [
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            "--virtual-time-budget=2500",
            f"--window-size={width},{height}",
            f"--screenshot={output}",
            url,
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode or not output.exists():
        raise RuntimeError(result.stderr.strip() or "Chrome did not create a screenshot")


def changed_pixels(magick: str, baseline: Path, candidate: Path) -> int:
    result = subprocess.run(
        [magick, "compare", "-metric", "AE", str(baseline), str(candidate), "null:"],
        capture_output=True,
        text=True,
    )
    metric = (result.stderr or result.stdout).strip().splitlines()[-1]
    match = re.match(r"([0-9.eE+-]+)", metric)
    if not match:
        raise RuntimeError(f"Could not parse ImageMagick metric: {metric}")
    return int(float(match.group(1)))


def dimensions(magick: str, image: Path) -> tuple[int, int]:
    result = subprocess.run(
        [magick, "identify", "-format", "%w %h", str(image)],
        capture_output=True,
        text=True,
        check=True,
    )
    width, height = result.stdout.split()
    return int(width), int(height)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:4173")
    parser.add_argument("--approve", action="store_true", help="Replace baselines with current renders")
    parser.add_argument("--max-difference", type=float, default=0.01, help="Maximum changed-pixel ratio")
    args = parser.parse_args()

    chrome = executable(
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "google-chrome",
        "chromium",
        "chromium-browser",
    )
    magick = executable("magick")
    BASELINES.mkdir(parents=True, exist_ok=True)
    results: dict[str, object] = {}

    with tempfile.TemporaryDirectory(prefix="x12-app-visual-") as temporary:
        output_dir = Path(temporary)
        for name, (path, width, height) in PAGES.items():
            candidate = output_dir / f"{name}.png"
            baseline = BASELINES / f"{name}.png"
            capture(chrome, f"{args.base_url.rstrip('/')}{path}", width, height, candidate)
            if args.approve:
                shutil.copyfile(candidate, baseline)
                results[name] = {"approved": True, "difference": 0.0}
                continue
            if not baseline.exists():
                results[name] = {"passed": False, "error": "baseline missing"}
                continue
            changed = changed_pixels(magick, baseline, candidate)
            actual_width, actual_height = dimensions(magick, baseline)
            ratio = changed / (actual_width * actual_height)
            results[name] = {
                "passed": ratio <= args.max_difference,
                "difference": round(ratio, 6),
                "changed_pixels": changed,
            }

    passed = args.approve or all(bool(result.get("passed")) for result in results.values())
    print(json.dumps({"passed": passed, "screenshots": results}, indent=2, sort_keys=True))
    if not passed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
