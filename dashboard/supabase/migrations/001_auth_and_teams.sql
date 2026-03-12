-- ============================================================
-- Migration 001: Auth and Team-Based Access Control
-- Run this in the Supabase SQL editor (Table Editor → SQL)
--
-- IMPORTANT: run the whole script at once, not block by block.
-- ============================================================


-- ============================================================
-- 1. PROFILES (mirrors auth.users 1:1)
-- ============================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz default now() not null
);

-- Auto-create profile on sign-up via trigger
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

drop policy if exists "profiles: own read" on public.profiles;
create policy "profiles: own read"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles: own update" on public.profiles;
create policy "profiles: own update"
  on public.profiles for update
  using (auth.uid() = id);

-- NOTE: the "profiles: team members read all" policy is added AFTER
-- team_memberships is created (see end of section 3).


-- ============================================================
-- 2. TEAMS
-- ============================================================
create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique not null,
  created_at  timestamptz default now() not null
);

-- Seed the default team
insert into public.teams (name, slug)
values ('Reef', 'reef')
on conflict (slug) do nothing;

alter table public.teams enable row level security;

drop policy if exists "teams: authenticated read" on public.teams;
create policy "teams: authenticated read"
  on public.teams for select
  to authenticated
  using (true);


-- ============================================================
-- 3. TEAM MEMBERSHIPS
-- ============================================================
do $$ begin
  create type public.membership_role as enum ('admin', 'member');
exception when duplicate_object then null; end $$;

create table if not exists public.team_memberships (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       public.membership_role not null default 'member',
  created_at timestamptz default now() not null,
  unique (team_id, user_id)
);

alter table public.team_memberships enable row level security;

drop policy if exists "memberships: own read" on public.team_memberships;
create policy "memberships: own read"
  on public.team_memberships for select
  using (user_id = auth.uid());

-- NOTE: no "admin read" policy on team_memberships — it would cause infinite
-- recursion because the policy itself queries team_memberships.
-- The "memberships: own read" policy is sufficient: the middleware only needs
-- to check the current user's own membership. Admin operations use the
-- service role client which bypasses RLS entirely.

-- Now safe to add: profiles policy that references team_memberships
drop policy if exists "profiles: team members read all" on public.profiles;
create policy "profiles: team members read all"
  on public.profiles for select
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
    )
  );


-- ============================================================
-- 4. JOIN REQUESTS
-- ============================================================
do $$ begin
  create type public.request_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

create table if not exists public.join_requests (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  status       public.request_status not null default 'pending',
  message      text,
  reviewed_by  uuid references public.profiles(id),
  reviewed_at  timestamptz,
  created_at   timestamptz default now() not null,
  unique (team_id, user_id)
);

alter table public.join_requests enable row level security;

drop policy if exists "join_requests: own insert" on public.join_requests;
create policy "join_requests: own insert"
  on public.join_requests for insert
  with check (user_id = auth.uid());

drop policy if exists "join_requests: own read" on public.join_requests;
create policy "join_requests: own read"
  on public.join_requests for select
  using (user_id = auth.uid());

drop policy if exists "join_requests: admin read" on public.join_requests;
create policy "join_requests: admin read"
  on public.join_requests for select
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = join_requests.team_id
        and tm.role = 'admin'
    )
  );

drop policy if exists "join_requests: admin update" on public.join_requests;
create policy "join_requests: admin update"
  on public.join_requests for update
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = join_requests.team_id
        and tm.role = 'admin'
    )
  );


-- ============================================================
-- 5. ANNOTATIONS — add user_id column + RLS
-- ============================================================
alter table public.annotations
  add column if not exists user_id uuid references public.profiles(id);

drop policy if exists "annotations: approved members read" on public.annotations;
drop policy if exists "annotations: approved members write" on public.annotations;
drop policy if exists "annotations: approved members update" on public.annotations;

alter table public.annotations enable row level security;

create policy "annotations: approved members read"
  on public.annotations for select
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
    )
  );

create policy "annotations: approved members write"
  on public.annotations for insert
  with check (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
    )
  );

create policy "annotations: approved members update"
  on public.annotations for update
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
    )
  );


-- ============================================================
-- 6. GRANT read access on companies_full view
-- ============================================================
grant select on public.companies_full to authenticated;


-- ============================================================
-- BOOTSTRAP: promuovi il primo admin
--
-- Dopo aver fatto signup con il tuo account:
-- 1. Vai su Supabase → Authentication → Users
-- 2. Copia il tuo UUID
-- 3. Decommenta e incolla il tuo UUID qui sotto, poi ri-esegui
--    SOLO questo blocco nel SQL editor
-- ============================================================
-- insert into public.team_memberships (team_id, user_id, role)
-- select t.id, '<incolla-qui-il-tuo-uuid>', 'admin'
-- from public.teams t where t.slug = 'reef';
