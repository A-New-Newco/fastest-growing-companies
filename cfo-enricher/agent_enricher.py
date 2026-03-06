"""
CFO/DAF Agent Enricher — powered by claude-agent-sdk.

Replaces the scripted 5-layer pipeline in enricher.py with a concurrent Claude-agent
orchestrator that uses WebSearch and WebFetch natively to find the CFO/head of finance
for each Italian company. Claude handles all reasoning and analysis — no regex heuristics.

Auth: claude auth login (Pro plan) — no separate API key needed.
Model: claude-haiku-4-5-20251001

Output format is fully compatible with enricher.py (same JSONL checkpoint + enriched.csv).
"""
from __future__ import annotations

# ---------------------------------------------------------------------------
# RUN CONFIGURATION — edit here to run from PyCharm
# ---------------------------------------------------------------------------

# Year to process
RUN_YEAR: int = 2026

# Input CSV path. None = default: ./data/{RUN_YEAR}.csv
RUN_INPUT: str | None = None

# True = ignore existing checkpoint and restart from scratch
RUN_RESET: bool = False

# Maximum parallel workers (companies processed per batch)
RUN_MAX_CONCURRENCY: int = 4

# Minimum workers when auto-throttle scales down
RUN_MIN_CONCURRENCY: int = 1

# Max attempts per company (first attempt included)
RUN_MAX_RETRIES: int = 3

# Exponential backoff base delay for retries
RUN_RETRY_BASE_DELAY: float = 2.0

# Dynamically adapt concurrency based on rate-limit signals
RUN_AUTO_THROTTLE: bool = True

# Consecutive clean batches required before scaling up workers
RUN_THROTTLE_RECOVERY_BATCHES: int = 2

# Seconds to wait between batches (respect Pro plan rate limits)
DELAY_BETWEEN_BATCHES: float = 1.0

MODEL: str = "claude-haiku-4-5-20251001"

import asyncio
import csv
import json
import random
import re
import sys
import time
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path
from typing import Any

from claude_agent_sdk import AssistantMessage, ClaudeAgentOptions, TextBlock, query

try:
    from claude_agent_sdk import ToolUseBlock
except ImportError:
    ToolUseBlock = None


# ---------------------------------------------------------------------------
# Data model — identical to enricher.py for checkpoint compatibility
# ---------------------------------------------------------------------------


@dataclass
class EnrichmentResult:
    rank: int
    azienda: str
    cfo_nome: str | None
    cfo_ruolo: str | None
    cfo_linkedin: str | None
    fonte: str  # always "agent" or "not_found"
    confidenza: str | None  # "high"|"medium"|"low" — used for post-run manual QA
    data_ricerca: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class CompanyOutcome:
    result: EnrichmentResult
    rank: int
    had_rate_limit: bool
    attempts: int
    elapsed_s: float


# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------


def _build_prompt(company_name: str, website_url: str) -> str:
    url_line = f"Website: {website_url}" if website_url and website_url.lower() not in ("", "n/a") else "Website: not available"
    return f"""Find the CFO or head of finance for this Italian company: {company_name}
{url_line}

Follow this search strategy in order:
1. WebSearch: "{company_name}" CFO OR "direttore finanziario" OR DAF OR "finance director" OR "chief financial officer"
2. If no result, WebFetch the company website (try paths: /chi-siamo, /team, /management, /about, /leadership, /organigramma)
3. If still nothing, WebSearch: "{company_name}" CFO site:linkedin.com
4. Last resort: WebSearch: "{company_name}" ("responsabile finanziario" OR "financial director") -site:linkedin.com

You are looking for the person responsible for the company finances. The title can be in
Italian (CFO, DAF, Direttore Finanziario, Responsabile Finanziario, Direttore Amministrativo
e Finanziario) or English (CFO, Finance Director, Head of Finance, VP Finance, Financial
Controller, Treasurer, Finance Manager). If you find a role that plausibly covers finance
leadership even with an unusual title, include it with low confidence.

End your response with ONLY this JSON (no text after it):
{{"nome": "First Last", "ruolo": "Exact title as found", "linkedin_url": "https://..." or null, "confidenza": "high|medium|low"}}

Use:
- "high": clear name, role, and reliable source
- "medium": found but indirect source or non-standard role
- "low": possible match but uncertain

If nothing found: {{"nome": null}}"""


# ---------------------------------------------------------------------------
# Agent call
# ---------------------------------------------------------------------------


