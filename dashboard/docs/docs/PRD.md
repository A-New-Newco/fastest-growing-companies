# PRD — Dashboard "Leader della Crescita 2026"

## Context

The file `cfo-enricher/output/2026/enriched.csv` contains 500 Italian companies enriched with CFO data, but no tool exists yet to explore, filter, and visualize this dataset. The goal is to create a professional BI dashboard in a new `dashboard/` folder (separate from cfo-enricher), with a preliminary data cleaning phase to normalize the `CFO_RUOLO` field (220+ heterogeneous values → 10 semantic categories).

**Language**: all dashboard UI is in **English** (labels, titles, tooltips, KPI cards, filters). Italian data (company name, sector, region) remains in its original language.

**Design**: use the `/frontend-design` skill for high-quality visual design implementation.

---

## 1. Executive Summary

**Problem Statement**: The 500-company CSV is inaccessible without tooling: impossible to filter by sector/region, visualize growth patterns, or analyze the quality of CFO data collected.

**Proposed Solution**: Next.js 14 dashboard with interactive table, analytical charts, and Italian regional map, fed by a clean CSV produced by a Python normalization script.

**Success Criteria**:
- 100% of 500 companies navigable with combined filters
- CFO_RUOLO normalized into ≤10 categories with ≥95% raw value coverage
- Initial dashboard load <2s (static CSV ~30KB gzipped)
- All charts rendered with real data, no placeholders

---

## 2. Dataset — Key Stats (from subagent analysis)

