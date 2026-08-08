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
ALTER TABLE public.supervisors DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.labourers DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisor_income DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisor_expenditure DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_settlements DISABLE ROW LEVEL SECURITY;