def _parse_and_validate(text: str) -> dict:
    """
    Extract and validate the JSON result from Claude's final message.
    Rejects implausible names (e.g. 'Wikipedia May', 'Quiz Flashcards').
    """
    match = re.search(r"\{[^{}]+}", text, re.DOTALL)
    if not match:
        return {"nome": None}
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {"nome": None}

    nome = data.get("nome")
    if not nome:
        return {"nome": None}

    # Validate: 2–5 words, only letters/apostrophe/hyphen, max 60 chars
    words = nome.strip().split()
    if len(words) < 2 or len(words) > 5 or len(nome) > 60:
        return {"nome": None}
    if not all(re.match(r"^[A-Za-zÀ-ÿ'‐-]+$", w) for w in words):
        return {"nome": None}

    return data


def _log_block(block: Any) -> None:
    """Log a single content block from an AssistantMessage."""
    # ToolUseBlock — log the tool call with its key input
    if ToolUseBlock is not None and isinstance(block, ToolUseBlock):
        name = getattr(block, "name", "?")
        inp = getattr(block, "input", {}) or {}
        if name == "WebSearch":
            query_str = inp.get("query", inp.get("q", str(inp)))
            print(f"    [WebSearch] {query_str}")
        elif name == "WebFetch":
            url = inp.get("url", str(inp))
            print(f"    [WebFetch]  {url}")
        else:
            print(f"    [{name}] {inp}")
        return

    # Generic fallback via attributes (handles SDKs that don't export ToolUseBlock)
    if hasattr(block, "name") and hasattr(block, "input"):
        name = block.name or "tool"
        inp = block.input or {}
        if name == "WebSearch":
            query_str = inp.get("query", inp.get("q", str(inp)))
            print(f"    [WebSearch] {query_str}")
        elif name == "WebFetch":
            url = inp.get("url", str(inp))
            print(f"    [WebFetch]  {url}")
        else:
            print(f"    [{name}] {inp}")
        return

    # TextBlock — show a short preview (skip the final JSON blob)
    if isinstance(block, TextBlock):
        text = block.text.strip()
        if text and not text.startswith('{"nome"'):
            preview = text[:120].replace("\n", " ")
            print(f"    [think] {preview}{'…' if len(text) > 120 else ''}")


async def find_cfo(company_name: str, website_url: str) -> dict:
    """Run a Claude agent to find the CFO/head of finance. Returns parsed dict."""
    options = ClaudeAgentOptions(
        model=MODEL,
        allowed_tools=["WebSearch", "WebFetch"],
        permission_mode="acceptEdits",
    )
    last_text = ""
    async for message in query(prompt=_build_prompt(company_name, website_url), options=options):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                _log_block(block)
                if isinstance(block, TextBlock):
                    last_text = block.text

    return _parse_and_validate(last_text)


# ---------------------------------------------------------------------------
# Checkpoint I/O — same format as enricher.py
# ---------------------------------------------------------------------------


def load_checkpoint(output_dir: Path) -> dict[int, EnrichmentResult]:
    checkpoint_path = output_dir / "enrichment_progress.jsonl"
    done: dict[int, EnrichmentResult] = {}
    if not checkpoint_path.exists():
        return done
    with checkpoint_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
                done[d["rank"]] = EnrichmentResult(**d)
            except Exception:
                pass
    return done


def save_checkpoint_row(output_dir: Path, result: EnrichmentResult) -> None:
    checkpoint_path = output_dir / "enrichment_progress.jsonl"
    with checkpoint_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(result.to_dict(), ensure_ascii=False) + "\n")


# ---------------------------------------------------------------------------
# CSV I/O — same columns as enricher.py
# ---------------------------------------------------------------------------

ENRICHMENT_COLS = ["CFO_NOME", "CFO_RUOLO", "CFO_LINKEDIN", "FONTE", "CONFIDENZA", "DATA_RICERCA"]


def load_input_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def write_enriched_csv(
        output_dir: Path,
        companies: list[dict[str, str]],
        results: dict[int, EnrichmentResult],
) -> None:
    if not companies:
        return
    output_dir.mkdir(parents=True, exist_ok=True)
    original_cols = list(companies[0].keys())
    all_cols = original_cols + ENRICHMENT_COLS

    out_path = output_dir / "enriched.csv"
    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=all_cols)
        writer.writeheader()
        for row in companies:
            rank = int(row.get("RANK", 0))
            result = results.get(rank)
            enriched = dict(row)
            if result:
                enriched["CFO_NOME"] = result.cfo_nome or ""
                enriched["CFO_RUOLO"] = result.cfo_ruolo or ""
                enriched["CFO_LINKEDIN"] = result.cfo_linkedin or ""
                enriched["FONTE"] = result.fonte
                enriched["CONFIDENZA"] = result.confidenza or ""
                enriched["DATA_RICERCA"] = result.data_ricerca
            else:
                for col in ENRICHMENT_COLS:
                    enriched[col] = ""
            writer.writerow(enriched)

    print(f"\nScritto: {out_path}")


