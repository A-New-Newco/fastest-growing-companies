# Enrichment Sessions

## Context and Purpose

Enrichment Sessions allow users to run AI-powered CFO / head-of-finance research for a curated set of companies. Unlike the existing Python `cfo-enricher` tool (which processes entire years in batch), sessions are user-controlled, observable in real-time, and integrated directly into the dashboard.

Key differences from outreach **Campaigns**:
- Campaigns = *who to contact* (LinkedIn outreach tracking)
- Enrichment Sessions = *who is the finance contact* (finding CFO data for companies)

---

## Data Model

### `enrichment_sessions`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| team_id | UUID FK→teams | RLS scope |
| name | TEXT | user-provided label |
| status | ENUM | `pending / running / paused / completed / failed` |
| model_config | JSONB | `{ enrichmentMode?, models: [...], current_model_index: N, numWorkers? }` — rolling state |
| tokens_input / tokens_output / tokens_total | BIGINT | aggregate token usage |
| total_companies / completed_count / found_count / failed_count | INT | denormalized progress counters |
| started_at / completed_at / last_heartbeat | TIMESTAMPTZ | `last_heartbeat` updated every 15s; stale > 5 min = crashed |
| created_by | UUID FK→profiles | |
| created_at / updated_at | TIMESTAMPTZ | |

### `enrichment_session_companies`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| session_id | UUID FK→enrichment_sessions CASCADE | |
| company_id | UUID | polymorphic (curated or imported) |
| company_origin | TEXT CHECK | `'curated'` or `'imported'` |
| company_name / company_website / company_country | TEXT | snapshot at creation |
| status | ENUM | `pending / running / done / failed / skipped` |
| result_nome / result_ruolo / result_linkedin / result_confidenza | TEXT | enrichment results |
| logs | JSONB | array of `{ts, event, data}` — max 200 entries |
| tokens_input / tokens_output / model_used | INT / TEXT | per-company cost tracking |
| error_message | TEXT | populated on `failed` status |
| applied_at / applied_by | TIMESTAMPTZ / UUID | set when result is written back to source |
| position | INT | ordering within session (1-based) |

Migration: `dashboard/supabase/migrations/005_enrichment_sessions.sql`

---

## File Structure

### New files
```
dashboard/supabase/migrations/005_enrichment_sessions.sql

dashboard/src/app/enrichment/
  page.tsx                          — Sessions list page
  [id]/page.tsx                     — Session detail + live monitor (server component)

dashboard/src/app/api/enrichment-sessions/
  route.ts                          — GET list / POST create
  [id]/route.ts                     — GET detail / PATCH / DELETE
  [id]/stream/route.ts              — GET SSE stream (runs enrichment)
  [id]/apply/route.ts               — POST apply all results
  [id]/companies/route.ts           — GET paginated company rows
  [id]/companies/[companyRowId]/apply/route.ts — POST apply single result

dashboard/src/lib/
  cfo-finder-prompt.ts              — System prompt, user message builder, result extractor
  groq-enricher.ts                  — Groq API client, model pool, enrichCompany()

dashboard/src/hooks/
  useEnrichmentStream.ts            — SSE connection management, state reducer

dashboard/src/components/enrichment/
  SessionStatusBadge.tsx            — Status indicator with pulse for 'running'
  TokenUsageBadge.tsx               — Token count + cost estimate
  EnrichmentSessionCard.tsx         — Card for sessions list
  CreateSessionModal.tsx            — 2-step dialog: name → company selector
  LogPanel.tsx                      — Per-company log viewer (search/fetch/think/result)
  CompanyEnrichmentTable.tsx        — Expandable table with per-company status + logs
  EnrichmentMonitor.tsx             — Client component: SSE, controls, progress

dashboard/docs/features/ENRICHMENT_SESSIONS.md  — This file
```

### Modified files
```
dashboard/src/types/index.ts        — Added EnrichmentSession, EnrichmentSessionCompany, SSELogEntry, etc.
dashboard/src/components/layout/Navbar.tsx  — Added Enrichment nav item
dashboard/docs/architecture/API.md
dashboard/docs/architecture/DATABASE.md
```

---

## Main Flows

### 1. Create Session
1. User clicks "New Session" → `CreateSessionModal` opens
2. **Step 1**: Enter session name, choose enrichment engine (Cloud/Local), set workers
3. **Step 2**: Search and select companies (reuses `/api/companies/search`)
4. Submit → `POST /api/enrichment-sessions` → creates `enrichment_sessions` row + all `enrichment_session_companies` rows with `status='pending'`
5. Redirect to session detail page

**Enrichment Modes** (stored in `model_config.enrichmentMode`):
- **Remote / Cloud** (default): Uses Groq API with model rolling — runs entirely server-side in the Next.js stream route
- **Local**: Delegates to the `cfo-enricher` Python server (port 8765) which uses Claude Haiku 4.5 with WebSearch + WebFetch. The stream route proxies SSE from the local server and writes results to Supabase.

