# Discovery rules

## Metadata phase

Query `<catalog>.information_schema.tables` and `<catalog>.information_schema.columns`. Rank string and binary columns using table names, column names, comments, and tags containing terms such as `x12`, `edi`, `837`, `835`, `834`, `payload`, `message`, `body`, and `raw`.

## Content phase

Sample only the highest-ranked candidates. A valid X12 candidate should contain:

- An `ISA` interchange header and `IEA` trailer.
- A `GS` functional-group header and `GE` trailer.
- At least one matching `ST` and `SE` transaction pair.
- Matching interchange, group, and transaction control numbers.
- An `SE01` count equal to the number of segments from `ST` through `SE`, inclusive.

Use `ST01` to classify 837, 835, and 834 transactions. Treat versions not beginning with `00501` as unsupported unless the deployment explicitly expands support.

## Bronze-readiness assessment

The discovery report is the first workflow deliverable. Rank every readable candidate with a deterministic score from 0 to 100. The score is a source-readiness aid, not a statistical probability and not permission to deploy.

| Component | Weight | Evidence |
|---|---:|---|
| X12 payload match | 30 | Fraction of sampled non-null payloads recognized as X12 |
| Structural validity | 20 | Fraction of recognized X12 rows with valid envelope, control-number, and segment-count structure; version support is scored separately |
| Supported version | 15 | Fraction of recognized X12 rows using a `00501` version |
| Supported transaction type | 15 | Fraction of recognized X12 rows containing only 837, 835, or 834 transactions |
| Source-record key | 15 | Non-null and unique generic source-row identifier in the sample |
| Sample sufficiency | 5 | Evidence coverage, up to 25 sampled rows |

Use these statuses:

- `ready`: score is at least 90, the evidence target is met, and no blocking issue exists.
- `needs_review`: the source is plausible but has limited evidence or a score below 90 without a hard blocker.
- `not_ready`: the sample has no identifiable X12, no supported transaction type, or no suitable source-record key.
- `access_failed`: the candidate was identified from metadata but could not be sampled.

The report must show component points, ratios, counts, blocking issues, and warnings. It may recommend the highest-ranked candidate for review, but it must not select or deploy it automatically. Retain `confidence` only as a backward-compatible alias for `x12_match_ratio`; do not describe that field as overall Bronze readiness.

Source-record-key discovery may consider generic identifiers such as `record_id`, `source_record_id`, `message_id`, or `event_id`. It must not propose patient, member, subscriber, claim, provider, NPI, SSN, or account identifiers as the Bronze source-row key. Never emit sampled key values.

## Privacy

Discovery output may contain table identifiers, payload-column and source-record-key column identifiers, hashes, transaction types, versions, counts, readiness evidence, and validation failures. It must not contain raw X12, sampled key values, member names, addresses, subscriber IDs, or other payload values.

## Confirmation

The discovery report is not authorization to write. Obtain explicit confirmation of the selected table, payload column, primary-key column, transaction types, and destination catalog/schema.
