-- ============================================================
-- Migration 002: Team-scoped annotations
-- Run this in the Supabase SQL editor.
-- ============================================================

-- 1. Add team_id column (nullable first)
alter table public.annotations
  add column if not exists team_id uuid references public.teams(id);

-- 2. Backfill existing rows with the Reef team
update public.annotations
set team_id = (select id from public.teams where slug = 'reef')
where team_id is null;

-- 3. Drop old unique constraint on company_id alone (if it exists)
alter table public.annotations
  drop constraint if exists annotations_company_id_key;

-- 4. Add new unique constraint on (team_id, company_id)
alter table public.annotations
  drop constraint if exists annotations_team_company_key;
alter table public.annotations
  add constraint annotations_team_company_key unique (team_id, company_id);

-- 5. Replace RLS policies with team-scoped versions
drop policy if exists "annotations: approved members read"   on public.annotations;
drop policy if exists "annotations: approved members write"  on public.annotations;
drop policy if exists "annotations: approved members update" on public.annotations;

create policy "annotations: team scoped read"
  on public.annotations for select
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = annotations.team_id
    )
  );

create policy "annotations: team scoped insert"
  on public.annotations for insert
  with check (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = annotations.team_id
    )
  );

create policy "annotations: team scoped update"
  on public.annotations for update
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = annotations.team_id
    )
  );
