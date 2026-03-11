#!/usr/bin/env python3
"""Scraper Focus Wachstumschampions (MVP JSONL, 1 riga per azienda)."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse
from urllib.request import Request, urlopen

SOURCE_URL = "https://www.focus.de/business/wachstumschampions/suche"
INITIAL_RESULT_ATTR = "v-bind:initial-search-result"
SEARCH_QUERY_ATTR = "v-bind:search-query"
PROJECT_SHORT_CODE_ATTR = "project-short-code"

DEFAULT_TIMEOUT_SECONDS = 30
DEFAULT_MAX_LIMIT = 10000
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "output" / "wachstumschampions_companies.jsonl"


class ScraperError(RuntimeError):
    """Raised when scraping/parsing fails in a non-recoverable way."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Scrape Focus Wachstumschampions and write one JSONL record per company "
            "(awards preserved as nested list)."
        )
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output JSONL path (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT_SECONDS,
        help=f"HTTP timeout in seconds (default: {DEFAULT_TIMEOUT_SECONDS})",
    )
    parser.add_argument(
        "--max-limit",
        type=int,
        default=DEFAULT_MAX_LIMIT,
        help=(
            "Requested limit query parameter for each page. "
            "Server may cap this value (default: 10000)."
        ),
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print per-page diagnostics.",
    )
    return parser.parse_args()


def log(verbose: bool, message: str) -> None:
    if verbose:
        print(message, file=sys.stderr)


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def build_page_url(base_url: str, offset: int, limit: int) -> str:
    parsed = urlparse(base_url)
    query = parse_qs(parsed.query, keep_blank_values=True)
    query["offset"] = [str(offset)]
    query["limit"] = [str(limit)]
    new_query = urlencode(query, doseq=True)
    return urlunparse(
        (
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            parsed.params,
            new_query,
            parsed.fragment,
        )
    )


def fetch_html_page(url: str, timeout: int) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/123.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        },
    )

    try:
        with urlopen(request, timeout=timeout) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            body = response.read()
    except HTTPError as exc:
        raise ScraperError(f"HTTP error for {url}: {exc.code} {exc.reason}") from exc
    except URLError as exc:
        raise ScraperError(f"Network error for {url}: {exc.reason}") from exc

    return body.decode(charset, errors="replace")


def parse_bound_json(html_text: str, attr_name: str) -> Any:
    pattern = rf"{re.escape(attr_name)}=\"(.*?)\""
    match = re.search(pattern, html_text, re.DOTALL)
    if not match:
        raise ValueError(f"Attribute {attr_name!r} not found in HTML.")

    payload = html.unescape(match.group(1))
    try:
        return json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON payload in {attr_name!r}: {exc}") from exc


def parse_project_short_code(html_text: str) -> str | None:
    match = re.search(rf"{re.escape(PROJECT_SHORT_CODE_ATTR)}=\"([^\"]+)\"", html_text)
    if match:
        return match.group(1)
    return None


def to_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        candidate = value.strip().replace(".", "").replace(",", "")
        if candidate.isdigit():
            return int(candidate)
    return None


def award_identity(row: dict[str, Any]) -> str:
    award_id = row.get("id")
    if isinstance(award_id, str) and award_id:
        return f"award_id:{award_id}"

    salesforce_id = row.get("salesforceId")
    if isinstance(salesforce_id, str) and salesforce_id:
        return f"award_salesforce_id:{salesforce_id}"

    digest = hashlib.sha1(canonical_json(row).encode("utf-8")).hexdigest()
    return f"award_fingerprint:{digest}"


