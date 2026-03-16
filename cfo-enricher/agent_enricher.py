"""
CFO/DAF Agent Enricher — powered by claude-agent-sdk.

Replaces the scripted 5-layer pipeline in enricher.py with a concurrent Claude-agent
orchestrator that uses WebSearch and WebFetch natively to find the CFO/head of finance
for each Italian company.

Auth: claude auth login (Pro plan) — no separate API key needed.
Model: claude-haiku-4-5-20251001

Output format is fully compatible with enricher.py (same JSONL checkpoint + enriched.csv).
Additionally writes a QA sidecar report: output/{year}/enrichment_quality_report.json.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# RUN CONFIGURATION — edit here to run from PyCharm
# ---------------------------------------------------------------------------

# Year to process (used to derive default input/output paths)
RUN_YEAR: int = 2026

# Input file path (CSV or JSONL). None = default: ./data/{RUN_YEAR}.csv
RUN_INPUT: str | None = None

# Output directory. None = auto: ./output/{RUN_YEAR}/
RUN_OUTPUT_DIR: str | None = None

# True = ignore existing checkpoint and restart from scratch
RUN_RESET: bool = False

# Maximum parallel workers (companies processed per batch)
RUN_MAX_CONCURRENCY: int = 8

# Max attempts per company (first attempt included)
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
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Literal, cast
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
# Data model — checkpoint/csv schema stays identical to enricher.py
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
    cfo_email: str | None = None  # opportunistic — only if found incidentally
    cfo_telefono: str | None = None  # opportunistic — only if found incidentally

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


RoleClass = Literal["finance", "non_finance_fallback"]


@dataclass
class QualityFlags:
    linkedin_verified: bool
    role_class: RoleClass
    is_low_non_finance_fallback: bool
    link_validation_error: str | None


@dataclass
class CompanyOutcome:
    result: EnrichmentResult
    quality_flags: QualityFlags
    rank: int
    had_rate_limit: bool
    attempts: int
    elapsed_s: float
    cost_usd: float | None = None  # from ResultMessage.total_cost_usd (all agent calls)
    usage: dict | None = None  # from ResultMessage.usage (input/output tokens)
    tool_calls: int = 0  # from ResultMessage.num_turns (total across all agent calls)
    website: str | None = None  # original "SITO WEB" — passed through for monitor events
    country: str = "IT"  # "IT" or "DE" — from COUNTRY field


# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------


LEGAL_SUFFIXES = re.compile(
    r"\s*\b(S\.r\.l\.?\s*SB|S\.r\.l\.?|S\.p\.A\.?|S\.a\.s\.?|S\.n\.c\.?|S\.S\.?|S\.r\.l\.s\.?)\s*$",
    re.IGNORECASE,
)


def _clean_company_name(name: str) -> str:
    """Strip legal suffixes (S.r.l., S.p.A., etc.) for cleaner web searches."""
    return LEGAL_SUFFIXES.sub("", name).strip()


def _build_prompt(company_name: str, website_url: str, revenue_k: int | None = None) -> str:
    """Italian prompt — for IT companies."""
    url_line = (
        f"Website: {website_url}"
        if website_url and website_url.lower() not in ("", "n/a")
        else "Website: not available"
    )
    clean_name = _clean_company_name(company_name)

    is_small = revenue_k is not None and revenue_k < 5_000
    is_medium = revenue_k is not None and 5_000 <= revenue_k < 20_000

    if is_small:
        size_hint = (
            "This is a SMALL Italian company (revenue < 5M€). It very likely does NOT have a dedicated CFO. "
            "The person managing finances is probably the Amministratore Delegato, Amministratore Unico, "
            "or the owner. That is an acceptable answer at LOW confidence."
        )
        strategy = f"""Step 1 — Search for the company leader:
  WebSearch: "{clean_name}" "amministratore delegato" OR "amministratore unico" OR CEO OR fondatore

Step 2 — Targeted finance search (only if Step 1 found nothing):
  WebSearch: "{clean_name}" CFO OR "direttore finanziario" OR DAF"""
    elif is_medium:
        size_hint = (
            "This is a MEDIUM-SIZED Italian company (revenue 5–20M€). "
            "It may or may not have a dedicated CFO. Prioritize finance roles."
        )
        strategy = f"""Step 1 — Targeted finance role searches (run both):
  a) WebSearch: "{clean_name}" "direttore finanziario" OR CFO OR DAF
  b) WebSearch: "{clean_name}" CFO site:linkedin.com

