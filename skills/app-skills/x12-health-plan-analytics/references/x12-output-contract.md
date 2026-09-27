# X12 output contract

## Bronze

`raw_x12` preserves `source_table`, `source_record_id`, `payload_hash`, `transaction_types`, `detected_version`, `ingested_at`, and the restricted raw payload.

The input feeding Bronze therefore needs only two required source fields: a stable, non-null source-record identifier and a raw X12 payload in a `STRING` or `BINARY` column. A transaction-type column, ingestion timestamp, source filename, and sender/receiver metadata are useful but optional because the pipeline derives type, version, and payload hash from the X12 envelope. The automated discovery implementation currently inspects Unity Catalog tables; files in Volumes should first be exposed through a governed table or view.

## Silver

- `parsed_transactions`: source identity, payload hash, envelope metadata, parser JSON, parser version, and parse status. Parser failures retain only a generic error code and SHA-256 error fingerprint; upstream error text is never persisted.
- `claim_header`: one row per 837 claim.
- `claim_line`: one row per 837 service line, keyed by source, claim ID, and line number.
- `remittance`: 835 claim and service payment details.
- `enrollment`: 834 member coverage details.
- `x12_quarantine`: source identity, payload hash, error code, safe error details, and processing timestamp.

## Gold

- `members`
- `providers`
- `claims`
- `claim_lines`
- `payments`
- `enrollments`
- `data_quality`

Gold identifiers and clinical codes remain strings. Direct member identifiers and names are excluded; `member_key` is a one-way SHA-256 value used for analytics joins. Source primary keys are also replaced by a one-way `source_record_key` before Gold publication. Fields not present in the source remain null; the pipeline must not invent demographic, coverage, or financial facts.

The App and Genie Agent receive access only to Gold tables and approved metric views.
