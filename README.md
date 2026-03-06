# Fastest Growing Companies (Leader della Crescita)

Repository per una pipeline in due parti:

1. scraper del ranking **Leader della Crescita** (Il Sole 24 Ore), anni 2019-2026
2. enrichment dei dati con informazioni CFO/Head of Finance

## Struttura repository

- `champions-companies-scraper.zip`: archivio del progetto scraper (contiene `scraper.py`, `main.py`, `output/{year}/data.csv`)
- `cfo-enricher/`: modulo per arricchire il dataset con dati CFO

## Prerequisiti

- Python 3.14+
- [uv](https://docs.astral.sh/uv/)
- (solo per enrichment) account Claude con `claude auth login`

## Quickstart

### 1) Scraper (da archivio zip)

```bash
unzip champions-companies-scraper.zip
cd champions-companies-scraper
uv sync
uv run python scraper.py        # tutti gli anni
uv run python scraper.py 2024   # anno specifico
```

Output: `champions-companies-scraper/output/{year}/data.csv`

### 2) CFO Enricher

```bash
cd cfo-enricher
uv sync
claude auth login
uv run python agent_enricher.py
```

Input default: `cfo-enricher/data/{year}.csv`  
Output: `cfo-enricher/output/{year}/enriched.csv`

## Colonne principali

### Dataset scraper

`RANK, AZIENDA, TASSO DI CRESCITA, RICAVI {year-5}, RICAVI {year-2}, SETTORE, REGIONE, PRESENZE, SITO WEB`

### Colonne aggiunte dall'enricher

`CFO_NOME, CFO_RUOLO, CFO_LINKEDIN, FONTE, CONFIDENZA, DATA_RICERCA`

## Comandi utili

```bash
# linter/formatter (nel progetto scraper estratto)
uv run ruff check .
uv run ruff format .
```
