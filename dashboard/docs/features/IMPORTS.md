# Data Import Feature

## Context and Purpose

The import feature allows users to load external company datasets (JSON, JSONL, CSV) from any country into the Explorer. An LLM (Groq `llama-3.3-70b-versatile`) analyzes the file structure and proposes a field mapping to the internal company schema. Users review, edit, and confirm the mapping before import proceeds.

This is **separate from campaigns**. Campaigns remain outreach-only. The imported companies appear in the Explorer alongside the curated Italian data via the `all_companies` unified view.

CFO/contact enrichment of imported companies is a future, separate feature.

---

## Data Model

### `import_batches` table
One row per file upload session.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| team_id | uuid FK→teams | RLS: team-scoped |
| source_name | text | Slug, e.g. `wachstumschampions_2026` |
| country_code | char(2) | ISO 3166-1 alpha-2, e.g. `DE` |
| year | int | Ranking publication year |
| file_name | text | Original uploaded filename |
| file_format | text | `json` / `jsonl` / `csv` |
| total_records | int | Detected row count |
| imported_count | int | Rows successfully upserted |
| skipped_count | int | Rows skipped (errors or duplicates) |
| status | text | `pending` / `mapping` / `importing` / `done` / `failed` |
| created_by | uuid FK→profiles | |

### `field_mappings` table
LLM-generated mapping, editable by user, with review lifecycle.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| batch_id | uuid FK→import_batches | |
| team_id | uuid FK→teams | |
| source_schema | jsonb | Array of dot-notation field names observed in file |
| mapping | jsonb | `{ "source.field": { target, transform, confidence } }` |
| status | text | `pending_review` / `approved` / `rejected` |
| approved_by | uuid FK→profiles | |
| approved_at | timestamptz | |
| llm_model | text | e.g. `llama-3.3-70b-versatile` |

Partial unique index: only one `approved` mapping per batch allowed.

### `imported_companies` table
Individual company records from file imports.

Key columns: `name`, `website`, `country_code`, `region`, `city`, `sector`, `growth_rate`, `revenue_a`, `revenue_b`, `year`, `national_rank`, `foundation_year`, `description`, `employees_start`, `employees_end`, `is_listed`, `cfo_nome/ruolo/linkedin/confidenza` (null at import), `extra_data` (JSONB for unmapped fields), `raw_data` (original record).

Unique constraint: `(team_id, source_name, source_key)` — enables safe re-import (upsert).

### `all_companies` view
Unions `companies_full` (curated Italian data) with `imported_companies` (team-scoped imports) into a single queryable shape compatible with the existing `CompanyFullRow` interface. Used by `loadCompanies()` in `data.ts`.

The imported side filters by `auth.uid()` team membership directly in the view SQL to enforce team isolation.

---

## File Structure

### New files

```
dashboard/supabase/migrations/004_import_companies.sql
dashboard/src/lib/file-parser.ts          — parseFileSample(), parseAllRecords(), detectFormat()
dashboard/src/lib/groq-mapper.ts          — callGroqMapper(), applyMapping(), applyTransformHint()
dashboard/src/app/api/imports/
  route.ts                                — GET (list batches), POST (upload + Groq + create batch)
  [batchId]/mapping/route.ts              — PATCH (approve mapping with edits)
  [batchId]/run/route.ts                  — POST (apply mapping, upsert companies)
dashboard/src/components/imports/
  FileUploadWizard.tsx                    — 3-step Dialog with useReducer
  MappingTable.tsx                        — Editable field mapping table
```

### Modified files

```
dashboard/src/types/index.ts              — Added ImportBatch, FieldMapping, ImportedCompany, ParseResult, FieldMappingResult
dashboard/src/lib/constants.ts            — Added IMPORT_TARGET_FIELDS, SUPPORTED_COUNTRIES
dashboard/src/lib/data.ts                 — loadCompanies() now queries all_companies view
dashboard/src/app/explorer/page.tsx       — Import button + FileUploadWizard wired
dashboard/src/components/explorer/CompanyTable.tsx — sourceName shown below company name
```

---

## Main Flows

