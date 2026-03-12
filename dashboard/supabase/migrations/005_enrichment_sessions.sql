-- ============================================================
-- Migration 005: Enrichment Sessions
-- AI-powered CFO enrichment with Groq, real-time SSE monitoring.
-- ============================================================

-- 1. Enums
do $$ begin
  create type public.enrichment_session_status as enum (
    'pending', 'running', 'paused', 'completed', 'failed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.enrichment_company_status as enum (
    'pending', 'running', 'done', 'failed', 'skipped'
  );
exception when duplicate_object then null; end $$;

-- 2. enrichment_sessions — one per enrichment batch run
create table if not exists public.enrichment_sessions (
  id                  uuid primary key default gen_random_uuid(),
  team_id             uuid not null references public.teams(id) on delete cascade,
  name                text not null,
  status              public.enrichment_session_status not null default 'pending',

  -- Model pool configuration (ordered list of models to rotate through on rate-limit)
  model_config        jsonb not null default '{"models":["compound-beta","llama-3.3-70b-versatile","llama-3.1-8b-instant"],"current_model_index":0}',

  -- Aggregate token tracking
  tokens_input        bigint not null default 0,
  tokens_output       bigint not null default 0,
  tokens_total        bigint not null default 0,

  -- Progress counters (denormalized for fast reads)
  total_companies     int not null default 0,
  completed_count     int not null default 0,
  found_count         int not null default 0,
  failed_count        int not null default 0,

  -- Timing
  started_at          timestamptz,
  completed_at        timestamptz,
  last_heartbeat      timestamptz, -- updated every 15s during run; stale > 5min = crashed

  created_by          uuid not null references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists enrichment_sessions_team_id_idx on public.enrichment_sessions(team_id);
create index if not exists enrichment_sessions_status_idx  on public.enrichment_sessions(status);

drop trigger if exists enrichment_sessions_updated_at on public.enrichment_sessions;
create trigger enrichment_sessions_updated_at
  before update on public.enrichment_sessions
  for each row execute function public.set_updated_at();

alter table public.enrichment_sessions enable row level security;

drop policy if exists "enrichment_sessions: team scoped read"   on public.enrichment_sessions;
drop policy if exists "enrichment_sessions: team scoped insert" on public.enrichment_sessions;
drop policy if exists "enrichment_sessions: team scoped update" on public.enrichment_sessions;
drop policy if exists "enrichment_sessions: team scoped delete" on public.enrichment_sessions;

create policy "enrichment_sessions: team scoped read"
  on public.enrichment_sessions for select
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = enrichment_sessions.team_id
    )
  );

create policy "enrichment_sessions: team scoped insert"
  on public.enrichment_sessions for insert
  with check (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = enrichment_sessions.team_id
    )
  );

create policy "enrichment_sessions: team scoped update"
  on public.enrichment_sessions for update
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = enrichment_sessions.team_id
    )
  );

create policy "enrichment_sessions: team scoped delete"
  on public.enrichment_sessions for delete
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = enrichment_sessions.team_id
    )
  );

-- 3. enrichment_session_companies — one row per company in a session
create table if not exists public.enrichment_session_companies (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references public.enrichment_sessions(id) on delete cascade,

  -- Polymorphic company reference (curated = companies table, imported = imported_companies table)
  company_id          uuid not null,
  company_origin      text not null check (company_origin in ('curated', 'imported')),

  -- Snapshots taken at session creation (stable even if source record changes)
  company_name        text not null,
  company_website     text,
  company_country     text,  -- ISO-3166 alpha-2

  status              public.enrichment_company_status not null default 'pending',

  -- Enrichment results (populated on success)
  result_nome         text,
  result_ruolo        text,
  result_linkedin     text,
  result_confidenza   text check (result_confidenza in ('high', 'medium', 'low')),

  -- Per-company log entries: [{ts, event: search|fetch|think|result, data: {...}}]
  -- Capped at 200 entries by application logic
  logs                jsonb not null default '[]',

  -- Token usage for this company's call
  tokens_input        int not null default 0,
  tokens_output       int not null default 0,

  -- Which model produced the final result
  model_used          text,

  -- Error message if status = 'failed'
  error_message       text,

  -- Whether this result has been written back to the source company record
  applied_at          timestamptz,
  applied_by          uuid references public.profiles(id),

  -- Ordering within session (1-based, matches original company list order)
  position            int not null,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (session_id, company_id, company_origin)
);

create index if not exists esc_session_id_idx  on public.enrichment_session_companies(session_id);
create index if not exists esc_company_id_idx  on public.enrichment_session_companies(company_id);
create index if not exists esc_status_idx      on public.enrichment_session_companies(status);
create index if not exists esc_logs_gin_idx    on public.enrichment_session_companies using gin(logs);

drop trigger if exists esc_updated_at on public.enrichment_session_companies;
create trigger esc_updated_at
  before update on public.enrichment_session_companies
  for each row execute function public.set_updated_at();

alter table public.enrichment_session_companies enable row level security;

drop policy if exists "esc: team scoped read"   on public.enrichment_session_companies;
drop policy if exists "esc: team scoped insert" on public.enrichment_session_companies;
drop policy if exists "esc: team scoped update" on public.enrichment_session_companies;
drop policy if exists "esc: team scoped delete" on public.enrichment_session_companies;

create policy "esc: team scoped read"
  on public.enrichment_session_companies for select
  using (
    exists (
      select 1
      from public.enrichment_sessions es
      join public.team_memberships tm on tm.team_id = es.team_id
      where es.id = enrichment_session_companies.session_id
        and tm.user_id = auth.uid()
    )
  );

create policy "esc: team scoped insert"
  on public.enrichment_session_companies for insert
  with check (
    exists (
      select 1
      from public.enrichment_sessions es
      join public.team_memberships tm on tm.team_id = es.team_id
      where es.id = enrichment_session_companies.session_id
        and tm.user_id = auth.uid()
    )
  );

create policy "esc: team scoped update"
  on public.enrichment_session_companies for update
  using (
    exists (
      select 1
      from public.enrichment_sessions es
      join public.team_memberships tm on tm.team_id = es.team_id
      where es.id = enrichment_session_companies.session_id
        and tm.user_id = auth.uid()
    )
  );

create policy "esc: team scoped delete"
  on public.enrichment_session_companies for delete
  using (
    exists (
      select 1
      from public.enrichment_sessions es
      join public.team_memberships tm on tm.team_id = es.team_id
      where es.id = enrichment_session_companies.session_id
        and tm.user_id = auth.uid()
    )
  );
