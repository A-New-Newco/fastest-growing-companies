# CFO Enricher — Architecture

## Scopo

Arricchisce il dataset `data/{year}.csv` con informazioni sul CFO o Direttore Finanziario
(DAF) di ogni azienda: nome, ruolo esatto, LinkedIn URL.

## Vincoli di progetto

- Auth via `claude auth login` (piano Pro) — incluso nell'abbonamento, nessun costo API separato
- Nessun accesso diretto a LinkedIn (rischio blocco account, GDPR)
- Checkpoint/resume obbligatorio (run di ~500 aziende = ore di elaborazione)

---

## Struttura del progetto

```
cfo-enricher/
├── pyproject.toml
├── .python-version
├── agent_enricher.py     # entrypoint principale — agent-based (claude-agent-sdk)
├── enricher.py           # legacy — pipeline scriptata a 5 layer (backup)
├── docs/
│   └── architecture.md   # questo file
├── data/
│   └── {year}.csv        # input: aziende da processare
└── output/
    └── {year}/
        ├── enriched.csv                  # risultati finali
        └── enrichment_progress.jsonl     # checkpoint append-only
```

---

## Approccio agent-based (`agent_enricher.py`)

Il processo orchestratore lancia più agenti Claude in parallelo (batch concorrenti) e ogni
agente riceve nome + sito web di una singola azienda, usando `WebSearch` e `WebFetch` per
trovare autonomamente il responsabile finanziario. Non esistono layer fissi o regex di
estrazione: Claude ragiona liberamente su cosa cercare, come interpretare i risultati e con
quale confidenza riportarli.

### Strategia di ricerca (guidata dal prompt)

Claude segue questa sequenza, fermandosi al primo risultato utile:

```
1. WebSearch  — query generica: "{azienda}" CFO OR "direttore finanziario" OR DAF OR "finance director"
2. WebFetch   — sito aziendale (prova /chi-siamo, /team, /management, /about, /leadership, /organigramma)
3. WebSearch  — query LinkedIn: "{azienda}" CFO site:linkedin.com
4. WebSearch  — query press/B2B: "{azienda}" "responsabile finanziario" -site:linkedin.com
```

### Modello e costo

- **Modello**: `claude-haiku-4-5-20251001` — veloce, efficiente per web research strutturato
- **Auth**: `claude auth login` — usa i crediti del piano Pro, zero costo API separato
- **Parallelismo**: fino a `RUN_MAX_CONCURRENCY` aziende per batch (default 4)
- **Rate-limit handling**: retry con backoff esponenziale + jitter; auto-throttle opzionale

### Concorrenza e resilienza

Configurazione principale in `agent_enricher.py`:

- `RUN_MAX_CONCURRENCY` / `RUN_MIN_CONCURRENCY`: limite alto/basso dei worker batch
- `RUN_MAX_RETRIES`: tentativi massimi per azienda (primo tentativo incluso)
- `RUN_RETRY_BASE_DELAY`: base del backoff esponenziale (`base * 2^(n-1)`) + jitter
- `RUN_AUTO_THROTTLE`: se `True`, riduce i worker su segnali di rate-limit
- `RUN_THROTTLE_RECOVERY_BATCHES`: batch puliti richiesti prima di rialzare i worker
- `DELAY_BETWEEN_BATCHES`: pausa tra batch consecutivi

Il checkpoint resta **single-writer**: i job girano in parallelo ma il commit su
`enrichment_progress.jsonl` avviene serialmente, ordinato per `RANK`.

### Output per azienda

Claude termina sempre con un JSON strutturato:

```json
{"nome": "Mario Rossi", "ruolo": "CFO", "linkedin_url": "https://...", "confidenza": "high"}
```

oppure `{"nome": null}` se non trovato. Il campo `confidenza` (`high`/`medium`/`low`) è il
meccanismo principale di QA: post-run si rivedono manualmente i risultati `low` e si
verificano i `medium`.

---

## Output

### `output/{year}/enriched.csv`

Tutte le colonne originali di `data.csv` più:

| Colonna | Valori possibili | Note |
|---|---|---|
| `CFO_NOME` | stringa o vuoto | Nome e cognome |
| `CFO_RUOLO` | stringa o vuoto | Titolo esatto trovato (italiano o inglese, non normalizzato) |
| `CFO_LINKEDIN` | URL o vuoto | Profilo LinkedIn |
| `FONTE` | `agent` / `not_found` | Sempre `agent` per `agent_enricher.py` |
| `CONFIDENZA` | `high` / `medium` / `low` | Stimata da Claude — usata per QA manuale |
| `DATA_RICERCA` | `YYYY-MM-DD` | Data della ricerca |

### `output/{year}/enrichment_progress.jsonl`

Checkpoint append-only. Una riga JSON per azienda processata.
Permette di riprendere una run interrotta senza ricominciare da capo.

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
claude auth login   # autenticazione piano Pro (una tantum)

# Run principale (agent-based)
uv run python agent_enricher.py          # processa RUN_YEAR, riprende dal checkpoint
# Configura RUN_* in cima al file (anno/input/reset + concorrenza/retry/throttle)

# Run legacy (pipeline scriptata — solo per confronto/debug)
uv sync  # richiede anche: uv run playwright install chromium
uv run python enricher.py 2026
uv run python enricher.py 2026 --layer 4  # solo Layer 4 agentico
```

---

## Dipendenze

| Pacchetto | Uso | Note |
|---|---|---|
| `claude-agent-sdk` | Agent loop con WebSearch + WebFetch (`agent_enricher.py`) | Auth via piano Pro |
| `requests` | HTTP fetch statico (solo `enricher.py` legacy) | |
| `beautifulsoup4` | HTML parsing (solo `enricher.py` legacy) | |
| `ddgs` | DuckDuckGo SERP queries (solo `enricher.py` legacy) | |
| `playwright` | Browser headless (solo `enricher.py` legacy) | |
| `anthropic` | Claude API direct (solo `enricher.py` legacy Layer 4) | |

---

## Servizi esclusi e motivazione

| Servizio | Motivo esclusione |
|---|---|
| LinkedIn API | Non esiste API pubblica |
| LinkedIn scraping diretto | Rischio blocco account, violazione ToS, esposizione GDPR |
| OpenCorporates API | Free tier non affidabile a 500 req/mese; dati (admin legali) non corrispondono a ruoli CFO/DAF |
| Hunter.io / Apollo | Free tier 25-120/mese, insufficiente per 500 aziende |
| Google Search API | 100 req/giorno gratuiti, esauriti rapidamente |