### Upload and Map

1. User clicks "Import data ↑" button in Explorer header
2. `FileUploadWizard` Dialog opens (Step 1)
3. User drops/selects a `.json`, `.jsonl`, or `.csv` file (≤ 10 MB)
4. Client-side `parseFileSample()` reads first 2 rows, extracts field names + sample values
5. User selects country and year, then clicks "Analyze ▶"
6. `POST /api/imports` is called with `multipart/form-data`:
   - File stored to Supabase Storage (`import-uploads/{teamId}/{uuid}.ext`)
   - `parseFileSample()` runs server-side
   - `callGroqMapper()` sends fields + sample values to Groq
   - `import_batches` row created (status: `mapping`)
   - `field_mappings` row created (status: `pending_review`)
   - Returns `{ batchId, fieldMappingId, fileKey, fieldMapping, totalRows }`
7. Step 2: `MappingTable` renders with editable dropdowns
8. User reviews/edits mappings, updates source name slug
9. Clicks "Confirm & Import ▶"

### Import Execution

1. `PATCH /api/imports/[batchId]/mapping` saves user-confirmed mapping (status → `approved`)
2. `POST /api/imports/[batchId]/run` executes import:
   - Downloads file from Supabase Storage
   - `parseAllRecords()` parses full file
   - `applyMapping()` transforms each record using confirmed mapping + transform hints
   - Batch upsert into `imported_companies` (50 records/batch)
   - `ON CONFLICT (team_id, source_name, source_key) DO UPDATE` — safe re-import
   - `import_batches` updated with counts and `status: done`
   - File deleted from Storage
3. Step 3: Success screen, close reloads Explorer

---

## LLM Field Mapping

### Target fields (17)
`name`, `website`, `growth_rate`, `sector`, `region`, `city`, `national_rank`, `source_key`, `revenue_a`, `revenue_b`, `year`, `description`, `foundation_year`, `employees_start`, `employees_end`, `is_listed`, `extra_data` (catch-all)

### Sample sent to Groq
First 2 rows only, complete field values (not truncated), flattened to dot-notation. Example:
```
- "account.name": "Rail Unit GmbH"  [type: string]
- "dynamicData.wch_growchampion_growth_rate_relative_pa": 4.26205  [type: number]
```

### Transform hints
Human-readable strings applied via keyword matching in `applyTransformHint()`:
- `"parse as integer"` → `parseInt()`
- `"divide by 100"` → `value / 100`
- `"extract year"` → `new Date(value).getFullYear()`
- `null` → pass through

### Graceful degradation
If Groq is unavailable (`GROQ_API_KEY` not set or API error), all fields are mapped to `extra_data` and the user maps manually in the review table.

---

## Notable Behaviors

- **Duplicate prevention**: `UNIQUE (team_id, source_name, source_key)` — reimporting the same file updates existing rows, no duplicates
- **Extra fields**: Any source field with `target: "extra_data.<key>"` is stored verbatim in the `extra_data` JSONB column
- **Raw data preserved**: `raw_data` JSONB stores the original flattened record for auditability and future re-processing
- **CFO fields**: `cfo_nome`, `cfo_ruolo`, `cfo_linkedin`, `cfo_confidenza` are nullable at import time — will be populated by the future enrichment feature
- **Explorer integration**: Imported companies appear in the Explorer via the `all_companies` view with `sourceName` shown as a monospace sub-label under the company name
- **Country selection**: Predefined list (14 countries) + free-text fallback for any ISO code

---

## Environment Variables

```
GROQ_API_KEY=gsk_...   # Required for LLM mapping; wizard still works without it (manual mode)
```

## Supabase Storage

Bucket `import-uploads` must be created manually:
> Supabase Dashboard → Storage → New bucket → Name: `import-uploads` → **Private**

---

## Future Roadmap

- CFO/contact enrichment on imported companies (separate feature, reads from `imported_companies`)
- Source filter in Explorer sidebar (filter by `source_name` or `country_code`)
- Import history panel showing all past batches with re-import option
- Mapping templates: save an approved mapping for reuse on future files from the same source
