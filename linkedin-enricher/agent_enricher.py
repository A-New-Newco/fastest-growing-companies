"""
LinkedIn Profile Enricher — powered by claude-agent-sdk.

Finds LinkedIn profile URLs for known contacts (name + role + company) that
are missing a LinkedIn link.  Mirrors the cfo-enricher architecture:
asyncio concurrency, JSONL checkpoint, SSE monitor, retry/backoff.

Auth: claude auth login (Pro plan) — no separate API key needed.
Model: claude-haiku-4-5-20251001
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# RUN CONFIGURATION — edit here to run standalone (without monitor_server)
# ---------------------------------------------------------------------------

# Input file path (CSV). None = expects JSON via monitor_server
RUN_INPUT: str | None = None

# Output directory. None = auto: ./output/run/
RUN_OUTPUT_DIR: str | None = None

# True = ignore existing checkpoint and restart from scratch
RUN_RESET: bool = False

# Maximum parallel workers
RUN_MAX_CONCURRENCY: int = 8

# Max attempts per contact (first attempt included)
RUN_MAX_RETRIES: int = 3

# Exponential backoff base delay for retries
RUN_RETRY_BASE_DELAY: float = 2.0

MODEL: str = "claude-haiku-4-5-20251001"

import asyncio
import csv
import json
import random
import re
import sys
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path
from typing import Any, cast
from urllib.parse import urlparse

from claude_agent_sdk import AssistantMessage, ClaudeAgentOptions, TextBlock, query

try:
    from claude_agent_sdk import ToolUseBlock
except ImportError:
    ToolUseBlock = None

try:
    from claude_agent_sdk import ResultMessage
except ImportError:
    ResultMessage = None  # type: ignore[assignment,misc]


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class EnrichmentResult:
    id: str
    nome: str
    azienda: str
    linkedin_url: str | None
    fonte: str  # "agent" | "not_found"
    confidenza: str | None  # "high"|"medium"|"low"
    data_ricerca: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class QualityFlags:
    linkedin_verified: bool
    url_validation_error: str | None


@dataclass
class ContactOutcome:
    result: EnrichmentResult
    quality_flags: QualityFlags
    id: str
    had_rate_limit: bool
    attempts: int
    elapsed_s: float
    cost_usd: float | None = None
    usage: dict | None = None
    tool_calls: int = 0
    ruolo: str | None = None
    sito_web: str | None = None


# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------

LEGAL_SUFFIXES = re.compile(
    r"\s*\b(S\.r\.l\.?\s*SB|S\.r\.l\.?|S\.p\.A\.?|S\.a\.s\.?|S\.n\.c\.?|S\.S\.?|S\.r\.l\.s\.?"
    r"|GmbH|AG|KG|UG|e\.K\.)\s*$",
    re.IGNORECASE,
)


def _clean_company_name(name: str) -> str:
    """Strip legal suffixes (S.r.l., S.p.A., GmbH, etc.) for cleaner web searches."""
    return LEGAL_SUFFIXES.sub("", name).strip()


def _build_linkedin_discovery_prompt(
    nome: str,
    ruolo: str | None,
    azienda: str,
    sito_web: str | None,
) -> str:
    clean_name = _clean_company_name(azienda)
    website_line = (
        f"Company website: {sito_web}"
        if sito_web and sito_web.lower() not in ("", "n/a", "none")
        else ""
    )
    role_line = f"\nRole: {ruolo}" if ruolo else ""

    return f"""Find the LinkedIn profile URL for a known person.

Person: {nome}{role_line}
Company: {azienda}
{website_line}

SEARCH STRATEGY (stop at any step if URL found with high confidence):

Step 1 — Direct LinkedIn search:
  WebSearch: "{nome}" "{clean_name}" site:linkedin.com/in

Step 2 — Broader LinkedIn search (only if Step 1 returned no match):
  WebSearch: "{nome}" "{clean_name}" linkedin
  If the name may have locale variants (e.g. Giuseppe/Joseph, Friedrich/Frederick), also try:
  WebSearch: <variant> "{clean_name}" linkedin

