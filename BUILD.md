# Build notes

`static/data.js` is generated, not hand-edited. Each tab's model is one `const`
produced by a generator script; all consts are concatenated into `static/data.js`.

| Tab | const | generator | source |
|-----|-------|-----------|--------|
| Commercial CRM | `VEEVA836` | `generate_data.py` | UC `ravivijay_catalog.veeva836` metadata dump |
| Safety · Pharmacovigilance | `SAFETYVAULT` | `generate_safety.py` | UC `ravivijay_catalog.safety-vault` |
| Quality · QMS | `QMSVEEVA` | `generate_qms.py` | UC `ravivijay_catalog.quality-qms-veeva` |
| Clinical · CTMS | `CTMSVEEVA` | `generate_clinical.py` | UC `ravivijay_catalog.clinical-ctms-veeva` |
| Health Cloud · Benefits Verification | `PATIENTSERVICES` | `generate_patient_services.py` | curated Salesforce Health Cloud model (mock) |
| Finance · Gross-to-Net | `NETSUITE_GTN` | `generate_netsuite.py` | curated Oracle NetSuite GTN model (mock) |
| Quality · HEDIS Measures | `HEDIS` | `generate_hedis.py` | curated HEDIS star schema (mock) |

The Veeva/Safety/Quality/Clinical generators read a UC tables-API JSON dump (see each
file's `SRC` path) and infer FK edges from naming conventions. The Salesforce and
NetSuite models are curated (no live source). Regenerate a const, then append/replace
it in `static/data.js`.
