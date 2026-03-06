# CFO Enricher

Arricchisce il dataset [Leader della Crescita](https://lab24.ilsole24ore.com/leader-crescita) con informazioni sul CFO o Direttore Finanziario di ogni azienda.

## Come funziona

Un agente Claude (`claude-haiku-4-5`) usa **WebSearch** e **WebFetch** nativi per trovare autonomamente il responsabile finanziario di ogni azienda. Nessuna pipeline scriptata, nessun regex di estrazione: Claude ragiona liberamente su cosa cercare e riporta il risultato con un livello di confidenza (`high`/`medium`/`low`) usato per il QA manuale post-run.

Strategia di ricerca (guidata dal prompt, in ordine):
1. WebSearch generica: `"{azienda}" CFO OR "direttore finanziario" OR DAF`
2. WebFetch sito aziendale (`/chi-siamo`, `/team`, `/management`, `/about`…)
3. WebSearch su LinkedIn: `"{azienda}" CFO site:linkedin.com`
4. WebSearch su press/B2B: `"{azienda}" "responsabile finanziario" -site:linkedin.com`

**Copertura stimata: 65-80%** | **Auth: piano Pro (`claude auth login`) — zero costo API separato**

## Setup

```bash
cd cfo-enricher
uv sync
claude auth login   # autenticazione piano Pro (una tantum)
```

## Utilizzo

Configura le variabili in cima ad `agent_enricher.py`:

```python
RUN_YEAR = 2026                 # anno da processare
RUN_RESET = False               # True = ignora checkpoint esistente
RUN_INPUT = None                # None = usa data/{RUN_YEAR}.csv

RUN_MAX_CONCURRENCY = 4         # aziende processate in parallelo per batch
RUN_MIN_CONCURRENCY = 1         # limite minimo se auto-throttle riduce i worker
RUN_MAX_RETRIES = 3             # tentativi massimi per azienda (incluso il primo)
RUN_RETRY_BASE_DELAY = 2.0      # backoff esponenziale base per retry
RUN_AUTO_THROTTLE = True        # riduce/aumenta worker in base ai rate-limit
RUN_THROTTLE_RECOVERY_BATCHES = 2
DELAY_BETWEEN_BATCHES = 1.0     # pausa tra batch consecutivi
```

Poi lancia:

```bash
uv run python agent_enricher.py
```

Il run è riprendibile: se interrotto, rilancia lo stesso comando e ripartirà dal punto in cui si era fermato (checkpoint automatico in `output/{year}/enrichment_progress.jsonl`).
I risultati vengono sempre scritti in checkpoint in ordine `RANK` (anche se il processing avviene in parallelo).

## Output

Tutti i file vengono scritti in `output/{year}/`.

### `enriched.csv`

Contiene tutte le colonne originali del CSV di input più:

| Colonna | Descrizione | Valori |
|---|---|---|
| `CFO_NOME` | Nome e cognome | stringa o vuoto |
| `CFO_RUOLO` | Titolo esatto trovato (italiano o inglese) | stringa o vuoto |
| `CFO_LINKEDIN` | URL profilo LinkedIn | URL o vuoto |
| `FONTE` | `agent` se trovato, `not_found` altrimenti | |
| `CONFIDENZA` | Qualità stimata da Claude — usata per QA manuale | `high` / `medium` / `low` |
| `DATA_RICERCA` | Data della ricerca | `YYYY-MM-DD` |

### `enrichment_progress.jsonl`

Checkpoint append-only. Una riga JSON per azienda processata:

```jsonl
{"rank": 1, "azienda": "C.D.C. Chain Drive", "cfo_nome": "Mario Rossi", "cfo_ruolo": "CFO", "cfo_linkedin": null, "fonte": "agent", "confidenza": "medium", "data_ricerca": "2026-03-06"}
{"rank": 2, "azienda": "ZAS Trading", "cfo_nome": null, "cfo_ruolo": null, "cfo_linkedin": null, "fonte": "not_found", "confidenza": null, "data_ricerca": "2026-03-06"}
```

## Note

- **LinkedIn**: non viene mai visitato direttamente. I profili vengono trovati tramite snippet SERP di DuckDuckGo o menzionati nei siti aziendali.
- **Parallelismo**: il run lavora a batch concorrenti (`RUN_MAX_CONCURRENCY`, default 4 worker).
- **Rate limit**: retry con backoff esponenziale + jitter; con `RUN_AUTO_THROTTLE=True` i worker si riducono automaticamente su errori 429/rate-limit e risalgono dopo batch puliti.
- **QA post-run**: rivedi manualmente i risultati con `confidenza = low`, e verifica un campione dei `medium`.
- **Legacy**: `enricher.py` (pipeline scriptata a 5 layer) è mantenuto come backup per confronto.
- **Architettura dettagliata**: vedi [`docs/architecture.md`](docs/architecture.md).
