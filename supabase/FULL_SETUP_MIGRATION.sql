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
-- Ce script est la concaténation des 31 migrations suivantes, dans
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
--   20260906000002_vendor_expense_gm_policies.sql
--   20260908000000_calendar_notes_author_only.sql
--   20260914000000_staff_category.sql
--   20260914000001_drop_inactivity_setting.sql
--   20260914000002_nursery_classes.sql
--   20260927000000_audit_logs_offline_origin.sql
--   20261005000000_econome_payroll_writes.sql
--   20261005000001_dedupe_students.sql
--   20261005000002_students_business_key_unique.sql
--   20261005000003_econome_delete_payments.sql
--   20261005000004_audit_logs_metadata.sql
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

-- ============================================================================
-- MIGRATION : 20260906000002_vendor_expense_gm_policies.sql
-- ============================================================================

-- Migration: vendor_expenses write policies → finance admins.
--
-- The app has ALWAYS treated the general_manager (Gestionnaire Principal) as a
-- finance admin able to CREATE and DELETE vendor expenses: the UI gates
-- (ExpensesView canManageVendors, useExpenses isFinanceAdmin) and the submit
-- handler's "only the promoter can create a vendor expense" alert all fire
-- for finance admins (admin/dev + general_manager), and the role migration
-- 20260902000000 documented general_manager as "full FINANCIAL
-- administration: vendor expenses, scholarship discounts, Excel imports,
-- staff & salary writes".
--
-- The RLS policies introduced by 20260828000000 were never widened when the
-- general_manager role landed: INSERT and DELETE still demanded
-- public.is_admin() (admin/dev only), so a general_manager saw the create /
-- delete buttons in the UI but every write was silently rejected by Postgres
-- ("new row violates row-level security policy"). This migration closes that
-- app↔DB gap.
--
-- The promoter-only monopoly is NOT removed for existing records: the
-- BEFORE UPDATE trigger (protect_vendor_expense_financial_edit) still keeps
-- vendor_name / amount immutable for everyone but admin/dev, so the update
-- semantics documented in 20260828000000 are unchanged.

-- ─── 1. INSERT: finance admins may create ───────────────────────────────────
DROP POLICY IF EXISTS "Promoter insert vendor_expenses" ON public.vendor_expenses;

CREATE POLICY "Finance admins insert vendor_expenses"
    ON public.vendor_expenses
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_finance_admin());

-- ─── 2. DELETE: finance admins may delete ───────────────────────────────────
DROP POLICY IF EXISTS "Promoter delete vendor_expenses" ON public.vendor_expenses;

CREATE POLICY "Finance admins delete vendor_expenses"
    ON public.vendor_expenses
    FOR DELETE
    TO authenticated
    USING (public.is_finance_admin());

-- ─── 3. PostgREST schema cache reload ───────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- MIGRATION : 20260908000000_calendar_notes_author_only.sql
-- ============================================================================

