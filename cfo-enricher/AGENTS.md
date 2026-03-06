# AGENTS.md

Operational instructions for automated agents working on this repository.

## Project goal

Enrich `data/{year}.csv` with CFO/Head of Finance information per company via `agent_enricher.py`, keeping output compatible and resumable.

## Core files

- `agent_enricher.py`: main pipeline (concurrent batches + auto-throttle)
- `docs/architecture.md`: architecture description
- `README.md`: setup and operational usage
- `data/{year}.csv`: input
- `output/{year}/enriched.csv`: final output
- `output/{year}/enrichment_progress.jsonl`: append-only checkpoint

## Invariants that must not break

- Preserve checkpoint JSONL schema and naming:
  - `rank`, `azienda`, `cfo_nome`, `cfo_ruolo`, `cfo_linkedin`, `fonte`, `confidenza`, `data_ricerca`
- Preserve final columns of `enriched.csv`:
  - `CFO_NOME`, `CFO_RUOLO`, `CFO_LINKEDIN`, `FONTE`, `CONFIDENZA`, `DATA_RICERCA`
- Keep checkpoint resume behavior without duplicate rows by `RANK`.
- With concurrent runs, guarantee serial checkpoint writes ordered by `RANK`.
- Do not introduce direct LinkedIn scraping.

## Setup and commands

```bash
uv sync
claude auth login
uv run python agent_enricher.py
```

Minimum check before delivery:

```bash
uv run python -m py_compile agent_enricher.py
```

## Implementation guidelines

- Apply minimal changes consistent with the current style.
- Prefer pure functions for adaptation/validation logic.
- Avoid concurrent writes to shared files.
- Always log relevant operational events:
  - retry
  - rate-limit signals
  - worker changes (auto-throttle)
  - final run summary

## Recommended acceptance criteria

- No syntax errors (`py_compile`).
- No duplicate or missing `RANK` values in checkpoint.
- `enriched.csv` always reproducible from checkpoint + input.
- Resume works after interruption.

## Do not

- Do not change output format without also updating documentation and downstream consumers.
- Do not remove `not_found` fallback.
- Do not add unnecessary dependencies for a local fix.
