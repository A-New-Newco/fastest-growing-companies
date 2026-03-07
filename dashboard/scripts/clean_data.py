"""
clean_data.py — CFO Enrichment Data Cleaning Script

Input:  ../cfo-enricher/output/2026/enriched.csv
Output: ../public/data/2026_cleaned.csv

Transformations:
  1. Strip name prefixes from CFO_RUOLO ("Nome Cognome - Ruolo" → "Ruolo")
  2. Normalize CFO_RUOLO → CFO_RUOLO_CATEGORY (10 semantic categories)
  3. Add CFO_FOUND boolean (any contact found)
  4. Add HAS_REAL_CFO boolean (CFO/DAF or Finance Manager + confidence medium/high)
"""

import csv
import re
import os
import sys
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent
DASHBOARD_DIR = SCRIPT_DIR.parent
INPUT_CSV = DASHBOARD_DIR.parent / "cfo-enricher" / "output" / "2026" / "enriched.csv"
OUTPUT_CSV = DASHBOARD_DIR / "public" / "data" / "2026_cleaned.csv"


# ── Name prefix stripping ──────────────────────────────────────────────────────
# Matches patterns like "Fabrizio Sallustio - Direttore finanza e controllo"
#                    or "Maria Rossi – Amministratore Unico"
NAME_PREFIX_RE = re.compile(
    r"^(?:[A-ZÀÈÉÌÒÙÜ][a-zàèéìòùü']+\s){2,4}[-–]\s",
    re.UNICODE,
)


def strip_name_prefix(raw: str) -> str:
    return NAME_PREFIX_RE.sub("", raw.strip())


# ── Role normalization ─────────────────────────────────────────────────────────
# Categories (priority: Mixed → CFO → CEO → Finance Mgr → Founder → Presidente
#             → General Mgr → Amministratore → Founder/Owner fallback → Other)

CATEGORIES = [
    "CFO / DAF",
    "CEO / AD",
    "Finance Manager",
    "Founder / Owner",
    "Presidente",
    "General Manager",
    "Mixed Role",
    "Amministratore",
    "Other",
    "Not Found",
]

# Regex patterns (applied case-insensitively on lowercased string)
_CFO_PAT = re.compile(
    r"\bcfo\b"
    r"|chief financial"
    r"|direttore finanziario"
    r"|direttrice.*finanza"
    r"|direttore.*finanza"            # "Direttore finanza e controllo"
    r"|financial director"
    r"|financial officer"
    r"|financial manager"
    r"|head of finance"               # also matches "Head of Finance Office"
    r"|head of treasury"
    r"|augmented cfo"
    r"|country cfo"
    r"|group cfo"
    r"|founder and cfo"
    r"|finance.*control.*director"    # "Finance, Administration & Control Director (CFO)"
    r"|director of administration.*finance"
    r"|direttore amministrativo e finanziario"
    r"|direttrice amministrazione.*finanza"
    r"|chief strategy.*financial"
)

_CEO_PAT = re.compile(
    r"\bceo\b"
    r"|chief executive officer"
    r"|amministratore delegato"
    r"|managing director(?!\s+of\s+sales)"  # exclude "Managing Director of Sales"
    r"|executive managing director"
    r"|\bchairman\b"
    r"|co-ceo\b"
    r"|\bco ceo\b"
)

_FOUNDER_PAT = re.compile(
    r"\bfounder\b"
    r"|\bco-founder\b"
    r"|\bco founder\b"
    r"|\bfondatore\b"
    r"|\bco-fondatore\b"
    r"|\bcofondatore\b"
    r"|\bsocio fondatore\b"
    r"|\bco-titolare e fondatore\b"
)

_PRESIDENTE_PAT = re.compile(
    r"\bpresidente\b"
    r"|\bpresident\b"
)

# Finance Manager: operational finance/admin roles (NOT C-level)
_FINANCE_MGR_PAT = re.compile(
    r"responsabile.*(amministr|finanz|contabil|controllo|bilancio|gestione|ufficio)"
    r"|referente.*amministrativ"
    r"|resp\.?\s*amministrativ"
    r"|head of admin"
    r"|head of hr.*finance"
    r"|finance.*hr"
    r"|finance.*legal"
    r"|finance.*admin"
    r"|finance.*accounting"
    r"|finance.*control(?!.*director)"  # avoid matching CFO pattern
    r"|finance.*business"
    r"|finance.*managing"
    r"|finance manager"
    r"|finance and accounting"
    r"|finance,.*accounting"
    r"|administrative.*accounting"
    r"|administration.*(director|manager|specialist)"
    r"|\badmin\b"
    r"|admin.*accountant"
    r"|accounting.*controlling"
    r"|\baccounting\b"
    r"|senior accountant"
    r"|senior.*accountant"
    r"|senior financial controller"
    r"|senior management accountant"
    r"|business controller"
    r"|\bcontroller\b"
    r"|\bcontrollo\b"
    r"|\bcontabile\b"
    r"|impiegata.*contabil"
    r"|addetto.*contabilit"
    r"|specialista amministrativo"
    r"|amministrazione.*finanza"
    r"|amministrazione.*controllo"
    r"|afc\b"
    r"|agency director.*controller"
    r"|industrial planning.*control"
    r"|procurement.*cost control"
    r"|treasury.*cash"
    r"|supply chain.*finance"
    r"|direttore amministrativo"       # Direttore Amministrativo (not e Finanziario)
    r"|direttore operativo e amministrativo"
    r"|amministrazione e rendicontazione"
    r"|\bfinance\b"                     # standalone "Finance" role
    r"|finance controller"
    r"|agenzia.*controller"
    r"|^\s*amministrazione\s*$"         # standalone "Amministrazione" (the dept)
    r"|hr.*amministrazione"             # "HR & Amministrazione"
    r"|amministrazione\s*e\s*rendicontazione"
)

