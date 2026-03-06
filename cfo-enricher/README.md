# CFO Enricher

Enriches the [Leader della Crescita](https://lab24.ilsole24ore.com/leader-crescita) dataset with CFO/Head of Finance names for each company, using a Claude agent orchestrator with WebSearch/WebFetch.

## Quickstart

```bash
cd cfo-enricher
uv sync
claude auth login
uv run python agent_enricher.py
```

## Requirements

- Python `>=3.14`
- `uv`
- Active Claude login (`claude auth login`)

## Run configuration

Set these parameters in `agent_enricher.py`:

```python
RUN_YEAR = 2026
RUN_INPUT = None
RUN_RESET = False

RUN_MAX_CONCURRENCY = 4
RUN_MIN_CONCURRENCY = 1
RUN_MAX_RETRIES = 3
RUN_RETRY_BASE_DELAY = 2.0
RUN_AUTO_THROTTLE = True
RUN_THROTTLE_RECOVERY_BATCHES = 2
DELAY_BETWEEN_BATCHES = 1.0
```

Operational notes:
- Processing runs in concurrent batches.
- On rate-limit signals (`429`, `rate limit`, `too many requests`), the system retries with exponential backoff + jitter.
- If `RUN_AUTO_THROTTLE=True`, workers scale down automatically on errors and scale back up after clean batches.

## Input

- Default: `data/{RUN_YEAR}.csv`
- Expected columns: at least `RANK`, `AZIENDA`, `SITO WEB`

## Output

Files are created in `output/{year}/`:

- `enriched.csv`: original dataset + enrichment columns
- `enrichment_progress.jsonl`: append-only checkpoint for resume

Columns added to `enriched.csv`:

| Column | Description |
|---|---|
| `CFO_NOME` | Full name found |
| `CFO_RUOLO` | Exact title found |
| `CFO_LINKEDIN` | LinkedIn profile URL when available |
| `FONTE` | `agent` or `not_found` |
| `CONFIDENZA` | `high` / `medium` / `low` |
| `DATA_RICERCA` | Run date (`YYYY-MM-DD`) |

## Resume and consistency

- If the run is interrupted, rerun the same command: it resumes from checkpoint.
- Writes to `enrichment_progress.jsonl` are serial and ordered by `RANK` even with parallel execution.

## Quick validation

```bash
uv run python -m py_compile agent_enricher.py
```

## Constraints and best practices

- No direct LinkedIn scraping.
- Manually review results with `CONFIDENZA=low` and sample-check `medium`.
- `enricher.py` remains as legacy/backup for comparison.

## Documentation

- Architecture: `docs/architecture.md`
