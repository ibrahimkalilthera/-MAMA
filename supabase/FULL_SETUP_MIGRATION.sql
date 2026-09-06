-- ============================================================================
-- COMPLEXE SCOLAIRE MAMA THERA — COMPLETE SUPABASE DATABASE SETUP SCRIPT
-- ============================================================================
--
-- ⚠️  FICHIER GÉNÉRÉ AUTOMATIQUEMENT — NE PAS MODIFIER À LA MAIN.
-- Source de vérité : supabase/migrations/ (migrations ordonnées).
-- Toute évolution de schéma passe par une NOUVELLE migration ordonnée,
-- puis ce snapshot est régénéré (voir git log pour la date de génération).
--
-- Régénération :  node supabase/regenerate-full-setup.mjs
-- Vérification :  node supabase/regenerate-full-setup.mjs --check
--
-- Ce script est la concaténation des 20 migrations suivantes, dans
-- l'ordre chronologique de leur nom de fichier :
--
--   20260801000000_init.sql
--   20260809000000_auth_and_rls.sql
--   20260814000000_audit_logs.sql
--   20260820000000_academic_year_promotions.sql
--   20260828000000_vendor_expense_permissions.sql
--   20260828000001_auth_role_hardening.sql
--   20260828000002_custom_grades.sql
--   20260828000003_custom_grades_ci_and_grants.sql
--   20260828000004_custom_classes.sql
--   20260829000000_handle_new_user_guard.sql
--   20260902000000_general_manager_role.sql
--   20260902000001_econome_role.sql
--   20260902000002_student_note_entries.sql
--   20260902000003_todo_due_date.sql
--   20260902000004_admin_set_user_password.sql
--   20260902000005_team_inactivity_setting.sql
--   20260902000006_ninth_grade_student_identifiers.sql
--   20260903000001_calendar_notes.sql
--   20260906000000_anon_cannot_execute_admin_set_user_password.sql
--   20260906000001_staff_payroll_details.sql
--
-- Exécuté dans le Supabase SQL Editor, il recrée le schéma complet
-- (tables, index, fonctions, triggers, politiques RLS, données de
-- référence) en UNE exécution.
-- ============================================================================

-- ============================================================================
-- MIGRATION : 20260801000000_init.sql
-- ============================================================================

-- Schema for MAMA Finance Suite

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Parents Table
CREATE TABLE IF NOT EXISTS public.parents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name TEXT NOT NULL,
    phones TEXT[] NOT NULL,
    email TEXT,
    address TEXT NOT NULL,
    occupation TEXT NOT NULL,
    relationship TEXT NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Students Table
