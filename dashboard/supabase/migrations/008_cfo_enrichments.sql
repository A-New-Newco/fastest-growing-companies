-- ============================================================
-- Migration 008: CFO Enrichments
-- Stores local enricher results imported from CFO Monitor.
-- Run this in the Supabase SQL editor.
-- ============================================================

create table if not exists public.cfo_enrichments (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams(id) on delete cascade,
  dataset_id      text not null,        -- e.g. 'it_2026', 'de_2026'
  country_code    text not null,        -- 'IT', 'DE', …
  year            int  not null,
  rank            int  not null,
  azienda         text not null,
  cfo_nome        text,
  cfo_ruolo       text,
  cfo_linkedin    text,
  cfo_email       text,
  cfo_telefono    text,
  confidenza      text check (confidenza in ('high', 'medium', 'low')),
  fonte           text,
  data_ricerca    date,
  imported_at     timestamptz not null default now(),
  imported_by     uuid references public.profiles(id),
  unique (team_id, dataset_id, rank)
);

create index if not exists cfo_enrichments_team_idx     on public.cfo_enrichments(team_id);
create index if not exists cfo_enrichments_dataset_idx  on public.cfo_enrichments(dataset_id);

alter table public.cfo_enrichments enable row level security;

drop policy if exists "cfo_enrichments: team scoped read"   on public.cfo_enrichments;
drop policy if exists "cfo_enrichments: team scoped insert" on public.cfo_enrichments;
drop policy if exists "cfo_enrichments: team scoped update" on public.cfo_enrichments;
drop policy if exists "cfo_enrichments: team scoped delete" on public.cfo_enrichments;

create policy "cfo_enrichments: team scoped read"
  on public.cfo_enrichments for select
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = cfo_enrichments.team_id
    )
  );

create policy "cfo_enrichments: team scoped insert"
  on public.cfo_enrichments for insert
  with check (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = cfo_enrichments.team_id
    )
  );

create policy "cfo_enrichments: team scoped update"
  on public.cfo_enrichments for update
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = cfo_enrichments.team_id
    )
  );

create policy "cfo_enrichments: team scoped delete"
  on public.cfo_enrichments for delete
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = cfo_enrichments.team_id
    )
  );
