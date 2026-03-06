# CFO Enricher - Architecture

## Purpose

Enriches the `data/{year}.csv` dataset with CFO or Finance Director
information for each company: name, exact role, LinkedIn URL.

## Project constraints

- Auth via `claude auth login` (Pro plan) - included in subscription, no separate API cost
- No direct LinkedIn access (account block risk, GDPR)
- Mandatory checkpoint/resume (a run of ~500 companies takes hours)

---

## Project structure

```
cfo-enricher/
|-- pyproject.toml
|-- .python-version
|-- agent_enricher.py     # main entrypoint - agent-based (claude-agent-sdk)
|-- enricher.py           # legacy - scripted 5-layer pipeline (backup)
|-- docs/
|   \-- architecture.md   # this file
|-- data/
|   \-- {year}.csv        # input: companies to process
\-- output/
    \-- {year}/
        |-- enriched.csv                  # final results
        \-- enrichment_progress.jsonl     # append-only checkpoint
```

---

## Agent-based approach (`agent_enricher.py`)

The orchestrator launches multiple Claude agents in parallel (concurrent batches), and each
agent receives company name + website for a single company, using `WebSearch` and `WebFetch`
to autonomously identify the finance lead. There are no fixed extraction layers or regexes:
Claude freely decides what to search, how to interpret results, and which confidence to assign.

### Search strategy (prompt-driven)

Claude follows this sequence and stops at the first useful result:

```
1. WebSearch  - generic query: "{azienda}" CFO OR "direttore finanziario" OR DAF OR "finance director"
2. WebFetch   - company website (tries /chi-siamo, /team, /management, /about, /leadership, /organigramma)
3. WebSearch  - LinkedIn query: "{azienda}" CFO site:linkedin.com
4. WebSearch  - press/B2B query: "{azienda}" "responsabile finanziario" -site:linkedin.com
```

### Model and cost

- **Model**: `claude-haiku-4-5-20251001` - fast, efficient for structured web research
- **Auth**: `claude auth login` - uses Pro plan credits, zero separate API cost
- **Parallelism**: up to `RUN_MAX_CONCURRENCY` companies per batch (default 4)
- **Rate-limit handling**: retry with exponential backoff + jitter; optional auto-throttle

### Concurrency and resilience

Main configuration in `agent_enricher.py`:

- `RUN_MAX_CONCURRENCY` / `RUN_MIN_CONCURRENCY`: upper/lower limit for batch workers
- `RUN_MAX_RETRIES`: max attempts per company (first attempt included)
- `RUN_RETRY_BASE_DELAY`: base for exponential backoff (`base * 2^(n-1)`) + jitter
- `RUN_AUTO_THROTTLE`: if `True`, reduces workers on rate-limit signals
- `RUN_THROTTLE_RECOVERY_BATCHES`: clean batches required before increasing workers
- `DELAY_BETWEEN_BATCHES`: pause between consecutive batches

Checkpoint remains **single-writer**: jobs run in parallel, but commits to
`enrichment_progress.jsonl` are serialized and ordered by `RANK`.

### Output per company

Claude always finishes with structured JSON:

```json
{"nome": "Mario Rossi", "ruolo": "CFO", "linkedin_url": "https://...", "confidenza": "high"}
```

or `{"nome": null}` when not found. The `confidenza` field (`high`/`medium`/`low`) is the
main QA mechanism: after the run, manually review `low` results and validate `medium` ones.

---

## Output

### `output/{year}/enriched.csv`

All original columns from `data.csv` plus:

| Column | Possible values | Notes |
|---|---|---|
| `CFO_NOME` | string or empty | First and last name |
| `CFO_RUOLO` | string or empty | Exact title found (Italian or English, not normalized) |
| `CFO_LINKEDIN` | URL or empty | LinkedIn profile |
| `FONTE` | `agent` / `not_found` | Always `agent` for `agent_enricher.py` |
| `CONFIDENZA` | `high` / `medium` / `low` | Estimated by Claude - used for manual QA |
| `DATA_RICERCA` | `YYYY-MM-DD` | Search date |

### `output/{year}/enrichment_progress.jsonl`

Append-only checkpoint. One JSON line per processed company.
Allows resuming an interrupted run without starting over.

```jsonl
{"rank": 1, "azienda": "C.D.C. Chain Drive", "cfo_nome": "Mario Rossi", "cfo_ruolo": "CFO", "cfo_linkedin": null, "fonte": "agent", "confidenza": "medium", "data_ricerca": "2026-03-06"}
{"rank": 2, "azienda": "ZAS Trading", "cfo_nome": null, "cfo_ruolo": null, "cfo_linkedin": null, "fonte": "not_found", "confidenza": null, "data_ricerca": "2026-03-06"}
```

---

## CLI

```bash
cd cfo-enricher

# Setup
uv sync
claude auth login   # Pro plan authentication (one-time)

# Main run (agent-based)
uv run python agent_enricher.py          # processes RUN_YEAR, resumes from checkpoint
# Configure RUN_* at the top of the file (year/input/reset + concurrency/retry/throttle)

# Legacy run (scripted pipeline - for comparison/debug only)
uv sync  # also requires: uv run playwright install chromium
uv run python enricher.py 2026
uv run python enricher.py 2026 --layer 4  # only Layer 4 (agent-based)
```

---

## Dependencies

| Package | Usage | Notes |
|---|---|---|
| `claude-agent-sdk` | Agent loop with WebSearch + WebFetch (`agent_enricher.py`) | Auth via Pro plan |
| `requests` | Static HTTP fetch (`enricher.py` legacy only) | |
| `beautifulsoup4` | HTML parsing (`enricher.py` legacy only) | |
| `ddgs` | DuckDuckGo SERP queries (`enricher.py` legacy only) | |
| `playwright` | Headless browser (`enricher.py` legacy only) | |
| `anthropic` | Direct Claude API (`enricher.py` legacy Layer 4 only) | |

---

## Excluded services and rationale

| Service | Why excluded |
|---|---|
| LinkedIn API | No public API exists |
| Direct LinkedIn scraping | Account block risk, ToS violations, GDPR exposure |
| OpenCorporates API | Free tier is unreliable at 500 req/month; legal admin data does not match CFO/DAF roles |
| Hunter.io / Apollo | Free tier 25-120/month, insufficient for 500 companies |
| Google Search API | 100 free req/day, exhausted quickly |
