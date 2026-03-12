# LinkedIn Profile Search

## Context and purpose

Allows users to find the LinkedIn personal profile of a known contact (CFO/finance role) directly from the Explorer table. Uses the search pattern `{companyName} {contactName} site:linkedin.com` which reliably returns the correct profile as the first web result. Found URLs are validated and saved back to the source record automatically.

## Main flows

### Single-row action
1. Any row with a known contact name (`cfoNome != null`) shows a **Search** (magnifier) icon in the actions column on hover.
2. Clicking it triggers `POST /api/linkedin-search` for that row.
3. The icon changes to a spinner while searching, then to a green checkmark (found) or grey ✗ (not found) for 3 seconds.
4. On success the `cfoLinkedin` cell updates live without a page reload.

### Bulk action
1. In selection mode, the floating action bar shows a **Find LinkedIn** button (blue).
2. The button is disabled if none of the selected companies has a known contact name.
3. Clicking opens `LinkedInSearchModal`, which lists the eligible selected companies.
4. "Start Search" runs sequential API calls, showing per-row progress (spinner → ✓ URL | ✗ not found).
5. Found URLs are auto-saved; the modal shows a summary (e.g. "Found 4 of 6 profiles").
6. On close, row selection is cleared and the table reflects the new LinkedIn URLs.

## Data model

No schema changes. The feature writes to existing fields:

| Company type | Table | Column |
|---|---|---|
| `curated` | `contacts` | `linkedin` (matched via `company_id`) |
| `imported` | `imported_companies` | `cfo_linkedin` (matched via `id`) |

If a curated company has no `contacts` row yet, one is inserted with `company_id`, `name` (from `contactName`), and `linkedin`.

## File structure

### New files
- `dashboard/src/app/api/linkedin-search/route.ts` — `POST` endpoint
- `dashboard/src/components/linkedin/LinkedInSearchModal.tsx` — bulk search modal

### Modified files
- `dashboard/src/components/explorer/CompanyTable.tsx` — single-row action, bulk button, modal integration, `onLinkedInUpdate` prop
- `dashboard/src/app/explorer/page.tsx` — wires `handleLinkedInUpdate` callback

## LinkedIn URL validation

- Must match `linkedin.com/in/{slug}` (personal profile)
- Any URL containing `/company/` is rejected
- Normalised to `https://www.linkedin.com/in/{slug}` (no trailing slash)

## Groq details

- **Model**: `compound-beta-mini` — includes built-in Brave web search, no tool configuration needed
- **Endpoint**: `https://api.groq.com/openai/v1/chat/completions`
- **Env var**: `GROQ_API_KEY` (already used by the import mapper)
