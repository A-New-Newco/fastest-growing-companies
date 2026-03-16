"""
LinkedIn Enricher monitoring server.

Wraps agent_enricher.run_enrichment() and streams real-time progress
via Server-Sent Events (SSE) to the Next.js dashboard.

Start:
    uv run python monitor_server.py   (or via start.sh)

Endpoints:
    GET  /api/linkedin/status   — current run state (JSON)
    POST /api/linkedin/start    — start a new run (contacts via JSON body)
    POST /api/linkedin/stop     — cancel current run
    GET  /api/linkedin/stream   — SSE event stream
    GET  /api/linkedin/results  — current run results
    GET  /api/linkedin/history  — persisted monitor events
    POST /api/linkedin/reprocess — re-search specific contacts
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
from agent_enricher import ContactOutcome, find_linkedin, run_enrichment, save_checkpoint_row

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="LinkedIn Enricher Monitor", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SCRIPT_DIR = Path(__file__).parent

# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class ContactInput(BaseModel):
    id: str
    nome: str
    ruolo: str | None = None
    azienda: str
    sito_web: str | None = None
    data_origin: str = "curated"


class StartRequest(BaseModel):
    contacts: list[ContactInput]
    max_concurrency: int = 8
    reset: bool = False
    run_id: str | None = None  # optional ID for output dir naming


class ReprocessContact(BaseModel):
    id: str
    nome: str
    ruolo: str | None = None
    azienda: str
    sito_web: str | None = None


class ReprocessRequest(BaseModel):
    contacts: list[ReprocessContact]


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
            yield {"event": "ping", "data": "{}"}


# ---------------------------------------------------------------------------
# Monitor event persistence
# ---------------------------------------------------------------------------

MONITOR_EVENTS_FILE = "monitor_events.jsonl"


def _save_monitor_event(output_dir: str, event: dict[str, Any]) -> None:
    """Append a contact event (with full metadata) to monitor_events.jsonl."""
    try:
        path = Path(output_dir) / MONITOR_EVENTS_FILE
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
    except Exception as exc:
        print(f"[monitor] Failed to save monitor event: {exc}", flush=True)


def _load_monitor_events(output_dir: str) -> list[dict[str, Any]]:
    """Load all persisted monitor events from monitor_events.jsonl."""
    path = Path(output_dir) / MONITOR_EVENTS_FILE
    if not path.exists():
        return []
    events: list[dict[str, Any]] = []
    seen: dict[str, int] = {}  # id → index in events
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                evt = json.loads(line)
                contact_id = evt.get("id")
                if contact_id is not None:
                    if contact_id in seen:
                        events[seen[contact_id]] = evt
                    else:
                        seen[contact_id] = len(events)
                        events.append(evt)
            except Exception:
                pass
    return events


# ---------------------------------------------------------------------------
# Enrichment callback
# ---------------------------------------------------------------------------


def _on_contact_done(outcome: ContactOutcome, completed: int, total: int) -> None:
    state = rs.state

    result = outcome.result
    usage = outcome.usage or {}

    contact_event: dict[str, Any] = {
        "id": outcome.id,
        "nome": result.nome,
        "ruolo": outcome.ruolo,
        "azienda": result.azienda,
        "sito_web": outcome.sito_web,
        "linkedin_url": result.linkedin_url,
        "confidenza": result.confidenza,
        "cost_usd": round(outcome.cost_usd, 6) if outcome.cost_usd is not None else None,
        "input_tokens": usage.get("input_tokens"),
        "output_tokens": usage.get("output_tokens"),
        "tool_calls": outcome.tool_calls,
        "elapsed_s": round(outcome.elapsed_s, 2),
        "had_rate_limit": outcome.had_rate_limit,
    }

    if state.output_dir:
        _save_monitor_event(state.output_dir, contact_event)

    state.completed = completed
    if result.linkedin_url:
        state.found += 1
    else:
        state.not_found += 1
    if outcome.had_rate_limit:
        state.rate_limits += 1
    if outcome.cost_usd is not None:
        state.total_cost_usd += outcome.cost_usd

    state.results.append(contact_event)

    state.event_queue.put_nowait({"type": "contact", "data": contact_event})
    state.event_queue.put_nowait(
        {
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
        }
    )


# ---------------------------------------------------------------------------
# Background enrichment task
# ---------------------------------------------------------------------------


async def _run_task(
    contacts: list[dict[str, str]], output_dir: Path, max_concurrency: int, reset: bool
) -> None:
    state = rs.state
    try:
        summary = await run_enrichment(
            contacts=contacts,
            output_dir=output_dir,
            reset=reset,
            max_concurrency=max_concurrency,
            on_contact_done=_on_contact_done,
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


@app.get("/api/linkedin/status")
def get_status() -> dict:
    return rs.state.to_status_dict()


@app.post("/api/linkedin/start")
async def start_enrichment(req: StartRequest) -> dict:
    if rs.state.status == "running":
        raise HTTPException(status_code=409, detail="A run is already in progress")

    if not req.contacts:
        raise HTTPException(status_code=400, detail="No contacts provided")

    # Convert Pydantic models to dicts for the enricher
    contacts = [
        {
            "ID": c.id,
            "NOME": c.nome,
            "RUOLO": c.ruolo or "",
            "AZIENDA": c.azienda,
            "SITO_WEB": c.sito_web or "",
            "DATA_ORIGIN": c.data_origin,
        }
        for c in req.contacts
    ]

    run_id = req.run_id or "run"
    output_dir = SCRIPT_DIR / "output" / run_id

    if req.reset:
        monitor_file = output_dir / MONITOR_EVENTS_FILE
        if monitor_file.exists():
            monitor_file.unlink()

    rs.state.reset()
    rs.state.status = "running"
    rs.state.output_dir = str(output_dir)
    rs.state.total = len(contacts)
    rs.state.start_time = time.monotonic()

    task = asyncio.create_task(_run_task(contacts, output_dir, req.max_concurrency, req.reset))
    rs.state._task = task

    return {"status": "started", "total": len(contacts)}


@app.post("/api/linkedin/stop")
async def stop_enrichment() -> dict:
    if rs.state.status != "running" or rs.state._task is None:
        raise HTTPException(status_code=409, detail="No run in progress")
    rs.state._task.cancel()
    return {"status": "stopping"}


@app.get("/api/linkedin/stream")
async def stream_events(request: Request) -> EventSourceResponse:
    return EventSourceResponse(_event_generator(request))


@app.get("/api/linkedin/results")
def get_results() -> list[dict]:
    return rs.state.results


@app.get("/api/linkedin/history")
def get_history() -> list[dict]:
    """Return all persisted monitor events (survives restarts)."""
    output_dir = rs.state.output_dir
    if not output_dir:
        # Try default run dir
        default_dir = SCRIPT_DIR / "output" / "run"
        if default_dir.exists():
            return _load_monitor_events(str(default_dir))
        return []
    return _load_monitor_events(output_dir)


# ---------------------------------------------------------------------------
# Reprocess — targeted LinkedIn search for specific contacts
# ---------------------------------------------------------------------------


async def _reprocess_task(contacts: list[ReprocessContact]) -> None:
    state = rs.state
    output_dir = Path(state.output_dir) if state.output_dir else None

    for contact in contacts:
        try:
            linkedin_url, _quality, _conf, cost_usd, usage, _turns = await find_linkedin(
                contact.nome, contact.ruolo, contact.azienda, contact.sito_web
            )
        except Exception as exc:
            print(f"    [reprocess] ID {contact.id[:8]}: error — {exc}", flush=True)
            continue

        if not linkedin_url:
            print(f"    [reprocess] ID {contact.id[:8]}: no LinkedIn found", flush=True)
            continue

        print(f"    [reprocess] ID {contact.id[:8]}: found {linkedin_url}", flush=True)

        # Update in-memory results
        for r in state.results:
            if r.get("id") == contact.id:
                r["linkedin_url"] = linkedin_url
                break

        # Update checkpoint
        if output_dir:
            from agent_enricher import EnrichmentResult
            from datetime import date

            save_checkpoint_row(
                output_dir,
                EnrichmentResult(
                    id=contact.id,
                    nome=contact.nome,
                    azienda=contact.azienda,
                    linkedin_url=linkedin_url,
                    fonte="agent",
                    confidenza="medium",
                    data_ricerca=date.today().isoformat(),
                ),
            )

        updated: dict[str, Any] = {
            "id": contact.id,
            "nome": contact.nome,
            "ruolo": contact.ruolo,
            "azienda": contact.azienda,
            "sito_web": contact.sito_web,
            "linkedin_url": linkedin_url,
            "confidenza": "medium",
            "cost_usd": round(cost_usd, 6) if cost_usd is not None else None,
            "input_tokens": (usage or {}).get("input_tokens"),
            "output_tokens": (usage or {}).get("output_tokens"),
            "tool_calls": 0,
            "elapsed_s": 0.0,
            "had_rate_limit": False,
            "is_reprocess": True,
        }

        if state.output_dir:
            _save_monitor_event(state.output_dir, updated)

        state.event_queue.put_nowait({"type": "contact", "data": updated})


@app.post("/api/linkedin/reprocess")
async def reprocess_linkedin(req: ReprocessRequest) -> dict:
    if rs.state.status == "running":
        raise HTTPException(status_code=409, detail="A run is already in progress")
    if not req.contacts:
        raise HTTPException(status_code=400, detail="No contacts provided")
    asyncio.create_task(_reprocess_task(req.contacts))
    return {"status": "started", "count": len(req.contacts)}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8766, log_level="info")