Step 3 — Company website team page (only if Steps 1-2 failed AND website is available):
  WebFetch {sito_web if sito_web else "the company website"} and look for team/about/chi-siamo/ueber-uns pages.
  Look for a LinkedIn icon or link next to {nome}.

DISAMBIGUATION RULES:
- The person CURRENTLY works at {azienda}. Ignore profiles showing them at a different company \
unless {clean_name} appears in their experience.
- If multiple profiles match the name, prefer the one whose headline or experience \
mentions "{clean_name}".
- For common names (e.g. Marco Rossi, Thomas Mueller): require BOTH name AND company match \
in search results or profile snippet. If you cannot confirm the company match, \
return confidence "low".
- LinkedIn URL must be a /in/ profile URL, not a /company/ page.

CONFIDENCE TIERS:
- high: Search results show a LinkedIn /in/ URL where BOTH the person name AND company name \
appear in the same result snippet or title.
- medium: URL found, name matches, but company match is indirect (e.g. company appears only \
in related results, not the same snippet).
- low: URL found for someone with the right name, but cannot confirm they work at this company.

Return ONLY this fenced JSON block (no text after ##END##):
##JSON##
{{"linkedin_url": "https://www.linkedin.com/in/..." or null, \
"confidence": "high|medium|low", "reason": "brief explanation of match quality"}}
##END##"""


def _build_linkedin_verification_prompt(
    nome: str,
    ruolo: str | None,
    azienda: str,
    linkedin_url: str,
) -> str:
    clean_name = _clean_company_name(azienda)
    role_line = ruolo or "unknown"

    return f"""Verify whether a LinkedIn profile URL belongs to a specific person at a specific company.

Person: {nome}
Role: {role_line}
Company: {azienda}
LinkedIn URL to verify: {linkedin_url}

TASK:
1) WebSearch: "{nome}" "{clean_name}" site:linkedin.com/in
2) Check if any result contains the exact URL "{linkedin_url}" (or its slug) alongside \
the person name and company name.
3) If Step 1 is inconclusive, run ONE more query:
   WebSearch: "{nome}" "{clean_name}" linkedin

VERIFICATION CRITERIA:
- VERIFIED (true): The URL appears in search results associated with {nome} at {clean_name}, \
OR the URL slug clearly matches the person name and the company appears in the same result.
- NOT VERIFIED (false): The URL does not appear in results for this person, \
OR the results suggest it belongs to a different person or a person at a different company.
- If a BETTER URL is found during verification, return that URL instead.

Do NOT use WebFetch.

Return ONLY this fenced JSON block (no text after ##END##):
##JSON##
{{"verified": true|false, "linkedin_url": "https://..." or null, "reason": "short reason"}}
##END##"""


# ---------------------------------------------------------------------------
# Parsing / validation
# ---------------------------------------------------------------------------

CONFIDENCE_VALUES = {"high", "medium", "low"}
LINKEDIN_SLUG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._%-]{0,199}$")


def _extract_json_payload(text: str) -> dict[str, Any] | None:
    if not text:
        return None

    candidates: list[str] = []
    fenced = re.search(r"##JSON##\s*(\{[\s\S]*?\})\s*##END##", text, re.IGNORECASE)
    if fenced:
        candidates.append(fenced.group(1).strip())

    fallback_matches = re.findall(r"\{[^{}]{2,1500}\}", text, re.DOTALL)
    for raw in reversed(fallback_matches):
        candidates.append(raw.strip())

    seen: set[str] = set()
    for raw in candidates:
        if raw in seen:
            continue
        seen.add(raw)
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return cast(dict[str, Any], parsed)

    return None


def _normalize_confidence(raw: Any) -> str | None:
    if not isinstance(raw, str):
        return None
    conf = raw.strip().lower()
    if conf in CONFIDENCE_VALUES:
        return conf
    return None