_GM_PAT = re.compile(
    r"\bdirettore generale\b"
    r"|\bdirezione generale\b"
    r"|\bgeneral manager\b"
    r"|\bmanaging partner\b"
    r"|\blegale rappresentante.*direttore generale\b"
)

_ADMIN_PAT = re.compile(
    r"\bamministratore unico\b"
    r"|\bamministratore\b"
    r"|\bamministratrice\b"
)

_OWNER_PAT = re.compile(
    r"\btitolare\b"
    r"|\bowner\b"
    r"|\bproprietario\b"
    r"|\bimprenditore\b"
    r"|\blegale rappresentante\b"
    r"|\bprocuratore\b"
    r"|\bsocio di maggioranza\b"
    r"|\bsocio titolare\b"
)


def normalize_role(raw_role: str) -> str:
    """Normalize a raw CFO_RUOLO string into one of 10 semantic categories."""
    if not raw_role or raw_role.strip() == "":
        return "Not Found"

    # Strip leading name prefix before classifying
    cleaned = strip_name_prefix(raw_role)
    s = cleaned.lower()

    # Boolean flags for each major category
    has_cfo = bool(_CFO_PAT.search(s))
    has_ceo = bool(_CEO_PAT.search(s))
    has_founder = bool(_FOUNDER_PAT.search(s))
    has_presidente = bool(_PRESIDENTE_PAT.search(s))
    has_gm = bool(_GM_PAT.search(s))
    has_admin = bool(_ADMIN_PAT.search(s))
    has_finance_mgr = bool(_FINANCE_MGR_PAT.search(s))
    has_owner = bool(_OWNER_PAT.search(s))

    # Mixed Role: two or more "major" C-level categories combined
    # (CEO, CFO, Founder, Presidente are the four "major" roles)
    major_count = sum([has_cfo, has_ceo, has_founder, has_presidente])
    if major_count >= 2:
        return "Mixed Role"

    # Single-category priority order
    if has_cfo:
        return "CFO / DAF"
    if has_ceo:
        return "CEO / AD"
    if has_finance_mgr and not has_gm and not has_presidente:
        return "Finance Manager"
    if has_founder:
        return "Founder / Owner"
    if has_presidente:
        return "Presidente"
    if has_gm:
        return "General Manager"
    if has_admin:
        return "Amministratore"
    if has_finance_mgr:
        return "Finance Manager"
    if has_owner:
        return "Founder / Owner"

    return "Other"


def is_real_cfo(category: str, confidenza: str) -> bool:
    """True only if role is CFO/DAF or Finance Manager with medium/high confidence."""
    return (
        category in ("CFO / DAF", "Finance Manager")
        and confidenza in ("high", "medium")
    )


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    if not INPUT_CSV.exists():
        print(f"ERROR: Input file not found: {INPUT_CSV}", file=sys.stderr)
        sys.exit(1)

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)

    rows_in = 0
    rows_out = 0
    category_counts: dict[str, int] = {}
    real_cfo_count = 0

    with (
        open(INPUT_CSV, newline="", encoding="utf-8") as fin,
        open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as fout,
    ):
        reader = csv.DictReader(fin)
        if reader.fieldnames is None:
            print("ERROR: Could not read CSV headers.", file=sys.stderr)
            sys.exit(1)

        # Build output fieldnames: original + 3 new columns
        out_fields = list(reader.fieldnames) + [
            "CFO_RUOLO_CATEGORY",
            "CFO_FOUND",
            "HAS_REAL_CFO",
        ]
        writer = csv.DictWriter(fout, fieldnames=out_fields)
        writer.writeheader()

        for row in reader:
            rows_in += 1
            fonte = row.get("FONTE", "").strip()
            confidenza = row.get("CONFIDENZA", "").strip().lower()
            raw_role = row.get("CFO_RUOLO", "").strip()

            # CFO_FOUND: any contact found
            cfo_found = fonte not in ("not_found", "") and bool(row.get("CFO_NOME", "").strip())

            # Normalize role
            if fonte == "not_found" or not cfo_found:
                category = "Not Found"
            else:
                category = normalize_role(raw_role)

            has_real = is_real_cfo(category, confidenza)

            row["CFO_RUOLO_CATEGORY"] = category
            row["CFO_FOUND"] = "true" if cfo_found else "false"
            row["HAS_REAL_CFO"] = "true" if has_real else "false"

            writer.writerow(row)
            rows_out += 1
            category_counts[category] = category_counts.get(category, 0) + 1
            if has_real:
                real_cfo_count += 1

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n✓ Cleaned {rows_in} rows → {OUTPUT_CSV}")
    print(f"\nCFO_RUOLO_CATEGORY distribution:")
    for cat, count in sorted(category_counts.items(), key=lambda x: -x[1]):
        pct = count / rows_in * 100
        print(f"  {cat:<30} {count:>4}  ({pct:.1f}%)")
    print(f"\n  HAS_REAL_CFO = true:        {real_cfo_count:>4}  ({real_cfo_count/rows_in*100:.1f}%)")
    not_found = category_counts.get("Not Found", 0)
    cfo_found_count = rows_in - not_found
    print(f"  CFO_FOUND = true:           {cfo_found_count:>4}  ({cfo_found_count/rows_in*100:.1f}%)")


if __name__ == "__main__":
    main()