Step 2 — Broader search if Step 1 found nothing:
  WebSearch: "{clean_name}" "amministratore delegato" OR "amministratore unico" OR CEO"""
    else:
        size_hint = (
            "Prioritize dedicated finance leaders first. "
            "Use CEO/founder fallback only when no finance role is evidenced."
        )
        strategy = f"""Step 1 — Targeted finance role searches (run at least 2 of these):
  a) WebSearch: "{clean_name}" "direttore finanziario" OR CFO OR DAF
  b) WebSearch: "{clean_name}" CFO site:linkedin.com
  c) WebSearch: "{clean_name}" "responsabile amministrativo" OR "finance manager"

Step 2 — Company team/management page:
  WebFetch the company website and look for team/management pages:
  Try: /chi-siamo, /team, /about, /about-us, /management, /leadership, /organigramma, /la-societa

Step 3 — LinkedIn company page:
  WebSearch: "{clean_name}" site:linkedin.com/company
  Then WebFetch the company LinkedIn page to find employees with finance titles.

Step 4 — Broader leadership fallback:
  WebSearch: "{clean_name}" "amministratore delegato" OR "amministratore unico" OR CEO OR founder"""

    return f"""Find the person responsible for finance management at this Italian company: {company_name}
{url_line}

{size_hint}

SEARCH STRATEGY:

{strategy}

IMPORTANT RULES:
- **STOP EARLY**: If you find a HIGH confidence result at any step, return immediately — skip remaining steps.
- The legal name is "{company_name}" but search using "{clean_name}" (without legal suffix).
- Confidence tiers:
  HIGH: CFO/DAF/Finance Director/Chief Financial Officer
  MEDIUM: Controller/Head of Finance/Finance Manager/Treasurer
  LOW: CEO/Founder/Owner only as fallback

Return ONLY this fenced JSON block (no text after ##END##):
##JSON##
{{"nome": "First Last", "ruolo": "Exact title as found", "linkedin_url": "https://..." or null, "confidenza": "high|medium|low", "email": "address if found on a page you already read, else null", "phone": "number if found on a page you already read, else null"}}
##END##

Note: Fill `email` and `phone` ONLY if you encounter them incidentally on a page you are already reading. Do NOT run extra searches for them.

If nothing found:
##JSON##
{{"nome": null}}
##END##"""


def _build_prompt_de(company_name: str, website_url: str, revenue_k: int | None = None) -> str:
    """German prompt — for DE companies."""
    url_line = (
        f"Website: {website_url}"
        if website_url and website_url.lower() not in ("", "n/a")
        else "Website: not available"
    )

    is_small = revenue_k is not None and revenue_k < 5_000
    is_medium = revenue_k is not None and 5_000 <= revenue_k < 20_000

    if is_small:
        size_hint = (
            "This is a SMALL German company (revenue < 5M€). It very likely does NOT have a dedicated CFO. "
            "The person managing finances is probably the Geschäftsführer, Inhaber, or Gründer."
        )
        strategy = f"""Step 1 — Search for the company leader:
  WebSearch: "{company_name}" Geschäftsführer OR CEO OR Inhaber OR Gründer

Step 2 — Targeted finance search (only if Step 1 found nothing):
  WebSearch: "{company_name}" CFO OR "Leiter Finanzen" OR Finanzvorstand"""
    elif is_medium:
        size_hint = (
            "This is a MEDIUM-SIZED German company (revenue 5–20M€). "
            "It may or may not have a dedicated CFO. Prioritize finance roles."
        )
        strategy = f"""Step 1 — Targeted finance role searches (run both):
  a) WebSearch: "{company_name}" Finanzvorstand OR CFO OR "Leiter Finanzen"
  b) WebSearch: "{company_name}" CFO site:linkedin.com

Step 2 — Broader search if Step 1 found nothing:
  WebSearch: "{company_name}" Geschäftsführer OR CEO OR Inhaber"""
    else:
        size_hint = (
            "This German company likely has a dedicated finance leader. "
            "Prioritize CFO/Finanzvorstand roles. Use Geschäftsführer only as fallback."
        )
        strategy = f"""Step 1 — Targeted finance role searches (run at least 2 of these):
  a) WebSearch: "{company_name}" Finanzvorstand OR CFO OR "Leiter Finanzen"
  b) WebSearch: "{company_name}" CFO site:linkedin.com
  c) WebSearch: "{company_name}" "Kaufmännischer Leiter" OR "Finance Manager"

Step 2 — Company team/management page:
  WebFetch the company website and look for team/management pages:
  Try: /ueber-uns, /team, /unternehmen, /management, /leadership, /about, /about-us

Step 3 — LinkedIn company page:
  WebSearch: "{company_name}" site:linkedin.com/company
  Then WebFetch the company LinkedIn page to find employees with finance titles.

Step 4 — Broader leadership fallback:
  WebSearch: "{company_name}" Geschäftsführer OR CEO OR Inhaber OR Gründer"""

    return f"""Find the person responsible for finance management at this German company: {company_name}
{url_line}

{size_hint}

SEARCH STRATEGY:

{strategy}

IMPORTANT RULES:
- **STOP EARLY**: If you find a HIGH confidence result at any step, return immediately — skip remaining steps.
- Confidence tiers:
  HIGH: CFO, Finanzvorstand, Chief Financial Officer, Leiter Finanzen, Kaufmännischer Direktor, Finance Director
  MEDIUM: Financial Controller, Kaufmännischer Leiter, Finance Manager, Head of Finance, Treasurer
  LOW: Geschäftsführer, CEO, Inhaber, Gründer (only as fallback when no dedicated finance person found)

Return ONLY this fenced JSON block (no text after ##END##):
##JSON##
{{"nome": "First Last", "ruolo": "Exact title as found", "linkedin_url": "https://..." or null, "confidenza": "high|medium|low", "email": "address if found on a page you already read, else null", "phone": "number if found on a page you already read, else null"}}
##END##

Note: Fill `email` and `phone` ONLY if you encounter them incidentally on a page you are already reading. Do NOT run extra searches for them.

If nothing found:
##JSON##
{{"nome": null}}
##END##"""


def _build_linkedin_verify_prompt(
    company_name: str,
    person_name: str,
    role: str | None,
    linkedin_url: str,
) -> str:
    clean_name = _clean_company_name(company_name)
    role_line = role or "unknown"

    return f"""Validate a LinkedIn profile URL for a finance contact candidate.

Company: {company_name}
Search name: {clean_name}
Candidate person: {person_name}
Candidate role: {role_line}
Candidate LinkedIn URL: {linkedin_url}

TASK:
1) Run WebSearch query: "{person_name}" "{clean_name}" linkedin
2) If unclear, run ONE additional repair query:
   "{person_name}" "{clean_name}" CFO OR finance site:linkedin.com/in
3) Do NOT use WebFetch.
4) Verify whether the URL likely belongs to this person in this company context.
5) If the current URL is not reliable but a better profile URL is found, return the better URL.

Return ONLY this fenced JSON block (no text after ##END##):
##JSON##
{{"verified": true|false, "linkedin_url": "https://..." or null, "reason": "short reason"}}
##END##"""


# ---------------------------------------------------------------------------
# Parsing / validation
# ---------------------------------------------------------------------------


CONFIDENCE_VALUES = {"high", "medium", "low"}
NAME_WORD_RE = re.compile(r"^[A-Za-zÀ-ÿ'‐-]+$")
LINKEDIN_SLUG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._%-]{0,199}$")