def _canonicalize_linkedin_profile_url(raw: Any) -> tuple[str | None, str | None]:
    if raw is None:
        return None, None
    if not isinstance(raw, str):
        return None, "linkedin_not_string"

    url = raw.strip()
    if not url:
        return None, None

    if not re.match(r"^https?://", url, re.IGNORECASE):
        url = f"https://{url}"

    try:
        parsed = urlparse(url)
    except ValueError:
        return None, "linkedin_url_parse_error"

    host = parsed.netloc.lower()
    if host.startswith("www."):
        host = host[4:]

    if host == "it.linkedin.com":
        host = "linkedin.com"

    if host != "linkedin.com":
        return None, "non_linkedin_domain"

    segments = [seg for seg in (parsed.path or "").split("/") if seg]
    if len(segments) < 2 or segments[0].lower() != "in":
        return None, "not_profile_path"

    slug = segments[1].strip()
    if not slug:
        return None, "missing_profile_slug"
    if not LINKEDIN_SLUG_RE.match(slug):
        return None, "invalid_profile_slug"

    canonical = f"https://www.linkedin.com/in/{slug}/"
    return canonical, None


def _downgrade_confidence(confidence: str | None) -> str:
    if confidence == "high":
        return "medium"
    return "low"


def _parse_search_response(text: str) -> tuple[str | None, str | None, str | None]:
    """Parse the discovery agent response.

    Returns (linkedin_url, confidenza, parse_error).
    """
    payload = _extract_json_payload(text)
    if payload is None:
        return None, None, "missing_json_block"

    raw_url = payload.get("linkedin_url")
    if raw_url is None:
        return None, None, None

    url, url_error = _canonicalize_linkedin_profile_url(raw_url)
    if url_error:
        return None, None, url_error

    confidenza = _normalize_confidence(payload.get("confidence") or payload.get("confidenza"))
    if confidenza is None:
        confidenza = "medium"

    return url, confidenza, None


def _parse_verification_response(
    text: str,
    *,
    original_url: str,
) -> tuple[bool, str | None, str | None]:
    """Parse the verification agent response.

    Returns (verified, linkedin_url, error_reason).
    """
    payload = _extract_json_payload(text)
    if payload is None:
        return False, None, "verification_json_missing"

    raw_verified = payload.get("verified")
    verified = False
    if isinstance(raw_verified, bool):
        verified = raw_verified
    elif isinstance(raw_verified, str):
        verified = raw_verified.strip().lower() in {"true", "1", "yes"}

    reason = payload.get("reason") if isinstance(payload.get("reason"), str) else ""
    reason = reason.strip()[:200] if reason else ""

    returned_url_raw = payload.get("linkedin_url")
    returned_url: str | None = None
    url_error: str | None = None
    if returned_url_raw is not None:
        returned_url, url_error = _canonicalize_linkedin_profile_url(returned_url_raw)

    if verified:
        return True, returned_url or original_url, None

    # Repair path: model may return a better URL even if "verified" is false
    if returned_url and returned_url != original_url:
        return True, returned_url, None

    if url_error:
        return False, None, url_error

    return False, None, reason or "search_not_confirmed"


# ---------------------------------------------------------------------------
# Agent calls
# ---------------------------------------------------------------------------


def _log_block(block: Any) -> None:
    """Log a single content block from an AssistantMessage."""
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

    if isinstance(block, TextBlock):
        text = block.text.strip()
        if text and not text.startswith("##JSON##") and not text.startswith('{"linkedin_url"'):
            preview = text[:120].replace("\n", " ")
            print(f"    [think] {preview}{'…' if len(text) > 120 else ''}")


@dataclass
class _AgentRun:
    """Result of a single agent query, including cost/usage metadata."""

    text: str
    cost_usd: float | None
    usage: dict | None
    num_turns: int


async def _run_agent(prompt: str, *, allowed_tools: list[str]) -> _AgentRun:
    options = ClaudeAgentOptions(
        model=MODEL,
        allowed_tools=allowed_tools,
        permission_mode="acceptEdits",
    )

    last_text = ""
    cost_usd: float | None = None
    usage: dict | None = None
    num_turns: int = 0

    async for message in query(prompt=prompt, options=options):
        if ResultMessage is not None and isinstance(message, ResultMessage):
            cost_usd = getattr(message, "total_cost_usd", None)
            usage = getattr(message, "usage", None)
            num_turns = getattr(message, "num_turns", 0)
        elif isinstance(message, AssistantMessage):
            for block in message.content:
                _log_block(block)
                if isinstance(block, TextBlock):
                    last_text = block.text

    return _AgentRun(text=last_text, cost_usd=cost_usd, usage=usage, num_turns=num_turns)


