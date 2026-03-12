#!/usr/bin/env python3
"""Convert Wachstumschampions JSONL into a compact, English-oriented JSONL."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

DEFAULT_INPUT = Path(__file__).resolve().parent / "output" / "wachstumschampions_companies.jsonl"
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "output" / "wachstumschampions_companies.compact.en.jsonl"

SECTOR_TRANSLATIONS = {
    "Abfallentsorgung und R\u00fcckgewinnung (Recycling)": "Waste Management and Recycling",
    "Automobil (Hersteller, Zulieferer und Handel)": "Automotive (Manufacturers, Suppliers and Trade)",
    "Baugewerbe": "Construction",
    "Chemie und Pharma": "Chemicals and Pharmaceuticals",
    "Einzelhandel (inkl. Versandhandel und E-Commerce)": "Retail (incl. Mail Order and E-Commerce)",
    "Elektronik, Elektro- und Medizintechnik": "Electronics, Electrical Engineering and Medical Technology",
    "Energie und Versorger": "Energy and Utilities",
    "Finanzdienstleistungen": "Financial Services",
    "Gesundheit, Soziales, Erziehung und Bildung": "Healthcare, Social Services, Education and Training",
    "Gro\u00dfhandel": "Wholesale",
    "Grundst\u00fcck und Wohnungswesen (Immobilien)": "Real Estate and Housing",
    "Human Resources (Personalwesen)": "Human Resources",
    "IT, Internet, Software und Services": "IT, Internet, Software and Services",
    "Lebensmitteleinzelhandel, Gastronomie und Tourismus": "Food Retail, Hospitality and Tourism",
    "Maschinen- und Anlagenbau": "Mechanical and Plant Engineering",
    "National": "National",
    "Telekommunikation": "Telecommunications",
    "Unternehmens-, Rechts- und Steuerberatung": "Management, Legal and Tax Consulting",
    "Verarbeitendes & produzierendes Gewerbe (ohne Automobil, Maschinen- und Anlagenbau)": (
        "Manufacturing and Industrial Production (excluding Automotive and Mechanical/Plant Engineering)"
    ),
    "Verkehr und Logistik": "Transport and Logistics",
    "Werbung, Marketing und Medien": "Advertising, Marketing and Media",
    "Wirtschaftliche und private Dienstleistungen": "Business and Personal Services",
}

REGION_TRANSLATIONS = {
    "Baden-W\u00fcrttemberg": "Baden-Wuerttemberg",
    "Bayern": "Bavaria",
    "Berlin": "Berlin",
    "Brandenburg": "Brandenburg",
    "Bremen": "Bremen",
    "Hamburg": "Hamburg",
    "Hessen": "Hesse",
    "Mecklenburg-Vorpommern": "Mecklenburg-Western Pomerania",
    "Niedersachsen": "Lower Saxony",
    "Nordrhein-Westfalen": "North Rhine-Westphalia",
    "Rheinland-Pfalz": "Rhineland-Palatinate",
    "Saarland": "Saarland",
    "Sachsen": "Saxony",
    "Schleswig-Holstein": "Schleswig-Holstein",
    "Th\u00fcringen": "Thuringia",
}

COUNTRY_CODE_TRANSLATIONS = {
    "DE": "Germany",
}

VALUE_TRANSLATIONS = {
    "Selbstauskunft": "Self-reported",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Convert wachstumschampions_companies.jsonl into a compact JSONL with "
            "only important fields and English-translated categorical labels."
        )
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_INPUT,
        help=f"Input JSONL path (default: {DEFAULT_INPUT})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output JSONL path (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--keep-nulls",
        action="store_true",
        help="Keep null/empty fields in output (default: remove them for max compactness).",
    )
    return parser.parse_args()


def to_int(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        candidate = value.strip().replace(".", "").replace(",", "")
        if candidate and candidate.lstrip("-").isdigit():
            return int(candidate)
    return None


def to_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        candidate = value.strip().replace(" ", "")
        if not candidate:
            return None
        if "," in candidate and "." in candidate:
            # Support both EU style (1.234,56) and US style (1,234.56).
            if candidate.rfind(",") > candidate.rfind("."):
                candidate = candidate.replace(".", "").replace(",", ".")
            else:
                candidate = candidate.replace(",", "")
        elif "," in candidate:
            if candidate.count(",") == 1:
                candidate = candidate.replace(",", ".")
            else:
                candidate = candidate.replace(",", "")
        try:
            return float(candidate)
        except ValueError:
            return None
    return None


def to_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "y", "ja"}:
            return True
        if lowered in {"false", "0", "no", "n", "nein"}:
            return False
    return None


def normalize_website(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    website = value.strip()
    if not website:
        return None
    if website.startswith(("http://", "https://")):
        return website
    return f"https://{website}"


def translate(mapping: dict[str, str], value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if not normalized:
        return None
    return mapping.get(normalized, normalized)


def get_primary_award(awards: Any) -> dict[str, Any] | None:
    if not isinstance(awards, list):
        return None

    for award in awards:
        if not isinstance(award, dict):
            continue
        toplist = (award.get("toplistLabel") or {}).get("value")
        if isinstance(toplist, str) and toplist.strip() and toplist.strip().lower() != "national":
            return award

    for award in awards:
        if isinstance(award, dict):
            return award
    return None


def get_dynamic_entry(award: dict[str, Any] | None, key: str) -> dict[str, Any]:
    if not isinstance(award, dict):
        return {}
    dynamic = award.get("dynamicData")
    if not isinstance(dynamic, dict):
        return {}
    entry = dynamic.get(key)
    if not isinstance(entry, dict):
        return {}
    return entry


def get_dynamic_value(award: dict[str, Any] | None, key: str) -> Any:
    return get_dynamic_entry(award, key).get("value")


def get_revenue_eur(award: dict[str, Any] | None, key: str) -> int | None:
    entry = get_dynamic_entry(award, key)

    prefixed_value = to_int(entry.get("prefixedValue"))
    if prefixed_value is not None:
        return prefixed_value

    value_as_k_eur = to_float(entry.get("value"))
    if value_as_k_eur is None:
        return None
    return int(round(value_as_k_eur * 1000))


def drop_empty_fields(data: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in data.items()
        if value is not None and not (isinstance(value, str) and not value.strip())
    }


def ratio_to_percentage(value: float | None) -> float | None:
    if value is None:
        return None
    return round(value * 100.0, 3)


def build_compact_record(raw: dict[str, Any]) -> dict[str, Any]:
    account = raw.get("account")
    account = account if isinstance(account, dict) else {}
    award = get_primary_award(raw.get("awards"))

    sector_de = ((award or {}).get("toplistLabel") or {}).get("value")
    national_rank = to_int(raw.get("national_rank"))
    if national_rank is None:
        national_rank = to_int(get_dynamic_value(award, "wch_ranking_national"))

    growth_pa_ratio = to_float(get_dynamic_value(award, "wch_growchampion_growth_rate_relative_pa"))
    growth_a_to_b_ratio = to_float(
        get_dynamic_value(award, "wch_growchampion_growth_rate_relative_a_to_b")
    )

    compact = {
        "company_id": account.get("id") or raw.get("company_key"),
        "company_name": account.get("name") or account.get("shortName"),
        "website": normalize_website(account.get("website")),
        "city": account.get("city"),
        "region": translate(REGION_TRANSLATIONS, account.get("region")) or account.get("region"),
        "country": translate(COUNTRY_CODE_TRANSLATIONS, account.get("countryCode")) or account.get("countryCode"),
        "year": to_int(raw.get("period")) or raw.get("period"),
        "national_rank": national_rank,
        "sector_rank": to_int((award or {}).get("rank")),
        "sector": translate(SECTOR_TRANSLATIONS, sector_de) or sector_de,
        "growth_rate_pa_pct": ratio_to_percentage(growth_pa_ratio),
        "growth_rate_pa_ratio": growth_pa_ratio,
        "growth_rate_a_to_b_ratio": growth_a_to_b_ratio,
        "growth_rate_a_to_b_pct": ratio_to_percentage(growth_a_to_b_ratio),
        "revenue_year_a_eur": get_revenue_eur(award, "wch_growchampion_revenue_in_1000_eur_year_a"),
        "revenue_year_b_eur": get_revenue_eur(award, "wch_growchampion_revenue_in_1000_eur_year_b"),
        "employees_year_a": to_int(get_dynamic_value(award, "wch_growchampion_employee_year_a")),
        "employees_year_b": to_int(get_dynamic_value(award, "wch_growchampion_employee_year_b")),
        "founded_year": to_int(get_dynamic_value(award, "wch_growchampion_foundation_year")),
        "is_publicly_listed": to_bool(get_dynamic_value(award, "wch_growchampion_market_listed")),
        "revenue_source": translate(
            VALUE_TRANSLATIONS, get_dynamic_value(award, "wch_growchampion_revenue_source")
        )
        or get_dynamic_value(award, "wch_growchampion_revenue_source"),
        "employee_source": translate(
            VALUE_TRANSLATIONS, get_dynamic_value(award, "wch_growchampion_employee_source")
        )
        or get_dynamic_value(award, "wch_growchampion_employee_source"),
    }
    return compact


def format_bytes(size: int) -> str:
    units = ["B", "KB", "MB", "GB"]
    value = float(size)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f"{value:.1f}{unit}"
        value /= 1024
    return f"{size}B"


def convert_file(input_path: Path, output_path: Path, keep_nulls: bool) -> tuple[int, int, int]:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    total_records = 0
    with input_path.open("r", encoding="utf-8") as infile, output_path.open(
        "w", encoding="utf-8"
    ) as outfile:
        for line_number, line in enumerate(infile, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                raw_record = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSON at line {line_number}: {exc}") from exc

            if not isinstance(raw_record, dict):
                continue

            compact_record = build_compact_record(raw_record)
            if not keep_nulls:
                compact_record = drop_empty_fields(compact_record)

            outfile.write(json.dumps(compact_record, ensure_ascii=False, separators=(",", ":")))
            outfile.write("\n")
            total_records += 1

    input_size = input_path.stat().st_size
    output_size = output_path.stat().st_size
    return total_records, input_size, output_size


def main() -> int:
    args = parse_args()

    if not args.input.exists():
        raise FileNotFoundError(f"Input file not found: {args.input}")

    count, in_size, out_size = convert_file(args.input, args.output, keep_nulls=args.keep_nulls)
    reduction = (1 - (out_size / in_size)) * 100 if in_size else 0.0

    print(f"Input:  {args.input}")
    print(f"Output: {args.output}")
    print(f"Records written: {count}")
    print(f"Size: {format_bytes(in_size)} -> {format_bytes(out_size)} ({reduction:.2f}% smaller)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