RATE_LIMIT_PATTERNS = ("429", "rate limit", "too many requests", "throttle")


def is_rate_limit_error(exc_or_msg: Any) -> bool:
    text = str(exc_or_msg).lower()
    return any(pattern in text for pattern in RATE_LIMIT_PATTERNS)


def build_result(rank: int, company_name: str, data: dict[str, Any]) -> EnrichmentResult:
    cfo_nome = data.get("nome")
    return EnrichmentResult(
        rank=rank,
        azienda=company_name,
        cfo_nome=cfo_nome,
        cfo_ruolo=data.get("ruolo") if cfo_nome else None,
        cfo_linkedin=data.get("linkedin_url") if cfo_nome else None,
        fonte="agent" if cfo_nome else "not_found",
        confidenza=data.get("confidenza") if cfo_nome else None,
        data_ricerca=date.today().isoformat(),
    )


async def process_company(company: dict[str, str]) -> CompanyOutcome:
    rank = int(company.get("RANK", 0))
    name = company.get("AZIENDA", "?")
    url = company.get("SITO WEB", "")

    start_ts = time.monotonic()
    max_attempts = max(1, RUN_MAX_RETRIES)
    had_rate_limit = False
    last_error: Exception | None = None

    for attempt in range(1, max_attempts + 1):
        print(f"  Rank {rank} | tentativo {attempt}/{max_attempts}: {name}", flush=True)
        try:
            data = await find_cfo(name, url)
            result = build_result(rank, name, data)
            return CompanyOutcome(
                result=result,
                rank=rank,
                had_rate_limit=had_rate_limit,
                attempts=attempt,
                elapsed_s=time.monotonic() - start_ts,
            )
        except Exception as exc:
            last_error = exc
            was_rate_limit = is_rate_limit_error(exc)
            had_rate_limit = had_rate_limit or was_rate_limit
            if attempt >= max_attempts:
                break

            delay_s = RUN_RETRY_BASE_DELAY * (2 ** (attempt - 1))
            jitter_s = random.uniform(0.0, 0.5)
            wait_s = delay_s + jitter_s
            reason = "rate-limit" if was_rate_limit else "errore"
            print(
                f"    [retry] Rank {rank}: {reason} ({exc}). Attendo {wait_s:.1f}s prima di riprovare.",
                file=sys.stderr,
                flush=True,
            )
            await asyncio.sleep(wait_s)

    if last_error is not None:
        print(f"    [errore-finale] Rank {rank}: {last_error}", file=sys.stderr, flush=True)

    result = build_result(rank, name, {"nome": None})
    return CompanyOutcome(
        result=result,
        rank=rank,
        had_rate_limit=had_rate_limit,
        attempts=max_attempts,
        elapsed_s=time.monotonic() - start_ts,
    )


def adapt_concurrency(
        current: int,
        batch_outcomes: list[CompanyOutcome],
        clean_streak: int,
) -> tuple[int, int]:
    max_workers = max(1, RUN_MAX_CONCURRENCY)
    min_workers = max(1, min(RUN_MIN_CONCURRENCY, max_workers))

    if not RUN_AUTO_THROTTLE:
        return current, clean_streak

    rate_limit_hits = sum(1 for outcome in batch_outcomes if outcome.had_rate_limit)
    if rate_limit_hits:
        next_workers = max(min_workers, current - 1)
        if next_workers < current:
            print(
                f"[throttle] Rate-limit rilevato in {rate_limit_hits} job: "
                f"worker {current} -> {next_workers}"
            )
        return next_workers, 0

    next_clean_streak = clean_streak + 1
    if next_clean_streak >= max(1, RUN_THROTTLE_RECOVERY_BATCHES) and current < max_workers:
        next_workers = min(max_workers, current + 1)
        print(
            f"[throttle] {next_clean_streak} batch puliti: "
            f"worker {current} -> {next_workers}"
        )
        return next_workers, 0

    return current, next_clean_streak


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