CREATE TABLE IF NOT EXISTS public.students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id TEXT UNIQUE,
    parent_id UUID REFERENCES public.parents(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    parent_name TEXT,
    parent_email TEXT,
    parent_phone TEXT,
    total_due NUMERIC DEFAULT 0,
    amount_paid NUMERIC DEFAULT 0,
    scholarship_discount NUMERIC DEFAULT 0,
    due_date DATE,
    last_payment_date DATE,
    notes TEXT,
    last_note_date DATE,
    flagged BOOLEAN DEFAULT FALSE,
    academic_year TEXT,
    grade TEXT,
    photo TEXT,
    emergency_contact_name TEXT,
    emergency_contact_relation TEXT,
    emergency_contact_phone TEXT,
    medical_notes TEXT,
    enrollment_date DATE,
    previous_school TEXT,
    status TEXT DEFAULT 'Active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Payments Table
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    amount NUMERIC NOT NULL,
    academic_year TEXT,
    receipt_number TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Staff Table
CREATE TABLE IF NOT EXISTS public.staff (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    position TEXT NOT NULL,
    salary NUMERIC NOT NULL,
    email TEXT,
    phone TEXT,
    bank_details TEXT,
    emergency_contact TEXT,
    academic_year TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Salary Payments Table
CREATE TABLE IF NOT EXISTS public.salary_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID REFERENCES public.staff(id) ON DELETE CASCADE,
    amount NUMERIC NOT NULL,
    date DATE NOT NULL,
    academic_year TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Expenses Table
CREATE TABLE IF NOT EXISTS public.expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    date DATE NOT NULL,
    academic_year TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Vendor Expenses Table
CREATE TABLE IF NOT EXISTS public.vendor_expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vendor_name TEXT NOT NULL,
    category TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    due_date DATE NOT NULL,
    payment_status TEXT NOT NULL,
    amount_paid NUMERIC DEFAULT 0,
    description TEXT,
    academic_year TEXT,
    aid_type TEXT,
    beneficiary_student_name TEXT,
    beneficiary_student_grade TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Todos Table
CREATE TABLE IF NOT EXISTS public.todos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    text TEXT NOT NULL,
    completed BOOLEAN DEFAULT FALSE,
    student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Turn on Row Level Security
ALTER TABLE public.parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;

-- Allow anonymous access for now (Replace with auth later)
CREATE POLICY "Allow anonymous read access" ON public.parents FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert access" ON public.parents FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update access" ON public.parents FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous delete access" ON public.parents FOR DELETE USING (true);

CREATE POLICY "Allow anonymous read access" ON public.students FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert access" ON public.students FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update access" ON public.students FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous delete access" ON public.students FOR DELETE USING (true);

CREATE POLICY "Allow anonymous read access" ON public.payments FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert access" ON public.payments FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update access" ON public.payments FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous delete access" ON public.payments FOR DELETE USING (true);

CREATE POLICY "Allow anonymous read access" ON public.staff FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert access" ON public.staff FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update access" ON public.staff FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous delete access" ON public.staff FOR DELETE USING (true);

CREATE POLICY "Allow anonymous read access" ON public.salary_payments FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert access" ON public.salary_payments FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update access" ON public.salary_payments FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous delete access" ON public.salary_payments FOR DELETE USING (true);

CREATE POLICY "Allow anonymous read access" ON public.expenses FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert access" ON public.expenses FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update access" ON public.expenses FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous delete access" ON public.expenses FOR DELETE USING (true);

CREATE POLICY "Allow anonymous read access" ON public.vendor_expenses FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert access" ON public.vendor_expenses FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update access" ON public.vendor_expenses FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous delete access" ON public.vendor_expenses FOR DELETE USING (true);

CREATE POLICY "Allow anonymous read access" ON public.todos FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert access" ON public.todos FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update access" ON public.todos FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous delete access" ON public.todos FOR DELETE USING (true);

-- ============================================================================
-- MIGRATION : 20260809000000_auth_and_rls.sql
-- ============================================================================

-- ============================================================================
-- MAMA THERA Finance Suite — Auth & RLS Migration
-- ============================================================================
-- This migration:
--   1. Creates a user_profiles table linked to Supabase Auth
--   2. Creates a trigger to auto-create profiles on user signup
--   3. Drops all "Allow anonymous" RLS policies
--   4. Replaces them with authenticated + role-based policies
-- ============================================================================

-- ─── 1. User Profiles Table ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT NOT NULL DEFAULT 'New User',
    role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff', 'dev')),
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- ─── 2. Auto-Create Profile on Signup Trigger ────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (id, email, full_name, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'),
        'staff'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if it exists (idempotent)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─── 3. Helper Function: Check if Current User is Admin ──────────────────────

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.user_profiles 
        WHERE id = auth.uid() AND role IN ('admin', 'dev')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ─── 4. Drop All Old Anonymous Policies ──────────────────────────────────────

-- Parents
DROP POLICY IF EXISTS "Allow anonymous read access" ON public.parents;
DROP POLICY IF EXISTS "Allow anonymous insert access" ON public.parents;
DROP POLICY IF EXISTS "Allow anonymous update access" ON public.parents;
DROP POLICY IF EXISTS "Allow anonymous delete access" ON public.parents;

-- Students
DROP POLICY IF EXISTS "Allow anonymous read access" ON public.students;
DROP POLICY IF EXISTS "Allow anonymous insert access" ON public.students;
DROP POLICY IF EXISTS "Allow anonymous update access" ON public.students;
DROP POLICY IF EXISTS "Allow anonymous delete access" ON public.students;

-- Payments
DROP POLICY IF EXISTS "Allow anonymous read access" ON public.payments;
DROP POLICY IF EXISTS "Allow anonymous insert access" ON public.payments;
DROP POLICY IF EXISTS "Allow anonymous update access" ON public.payments;
DROP POLICY IF EXISTS "Allow anonymous delete access" ON public.payments;

-- Staff
DROP POLICY IF EXISTS "Allow anonymous read access" ON public.staff;
DROP POLICY IF EXISTS "Allow anonymous insert access" ON public.staff;
DROP POLICY IF EXISTS "Allow anonymous update access" ON public.staff;
DROP POLICY IF EXISTS "Allow anonymous delete access" ON public.staff;

-- Salary Payments
DROP POLICY IF EXISTS "Allow anonymous read access" ON public.salary_payments;
DROP POLICY IF EXISTS "Allow anonymous insert access" ON public.salary_payments;
DROP POLICY IF EXISTS "Allow anonymous update access" ON public.salary_payments;
DROP POLICY IF EXISTS "Allow anonymous delete access" ON public.salary_payments;

-- Expenses
DROP POLICY IF EXISTS "Allow anonymous read access" ON public.expenses;
DROP POLICY IF EXISTS "Allow anonymous insert access" ON public.expenses;
DROP POLICY IF EXISTS "Allow anonymous update access" ON public.expenses;
DROP POLICY IF EXISTS "Allow anonymous delete access" ON public.expenses;

-- Vendor Expenses
DROP POLICY IF EXISTS "Allow anonymous read access" ON public.vendor_expenses;
DROP POLICY IF EXISTS "Allow anonymous insert access" ON public.vendor_expenses;
DROP POLICY IF EXISTS "Allow anonymous update access" ON public.vendor_expenses;
DROP POLICY IF EXISTS "Allow anonymous delete access" ON public.vendor_expenses;

-- Todos
DROP POLICY IF EXISTS "Allow anonymous read access" ON public.todos;
DROP POLICY IF EXISTS "Allow anonymous insert access" ON public.todos;
DROP POLICY IF EXISTS "Allow anonymous update access" ON public.todos;
DROP POLICY IF EXISTS "Allow anonymous delete access" ON public.todos;

-- ─── 5. New Authenticated + Role-Based Policies ─────────────────────────────

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  user_profiles: Admins see all, staff sees own profile only            │
-- └─────────────────────────────────────────────────────────────────────────┘
CREATE POLICY "Users can view own profile" ON public.user_profiles
    FOR SELECT USING (auth.uid() = id OR public.is_admin());

CREATE POLICY "Admins can insert profiles" ON public.user_profiles
    FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update profiles" ON public.user_profiles
    FOR UPDATE USING (public.is_admin());

CREATE POLICY "Admins can delete profiles" ON public.user_profiles
    FOR DELETE USING (public.is_admin());

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  parents: All authenticated users can read/write                       │
-- └─────────────────────────────────────────────────────────────────────────┘
CREATE POLICY "Authenticated read parents" ON public.parents
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated insert parents" ON public.parents
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated update parents" ON public.parents
    FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Admin delete parents" ON public.parents
    FOR DELETE USING (public.is_admin());

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  students: All authenticated users can read/write                      │
-- └─────────────────────────────────────────────────────────────────────────┘
CREATE POLICY "Authenticated read students" ON public.students
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated insert students" ON public.students
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated update students" ON public.students
    FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Admin delete students" ON public.students
    FOR DELETE USING (public.is_admin());

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  payments: All authenticated can read/insert, admin can modify/delete  │
-- └─────────────────────────────────────────────────────────────────────────┘
CREATE POLICY "Authenticated read payments" ON public.payments
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated insert payments" ON public.payments
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Admin update payments" ON public.payments
    FOR UPDATE USING (public.is_admin());

CREATE POLICY "Admin delete payments" ON public.payments
    FOR DELETE USING (public.is_admin());

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  staff: All authenticated can read, only admins can write              │
-- └─────────────────────────────────────────────────────────────────────────┘
CREATE POLICY "Authenticated read staff" ON public.staff
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admin insert staff" ON public.staff
    FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "Admin update staff" ON public.staff
    FOR UPDATE USING (public.is_admin());

CREATE POLICY "Admin delete staff" ON public.staff
    FOR DELETE USING (public.is_admin());

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  salary_payments: All authenticated can read, only admins can write    │
-- └─────────────────────────────────────────────────────────────────────────┘
CREATE POLICY "Authenticated read salary_payments" ON public.salary_payments
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admin insert salary_payments" ON public.salary_payments
    FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "Admin update salary_payments" ON public.salary_payments
    FOR UPDATE USING (public.is_admin());

CREATE POLICY "Admin delete salary_payments" ON public.salary_payments
    FOR DELETE USING (public.is_admin());

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  expenses: All authenticated can read/write                            │
-- └─────────────────────────────────────────────────────────────────────────┘
CREATE POLICY "Authenticated read expenses" ON public.expenses
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated insert expenses" ON public.expenses
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated update expenses" ON public.expenses
    FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Admin delete expenses" ON public.expenses
    FOR DELETE USING (public.is_admin());

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  vendor_expenses: All authenticated can read/write                     │
-- └─────────────────────────────────────────────────────────────────────────┘
CREATE POLICY "Authenticated read vendor_expenses" ON public.vendor_expenses
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated insert vendor_expenses" ON public.vendor_expenses
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated update vendor_expenses" ON public.vendor_expenses
    FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Admin delete vendor_expenses" ON public.vendor_expenses
    FOR DELETE USING (public.is_admin());

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  todos: All authenticated can read/write                               │
-- └─────────────────────────────────────────────────────────────────────────┘
CREATE POLICY "Authenticated read todos" ON public.todos
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated insert todos" ON public.todos
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated update todos" ON public.todos
    FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated delete todos" ON public.todos
    FOR DELETE USING (auth.role() = 'authenticated');

-- ============================================================================
-- MIGRATION : 20260814000000_audit_logs.sql
-- ============================================================================

-- Migration: Audit Trail & Security Logs
-- Description: Creates the audit_logs table with RLS policies restricting read access to Admins.

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    user_email TEXT,
    user_name TEXT,
    user_role TEXT DEFAULT 'staff',
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy 1: Any authenticated user can insert audit log entries
CREATE POLICY "Authenticated users can insert audit logs"
    ON public.audit_logs
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Policy 2: Admin users can read all audit logs
CREATE POLICY "Admins can view audit logs"
    ON public.audit_logs
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.user_profiles
            WHERE user_profiles.id = auth.uid()
            AND user_profiles.role IN ('admin', 'dev')
        )
    );

-- Index for fast time-series queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs (created_at DESC);

-- ============================================================================
-- MIGRATION : 20260820000000_academic_year_promotions.sql
-- ============================================================================

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

-- ============================================================================
-- MIGRATION : 20260828000000_vendor_expense_permissions.sql
-- ============================================================================

-- Migration: Vendor expense permissions
-- Promoters (admin/dev) own the vendor and total amount fields.
-- Staff may still update operational fields on an existing expense, such as
-- category, status, due date, amount paid, and description.

-- Remove legacy policies that could grant anonymous or unrestricted access.
DROP POLICY IF EXISTS "Allow anonymous read access" ON public.vendor_expenses;
DROP POLICY IF EXISTS "Allow anonymous insert access" ON public.vendor_expenses;
DROP POLICY IF EXISTS "Allow anonymous update access" ON public.vendor_expenses;
DROP POLICY IF EXISTS "Allow anonymous delete access" ON public.vendor_expenses;
DROP POLICY IF EXISTS "Authenticated read vendor_expenses" ON public.vendor_expenses;
DROP POLICY IF EXISTS "Authenticated insert vendor_expenses" ON public.vendor_expenses;
DROP POLICY IF EXISTS "Authenticated update vendor_expenses" ON public.vendor_expenses;
DROP POLICY IF EXISTS "Admin insert vendor_expenses" ON public.vendor_expenses;
DROP POLICY IF EXISTS "Authenticated users can read vendor_expenses" ON public.vendor_expenses;
DROP POLICY IF EXISTS "Authenticated users can insert vendor_expenses" ON public.vendor_expenses;
DROP POLICY IF EXISTS "Authenticated users can update vendor_expenses" ON public.vendor_expenses;
DROP POLICY IF EXISTS "Admin delete vendor_expenses" ON public.vendor_expenses;

CREATE POLICY "Authenticated read vendor_expenses"
    ON public.vendor_expenses
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Promoter insert vendor_expenses"
    ON public.vendor_expenses
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin());

