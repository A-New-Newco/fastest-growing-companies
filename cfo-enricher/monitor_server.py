"""
CFO Enricher monitoring server.

Wraps agent_enricher.run_enrichment() and streams real-time progress
via Server-Sent Events (SSE) to the Next.js dashboard.

Start:
    uv run python monitor_server.py   (or via start.sh)

Endpoints:
    GET  /api/enrichment/status   — current run state (JSON)
    POST /api/enrichment/start    — start a new run
    POST /api/enrichment/stop     — cancel current run
    GET  /api/enrichment/stream   — SSE event stream
"""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
from starlette.requests import Request

import run_state as rs
from agent_enricher import CompanyOutcome, find_linkedin, run_enrichment, save_checkpoint_row

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="CFO Enricher Monitor", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Preset datasets — shown in the UI dropdown
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).parent
PARENT_DIR = SCRIPT_DIR.parent

DATASETS = [
    {
        "id": "it_2026",
        "label": "Italy 2026 (CSV)",
        "input_path": str(SCRIPT_DIR / "data" / "2026.csv"),
        "output_dir": str(SCRIPT_DIR / "output" / "2026"),
        "country_code": "IT",
        "year": 2026,
    },
    {
        "id": "de_2026",
        "label": "Germany 2026 — Wachstumschampions (JSONL)",
        "input_path": str(
            PARENT_DIR / "focus-wachstumschampions" / "output" / "wachstumschampions_companies.compact.en.jsonl"
        ),
        "output_dir": str(
            PARENT_DIR / "focus-wachstumschampions" / "output" / "enriched"
        ),
        "country_code": "DE",
        "year": 2026,
    },
]

# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class StartRequest(BaseModel):
    dataset_id: str | None = None      # preset ID from DATASETS
    input_path: str | None = None      # override: custom input file path
    output_dir: str | None = None      # override: custom output directory
    max_concurrency: int = 8
    reset: bool = False


# ---------------------------------------------------------------------------
# SSE helpers
# ---------------------------------------------------------------------------


async def _event_generator(request: Request) -> Any:
    """Yield SSE events from the state event queue until client disconnects."""
    while True:
        if await request.is_disconnected():
            break
        try:
            event = await asyncio.wait_for(rs.state.event_queue.get(), timeout=15.0)
            yield {"event": event["type"], "data": json.dumps(event["data"])}
        except asyncio.TimeoutError:
            # Send keepalive ping
            yield {"event": "ping", "data": "{}"}


# ---------------------------------------------------------------------------
# Enrichment callback (called by run_enrichment after each company)
# ---------------------------------------------------------------------------


def _on_company_done(outcome: CompanyOutcome, completed: int, total: int) -> None:
    state = rs.state

    result = outcome.result
    usage = outcome.usage or {}

    company_event: dict[str, Any] = {
        "rank": outcome.rank,
        "azienda": result.azienda,
        "website": outcome.website,
        "country": outcome.country,
        "cfo_nome": result.cfo_nome,
        "cfo_ruolo": result.cfo_ruolo,
        "cfo_linkedin": result.cfo_linkedin,
        "cfo_email": result.cfo_email,
        "cfo_telefono": result.cfo_telefono,
        "confidenza": result.confidenza,
        "cost_usd": round(outcome.cost_usd, 6) if outcome.cost_usd is not None else None,
        "input_tokens": usage.get("input_tokens"),
        "output_tokens": usage.get("output_tokens"),
        "tool_calls": outcome.tool_calls,
        "elapsed_s": round(outcome.elapsed_s, 2),
        "had_rate_limit": outcome.had_rate_limit,
    }

    state.completed = completed
    if result.cfo_nome:
        state.found += 1
    else:
        state.not_found += 1
    if outcome.had_rate_limit:
        state.rate_limits += 1
    if outcome.cost_usd is not None:
        state.total_cost_usd += outcome.cost_usd

    state.results.append(company_event)

    # Push two events: per-company result + aggregate progress
    state.event_queue.put_nowait({"type": "company", "data": company_event})
    state.event_queue.put_nowait({
        "type": "progress",
        "data": {
            "completed": state.completed,
            "total": state.total,
            "found": state.found,
            "not_found": state.not_found,
            "rate_limits": state.rate_limits,
            "total_cost_usd": round(state.total_cost_usd, 6),
            "elapsed_s": round(time.monotonic() - state.start_time, 1),
        },
    })


# ---------------------------------------------------------------------------
# Background enrichment task
# ---------------------------------------------------------------------------


async def _run_task(input_path: Path, output_dir: Path, max_concurrency: int, reset: bool) -> None:
    state = rs.state
    try:
        summary = await run_enrichment(
            input_path=input_path,
            output_dir=output_dir,
            reset=reset,
            max_concurrency=max_concurrency,
            on_company_done=_on_company_done,
        )
        state.status = "completed"
        state.elapsed_s = summary.get("elapsed_s", 0.0)
        state.event_queue.put_nowait({"type": "done", "data": summary})
    except asyncio.CancelledError:
        state.status = "idle"
        state.event_queue.put_nowait({"type": "done", "data": {"cancelled": True}})
    except Exception as exc:
        state.status = "error"
        state.error_message = str(exc)
        state.event_queue.put_nowait({"type": "error", "data": {"message": str(exc)}})
    finally:
        state.start_time = 0.0


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/api/enrichment/datasets")
def get_datasets() -> list[dict]:
    return DATASETS


@app.get("/api/enrichment/status")
def get_status() -> dict:
    return rs.state.to_status_dict()


