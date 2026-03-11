# Database — Schema e RLS

> Supabase (PostgreSQL) con Row-Level Security team-scoped.
> Aggiornato al: 2026-03-11

---

## Migrations

| File | Contenuto |
|---|---|
| `001_auth_and_teams.sql` | profiles, teams, team_memberships, join_requests, annotations (+ RLS) |
| `002_team_scoped_annotations.sql` | aggiunge `team_id` ad annotations, riscrive RLS |
| `003_campaigns.sql` | campaigns, campaign_contacts, enum campaign_status/contact_status |

---

## Tabelle e viste

### `auth.users`
Managed da Supabase Auth. Trigger `on_auth_user_created` crea automaticamente un record in `profiles`.

---

### `profiles`
Mirror 1:1 di `auth.users`.

| Colonna | Tipo |
|---|---|
| `id` | uuid PK (FK → auth.users) |
| `email` | text |
| `full_name` | text nullable |
| `avatar_url` | text nullable |
| `created_at` | timestamptz |

**RLS**: lettura propria + lettura da tutti i membri di un team.

---

### `teams`

| Colonna | Tipo |
|---|---|
| `id` | uuid PK |
| `name` | text |
| `slug` | text UNIQUE |
| `created_at` | timestamptz |

Default: team `reef` seedato in migration 001.
**RLS**: lettura a tutti gli autenticati.

---

### `team_memberships`

| Colonna | Tipo | Note |
|---|---|---|
| `id` | uuid PK | |
| `team_id` | uuid FK → teams | |
| `user_id` | uuid FK → profiles | |
| `role` | enum `membership_role` | `admin` \| `member` |
| `created_at` | timestamptz | |
| UNIQUE | `(team_id, user_id)` | |

**RLS**: lettura solo della propria membership (`user_id = auth.uid()`).

---

### `join_requests`

| Colonna | Tipo | Note |
|---|---|---|
| `id` | uuid PK | |
| `team_id` | uuid FK → teams | |
| `user_id` | uuid FK → profiles | |
| `status` | enum `request_status` | `pending` \| `approved` \| `rejected` |
| `message` | text nullable | |
| `reviewed_by` | uuid FK → profiles nullable | |
| `reviewed_at` | timestamptz nullable | |
| `created_at` | timestamptz | |
| UNIQUE | `(team_id, user_id)` | |

**RLS**: inserimento/lettura propria; lettura e update da admin del team.

---

### `annotations`

| Colonna | Tipo | Note |
|---|---|---|
| `id` | uuid PK | |
| `company_id` | uuid FK → companies | |
| `team_id` | uuid FK → teams | aggiunto in migration 002 |
| `user_id` | uuid FK → profiles | |
| `contact_left` | boolean | |
| `low_quality` | boolean | |
| `note` | text nullable | |
| `updated_at` | timestamptz | |
| UNIQUE | `(team_id, company_id)` | una annotation per company per team |

**RLS**: CRUD solo ai membri del team (`team_memberships` check).

---

### `campaigns`

| Colonna | Tipo | Note |
|---|---|---|
| `id` | uuid PK | |
| `team_id` | uuid FK → teams | |
| `name` | text | |
| `description` | text nullable | |
| `status` | enum `campaign_status` | `draft` \| `active` \| `paused` \| `completed` \| `archived` |
| `created_by` | uuid FK → profiles | |
| `created_at` / `updated_at` | timestamptz | trigger `set_updated_at()` |

**RLS**: CRUD ai membri del team.
**Indici**: `team_id`, `status`.

---

### `campaign_contacts`

| Colonna | Tipo | Note |
|---|---|---|
| `id` | uuid PK | |
| `campaign_id` | uuid FK → campaigns CASCADE | |
| `company_id` | uuid FK → companies | |
| `contact_name` | text nullable | pre-filled da cfo_nome |
| `contact_role` | text nullable | pre-filled da cfo_ruolo |
| `contact_linkedin` | text nullable | pre-filled da cfo_linkedin |
| `status` | enum `contact_status` | `pending` \| `contacted` \| `replied` \| `meeting_scheduled` \| `converted` \| `not_interested` \| `no_reply` |
| `notes` | text nullable | |
| `contacted_at` | timestamptz nullable | auto-set API al primo cambio → `contacted` |
| `replied_at` | timestamptz nullable | auto-set API al primo cambio → `replied` |
| `added_by` | uuid FK → profiles | |
| `added_at` / `updated_at` | timestamptz | trigger `set_updated_at()` |
| UNIQUE | `(campaign_id, company_id)` | |

**RLS**: CRUD ai membri del team (join attraverso `campaigns.team_id`).
**Indici**: `campaign_id`, `company_id`, `status`.

---

### `companies_full` (VIEW)

Vista materializzata che combina company data + contacts enrichment + annotations. Usata come fonte principale dal dashboard.

**Colonne principali** (come esposto dalla view):

| Colonna | Note |
|---|---|
| `id` | UUID company |
| `name` | nome azienda |
| `rank` | posizione nel ranking |
| `sector` | settore (italiano) |
| `region` | regione (italiano) |
| `website` | sito web |
| `growth_rate` | CAGR % |
| `appearances` | presenze nel ranking (0–7) |
| `financials` | `{ revenue_start, revenue_end }` (in migliaia €) |
| `year` | anno del ranking |
| `cfo_nome` | nome contatto |
| `cfo_ruolo` | ruolo raw |
| `cfo_ruolo_category` | categoria normalizzata |
| `cfo_linkedin` | URL LinkedIn |
| `confidenza` | `high` \| `medium` \| `low` \| null |
| `contact_left` | da annotations |
| `low_quality` | da annotations |
| `annotation_note` | da annotations |

`GRANT SELECT ON companies_full TO authenticated` — applicato in migration 001.

---

## Enum custom

| Enum | Valori |
|---|---|
| `membership_role` | `admin`, `member` |
| `request_status` | `pending`, `approved`, `rejected` |
| `campaign_status` | `draft`, `active`, `paused`, `completed`, `archived` |
| `contact_status` | `pending`, `contacted`, `replied`, `meeting_scheduled`, `converted`, `not_interested`, `no_reply` |

---

## Nota sui client Supabase

| Client | File | Uso |
|---|---|---|
| Server (anon) | `src/lib/supabase/server.ts` | Letture in API routes, RLS attiva |
| Admin (service role) | `src/lib/supabase/admin.ts` | Scritture in API routes, bypassa RLS |
| Client (anon) | `src/lib/supabase/client.ts` | Letture dirette nei componenti, RLS attiva |