# Keep this broad enough to avoid false negatives across IT/EN/DE variants.
FINANCE_ROLE_RE = re.compile(
    r"\b("
    r"cfo|chief\s+financial\s+officer|finance\s+director|head\s+of\s+finance|"
    r"finance\s+manager|financial\s+controller|controller|treasurer|vp\s+finance|"
    r"daf|direttor(?:e|a)\s+finanziar|responsabile\s+finanziar|"
    r"responsabile\s+amministrativ|direttor(?:e|a)\s+amministrativ|"
    r"amministrazione\s+finanza|afc|chief\s+financial\s+and\s+operating\s+officer|"
    r"chief\s+strategy\s+&\s+financial\s+officer|"
    # German variants
    r"finanzvorstand|leiter\s+finanzen|kaufm.nnischer\s+(?:leiter|direktor)|"
    r"kaufm.nnische[rs]\s+(?:leiter|direktor|gesch.ftsf.hrer)|"
    r"leiter\s+rechnungswesen|head\s+of\s+finance"
    r")\b",
    re.IGNORECASE,
)


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


def _normalize_person_name(raw: Any) -> str | None:
    if not isinstance(raw, str):
        return None
    nome = " ".join(raw.strip().split())
    if not nome:
        return None
    words = nome.split()
    if len(words) < 2 or len(words) > 5 or len(nome) > 60:
        return None
    if not all(NAME_WORD_RE.match(word) for word in words):
        return None
    return nome


def _normalize_role(raw: Any) -> str | None:
    if not isinstance(raw, str):
        return None
    ruolo = " ".join(raw.strip().split())
    if not ruolo:
        return None
    return ruolo[:180]


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