CREATE POLICY "Authenticated update vendor_expenses"
    ON public.vendor_expenses
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Promoter delete vendor_expenses"
    ON public.vendor_expenses
    FOR DELETE
    TO authenticated
    USING (public.is_admin());

-- RLS cannot compare OLD and NEW values. This trigger closes that gap for
-- staff updates made through a client that bypasses the disabled form fields.
CREATE OR REPLACE FUNCTION public.prevent_vendor_expense_financial_edit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_admin()
       AND (
           NEW.vendor_name IS DISTINCT FROM OLD.vendor_name
           OR NEW.amount IS DISTINCT FROM OLD.amount
       ) THEN
        RAISE EXCEPTION 'Only the promoter can change the vendor or amount.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_vendor_expense_financial_fields ON public.vendor_expenses;
CREATE TRIGGER protect_vendor_expense_financial_fields
    BEFORE UPDATE ON public.vendor_expenses
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_vendor_expense_financial_edit();

-- ============================================================================
-- MIGRATION : 20260828000001_auth_role_hardening.sql
-- ============================================================================

-- Migration: Auth role hardening
-- A public signup must never be able to choose an administrative role.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.user_profiles (id, email, full_name, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'),
        'staff'
    );
    RETURN NEW;
END;
$$;

-- ============================================================================
-- MIGRATION : 20260828000002_custom_grades.sql
-- ============================================================================

