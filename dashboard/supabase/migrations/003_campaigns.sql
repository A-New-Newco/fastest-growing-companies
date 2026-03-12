-- ============================================================
-- Migration 003: Campaigns and Campaign Contacts
-- Run this in the Supabase SQL editor.
-- ============================================================

-- 1. Enums
do $$ begin
  create type public.campaign_status as enum (
    'draft', 'active', 'paused', 'completed', 'archived'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.contact_status as enum (
    'pending', 'contacted', 'replied',
    'meeting_scheduled', 'converted', 'not_interested', 'no_reply'
  );
exception when duplicate_object then null; end $$;

-- 2. updated_at helper (idempotent)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- 3. campaigns table
create table if not exists public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  name        text not null,
  description text,
  status      public.campaign_status not null default 'draft',
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists campaigns_team_id_idx on public.campaigns(team_id);
create index if not exists campaigns_status_idx on public.campaigns(status);

drop trigger if exists campaigns_updated_at on public.campaigns;
create trigger campaigns_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();

-- 4. RLS for campaigns
alter table public.campaigns enable row level security;

drop policy if exists "campaigns: team scoped read"   on public.campaigns;
drop policy if exists "campaigns: team scoped insert" on public.campaigns;
drop policy if exists "campaigns: team scoped update" on public.campaigns;
drop policy if exists "campaigns: team scoped delete" on public.campaigns;

create policy "campaigns: team scoped read"
  on public.campaigns for select
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = campaigns.team_id
    )
  );

create policy "campaigns: team scoped insert"
  on public.campaigns for insert
  with check (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = campaigns.team_id
    )
  );

create policy "campaigns: team scoped update"
  on public.campaigns for update
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = campaigns.team_id
    )
  );

create policy "campaigns: team scoped delete"
  on public.campaigns for delete
  using (
    exists (
      select 1 from public.team_memberships tm
      where tm.user_id = auth.uid()
        and tm.team_id = campaigns.team_id
    )
  );

-- 5. campaign_contacts table
create table if not exists public.campaign_contacts (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references public.campaigns(id) on delete cascade,
  company_id       uuid not null references public.companies(id),
  contact_name     text,
  contact_role     text,
  contact_linkedin text,
  status           public.contact_status not null default 'pending',
  notes            text,
  contacted_at     timestamptz,
  replied_at       timestamptz,
  added_by         uuid not null references public.profiles(id),
  added_at         timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (campaign_id, company_id)
);

create index if not exists campaign_contacts_campaign_id_idx on public.campaign_contacts(campaign_id);
create index if not exists campaign_contacts_company_id_idx  on public.campaign_contacts(company_id);
create index if not exists campaign_contacts_status_idx      on public.campaign_contacts(status);

drop trigger if exists campaign_contacts_updated_at on public.campaign_contacts;
create trigger campaign_contacts_updated_at
  before update on public.campaign_contacts
  for each row execute function public.set_updated_at();

-- 6. RLS for campaign_contacts (join through campaigns.team_id)
alter table public.campaign_contacts enable row level security;

drop policy if exists "campaign_contacts: team scoped read"   on public.campaign_contacts;
drop policy if exists "campaign_contacts: team scoped insert" on public.campaign_contacts;
drop policy if exists "campaign_contacts: team scoped update" on public.campaign_contacts;
drop policy if exists "campaign_contacts: team scoped delete" on public.campaign_contacts;

create policy "campaign_contacts: team scoped read"
  on public.campaign_contacts for select
  using (
    exists (
      select 1
      from public.campaigns c
      join public.team_memberships tm on tm.team_id = c.team_id
      where c.id = campaign_contacts.campaign_id
        and tm.user_id = auth.uid()
    )
  );

create policy "campaign_contacts: team scoped insert"
  on public.campaign_contacts for insert
  with check (
    exists (
      select 1
      from public.campaigns c
      join public.team_memberships tm on tm.team_id = c.team_id
      where c.id = campaign_contacts.campaign_id
        and tm.user_id = auth.uid()
    )
  );

create policy "campaign_contacts: team scoped update"
  on public.campaign_contacts for update
  using (
    exists (
      select 1
      from public.campaigns c
      join public.team_memberships tm on tm.team_id = c.team_id
      where c.id = campaign_contacts.campaign_id
        and tm.user_id = auth.uid()
    )
  );

create policy "campaign_contacts: team scoped delete"
  on public.campaign_contacts for delete
  using (
    exists (
      select 1
      from public.campaigns c
      join public.team_memberships tm on tm.team_id = c.team_id
      where c.id = campaign_contacts.campaign_id
        and tm.user_id = auth.uid()
    )
  );