-- calendar_notes : restreint la modification/suppression à l'auteur.
--
-- Jusqu'ici, toute personne authentifiée pouvait modifier ou supprimer la note
-- d'un autre compte (politiques "Authenticated update/delete" sur
-- auth.role()='authenticated' uniquement). On veut conserver la lecture
-- partagée (toute l'équipe voit les notes) mais limiter l'écriture/édition/
-- suppression à l'auteur.
--
-- En plus, `created_by` n'était jamais peuplé à l'insertion (l'app ne le
-- renseigne pas), ce qui rendrait une restriction `created_by = auth.uid()`
-- inopérante (toutes les lignes auraient created_by NULL). On ajoute donc un
-- trigger BEFORE INSERT qui renseigne created_by = auth.uid().

-- ─── 1. Trigger : renseigne created_by à l'insertion ──────────────────────
CREATE OR REPLACE FUNCTION public.set_calendar_note_created_by()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_by := auth.uid();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS calendar_notes_set_created_by ON public.calendar_notes;
CREATE TRIGGER calendar_notes_set_created_by
    BEFORE INSERT ON public.calendar_notes
    FOR EACH ROW
    EXECUTE FUNCTION public.set_calendar_note_created_by();

-- ─── 2. Lecture : inchangée (tout authentifié lit) ─────────────────────────
DROP POLICY IF EXISTS "Authenticated read calendar_notes" ON public.calendar_notes;
CREATE POLICY "Authenticated read calendar_notes"
    ON public.calendar_notes
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- ─── 3. Insertion : inchangée (tout authentifié crée une note) ────────────
DROP POLICY IF EXISTS "Authenticated insert calendar_notes" ON public.calendar_notes;
CREATE POLICY "Authenticated insert calendar_notes"
    ON public.calendar_notes
    FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

-- ─── 4. Modification : auteur uniquement ───────────────────────────────────
DROP POLICY IF EXISTS "Authenticated update calendar_notes" ON public.calendar_notes;
CREATE POLICY "Owner update calendar_notes"
    ON public.calendar_notes
    FOR UPDATE
    USING (auth.role() = 'authenticated' AND created_by = auth.uid())
    WITH CHECK (auth.role() = 'authenticated' AND created_by = auth.uid());

-- ─── 5. Suppression : auteur uniquement ────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated delete calendar_notes" ON public.calendar_notes;
CREATE POLICY "Owner delete calendar_notes"
    ON public.calendar_notes
    FOR DELETE
    USING (auth.role() = 'authenticated' AND created_by = auth.uid());

-- ============================================================================
-- MIGRATION : 20260914000000_staff_category.sql
-- ============================================================================

-- Migration: durable staff category (employee / technique / admin).
--
-- Until now, WHICH KIND of member a staff row was had no home in the schema: it
-- was guessed at render time from the free-text `position`, matched against the
-- curated admin/technique label lists in whichever language the form happened to
-- be filled in (src/lib/adminPositions.ts). Two defects followed from that, both
-- observable on the payroll screen:
--
--   1. A member added through "Ajouter un Membre du Centre T et P" whose typed
--      position was not one of the curated labels was NOT recognised as a
--      technical-center member, so the download button handed them the employee
--      fiche (fiche-paiement-salaire.pdf) instead of the T e P fiche.
--   2. Editing the position (the edit form always uses the free-text employee
--      mode) silently moved a member from one category to another — and with the
--      category went their document and their place in the payroll filters.
--
-- The category is therefore a column, written by the flow that created the
-- member. It is language-independent, so switching the interface language no
-- longer changes what a member is.
--
-- Backfill: existing rows get the category their stored position implies (the
-- same two bilingual lists as src/lib/adminPositions.ts, lowercased and
-- trimmed); anything else is an employee, which is what the app already showed
-- for them — so this migration changes no existing document, it only stops the
-- guess from happening again.

ALTER TABLE public.staff
    ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'employee';

ALTER TABLE public.staff
    DROP CONSTRAINT IF EXISTS staff_category_check;
ALTER TABLE public.staff
    ADD CONSTRAINT staff_category_check
    CHECK (category IN ('employee', 'technique', 'admin'));

-- Technicians first, then administration: the two lists are disjoint today, and
-- running them in this order keeps the result identical if a label ever appears
-- in both.
UPDATE public.staff
   SET category = 'technique'
 WHERE lower(btrim(position)) IN (
        'membre du centre technique', 'technicien', 'technicienne',
        'agent technique', 'formateur technique', 'instructeur technique',
        'technical center member', 'technician', 'technical agent',
        'technical trainer', 'technical instructor'
       );

UPDATE public.staff
   SET category = 'admin'
 WHERE lower(btrim(position)) IN (
        'promotrice', 'gestionnaire principal', 'proviseur', 'censeur',
        'surveillant général', 'secrétaire', 'économe', 'directeur général',
        'directeur des études', 'chef des travaux',
        'founder', 'general manager', 'principal', 'discipline master',
        'head supervisor', 'secretary', 'bursar', 'general director',
        'director of studies', 'head of works'
       );

-- A staff row whose category is unknown can no longer exist: the CHECK above
-- plus NOT NULL means the three kinds above are the only values, and the payroll
-- filter/PDF dispatch can read the column instead of matching prose.

-- ============================================================================
-- MIGRATION : 20260914000001_drop_inactivity_setting.sql
-- ============================================================================

-- ============================================================================
-- MAMA THERA Finance Suite — retrait du réglage d'inactivité
-- ============================================================================
-- Le minuteur de déconnexion automatique est resté, mais il a cessé d'être un
-- RÉGLAGE le 2026-09-14 : la fenêtre est une CONSTANTE du code
-- (`INACTIVITY_MINUTES = 45`, src/app/useInactivityLogout.ts), la même pour tout
-- le monde. « N'importe quel utilisateur » n'a pas besoin d'un réglage par
-- équipe, et un réglage qu'aucun écran ne change est une dépendance en plus :
-- une lecture en base qui peut échouer, un cache à gérer, et une valeur en base
-- qui ment sur ce qui est appliqué.
--
-- La ligne `inactivity_minutes` de `app_settings` n'est donc plus ni lue ni
-- écrite : l'application n'a plus aucun lecteur (vérifié par
-- tests/inactivity.test.tsx, qui relit tout src/ — prose blanchie — et refuse la
-- réapparition de l'identifiant, avec le cas qui prouve que le motif mord sur un
-- vrai lecteur). La garder laisserait dans la base un réglage qui se lit encore
-- « 30 » alors que le code applique 45 — exactement le genre de valeur orpheline
-- qui finit par être reprise par quelqu'un qui la croit vivante.
--
-- La TABLE `app_settings` reste : c'est un magasin de réglages d'équipe, et
-- d'autres clés y vivent. On ne retire que la clé.
--
-- `WHERE key = 'inactivity_minutes'` : idempotent (une base qui n'a jamais eu
-- la ligne n'échoue pas), et borné — aucune autre clé n'est touchée.
-- ============================================================================

DELETE FROM public.app_settings WHERE key = 'inactivity_minutes';

-- ============================================================================
-- MIGRATION : 20260914000002_nursery_classes.sql
-- ============================================================================

-- Migration: the three CR (crèche / jardin d'enfants) classes.
--
-- « Ajouter CR » enrôle un enfant dans la crèche : même formulaire que
-- « Ajouter un Élève » (même parent, mêmes frais, même reçu, même fiche), seule
-- la liste de classes diffère — Petit, Moyen, Grand.
--
-- Ces trois classes sont ÉCRITES ICI, en base, et pas seulement dans le code :
--   • `custom_classes` est lu par CHAQUE poste à la connexion, donc un poste
--     dont le build n'embarque pas encore la liste (application de bureau
--     installée, version publiée antérieure) voit les classes CR quand même —
--     c'est la différence entre « disponible » et « disponible après mise à
--     jour ».
--   • elles restent déclarées côté application (`DEFAULT_SCHOOL_CLASSES`,
--     cycle Maternelle / Jardin d'Enfants) pour que l'app les connaisse hors
--     ligne et que le cycle soit le même partout ; la fusion
--     `useClasses.availableClasses` dédoublonne par code (insensible à la
--     casse), donc la ligne de base ne crée pas de doublon visible.
--
-- Cycle `maternelle` : c'est le cycle « Maternelle / Jardin d'Enfants » que les
-- modales de classe proposent déjà (PS / MS / GS). Aucun cycle nouveau n'est
-- introduit — le formulaire CR n'affiche que ce cycle, et `students.grade`
-- garde le code de la classe ('CR-PETIT', 'CR-MOYEN', 'CR-GRAND'), comme
-- partout ailleurs.
--
-- Idempotence : l'index unique `custom_classes_code_lower_unique` rend la
-- seconde exécution sans effet (ON CONFLICT DO NOTHING). Le contrôle final
-- refuse une exécution qui n'aurait PAS laissé les trois lignes — un seed
-- silencieusement incomplet est un échec, pas un succès.

INSERT INTO public.custom_classes (code, cycle, year, section, name_fr, name_en)
VALUES
    ('CR-PETIT', 'maternelle', 'PS', 'CR', 'CR Petit (CR-PETIT)', 'CR Petit (CR-PETIT)'),
    ('CR-MOYEN', 'maternelle', 'MS', 'CR', 'CR Moyen (CR-MOYEN)', 'CR Moyen (CR-MOYEN)'),
    ('CR-GRAND', 'maternelle', 'GS', 'CR', 'CR Grand (CR-GRAND)', 'CR Grand (CR-GRAND)')
ON CONFLICT DO NOTHING;

DO $$
DECLARE
    seeded INTEGER;
BEGIN
    SELECT count(*) INTO seeded
      FROM public.custom_classes
     WHERE lower(code) IN ('cr-petit', 'cr-moyen', 'cr-grand');

    IF seeded <> 3 THEN
        RAISE EXCEPTION 'Classes CR incomplètes : % / 3 en base après le seed', seeded;
    END IF;
END
$$;

-- ============================================================================
-- MIGRATION : 20260927000000_audit_logs_offline_origin.sql
-- ============================================================================

-- Migration: Audit Trail — l'ORIGINE HORS LIGNE d'une entrée
--
-- Le défaut mesuré : un geste fait sans réseau était mis en file, puis écrit
-- dans `audit_logs` au RETOUR de la ligne. `created_at` ayant un défaut
-- `now()`, l'entrée portait l'instant de la RECONNEXION — le dimanche 22 h 50
-- devenait le lundi 8 h 05. Conséquence directe sur l'archive hebdomadaire : le
-- geste de dimanche basculait dans la semaine SUIVANTE, et son heure affichée
-- était celle du câble, pas celle du travail.
--
-- Deux colonnes, et chacune répond à une question distincte :
--
--   • `recorded_offline` — « ce geste a-t-il été SAISI sans réseau ? ». C'est le
--     drapeau que l'écran et le PDF lisent pour écrire la ligne en ROUGE, et il
--     est écrit au rejeu, jamais deviné depuis un texte libre (chercher
--     « [replay] » dans `details` rapprocherait deux entrées d'un même mot) ;
--   • `synced_at` — « quand cette entrée a-t-elle ATTEINT la base ? ». Par défaut
--     `now()`, donc identique à `created_at` pour une entrée en ligne ; au rejeu,
--     c'est l'instant du câble retrouvé, à côté de l'instant du geste. Les deux
--     dates se lisent alors côte à côte, et aucune n'a besoin d'être devinée.
--
-- `created_at` garde son nom et change de SENS pour ce seul cas : il porte
-- désormais l'instant du GESTE (fourni par le poste qui l'a fait), parce que
-- c'est lui qui décide de la semaine d'archive. Un poste hors ligne est la
-- seule source possible de cette date — le serveur ne l'a jamais vue.
--
-- Idempotente (`IF NOT EXISTS`) : une base où la migration a déjà été appliquée
-- à la main n'échoue pas.

ALTER TABLE public.audit_logs
    ADD COLUMN IF NOT EXISTS recorded_offline BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.audit_logs
    ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- L'archive hebdomadaire ne filtre pas sur ce drapeau (elle lit une fenêtre de
-- dates, déjà indexée) : l'index partiel sert au CONTRÔLE — « combien d'entrées
-- sont arrivées hors ligne cette semaine-là » — et il ne coûte rien sur une
-- table qui reste très majoritairement en ligne.
CREATE INDEX IF NOT EXISTS idx_audit_logs_recorded_offline
    ON public.audit_logs (created_at DESC)
    WHERE recorded_offline;

COMMENT ON COLUMN public.audit_logs.recorded_offline IS
    'vrai : le geste a été saisi sans réseau et écrit à la reconnexion (ligne à lire en rouge)';
COMMENT ON COLUMN public.audit_logs.synced_at IS
    'instant où la ligne a atteint la base : identique à created_at en ligne, postérieur pour une saisie hors ligne';
COMMENT ON COLUMN public.audit_logs.created_at IS
    'instant du GESTE (fourni par le poste hors ligne), pas celui de l''écriture';

-- ============================================================================
-- MIGRATION : 20261005000000_econome_payroll_writes.sql
-- ============================================================================

-- Migration: l'économe (Accountant) peut ENREGISTRER les paiements de salaire.
--
-- ─── Le défaut, mesuré le 2026-10-05 ────────────────────────────────────────
-- Un poste connecté avec le compte `econome` (aggeediarra@mamathera.org) a
-- enregistré la paie hors ligne. À la reconnexion, chaque rejeu a été refusé :
--
--   new row violates row-level security policy for table "salary_payments" [42501]
--
-- … par la policy « Finance admins insert salary_payments », dont
-- `public.is_finance_admin()` vaut `admin`, `dev`, `general_manager`
-- (20260902000000_general_manager_role.sql). L'`econome` en était exclu — la
-- décision de 20260902000001_econome_role.sql le disait d'ailleurs : « econome
-- stays outside is_finance_admin, like staff ».
--
-- Or l'écran Payroll (src/components/PayrollView.tsx) et son bouton
-- « Enregistrer Salaire » n'avaient AUCUNE garde de rôle : l'application offrait
-- une écriture que la base refusait. Les saisies restaient donc dans la file,
-- recomptées « refusées » à chaque passage — jamais envoyées, jamais expliquées.
--
-- ─── La décision (propriétaire, 2026-10-05) ─────────────────────────────────
-- L'économe ENREGISTRE la paie — c'est son métier (écritures financières
-- quotidiennes, reçus & caisse) — mais ne GÈRE PAS le personnel. On élargit donc
-- les seules policies d'ÉCRITURE de `salary_payments` à un rôle de plus, via une
-- fonction NOMMÉE : la règle que lit l'app (`src/lib/payrollRights.ts`) et celle
-- que lit la base restent comparables, et `tests/payroll-rights.test.ts` compare
-- les deux listes DANS LES DEUX SENS — un rôle ajouté d'un seul côté rouvrirait
-- un bouton qui ne peut pas aboutir, exactement le défaut réparé ici.
--
-- `staff` reste réservé à `is_finance_admin()` : recruter un membre n'est pas
-- une écriture de caisse. La SUPPRESSION d'un paiement de salaire reste, elle
-- aussi, un acte de gestionnaire financier (`is_finance_admin`) — enregistrer et
-- détruire ne sont pas le même droit.

-- ─── Helper: qui peut ÉCRIRE un paiement de salaire ─────────────────────────
CREATE OR REPLACE FUNCTION public.is_payroll_writer()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'dev', 'general_manager', 'econome')
  );