@app.post("/api/enrichment/start")
async def start_enrichment(req: StartRequest) -> dict:
    if rs.state.status == "running":
        raise HTTPException(status_code=409, detail="A run is already in progress")

    # Resolve input/output from preset or overrides
    if req.dataset_id:
        preset = next((d for d in DATASETS if d["id"] == req.dataset_id), None)
        if not preset:
            raise HTTPException(status_code=400, detail=f"Unknown dataset_id: {req.dataset_id}")
        input_path = Path(req.input_path or preset["input_path"])
        output_dir = Path(req.output_dir or preset["output_dir"])
    elif req.input_path:
        input_path = Path(req.input_path)
        output_dir = Path(req.output_dir) if req.output_dir else input_path.parent / "enriched"
    else:
        raise HTTPException(status_code=400, detail="Provide dataset_id or input_path")

    if not input_path.exists():
        raise HTTPException(status_code=400, detail=f"Input file not found: {input_path}")

    # Reset state
    rs.state.reset()
    rs.state.status = "running"
    rs.state.input_path = str(input_path)
    rs.state.output_dir = str(output_dir)
    rs.state.dataset_id = req.dataset_id or ""
    rs.state.country_code = preset["country_code"] if req.dataset_id and preset else "IT"
    rs.state.year = preset["year"] if req.dataset_id and preset else 2026
    rs.state.start_time = time.monotonic()

    # Count total companies (quick peek)
    try:
        if input_path.suffix.lower() == ".jsonl":
            with input_path.open("r", encoding="utf-8") as f:
                rs.state.total = sum(1 for line in f if line.strip())
        else:
            import csv
            with input_path.open("r", encoding="utf-8-sig") as f:
                rs.state.total = sum(1 for _ in csv.DictReader(f))
    except Exception:
        rs.state.total = 0

    # Launch background task
    task = asyncio.create_task(
        _run_task(input_path, output_dir, req.max_concurrency, req.reset)
    )
    rs.state._task = task

    return {"status": "started", "input_path": str(input_path), "total": rs.state.total}


@app.post("/api/enrichment/stop")
async def stop_enrichment() -> dict:
    if rs.state.status != "running" or rs.state._task is None:
        raise HTTPException(status_code=409, detail="No run in progress")
    rs.state._task.cancel()
    return {"status": "stopping"}


@app.get("/api/enrichment/stream")
async def stream_events(request: Request) -> EventSourceResponse:
    return EventSourceResponse(_event_generator(request))


@app.get("/api/enrichment/results")
def get_results() -> list[dict]:
    return rs.state.results


# ---------------------------------------------------------------------------
# Reprocess — targeted LinkedIn search for known contacts
# ---------------------------------------------------------------------------


class ReprocessCompany(BaseModel):
    rank: int
    azienda: str
    cfo_nome: str
    cfo_ruolo: str | None = None
    website: str | None = None
    country: str = "IT"


class ReprocessRequest(BaseModel):
    companies: list[ReprocessCompany]


async def _reprocess_task(companies: list[ReprocessCompany]) -> None:
    state = rs.state
    output_dir = Path(state.output_dir) if state.output_dir else None

    for company in companies:
        try:
            linkedin_url, cost_usd, usage = await find_linkedin(
                company.azienda, company.cfo_nome, company.cfo_ruolo
            )
        except Exception as exc:
            print(f"    [reprocess] Rank {company.rank}: error — {exc}", flush=True)
            continue

        if not linkedin_url:
            print(f"    [reprocess] Rank {company.rank}: no LinkedIn found", flush=True)
            continue

        print(f"    [reprocess] Rank {company.rank}: found {linkedin_url}", flush=True)

        # Update in-memory results
        for r in state.results:
            if r.get("rank") == company.rank:
                r["cfo_linkedin"] = linkedin_url
                break

        # Update checkpoint file
        if output_dir:
            from agent_enricher import EnrichmentResult
            from datetime import date
            # Overwrite by appending (load_checkpoint uses last occurrence)
            save_checkpoint_row(
                output_dir,
                EnrichmentResult(
                    rank=company.rank,
                    azienda=company.azienda,
                    cfo_nome=company.cfo_nome,
                    cfo_ruolo=company.cfo_ruolo,
                    cfo_linkedin=linkedin_url,
                    fonte="agent",
                    confidenza="medium",
                    data_ricerca=date.today().isoformat(),
                ),
            )

        # Push updated company event via SSE
        updated: dict[str, Any] = {
            "rank": company.rank,
            "azienda": company.azienda,
            "website": company.website,
            "country": company.country,
            "cfo_nome": company.cfo_nome,
            "cfo_ruolo": company.cfo_ruolo,
            "cfo_linkedin": linkedin_url,
            "cfo_email": None,
            "cfo_telefono": None,
            "confidenza": "medium",
            "cost_usd": round(cost_usd, 6) if cost_usd is not None else None,
            "input_tokens": (usage or {}).get("input_tokens"),
            "output_tokens": (usage or {}).get("output_tokens"),
            "tool_calls": 0,
            "elapsed_s": 0.0,
            "had_rate_limit": False,
            "is_reprocess": True,
        }
        state.event_queue.put_nowait({"type": "company", "data": updated})


@app.post("/api/enrichment/reprocess")
async def reprocess_linkedin(req: ReprocessRequest) -> dict:
    if rs.state.status == "running":
        raise HTTPException(status_code=409, detail="A run is already in progress")
    if not req.companies:
        raise HTTPException(status_code=400, detail="No companies provided")
    asyncio.create_task(_reprocess_task(req.companies))
    return {"status": "started", "count": len(req.companies)}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8765, log_level="info")
