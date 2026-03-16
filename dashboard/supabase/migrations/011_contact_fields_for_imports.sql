-- ============================================================
-- Migration 011: Add email and phone columns to imported_companies
-- Enables importing contact email/phone via the file import wizard.
-- Updates all_companies view to expose these columns.
-- ============================================================

-- 1. Add missing contact columns to imported_companies
ALTER TABLE public.imported_companies
  ADD COLUMN IF NOT EXISTS cfo_email text,
  ADD COLUMN IF NOT EXISTS cfo_phone text;

-- 2. Recreate all_companies view with real columns instead of NULLs
DROP VIEW IF EXISTS public.all_companies;

CREATE VIEW public.all_companies AS
SELECT
  companies_full.id,
  companies_full.rank,
  companies_full.name,
  companies_full.website,
  companies_full.growth_rate,
  companies_full.sector,
  companies_full.region,
  companies_full.appearances,
  companies_full.financials,
  companies_full.year,
  companies_full.country,
  companies_full.source_name,
  companies_full.contact_id,
  companies_full.cfo_nome,
  companies_full.cfo_ruolo,
  companies_full.cfo_ruolo_category,
  companies_full.cfo_linkedin,
  companies_full.confidenza,
  companies_full.enrichment_source,
  companies_full.contact_left,
  companies_full.low_quality,
  companies_full.annotation_note,
  'curated'::text AS data_origin,
  companies_full.cfo_email,
  companies_full.cfo_phone
FROM public.companies_full
UNION ALL
SELECT
  ic.id,
  ic.national_rank AS rank,
  ic.name,
  ic.website,
  ic.growth_rate,
  ic.sector,
  ic.region,
  NULL::integer AS appearances,
  jsonb_build_object('revenue_start', ic.revenue_a, 'revenue_end', ic.revenue_b) AS financials,
  ic.year,
  ic.country_code AS country,
  ic.source_name,
  NULL::uuid AS contact_id,
  ic.cfo_nome,
  ic.cfo_ruolo,
  ic.cfo_ruolo_category,
  ic.cfo_linkedin,
  ic.cfo_confidenza AS confidenza,
  NULL::text AS enrichment_source,
  NULL::boolean AS contact_left,
  NULL::boolean AS low_quality,
  NULL::text AS annotation_note,
  'imported'::text AS data_origin,
  ic.cfo_email,
  ic.cfo_phone
FROM public.imported_companies ic
WHERE (ic.team_id IN (
  SELECT tm.team_id FROM public.team_memberships tm WHERE (tm.user_id = auth.uid())
));

GRANT SELECT ON public.all_companies TO authenticated;
