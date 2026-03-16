# LinkedIn Monitor

## Context and purpose

The LinkedIn Monitor provides batch LinkedIn profile search for contacts that have a name and role but no LinkedIn URL. It uses a Claude Agent (Haiku 4.5) with WebSearch and WebFetch tools, structured identically to the CFO Enricher Monitor for observability, concurrency control, and checkpointing.

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
| `src/lib/linkedin-enrichment-client.ts` | TypeScript client (types + HTTP/SSE functions) |
| `src/app/linkedin-monitor/page.tsx` | Dedicated monitor page |
| `next.config.mjs` | Rewrite proxy: `/api/linkedin-enrichment/*` → `localhost:8766` |

### Data flow

1. User selects contacts without LinkedIn in the **Select Contacts** tab or from **Explorer**
2. Dashboard sends contacts as JSON to `POST /api/linkedin/start`
3. Monitor server runs `run_enrichment()` with asyncio concurrency
4. Per-contact results streamed via SSE (`contact`, `progress`, `done` events)
5. Dashboard displays live results in the **Live** tab
6. Checkpoint saved to `linkedin_progress.jsonl` (append-only, resumable)

## API endpoints (port 8766)

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

- **Select Contacts** tab: loads contacts without LinkedIn from Supabase, checkbox selection
- **Live** tab: real-time results during a run (SSE stream)
- **History** tab: persisted results from previous runs
- Controls: concurrency slider, reset checkbox, start/stop
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

- [ ] Save found LinkedIn URLs back to Supabase automatically
- [ ] Import results to DB (like CFO Monitor's import feature)
- [ ] Filter by confidence in the monitor page
- [ ] Cost breakdown charts