-- Shared custom classes used by all authenticated school users
CREATE TABLE IF NOT EXISTS public.custom_grades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT custom_grades_name_unique UNIQUE (name)
);

ALTER TABLE public.custom_grades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read custom grades" ON public.custom_grades;
CREATE POLICY "Authenticated read custom grades"
    ON public.custom_grades FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Authenticated insert custom grades" ON public.custom_grades;
CREATE POLICY "Authenticated insert custom grades"
    ON public.custom_grades FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- ============================================================================
-- MIGRATION : 20260828000003_custom_grades_ci_and_grants.sql
-- ============================================================================

-- Migration: custom_grades — case-insensitive uniqueness + explicit API grants
-- The UI deduplicates class names case-insensitively, but the previous UNIQUE(name)
-- constraint was case-sensitive, allowing "1ère année B" and "1ERE ANNEE B" to both
-- be stored. Replace it with a case-insensitive unique index so the database matches
-- the front-end behavior and no case-duplicate classes can accumulate.
--
-- Supabase exposes tables to the REST/PostgREST API through privileges on the
-- `authenticated` role (the "API privileges" panel toggles these). State them
-- explicitly here so access does not depend on dashboard configuration.

-- Replace the case-sensitive unique constraint with a case-insensitive unique index.
ALTER TABLE public.custom_grades DROP CONSTRAINT IF EXISTS custom_grades_name_unique;

