-- ============================================================
-- Migration 010: Add email and phone to contacts
-- Backfills from cfo_enrichments, recreates companies_full
-- and all_companies views with the new columns.
-- ============================================================

-- 1. Add email and phone to contacts table
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text;

-- 2. Backfill from cfo_enrichments (match by rank + country + year)
UPDATE public.contacts ct
SET
  email = ce.cfo_email,
  phone = ce.cfo_telefono
FROM public.companies c
JOIN public.sources s ON c.source_id = s.id
JOIN public.cfo_enrichments ce
  ON ce.rank = c.rank
  AND ce.country_code = s.country
  AND ce.year = s.year
WHERE ct.company_id = c.id
  AND (ce.cfo_email IS NOT NULL OR ce.cfo_telefono IS NOT NULL);

-- 3. Drop dependent views first, then recreate with new columns
DROP VIEW IF EXISTS public.all_companies;
DROP VIEW IF EXISTS public.companies_full;

CREATE VIEW public.companies_full AS
SELECT
  c.id,
  c.rank,
  c.name,
  c.website,
  c.growth_rate,
  c.sector,
  c.region,
  c.appearances,
  c.financials,
  s.year,
  s.country,
  s.name AS source_name,
  ct.id AS contact_id,
  ct.name AS cfo_nome,
  ct.role AS cfo_ruolo,
  ct.role_category AS cfo_ruolo_category,
  ct.linkedin AS cfo_linkedin,
  ct.confidence AS confidenza,
  ct.enrichment_source,
  a.contact_left,
  a.low_quality,
  a.note AS annotation_note,
  ct.email AS cfo_email,
  ct.phone AS cfo_phone
FROM (((public.companies c
  JOIN public.sources s ON (c.source_id = s.id))
  LEFT JOIN public.contacts ct ON (ct.company_id = c.id))
  LEFT JOIN public.annotations a ON (a.company_id = c.id));

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
  NULL::text AS cfo_email,
  NULL::text AS cfo_phone
FROM public.imported_companies ic
WHERE (ic.team_id IN (
  SELECT tm.team_id FROM public.team_memberships tm WHERE (tm.user_id = auth.uid())
));

GRANT SELECT ON public.companies_full TO authenticated;
GRANT SELECT ON public.all_companies TO authenticated;