$$;

-- ─── salary_payments : insertion et correction ouvertes à l'économe ─────────
-- DEUX noms hérités se sont succédé sur cette même table (« Admin can insert
-- salary_payments », puis « Finance admins insert salary_payments ») : les deux
-- sont retirés. Les policies permissives se cumulent par OR, donc en laisser une
-- n'aurait pas changé le RÉSULTAT — mais elle laisserait croire que
-- `is_admin()` (admin, dev) est encore la règle de la paie. Elle ne l'est plus.
-- Rejouable (une migration a été appliquée deux fois, mesuré : le second
-- passage échouait sur « policy already exists » et annulait tout le bloc) :
-- on retire AUSSI les noms que cette migration crée, avant de les recréer.
DROP POLICY IF EXISTS "Admin can insert salary_payments" ON public.salary_payments;
DROP POLICY IF EXISTS "Finance admins insert salary_payments" ON public.salary_payments;
DROP POLICY IF EXISTS "Payroll writers insert salary_payments" ON public.salary_payments;
CREATE POLICY "Payroll writers insert salary_payments" ON public.salary_payments
    FOR INSERT WITH CHECK (public.is_payroll_writer());

DROP POLICY IF EXISTS "Finance admins update salary_payments" ON public.salary_payments;
DROP POLICY IF EXISTS "Payroll writers update salary_payments" ON public.salary_payments;
CREATE POLICY "Payroll writers update salary_payments" ON public.salary_payments
    FOR UPDATE USING (public.is_payroll_writer());