CREATE UNIQUE INDEX IF NOT EXISTS custom_grades_name_lower_unique
    ON public.custom_grades (lower(name));

-- Rebuild the insert policy so a redundant exact/case variant cannot be inserted
-- (PostgREST relies on the unique index; keep the policy aligned with it).
DROP POLICY IF EXISTS "Authenticated insert custom grades" ON public.custom_grades;
CREATE POLICY "Authenticated insert custom grades"
    ON public.custom_grades FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Explicit API privileges for the authenticated role.
GRANT SELECT, INSERT ON public.custom_grades TO authenticated;

-- ============================================================================
-- MIGRATION : 20260828000004_custom_classes.sql
-- ============================================================================

-- Migration: custom_classes — single source of truth for shared custom classes
-- Supersedes the localStorage-based class management and the custom_grades
-- table. Custom classes are shared across all authenticated users.
--
-- Schema: id (uuid), code (display id, e.g. '1D' or a custom name),
-- cycle/year/section, French/English display names.

CREATE TABLE IF NOT EXISTS public.custom_classes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT NOT NULL,
    cycle TEXT NOT NULL DEFAULT 'other',
    year TEXT NOT NULL DEFAULT '',
    section TEXT NOT NULL DEFAULT '',
    name_fr TEXT NOT NULL,
    name_en TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Case-insensitive uniqueness on the display code, mirroring the UI dedup
-- behavior (no '1B' vs '1b' duplicates).
CREATE UNIQUE INDEX IF NOT EXISTS custom_classes_code_lower_unique
    ON public.custom_classes (lower(code));

ALTER TABLE public.custom_classes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read custom classes" ON public.custom_classes;
CREATE POLICY "Authenticated read custom classes"
    ON public.custom_classes FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Authenticated insert custom classes" ON public.custom_classes;
