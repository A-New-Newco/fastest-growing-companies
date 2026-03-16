# Enrichment Categories (CFO vs LinkedIn)

## Context and Purpose

Enrichment Sessions originally only supported one task: finding the CFO / head of finance for a company. With this feature, sessions now support two distinct **enrichment categories**:

| Category | Goal | Input | Output |
|----------|------|-------|--------|
| **CFO** (`cfo`) | Discover the finance contact for a company | Company name + website | `result_nome`, `result_ruolo`, `result_linkedin`, `result_confidenza` |
| **LinkedIn** (`linkedin`) | Find the LinkedIn URL for a *known* contact | Company name + contact name + contact role | `result_linkedin`, `result_confidenza` |

The category is chosen at session creation and is immutable for the life of the session.

---

## Data Model

### Migration: `012_enrichment_category.sql`

Two changes:

1. **`enrichment_sessions.enrichment_category`** — `TEXT NOT NULL DEFAULT 'cfo'` with `CHECK (enrichment_category IN ('cfo', 'linkedin'))`. Discriminates the type of enrichment the session performs.

2. **`enrichment_session_companies.contact_nome`** / **`contact_ruolo`** — `TEXT` nullable. Store the known contact name and role as *input* for LinkedIn sessions. NULL for CFO sessions where the contact is discovered by enrichment.

### Type changes (`src/types/index.ts`)

- `EnrichmentCategory = "cfo" | "linkedin"` — new type
- `EnrichmentSession.enrichmentCategory` — maps to `enrichment_category` column
- `CreateEnrichmentSessionInput.enrichmentCategory?` — optional, defaults to `"cfo"`

---

## File Structure

### Modified files

```
dashboard/supabase/migrations/012_enrichment_category.sql   — New migration

dashboard/src/types/index.ts                                 — EnrichmentCategory type, added to session/input interfaces
dashboard/src/components/enrichment/CreateSessionModal.tsx    — Category selector (Step 1)
dashboard/src/components/enrichment/CompanyEnrichmentTable.tsx — Adapts visible columns by category
dashboard/src/components/enrichment/EnrichmentSessionCard.tsx — Shows category badge
dashboard/src/app/enrichment/[id]/page.tsx                   — Passes category to child components

dashboard/src/app/api/enrichment-sessions/route.ts           — POST accepts enrichmentCategory, stores it
dashboard/src/app/api/enrichment-sessions/[id]/route.ts      — GET returns enrichment_category
dashboard/src/app/api/enrichment-sessions/[id]/stream/route.ts — Branches by category (CFO vs LinkedIn logic)
dashboard/src/app/api/enrichment-sessions/[id]/apply/route.ts  — Apply logic branches by category
dashboard/src/app/api/enrichment-sessions/[id]/companies/[companyRowId]/apply/route.ts — Single apply branches by category

dashboard/src/app/api/companies/search/route.ts              — New hasCfo / noLinkedin filter params
dashboard/src/lib/linkedin-finder.ts                         — findLinkedIn() return type changed
```

---

## Main Flows

### 1. Session Creation

1. User clicks "New Session" in the enrichment page.
2. `CreateSessionModal` Step 1 shows a **category selector** with two options:
   - **CFO Search** (icon: UserSearch) — "Find finance head"
   - **LinkedIn Search** (icon: Linkedin) — "Find LinkedIn URL"
3. Selecting a category resets the company selection (different companies are relevant for each).
4. Step 2: company search. For LinkedIn sessions, the search API is called with `hasCfo=true&noLinkedin=true` to show only companies that have a known contact but no LinkedIn URL.
5. On submit, `POST /api/enrichment-sessions` stores `enrichment_category` on the session row. For LinkedIn sessions, `contact_nome` and `contact_ruolo` are stored on each company row.

### 2. Stream Execution (category branching)

The stream route (`GET /api/enrichment-sessions/[id]/stream`) reads `enrichment_category` from the session and branches:

**CFO category** (unchanged):
- Remote mode: Groq model pool with `cfo-finder-prompt.ts`
- Local mode: proxies to `cfo-enricher` on port 8765

**LinkedIn category**:
- Remote mode: calls `findLinkedIn()` from `linkedin-finder.ts` per company. Returns `{ url, tokensInput, tokensOutput, modelUsed }`.
- Local mode: proxies to `linkedin-enricher` on port 8766 via `handleLinkedInLocalStream()`.

### 3. Apply Results (category branching)

The apply routes (`POST .../apply`) branch by category:
- **CFO**: writes `result_nome`, `result_ruolo`, `result_linkedin`, `result_confidenza` to source tables.
- **LinkedIn**: writes only `result_linkedin` to source tables (the contact name/role are already known).

### 4. UI Adaptation

- `EnrichmentSessionCard` shows a category badge (e.g., "CFO" or "LinkedIn").
- `CompanyEnrichmentTable` adapts its visible columns: LinkedIn sessions show the input contact name/role and the found URL; CFO sessions show the full discovered contact fields.

---

## Search API Filters

`GET /api/companies/search` gained two new boolean query params:

| Param | Effect |
|-------|--------|
| `hasCfo=true` | Filters to companies where `cfo_nome IS NOT NULL` |
| `noLinkedin=true` | Filters to companies where `cfo_linkedin IS NULL` |

These are used by `CreateSessionModal` in LinkedIn mode to show only companies eligible for LinkedIn enrichment (known contact, missing LinkedIn URL).

---

## `findLinkedIn()` Return Type

The function in `src/lib/linkedin-finder.ts` now returns a structured object instead of `string | null`:

```typescript
interface LinkedInFinderResult {
  url: string | null;
  tokensInput: number;
  tokensOutput: number;
  modelUsed: string | null;
}
```

This enables per-company token tracking in LinkedIn enrichment sessions, consistent with CFO sessions.

---

## Notable Behaviors

- Category is immutable after session creation (no migration between CFO and LinkedIn).
- Default category is `"cfo"` for backward compatibility with existing sessions.
- The `contact_nome` / `contact_ruolo` columns are NULL for CFO sessions and populated for LinkedIn sessions.
- LinkedIn local mode uses port 8766 (linkedin-enricher), while CFO local mode uses port 8765 (cfo-enricher).

---

## Future Roadmap

- [ ] Category filter on the enrichment sessions list page
- [ ] Bulk "find LinkedIn for all CFO-enriched companies" one-click flow
- [ ] Additional categories (e.g., email enrichment, company data enrichment)
