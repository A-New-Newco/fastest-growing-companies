# Dashboard — Progress Tracking

> Use this file to resume work in new chat sessions.
> Update status immediately after completing each step.
> States: `[ ]` todo / `[x]` done / `[~]` in progress

## How to Resume

1. Read `docs/PRD.md` for the full spec
2. Check which steps are done below
3. Continue from the first `[ ]` or `[~]` step

---

## Progress

- [x] Step 0: `docs/PRD.md` and `docs/PROGRESS.md` created
- [x] Step 1: `scripts/clean_data.py` — normalize CFO_RUOLO, produce `public/data/2026_cleaned.csv`
  - 500 rows → 10 categories; HAS_REAL_CFO=true: 158 (31.6%); Other: 3 residual (Confindustria rep, intermediazione, direttore commerciale)
- [ ] Step 2: Next.js 14 project setup (`create-next-app`) + shadcn/ui init + install deps (recharts, papaparse, @tanstack/react-table, react-simple-maps)
- [ ] Step 3: Install shadcn components: dialog, select, badge, slider, input, button, card, table, tooltip, popover
- [ ] Step 4: `src/types/index.ts` + `src/lib/data.ts` (parsing, cache, aggregations, filterCompanies)
- [ ] Step 5: Layout + Navbar — apply `/frontend-design` skill, all UI in English
- [ ] Step 6: Homepage — KpiGrid (5 cards), CfoQualityBreakdown (tricolor bar), Top10Table
- [ ] Step 7: Explorer — FilterBar + CompanyTable (TanStack Table + shadcn Table)
- [ ] Step 8: Charts base — TopSectorsBar, RoleDistributionPie (with "Other" modal), ConfidenceBar
- [ ] Step 9: GrowthRevenueScatter + RegionMap (react-simple-maps + italy-regions.json)

---

## Notes

- Input CSV: `../cfo-enricher/output/2026/enriched.csv` (relative to dashboard/)
- Output CSV: `public/data/2026_cleaned.csv`
- GeoJSON Italy regions: download from public source, save to `public/geo/italy-regions.json`
- All UI text must be in English; Italian data values (settore, regione, azienda) stay as-is
- "Real CFO": only roles CFO/DAF or Finance Manager with confidence medium or high (~28% of companies)
- "Other" slice in pie chart must open a shadcn Dialog with the full company list for manual review

---

## Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-03-07 | Static CSV in /public instead of API route | 500 rows = ~30KB gzipped; no server needed |
| 2026-03-07 | Recharts over Tremor | More controllable, native scatter plot, lighter bundle |
| 2026-03-07 | TanStack Table v8 | Declarative sort/filter, shadcn Table as render layer |
| 2026-03-07 | "Real CFO" = CFO/DAF or Finance Manager + medium/high confidence | 92.4% "contact found" is misleading; only ~28% are true finance officers |