async def _verify_linkedin_profile(
    *,
    nome: str,
    ruolo: str | None,
    azienda: str,
    linkedin_url: str,
) -> tuple[str | None, bool, str | None, _AgentRun]:
    run = await _run_agent(
        _build_linkedin_verification_prompt(nome, ruolo, azienda, linkedin_url),
        allowed_tools=["WebSearch"],
    )

    verified, verified_url, verify_error = _parse_verification_response(
        run.text,
        original_url=linkedin_url,
    )

    if not verified or not verified_url:
        return None, False, verify_error, run

    return verified_url, True, None, run


async def find_linkedin(
    nome: str,
    ruolo: str | None,
    azienda: str,
    sito_web: str | None,
) -> tuple[str | None, QualityFlags, str | None, float | None, dict | None, int]:
    """
    Run discover + verify flow. Returns:
      (linkedin_url, quality_flags, confidenza, total_cost_usd, usage, total_turns)
    """
    discovery_run = await _run_agent(
        _build_linkedin_discovery_prompt(nome, ruolo, azienda, sito_web),
        allowed_tools=["WebSearch", "WebFetch"],
    )

    linkedin_url, confidenza, parse_error = _parse_search_response(discovery_run.text)

    total_cost = discovery_run.cost_usd
    total_turns = discovery_run.num_turns
    total_usage = discovery_run.usage

    if not linkedin_url:
        return (
            None,
            QualityFlags(
                linkedin_verified=False,
                url_validation_error=parse_error,
            ),
            None,
            total_cost,
            total_usage,
            total_turns,
        )

    # Optimize: skip verification for high confidence results
    if confidenza == "high":
        return (
            linkedin_url,
            QualityFlags(
                linkedin_verified=False,
                url_validation_error=None,
            ),
            confidenza,
            total_cost,
            total_usage,
            total_turns,
        )

    # Verify medium/low confidence results
    print("    [verify] Checking LinkedIn URL", flush=True)
    verified_url, linkedin_verified, verify_error, verify_run = await _verify_linkedin_profile(
        nome=nome,
        ruolo=ruolo,
        azienda=azienda,
        linkedin_url=linkedin_url,
    )

    if verify_run.cost_usd is not None:
        total_cost = (total_cost or 0.0) + verify_run.cost_usd
    total_turns += verify_run.num_turns

    if linkedin_verified and verified_url:
        return (
            verified_url,
            QualityFlags(
                linkedin_verified=True,
                url_validation_error=None,
            ),
            confidenza,
            total_cost,
            total_usage,
            total_turns,
        )

    # Verification failed — downgrade confidence, drop URL
    return (
        None,
        QualityFlags(
            linkedin_verified=False,
            url_validation_error=verify_error or "search_not_confirmed",
        ),
        _downgrade_confidence(confidenza),
        total_cost,
        total_usage,
        total_turns,
    )


# ---------------------------------------------------------------------------
# Checkpoint I/O
# ---------------------------------------------------------------------------

CHECKPOINT_FILE = "linkedin_progress.jsonl"


def load_checkpoint(output_dir: Path) -> dict[str, EnrichmentResult]:
    checkpoint_path = output_dir / CHECKPOINT_FILE
    done: dict[str, EnrichmentResult] = {}
    if not checkpoint_path.exists():
        return done
    _fields = {f.name for f in EnrichmentResult.__dataclass_fields__.values()}
    with checkpoint_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
                filtered = {k: v for k, v in d.items() if k in _fields}
                done[d["id"]] = EnrichmentResult(**filtered)
            except Exception:
                pass
    return done


def save_checkpoint_row(output_dir: Path, result: EnrichmentResult) -> None:
    checkpoint_path = output_dir / CHECKPOINT_FILE
    with checkpoint_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(result.to_dict(), ensure_ascii=False) + "\n")


