-- ============================================================
-- Migration 004: Import Companies
-- Adds file-based company import feature under Explorer.
-- Run this in the Supabase SQL editor.
-- ============================================================

-- ============================================================
-- 1. import_batches — one row per file upload session
-- ============================================================

create table if not exists public.import_batches (
  id               uuid primary key default gen_random_uuid(),
  team_id          uuid not null references public.teams(id) on delete cascade,
  source_name      text not null,          -- slug, e.g. 'wachstumschampions_2026'
  country_code     char(2) not null,       -- ISO 3166-1 alpha-2
  year             int not null,
  file_name        text not null,
  file_format      text not null check (file_format in ('json', 'jsonl', 'csv')),
  total_records    int,
  imported_count   int not null default 0,
  skipped_count    int not null default 0,
  status           text not null default 'pending'
                     check (status in ('pending', 'mapping', 'importing', 'done', 'failed')),
  created_by       uuid not null references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists import_batches_team_id_idx  on public.import_batches(team_id);
create index if not exists import_batches_status_idx   on public.import_batches(status);

drop trigger if exists import_batches_updated_at on public.import_batches;
create trigger import_batches_updated_at
  before update on public.import_batches
  for each row execute function public.set_updated_at();

alter table public.import_batches enable row level security;

drop policy if exists "import_batches: team scoped read"   on public.import_batches;
drop policy if exists "import_batches: team scoped insert" on public.import_batches;
drop policy if exists "import_batches: team scoped update" on public.import_batches;
drop policy if exists "import_batches: team scoped delete" on public.import_batches;

create policy "import_batches: team scoped read"
  on public.import_batches for select
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = import_batches.team_id
    )
  );

create policy "import_batches: team scoped insert"
  on public.import_batches for insert
  with check (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = import_batches.team_id
    )
  );

create policy "import_batches: team scoped update"
  on public.import_batches for update
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = import_batches.team_id
    )
  );

create policy "import_batches: team scoped delete"
  on public.import_batches for delete
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = import_batches.team_id
    )
  );


-- ============================================================
-- 2. field_mappings — LLM-generated mapping with review workflow
-- ============================================================

create table if not exists public.field_mappings (
  id               uuid primary key default gen_random_uuid(),
  batch_id         uuid not null references public.import_batches(id) on delete cascade,
  team_id          uuid not null references public.teams(id) on delete cascade,
  source_schema    jsonb not null,   -- array of observed field names from the file
  mapping          jsonb not null,
  -- mapping structure:
  -- {
  --   "<source_field_path>": {
  --     "target": "<internal_field | extra_data.<key> | null>",
  --     "transform": "<hint | null>",
  --     "confidence": 0.0-1.0
  --   }
  -- }
  status           text not null default 'pending_review'
                     check (status in ('pending_review', 'approved', 'rejected')),
  approved_by      uuid references public.profiles(id),
  approved_at      timestamptz,
  llm_model        text,
  created_by       uuid not null references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Only one approved mapping per batch
create unique index if not exists field_mappings_one_approved
  on public.field_mappings(batch_id)
  where status = 'approved';

create index if not exists field_mappings_batch_id_idx  on public.field_mappings(batch_id);
create index if not exists field_mappings_team_id_idx   on public.field_mappings(team_id);
create index if not exists field_mappings_status_idx    on public.field_mappings(status);

drop trigger if exists field_mappings_updated_at on public.field_mappings;
create trigger field_mappings_updated_at
  before update on public.field_mappings
  for each row execute function public.set_updated_at();

alter table public.field_mappings enable row level security;

drop policy if exists "field_mappings: team scoped read"   on public.field_mappings;
drop policy if exists "field_mappings: team scoped insert" on public.field_mappings;
drop policy if exists "field_mappings: team scoped update" on public.field_mappings;
drop policy if exists "field_mappings: team scoped delete" on public.field_mappings;

create policy "field_mappings: team scoped read"
  on public.field_mappings for select
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = field_mappings.team_id
    )
  );

create policy "field_mappings: team scoped insert"
  on public.field_mappings for insert
  with check (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = field_mappings.team_id
    )
  );

create policy "field_mappings: team scoped update"
  on public.field_mappings for update
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = field_mappings.team_id
    )
  );

create policy "field_mappings: team scoped delete"
  on public.field_mappings for delete
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = field_mappings.team_id
    )
  );


-- ============================================================
-- 3. imported_companies — individual records from file imports
-- ============================================================

