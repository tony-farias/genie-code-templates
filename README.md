# Genie Templates for HLS (using Lakeflow Connect)

An interactive **entity-relationship (ERD) explorer** for Health & Life Sciences data
models, deployed as a **Databricks App**. Each tab is one source system's schema, drawn
as clickable Mermaid ER diagrams grouped into functional domains, with live links to the
underlying Unity Catalog tables and per-domain **"Ask Genie"** buttons.

**Live app:** https://hls-data-models-1602460480284688.aws.databricksapps.com
(deployed in the `fe-hls` workspace, profile `fe-vm-hls-amer`)

## Tabs / models

| Tab | Source | Data const |
|-----|--------|-----------|
| Commercial CRM | Veeva Vault CRM (`veeva836`) | `VEEVA836` |
| Safety · Pharmacovigilance | Veeva Safety Vault (`safety-vault`) | `SAFETYVAULT` |
| Quality · QMS | Veeva Quality (`quality-qms-veeva`) | `QMSVEEVA` |
| Clinical · CTMS | Veeva Clinical (`clinical-ctms-veeva`) | `CTMSVEEVA` |
| Health Cloud · Benefits Verification | Salesforce Health Cloud (mock) | `PATIENTSERVICES` |
| Finance · Gross-to-Net | Oracle NetSuite (mock) | `NETSUITE_GTN` |
| Quality · HEDIS Measures | HEDIS files (Auto Loader) + Salesforce Data Cloud dims | `HEDIS` |

Per-source branding is applied automatically (Veeva orange, Salesforce blue, NetSuite red).

## How it works

- **`app.py`** — minimal Flask server that serves the `static/` folder. No backend logic.
- **`static/index.html`** — the entire UI: a `MODELS` registry (one entry per tab) plus
  rendering/branding/Genie-wiring code. This is the file you edit to add a tab, change
  branding, or wire a Genie space.
- **`static/data.js`** — generated model data (one `const` per tab). **Do not hand-edit**;
  regenerate with the `generate_*.py` scripts (see [BUILD.md](BUILD.md)).

### Wiring a Genie space to a tab/section
Add a `genieByDomain` map to that model in `index.html` — keys are section (domain) names,
values are Genie room URLs. When present, that section's button opens the Genie space
instead of the mock modal. Cross-workspace URLs are fine. Example:
```js
genieByDomain: {
  "Benefits Verification": "https://<host>/genie/rooms/<space_id>?o=<org_id>"
}
```

## Local development
```bash
pip install -r requirements.txt
python app.py            # serves on http://localhost:8000
```

## Deploy
Deploys are handled by [`deploy.sh`](deploy.sh) (uploads the runtime files to the
workspace and runs `databricks apps deploy`):
```bash
./deploy.sh
```
Requires the Databricks CLI authenticated to the `fe-vm-hls-amer` profile.

> ⚠️ **The deployed app is the source of truth.** Local copies can drift. Before making
> changes, pull the current deployment first:
> ```bash
> databricks workspace export-dir \
>   /Workspace/Users/antonio.farias@databricks.com/apps/hls-data-models . \
>   --profile fe-vm-hls-amer --overwrite
> ```

## Repo layout
```
app.py app.yaml requirements.txt   # Databricks App runtime (deployed)
static/index.html static/data.js   # UI + generated data (deployed)
generate_*.py  netsuite_gtn.js     # build-time model generators (NOT deployed) — see BUILD.md
deploy.sh                          # deploy to fe-hls
demos/hedis-quality/               # runnable Lakeflow ingestion demo (NOT deployed) — see its README
skills/                            # Claude Code skills for this project (NOT deployed)
  app-skills/                      #   Databricks application build and deployment skills
    x12-health-plan-analytics/     #   discover X12 data and deploy Health Plan Analytics
  genie-creation-skills/           #   Genie space creation + domain grounding skills
  lakeflow-connect-skills/         #   (placeholder for Lakeflow Connect ingestion skills)
```

## Skills
The `skills/` folder holds agent skills for working on this project, grouped into
three categories under the common `skills/` folder:

```
skills/
  app-skills/                                 # Databricks application build and deployment skills
    deploy-monday-morning-scintilla/          # recreate and deploy the Monday Morning CPG app
    x12-health-plan-analytics/                 # discover X12 data and deploy Health Plan Analytics
  genie-creation-skills/
    create-genie-space/               SKILL.md   # create a Genie space via API + wire it into the app
    health-cloud-benefits/            SKILL.md   # Health Cloud Benefits Verification: Lakeflow ingestion → metric views → Genie
    life-sciences-intelligent-sales/  SKILL.md   # Life Sciences Intelligent Sales: Lakeflow ingestion → metric views → Genie
  lakeflow-connect-skills/                       # Lakeflow Connect ingestion skills
    hedis-file-ingestion/             SKILL.md   # HEDIS files (Auto Loader) + Salesforce Data Cloud dims
```

### Which category does a skill belong in?

- **`app-skills/`** — anything about **building and deploying Databricks Apps**, including
  application architecture, required data discovery, configuration, and customer-environment
  deployment workflows.
- **`genie-creation-skills/`** — anything about **building or grounding Databricks AI/BI
  Genie spaces**: creating/configuring a space, wiring it into a tab's "Ask Genie" button,
  and the *domain knowledge that makes Genie answer well* — data-model schema definitions,
  table relationships/join logic, column semantics, sample questions, and instructions for
  a specific source (e.g. `health-cloud-benefits`).
- **`lakeflow-connect-skills/`** — anything about **getting source data into Unity Catalog
  via Lakeflow Connect**: setting up/managing ingestion connectors (Salesforce, Veeva,
  Workday, ServiceNow, SQL Server, …), pipeline creation/monitoring/troubleshooting, and
  source→UC schema mapping.

> **Rule of thumb:** if the skill is about *querying / answering questions over* a data
> model (Genie, schema, joins, SQL) → `genie-creation-skills`. If it's about *ingesting /
> landing* the data (connectors, pipelines) → `lakeflow-connect-skills`.
>
> An end-to-end skill that ingests *and* grounds belongs in `genie-creation-skills` when the
> deliverable is a Genie space — the ingestion is a prerequisite step, not the goal.

### How to add a new skill
1. Create a folder under the right category: `skills/<category>/<skill-name>/`
   (use a short, kebab-case skill name).
2. Add a **`SKILL.md`** with YAML frontmatter — `name` and `description`. The
   **`description` is what tells Claude when to invoke the skill**, so make it specific
   (name the tables/tasks/triggers it covers). Put the how-to in the body; add any
   supporting files (SQL, scripts, sample data) in the same folder.
   ```markdown
   ---
   name: my-skill
   description: One specific line — what it does and when to use it (name the triggers).
   ---
   # My skill
   …instructions…
   ```
3. Commit + push.
4. To make it usable in Claude Code, copy or symlink the **skill folder** into
   `~/.claude/skills/<skill-name>/` — personal skills are discovered one level under that
   folder, so the category nesting here is for organization; drop the leaf skill folder in
   directly (or package the whole `skills/` tree as a plugin, which does support grouping).
5. To make it usable in Cursor, symlink the **skill folder** into `.cursor/skills/<skill-name>/`
   (project-scoped, so it works for anyone who clones the repo). Same one-level rule as above:
   ```bash
   ln -sfn ../../skills/<category>/<skill-name> .cursor/skills/<skill-name>
   ```
   Cursor auto-invokes a skill by matching the prompt against its `description`, so include the
   phrasings users will actually type. Adding `disable-model-invocation: true` to the frontmatter
   opts out of auto-invocation, making the skill load only when named explicitly.
