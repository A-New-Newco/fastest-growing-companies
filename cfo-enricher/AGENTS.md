# AGENTS.md

Istruzioni operative per agenti automatici che lavorano su questo repository.

## Obiettivo del progetto

Arricchire `data/{year}.csv` con informazioni CFO/DAF per azienda tramite `agent_enricher.py`, mantenendo output compatibile e riprendibile.

## File principali

- `agent_enricher.py`: pipeline principale (batch concorrenti + auto-throttle)
- `docs/architecture.md`: descrizione architetturale
- `README.md`: setup e uso operativo
- `data/{year}.csv`: input
- `output/{year}/enriched.csv`: output finale
- `output/{year}/enrichment_progress.jsonl`: checkpoint append-only

## Invarianti da non rompere

- Preservare schema e naming del checkpoint JSONL:
  - `rank`, `azienda`, `cfo_nome`, `cfo_ruolo`, `cfo_linkedin`, `fonte`, `confidenza`, `data_ricerca`
- Preservare colonne finali di `enriched.csv`:
  - `CFO_NOME`, `CFO_RUOLO`, `CFO_LINKEDIN`, `FONTE`, `CONFIDENZA`, `DATA_RICERCA`
- Mantenere resume da checkpoint senza duplicare righe per `RANK`.
- Con run concorrente, garantire scrittura checkpoint seriale e ordinata per `RANK`.
- Non introdurre scraping diretto LinkedIn.

## Setup e comandi

```bash
uv sync
claude auth login
uv run python agent_enricher.py
```

Check minimo prima di consegnare:

```bash
uv run python -m py_compile agent_enricher.py
```

## Linee guida implementative

- Fare modifiche minimali e coerenti con lo stile attuale.
- Preferire funzioni pure per logica di adattamento/validazione.
- Evitare scritture concorrenti su file condivisi.
- Loggare sempre eventi operativi rilevanti:
  - retry
  - segnali rate-limit
  - variazione worker (auto-throttle)
  - summary finale run

## Criteri di accettazione consigliati

- Nessun errore di sintassi (`py_compile`).
- Nessun `RANK` duplicato o mancante nel checkpoint.
- `enriched.csv` sempre generabile da checkpoint + input.
- Resume funzionante dopo interruzione.

## Non fare

- Non cambiare formato output senza aggiornare anche documentazione e consumer downstream.
- Non rimuovere fallback `not_found`.
- Non introdurre dipendenze non necessarie per un fix locale.
