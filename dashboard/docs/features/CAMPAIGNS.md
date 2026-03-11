# Feature: Campagne — LinkedIn Outreach

> Documento di riferimento per la sezione Campagne del dashboard.
> Aggiornato al: 2026-03-11

---

## Panoramica

La sezione **Campagne** permette al team Reef di creare e gestire campagne di outreach LinkedIn verso i contatti CFO/Finance delle aziende nel ranking. I contatti vengono aggiunti manualmente (o dall'Explorer con selezione multipla) e il loro stato viene tracciato attraverso un funnel di conversione.

---

## Lifecycle degli stati

### Campagna

```
draft → active → paused → completed
                         ↘ archived
```

| Stato | Colore | Significato |
|---|---|---|
| `draft` | grigio | In configurazione, non ancora avviata |
| `active` | verde | Outreach in corso |
| `paused` | ambra | Temporaneamente sospesa |
| `completed` | indigo | Conclusa con successo |
| `archived` | grigio chiaro | Nascosta dalla vista principale |

### Contatto per campagna

```
pending → contacted → replied → meeting_scheduled → converted
                              ↘ not_interested
contacted → no_reply
```

| Stato | Colore | Significato |
|---|---|---|
| `pending` | grigio | Aggiunto ma non ancora contattato |
| `contacted` | blu | Messaggio LinkedIn inviato |
| `replied` | ambra | Il contatto ha risposto |
| `meeting_scheduled` | viola | Meeting prenotato |
| `converted` | verde | Obiettivo raggiunto |
| `not_interested` | rosso | Ha declinato esplicitamente |
| `no_reply` | grigio scuro | Nessuna risposta dopo follow-up |

---

## Database

### Migration
File: `supabase/migrations/003_campaigns.sql`

**Da eseguire nel Supabase SQL editor prima di avviare l'app.**

### Schema

#### Tabella `campaigns`
| Colonna | Tipo | Note |
|---|---|---|
| `id` | uuid PK | auto-generato |
| `team_id` | uuid FK → teams | RLS su team |
| `name` | text | obbligatorio |
| `description` | text nullable | opzionale |
| `status` | enum campaign_status | default `draft` |
| `created_by` | uuid FK → profiles | |
| `created_at` / `updated_at` | timestamptz | auto-managed da trigger |

#### Tabella `campaign_contacts`
| Colonna | Tipo | Note |
|---|---|---|
| `id` | uuid PK | |
| `campaign_id` | uuid FK → campaigns | cascade delete |
| `company_id` | uuid FK → companies | |
| `contact_name` | text nullable | pre-filled da cfo_nome |
| `contact_role` | text nullable | pre-filled da cfo_ruolo |
| `contact_linkedin` | text nullable | pre-filled da cfo_linkedin |
| `status` | enum contact_status | default `pending` |
| `notes` | text nullable | note libere inline |
| `contacted_at` | timestamptz nullable | auto-set quando status → `contacted` |
| `replied_at` | timestamptz nullable | auto-set quando status → `replied` |
| `added_by` | uuid FK → profiles | |
| `added_at` / `updated_at` | timestamptz | auto-managed |
| UNIQUE | `(campaign_id, company_id)` | una sola entry per azienda per campagna |

### RLS
Entrambe le tabelle sono accessibili solo ai membri del team tramite `team_memberships`. Le policy di `campaign_contacts` joinano attraverso `campaigns.team_id`.

---

## Struttura file

### API Routes
```
src/app/api/
  campaigns/
    route.ts                        # GET (lista + stats), POST (crea)
    [id]/
      route.ts                      # GET, PATCH (nome/desc/status), DELETE
      contacts/
        route.ts                    # GET (lista con company data), POST (bulk add)
        [contactId]/
          route.ts                  # PATCH (status/notes/contatto), DELETE
  companies/
    search/
      route.ts                      # GET ?search=&limit=&year= (usato da AddContactsModal)
```

### Componenti
```
src/components/campaigns/
  CampaignStatusBadge.tsx           # Badge colorato per stato campagna
  ContactStatusBadge.tsx            # Badge colorato per stato contatto
  CampaignCard.tsx                  # Card con stats e progress bar
  CampaignStatsSummary.tsx          # 4 stat card nel dettaglio campagna
  CreateCampaignModal.tsx           # Dialog: crea nuova campagna
  EditCampaignModal.tsx             # Dialog: modifica nome/descrizione/status
  CampaignContactsTable.tsx         # TanStack table con status inline + note inline
  ContactStatusSelect.tsx           # Dropdown inline per cambiare status contatto
  AddContactsModal.tsx              # Ricerca aziende + add alla campagna corrente
  AddToCampaignModal.tsx            # Picker campagna da Explorer (floating bar)
```

### Pagine
```
src/app/campaigns/
  page.tsx                          # Lista campagne (card grid)
  [id]/page.tsx                     # Dettaglio campagna
```

### File modificati
- `src/types/index.ts` — tipi `Campaign`, `CampaignContact`, `CampaignStatus`, `ContactStatus`
- `src/lib/constants.ts` — `CAMPAIGN_STATUS_META`, `CONTACT_STATUS_META`
- `src/components/layout/Navbar.tsx` — aggiunto link "Campaigns"
- `src/components/explorer/CompanyTable.tsx` — row selection opzionale + floating bar
- `src/app/explorer/page.tsx` — toggle "Select" per attivare la selezione

---

## Flussi principali

### Creare una campagna
1. Vai su `/campaigns`
2. Clicca **New Campaign**
3. Inserisci nome e descrizione opzionale
4. La campagna viene creata in stato `draft`

### Aggiungere contatti (da campagna)
1. Apri il dettaglio campagna `/campaigns/[id]`
2. Clicca **Add Contacts**
3. Cerca un'azienda per nome → spunta le righe desiderate
4. Clicca **Add Contacts** — i dati CFO vengono pre-popolati automaticamente

### Aggiungere contatti (da Explorer)
1. Vai su `/explorer`
2. Applica i filtri desiderati
3. Clicca **Select** nella barra degli strumenti — appare la colonna checkbox
4. Seleziona una o più aziende
5. Nella floating bar in basso: clicca **Add to campaign**
6. Scegli campagna esistente oppure crea nuova (con redirect automatico)

### Tracciare l'avanzamento
1. Apri il dettaglio campagna
2. Nella tabella contatti, usa il dropdown **Status** su ogni riga
3. Le date `contacted_at` e `replied_at` vengono settate automaticamente dall'API al primo cambio di stato
4. Clicca su **add note…** per aggiungere una nota inline (edit on click, salvataggio on blur/Enter)
5. Le statistiche in alto si aggiornano immediatamente (optimistic update)

### Gestire il ciclo di vita della campagna
- **Edit**: modifica nome, descrizione e status dalla pagina dettaglio
- **Archive**: porta la campagna ad `archived` tramite il modal di edit
- Nella lista campagne, le campagne archiviate sono nascoste per default — clicca **Show archived** per vederle

---

## Comportamenti da notare

| Comportamento | Dettaglio |
|---|---|
| Deduplicazione | Non è possibile aggiungere due volte la stessa azienda a una campagna (unique constraint + upsert API). Se già presente, l'indicatore "already in campaign" appare nell'AddContactsModal. |
| Timestamps automatici | `contacted_at` viene settato solo alla prima transizione verso `contacted`. `replied_at` solo alla prima transizione verso `replied`/`meeting_scheduled`/`converted`. |
| Optimistic updates | I cambi di status nella tabella sono immediati in UI; il PATCH avviene in background. In caso di errore la UI torna allo stato precedente. |
| Reset selezione Explorer | Quando i filtri cambiano, la selezione multipla viene azzerata automaticamente. |
| Isolamento team | Le campagne sono visibili solo ai membri del proprio team (RLS). |

---

## Statistiche aggregate (header campagna)

| Metrica | Calcolo |
|---|---|
| Total Contacts | `COUNT(*)` |
| Contacted | contatti con status ≠ `pending` |
| Replied | contatti con status in `{replied, meeting_scheduled, converted}` |
| Converted | contatti con status = `converted` |
| Reply rate | `replied / contacted × 100` |
| Conversion rate | `converted / replied × 100` |

---

## Integrazione futura con il plugin LinkedIn

Il plugin Chrome (`linkedin-outreach-plugin/`) attualmente scrive su Google Sheets. L'integrazione pianificata può avvenire tramite:

1. **Webhook dal plugin** → `POST /api/campaigns/[id]/contacts/[contactId]` con `{ status: "contacted" }` quando il messaggio viene inviato
2. **Agente Claude** che monitora Google Sheets e sincronizza lo status nel dashboard
3. **Import CSV** manuale dalla schermata di campagna (da implementare)

I campi `contacted_at` e `replied_at` sono già pronti a ricevere questi dati dall'esterno.

---

## Funzionalità roadmap (non ancora implementate)

| Feature | Priorità | Effort |
|---|---|---|
| **Bulk status update** nella tabella contatti (select + applica a tutti) | Alta | Basso |
| **Deduplication warning** cross-campagna in AddToCampaignModal | Alta | Basso |
| **Message template** — campo testo opzionale sulla campagna | Media | Basso |
| **Follow-up reminder** — campo `follow_up_at` + filtro "da seguire oggi" | Media | Basso |
| **Activity log** — tabella `campaign_contact_events` per timeline per contatto | Media | Medio |
| **Duplicate campaign** — clona con tutti i contatti resettati a `pending` | Bassa | Basso |
| **Cross-campaign analytics** — funnel aggregato su tutte le campagne | Bassa | Alto |
| **Plugin webhook integration** — auto-aggiornamento status da LinkedIn | Alta | Alto |