-- ─── PostgREST schema cache reload ──────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- MIGRATION : 20261005000001_dedupe_students.sql
-- ============================================================================

-- Migration: nettoyage des doublons de `students` (mesurés le 2026-10-05).
--
-- ─── Ce que la base porte encore ────────────────────────────────────────────
-- Le correctif du 2026-10-05 (commit 49ec45b) a fermé la CAUSE — l'id du geste
-- rend la création en ligne idempotente, et le drainage n'a plus d'exclusion
-- mutuelle manquante. Il n'a PAS retiré les lignes déjà écrites : la décision
-- d'alors (development history) était de laisser les 14 lignes en trop en base,
-- « leur retrait est une décision de l'école, pas de l'outil ».
--
-- Re-mesuré le 2026-10-05 après coupure (lecture seule, service role) :
--   • 414 lignes dans `students` ;
--   • 9 groupes en doublon — MÊME nom, MÊME téléphone parent, MÊME classe,
--     MÊME année — soit 14 lignes en trop :
--       Mahamadou DJIRE (7A, 77705323)        ×7
--       Fousseyni BALLO (3B, 83435352)        ×2
--       Gnide Youma BARRO (3B, 76160219)      ×2
--       Fatou BOLLY (3B, 75016354)            ×2
--       Cheickné COULIBALY (2B, 92689026)     ×2
--       Thierno Hady TRAORE (2B, 78212140)    ×2
--       Bourama DIARRA (8A, 75722758)         ×2
--       Mamadou SIDIBE (6A, 79068145)         ×2
--       Fatoumata A COULIBALY (8A, 76640124)  ×2
--   • AUCUNE de ces lignes ne porte de paiement ni de tâche (vérifié : les 2
--     seuls paiements de la base pointent sur d'autres élèves, 0 tâche liée).
--     Le `ON DELETE CASCADE` de `payments` / `todos` ne détruit donc rien ici.
--
-- ⚠️ Piège, déjà signalé : d'autres noms se RÉPÈTENT sans être des doublons
-- (« Awa DIARRA » ×3, « Bourama COULIBALY » ×2, « Adam TRAORE »… : téléphones,
-- classes ou montants DIFFÉRENTS — des personnes distinctes). La clé de
-- regroupement inclut donc le téléphone, la classe ET l'année : deux homonymes
-- d'une même famille ne sont jamais fusionnés s'ils ne partagent pas les trois.
--
-- ─── Ce que fait cette migration ────────────────────────────────────────────
--   1. copie les lignes condamnées dans `students_dupe_backup_20261005`
--      → le nettoyage est RÉVERSIBLE (ligne à ligne, champ à champ) ;
--   2. RE-POINTE d'abord tout paiement / tâche des jumelles vers la survivante
--      (défensif : aucune n'en a aujourd'hui, mais une future paire le pourrait) ;
--   3. supprime les jumelles, en GARDANT la plus ancienne (`created_at`, puis
--      `id` : ordre déterministe) — la première trace d'un geste unique.
--
-- Rejouable : une base déjà nettoyée n'a plus aucun `rn > 1`, donc n'insère ni
-- ne supprime rien. Aucune donnée n'est perdue au passage (tout est sauvegardé).
--
-- Contrôle APRÈS application (doit renvoyer 0 ligne) :
--   SELECT lower(btrim(name)), btrim(coalesce(parent_phone,'')),
--          lower(btrim(coalesce(grade,''))), coalesce(academic_year,'')
--   FROM public.students
--   GROUP BY 1,2,3,4 HAVING count(*) > 1;

-- ─── 1) Table de sauvegarde (réversibilité) ─────────────────────────────────
-- `CREATE TABLE ... AS SELECT ... WHERE false` fabrique la STRUCTURE (mêmes
-- colonnes/types) sans copier de ligne ; le contenu arrive à l'étape 2.
CREATE TABLE IF NOT EXISTS public.students_dupe_backup_20261005 AS
SELECT * FROM public.students WHERE false;

