# Golden App contract

The App is a versioned product asset, not a generated design. `DESIGN.md` documents the visual vocabulary; `assets/app-template` and its source, compiled-bundle, and visual regression gates are normative.

## Generation boundary

A skill run may generate only `app-config.json`. It must copy all other files from `assets/app-template` byte-for-byte. Do not ask an LLM to restyle, rearrange, or rewrite React, HTML, CSS, backend routes, or interaction copy during deployment.

The configurable fields are:

- catalog, schema, warehouse, Genie Space ID, and Genie URL;
- the seven approved Gold table identifiers;
- product, plan, and segment labels;
- peer-ratio thresholds and minimum-volume thresholds;
- explicit feature flags.

Unsupported functionality must be disabled with a feature flag. Never populate a required feature with invented data.

## Stable surfaces

The visual and behavioral contract contains three navigation surfaces in this order:

1. Dashboard
2. SIU Workbench
3. Ask Genie

The Dashboard shows peer-variance KPIs, code variance, provider distribution, the prioritized provider table, and aggregate parser evidence. The SIU Workbench supports provider search, procedure or diagnosis benchmarking, code comparison, claim review, de-identified member utilization, deterministic analysis, reviewer-editable letters, and provider-scoped Genie. Ask Genie is an embedded governed conversation, not only an external link.

## Stable API routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Health and template version |
| GET | `/api/meta` | Branding, source, features, and Genie URL |
| GET | `/api/dashboard` | Dashboard evidence for a benchmark basis |
| GET | `/api/siu/providers` | Bounded provider search |
| GET | `/api/siu/provider/{provider}` | Provider code benchmarks |
| GET | `/api/siu/provider/{provider}/claims` | Bounded provider claims |
| GET | `/api/siu/provider/{provider}/members` | Aggregate member-utilization context |
| GET | `/api/siu/provider/{provider}/member-list` | Bounded de-identified member list |
| GET | `/api/siu/provider/{provider}/analysis` | Deterministic source-backed synthesis |
| GET | `/api/siu/provider/{provider}/letter` | Reviewer-editable deterministic draft |
| POST | `/api/siu/provider/{provider}/genie` | Provider-scoped Genie question |
| POST | `/api/genie/ask` | General Genie question |

Benchmark basis is `procedure` or `diagnosis`. The backend computes peer statistics directly from curated claims and claim-line tables; it does not claim that variance is confirmed fraud.

## Safety boundary

- Query only configured Gold tables.
- Use the Gold-only App service principal for all fixed SQL routes. Request only `dashboards.genie` for interactive Genie, always use its forwarded viewer token, and never bypass a viewer authorization failure with service-principal fallback.
- Never return raw X12, parser JSON, names, addresses, exact birth dates, or direct member identifiers.
- Member keys shown in the App are SHA-256 pseudonyms and are visually shortened.
- Utilization index is member total claim amount divided by the population median. Label it as utilization context, never a clinical risk score.
- Letters and analytical summaries are deterministic and derived from the values displayed in the App.
- Genie prompts name only the configured curated namespace and selected provider.

## Change control

The template uses semantic versions. A visual, route, schema, or interaction change requires:

1. Update the editable source.
2. Build the frontend.
3. Run `scripts/verify_app_template.py`.
4. Inspect all local preview surfaces.
5. Approve intentional screenshots with `scripts/visual_regression.py --approve`.
6. Update the source lock with `scripts/verify_app_template.py --update-lock`.
7. Bump the template version for any externally observable change.

Ordinary deployments must run the gates without either approval flag. A mismatch is a deployment failure, not an invitation to regenerate the UI.
