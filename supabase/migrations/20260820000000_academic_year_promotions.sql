-- Migration: Academic Years and Student Promotions Schema

CREATE TABLE IF NOT EXISTS public.academic_years (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    year_name TEXT NOT NULL UNIQUE,
    start_date DATE,
    end_date DATE,
    is_current BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for performance on queries filtering by academic_year
CREATE INDEX IF NOT EXISTS idx_students_academic_year ON public.students(academic_year);
CREATE INDEX IF NOT EXISTS idx_payments_academic_year ON public.payments(academic_year);
CREATE INDEX IF NOT EXISTS idx_expenses_academic_year ON public.expenses(academic_year);

-- Enable RLS
ALTER TABLE public.academic_years ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Allow authenticated read access on academic_years" ON public.academic_years;
CREATE POLICY "Allow authenticated read access on academic_years"
    ON public.academic_years FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow admin write access on academic_years" ON public.academic_years;
CREATE POLICY "Allow admin write access on academic_years"
    ON public.academic_years FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- Default seed rows for academic years
INSERT INTO public.academic_years (year_name, is_current)
VALUES 
    ('2024-2025', false),
    ('2025-2026', true),
    ('2026-2027', false)
ON CONFLICT (year_name) DO NOTHING;
