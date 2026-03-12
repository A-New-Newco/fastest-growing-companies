# Company Detail Modal

## Context and Purpose

The Explorer table shows a dense view of companies but exposes only a subset of available fields. The Company Detail Modal provides a full read-only view of all company and contact data, triggered by clicking a company name in the table. Annotations can also be edited inline from the modal.

## Trigger

- Click on a **company name** in the Explorer table (`/explorer`)
- The name cell has `cursor-pointer` + `hover:text-indigo-600` visual cues

## File Structure

| File | Role |
|------|------|
| `src/components/explorer/CompanyDetailModal.tsx` | **NEW** — modal component |
| `src/components/explorer/CompanyTable.tsx` | **MODIFIED** — added `onCompanyClick` prop; company name is now a clickable button |
| `src/app/explorer/page.tsx` | **MODIFIED** — added `selectedCompany` state; renders `CompanyDetailModal`; `handleAnnotationSave` also updates `selectedCompany` |

## Modal Sections

### Company
- Website (external link, hidden if `n/a`)
- Sector
- Region
- Appearances in ranking (`presenze`)

### Financials
- Growth Rate (bold %)
- Revenue (base year) — `ricavi2021`
- Revenue '24 — `ricavi2024`

### CFO / Finance Contact
- Name + confidence badge
- Role (raw `cfoRuolo`) + role category badge
- LinkedIn (external link)
- If no contact found: italic placeholder

### Annotations
- Read-only display of `contactLeft`, `lowQuality`, and `note` flags
- **Edit** button opens the existing `AnnotationModal` on top
- When annotation is saved, both `companies` state and `selectedCompany` state are updated in `page.tsx`

## Component Props

```typescript
interface Props {
  company: Company | null;
  onClose: () => void;
  onAnnotationSave?: (companyId: string, annotation: Omit<Annotation, "companyId">) => void;
}
```

## Main Flows

1. User clicks company name → `setSelectedCompany(company)` → `CompanyDetailModal` opens
2. User reviews company info, financials, contact
3. User clicks **Edit** in Annotations → `AnnotationModal` opens on top (Radix Dialog stacking)
4. User saves annotation → `handleAnnotationSave` updates both `companies[]` and `selectedCompany`; annotation modal closes; detail modal shows updated data
5. User presses Escape or clicks outside → modal closes, `setSelectedCompany(null)`

## Notable Behaviors

- **No new API routes**: all data comes from the `Company` object already loaded by `loadCompanies()`
- **Annotation state sync**: `handleAnnotationSave` in `page.tsx` was extended to also update `selectedCompany` so the detail modal reflects the latest annotation after editing
- **Nested dialogs**: uses Radix UI Dialog stacking (both dialogs can be open simultaneously; inner dialog blocks outer); outer dialog `onOpenChange` guards against calling `onClose` while annotation modal is open
- **Data origin badge**: imported companies show a violet `imported` badge in the header

## Future Roadmap

- Add quick-action buttons (Add to Campaign, Find LinkedIn) directly in the modal footer
- Show enrichment metadata (source, search date) when available
- Support keyboard navigation between companies (← →) without closing the modal