def _classify_role(role: str | None) -> RoleClass:
    if role and FINANCE_ROLE_RE.search(role):
        return "finance"
    return "non_finance_fallback"


def _derive_quality_flags(
    result: EnrichmentResult,
    *,
    verified_in_run: bool,
    fallback_not_verified_reason: str | None = None,
) -> QualityFlags:
    role_class = _classify_role(result.cfo_ruolo)
    conf = _normalize_confidence(result.confidenza)
    is_low_non_finance = (
        bool(result.cfo_nome) and conf == "low" and role_class == "non_finance_fallback"
    )

    linkedin_verified = False
    link_validation_error: str | None = None

    if result.cfo_linkedin:
        canonical, canonical_error = _canonicalize_linkedin_profile_url(result.cfo_linkedin)
        if canonical is None:
            link_validation_error = canonical_error or "invalid_linkedin_url"
        elif verified_in_run:
            linkedin_verified = True
        else:
            link_validation_error = fallback_not_verified_reason or "not_verified_in_current_run"

    return QualityFlags(
        linkedin_verified=linkedin_verified,
        role_class=role_class,
        is_low_non_finance_fallback=is_low_non_finance,
        link_validation_error=link_validation_error,
    )


def _parse_discovery_response(text: str) -> tuple[dict[str, Any], str | None]:
    payload = _extract_json_payload(text)
    if payload is None:
        return {"nome": None}, "missing_json_block"

    raw_name = payload.get("nome")
    if raw_name is None or (isinstance(raw_name, str) and not raw_name.strip()):
        return {"nome": None}, None

    nome = _normalize_person_name(raw_name)
    if not nome:
        return {"nome": None}, "invalid_name_format"

    ruolo = _normalize_role(payload.get("ruolo"))
    role_class = _classify_role(ruolo)
    confidenza = _normalize_confidence(payload.get("confidenza"))
    if confidenza is None:
        confidenza = "medium" if role_class == "finance" else "low"

    linkedin_url, link_error = _canonicalize_linkedin_profile_url(payload.get("linkedin_url"))

    email = payload.get("email")
    if not isinstance(email, str) or not email.strip():
        email = None
    else:
        email = email.strip()[:200]

    phone = payload.get("phone")
    if not isinstance(phone, str) or not phone.strip():
        phone = None
    else:
        phone = phone.strip()[:50]

    return {
        "nome": nome,
        "ruolo": ruolo,
        "linkedin_url": linkedin_url,
        "confidenza": confidenza,
        "email": email,
        "phone": phone,
    }, link_error


def _parse_linkedin_verification_response(
    text: str,
    *,
    original_url: str,
) -> tuple[bool, str | None, str | None]:
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

    # Repair path: model may return a better URL even if "verified" is false.
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
        if text and not text.startswith("##JSON##") and not text.startswith('{"nome"'):
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
    company_name: str,
    person_name: str,
    role: str | None,
    linkedin_url: str,
) -> tuple[str | None, bool, str | None, _AgentRun]:
    run = await _run_agent(
        _build_linkedin_verify_prompt(company_name, person_name, role, linkedin_url),
        allowed_tools=["WebSearch"],
    )

    verified, verified_url, verify_error = _parse_linkedin_verification_response(
        run.text,
        original_url=linkedin_url,
    )

    if not verified or not verified_url:
        return None, False, verify_error, run

    return verified_url, True, None, run