create table if not exists public.imported_companies (
  id               uuid primary key default gen_random_uuid(),
  team_id          uuid not null references public.teams(id) on delete cascade,
  batch_id         uuid not null references public.import_batches(id) on delete cascade,
  source_name      text not null,
  source_key       text not null,          -- natural key from source (e.g. company_key)

  -- Normalised core fields (mapped by LLM + user confirmation)
  name             text not null,
  website          text,
  country_code     char(2) not null,
  region           text,
  city             text,
  sector           text,
  growth_rate      numeric,                -- CAGR % (e.g. 4.26 means 4.26%)
  revenue_a        numeric,               -- thousands EUR, earlier period
  revenue_b        numeric,               -- thousands EUR, later period
  year             int not null,
  national_rank    int,
  foundation_year  int,
  description      text,
  employees_start  int,
  employees_end    int,
  is_listed        boolean,

  -- CFO / contact fields — null at import time; populated by enrichment feature
  cfo_nome         text,
  cfo_ruolo        text,
  cfo_linkedin     text,
  cfo_confidenza   text,

  -- Unmapped fields preserved verbatim
  extra_data       jsonb not null default '{}',

  -- Original record for auditability and re-processing
  raw_data         jsonb not null,

  imported_by      uuid not null references public.profiles(id),
  imported_at      timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  unique (team_id, source_name, source_key)
);

create index if not exists imported_companies_team_id_idx    on public.imported_companies(team_id);
create index if not exists imported_companies_batch_id_idx   on public.imported_companies(batch_id);
create index if not exists imported_companies_name_idx       on public.imported_companies(name);
create index if not exists imported_companies_source_idx     on public.imported_companies(source_name);
create index if not exists imported_companies_extra_data_idx on public.imported_companies using gin(extra_data);

drop trigger if exists imported_companies_updated_at on public.imported_companies;
create trigger imported_companies_updated_at
  before update on public.imported_companies
  for each row execute function public.set_updated_at();

alter table public.imported_companies enable row level security;

drop policy if exists "imported_companies: team scoped read"   on public.imported_companies;
drop policy if exists "imported_companies: team scoped insert" on public.imported_companies;
drop policy if exists "imported_companies: team scoped update" on public.imported_companies;
drop policy if exists "imported_companies: team scoped delete" on public.imported_companies;

create policy "imported_companies: team scoped read"
  on public.imported_companies for select
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = imported_companies.team_id
    )
  );

create policy "imported_companies: team scoped insert"
  on public.imported_companies for insert
  with check (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = imported_companies.team_id
    )
  );

create policy "imported_companies: team scoped update"
  on public.imported_companies for update
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = imported_companies.team_id
    )
  );

create policy "imported_companies: team scoped delete"
  on public.imported_companies for delete
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = imported_companies.team_id
    )
  );


-- ============================================================
-- 4. all_companies view — unions companies_full (curated) with
--    imported_companies (team-scoped). Uses explicit auth.uid()
--    filter for imported_companies to respect team isolation.
-- ============================================================

create or replace view public.all_companies as
  -- Curated companies (Italian rankings pipeline)
  select
    id,
    rank,
    name,
    website,
    growth_rate,
    sector,
    region,
    appearances,
    financials,
    year,
    country,
    source_name,
    contact_id,
    cfo_nome,
    cfo_ruolo,
    cfo_ruolo_category,
    cfo_linkedin,
    confidenza,
    enrichment_source,
    contact_left,
    low_quality,
    annotation_note,
    'curated'::text as data_origin
  from public.companies_full

  union all

  -- Imported companies (file imports, team-scoped)
  select
    ic.id,
    ic.national_rank                                           as rank,
    ic.name,
    ic.website,
    ic.growth_rate,
    ic.sector,
    ic.region,
    null::int                                                  as appearances,
    jsonb_build_object(
      'revenue_start', ic.revenue_a,
      'revenue_end',   ic.revenue_b
    )                                                          as financials,
    ic.year,
    ic.country_code                                            as country,
    ic.source_name,
    null::uuid                                                 as contact_id,
    ic.cfo_nome,
    ic.cfo_ruolo,
    null::text                                                 as cfo_ruolo_category,
    ic.cfo_linkedin,
    ic.cfo_confidenza                                          as confidenza,
    null::text                                                 as enrichment_source,
    null::boolean                                              as contact_left,
    null::boolean                                              as low_quality,
    null::text                                                 as annotation_note,
    'imported'::text                                           as data_origin
  from public.imported_companies ic
  where ic.team_id in (
    select tm.team_id
    from public.team_memberships tm
    where tm.user_id = auth.uid()
  );

-- ============================================================
-- NOTE: Supabase Storage bucket 'import-uploads' must be
-- created separately via the Supabase dashboard:
--   Storage → New bucket → Name: "import-uploads" → Private
-- ============================================================