# ---------------------------------------------------------------------------
# CSV I/O
# ---------------------------------------------------------------------------

ENRICHMENT_COLS = ["LINKEDIN_URL", "CONFIDENZA", "FONTE", "DATA_RICERCA"]


def load_input_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    # Auto-detect format: native (ID, NOME, ...) or cfo-enricher output (RANK, AZIENDA, CFO_NOME)
    if rows and "ID" not in rows[0] and "RANK" in rows[0]:
        # Convert cfo-enricher format
        converted = []
        for row in rows:
            cfo_nome = row.get("CFO_NOME", "").strip()
            if not cfo_nome:
                continue  # skip rows without a contact name
            converted.append(
                {
                    "ID": row.get("RANK", ""),
                    "NOME": cfo_nome,
                    "RUOLO": row.get("CFO_RUOLO", ""),
                    "AZIENDA": row.get("AZIENDA", ""),
                    "SITO_WEB": row.get("SITO WEB", ""),
                }
            )
        return converted

    return rows


def write_enriched_csv(
    output_dir: Path,
    contacts: list[dict[str, str]],
    results: dict[str, EnrichmentResult],
) -> None:
    if not contacts:
        return

    output_dir.mkdir(parents=True, exist_ok=True)
    original_cols = list(contacts[0].keys())
    all_cols = original_cols + ENRICHMENT_COLS

    out_path = output_dir / "enriched.csv"
    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=all_cols)
        writer.writeheader()
        for row in contacts:
            contact_id = row.get("ID", "")
            result = results.get(contact_id)
            enriched = dict(row)
            if result:
                enriched["LINKEDIN_URL"] = result.linkedin_url or ""
                enriched["CONFIDENZA"] = result.confidenza or ""
                enriched["FONTE"] = result.fonte
                enriched["DATA_RICERCA"] = result.data_ricerca
            else:
                for col in ENRICHMENT_COLS:
                    enriched[col] = ""
            writer.writerow(enriched)

    print(f"\nScritto: {out_path}")


# ---------------------------------------------------------------------------
# Rate-limit detection
# ---------------------------------------------------------------------------

RATE_LIMIT_PATTERNS = ("429", "rate limit", "too many requests", "throttle")


def is_rate_limit_error(exc_or_msg: Any) -> bool:
    text = str(exc_or_msg).lower()
    return any(pattern in text for pattern in RATE_LIMIT_PATTERNS)


# ---------------------------------------------------------------------------
# Build result
# ---------------------------------------------------------------------------


def build_result(
    contact_id: str, nome: str, azienda: str, linkedin_url: str | None, confidenza: str | None
) -> EnrichmentResult:
    if linkedin_url:
        canonical, _ = _canonicalize_linkedin_profile_url(linkedin_url)
        linkedin_url = canonical

    return EnrichmentResult(
        id=contact_id,
        nome=nome,
        azienda=azienda,
        linkedin_url=linkedin_url,
        fonte="agent" if linkedin_url else "not_found",
        confidenza=confidenza,
        data_ricerca=date.today().isoformat(),
    )


# ---------------------------------------------------------------------------
# Process single contact
# ---------------------------------------------------------------------------


