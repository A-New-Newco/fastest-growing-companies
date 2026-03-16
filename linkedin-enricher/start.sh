#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "Starting LinkedIn Enricher Monitor on http://localhost:8766"
cd "$SCRIPT_DIR"
uv run python monitor_server.py
