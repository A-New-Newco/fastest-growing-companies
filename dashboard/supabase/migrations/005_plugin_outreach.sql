-- ============================================================
-- Migration 005: Plugin Outreach integration (dashboard mode)
-- ============================================================

-- 1) Enums
DO $$ BEGIN
  CREATE TYPE public.outreach_run_status AS ENUM (
    'running', 'paused', 'stopped', 'completed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.plugin_device_status AS ENUM (
    'pending', 'paired', 'revoked', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) campaign enrichments
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS connection_note_template text,
  ADD COLUMN IF NOT EXISTS quota_policy text NOT NULL DEFAULT 'conservative',
  ADD COLUMN IF NOT EXISTS pause_reason text,
  ADD COLUMN IF NOT EXISTS integration_mode text NOT NULL DEFAULT 'dashboard';

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_quota_policy_check,
  ADD CONSTRAINT campaigns_quota_policy_check
    CHECK (quota_policy IN ('conservative', 'balanced', 'aggressive'));

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_integration_mode_check,
  ADD CONSTRAINT campaigns_integration_mode_check
    CHECK (integration_mode IN ('dashboard', 'legacy'));

-- 3) campaign contact claim metadata
ALTER TABLE public.campaign_contacts
  ADD COLUMN IF NOT EXISTS claimed_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_code text;

CREATE INDEX IF NOT EXISTS campaign_contacts_claim_exp_idx
  ON public.campaign_contacts(campaign_id, claim_expires_at);
CREATE INDEX IF NOT EXISTS campaign_contacts_claimed_by_idx
  ON public.campaign_contacts(claimed_by);

-- 4) device pairing sessions (plugin auth bootstrap)
CREATE TABLE IF NOT EXISTS public.plugin_device_sessions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_code              text NOT NULL UNIQUE,
  pair_secret            text NOT NULL,
  pair_secret_hash       text NOT NULL,
  status                 public.plugin_device_status NOT NULL DEFAULT 'pending',
  user_id                uuid REFERENCES public.profiles(id),
  team_id                uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  plugin_token_hash      text,
  expires_at             timestamptz NOT NULL,
  plugin_token_expires_at timestamptz,
  paired_at              timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS plugin_device_sessions_updated_at ON public.plugin_device_sessions;
CREATE TRIGGER plugin_device_sessions_updated_at
  BEFORE UPDATE ON public.plugin_device_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS plugin_device_sessions_status_idx
  ON public.plugin_device_sessions(status);
CREATE INDEX IF NOT EXISTS plugin_device_sessions_expires_idx
  ON public.plugin_device_sessions(expires_at);
CREATE INDEX IF NOT EXISTS plugin_device_sessions_token_hash_idx
  ON public.plugin_device_sessions(plugin_token_hash);

ALTER TABLE public.plugin_device_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plugin_device_sessions: owner read" ON public.plugin_device_sessions;
CREATE POLICY "plugin_device_sessions: owner read"
  ON public.plugin_device_sessions FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "plugin_device_sessions: owner update" ON public.plugin_device_sessions;
CREATE POLICY "plugin_device_sessions: owner update"
  ON public.plugin_device_sessions FOR UPDATE
  USING (user_id = auth.uid());

-- 5) operator profiles (validated before run)
CREATE TABLE IF NOT EXISTS public.plugin_operator_profiles (
  user_id      uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  team_id      uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  linkedin_url text NOT NULL,
  full_name    text NOT NULL,
  headline     text,
  confidence   numeric(4,3) NOT NULL DEFAULT 0,
  source       text NOT NULL DEFAULT 'groq',
  html_hash    text NOT NULL,
  verified_at  timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS plugin_operator_profiles_updated_at ON public.plugin_operator_profiles;
CREATE TRIGGER plugin_operator_profiles_updated_at
  BEFORE UPDATE ON public.plugin_operator_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS plugin_operator_profiles_team_id_idx
  ON public.plugin_operator_profiles(team_id);

ALTER TABLE public.plugin_operator_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plugin_operator_profiles: team scoped read" ON public.plugin_operator_profiles;
CREATE POLICY "plugin_operator_profiles: team scoped read"
  ON public.plugin_operator_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.team_memberships tm
      WHERE tm.user_id = auth.uid()
        AND tm.team_id = plugin_operator_profiles.team_id
    )
  );

DROP POLICY IF EXISTS "plugin_operator_profiles: owner upsert" ON public.plugin_operator_profiles;
CREATE POLICY "plugin_operator_profiles: owner upsert"
  ON public.plugin_operator_profiles FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "plugin_operator_profiles: owner update" ON public.plugin_operator_profiles;
CREATE POLICY "plugin_operator_profiles: owner update"
  ON public.plugin_operator_profiles FOR UPDATE
  USING (user_id = auth.uid());

-- 6) outreach runs
CREATE TABLE IF NOT EXISTS public.campaign_outreach_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  team_id      uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  started_by   uuid NOT NULL REFERENCES public.profiles(id),
  status       public.outreach_run_status NOT NULL DEFAULT 'running',
  pause_reason text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS campaign_outreach_runs_updated_at ON public.campaign_outreach_runs;