def company_identity(row: dict[str, Any]) -> str:
    account = row.get("account")
    if isinstance(account, dict):
        account_id = account.get("id")
        if isinstance(account_id, str) and account_id:
            return f"account_id:{account_id}"

        salesforce_id = account.get("salesforceId")
        if isinstance(salesforce_id, str) and salesforce_id:
            return f"account_salesforce_id:{salesforce_id}"

    fingerprint_source = {
        "account": {
            "name": (account or {}).get("name") if isinstance(account, dict) else None,
            "shortName": (account or {}).get("shortName") if isinstance(account, dict) else None,
            "website": (account or {}).get("website") if isinstance(account, dict) else None,
            "zipCode": (account or {}).get("zipCode") if isinstance(account, dict) else None,
            "city": (account or {}).get("city") if isinstance(account, dict) else None,
            "street": (account or {}).get("street") if isinstance(account, dict) else None,
        },
        "toplist": ((row.get("toplistLabel") or {}).get("value") if isinstance(row.get("toplistLabel"), dict) else None),
        "rank": row.get("rank"),
    }
    digest = hashlib.sha1(canonical_json(fingerprint_source).encode("utf-8")).hexdigest()
    return f"company_fingerprint:{digest}"


def extract_toplist_label(row: dict[str, Any]) -> str | None:
    toplist = row.get("toplistLabel")
    if isinstance(toplist, dict):
        label = toplist.get("value")
        if isinstance(label, str) and label.strip():
            return label.strip()
    return None


def extract_national_rank(row: dict[str, Any]) -> int | None:
    dynamic_data = row.get("dynamicData")
    if isinstance(dynamic_data, dict):
        national = dynamic_data.get("wch_ranking_national")
        if isinstance(national, dict):
            rank = to_int(national.get("value"))
            if rank is not None:
                return rank

    awards = row.get("awards")
    if isinstance(awards, dict):
        latest_national = awards.get("latestNational")
        if isinstance(latest_national, dict):
            rank = to_int(latest_national.get("rank"))
            if rank is not None:
                return rank

    toplist_label = extract_toplist_label(row)
    if toplist_label and toplist_label.lower() == "national":
        rank = to_int(row.get("rank"))
        if rank is not None:
            return rank

    return None


