# Dashboard — Progress Tracking

> Use this file to resume work in new chat sessions.
> Update status immediately after completing each step.
> States: `[ ]` todo / `[x]` done / `[~]` in progress

## How to Resume

1. Read `docs/PRD.md` for the full spec
2. Read `docs/architecture/` for current DB schema and API routes
3. Read `docs/features/` for feature-specific docs
4. Check which steps are done below
5. Continue from the first `[ ]` or `[~]` step

---

## Progress

- [x] Step 0: `docs/PRD.md` and `docs/PROGRESS.md` created
- [x] Step 1: `scripts/clean_data.py` — normalize CFO_RUOLO, produce `public/data/2026_cleaned.csv`
  - 500 rows → 10 categories; HAS_REAL_CFO=true: 158 (31.6%); Other: 3 residual (Confindustria rep, intermediazione, direttore commerciale)
- [x] Step 2: Next.js 14 project setup (`create-next-app`) + shadcn/ui init + install deps (recharts, papaparse, @tanstack/react-table, react-simple-maps)
- [x] Step 3: Install shadcn components: dialog, select, badge, slider, input, button, card, table, tooltip, popover
- [x] Step 4: `src/types/index.ts` + `src/lib/data.ts` (parsing, cache, aggregations, filterCompanies)
- [x] Step 5: Layout + Navbar — apply `/frontend-design` skill, all UI in English
- [x] Step 6: Homepage — KpiGrid (5 cards), CfoQualityBreakdown (tricolor bar), Top10Table
- [x] Step 7: Explorer — FilterBar + CompanyTable (TanStack Table + shadcn Table)
- [x] Step 8: Charts base — TopSectorsBar, RoleDistributionPie (with "Other" modal), ConfidenceBar
- [x] Step 9: GrowthRevenueScatter + RegionMap (react-simple-maps + italy-regions.json)
- [x] Step 10: Build verification — `npm run build` passes 0 errors (Recharts v3 type fixes applied)
- [x] Step 11: Supabase auth + multi-team — profiles, teams, team_memberships, join_requests, middleware, /login, /join-team, /pending-approval, /admin/requests
- [x] Step 12: Team-scoped annotations — migration 002, `annotations` table con `team_id`, API `/api/annotations`, AnnotationModal
- [x] Step 13: Campagne LinkedIn outreach — migration 003, tabelle `campaigns` + `campaign_contacts`, 8 API routes, 10 componenti, pagine `/campaigns` e `/campaigns/[id]`, row selection nell'Explorer → vedere `docs/features/CAMPAIGNS.md`
- [x] Step 14: Docs restructure — `docs/` organizzato in `features/` e `architecture/`, regole di aggiornamento in `CLAUDE.md`

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
| 2026-03-11 | Campaign contacts stored separately from companies | Permette tracking per-campagna, deduplicazione, e future integrazioni con il plugin |
| 2026-03-11 | Optimistic updates per status contatto | Evita latenza percepita; rollback su errore |
| 2026-03-11 | `companies_full` view per join dei dati azienda nei contacts | Evita dipendenza dalla struttura interna della tabella companies |