-- ─── 2)+3) Sauvegarde des jumelles, re-pointage, suppression ────────────────
-- `rn` numérote les lignes d'un même groupe ; `survivor_id` est la première.
WITH ranked AS (
    SELECT
        id,
        row_number() OVER (
            PARTITION BY lower(btrim(name)),
                         btrim(coalesce(parent_phone, '')),
                         lower(btrim(coalesce(grade, ''))),
                         coalesce(academic_year, '')
            ORDER BY created_at ASC, id ASC
        ) AS rn,
        first_value(id) OVER (
            PARTITION BY lower(btrim(name)),
                         btrim(coalesce(parent_phone, '')),
                         lower(btrim(coalesce(grade, ''))),
                         coalesce(academic_year, '')
            ORDER BY created_at ASC, id ASC
        ) AS survivor_id
    FROM public.students
),
doomed AS (
    SELECT id, survivor_id FROM ranked WHERE rn > 1
)
-- 2a) on archive AVANT d'effacer (no-op si déjà fait : plus de `doomed`).
INSERT INTO public.students_dupe_backup_20261005
SELECT s.* FROM public.students s
JOIN doomed d ON d.id = s.id;

-- 2b) on ramène paiements et tâches vers la survivante (défensif).
WITH ranked AS (
    SELECT
        id,
        row_number() OVER (
            PARTITION BY lower(btrim(name)),
                         btrim(coalesce(parent_phone, '')),
                         lower(btrim(coalesce(grade, ''))),
                         coalesce(academic_year, '')
            ORDER BY created_at ASC, id ASC
        ) AS rn,
        first_value(id) OVER (
            PARTITION BY lower(btrim(name)),
                         btrim(coalesce(parent_phone, '')),
                         lower(btrim(coalesce(grade, ''))),
                         coalesce(academic_year, '')
            ORDER BY created_at ASC, id ASC
        ) AS survivor_id
    FROM public.students
),
doomed AS (
    SELECT id, survivor_id FROM ranked WHERE rn > 1
)
UPDATE public.payments p
SET student_id = d.survivor_id
FROM doomed d
WHERE p.student_id = d.id;

