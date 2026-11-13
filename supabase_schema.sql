-- SITE EXPENSE & CASH BOOK TRACKER - SUPABASE SQL SCHEMA
-- Run this in your Supabase Project's SQL Editor (https://supabase.com/dashboard/project/_/sql)

-- 1. Create Supervisors Table
CREATE TABLE IF NOT EXISTS public.supervisors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  pin_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create Expenses Table (Receipt Bills)
CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_id UUID REFERENCES public.supervisors(id) ON DELETE SET NULL,
  supervisor_name TEXT NOT NULL,
  amount NUMERIC(10, 2) NOT NULL,
  note TEXT,
  date DATE NOT NULL,
  photo_url TEXT NOT NULL,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Create Application Configuration Table
CREATE TABLE IF NOT EXISTS public.app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 4. Create Daily Labourers Registry
CREATE TABLE IF NOT EXISTS public.labourers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Create Supervisor Income Table (Inflows)
CREATE TABLE IF NOT EXISTS public.supervisor_income (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_id UUID REFERENCES public.supervisors(id) ON DELETE SET NULL,
  supervisor_name TEXT NOT NULL,
  amount NUMERIC(10, 2) NOT NULL,
  date DATE NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Create Supervisor Expenditure Table (Outflows)
CREATE TABLE IF NOT EXISTS public.supervisor_expenditure (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_id UUID REFERENCES public.supervisors(id) ON DELETE SET NULL,
  supervisor_name TEXT NOT NULL,
  amount NUMERIC(10, 2) NOT NULL,
  type TEXT NOT NULL, -- 'labour', 'general', or 'supervisor'
  labourer_id UUID REFERENCES public.labourers(id) ON DELETE SET NULL,
  labourer_name TEXT, -- historical copy
  to_supervisor_id UUID REFERENCES public.supervisors(id) ON DELETE SET NULL,
  to_supervisor_name TEXT,
  note TEXT,
  date DATE NOT NULL,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 8. Create Monthly Settlements Table
CREATE TABLE IF NOT EXISTS public.monthly_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_id UUID REFERENCES public.supervisors(id) ON DELETE CASCADE,
  supervisor_name TEXT NOT NULL,
  month TEXT NOT NULL, -- Format: 'June 2026'
  salary NUMERIC(10, 2) NOT NULL,
  inflow NUMERIC(10, 2) NOT NULL,
  outflow NUMERIC(10, 2) NOT NULL,
  cash_left NUMERIC(10, 2) NOT NULL,
  net_salary NUMERIC(10, 2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(supervisor_id, month)
);

-- 7. Disable Row Level Security (RLS) so the backend can read/write data easily
ALTER TABLE public.supervisors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.labourers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisor_income ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisor_expenditure ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_settlements ENABLE ROW LEVEL SECURITY;

-- 9. Create Admin Income Table (Inflows for Company and Personal)
CREATE TABLE IF NOT EXISTS public.admin_income (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL DEFAULT 'company', -- 'company' or 'personal'
  amount NUMERIC(10, 2) NOT NULL,
  date DATE NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 10. Create Admin Expenditure Table (Outflows for Company and Personal)
CREATE TABLE IF NOT EXISTS public.admin_expenditure (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL DEFAULT 'company', -- 'company' or 'personal'
  amount NUMERIC(10, 2) NOT NULL,
  type TEXT NOT NULL, -- 'labour', 'general', or 'supervisor'
  labourer_id UUID REFERENCES public.labourers(id) ON DELETE SET NULL,
  labourer_name TEXT,
  to_supervisor_id UUID REFERENCES public.supervisors(id) ON DELETE SET NULL,
  to_supervisor_name TEXT,
  note TEXT,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 11. Create Admin Expenses Table (Bills / Receipt Chits for Company and Personal)
CREATE TABLE IF NOT EXISTS public.admin_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL DEFAULT 'company', -- 'company' or 'personal'
  amount NUMERIC(10, 2) NOT NULL,
  note TEXT,
  date DATE NOT NULL,
  photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 12. Create Admin Unified Logs Table (All-in-one logs for Company and Personal)
CREATE TABLE IF NOT EXISTS public.admin_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL DEFAULT 'company', -- 'company' or 'personal'
  entry_type TEXT NOT NULL DEFAULT 'out', -- 'in' (money in / received) or 'out' (money out / spent)
  amount NUMERIC(10, 2) NOT NULL,
  date DATE NOT NULL,
  note TEXT,
  photo_url TEXT,
  sub_type TEXT DEFAULT 'general', -- 'general', 'labour', 'supervisor', 'personal'
  labourer_id UUID REFERENCES public.labourers(id) ON DELETE SET NULL,
  labourer_name TEXT,
  to_supervisor_id UUID REFERENCES public.supervisors(id) ON DELETE SET NULL,
  to_supervisor_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;


-- November 2026 additions (also in supabase_migration_2026_11.sql)
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