async def find_cfo(
    company_name: str,
    website_url: str,
    revenue_k: int | None = None,
    language: str = "IT",
) -> tuple[dict[str, Any], QualityFlags, float | None, dict | None, int]:
    """
    Run discover + verify flow. Returns:
      (data, quality_flags, total_cost_usd, usage, total_turns)
    cost and turns accumulate across the discovery call + LinkedIn verification call.
    """
    if language == "DE":
        discovery_prompt = _build_prompt_de(company_name, website_url, revenue_k)
    else:
        discovery_prompt = _build_prompt(company_name, website_url, revenue_k)

    discovery_run = await _run_agent(discovery_prompt, allowed_tools=["WebSearch", "WebFetch"])
    data, parse_error = _parse_discovery_response(discovery_run.text)

    total_cost = discovery_run.cost_usd
    total_turns = discovery_run.num_turns
    # Use the last non-None usage (discovery is the biggest contributor)
    total_usage = discovery_run.usage

    if not data.get("nome"):
        return (
            data,
            QualityFlags(
                linkedin_verified=False,
                role_class="non_finance_fallback",
                is_low_non_finance_fallback=False,
                link_validation_error=parse_error,
            ),
            total_cost,
            total_usage,
            total_turns,
        )

    role_class = _classify_role(cast(str | None, data.get("ruolo")))
    confidenza = _normalize_confidence(data.get("confidenza"))
    if confidenza is None:
        confidenza = "medium" if role_class == "finance" else "low"
    data["confidenza"] = confidenza

    linkedin_verified = False
    link_validation_error = parse_error

    linkedin_url = cast(str | None, data.get("linkedin_url"))
    if linkedin_url:
        print("    [verify] Checking LinkedIn URL", flush=True)
        verified_url, linkedin_verified, verify_error, verify_run = await _verify_linkedin_profile(
            company_name=company_name,
            person_name=cast(str, data["nome"]),
            role=cast(str | None, data.get("ruolo")),
            linkedin_url=linkedin_url,
        )
        # Accumulate cost from verification call
        if verify_run.cost_usd is not None:
            total_cost = (total_cost or 0.0) + verify_run.cost_usd
        total_turns += verify_run.num_turns

        if linkedin_verified and verified_url:
            data["linkedin_url"] = verified_url
            link_validation_error = None
        else:
            data["linkedin_url"] = None
            data["confidenza"] = _downgrade_confidence(cast(str, data.get("confidenza")))
            link_validation_error = verify_error or link_validation_error or "search_not_confirmed"

    is_low_non_finance_fallback = (
        data.get("confidenza") == "low" and role_class == "non_finance_fallback"
    )

    flags = QualityFlags(
        linkedin_verified=linkedin_verified,
        role_class=role_class,
        is_low_non_finance_fallback=is_low_non_finance_fallback,
        link_validation_error=link_validation_error,
    )

    return data, flags, total_cost, total_usage, total_turns


# ---------------------------------------------------------------------------
# Checkpoint I/O — same format as enricher.py
# ---------------------------------------------------------------------------


def load_checkpoint(output_dir: Path) -> dict[int, EnrichmentResult]:
    checkpoint_path = output_dir / "enrichment_progress.jsonl"
    done: dict[int, EnrichmentResult] = {}
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
                # Backward compat: ignore unknown keys, fill missing optional keys with None
                filtered = {k: v for k, v in d.items() if k in _fields}
                done[d["rank"]] = EnrichmentResult(**filtered)
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

ENRICHMENT_COLS = [
    "CFO_NOME",
    "CFO_RUOLO",
    "CFO_LINKEDIN",
    "CFO_EMAIL",
    "CFO_TELEFONO",
    "FONTE",
    "CONFIDENZA",
    "DATA_RICERCA",
]