WITH ranked AS (
    SELECT
        id,
        row_number() OVER (
            PARTITION BY lower(btrim(name)),
                         btrim(coalesce(parent_phone, '')),
                         lower(btrim(coalesce(grade, ''))),
                         coalesce(academic_year, '')
            ORDER BY created_at ASC, id ASC
        ) AS rn,
        first_value(id) OVER (
            PARTITION BY lower(btrim(name)),
                         btrim(coalesce(parent_phone, '')),
                         lower(btrim(coalesce(grade, ''))),
                         coalesce(academic_year, '')
            ORDER BY created_at ASC, id ASC
        ) AS survivor_id
    FROM public.students
),
doomed AS (
    SELECT id, survivor_id FROM ranked WHERE rn > 1
)
UPDATE public.todos t
SET student_id = d.survivor_id
FROM doomed d
WHERE t.student_id = d.id;

-- 3) on retire les jumelles.
WITH ranked AS (
    SELECT
        id,
        row_number() OVER (
            PARTITION BY lower(btrim(name)),
                         btrim(coalesce(parent_phone, '')),
                         lower(btrim(coalesce(grade, ''))),
                         coalesce(academic_year, '')
            ORDER BY created_at ASC, id ASC
        ) AS rn
    FROM public.students
)
DELETE FROM public.students s
USING ranked r
WHERE s.id = r.id AND r.rn > 1;

