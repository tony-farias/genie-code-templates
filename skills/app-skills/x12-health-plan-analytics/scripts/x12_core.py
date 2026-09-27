"""PHI-safe X12 classification and envelope validation."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
from typing import Iterable


SUPPORTED_VERSION_PREFIXES = ("00501",)


@dataclass(frozen=True)
class X12Classification:
    is_x12: bool
    valid: bool
    transaction_types: tuple[str, ...]
    version: str | None
    errors: tuple[str, ...]
    fingerprint: str

    def safe_dict(self) -> dict[str, object]:
        """Return metadata safe for reports and logs."""
        return asdict(self)


def fingerprint(payload: str) -> str:
    return hashlib.sha256(payload.encode("utf-8", errors="replace")).hexdigest()


def _segment_terminator(payload: str) -> str:
    compact = payload.lstrip("\ufeff\r\n \t")
    if compact.startswith("ISA") and len(compact) > 105:
        candidate = compact[105]
        if not candidate.isalnum() and not candidate.isspace():
            return candidate
    return "~"


def split_segments(payload: str) -> list[list[str]]:
    compact = payload.lstrip("\ufeff\r\n \t")
    if not compact:
        return []
    element_separator = compact[3] if compact.startswith("ISA") and len(compact) > 3 else "*"
    terminator = _segment_terminator(compact)
    raw_segments = compact.replace("\r", "").replace("\n", "").split(terminator)
    return [segment.strip().split(element_separator) for segment in raw_segments if segment.strip()]


def _first(segments: Iterable[list[str]], name: str) -> list[str] | None:
    return next((segment for segment in segments if segment and segment[0] == name), None)


def classify_x12(payload: str) -> X12Classification:
    segments = split_segments(payload)
    errors: list[str] = []
    names = [segment[0] for segment in segments if segment]
    is_x12 = bool(segments and names[0] == "ISA" and "ST" in names)

    if not is_x12:
        return X12Classification(False, False, (), None, ("not_x12",), fingerprint(payload))

    for required in ("ISA", "GS", "ST", "SE", "GE", "IEA"):
        if required not in names:
            errors.append(f"missing_{required.lower()}")

    isa = _first(segments, "ISA")
    gs = _first(segments, "GS")
    ge = _first(segments, "GE")
    iea = _first(segments, "IEA")
    version = None
    if gs and len(gs) > 8:
        version = gs[8]
    elif isa and len(isa) > 12:
        version = isa[12]

    if version and not version.startswith(SUPPORTED_VERSION_PREFIXES):
        errors.append("unsupported_version")

    if isa and iea and len(isa) > 13 and len(iea) > 2 and isa[13] != iea[2]:
        errors.append("interchange_control_mismatch")
    if gs and ge and len(gs) > 6 and len(ge) > 2 and gs[6] != ge[2]:
        errors.append("group_control_mismatch")

    transaction_types: set[str] = set()
    st_positions = [index for index, segment in enumerate(segments) if segment[0] == "ST"]
    for st_index in st_positions:
        st = segments[st_index]
        if len(st) > 1:
            transaction_types.add(st[1])
        se_index = next(
            (index for index in range(st_index + 1, len(segments)) if segments[index][0] == "SE"),
            None,
        )
        if se_index is None:
            errors.append("missing_se_for_transaction")
            continue
        se = segments[se_index]
        if len(st) > 2 and len(se) > 2 and st[2] != se[2]:
            errors.append("transaction_control_mismatch")
        if len(se) > 1:
            try:
                expected = int(se[1])
                actual = se_index - st_index + 1
                if expected != actual:
                    errors.append("segment_count_mismatch")
            except ValueError:
                errors.append("invalid_segment_count")

    unique_errors = tuple(dict.fromkeys(errors))
    return X12Classification(
        is_x12=True,
        valid=not unique_errors,
        transaction_types=tuple(sorted(transaction_types)),
        version=version,
        errors=unique_errors,
        fingerprint=fingerprint(payload),
    )

