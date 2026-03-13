"""
Singleton run state for the LinkedIn enricher monitoring server.
Shared between the FastAPI endpoints and the enrichment worker tasks.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Literal

RunStatus = Literal["idle", "running", "completed", "error"]


@dataclass
class RunState:
    status: RunStatus = "idle"
    output_dir: str = ""
    total: int = 0
    completed: int = 0
    found: int = 0
    not_found: int = 0
    rate_limits: int = 0
    total_cost_usd: float = 0.0
    start_time: float = 0.0
    elapsed_s: float = 0.0
    error_message: str | None = None
    results: list[dict[str, Any]] = field(default_factory=list)
    # SSE event queue — consumers drain this
    event_queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    # Cancellation token
    _task: asyncio.Task | None = field(default=None, repr=False)

    def reset(self) -> None:
        self.status = "idle"
        self.output_dir = ""
        self.total = 0
        self.completed = 0
        self.found = 0
        self.not_found = 0
        self.rate_limits = 0
        self.total_cost_usd = 0.0
        self.start_time = 0.0
        self.elapsed_s = 0.0
        self.error_message = None
        self.results = []
        self.event_queue = asyncio.Queue()
        self._task = None

    def to_status_dict(self) -> dict[str, Any]:
        elapsed = time.monotonic() - self.start_time if self.start_time else self.elapsed_s
        return {
            "status": self.status,
            "output_dir": self.output_dir,
            "total": self.total,
            "completed": self.completed,
            "found": self.found,
            "not_found": self.not_found,
            "rate_limits": self.rate_limits,
            "total_cost_usd": round(self.total_cost_usd, 6),
            "elapsed_s": round(elapsed, 1),
            "error_message": self.error_message,
        }


# Module-level singleton — imported by monitor_server.py
state = RunState()
