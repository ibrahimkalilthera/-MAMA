-- Migration: staff payroll & social details (bulletin de paie data).
--
-- Adds the fields printed on the monthly bulletin de paie / fiche de
-- paiement: INPS number, hire date, family status, number of children and
-- the three allowance lines (travel, communication, housing). Every column
-- is nullable or defaulted so existing staff rows keep working and the PDF
-- generators fall back to dashes / zeros when a field is empty.

ALTER TABLE public.staff
    ADD COLUMN IF NOT EXISTS inps_number TEXT,
    ADD COLUMN IF NOT EXISTS hire_date DATE,
    ADD COLUMN IF NOT EXISTS family_status TEXT
        CHECK (family_status IN ('single', 'married', 'divorced', 'widowed')),
    ADD COLUMN IF NOT EXISTS children_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS travel_allowance NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS communication_allowance NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS housing_allowance NUMERIC NOT NULL DEFAULT 0;