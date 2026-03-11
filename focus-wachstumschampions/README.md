# Focus Wachstumschampions Scraper (MVP)

Standalone scraper for:

- `https://www.focus.de/business/wachstumschampions/suche`
- Output: **JSONL only**
- Granularity: **1 line per company** (awards preserved as nested records)

## What It Does

1. Fetches the search page with `offset`/`limit` query params.
2. Extracts `v-bind:initial-search-result` from HTML.
3. Paginates until all award rows are collected.
4. Aggregates award rows into one company record using:
   - primary key: `account.id`
   - fallback: `account.salesforceId`
   - fallback: stable fingerprint
5. Writes one JSON object per line (`JSONL`) to `output/`.

## Usage

From repository root:

```bash
uv run python focus-wachstumschampions/scrape_wch.py
```

With options:

```bash
uv run python focus-wachstumschampions/scrape_wch.py \
  --output focus-wachstumschampions/output/wch_companies.jsonl \
  --timeout 30 \
  --max-limit 10000 \
  --verbose
```

### CLI Options

- `--output`: output JSONL path
- `--timeout`: HTTP timeout in seconds
- `--max-limit`: requested page size (server may cap it)
- `--verbose`: per-page diagnostics

## Output Schema (per company)

Each JSONL line contains:

- `company_key`
- `source_url`
- `scraped_at`
- `project_short_code`
- `period`
- `account` (full object from source payload)
- `contact` (full object from source payload)
- `awards` (list of original award rows, lossless)
- `award_count`
- `toplist_labels`
- `national_rank` (if detectable)

## Tests

Run unit tests:

```bash
uv run python -m unittest discover -s focus-wachstumschampions/tests -v
```

Implemented coverage:

- parser test with valid/invalid fixture payloads
- pagination logic with two mocked pages
- aggregation logic (2 awards -> 1 company)

## Extension Notes (Next Step)

Current MVP uses only list payload data (`initial-search-result`).

To extend with profile content (“award content”):

1. iterate `awardTeaser.id` (or equivalent per award)
2. fetch profile HTML/content endpoint
3. enrich each award/company record with parsed profile fields
4. keep new fields additive (do not overwrite raw `awards`)
