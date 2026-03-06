# CFO Enricher

Arricchisce il dataset [Leader della Crescita](https://lab24.ilsole24ore.com/leader-crescita) con il nominativo CFO/DAF per ogni azienda, usando un orchestratore ad agenti Claude con WebSearch/WebFetch.

## Quickstart

```bash
cd cfo-enricher
uv sync
claude auth login
uv run python agent_enricher.py
```

## Requisiti

- Python `>=3.14`
- `uv`
- Login Claude attivo (`claude auth login`)

## Configurazione Run

Imposta i parametri in `agent_enricher.py`:

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

Note operative:
- Il processamento e' a batch concorrenti.
- In caso di rate-limit (`429`, `rate limit`, `too many requests`) il sistema fa retry con backoff esponenziale + jitter.
- Se `RUN_AUTO_THROTTLE=True`, i worker si riducono automaticamente su errori e risalgono dopo batch puliti.

## Input

- Default: `data/{RUN_YEAR}.csv`
- Colonne attese: almeno `RANK`, `AZIENDA`, `SITO WEB`

## Output

I file vengono creati in `output/{year}/`:

- `enriched.csv`: dataset originale + colonne di enrichment
- `enrichment_progress.jsonl`: checkpoint append-only per resume

Colonne aggiunte su `enriched.csv`:

| Colonna | Descrizione |
|---|---|
| `CFO_NOME` | Nome e cognome trovati |
| `CFO_RUOLO` | Titolo esatto trovato |
| `CFO_LINKEDIN` | URL profilo LinkedIn se disponibile |
| `FONTE` | `agent` o `not_found` |
| `CONFIDENZA` | `high` / `medium` / `low` |
| `DATA_RICERCA` | Data run (`YYYY-MM-DD`) |

## Resume e Coerenza

- Se il run si interrompe, rilancia lo stesso comando: riprende dal checkpoint.
- Il commit su `enrichment_progress.jsonl` e' seriale e ordinato per `RANK` anche con esecuzione parallela.

## Validazione Rapida

```bash
uv run python -m py_compile agent_enricher.py
```

## Vincoli e Best Practice

- No scraping diretto LinkedIn.
- Riesaminare manualmente i risultati con `CONFIDENZA=low` e campionare i `medium`.
- `enricher.py` resta legacy/backup per confronto.

## Documentazione

- Architettura: `docs/architecture.md`
