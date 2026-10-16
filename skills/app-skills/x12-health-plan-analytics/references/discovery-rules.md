# Discovery rules

## Metadata phase

Query `<catalog>.information_schema.tables` and `<catalog>.information_schema.columns`. Rank string and binary columns using table names, column names, comments, and tags containing terms such as `x12`, `edi`, `837`, `835`, `834`, `payload`, `message`, `body`, and `raw`.

Also list `<catalog>.information_schema.volumes`. X12 usually lands as files, and the parser's native input is one whole file per row, so a Volume is a first-class candidate. Rank Volumes by name and comment tokens (`x12`, `edi`, `837`, `835`, `834`, `claim`, `remit`, `enroll`, `inbound`, `landing`, `raw`) and sample up to `--max-volumes` of them even when no token matches, because file stores are often named generically.

## Content phase

For a Volume, sample files through the warehouse with `read_files(<path>, format => 'text', wholeText => true, recursiveFileLookup => true)`. Each file path (`_metadata.file_path`) is the source-record key; files larger than `--max-file-chars` are counted but not classified.


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

## Match likelihood and feature coverage

Each candidate also reports `match_likelihood`, a summary for the person confirming the source. It is derived from the readiness score and is not a probability:

| Band | Rule |
|---|---|
| `high` | Readiness status is `ready` |
| `medium` | Status is `needs_review` with a score of at least 60 |
| `low` | Any other readable candidate |
| `unknown` | The candidate could not be sampled |

`feature_coverage` maps the discovered transaction mix to what the deployment can power, so a partial source is visible before any write:

| Capability | Requires |
|---|---|
| `provider_analysis`, `siu_letters`, `member_utilization` | 837 |
| `payment_analysis` | 835 |
| `coverage_context` | 834 |

## Parser dry run

With `--parser-dry-run`, discovery parses the sampled X12 payloads in memory with the pinned parser (`HealthcareManager.from_edi`) and reports only counts: attempted, parsed, rejected, parsed records, and rejection exception types. Parser error messages are discarded because they can quote payload content. A rejection adds the `pinned_parser_rejected_sampled_payloads` warning. The parser must be importable; PyPI may be unreachable, so put a clone of the pinned commit on `PYTHONPATH`.

Source-record-key discovery may consider generic identifiers such as `record_id`, `source_record_id`, `message_id`, or `event_id`. It must not propose patient, member, subscriber, claim, provider, NPI, SSN, or account identifiers as the Bronze source-row key. Never emit sampled key values.

## Privacy

Discovery output may contain table and Volume identifiers, payload-column and source-record-key column identifiers, hashes, transaction types, versions, counts, readiness evidence, and validation failures. It must not contain raw X12, sampled key values or file paths, member names, addresses, subscriber IDs, or other payload values.

## Confirmation

The discovery report is not authorization to write. Obtain explicit confirmation of the selected table, payload column, primary-key column, transaction types, and destination catalog/schema.