async def main() -> None:
    # Resolve input path
    if RUN_INPUT:
        input_path = Path(RUN_INPUT)
    else:
        script_dir = Path(__file__).parent
        input_path = script_dir / "data" / f"{RUN_YEAR}.csv"

    if not input_path.exists():
        print(f"Errore: file non trovato: {input_path}", file=sys.stderr)
        sys.exit(1)

    output_dir = Path(__file__).parent / "output" / str(RUN_YEAR)
    output_dir.mkdir(parents=True, exist_ok=True)

    companies = load_input_csv(input_path)
    print(f"Caricate {len(companies)} aziende da {input_path}")
    print(f"Modello: {MODEL}")
    print(
        "Concorrenza configurata: "
        f"max={RUN_MAX_CONCURRENCY}, min={RUN_MIN_CONCURRENCY}, "
        f"auto_throttle={RUN_AUTO_THROTTLE}"
    )

    # Load or reset checkpoint
    done: dict[int, EnrichmentResult] = {}
    if not RUN_RESET:
        done = load_checkpoint(output_dir)
        if done:
            print(f"Checkpoint: {len(done)} aziende già processate, riprendo dal resto.")
    else:
        checkpoint_path = output_dir / "enrichment_progress.jsonl"
        if checkpoint_path.exists():
            checkpoint_path.unlink()
            print("Checkpoint rimosso, ricomincio da capo.")

    pending = [c for c in companies if int(c.get("RANK", 0)) not in done]
    print(f"Da processare: {len(pending)} aziende\n")

    run_start_ts = time.monotonic()
    max_workers = max(1, RUN_MAX_CONCURRENCY)
    min_workers = max(1, min(RUN_MIN_CONCURRENCY, max_workers))
    current_workers = max_workers
    clean_streak = 0
    batch_index = 0
    offset = 0
    worker_samples = 0
    worker_sum = 0

    while offset < len(pending):
        batch_index += 1
        batch = pending[offset: offset + current_workers]
        first_pos = offset + 1
        last_pos = offset + len(batch)
        print(
            f"[batch {batch_index}] aziende {first_pos}-{last_pos}/{len(pending)} "
            f"| worker={current_workers}"
        )

        batch_start_ts = time.monotonic()
        outcomes = await asyncio.gather(*(process_company(company) for company in batch))
        batch_elapsed_s = time.monotonic() - batch_start_ts

        retries_count = sum(max(0, outcome.attempts - 1) for outcome in outcomes)
        rate_limit_count = sum(1 for outcome in outcomes if outcome.had_rate_limit)

        for outcome in sorted(outcomes, key=lambda item: item.rank):
            done[outcome.rank] = outcome.result
            save_checkpoint_row(output_dir, outcome.result)
            if outcome.result.cfo_nome:
                print(
                    f"  => Rank {outcome.rank} OK ({outcome.result.confidenza}) "
                    f"{outcome.result.cfo_nome} — {outcome.result.cfo_ruolo}"
                )
            else:
                print(f"  => Rank {outcome.rank} non trovato")

        print(
            f"[batch {batch_index}] tempo={batch_elapsed_s:.1f}s "
            f"| retry={retries_count} | rate_limit={rate_limit_count}"
        )

        worker_samples += 1
        worker_sum += current_workers
        current_workers, clean_streak = adapt_concurrency(current_workers, outcomes, clean_streak)
        current_workers = max(min_workers, min(max_workers, current_workers))

        offset += len(batch)
        if offset < len(pending):
            await asyncio.sleep(DELAY_BETWEEN_BATCHES)

    write_enriched_csv(output_dir, companies, done)

    # Summary
    total_elapsed_s = time.monotonic() - run_start_ts
    avg_workers = (worker_sum / worker_samples) if worker_samples else 0.0
    found = sum(1 for r in done.values() if r.cfo_nome)
    total = len(done)
    pct = 100 * found // total if total else 0
    print(f"\nTempo run: {total_elapsed_s:.1f}s")
    if worker_samples:
        print(f"Worker medi attivi: {avg_workers:.2f}")
    print(f"Risultati: {found}/{total} aziende con CFO identificato ({pct}%)")
    for conf in ("high", "medium", "low"):
        count = sum(1 for r in done.values() if r.confidenza == conf)
        if count:
            print(f"  {conf}: {count}")
    not_found = sum(1 for r in done.values() if not r.cfo_nome)
    if not_found:
        print(f"  not_found: {not_found}")


if __name__ == "__main__":
    asyncio.run(main())