def crawl_award_rows(
    base_url: str,
    max_limit: int,
    timeout: int,
    verbose: bool = False,
    fetcher: Callable[[str, int], str] = fetch_html_page,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    all_rows: list[dict[str, Any]] = []
    seen_awards: set[str] = set()

    offset = 0
    total_expected: int | None = None
    search_query: dict[str, Any] = {}
    project_short_code: str | None = None

    for iteration in range(0, 2000):
        page_url = build_page_url(base_url, offset=offset, limit=max_limit)
        log(verbose, f"[INFO] Fetch page #{iteration + 1} -> {page_url}")
        html_text = fetcher(page_url, timeout)

        initial = parse_bound_json(html_text, INITIAL_RESULT_ATTR)
        if not isinstance(initial, dict):
            raise ScraperError("initial-search-result payload is not a JSON object.")

        if not search_query:
            parsed_search_query = parse_bound_json(html_text, SEARCH_QUERY_ATTR)
            if isinstance(parsed_search_query, dict):
                search_query = parsed_search_query

        if project_short_code is None:
            project_short_code = parse_project_short_code(html_text)
            if not project_short_code:
                project_short_code = (
                    (search_query.get("searchParameters") or {}).get("projectShortCode")
                    if isinstance(search_query, dict)
                    else None
                )

        pagination = initial.get("pagination")
        if isinstance(pagination, dict):
            total = to_int(pagination.get("total"))
            if total is not None:
                total_expected = total

        page_rows = initial.get("results")
        if not isinstance(page_rows, list):
            raise ScraperError("initial-search-result.results is not a list.")

        page_count = to_int(initial.get("count"))
        if page_count is None:
            page_count = len(page_rows)

        page_added = 0
        for row in page_rows:
            if not isinstance(row, dict):
                continue
            key = award_identity(row)
            if key in seen_awards:
                continue
            seen_awards.add(key)
            all_rows.append(row)
            page_added += 1

        log(
            verbose,
            (
                "[INFO] Page stats: "
                f"count={page_count}, results={len(page_rows)}, added={page_added}, "
                f"total_expected={total_expected}, collected={len(all_rows)}"
            ),
        )

        if page_count <= 0 or not page_rows:
            break

        offset += page_count

        if total_expected is not None and offset >= total_expected:
            break
    else:
        raise ScraperError("Pagination guard reached (too many pages).")

    metadata = {
        "search_query": search_query,
        "project_short_code": project_short_code,
        "period": (
            (search_query.get("searchParameters") or {}).get("period")
            if isinstance(search_query, dict)
            else None
        ),
        "pagination_total": total_expected,
    }

    return all_rows, metadata


def merge_prefer_existing(existing: dict[str, Any] | None, incoming: dict[str, Any] | None) -> dict[str, Any] | None:
    if existing and incoming:
        return existing
    return existing or incoming


def company_sort_name(record: dict[str, Any]) -> str:
    account = record.get("account")
    if isinstance(account, dict):
        for field in ("shortName", "name"):
            value = account.get(field)
            if isinstance(value, str) and value.strip():
                return value.strip().lower()
    return ""


def aggregate_companies(
    award_rows: list[dict[str, Any]],
    *,
    source_url: str,
    scraped_at: str,
    project_short_code: str | None,
    period: str | None,
) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}

    for row in award_rows:
        key = company_identity(row)

        existing = grouped.get(key)
        if existing is None:
            existing = {
                "company_key": key,
                "source_url": source_url,
                "scraped_at": scraped_at,
                "project_short_code": project_short_code,
                "period": period,
                "account": row.get("account") if isinstance(row.get("account"), dict) else None,
                "contact": row.get("contact") if isinstance(row.get("contact"), dict) else None,
                "awards": [],
                "_toplist_labels": set(),
                "national_rank": None,
            }
            grouped[key] = existing
        else:
            existing["account"] = merge_prefer_existing(
                existing.get("account"),
                row.get("account") if isinstance(row.get("account"), dict) else None,
            )
            existing["contact"] = merge_prefer_existing(
                existing.get("contact"),
                row.get("contact") if isinstance(row.get("contact"), dict) else None,
            )

        existing["awards"].append(row)

        toplist_label = extract_toplist_label(row)
        if toplist_label:
            existing["_toplist_labels"].add(toplist_label)

        national_rank = extract_national_rank(row)
        current_rank = existing.get("national_rank")
        if national_rank is not None and (current_rank is None or national_rank < current_rank):
            existing["national_rank"] = national_rank

    companies: list[dict[str, Any]] = []
    for record in grouped.values():
        labels = sorted(record.pop("_toplist_labels"))
        record["toplist_labels"] = labels
        record["award_count"] = len(record.get("awards") or [])
        companies.append(record)

    companies.sort(
        key=lambda company: (
            company.get("national_rank") is None,
            company.get("national_rank") if company.get("national_rank") is not None else 10**9,
            company_sort_name(company),
            company.get("company_key", ""),
        )
    )
    return companies


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    with path.open("w", encoding="utf-8") as file:
        for record in records:
            file.write(json.dumps(record, ensure_ascii=False))
            file.write("\n")


def run(args: argparse.Namespace) -> int:
    scraped_at = datetime.now(timezone.utc).isoformat()

    award_rows, metadata = crawl_award_rows(
        base_url=SOURCE_URL,
        max_limit=args.max_limit,
        timeout=args.timeout,
        verbose=args.verbose,
    )

    if not award_rows:
        raise ScraperError("No award rows extracted from source page.")

    companies = aggregate_companies(
        award_rows,
        source_url=SOURCE_URL,
        scraped_at=scraped_at,
        project_short_code=metadata.get("project_short_code"),
        period=metadata.get("period"),
    )

    write_jsonl(args.output, companies)

    expected_total = metadata.get("pagination_total")
    if isinstance(expected_total, int) and expected_total != len(award_rows):
        print(
            "[WARN] Award row count mismatch: "
            f"extracted={len(award_rows)} expected_total={expected_total}",
            file=sys.stderr,
        )

    print(f"[OK] Output JSONL: {args.output}")
    print(f"[OK] Award rows total: {len(award_rows)}")
    print(f"[OK] Unique companies: {len(companies)}")
    if metadata.get("project_short_code"):
        print(f"[OK] Project short code: {metadata['project_short_code']}")
    if metadata.get("period"):
        print(f"[OK] Period: {metadata['period']}")

    return 0


def main() -> int:
    args = parse_args()
    try:
        return run(args)
    except (ScraperError, ValueError) as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