### 2. Start / Resume Session
1. User clicks "Start" or "Resume" on session detail page
2. `EnrichmentMonitor` calls `start()` from `useEnrichmentStream`
3. Hook opens `EventSource` to `GET /api/enrichment-sessions/[id]/stream`
4. Server checks `model_config.enrichmentMode`:
   - **Remote**: Resets stuck companies, processes with Groq model rolling, streams SSE events
   - **Local**: POSTs companies to `cfo-enricher/api/enrichment/start-inline`, proxies SSE from Python server, translates events to dashboard format, updates Supabase rows as results arrive

### 3. Real-time Monitoring
The SSE stream emits these events:
| Event | Payload |
|---|---|
| `session_start` | `{sessionId, totalCompanies, resumedAt}` |
| `company_start` | `{companyRowId, position, companyName, model}` |
| `log` | `{companyRowId, entry: {ts, event, data}}` |
| `company_done` | `{companyRowId, status, result?, tokensInput, tokensOutput}` |
| `session_progress` | `{completed, total, found, failed, tokensTotal}` |
| `heartbeat` | `{ts}` (every 15s) |
| `session_complete` / `session_paused` | summary data |

The `LogPanel` component auto-scrolls as `log` events arrive for running companies.

### 4. Pause / Resume
- **Pause**: user clicks "Pause" → hook closes EventSource → server detects disconnect (`signal.aborted`), marks session `paused`, resets in-flight companies to `pending`. API PATCH also sent explicitly.
- **Resume**: same as "Start" — opens a new SSE connection, server processes remaining `pending` rows.
- **Crash recovery**: if `last_heartbeat` is stale >5 min and status is `running`, monitor shows a warning banner.

### 5. Apply Results
- **Apply All**: `POST /api/enrichment-sessions/[id]/apply` — writes results for all `done` + `applied_at IS NULL` rows to source tables.
- **Apply Single**: `POST /api/enrichment-sessions/[id]/companies/[companyRowId]/apply`
- For `imported` companies: updates `imported_companies.cfo_nome/ruolo/linkedin/confidenza`
- For `curated` companies: marks as applied but does not overwrite scraped data (source is read-only)

---

## Local Enrichment (cfo-enricher)

When `enrichmentMode === "local"`:
1. Stream route sends `POST http://localhost:8765/api/enrichment/start-inline` with `{ session_id, companies: [{rank, company_name, website, country}], max_concurrency }`
2. Python server (`cfo-enricher/monitor_server.py`) converts to internal format and calls `run_enrichment(companies=..., output_dir=sessions/{session_id}/)`
3. `run_enrichment` in `agent_enricher.py` accepts either `input_path` (file) or `companies` (inline list)
4. SSE events from port 8765 are proxied and translated: `company` → `company_done`, `progress` → `session_progress`, `done` → `session_complete`
5. Position (1-based) in the session maps to rank in the cfo-enricher, enabling result correlation
6. On client disconnect, the proxy calls `POST /api/enrichment/stop` to cancel the Python run

Env var: `CFO_ENRICHER_URL` (default `http://localhost:8765`)

---

## Groq Model Rolling

Priority order (configured in `model_config.models`):
1. `compound-beta` — built-in web search, 30 rpm / 250 rpd / 70k tpm
2. `llama-3.3-70b-versatile` — text-only fallback, 30 rpm / 14400 rpd
3. `llama-3.1-8b-instant` — fast fallback, higher limits

On 429:
- Model is marked rate-limited (`rateLimitedUntil = now + 60s`)
- Next available model is selected via `rotateModel()`
- If all models are rate-limited: wait 60s then retry with current model

---

## Prompt Optimization

Located in `src/lib/cfo-finder-prompt.ts`:
- **System prompt**: ~230 tokens (language-agnostic, universal English CFO titles)
- **User message**: ~30-90 tokens (includes company name, website, country, local language terms, size tier)
- **Total per call**: ~260-320 tokens (vs ~700 in the original Python tool — ~60% reduction)

**Early exit rules** (embedded in system prompt):
- HIGH confidence + LinkedIn URL → stop immediately
- MEDIUM confidence → 1 more confirmatory search, then stop
- Size SMALL (<5M€) → steps 1+5 only

**Multi-language support**: Country-specific search terms injected via user message for IT, DE, FR, ES, NL, PL, SE, CH, BE, GB. Unknown countries fall back to English-only.

---

## Notable Behaviors

- Session state is fully persisted in Supabase — closing the browser pauses the session, not loses it
- Logs are stored as JSONB in `enrichment_session_companies.logs` (max 200 per company)
- The SSE route uses `export const dynamic = "force-dynamic"` (required for streaming in Next.js)
- `company_origin` distinguishes between curated Italian data and imported companies
- Token estimates shown in UI: `compound-beta` priced at ~$0.79/1M tokens blended

---

## Future Roadmap

- [x] Dual enrichment mode (Cloud / Local) with mode selector in CreateSessionModal
- [x] Configurable concurrency (numWorkers in model_config, 1-8 workers)
- [ ] Support importing from a Campaign (enrich all contacts in a campaign at once)
- [ ] Model priority drag-and-drop in `CreateSessionModal`
- [ ] Export enrichment results as CSV
- [ ] `cfo_overrides` table to apply enrichment results to curated companies
- [ ] Token usage charts per session over time
- [ ] Webhook notifications on session completion
- [ ] Local server health check indicator before starting local enrichment
