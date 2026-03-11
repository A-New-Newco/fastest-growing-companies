# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Two-part pipeline:
1. **Scraper** — web scraper for "Leader della Crescita" (Leaders of Growth), an Italian company ranking published annually by Il Sole 24 Ore. Scrapes data for years 2019–2026 and outputs CSV files under `output/{year}/data.csv`.
2. **CFO Enricher** (`cfo-enricher/`) — enriches the scraped data with CFO/head of finance info (name, role, LinkedIn) using a Claude agent via `claude-agent-sdk`.

## Commands

```bash
uv sync                        # Install dependencies
uv run python scraper.py       # Scrape all years (2019–2025)
uv run python scraper.py 2024  # Scrape a specific year
uv run ruff check .            # Lint
uv run ruff format .           # Format
```

## Architecture

All logic lives in `scraper.py`. `main.py` is a thin entry point that calls `main()` from scraper.

### Key constants
- `YEAR_URLS` — maps each year to its target URL
- `EXPECTED_COUNTS` — expected number of rows per year (used for validation)

### Data extraction (two-strategy approach)
1. **Primary**: `parse_rows_from_page_source()` — parses the embedded `righeIni` JavaScript array directly from the page HTML (fast, no pagination needed)
2. **Fallback**: `load_all_rows_with_pagination()` — uses Selenium to repeatedly click "Carica altri" (Load More) until all rows are loaded

### Supporting functions
- `build_driver()` — headless Chrome with anti-automation settings
- `click_cookie_buttons()` — dismisses GDPR cookie dialogs
- `scrape_year()` — orchestrates extraction for a single year
- `write_year_csv()` — writes results to `output/{year}/data.csv`

### CSV output columns
`RANK, AZIENDA, TASSO DI CRESCITA, RICAVI {year-5}, RICAVI {year-2}, SETTORE, REGIONE, PRESENZE, SITO WEB`

## CFO Enricher

```bash
cd cfo-enricher
uv sync                               # Install dependencies
claude auth login                     # Authenticate (Pro plan, one-time)
uv run python agent_enricher.py       # Run enricher for RUN_YEAR (default 2026)
```

Configure `RUN_YEAR`, `RUN_RESET`, `RUN_INPUT` at the top of `agent_enricher.py`.

### Architecture
- `agent_enricher.py` — main entrypoint: Claude agent (Haiku 4.5) with `WebSearch` + `WebFetch` tools finds the CFO for each company. Auth via `claude auth login` (Pro plan).
- `enricher.py` — legacy 5-layer scripted pipeline (kept as backup).
- Input: `cfo-enricher/data/{year}.csv`
- Output: `cfo-enricher/output/{year}/enriched.csv` + `enrichment_progress.jsonl` checkpoint

### Enriched CSV added columns
`CFO_NOME, CFO_RUOLO, CFO_LINKEDIN, FONTE, CONFIDENZA, DATA_RICERCA`

---

## Dashboard (`dashboard/`)

A Next.js 14 App Router dashboard for exploring and managing company data. See `dashboard/docs/` for full documentation.

```bash
cd dashboard
npm install          # Install dependencies
npm run dev          # Start dev server (localhost:3000)
npm run build        # Production build
npx tsc --noEmit     # Type check
```

---

## Documentation protocol

**At the end of every session that implements a feature or makes significant changes, update `dashboard/docs/` accordingly.**

### Folder structure

```
dashboard/docs/
  PRD.md                    # Product requirements (top-level spec)
  PROGRESS.md               # Step-by-step build log (mark tasks done)
  features/
    CAMPAIGNS.md            # Campaigns feature — schema, flows, roadmap
    <FEATURE_NAME>.md       # One file per major feature
  architecture/
    DATABASE.md             # Tables, views, RLS policies overview
    API.md                  # All API routes with method, purpose, auth
    COMPONENTS.md           # Key components and their responsibilities
```

### Rules

1. **New feature** → create `dashboard/docs/features/<FEATURE_NAME>.md` covering:
   - Context and purpose
   - Data model (tables, columns, constraints)
   - File structure (new files + modified files)
   - Main flows (step-by-step)
   - Notable behaviors and edge cases
   - Future roadmap items

2. **Existing feature changed** → update the relevant file in `dashboard/docs/features/`

3. **New API route added** → update or create `dashboard/docs/architecture/API.md`

4. **New DB table/migration** → update or create `dashboard/docs/architecture/DATABASE.md`

5. **`PROGRESS.md`** → mark completed steps with `[x]`, add new steps as they are planned/implemented

6. **Never duplicate** information across files — link between docs with relative paths instead
