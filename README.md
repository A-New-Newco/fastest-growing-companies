# Fastest Growing Companies (Leader della Crescita)

Repository for a two-part pipeline:

1. scraper for the **Leader della Crescita** ranking (Il Sole 24 Ore), years 2019-2026
2. data enrichment with CFO/Head of Finance information

## Repository structure

- `champions-companies-scraper.zip`: archive containing the scraper project (`scraper.py`, `main.py`, `output/{year}/data.csv`)
- `cfo-enricher/`: module that enriches the dataset with CFO data

## Prerequisites

- Python 3.14+
- [uv](https://docs.astral.sh/uv/)
- (enrichment only) Claude account with `claude auth login`

## Quickstart

### 1) Scraper (from zip archive)

```bash
unzip champions-companies-scraper.zip
cd champions-companies-scraper
uv sync
uv run python scraper.py        # all years
uv run python scraper.py 2024   # specific year
```

Output: `champions-companies-scraper/output/{year}/data.csv`

### 2) CFO Enricher

```bash
cd cfo-enricher
uv sync
claude auth login
uv run python agent_enricher.py
```

Default input: `cfo-enricher/data/{year}.csv`  
Output: `cfo-enricher/output/{year}/enriched.csv`

## Main columns

### Scraper dataset

`RANK, AZIENDA, TASSO DI CRESCITA, RICAVI {year-5}, RICAVI {year-2}, SETTORE, REGIONE, PRESENZE, SITO WEB`

### Columns added by the enricher

`CFO_NOME, CFO_RUOLO, CFO_LINKEDIN, FONTE, CONFIDENZA, DATA_RICERCA`

## Useful commands

```bash
# linter/formatter (inside the extracted scraper project)
uv run ruff check .
uv run ruff format .
```
