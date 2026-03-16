# LinkedIn Monitor

## Context and purpose

The LinkedIn Monitor provides batch LinkedIn profile search for contacts that have a name and role but no LinkedIn URL. It supports two enrichment modes:

- **Cloud (Groq)** — Uses Groq API with `findLinkedIn()` (compound-beta-mini with model fallback). No Python server needed. Results live in React state only.
- **Local (Claude Agent)** — Uses Claude Haiku 4.5 with WebSearch + WebFetch tools via the Python monitor server (port 8766). Supports checkpointing, history persistence, and multi-step verification.

## Architecture

### Backend: `linkedin-enricher/`

A standalone Python agent (sibling to `cfo-enricher/`) with identical architecture:

| File | Purpose |
|------|---------|
| `agent_enricher.py` | Main orchestrator: prompts, parsing, agent calls, checkpoint, concurrency |
| `monitor_server.py` | FastAPI + SSE server on port **8766** |
| `run_state.py` | Singleton RunState dataclass |
| `pyproject.toml` | Dependencies (claude-agent-sdk, fastapi, uvicorn, sse-starlette) |
| `start.sh` | Launch script |

**Key differences from cfo-enricher:**
- Uses `id: str` (DB UUID) as primary key instead of `rank: int`
- Receives contacts via POST JSON (not CSV/dataset presets)
- Simpler task: only finding LinkedIn URL for a known person (no role discovery)
- Skips verification for high-confidence results (optimization)

### Dashboard integration

| File | Purpose |
|------|---------|
| `src/lib/linkedin-enrichment-client.ts` | TypeScript client (types + HTTP/SSE for both Cloud and Local) |
| `src/lib/linkedin-finder.ts` | Groq-based LinkedIn search (`findLinkedIn()` — used by Cloud mode) |
| `src/app/linkedin-monitor/page.tsx` | Dedicated monitor page with Cloud/Local toggle |
| `src/app/api/linkedin-monitor/stream/route.ts` | Cloud mode SSE endpoint (worker pool + Groq) |
| `next.config.mjs` | Rewrite proxy: `/api/linkedin-enrichment/*` → `localhost:8766` |

### Data flow

**Cloud mode:**
1. User selects contacts in the **Select Contacts** tab
2. Dashboard POSTs to `/api/linkedin-monitor/stream` (Next.js API route)
3. Server-side worker pool calls `findLinkedIn()` per contact using Groq
4. SSE events streamed directly to browser (`contact`, `progress`, `done`)
5. Results displayed in **Live** tab; user clicks **Save All** to import to DB

**Local mode:**
1. User selects contacts in the **Select Contacts** tab or from **Explorer**
2. Dashboard sends contacts as JSON to `POST /api/linkedin/start` (Python server)
3. Monitor server runs `run_enrichment()` with asyncio concurrency
4. Per-contact results streamed via SSE (`contact`, `progress`, `done` events)
5. Dashboard displays live results in the **Live** tab
6. Checkpoint saved to `linkedin_progress.jsonl` (append-only, resumable)

## API endpoints

### Cloud mode (Next.js, no external server)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/linkedin-monitor/stream` | SSE stream — processes contacts with Groq worker pool |
| `POST` | `/api/linkedin-monitor/import` | Save LinkedIn URLs to DB |

### Local mode (port 8766)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/linkedin/start` | Start run with contacts JSON |
| `POST` | `/api/linkedin/stop` | Cancel current run |
| `GET` | `/api/linkedin/status` | Current run state |
| `GET` | `/api/linkedin/stream` | SSE event stream |
| `GET` | `/api/linkedin/results` | Current run results |
| `GET` | `/api/linkedin/history` | Persisted events |
| `POST` | `/api/linkedin/reprocess` | Re-search specific contacts |

## Agent prompts

### Discovery (WebSearch + WebFetch)

3-step escalation with stop-early:
1. `"{name}" "{company}" site:linkedin.com/in`
2. `"{name}" "{company}" linkedin` (+ locale variants)
3. WebFetch company team page (fallback)

Explicit disambiguation for common names. Confidence tiers: high/medium/low.

### Verification (WebSearch only)

Only for medium/low confidence. Max 2 queries. Can return a corrected URL.

## Dashboard pages

### `/linkedin-monitor`

- **Mode toggle**: Cloud (Groq) or Local (Claude Agent)
- **Select Contacts** tab: loads contacts without LinkedIn from Supabase, checkbox selection
- **Live** tab: real-time results during a run (SSE stream)
- **History** tab: persisted results from previous runs (Local mode only)
- Controls: concurrency slider, reset checkbox (Local only), start/stop
- KPI cards: processed, found %, cost, elapsed
- Confidence pie chart

### Explorer bulk action

- **LI Agent** button in Explorer toolbar (purple)
- Sends selected contacts (with name, no LinkedIn) to monitor server
- Redirects to `/linkedin-monitor` to see live results

## Commands

```bash
cd linkedin-enricher
uv sync                        # Install dependencies
claude auth login              # Authenticate (Pro plan, one-time)
./start.sh                     # Start monitor server (port 8766)
uv run python agent_enricher.py  # Standalone mode (set RUN_INPUT)
```

## Future roadmap

- [x] Dual mode: Cloud (Groq) / Local (Claude Agent) with toggle
- [x] Import results to DB (Save All / Save Selected buttons)
- [ ] Persist Cloud mode results to DB for history across sessions
- [ ] Filter by confidence in the monitor page
- [ ] Cost breakdown charts