CREATE POLICY "Authenticated insert custom classes"
    ON public.custom_classes FOR INSERT
    TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated update custom classes" ON public.custom_classes;
CREATE POLICY "Authenticated update custom classes"
    ON public.custom_classes FOR UPDATE
    TO authenticated
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated delete custom classes" ON public.custom_classes;
CREATE POLICY "Authenticated delete custom classes"
    ON public.custom_classes FOR DELETE
    TO authenticated
    USING (true);

-- Explicit API privileges for the authenticated role (PostgREST).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_classes TO authenticated;

-- Migrate any rows left in the superseded custom_grades table into
-- custom_classes (as 'other' cycle), then drop custom_grades.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'custom_grades') THEN
        INSERT INTO public.custom_classes (code, cycle, year, section, name_fr, name_en)
        SELECT name, 'other', '', '', name, name
        FROM public.custom_grades
        ON CONFLICT DO NOTHING;
        DROP TABLE public.custom_grades;
    END IF;
END
$$;

-- ============================================================================
-- MIGRATION : 20260829000000_handle_new_user_guard.sql
-- ============================================================================

-- Migration: handle_new_user profile guard
-- Never create a profile with the default "New User" display name.
--
-- Security note: the role is intentionally NOT read from user metadata here.
-- supabase.auth.signUp() accepts arbitrary metadata, and createStaffUser runs
-- under the ANON key, so honoring a metadata "role" would let anyone
-- self-promote to admin/dev. New signups therefore always land as 'staff';
-- promotion to admin/dev happens via the admin-only updateUserRole flow.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_full_name TEXT;
BEGIN
    -- Real name from metadata if provided, otherwise derive a readable
    -- display name from the email local-part (never the literal "New User").
    v_full_name := NULLIF(btrim(NEW.raw_user_meta_data->>'full_name'), '');
    IF v_full_name IS NULL THEN
        -- Derive a readable display name from the email local-part:
        -- split on '.' / '_' / '-' and a camel-case-ish boundary.
        BEGIN
            v_full_name := regexp_replace(split_part(NEW.email, '@', 1), '[-_.]', ' ', 'g');
            v_full_name := regexp_replace(v_full_name, '([a-z0-9])([A-Z])', '\1 \2', 'g');
            v_full_name := initcap(btrim(v_full_name));
        EXCEPTION WHEN OTHERS THEN
            v_full_name := split_part(NEW.email, '@', 1);
        END;
    END IF;

    INSERT INTO public.user_profiles (id, email, full_name, role)
    VALUES (NEW.id, NEW.email, v_full_name, 'staff');
    RETURN NEW;
END;
$$;

-- ============================================================================
-- MIGRATION : 20260902000000_general_manager_role.sql
-- ============================================================================

-- Migration: introduce the `general_manager` role (Gestionnaire Principal).
--
-- Semantics (distinct from admin/dev):
--   • admin/dev        → full access: user & role management, settings, audit
--                        trail, academic-year close-out, destructive deletes.
--   • general_manager  → full FINANCIAL administration: vendor expenses,
--                        scholarship discounts, Excel imports, staff & salary
--                        writes — but NOT user management, settings, audit,
--                        year close-out or profile deletes.
--   • staff            → daily entries (students, payments, receipts, expenses).
--
-- App-level gates (useAuthWelcome, Sidebar, AppHeader, useYearOps, useUsers)
-- keep `is_admin()` semantics for admin/dev-only screens; only the FINANCE
-- write surfaces widen to include general_manager.

-- ─── 1. Widen the role CHECK constraint ─────────────────────────────────────
ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('admin', 'staff', 'dev', 'general_manager'));

-- ─── 2. Helper: financial administration (admin, dev, general_manager) ──────
CREATE OR REPLACE FUNCTION public.is_finance_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'dev', 'general_manager')
  );
$$;

-- ─── 3. Staff & salary_payments: financial admins may write ─────────────────
DROP POLICY IF EXISTS "Admin insert staff" ON public.staff;
CREATE POLICY "Finance admins insert staff" ON public.staff
    FOR INSERT WITH CHECK (public.is_finance_admin());

DROP POLICY IF EXISTS "Admin update staff" ON public.staff;
CREATE POLICY "Finance admins update staff" ON public.staff
    FOR UPDATE USING (public.is_finance_admin());

