from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse

MODULE_PATH = Path(__file__).resolve().parents[1] / "scrape_wch.py"
SPEC = importlib.util.spec_from_file_location("scrape_wch", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
scrape_wch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scrape_wch)

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


def load_fixture(name: str) -> str:
    return (FIXTURES_DIR / name).read_text(encoding="utf-8")


def build_html(initial_result: dict, search_query: dict | None = None, project_short_code: str = "WCH") -> str:
    query = search_query or {
        "searchParameters": {
            "period": "2026",
            "projectShortCode": project_short_code,
        }
    }
    return (
        '<search-results-views '
        f'project-short-code="{project_short_code}" '
        f'v-bind:search-query="{scrape_wch.html.escape(scrape_wch.json.dumps(query), quote=True)}" '
        f'v-bind:initial-search-result="{scrape_wch.html.escape(scrape_wch.json.dumps(initial_result), quote=True)}" '
        "></search-results-views>"
    )


class ParsePayloadTests(unittest.TestCase):
    def test_parse_valid_initial_payload(self) -> None:
        html_text = load_fixture("valid_payload.html")
        payload = scrape_wch.parse_bound_json(html_text, scrape_wch.INITIAL_RESULT_ATTR)
        self.assertIsInstance(payload, dict)
        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["results"][0]["account"]["id"], "acc-1")

    def test_parse_invalid_initial_payload_raises(self) -> None:
        html_text = load_fixture("invalid_payload.html")
        with self.assertRaises(ValueError):
            scrape_wch.parse_bound_json(html_text, scrape_wch.INITIAL_RESULT_ATTR)


class PaginationTests(unittest.TestCase):
    def test_crawl_award_rows_two_pages(self) -> None:
        page_0 = {
            "pagination": {"total": 600, "limit": 300, "offset": 0},
            "count": 300,
            "results": [{"id": "award-0", "account": {"id": "acc-0"}, "rank": 1}],
        }
        page_300 = {
            "pagination": {"total": 600, "limit": 300, "offset": 300},
            "count": 300,
            "results": [{"id": "award-1", "account": {"id": "acc-1"}, "rank": 2}],
        }

        responses = {
            0: build_html(page_0),
            300: build_html(page_300),
        }
        offsets_seen: list[int] = []

        def fake_fetcher(url: str, timeout: int) -> str:
            del timeout
            offset = int(parse_qs(urlparse(url).query).get("offset", ["0"])[0])
            offsets_seen.append(offset)
            return responses[offset]

        rows, metadata = scrape_wch.crawl_award_rows(
            base_url="https://example.com/suche",
            max_limit=10000,
            timeout=5,
            fetcher=fake_fetcher,
        )

        self.assertEqual(offsets_seen, [0, 300])
        self.assertEqual(len(rows), 2)
        self.assertEqual(metadata["pagination_total"], 600)


class AggregationTests(unittest.TestCase):
    def test_aggregate_same_account_into_one_company(self) -> None:
        rows = [
            {
                "id": "award-national",
                "rank": 7,
                "account": {"id": "acc-42", "name": "Example GmbH"},
                "contact": {"name": "Anna"},
                "toplistLabel": {"value": "National"},
                "dynamicData": {"wch_ranking_national": {"value": 7}},
            },
            {
                "id": "award-sector",
                "rank": 2,
                "account": {"id": "acc-42", "name": "Example GmbH"},
                "contact": None,
                "toplistLabel": {"value": "IT, Internet, Software und Services"},
                "dynamicData": {"wch_ranking_national": {"value": 7}},
            },
        ]

        companies = scrape_wch.aggregate_companies(
            rows,
            source_url=scrape_wch.SOURCE_URL,
            scraped_at="2026-03-10T10:00:00+00:00",
            project_short_code="WCH",
            period="2026",
        )

        self.assertEqual(len(companies), 1)
        company = companies[0]
        self.assertEqual(company["award_count"], 2)
        self.assertEqual(company["national_rank"], 7)
        self.assertEqual(
            company["toplist_labels"],
            ["IT, Internet, Software und Services", "National"],
        )
        self.assertEqual(len(company["awards"]), 2)


if __name__ == "__main__":
    unittest.main()
