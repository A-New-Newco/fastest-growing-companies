-- ============================================================
-- Migration 006: Ensure outreach columns exist on campaigns
-- Root-fix for environments where 005_plugin_outreach.sql
-- was not applied yet.
-- ============================================================

alter table public.campaigns
  add column if not exists connection_note_template text,
  add column if not exists quota_policy text not null default 'conservative',
  add column if not exists pause_reason text,
  add column if not exists integration_mode text not null default 'dashboard';

update public.campaigns
set quota_policy = 'conservative'
where quota_policy is null;

update public.campaigns
set integration_mode = 'dashboard'
where integration_mode is null;

alter table public.campaigns
  drop constraint if exists campaigns_quota_policy_check,
  add constraint campaigns_quota_policy_check
    check (quota_policy in ('conservative', 'balanced', 'aggressive'));

alter table public.campaigns
  drop constraint if exists campaigns_integration_mode_check,
  add constraint campaigns_integration_mode_check
    check (integration_mode in ('dashboard', 'legacy'));