async def process_contact(
    contact: dict[str, str],
    max_retries: int = RUN_MAX_RETRIES,
    retry_base_delay: float = RUN_RETRY_BASE_DELAY,
) -> ContactOutcome:
    contact_id = contact.get("ID", contact.get("id", ""))
    nome = contact.get("NOME", contact.get("nome", "?"))
    ruolo = contact.get("RUOLO", contact.get("ruolo")) or None
    azienda = contact.get("AZIENDA", contact.get("azienda", "?"))
    sito_web = contact.get("SITO_WEB", contact.get("sito_web")) or None

    start_ts = time.monotonic()
    max_attempts = max(1, max_retries)
    had_rate_limit = False
    last_error: Exception | None = None

    for attempt in range(1, max_attempts + 1):
        id_short = contact_id[:8] if len(contact_id) > 8 else contact_id
        print(
            f"  ID {id_short} | tentativo {attempt}/{max_attempts}: {nome} @ {azienda}", flush=True
        )
        try:
            (
                linkedin_url,
                quality_flags,
                confidenza,
                cost_usd,
                usage,
                tool_calls,
            ) = await find_linkedin(nome, ruolo, azienda, sito_web)
            result = build_result(contact_id, nome, azienda, linkedin_url, confidenza)

            return ContactOutcome(
                result=result,
                quality_flags=quality_flags,
                id=contact_id,
                had_rate_limit=had_rate_limit,
                attempts=attempt,
                elapsed_s=time.monotonic() - start_ts,
                cost_usd=cost_usd,
                usage=usage,
                tool_calls=tool_calls,
                ruolo=ruolo,
                sito_web=sito_web,
            )
        except Exception as exc:
            last_error = exc
            was_rate_limit = is_rate_limit_error(exc)
            had_rate_limit = had_rate_limit or was_rate_limit
            if attempt >= max_attempts:
                break

            delay_s = retry_base_delay * (2 ** (attempt - 1))
            jitter_s = random.uniform(0.0, 0.5)
            wait_s = delay_s + jitter_s
            reason = "rate-limit" if was_rate_limit else "errore"
            print(
                f"    [retry] ID {id_short}: {reason} ({exc}). Attendo {wait_s:.1f}s.",
                file=sys.stderr,
                flush=True,
            )
            await asyncio.sleep(wait_s)

    if last_error is not None:
        id_short = contact_id[:8] if len(contact_id) > 8 else contact_id
        print(f"    [errore-finale] ID {id_short}: {last_error}", file=sys.stderr, flush=True)

    result = build_result(contact_id, nome, azienda, None, None)
    return ContactOutcome(
        result=result,
        quality_flags=QualityFlags(linkedin_verified=False, url_validation_error=None),
        id=contact_id,
        had_rate_limit=had_rate_limit,
        attempts=max_attempts,
        elapsed_s=time.monotonic() - start_ts,
        ruolo=ruolo,
        sito_web=sito_web,
    )


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


