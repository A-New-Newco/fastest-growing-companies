#!/usr/bin/env python3
"""Merge yearly company data with enrichment output using the year as reference."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

ENRICHMENT_COLS = [
    "CFO_NOME",
    "CFO_RUOLO",
    "CFO_LINKEDIN",
    "FONTE",
    "CONFIDENZA",
    "DATA_RICERCA",
]


def _read_csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _write_csv_rows(path: Path, rows: list[dict[str, str]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in fieldnames})


def _parse_rank(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _discover_years(data_dir: Path) -> list[int]:
    years: list[int] = []
    for csv_path in sorted(data_dir.glob("*.csv")):
        if csv_path.stem.isdigit():
            years.append(int(csv_path.stem))
    return sorted(set(years))


def _load_from_enriched_csv(path: Path) -> dict[int, dict[str, str]]:
    if not path.exists():
        return {}

    by_rank: dict[int, dict[str, str]] = {}
    for row in _read_csv_rows(path):
        rank = _parse_rank(row.get("RANK"))
        if rank is None:
            continue
        by_rank[rank] = {col: (row.get(col) or "") for col in ENRICHMENT_COLS}
    return by_rank


def _load_from_checkpoint_jsonl(path: Path) -> dict[int, dict[str, str]]:
    if not path.exists():
        return {}

    by_rank: dict[int, dict[str, str]] = {}
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            raw = line.strip()
            if not raw:
                continue
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                continue
            rank = _parse_rank(str(payload.get("rank")))
            if rank is None:
                continue
            by_rank[rank] = {
                "CFO_NOME": payload.get("cfo_nome") or "",
                "CFO_RUOLO": payload.get("cfo_ruolo") or "",
                "CFO_LINKEDIN": payload.get("cfo_linkedin") or "",
                "FONTE": payload.get("fonte") or "",
                "CONFIDENZA": payload.get("confidenza") or "",
                "DATA_RICERCA": payload.get("data_ricerca") or "",
            }
    return by_rank


def _merge_year(year: int, data_dir: Path, output_dir: Path, strict: bool) -> list[dict[str, str]]:
    input_csv = data_dir / f"{year}.csv"
    if not input_csv.exists():
        if strict:
            raise FileNotFoundError(f"Input non trovato: {input_csv}")
        print(f"[WARN] {year}: input non trovato, salto ({input_csv})")
        return []

    base_rows = _read_csv_rows(input_csv)
    year_output = output_dir / str(year)
    enriched_csv = year_output / "enriched.csv"
    checkpoint_jsonl = year_output / "enrichment_progress.jsonl"

    has_sources = enriched_csv.exists() or checkpoint_jsonl.exists()
    if not has_sources and strict:
        raise FileNotFoundError(
            f"Output non trovato per {year}: attesi {enriched_csv} o {checkpoint_jsonl}"
        )
    if not has_sources:
        print(f"[WARN] {year}: nessun output trovato, creo merge con colonne enrichment vuote.")

    enrichment_by_rank = _load_from_enriched_csv(enriched_csv)
    checkpoint_by_rank = _load_from_checkpoint_jsonl(checkpoint_jsonl)
    # Checkpoint is append-only and reflects the latest processed rows.
    enrichment_by_rank.update(checkpoint_by_rank)

    merged_rows: list[dict[str, str]] = []
    for row in base_rows:
        merged_row = dict(row)
        rank = _parse_rank(row.get("RANK"))
        extra = enrichment_by_rank.get(rank, {})
        for col in ENRICHMENT_COLS:
            merged_row[col] = extra.get(col, "")
        merged_rows.append(merged_row)

    base_cols = list(base_rows[0].keys()) if base_rows else []
    merged_cols = base_cols + [col for col in ENRICHMENT_COLS if col not in base_cols]
    merged_path = year_output / f"merged_{year}.csv"
    _write_csv_rows(merged_path, merged_rows, merged_cols)

    matched = sum(1 for row in merged_rows if row.get("CFO_NOME"))
    print(
        f"[OK] {year}: {len(merged_rows)} righe scritte in {merged_path} "
        f"(aziende con CFO: {matched})"
    )

    with_year = []
    for row in merged_rows:
        row_with_year = {"ANNO": str(year)}
        row_with_year.update(row)
        with_year.append(row_with_year)
    return with_year


def _write_all_years(rows: list[dict[str, str]], output_dir: Path) -> None:
    if not rows:
        return

    columns: list[str] = []
    for row in rows:
        for key in row:
            if key not in columns:
                columns.append(key)

    merged_all_path = output_dir / "merged_all_years.csv"
    _write_csv_rows(merged_all_path, rows, columns)
    print(f"[OK] Consolidato multi-anno scritto in {merged_all_path} ({len(rows)} righe)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Unisce data/{anno}.csv con output/{anno}/enriched.csv|enrichment_progress.jsonl."
    )
    parser.add_argument(
        "--year",
        type=int,
        action="append",
        help="Anno da processare (ripetibile). Se assente, processa tutti gli anni in data/.",
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path("data"),
        help="Directory degli input CSV (default: data).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("output"),
        help="Directory degli output (default: output).",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Fallisce se per un anno manca l'output di enrichment.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    data_dir: Path = args.data_dir
    output_dir: Path = args.output_dir

    if not data_dir.exists():
        print(f"[ERRORE] Directory input non trovata: {data_dir}", file=sys.stderr)
        return 1

    years = sorted(set(args.year)) if args.year else _discover_years(data_dir)
    if not years:
        print("[ERRORE] Nessun anno trovato da processare.", file=sys.stderr)
        return 1

    all_rows: list[dict[str, str]] = []
    for year in years:
        try:
            all_rows.extend(_merge_year(year, data_dir, output_dir, args.strict))
        except Exception as exc:
            print(f"[ERRORE] {year}: {exc}", file=sys.stderr)
            if args.strict:
                return 1

    _write_all_years(all_rows, output_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