DROP POLICY IF EXISTS "Admin delete staff" ON public.staff;
CREATE POLICY "Finance admins delete staff" ON public.staff
    FOR DELETE USING (public.is_finance_admin());

DROP POLICY IF EXISTS "Admin insert salary_payments" ON public.salary_payments;
CREATE POLICY "Finance admins insert salary_payments" ON public.salary_payments
    FOR INSERT WITH CHECK (public.is_finance_admin());

DROP POLICY IF EXISTS "Admin update salary_payments" ON public.salary_payments;
CREATE POLICY "Finance admins update salary_payments" ON public.salary_payments
    FOR UPDATE USING (public.is_finance_admin());

DROP POLICY IF EXISTS "Admin delete salary_payments" ON public.salary_payments;
CREATE POLICY "Finance admins delete salary_payments" ON public.salary_payments
    FOR DELETE USING (public.is_finance_admin());

-- ─── 4. PostgREST schema cache reload ───────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- MIGRATION : 20260902000001_econome_role.sql
-- ============================================================================

-- Migration: introduce the `econome` (Accountant) role position.
--
-- Staff and econome are TWO distinct job titles that can be defined when
-- creating accounts, but they share the exact same authority in the app —
-- neither is admin/dev/general_manager, so every existing permission gate
-- (isAdmin, isFinanceAdmin, year ops, audit) already treats them alike.
-- This migration only widens the role CHECK constraint; no policy changes
-- are needed (econome stays outside is_finance_admin, like staff).

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('admin', 'staff', 'dev', 'general_manager', 'econome'));

-- ─── PostgREST schema cache reload ─────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- MIGRATION : 20260902000002_student_note_entries.sql
-- ============================================================================

-- Migration: persist dated notes (Notes ⇄ Calendar bridge) on students.
--
-- The bridge stores dated entries as `noteEntries` on the Student model
-- (calendar day modal → student sheet, and the reverse). The column was
-- never created: `studentUpdatesToRow` silently dropped `noteEntries` at
-- the DB boundary, so notes only ever survived the current session.
-- This column is the persistence half of the bridge.

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS note_entries jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ============================================================================
-- MIGRATION : 20260902000003_todo_due_date.sql
-- ============================================================================

-- Migration: add an optional due date to to-dos so tasks can appear on the
-- calendar (grid badge + day-modal list) alongside financial events.
ALTER TABLE todos ADD COLUMN due_date date;

-- ============================================================================
-- MIGRATION : 20260902000004_admin_set_user_password.sql
-- ============================================================================

-- Migration: admin/dev can set any account's password directly.
--
-- The settings screen previously only offered an email-based reset. This
-- RPC lets an authenticated admin or dev set a new password for any account
-- immediately (no email round-trip). SECURITY DEFINER + in-function role
-- check: only profiles with role 'admin' or 'dev' may call it.
--
-- GoTrue verifies bcrypt hashes of the form $2a$<cost>$...; crypt(pw,
-- gen_salt('bf', 10)) produces exactly that format (cost 10), so the
-- updated password works with signInWithPassword.