| Field | Detail |
|---|---|
| Total companies | 500 (RANK 1–500, complete) |
| GROWTH RATE | Min 8.8% — Max 503.4%, avg 38%, median 27% |
| REVENUE 2024 | 1.5M — 663M EUR, median 8.7M EUR |
| Sectors | 30 unique (top: IT 14%, Construction 12.4%, Machinery 7.4%) |
| Regions | 19/20 Italian regions (Valle d'Aosta missing), Lombardia 28.4% |
| Contact found | 462/500 (92.4%) — any contact found |
| **Real CFO/Finance** | **~142/500 (28.4%)** — only CFO/DAF or Finance Manager roles with medium/high confidence |
| LinkedIn present | 360/500 (72%) |
| CFO_RUOLO unique values | ~220 raw → 10 normalized categories |
| Confidence | high 15.4%, medium 17%, low 60%, not_found 7.6% |

---

## 3. Phase 0 — Data Cleaning Script

**File**: `dashboard/scripts/clean_data.py`
**Input**: `../cfo-enricher/output/2026/enriched.csv`
**Output**: `dashboard/public/data/2026_cleaned.csv`

### CFO_RUOLO Normalization (keyword regex mapping, top-down priority)

| Normalized Category | Keywords / Patterns |
|---|---|
| `CFO / DAF` | cfo, chief financial officer, direttore finanziario, head of finance, group cfo |
| `CEO / AD` | ceo, chief executive officer, amministratore delegato, managing director |
| `Finance Manager` | responsabile amministrativ*, responsabile finanz*, controller, accountant, contabile, direttore amministrativo, finance manager |
| `Founder / Owner` | founder, fondatore, co-founder, co-fondatore, titolare, owner |
| `Presidente` | presidente, president (as primary title only) |
| `General Manager` | direttore generale, general manager, managing partner |
| `Mixed Role` | combinations CEO+CFO, CEO+Founder, CFO+COO, etc. (patterns with "&", "e", "/" between different categories) |
| `Amministratore` | amministratore unico, amministratore, amministratrice |
| `Other` | unclassifiable roles |
| `Not Found` | fonte==not_found or empty cfo_nome |

### Additional Cleaning Operations
- Pre-process: remove proper names prefixed to role (pattern `"Nome Cognome - Ruolo"`)
- Add column `CFO_RUOLO_CATEGORY` (normalized value)
- Add column `CFO_FOUND` (boolean: true if fonte != not_found)
- Add column `HAS_REAL_CFO` (boolean): `true` only if `CFO_RUOLO_CATEGORY IN ['CFO / DAF', 'Finance Manager']` AND `confidenza IN ['high', 'medium']`
- Validate CSV quoting for sectors with commas (e.g. `"Fintech, servizi finanziari e assicurazioni"`)

### Key Distinction: "Contact Found" vs "Real CFO/Finance"

This distinction is central to the dashboard. The traditional "CFO found" KPI (92.4%) is misleading: in reality only ~28% have a true financial officer identified. Three categories to show explicitly:

| Level | Definition | Estimate |
|---|---|---|
| **Real CFO/Finance** | `CFO_RUOLO_CATEGORY IN ['CFO / DAF', 'Finance Manager']` + confidence medium/high | ~142 companies |
| **Contact Found (non-CFO)** | Name found but role is CEO, Founder, Amministratore, etc. | ~320 companies |
| **Not Found** | fonte == not_found | ~38 companies |

---

## 4. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Next.js 14 App Router + TypeScript | File-based routing, Server Components for layout |
| Styling | Tailwind CSS + **shadcn/ui** | shadcn provides accessible components (Dialog, Select, Badge, Slider) integrated with Tailwind |
| Charts | Recharts | Native scatter plot, controllable, lighter bundle vs Tremor; compatible with shadcn |
| Table | TanStack Table v8 | Declarative sorting/filtering; shadcn provides `<Table>` primitive as render layer |
| Map | react-simple-maps + GeoJSON Italy | SVG choropleth without API key |
| CSV parsing | papaparse | Client-side standard, typed |
| Data serving | Static file `/public/data/2026_cleaned.csv` | 500 rows ~30KB gzipped, fully client-side |

**shadcn/ui components to install**: `dialog`, `select`, `badge`, `slider`, `input`, `button`, `card`, `table`, `tooltip`, `popover`

---

## 5. Folder Structure

```
dashboard/
├── docs/
│   ├── PRD.md             ← this file
│   └── PROGRESS.md        ← step-by-step progress tracking
├── scripts/
│   └── clean_data.py
├── public/
│   ├── data/
│   │   └── 2026_cleaned.csv
│   └── geo/
│       └── italy-regions.json
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx               # Overview / Homepage
│   │   ├── explorer/page.tsx      # Interactive table
│   │   └── charts/page.tsx        # Analytical visualizations
│   ├── components/
│   │   ├── overview/              # KpiCard, KpiGrid, CfoQualityBreakdown, Top10Table
│   │   ├── explorer/              # CompanyTable, FilterBar, SearchInput
│   │   ├── charts/                # GrowthRevenueScatter, TopSectorsBar,
│   │   │                          #   RegionMap, RoleDistributionPie, ConfidenceBar
│   │   └── ui/                    # (shadcn auto-generated)
│   ├── lib/
│   │   ├── data.ts                # CSV parsing, cache, aggregations
│   │   └── constants.ts           # sector colors, category labels
│   └── types/
│       └── index.ts               # Company, FilterState, RuoloCategory
```

---

## 6. TypeScript Data Schema

```typescript
// src/types/index.ts
export type Confidenza = 'high' | 'medium' | 'low' | null;
export type RuoloCategory =
  | 'CFO / DAF' | 'CEO / AD' | 'Finance Manager' | 'Founder / Owner'
  | 'Presidente' | 'General Manager' | 'Mixed Role' | 'Amministratore'
  | 'Other' | 'Not Found';

export interface Company {
  rank: number;
  azienda: string;
  tassoCrescita: number;       // CAGR percentage
  ricavi2021: number;          // thousands EUR
  ricavi2024: number;          // thousands EUR
  settore: string;
  regione: string;
  presenze: number;            // 0–7 (times appeared in ranking)
  sitoWeb: string;
  cfoNome: string | null;
  cfoRuolo: string | null;     // original raw value
  cfoRuoloCategory: RuoloCategory;
  cfoLinkedin: string | null;
  confidenza: Confidenza;
  cfoFound: boolean;           // true if fonte != not_found (any contact)
  hasRealCfo: boolean;         // true only if CFO/DAF or Finance Manager + confidence medium/high
}

export interface FilterState {
  search: string;
  settori: string[];
  regioni: string[];
  confidenza: Confidenza[];
  minGrowth: number;
  maxGrowth: number;
  cfoFoundOnly: boolean;
}
```

---

## 7. Key Components

### Homepage (`/`) — Overview
- **KpiGrid**: 5 cards — Total Companies, Avg. Growth Rate, **Real CFO Identified** (with tooltip explaining distinction from "contact found"), Sectors, Top Region
- **CfoQualityBreakdown**: 3-level stacked bar or tricolor progress bar (Real CFO / Contact Found / Not Found)
- **Top10Table**: static table of top 10 by RANK

### Explorer (`/explorer`) — Interactive Table
- **FilterBar**: multi-select sector (30 values), region (19), growth range slider, CFO found toggle, confidence filter, reset
- **CompanyTable**: TanStack Table — columns RANK, COMPANY, SECTOR, REGION, GROWTH, REVENUE 2024, CFO NAME, CFO ROLE CATEGORY, CONFIDENCE; pagination 25/50/100; colored confidence badge; LinkedIn link icon

### Charts (`/charts`) — Visualizations
- **GrowthRevenueScatter**: X=log(REVENUE 2024), Y=GROWTH RATE, color=sector, company tooltip
- **TopSectorsBar**: top 15 sectors by avg growth (horizontal bar)
- **RegionMap**: Italy SVG choropleth, color=company density, tooltip with avg growth
- **RoleDistributionPie**: CFO_RUOLO_CATEGORY distribution (pie/donut) — "Other" slice is **clickable**: opens shadcn `<Dialog>` listing all companies in that category (name, raw role, LinkedIn link) for manual review
- **ConfidenceBar**: high/medium/low/not_found distribution, colors consistent with table badge

---

## 8. User Stories

| Story | Acceptance Criteria |
|---|---|
| Explore ranking with filters | Combined filters (sector + region + growth) update table in <100ms |
| Search company or CFO by name | Search field filters COMPANY and CFO_NAME in real time |
| Understand how many have a real CFO | "Real CFO Identified" KPI distinct from "contact found"; tricolor breakdown on homepage |
| Assess CFO data quality | Confidence badge visible in table; confidence distribution chart |
| Analyze growth by sector | Bar chart shows top sectors ordered by avg CAGR |
| Identify geographic concentration | Regional map shows density with color gradient |
| Understand what type of contacts were found | Pie chart shows split: real CFO vs CEO/Founder/etc. |
| Review "Other" category | Click "Other" slice → modal with full company list + raw role + LinkedIn |

### Non-Goals (out of MVP scope)
- User authentication
- Persistent database / backend API
- Multi-year comparison (2026 only)
- CSV export from dashboard (optional Phase 2)
- Company detail page `/company/[rank]` (optional Phase 2)

---

## 9. Implementation Plan

### Phase 1 — MVP
- [ ] Step 0: Create `dashboard/docs/PRD.md` and `dashboard/docs/PROGRESS.md`
- [ ] Step 1: `clean_data.py` — normalize CFO_RUOLO, add `CFO_RUOLO_CATEGORY`, `CFO_FOUND`, `HAS_REAL_CFO`
- [ ] Step 2: Next.js setup — `create-next-app` + shadcn/ui init + dependencies
- [ ] Step 3: Install shadcn components (dialog, select, badge, slider, input, button, card, table, tooltip)
- [ ] Step 4: `types/index.ts` + `lib/data.ts` with parsing, aggregations, `filterCompanies()`
- [ ] Step 5: Layout + Navbar (using `/frontend-design` skill) — all UI in English
- [ ] Step 6: Homepage (KpiGrid, CfoQualityBreakdown, Top10Table)
- [ ] Step 7: Explorer (FilterBar + CompanyTable)
- [ ] Step 8: Charts base (TopSectorsBar, RoleDistributionPie with "Other" modal, ConfidenceBar)
- [ ] Step 9: GrowthRevenueScatter + RegionMap (static GeoJSON)

### Phase 2 — Optional
- Company detail page `/company/[rank]`
- CSV export of filtered results
- Appearances chart (serial ranking veterans)
- Sector × Region heatmap

---

## 10. End-to-End Verification

1. `cd dashboard && python scripts/clean_data.py` → verify `public/data/2026_cleaned.csv` exists with `CFO_RUOLO_CATEGORY` column
2. `npm run dev` → dashboard accessible at `localhost:3000`
3. Homepage: 5 KPI cards show real values (500 companies, avg growth ~38%, ~28% real CFO)
4. Explorer: filter "Sector = IT e software" → 70 results; confidence "high" filter → 77 results
5. Charts: scatter plot shows 500 colored points by sector; map shows Lombardia darkest
6. Pie chart: "CFO / DAF" slice ~13%, "CEO / AD" ~13%, "Finance Manager" ~18%
7. Click "Other" slice on pie → modal opens with list of companies
