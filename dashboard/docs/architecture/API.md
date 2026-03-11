# API Routes

> Tutti i route sono in `src/app/api/`. Pattern comune: auth check → team resolution → admin client per le mutazioni.
> Aggiornato al: 2026-03-11

---

## Pattern di autenticazione

```typescript
const supabase = createServerSupabaseClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

// Per operazioni team-scoped:
const { data: membership } = await supabase
  .from("team_memberships").select("team_id").eq("user_id", user.id).maybeSingle();
if (!membership) return NextResponse.json({ error: "Not a team member" }, { status: 403 });

// Per mutazioni (bypassa RLS):
const admin = createAdminSupabaseClient();
```

---

## Annotations

### `GET /api/annotations`
Recupera le annotations del team per un dato anno.

| Param | Tipo | Default |
|---|---|---|
| `year` | query string | `2026` |
| `country` | query string | `IT` (`all` per tutte) |

**Auth**: team member. Usa client server (RLS).

---

### `POST /api/annotations`
Upsert di una annotation (una per company per team).

**Body**: `{ company_id, contact_left, low_quality, note }`
**Conflict**: `(team_id, company_id)`

---

## Team / Admin

### `POST /api/team/join-request`
Crea una richiesta di accesso al team.

**Body**: `{ team_id?, message? }`
**Auth**: autenticato (non necessariamente membro).

---

### `POST /api/admin/review-request`
Approva o rifiuta una join request.

**Body**: `{ request_id, action: "approved" | "rejected" }`
**Auth**: admin del team.

---

### `GET /api/auth/callback`
Callback OAuth di Supabase. Redirect post-login.

---

## Campaigns

### `GET /api/campaigns`
Lista le campagne del team con stats aggregate (total/contacted/replied/converted).

**Auth**: team member.
**Returns**: `Campaign[]` con campi computed.

---

### `POST /api/campaigns`
Crea una nuova campagna.

**Body**: `{ name: string, description?: string }`
**Auth**: team member. Setta `team_id` e `created_by` dal server.

---

### `GET /api/campaigns/[id]`
Dettaglio campagna con stats aggregate.

**Auth**: team member (RLS verifica team scope).

---

### `PATCH /api/campaigns/[id]`
Aggiorna nome, descrizione o status.

**Body**: `{ name?, description?, status? }`

---

### `DELETE /api/campaigns/[id]`
Elimina la campagna (cascade su `campaign_contacts`).

---

### `GET /api/campaigns/[id]/contacts`
Lista i contatti della campagna con dati azienda (`name`, `sector`, `region`) joinati da `companies_full`.

**Returns**: `CampaignContact[]`

---

### `POST /api/campaigns/[id]/contacts`
Aggiunge in bulk aziende come contatti. Upsert safe su `(campaign_id, company_id)`.

**Body**:
```json
{
  "companies": [
    { "companyId": "uuid", "contactName": "...", "contactRole": "...", "contactLinkedin": "..." }
  ]
}
```

---

### `PATCH /api/campaigns/[id]/contacts/[contactId]`
Aggiorna status, note e dati contatto.

**Body**: `{ status?, notes?, contactName?, contactRole?, contactLinkedin? }`

**Comportamento automatico**:
- `contacted_at` settato al primo cambio verso `contacted`
- `replied_at` settato al primo cambio verso `replied` / `meeting_scheduled` / `converted`

---

### `DELETE /api/campaigns/[id]/contacts/[contactId]`
Rimuove un contatto dalla campagna.

---

## Companies

### `GET /api/companies/search`
Ricerca aziende nella `companies_full` view per nome. Usato da `AddContactsModal`.

| Param | Tipo | Default |
|---|---|---|
| `search` | query string | `""` (tutti) |
| `limit` | number | `30` (max 100) |
| `year` | number | `2026` |
| `country` | query string | opzionale (`IT`, `DE`, ... oppure `all`) |

**Returns**: array di `{ id, azienda, settore, regione, country, cfo_nome, cfo_ruolo, cfo_linkedin }`

---

## Middleware

**File**: `src/middleware.ts`

| Tipo route | Esempi | Comportamento |
|---|---|---|
| Public | `/login`, `/signup`, `/auth/callback` | Accesso libero |
| Limbo | `/join-team`, `/pending-approval`, `/api/team/join-request` | Solo per utenti senza membership |
| Protected | tutto il resto | Richiede auth + membership |
| Admin | `/admin/*` | Richiede `role = admin` |

Gestisce anche il refresh automatico del token Supabase via `supabase.auth.getUser()`.

---

## Enrichment Sessions (aggiunto 2026-03-11)

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/enrichment-sessions` | List team's sessions with progress counters |
| POST | `/api/enrichment-sessions` | Create session + company rows |
| GET | `/api/enrichment-sessions/[id]` | Session detail |
| PATCH | `/api/enrichment-sessions/[id]` | Update name / status (pause) / model_config |
| DELETE | `/api/enrichment-sessions/[id]` | Delete (blocked if running) |
| GET | `/api/enrichment-sessions/[id]/companies` | Paginated company rows with logs |
| **GET** | **`/api/enrichment-sessions/[id]/stream`** | **SSE — runs enrichment, streams events** |
| POST | `/api/enrichment-sessions/[id]/apply` | Apply all done results to source tables |
| POST | `/api/enrichment-sessions/[id]/companies/[companyRowId]/apply` | Apply single result |

### SSE stream events
`session_start`, `company_start`, `log`, `company_done`, `session_progress`, `heartbeat`, `session_complete`, `session_paused`, `error`

See `dashboard/docs/features/ENRICHMENT_SESSIONS.md` for full event payloads.