async def run_enrichment(
    contacts: list[dict[str, str]],
    output_dir: Path,
    reset: bool = False,
    max_concurrency: int = RUN_MAX_CONCURRENCY,
    max_retries: int = RUN_MAX_RETRIES,
    retry_base_delay: float = RUN_RETRY_BASE_DELAY,
    on_contact_done: Callable[[ContactOutcome, int, int], None] | None = None,
) -> dict[str, Any]:
    """
    Run enrichment on a list of contacts, writing output to output_dir.
    Calls on_contact_done(outcome, completed, total) after each contact completes.
    Returns a summary dict with cost, timing, and result counts.
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Caricati {len(contacts)} contatti")
    print(f"Modello: {MODEL}")
    print(f"Worker paralleli: {max_concurrency}")

    done: dict[str, EnrichmentResult] = {}

    if not reset:
        done = load_checkpoint(output_dir)
        if done:
            print(f"Checkpoint: {len(done)} contatti già processati, riprendo dal resto.")
    else:
        checkpoint_path = output_dir / CHECKPOINT_FILE
        if checkpoint_path.exists():
            checkpoint_path.unlink()
            print("Checkpoint rimosso, ricomincio da capo.")

    pending = [c for c in contacts if (c.get("ID", c.get("id", "")) not in done)]
    print(f"Da processare: {len(pending)} contatti\n")

    if not pending:
        write_enriched_csv(output_dir, contacts, done)
        return {"total": 0, "found": 0, "pct": 0, "total_cost_usd": 0.0, "elapsed_s": 0.0}

    run_start_ts = time.monotonic()
    sem = asyncio.Semaphore(max_concurrency)
    checkpoint_lock = asyncio.Lock()
    progress: dict[str, Any] = {"completed": 0, "found": 0, "rate_limits": 0, "total_cost_usd": 0.0}

    async def worker(contact: dict[str, str]) -> ContactOutcome:
        async with sem:
            outcome = await process_contact(
                contact, max_retries=max_retries, retry_base_delay=retry_base_delay
            )

        async with checkpoint_lock:
            done[outcome.id] = outcome.result
            save_checkpoint_row(output_dir, outcome.result)

            progress["completed"] += 1
            if outcome.had_rate_limit:
                progress["rate_limits"] += 1
            if outcome.cost_usd is not None:
                progress["total_cost_usd"] += outcome.cost_usd
            n = progress["completed"]
            total = len(pending)

            cost_str = f" | ${outcome.cost_usd:.4f}" if outcome.cost_usd is not None else ""
            tokens_str = ""
            if outcome.usage:
                in_t = outcome.usage.get("input_tokens", "?")
                out_t = outcome.usage.get("output_tokens", "?")
                tokens_str = f" | {in_t}+{out_t}tok"
            turns_str = f" | {outcome.tool_calls}turns" if outcome.tool_calls else ""

            id_short = outcome.id[:8] if len(outcome.id) > 8 else outcome.id
            if outcome.result.linkedin_url:
                progress["found"] += 1
                print(
                    f"  => [{n}/{total}] ID {id_short} OK ({outcome.result.confidenza}) "
                    f"{outcome.result.linkedin_url}"
                    f"{cost_str}{tokens_str}{turns_str}"
                )
            else:
                print(
                    f"  => [{n}/{total}] ID {id_short} non trovato{cost_str}{tokens_str}{turns_str}"
                )

            if on_contact_done:
                on_contact_done(outcome, progress["completed"], len(pending))

        return outcome

    tasks = [asyncio.create_task(worker(c)) for c in pending]
    await asyncio.gather(*tasks)

    write_enriched_csv(output_dir, contacts, done)

    total_elapsed_s = time.monotonic() - run_start_ts
    found = progress["found"]
    total = len(pending)
    pct = 100 * found // total if total else 0
    total_cost = progress["total_cost_usd"]

    print(f"\nTempo run: {total_elapsed_s:.1f}s")
    print(f"Risultati: {found}/{total} contatti con LinkedIn trovato ({pct}%)")
    if total_cost > 0:
        print(f"Costo totale: ${total_cost:.4f} (media ${total_cost / total:.4f}/contatto)")
    if progress["rate_limits"]:
        print(f"Rate-limit retries: {progress['rate_limits']}")

    for conf in ("high", "medium", "low"):
        count = sum(1 for r in done.values() if r.confidenza == conf)
        if count:
            print(f"  {conf}: {count}")

    not_found_count = sum(1 for r in done.values() if not r.linkedin_url)
    if not_found_count:
        print(f"  not_found: {not_found_count}")

    verified = sum(1 for r in done.values() if r.linkedin_url)
    print(f"  linkedin_found: {verified}")

    return {
        "total": total,
        "found": found,
        "pct": pct,
        "total_cost_usd": total_cost,
        "elapsed_s": total_elapsed_s,
        "rate_limits": progress["rate_limits"],
    }


# ---------------------------------------------------------------------------
# Standalone entry point (CSV mode)
# ---------------------------------------------------------------------------


async def main() -> None:
    if RUN_INPUT:
        input_path = Path(RUN_INPUT)
    else:
        print("Errore: impostare RUN_INPUT o usare il monitor_server.", file=sys.stderr)
        sys.exit(1)

    if not input_path.exists():
        print(f"Errore: file non trovato: {input_path}", file=sys.stderr)
        sys.exit(1)

    contacts = load_input_csv(input_path)

    if RUN_OUTPUT_DIR:
        output_dir = Path(RUN_OUTPUT_DIR)
    else:
        script_dir = Path(__file__).parent
        output_dir = script_dir / "output" / "run"

    await run_enrichment(
        contacts=contacts,
        output_dir=output_dir,
        reset=RUN_RESET,
        max_concurrency=RUN_MAX_CONCURRENCY,
        max_retries=RUN_MAX_RETRIES,
        retry_base_delay=RUN_RETRY_BASE_DELAY,
    )


if __name__ == "__main__":
    asyncio.run(main())
