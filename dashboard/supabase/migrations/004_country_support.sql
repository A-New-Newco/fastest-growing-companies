-- ============================================================
-- Migration 004: Country support on sources + companies
-- Run this in the Supabase SQL editor.
-- ============================================================

-- 1) Sources: add country and enforce ISO-3166 alpha-2 uppercase
alter table if exists public.sources
  add column if not exists country text;

update public.sources
set country = upper(coalesce(nullif(trim(country), ''), 'IT'))
where country is null or trim(country) = '' or country <> upper(country);

alter table if exists public.sources
  alter column country set not null;

alter table if exists public.sources
  drop constraint if exists sources_country_chk;

alter table if exists public.sources
  add constraint sources_country_chk
  check (char_length(country) = 2 and country = upper(country));

create unique index if not exists sources_name_year_country_key
  on public.sources (name, year, country);

-- 2) Companies: persist country directly for easier filtering / future scaling
alter table if exists public.companies
  add column if not exists country text;

update public.companies c
set country = upper(
  coalesce(
    nullif(trim(c.country), ''),
    nullif(trim(s.country), ''),
    'IT'
  )
)
from public.sources s
where s.id = c.source_id
  and (c.country is null or trim(c.country) = '' or c.country <> upper(c.country));

update public.companies
set country = 'IT'
where country is null or trim(country) = '';

alter table if exists public.companies
  alter column country set not null;

alter table if exists public.companies
  drop constraint if exists companies_country_chk;

alter table if exists public.companies
  add constraint companies_country_chk
  check (char_length(country) = 2 and country = upper(country));

create index if not exists companies_country_idx on public.companies(country);