CREATE TRIGGER campaign_outreach_runs_updated_at
  BEFORE UPDATE ON public.campaign_outreach_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS campaign_outreach_runs_campaign_id_idx
  ON public.campaign_outreach_runs(campaign_id);
CREATE INDEX IF NOT EXISTS campaign_outreach_runs_team_id_idx
  ON public.campaign_outreach_runs(team_id);
CREATE INDEX IF NOT EXISTS campaign_outreach_runs_status_idx
  ON public.campaign_outreach_runs(status);

ALTER TABLE public.campaign_outreach_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_outreach_runs: team scoped read" ON public.campaign_outreach_runs;
CREATE POLICY "campaign_outreach_runs: team scoped read"
  ON public.campaign_outreach_runs FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.team_memberships tm
      WHERE tm.user_id = auth.uid()
        AND tm.team_id = campaign_outreach_runs.team_id
    )
  );

DROP POLICY IF EXISTS "campaign_outreach_runs: team scoped insert" ON public.campaign_outreach_runs;
CREATE POLICY "campaign_outreach_runs: team scoped insert"
  ON public.campaign_outreach_runs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.team_memberships tm
      WHERE tm.user_id = auth.uid()
        AND tm.team_id = campaign_outreach_runs.team_id
    )
  );

DROP POLICY IF EXISTS "campaign_outreach_runs: team scoped update" ON public.campaign_outreach_runs;
CREATE POLICY "campaign_outreach_runs: team scoped update"
  ON public.campaign_outreach_runs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.team_memberships tm
      WHERE tm.user_id = auth.uid()
        AND tm.team_id = campaign_outreach_runs.team_id
    )
  );

-- 7) outreach event log
CREATE TABLE IF NOT EXISTS public.campaign_contact_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  campaign_contact_id uuid NOT NULL REFERENCES public.campaign_contacts(id) ON DELETE CASCADE,
  run_id              uuid REFERENCES public.campaign_outreach_runs(id) ON DELETE SET NULL,
  actor_user_id       uuid REFERENCES public.profiles(id),
  event_type          text NOT NULL,
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_contact_events_campaign_id_idx
  ON public.campaign_contact_events(campaign_id);
CREATE INDEX IF NOT EXISTS campaign_contact_events_contact_id_idx
  ON public.campaign_contact_events(campaign_contact_id);
CREATE INDEX IF NOT EXISTS campaign_contact_events_event_type_idx
  ON public.campaign_contact_events(event_type);
CREATE INDEX IF NOT EXISTS campaign_contact_events_created_at_idx
  ON public.campaign_contact_events(created_at DESC);

ALTER TABLE public.campaign_contact_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_contact_events: team scoped read" ON public.campaign_contact_events;
CREATE POLICY "campaign_contact_events: team scoped read"
  ON public.campaign_contact_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.campaigns c
      JOIN public.team_memberships tm ON tm.team_id = c.team_id
      WHERE c.id = campaign_contact_events.campaign_id
        AND tm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "campaign_contact_events: team scoped insert" ON public.campaign_contact_events;
CREATE POLICY "campaign_contact_events: team scoped insert"
  ON public.campaign_contact_events FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.campaigns c
      JOIN public.team_memberships tm ON tm.team_id = c.team_id
      WHERE c.id = campaign_contact_events.campaign_id
        AND tm.user_id = auth.uid()
    )
  );

-- 8) claim next contact atomically
CREATE OR REPLACE FUNCTION public.claim_next_contact(
  p_campaign_id uuid,
  p_actor_user_id uuid,
  p_run_id uuid DEFAULT NULL,
  p_lease_seconds integer DEFAULT 300
)
RETURNS TABLE (
  contact_id uuid,
  company_id uuid,
  contact_name text,
  contact_role text,
  contact_linkedin text,
  lease_expires_at timestamptz
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_row public.campaign_contacts%ROWTYPE;
  v_lease_seconds integer := GREATEST(COALESCE(p_lease_seconds, 300), 60);
  v_expiry timestamptz := now() + make_interval(secs => v_lease_seconds);
BEGIN
  SELECT cc.*
    INTO v_row
  FROM public.campaign_contacts cc
  WHERE cc.campaign_id = p_campaign_id
    AND cc.status = 'pending'
    AND COALESCE(cc.contact_linkedin, '') <> ''
    AND (cc.claim_expires_at IS NULL OR cc.claim_expires_at < now())
  ORDER BY cc.added_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.campaign_contacts
  SET claimed_by = p_actor_user_id,
      claim_expires_at = v_expiry,
      updated_at = now()
  WHERE id = v_row.id;

  INSERT INTO public.campaign_contact_events(
    campaign_id,
    campaign_contact_id,
    run_id,
    actor_user_id,
    event_type,
    payload
  ) VALUES (
    p_campaign_id,
    v_row.id,
    p_run_id,
    p_actor_user_id,
    'claimed',
    jsonb_build_object('lease_seconds', v_lease_seconds)
  );

  RETURN QUERY
  SELECT v_row.id, v_row.company_id, v_row.contact_name, v_row.contact_role, v_row.contact_linkedin, v_expiry;
END;
$$;