def load_input_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def load_input_jsonl(path: Path) -> list[dict[str, str]]:
    """Load Wachstumschampions JSONL and normalize to enricher's internal dict format."""
    rows: list[dict[str, str]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            rows.append(
                {
                    "RANK": str(rec.get("national_rank", "")),
                    "AZIENDA": rec.get("company_name", ""),
                    "SITO WEB": rec.get("website", "") or "",
                    "RICAVI_RAW": str(rec.get("revenue_year_b_eur", "")),  # EUR, not k€
                    "SETTORE": rec.get("sector", ""),
                    "REGIONE": rec.get("region", ""),
                    "COUNTRY": rec.get("country", "DE"),
                    "CITY": rec.get("city", ""),
                    "TASSO DI CRESCITA": str(rec.get("growth_rate_pa_pct", "")),
                }
            )
    return rows


def load_input_file(path: Path) -> list[dict[str, str]]:
    """Dispatch to CSV or JSONL loader based on file extension."""
    if path.suffix.lower() == ".jsonl":
        return load_input_jsonl(path)
    return load_input_csv(path)


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
                enriched["CFO_EMAIL"] = result.cfo_email or ""
                enriched["CFO_TELEFONO"] = result.cfo_telefono or ""
                enriched["FONTE"] = result.fonte
                enriched["CONFIDENZA"] = result.confidenza or ""
                enriched["DATA_RICERCA"] = result.data_ricerca
            else:
                for col in ENRICHMENT_COLS:
                    enriched[col] = ""
            writer.writerow(enriched)

    print(f"\nScritto: {out_path}")


def write_quality_report(
    output_dir: Path,
    companies: list[dict[str, str]],
    results: dict[int, EnrichmentResult],
    quality_flags_by_rank: dict[int, QualityFlags],
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    records: list[dict[str, Any]] = []
    flagged_records: list[dict[str, Any]] = []

    found = 0
    not_found = 0
    with_linkedin = 0
    linkedin_verified_count = 0
    finance_role_count = 0
    non_finance_fallback_count = 0
    low_non_finance_fallback_count = 0

    for company in companies:
        rank = int(company.get("RANK", 0))
        result = results.get(rank)
        if result is None:
            continue

        flags = quality_flags_by_rank.get(rank) or _derive_quality_flags(
            result,
            verified_in_run=False,
        )

        if result.cfo_nome:
            found += 1
        else:
            not_found += 1

        if result.cfo_linkedin:
            with_linkedin += 1

        if flags.linkedin_verified:
            linkedin_verified_count += 1

        if flags.role_class == "finance":
            finance_role_count += 1
        else:
            non_finance_fallback_count += 1

        if flags.is_low_non_finance_fallback:
            low_non_finance_fallback_count += 1

        record = {
            "rank": rank,
            "azienda": result.azienda,
            "cfo_nome": result.cfo_nome,
            "cfo_ruolo": result.cfo_ruolo,
            "cfo_linkedin": result.cfo_linkedin,
            "confidenza": result.confidenza,
            "fonte": result.fonte,
            "linkedin_verified": flags.linkedin_verified,
            "role_class": flags.role_class,
            "is_low_non_finance_fallback": flags.is_low_non_finance_fallback,
            "link_validation_error": flags.link_validation_error,
        }
        records.append(record)

        if flags.is_low_non_finance_fallback or flags.link_validation_error:
            flagged_records.append(record)

    summary = {
        "total_rows": len(records),
        "found": found,
        "not_found": not_found,
        "with_linkedin": with_linkedin,
        "linkedin_verified": linkedin_verified_count,
        "finance_role_count": finance_role_count,
        "non_finance_fallback_count": non_finance_fallback_count,
        "low_non_finance_fallback_count": low_non_finance_fallback_count,
        "flagged_count": len(flagged_records),
    }

    payload = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "year": RUN_YEAR,
        "summary": summary,
        "flagged_records": flagged_records,
        "records": records,
    }

    report_path = output_dir / "enrichment_quality_report.json"
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Scritto: {report_path}")


RATE_LIMIT_PATTERNS = ("429", "rate limit", "too many requests", "throttle")


def is_rate_limit_error(exc_or_msg: Any) -> bool:
    text = str(exc_or_msg).lower()
    return any(pattern in text for pattern in RATE_LIMIT_PATTERNS)


def build_result(rank: int, company_name: str, data: dict[str, Any]) -> EnrichmentResult:
    cfo_nome = data.get("nome")
    if cfo_nome and not isinstance(cfo_nome, str):
        cfo_nome = None

    confidenza = _normalize_confidence(data.get("confidenza")) if cfo_nome else None
    if cfo_nome and confidenza is None:
        confidenza = "low"

    linkedin_url = None
    if cfo_nome:
        linkedin_url, _ = _canonicalize_linkedin_profile_url(data.get("linkedin_url"))

    cfo_email = None
    cfo_telefono = None
    if cfo_nome:
        raw_email = data.get("email")
        if isinstance(raw_email, str) and raw_email.strip():
            cfo_email = raw_email.strip()[:200]
        raw_phone = data.get("phone")
        if isinstance(raw_phone, str) and raw_phone.strip():
            cfo_telefono = raw_phone.strip()[:50]

    return EnrichmentResult(
        rank=rank,
        azienda=company_name,
        cfo_nome=cfo_nome,
        cfo_ruolo=_normalize_role(data.get("ruolo")) if cfo_nome else None,
        cfo_linkedin=linkedin_url,
        fonte="agent" if cfo_nome else "not_found",
        confidenza=confidenza,
        data_ricerca=date.today().isoformat(),
        cfo_email=cfo_email,
        cfo_telefono=cfo_telefono,
    )


def _parse_revenue(company: dict[str, str]) -> int | None:
    """Extract revenue in thousands € from company dict.

    JSONL path: RICAVI_RAW is in EUR — divides by 1000.
    CSV path: RICAVI {year} columns are already in k€.
    """
    raw = company.get("RICAVI_RAW")
    if raw:
        try:
            return int(float(raw)) // 1000
        except ValueError, TypeError:
            pass
    for key in sorted(company.keys(), reverse=True):
        if key.startswith("RICAVI"):
            try:
                return int(company[key])
            except ValueError, TypeError:
                pass
    return None


async def process_company(
    company: dict[str, str],
    max_retries: int = RUN_MAX_RETRIES,
    retry_base_delay: float = RUN_RETRY_BASE_DELAY,
) -> CompanyOutcome:
    rank = int(company.get("RANK", 0))
    name = company.get("AZIENDA", "?")
    url = company.get("SITO WEB", "")
    revenue_k = _parse_revenue(company)
    language = company.get("COUNTRY", "IT")
    if language not in ("DE",):
        language = "IT"

    start_ts = time.monotonic()
    max_attempts = max(1, max_retries)
    had_rate_limit = False
    last_error: Exception | None = None

    for attempt in range(1, max_attempts + 1):
        print(f"  Rank {rank} | tentativo {attempt}/{max_attempts}: {name}", flush=True)
        try:
            data, quality_flags, cost_usd, usage, tool_calls = await find_cfo(
                name, url, revenue_k, language
            )
            result = build_result(rank, name, data)
            if not result.cfo_nome:
                quality_flags = _derive_quality_flags(
                    result,
                    verified_in_run=False,
                    fallback_not_verified_reason=quality_flags.link_validation_error,
                )

            return CompanyOutcome(
                result=result,
                quality_flags=quality_flags,
                rank=rank,
                had_rate_limit=had_rate_limit,
                attempts=attempt,
                elapsed_s=time.monotonic() - start_ts,
                cost_usd=cost_usd,
                usage=usage,
                tool_calls=tool_calls,
                website=url,
                country=language,
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
        quality_flags=_derive_quality_flags(result, verified_in_run=False),
        rank=rank,
        had_rate_limit=had_rate_limit,
        attempts=max_attempts,
        elapsed_s=time.monotonic() - start_ts,
        website=url,
        country=language,
    )


# ---------------------------------------------------------------------------
# Targeted LinkedIn search (re-process)
# ---------------------------------------------------------------------------


def _build_linkedin_search_prompt(company_name: str, person_name: str, role: str | None) -> str:
    clean_name = _clean_company_name(company_name)
    role_line = role or "finance / leadership"
    return f"""Find the LinkedIn profile of {person_name}, {role_line} at {company_name}.

SEARCH STRATEGY:
Step 1: WebSearch: "{person_name}" "{clean_name}" site:linkedin.com/in
Step 2 (only if Step 1 inconclusive): WebSearch: "{person_name}" "{clean_name}" linkedin

RULES:
- Use WebSearch only. Do NOT use WebFetch.
- Stop as soon as you find a plausible profile URL.

Return ONLY this fenced JSON block (no text after ##END##):
##JSON##
{{"linkedin_url": "https://www.linkedin.com/in/..." or null, "confidence": 0.8, "reason": "brief reason"}}
##END##"""


async def find_linkedin(
    company_name: str,
    person_name: str,
    role: str | None,
) -> tuple[str | None, float | None, dict | None]:
    """Targeted LinkedIn search for a known person. Returns (linkedin_url, cost_usd, usage)."""
    run = await _run_agent(
        _build_linkedin_search_prompt(company_name, person_name, role),
        allowed_tools=["WebSearch"],
    )

    payload = _extract_json_payload(run.text)
    if not payload:
        return None, run.cost_usd, run.usage

    raw_url = payload.get("linkedin_url")
    if raw_url is None:
        return None, run.cost_usd, run.usage

    url, error = _canonicalize_linkedin_profile_url(raw_url)
    if error:
        return None, run.cost_usd, run.usage

    return url, run.cost_usd, run.usage


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


async def run_enrichment(
    input_path: Path | None = None,
    output_dir: Path = Path("output"),
    companies: list[dict[str, str]] | None = None,
    reset: bool = False,
    max_concurrency: int = RUN_MAX_CONCURRENCY,
    max_retries: int = RUN_MAX_RETRIES,
    retry_base_delay: float = RUN_RETRY_BASE_DELAY,
    on_company_done: Callable[[CompanyOutcome, int, int], None] | None = None,
) -> dict[str, Any]:
    """
    Run enrichment on input_path or inline companies list, writing output to output_dir.
    Calls on_company_done(outcome, completed, total) after each company completes.
    Returns a summary dict with cost, timing, and result counts.
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    if companies is None:
        if input_path is None:
            raise ValueError("Either input_path or companies must be provided")
        companies = load_input_file(input_path)
        print(f"Caricate {len(companies)} aziende da {input_path}")
    else:
        print(f"Ricevute {len(companies)} aziende inline")
    print(f"Modello: {MODEL}")
    print(f"Worker paralleli: {max_concurrency}")

    done: dict[int, EnrichmentResult] = {}
    quality_flags_by_rank: dict[int, QualityFlags] = {}

    if not reset:
        done = load_checkpoint(output_dir)
        if done:
            print(f"Checkpoint: {len(done)} aziende già processate, riprendo dal resto.")
            quality_flags_by_rank = {
                rank: _derive_quality_flags(result, verified_in_run=False)
                for rank, result in done.items()
            }
    else:
        checkpoint_path = output_dir / "enrichment_progress.jsonl"
        if checkpoint_path.exists():
            checkpoint_path.unlink()
            print("Checkpoint rimosso, ricomincio da capo.")

    pending = [c for c in companies if int(c.get("RANK", 0)) not in done]
    print(f"Da processare: {len(pending)} aziende\n")

    if not pending:
        write_enriched_csv(output_dir, companies, done)
        write_quality_report(output_dir, companies, done, quality_flags_by_rank)
        return {"total": 0, "found": 0, "pct": 0, "total_cost_usd": 0.0, "elapsed_s": 0.0}

    run_start_ts = time.monotonic()
    sem = asyncio.Semaphore(max_concurrency)
    checkpoint_lock = asyncio.Lock()
    progress: dict[str, Any] = {"completed": 0, "found": 0, "rate_limits": 0, "total_cost_usd": 0.0}

    async def worker(company: dict[str, str]) -> CompanyOutcome:
        async with sem:
            outcome = await process_company(
                company, max_retries=max_retries, retry_base_delay=retry_base_delay
            )

        async with checkpoint_lock:
            done[outcome.rank] = outcome.result
            quality_flags_by_rank[outcome.rank] = outcome.quality_flags
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

            if outcome.result.cfo_nome:
                progress["found"] += 1
                print(
                    f"  => [{n}/{total}] Rank {outcome.rank} OK ({outcome.result.confidenza}) "
                    f"{outcome.result.cfo_nome} — {outcome.result.cfo_ruolo}"
                    f"{cost_str}{tokens_str}{turns_str}"
                )
            else:
                print(
                    f"  => [{n}/{total}] Rank {outcome.rank} non trovato{cost_str}{tokens_str}{turns_str}"
                )

            if on_company_done:
                on_company_done(outcome, progress["completed"], len(pending))

        return outcome

    tasks = [asyncio.create_task(worker(c)) for c in pending]
    await asyncio.gather(*tasks)

    write_enriched_csv(output_dir, companies, done)
    write_quality_report(output_dir, companies, done, quality_flags_by_rank)

    total_elapsed_s = time.monotonic() - run_start_ts
    found = progress["found"]
    total = len(pending)
    pct = 100 * found // total if total else 0
    total_cost = progress["total_cost_usd"]

    print(f"\nTempo run: {total_elapsed_s:.1f}s")
    print(f"Risultati: {found}/{total} aziende con CFO identificato ({pct}%)")
    if total_cost > 0:
        print(f"Costo totale: ${total_cost:.4f} (media ${total_cost / total:.4f}/azienda)")
    if progress["rate_limits"]:
        print(f"Rate-limit retries: {progress['rate_limits']}")

    for conf in ("high", "medium", "low"):
        count = sum(1 for r in done.values() if r.confidenza == conf)
        if count:
            print(f"  {conf}: {count}")

    not_found = sum(1 for r in done.values() if not r.cfo_nome)
    if not_found:
        print(f"  not_found: {not_found}")

    verified = sum(1 for f in quality_flags_by_rank.values() if f.linkedin_verified)
    low_non_finance = sum(
        1 for f in quality_flags_by_rank.values() if f.is_low_non_finance_fallback
    )
    print(f"  linkedin_verified: {verified}")
    print(f"  low_non_finance_fallback: {low_non_finance}")

    return {
        "total": total,
        "found": found,
        "pct": pct,
        "total_cost_usd": total_cost,
        "elapsed_s": total_elapsed_s,
        "rate_limits": progress["rate_limits"],
    }


async def main() -> None:
    if RUN_INPUT:
        input_path = Path(RUN_INPUT)
    else:
        script_dir = Path(__file__).parent
        input_path = script_dir / "data" / f"{RUN_YEAR}.csv"

    if not input_path.exists():
        print(f"Errore: file non trovato: {input_path}", file=sys.stderr)
        sys.exit(1)

    if RUN_OUTPUT_DIR:
        output_dir = Path(RUN_OUTPUT_DIR)
    else:
        script_dir = Path(__file__).parent
        output_dir = script_dir / "output" / str(RUN_YEAR)

    await run_enrichment(
        input_path=input_path,
        output_dir=output_dir,
        reset=RUN_RESET,
        max_concurrency=RUN_MAX_CONCURRENCY,
        max_retries=RUN_MAX_RETRIES,
        retry_base_delay=RUN_RETRY_BASE_DELAY,
    )


if __name__ == "__main__":
    asyncio.run(main())
