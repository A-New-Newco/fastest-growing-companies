-- ============================================================
-- Migration 012: Enrichment Category (CFO vs LinkedIn)
-- Adds category discriminator to sessions and contact input
-- fields to session companies for LinkedIn enrichment.
-- ============================================================

-- 1. Add enrichment_category to enrichment_sessions
ALTER TABLE public.enrichment_sessions
  ADD COLUMN IF NOT EXISTS enrichment_category text NOT NULL DEFAULT 'cfo'
  CHECK (enrichment_category IN ('cfo', 'linkedin'));

-- 2. Add contact input fields to enrichment_session_companies
-- These store the known contact name/role for LinkedIn sessions (input, not output).
-- NULL for CFO sessions where the contact is discovered by enrichment.
ALTER TABLE public.enrichment_session_companies
  ADD COLUMN IF NOT EXISTS contact_nome text,
  ADD COLUMN IF NOT EXISTS contact_ruolo text;