-- La sauvegarde se supprime UNE FOIS le nettoyage confirmé sur l'application :
--   DROP TABLE public.students_dupe_backup_20261005;

-- ============================================================================
-- MIGRATION : 20261005000002_students_business_key_unique.sql
-- ============================================================================

-- Migration: l'unicité métier des élèves, tenue par la BASE (pas seulement par l'app).
--
-- ─── Pourquoi cette migration, après le nettoyage ───────────────────────────
-- La migration `20261005000001_dedupe_students` a retiré les 14 lignes en trop
-- (414 → 400). Le correctif applicatif (commit `49ec45b` puis `f5ed1dc`) a
-- fermé la CAUSE côté client : chaque création porte l'id du geste, et un
-- `23505` se lit « geste déjà enregistré ». Mais les deux protections vivent
-- dans l'APPLICATION : un INSERT écrit à la main (SQL direct, un autre client,
-- un script, un futur bug) créait encore un doublon sans que rien ne s'y
-- oppose. Cette migration porte la règle DANS LA BASE — le dernier endroit où
-- un doublon peut encore naître.
--
-- ─── La clé métier, exactement celle du nettoyage ───────────────────────────
--   lower(btrim(name))                     — le nom, insensible casse/espaces
--   btrim(coalesce(parent_phone, ''))      — le téléphone du parent
--   lower(btrim(coalesce(grade, '')))      — la classe
--   coalesce(academic_year, '')            — l'année scolaire
-- C'est la clé éprouvée le 2026-10-05 : elle désignait EXACTEMENT les 9 groupes
-- de la même personne (14 lignes en trop) et laissait intactes les familles
-- d'homonymes légitimes (« Awa DIARRA » ×3, « Bourama COULIBALY », « Adam
-- TRAORE »… : téléphones, classes ou montants différents = personnes
-- distinctes). Rien n'est inventé ici : on grave la clé déjà mesurée.
--
-- ─── Pourquoi PARTIEL ──────────────────────────────────────────────────────
-- `WHERE btrim(name) <> ''` : la contrainte ne s'applique qu'aux lignes qui
-- portent un NOM — la seule chose qui fait d'une ligne une personne. Une ligne
-- sans nom (import à moitié rempli, brouillon) n'est pas une identité : la
-- forcer à l'unicité bloquerait deux brouillons anonymes légitimes. `name` est
-- déjà `NOT NULL` en base ; ce prédicat borne la règle au sens métier.
--
-- ─── Ce que ça change pour l'application ───────────────────────────────────
-- Un doublon créé par un geste DIFFÉRENT (deux fiches vraiment saisies deux
-- fois) échoue désormais à l'INSERT avec `23505` au lieu de s'écrire en
-- silence : c'est le comportement voulu — l'app affiche l'erreur et n'ajoute
-- pas la ligne. Le même geste rejoué (double clic, reprise après coupure) reste
-- déjà couvert par l'id du geste.
--
-- Idempotent (`IF NOT EXISTS`) et réversible :
--   DROP INDEX IF EXISTS public.students_business_key_unique;
--
-- Contrôle APRÈS application (doit renvoyer 0 ligne) :
--   SELECT lower(btrim(name)), btrim(coalesce(parent_phone,'')),
--          lower(btrim(coalesce(grade,''))), coalesce(academic_year,'')
--   FROM public.students
--   GROUP BY 1,2,3,4 HAVING count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS students_business_key_unique
    ON public.students (
        lower(btrim(name)),
        btrim(coalesce(parent_phone, '')),
        lower(btrim(coalesce(grade, ''))),
        coalesce(academic_year, '')
    )
    WHERE btrim(name) <> '';

-- ============================================================================
-- MIGRATION : 20261005000003_econome_delete_payments.sql
-- ============================================================================

