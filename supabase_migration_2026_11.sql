-- =============================================================
-- Migration: November 2026 fixes
-- Run once in Supabase → SQL Editor. Safe to run more than once.
-- The server keeps working before this is run, but duplicate
-- protection and handover linking only start working after it.
-- =============================================================

-- 1. Duplicate protection for entries synced from the offline queue.
--    The app sends a unique client_id with every entry; the server
--    returns the existing row instead of saving a second copy.
ALTER TABLE public.expenses               ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE public.supervisor_income      ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE public.supervisor_expenditure ADD COLUMN IF NOT EXISTS client_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS expenses_client_id_key
  ON public.expenses (client_id) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS supervisor_income_client_id_key
  ON public.supervisor_income (client_id) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS supervisor_expenditure_client_id_key
  ON public.supervisor_expenditure (client_id) WHERE client_id IS NOT NULL;

-- 2. Link a supervisor-to-supervisor payout to the receiver's income row,
--    so deleting the payout also removes the money from the receiver.
ALTER TABLE public.supervisor_income
  ADD COLUMN IF NOT EXISTS source_expenditure_id UUID
  REFERENCES public.supervisor_expenditure(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS supervisor_income_source_expenditure_idx
  ON public.supervisor_income (source_expenditure_id);

-- 3. Turn on Row Level Security.
--    The server uses the service_role key, which bypasses RLS, so the app
--    is unaffected. This blocks anyone using the public anon key from
--    reading or changing data directly.
--    ⚠️ Only run this if the hosted server's SUPABASE_SERVICE_KEY is the
--    service_role key (not the anon key).
ALTER TABLE public.supervisors            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.labourers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisor_income      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisor_expenditure ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_settlements    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.admin_income      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.admin_expenditure ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.admin_expenses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.admin_logs        ENABLE ROW LEVEL SECURITY;

-- Check before relying on the new November data (see README notes):
-- SELECT supervisor_name, month, created_at FROM public.monthly_settlements
--   WHERE month = 'November 2026';