CREATE OR REPLACE FUNCTION public.admin_set_user_password(target_user_id uuid, new_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    caller_role TEXT;
BEGIN
    SELECT role INTO caller_role
    FROM public.user_profiles
    WHERE id = auth.uid();

    IF caller_role IS NULL OR caller_role NOT IN ('admin', 'dev') THEN
        RAISE EXCEPTION 'only admin or dev can set passwords';
    END IF;

    IF new_password IS NULL OR char_length(new_password) < 6 THEN
        RAISE EXCEPTION 'password must be at least 6 characters';
    END IF;

    UPDATE auth.users
    SET encrypted_password = crypt(new_password, gen_salt('bf', 10)),
        updated_at = now()
    WHERE id = target_user_id;

    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_password(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_set_user_password(uuid, text) TO authenticated;

-- ============================================================================
-- MIGRATION : 20260902000005_team_inactivity_setting.sql
-- ============================================================================

-- ============================================================================
-- MAMA THERA Finance Suite — Team-wide settings (inactivity auto-logout)
-- ============================================================================
-- The auto-logout window is a TEAM decision: one row, shared by every
-- account and every browser (previously each browser kept its own value in
-- localStorage). Anyone authenticated may READ the settings (every client
-- applies the window at login); only admin/dev may WRITE (the Settings tab,
-- the only UI that changes it, is admin-only anyway).
--
-- The row is seeded with the historical default (30 minutes) so the DB is
-- authoritative from the first deploy; browser localStorage remains only a
-- fast-start cache while no row exists.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.app_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated account (every client applies the window).
DROP POLICY IF EXISTS "app_settings_read" ON public.app_settings;
CREATE POLICY "app_settings_read"
    ON public.app_settings
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- Write: admin/dev only, re-checked server-side (is_admin() helper).
DROP POLICY IF EXISTS "app_settings_write" ON public.app_settings;
CREATE POLICY "app_settings_write"
    ON public.app_settings
    FOR INSERT
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "app_settings_update" ON public.app_settings;
CREATE POLICY "app_settings_update"
    ON public.app_settings
    FOR UPDATE
    USING (is_admin());

-- Seed the historical default so the setting exists team-wide immediately.
INSERT INTO public.app_settings (key, value)
VALUES ('inactivity_minutes', '30'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- MIGRATION : 20260902000006_ninth_grade_student_identifiers.sql
-- ============================================================================

-- Migration: matricules are only used by ninth-year students.
--
-- The application enforces the same policy at every read/write boundary. This
-- cleanup removes values written by older versions for students whose class is
-- not ninth year, while preserving 9A/9B/9C/9D and equivalent display labels.
-- It is idempotent and deliberately leaves the internal UUID `students.id`
-- untouched; payments, todos, and notifications continue to use that UUID.

UPDATE public.students
SET student_id = NULL
WHERE student_id IS NOT NULL
  AND (
    grade IS NULL
    OR grade !~* '(^|[^0-9])9(ème|eme|th|e|[[:alpha:]])?[[:alpha:]]?([^[:alnum:]]|$)'
  );

-- ============================================================================
-- MIGRATION : 20260903000001_calendar_notes.sql
-- ============================================================================

-- ============================================================================
-- MAMA THERA Finance Suite — Team-wide calendar day notes
-- ============================================================================
-- A note added from the calendar day modal is a TEAM artefact: every account
-- sees it, like todos (which already live in the shared todos table). The
-- standalone notes were previously stored in the author's browser
-- localStorage only (`calendar-day-notes` key) — invisible to everyone else.
--
-- Access: any authenticated account can read and write (same posture as
-- todos); anonymous access is denied by RLS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.calendar_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_date DATE NOT NULL,
    text TEXT NOT NULL,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS calendar_notes_note_date_idx ON public.calendar_notes (note_date);

ALTER TABLE public.calendar_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read calendar_notes" ON public.calendar_notes;
CREATE POLICY "Authenticated read calendar_notes"
    ON public.calendar_notes
    FOR SELECT
    USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated insert calendar_notes" ON public.calendar_notes;
CREATE POLICY "Authenticated insert calendar_notes"
    ON public.calendar_notes
    FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated update calendar_notes" ON public.calendar_notes;
CREATE POLICY "Authenticated update calendar_notes"
    ON public.calendar_notes
    FOR UPDATE
    USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated delete calendar_notes" ON public.calendar_notes;
CREATE POLICY "Authenticated delete calendar_notes"
    ON public.calendar_notes
    FOR DELETE
    USING (auth.role() = 'authenticated');

-- ============================================================================
-- MIGRATION : 20260906000000_anon_cannot_execute_admin_set_user_password.sql
-- ============================================================================

-- Migration: anon must never execute admin_set_user_password.
--
-- The original hardening (20260902000004) revoked EXECUTE FROM public, but
-- Supabase's default privileges (ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE
-- ON FUNCTIONS TO anon, authenticated, service_role) grant the anon role a
-- DIRECT execute right when the function is created — a REVOKE FROM public
-- does not remove it. The in-function role check was therefore the only
-- barrier, and anon could actually execute the RPC (it raised the exception
-- after running). This migration removes the direct anon grant; the RPC
-- stays callable for authenticated (admin/dev) only.

REVOKE EXECUTE ON FUNCTION public.admin_set_user_password(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_password(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_set_user_password(uuid, text) TO authenticated;

-- ============================================================================
-- MIGRATION : 20260906000001_staff_payroll_details.sql
-- ============================================================================

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