-- Migration: l'économe peut SUPPRIMER un paiement d'élève saisi par erreur.
--
-- ─── Le défaut, mesuré le 2026-10-05 ────────────────────────────────────────
-- Le bouton « supprimer un paiement » (src/components/StudentDetailsModal.tsx)
-- n'apparaît que là où la base l'autorise. Or la SUPPRESSION d'un paiement était
-- réservée à `public.is_admin()` — `admin`, `dev` (20260809000000_auth_and_rls.sql,
-- policies « Admin delete payments » et l'héritée « Admin can delete payments »).
-- L'`econome`, qui tient la caisse et saisit les reçus, ne pouvait donc PAS
-- corriger sa propre erreur : le bouton lui était caché, et s'il l'avait forcé,
-- PostgREST aurait rendu une suppression à zéro ligne.
--
-- ─── La décision (propriétaire, 2026-10-05) ─────────────────────────────────
-- L'économe SUPPRIME un paiement — c'est son métier (corriger une caisse qui se
-- trompe), mais ne supprime RIEN d'autre : `students`, `parents`, `staff`,
-- `expenses`, `salary_payments`… restent à `is_admin()` ou `is_finance_admin()`.
-- « Enregistrer et détruire ne sont pas le même droit » (voir
-- 20261005000000_econome_payroll_writes.sql, qui a ouvert à l'économe l'ÉCRITURE
-- de la paie sans lui ouvrir sa suppression). On ouvre donc la SEULE policy de
-- suppression de `payments` à un rôle de plus, via une fonction NOMMÉE : la
-- règle que lit l'app (`src/lib/paymentRights.ts`) et celle que lit la base
-- restent comparables, et `tests/payment-rights.test.ts` compare les deux listes
-- DANS LES DEUX SENS — un rôle ajouté d'un seul côté rouvrirait un bouton qui ne
-- peut pas aboutir, exactement le défaut réparé ici.

-- ─── Helper: qui peut SUPPRIMER un paiement d'élève ─────────────────────────
CREATE OR REPLACE FUNCTION public.is_payment_deleter()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('admin', 'dev', 'econome')
  );
$$;

-- ─── payments : la suppression s'ouvre à l'économe ──────────────────────────
-- DEUX noms hérités se sont succédé sur cette table (« Admin delete payments »,
-- puis « Admin can delete payments ») : les deux sont retirés. Les policies
-- permissives se cumulent par OR, donc en laisser une n'aurait pas changé le
-- RÉSULTAT — mais elle laisserait croire que `is_admin()` (admin, dev) est encore
-- la règle de la suppression des paiements. Elle ne l'est plus : l'économe la
-- partage. On retire AUSSI le nom que cette migration crée, pour être rejouable.
DROP POLICY IF EXISTS "Admin delete payments" ON public.payments;
DROP POLICY IF EXISTS "Admin can delete payments" ON public.payments;
DROP POLICY IF EXISTS "Payment deleters delete payments" ON public.payments;
CREATE POLICY "Payment deleters delete payments" ON public.payments
    FOR DELETE USING (public.is_payment_deleter());

-- ─── PostgREST schema cache reload ──────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- MIGRATION : 20261005000004_audit_logs_metadata.sql
-- ============================================================================

-- Migration: une colonne `metadata` au journal d'audit — de quoi ANNULER une suppression.
--
-- ─── Le défaut, mesuré le 2026-10-05 ────────────────────────────────────────
-- Le bouton « supprimer un paiement » (20261005000003_econome_delete_payments.sql)
-- retire la ligne de `payments` et n'écrit au journal qu'une PHRASE : « Paiement
-- de 4000 FCFA (reçu REC-549205) du 2026-10-05 supprimé — élève Djenebou DIALLO ».
-- C'est assez pour RELIRE le geste, pas pour le DÉFAIRE : le montant et le reçu
-- sont dans du texte libre, l'`id` d'origine, l'année académique et le `student_id`
-- n'y sont pas. Une suppression était donc définitive.
--
-- ─── La décision ────────────────────────────────────────────────────────────
-- Un reçu retiré par erreur doit pouvoir REVENIR. On ne réécrit pas les vieilles
-- entrées (un journal d'audit qui se réécrit n'est plus une trace) : on ajoute une
-- colonne `metadata` JSONB, et les NOUVELLES suppressions y déposent l'instantané
-- de la ligne retirée — exactement de quoi la réinsérer à l'identique.
--
-- Pourquoi ici et pas dans une table d'archive à part : le journal est DÉJÀ
-- append-only (policy d'INSERT ouverte, aucune de mise à jour ni de suppression),
-- et il est DÉJÀ lu par l'écran d'audit. Garder l'instantané avec l'entrée qui
-- raconte le geste fait tenir la cause et la réparation dans la même ligne ; une
-- table d'archive aurait dupliqué qui/quoi/quand, avec deux vérités à tenir.
--
-- La restauration elle-même écrit une NOUVELLE entrée (`RESTORE_PAYMENT`) : le
-- geste inverse laisse sa trace à côté de la suppression, il ne l'efface pas.

ALTER TABLE public.audit_logs
    ADD COLUMN IF NOT EXISTS metadata JSONB;

COMMENT ON COLUMN public.audit_logs.metadata IS
    'instantané structuré du geste quand une phrase ne suffit pas à le défaire (ex : ligne `payments` retirée, pour la restaurer)';

-- ─── PostgREST schema cache reload ──────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
