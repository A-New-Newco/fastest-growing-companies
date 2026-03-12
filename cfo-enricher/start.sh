#!/bin/bash
# Start the CFO Enricher monitoring server.
# Run `npm run dev` in the dashboard directory separately, then open:
#   http://localhost:3000/cfo-monitor

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Starting CFO Enricher Monitor on http://localhost:8765"
echo "Open dashboard at: http://localhost:3000/cfo-monitor"
echo "Press Ctrl+C to stop."
echo ""

cd "$SCRIPT_DIR"
uv run python monitor_server.py
