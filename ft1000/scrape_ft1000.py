#!/usr/bin/env python3
"""
Scraper FT1000 – Europe's Fastest-Growing Companies 2025
Source: https://rankings.statista.com/en/fastest-growing-companies/rankings/fastest-growing-companies-europe-2025/

Strategy:
  The ranking data is fetched client-side via /api/ranking/table-data.
  Direct HTTP calls from outside the browser return 500 (internal proxy issue).
  We open the page in headless Chrome, let it establish a session, then call
  the API from inside the browser context via window.fetch — auth and cookies
  are handled automatically by the browser.

  Discovered params: projectName=P-174727, orderBy=rank%3Dasc&orderBy=name%3Dasc
  API fields: rank, name, cagr, headquarters, category,
              revenue_2023_in_eur, revenue_2020_in_eur,
              employees_2023, employees_2020, founding_year

Output: output/ft1000_europe_2025.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path
from typing import Any

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SOURCE_URL = (
    "https://rankings.statista.com/en/fastest-growing-companies/"
    "rankings/fastest-growing-companies-europe-2025/"
)
PROJECT_ID = "P-174727"
PAGE_SIZE = 100
EXPECTED_COUNT = 1000

DEFAULT_OUTPUT = Path(__file__).resolve().parent / "output" / "ft1000_europe_2025.csv"
DEFAULT_WAIT = 25  # seconds for initial page/table render

CSV_COLUMNS = [
    "RANK",
    "COMPANY",
    "CAGR_PCT",
    "HEADQUARTERS",
    "CATEGORY",
    "REVENUE_2023_EUR",
    "REVENUE_2020_EUR",
    "EMPLOYEES_2023",
    "EMPLOYEES_2020",
    "FOUNDING_YEAR",
]

# ---------------------------------------------------------------------------
# Browser
# ---------------------------------------------------------------------------


class ScraperError(RuntimeError):
    pass


def build_driver() -> webdriver.Chrome:
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1280,900")
    opts.add_argument(
        "user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    )
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)
    driver = webdriver.Chrome(options=opts)
    driver.execute_cdp_cmd(
        "Page.addScriptToEvaluateOnNewDocument",
        {"source": "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"},
    )
    driver.set_script_timeout(60)
    return driver


# ---------------------------------------------------------------------------
# API fetch (runs inside the browser via execute_async_script)
# ---------------------------------------------------------------------------

_FETCH_PAGE_JS = """
const [page, pageSize, projectId, cb] = arguments;
const url = '/api/ranking/table-data'
    + '?page=' + page
    + '&pageSize=' + pageSize
    + '&projectName=' + projectId
    + '&orderBy=rank%3Dasc'
    + '&orderBy=name%3Dasc';
fetch(url, {credentials: 'include', headers: {Accept: 'application/json'}})
    .then(r => r.json())
    .then(data => cb({ok: true, data: data}))
    .catch(err => cb({ok: false, error: String(err)}));
"""


def fetch_page(driver: webdriver.Chrome, page: int) -> dict[str, Any]:
    result = driver.execute_async_script(_FETCH_PAGE_JS, page, PAGE_SIZE, PROJECT_ID)
    if not result or not result.get("ok"):
        raise ScraperError(f"Page {page} fetch failed: {result}")
    payload = result["data"]
    if "data" not in payload:
        raise ScraperError(f"Unexpected API shape on page {page}: {list(payload.keys())}")
    return payload


# ---------------------------------------------------------------------------
# Row normalisation
# ---------------------------------------------------------------------------

def _s(v: Any) -> str:
    return "" if v is None else str(v).strip()


def normalise(raw: dict[str, Any]) -> dict[str, str]:
    return {
        "RANK":             _s(raw.get("rank")),
        "COMPANY":          _s(raw.get("name")),
        "CAGR_PCT":         _s(raw.get("cagr")),
        "HEADQUARTERS":     _s(raw.get("headquarters")),
        "CATEGORY":         _s(raw.get("category")),
        "REVENUE_2023_EUR": _s(raw.get("revenue_2023_in_eur")),
        "REVENUE_2020_EUR": _s(raw.get("revenue_2020_in_eur")),
        "EMPLOYEES_2023":   _s(raw.get("employees_2023")),
        "EMPLOYEES_2020":   _s(raw.get("employees_2020")),
        "FOUNDING_YEAR":    _s(raw.get("founding_year")),
    }


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def scrape(wait_seconds: int) -> list[dict[str, str]]:
    driver = build_driver()
    try:
        print(f"[INFO] Loading {SOURCE_URL}", file=sys.stderr)
        driver.get(SOURCE_URL)

        print("[INFO] Waiting for table to render…", file=sys.stderr)
        try:
            WebDriverWait(driver, wait_seconds).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "tbody tr"))
            )
        except Exception:
            raise ScraperError("Timed out waiting for the ranking table.")

        time.sleep(2)  # let JS fully initialise

        # Page 1: discover pagination
        print("[INFO] Fetching page 1…", file=sys.stderr)
        first = fetch_page(driver, 1)
        pagination = first.get("pagination", {})
        total_items = pagination.get("total_items", EXPECTED_COUNT)
        total_pages = pagination.get("total_pages") or -(-total_items // PAGE_SIZE)

        print(
            f"[INFO] {total_items} companies across {total_pages} pages "
            f"(pageSize={PAGE_SIZE})",
            file=sys.stderr,
        )

        all_raw: list[dict[str, Any]] = list(first["data"])

        for page in range(2, total_pages + 1):
            print(f"[INFO] Fetching page {page}/{total_pages}…", file=sys.stderr)
            payload = fetch_page(driver, page)
            batch = payload.get("data", [])
            if not batch:
                print(f"[WARN] Empty page {page}, stopping early.", file=sys.stderr)
                break
            all_raw.extend(batch)
            time.sleep(0.5)

    finally:
        driver.quit()

    return [normalise(raw) for raw in all_raw]


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scrape FT1000 – Europe's Fastest-Growing Companies 2025."
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--wait", type=int, default=DEFAULT_WAIT,
        help=f"Seconds to wait for initial table render (default: {DEFAULT_WAIT})"
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        rows = scrape(args.wait)
    except ScraperError as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1

    write_csv(args.output, rows)
    print(f"[OK] {len(rows)} companies → {args.output}")
    if len(rows) < EXPECTED_COUNT:
        print(f"[WARN] Expected {EXPECTED_COUNT}, got {len(rows)}.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
