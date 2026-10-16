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
-- Ce script est la concaténation des 45 migrations suivantes, dans
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
--   20261006000000_students_matricule_all.sql
--   20261011000000_payments_months.sql
--   20261011000001_drop_students_dupe_backup.sql
--   20261013000000_econome_payment_months.sql
--   20261013000001_payments_write_lock.sql
--   20261014000000_finance_writer_staff_vendor.sql
--   20261015000000_inherited_policy_closure.sql
--   20261016000000_payments_motif.sql
--   20261017000000_rls_declared_alignment.sql
--   20261018000000_station_versions.sql
--   20261019000000_display_preferences.sql
--   20261020000000_econome_payment_history.sql
--   20261021000000_station_install_mode.sql
--   20261022000000_school_name.sql
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

-- Migration: la SUPPRESSION d'une dépense fournisseur passe aux finance admins
--            (admin, dev, Gestionnaire Principal) — pas aux seuls admin/dev.
--
-- ─── Ce que ce fichier devait faire, et ce qu'il en reste ───────────────────
-- Écrit le 2026-09-06 pour le Gestionnaire Principal, il n'a JAMAIS été appliqué
-- à la base de l'école. Entre-temps, sa moitié INSERTION a été livrée autrement
-- et sa moitié SUPPRESSION est restée fermée : les deux moitiés ne se rejouent
-- donc pas de la même façon, et ce fichier dit maintenant laquelle il porte.
--
--   • INSERTION (`vendor_expenses`) — SUPPLANTÉE, retirée de ce fichier.
--     L'insertion que cette migration ouvrait à `is_finance_admin()` a été livrée
--     le 2026-10-13 par `20261014000000_finance_writer_staff_vendor.sql`, sous une
--     règle PLUS LARGE — `public.is_finance_writer()`, qui ajoute l'économe
--     (« il a accès à tout sauf les paramètres du système », propriétaire,
--     2026-10-13). La recréer ici rouvrirait un SECOND nom pour la même écriture,
--     c'est-à-dire exactement ce que `20261014000000` a retiré.
--     MESURÉ le 2026-10-13 : le fichier tel qu'il était écrit ne s'appliquait
--     même plus — `npm run db:apply` répondait « déjà ABSENT avant :
--     policy:Promoter insert vendor_expenses », parce que sa moitié INSERT avait
--     déjà été retirée par `20261014000000`. C'est la preuve que cette moitié est
--     de l'HISTOIRE, pas un geste à rejouer.
--
--   • SUPPRESSION (`vendor_expenses`) — c'est ce que ce fichier applique.
--     La base de l'école porte DEUX noms hérités, tous deux `is_admin()` :
--       « Admin can delete vendor_expenses »  — qu'AUCUNE migration ne déclare
--                                              ni ne retire (génération d'avant
--                                              les migrations) ;
--       « Promoter delete vendor_expenses »   — déclaré par 20260828000000,
--                                              supplanté ici.
--     Mesuré le 2026-10-13 par `npm run check:rls-policies` : « Finance admins
--     delete vendor_expenses » ABSENTE en base, ces deux noms EN TROP. Le
--     Gestionnaire Principal voyait donc le bouton « Supprimer » sur sa page
--     Dépenses — l'écran le lui montrait depuis 20260902000000 — et la base
--     refusait chacune de ses suppressions : le même défaut app↔base que
--     l'insertion, dans la même table, cinq semaines plus tard.
--
-- ─── La décision ────────────────────────────────────────────────────────────
-- La suppression d'une dépense fournisseur appartient à `public.is_finance_admin()`
-- (`20260902000000_general_manager_role.sql`) : admin, dev, Gestionnaire Principal.
-- L'économe n'y est PAS : il SAISIT les dépenses fournisseur
-- (`is_finance_writer()`), il ne les détruit pas — écrire et détruire ne sont pas
-- le même droit (même partage que la paie, 20261005000000 / 20261005000003).
-- L'écran lit la même règle (`canDeleteVendorExpenses`, `src/lib/payrollRights.ts`) :
-- un rôle ajouté d'un seul côté fait rougir `tests/finance-rights.test.ts` au lieu
-- d'ouvrir une corbeille que la base refuse (42501) ou d'en cacher une qu'elle
-- accepte.
--
-- Ce qui NE bouge pas : le monopole promoteur sur les enregistrements EXISTANTS
-- (trigger `protect_vendor_expense_financial_fields` : `vendor_name` et `amount`
-- restent à admin/dev hors création, 20260828000000), la lecture de la table
-- (tout compte connecté), et la suppression d'une dépense GÉNÉRALE (`expenses`),
-- qui reste `is_admin()` — le Gestionnaire Principal n'y reçoit toujours pas de
-- corbeille (`canDelete`, `src/lib/deleteRights.ts`).
--
-- Rejouable : le nom que cette migration crée est retiré AVANT d'être recréé.

-- ─── vendor_expenses : la suppression passe aux finance admins ───────────────
-- Les deux noms hérités partent. Les policies permissives se cumulent par OR,
-- donc en laisser un n'aurait pas changé le RÉSULTAT — mais il laisserait croire
-- que `is_admin()` (admin, dev) est encore la règle de la suppression d'une
-- dépense fournisseur. Elle ne l'est plus : le Gestionnaire Principal la partage.
DROP POLICY IF EXISTS "Admin can delete vendor_expenses" ON public.vendor_expenses;
DROP POLICY IF EXISTS "Promoter delete vendor_expenses" ON public.vendor_expenses;
DROP POLICY IF EXISTS "Finance admins delete vendor_expenses" ON public.vendor_expenses;
CREATE POLICY "Finance admins delete vendor_expenses" ON public.vendor_expenses
    FOR DELETE TO authenticated
    USING (public.is_finance_admin());

-- ─── PostgREST schema cache reload ──────────────────────────────────────────
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

-- ============================================================================
-- MIGRATION : 20261006000000_students_matricule_all.sql
-- ============================================================================

-- Migration: un matricule pour TOUS les élèves — les 423 déjà enregistrés comme
-- tous ceux qui seront ajoutés ensuite.
--
-- ─── La demande, et la politique qu'elle remplace ────────────────────────────
-- `students.student_id` (l'étiquette « MATRICULE » de l'application) existe
-- depuis l'init mais n'était renseigné que pour les classes de 9e, où l'école
-- SAISIT un numéro d'examen à la main (migration 20260902000006 : « matricules
-- are only used by ninth-year students »). Demande du propriétaire : « un numéro
-- de matricule pour tous les élèves ajoutés, et pour tous ceux qui seront ajoutés
-- dans le futur ». La COLONNE ne change donc pas — elle devient attribuée par la
-- base, et l'application cesse de la conditionner à la classe.
--
-- ─── Ce que fait cette migration ─────────────────────────────────────────────
--   1. un COMPTEUR PAR ANNÉE (`student_matricule_counters`) — la seule forme qui
--      attribue un numéro séquentiel sans course entre deux insertions ;
--   2. le RATTRAPAGE des fiches dont le matricule est vide, numérotées
--      `MT-<année d'entrée>-<n°>` dans l'ordre de leur création ;
--   3. un DÉCLENCHEUR d'attribution : toute fiche écrite sans matricule en reçoit
--      un, sans que l'application ait à le demander ni à l'inventer.
--
-- ─── Ce qui est PRÉSERVÉ, et pourquoi l'ordre compte ─────────────────────────
-- Un matricule déjà porté n'est JAMAIS réécrit : les numéros d'examen saisis à la
-- main restent tels quels (l'école s'en sert sur des documents), et le compteur
-- d'une année repart APRÈS le plus grand numéro déjà utilisé — sinon le premier
-- rattrapage entrerait en collision avec l'index UNIQUE de `student_id` et ferait
-- échouer la migration. C'est aussi pourquoi le compteur est ouvert (étape 2a)
-- AVANT de numéroter (2b).
--
-- ─── L'ANNÉE DU MATRICULE ────────────────────────────────────────────────────
-- `coalesce(enrollment_date, created_at::date)` : l'année d'ENTRÉE quand la fiche
-- la connaît, sinon l'année où la ligne est apparue en base. C'est la seule
-- information disponible pour les fiches existantes — elle est donc DITE ici
-- plutôt que devinée ailleurs, et un matricule déjà porté ne bouge pas.
--
-- ─── Ce que ça change pour l'application ────────────────────────────────────
-- Un INSERT sans `student_id` n'écrit plus NULL : la base attribue la valeur et
-- PostgREST renvoie la ligne complète (matricule compris). L'application n'invente
-- donc plus aucun numéro côté client, l'import Excel respecte un matricule fourni,
-- et une mise à jour ne peut plus effacer un matricule existant
-- (voir src/lib/offlineReplay.ts et src/lib/studentIdentifiers.ts).
--
-- Idempotent : le rattrapage ne touche que les matricules vides, le compteur ne
-- recule jamais (`GREATEST`), le déclencheur est recréé sans erreur.
--
-- Contrôle APRÈS application — doit renvoyer 0 :
--   SELECT count(*) FROM public.students
--   WHERE student_id IS NULL OR btrim(student_id) = '';

-- ─── 1) Le compteur par année ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.student_matricule_counters (
    yr TEXT PRIMARY KEY,
    last_seq INTEGER NOT NULL DEFAULT 0
);

-- Non exposée à PostgREST : RLS active SANS policy (le déclencheur y écrit en
-- SECURITY DEFINER, donc sous les droits du propriétaire, jamais ceux du client).
ALTER TABLE public.student_matricule_counters ENABLE ROW LEVEL SECURITY;

-- ─── 2a) Ouvrir chaque compteur AU-DESSUS de ce qui est déjà porté ──────────
INSERT INTO public.student_matricule_counters (yr, last_seq)
SELECT split_part(student_id, '-', 2) AS yr,
       max((regexp_replace(student_id, '^MT-[0-9]{4}-', ''))::int) AS last_seq
FROM public.students
WHERE student_id ~ '^MT-[0-9]{4}-[0-9]+$'
GROUP BY 1
ON CONFLICT (yr) DO UPDATE
    SET last_seq = GREATEST(public.student_matricule_counters.last_seq, EXCLUDED.last_seq);

-- ─── 2b) Numéroter les fiches qui n'en ont pas ──────────────────────────────
-- `row_number()` par année, dans l'ordre de création (created_at puis id :
-- déterministe, donc rejouable à l'identique sur une copie de la base).
WITH blank AS (
    SELECT id,
           to_char(coalesce(enrollment_date, created_at::date), 'YYYY') AS yr,
           row_number() OVER (
               PARTITION BY to_char(coalesce(enrollment_date, created_at::date), 'YYYY')
               ORDER BY created_at ASC, id ASC
           ) AS rn
    FROM public.students
    WHERE student_id IS NULL OR btrim(student_id) = ''
),
seeded AS (
    SELECT b.id, b.yr, b.rn + coalesce(c.last_seq, 0) AS n
    FROM blank b
    LEFT JOIN public.student_matricule_counters c ON c.yr = b.yr
)
UPDATE public.students s
SET student_id = 'MT-' || seeded.yr || '-' || lpad(seeded.n::text, 3, '0')
FROM seeded
WHERE s.id = seeded.id;

-- ─── 2c) Avancer les compteurs de ce qui vient d'être attribué ──────────────
-- Même calcul que 2a, un cran plus loin : c'est lui qui met le compteur à jour
-- pour ce que le rattrapage vient d'écrire.
INSERT INTO public.student_matricule_counters (yr, last_seq)
SELECT split_part(student_id, '-', 2) AS yr,
       max((regexp_replace(student_id, '^MT-[0-9]{4}-', ''))::int) AS last_seq
FROM public.students
WHERE student_id ~ '^MT-[0-9]{4}-[0-9]+$'
GROUP BY 1
ON CONFLICT (yr) DO UPDATE
    SET last_seq = GREATEST(public.student_matricule_counters.last_seq, EXCLUDED.last_seq);

-- ─── 3) L'attribution pour ce qui s'écrira ensuite ──────────────────────────
CREATE OR REPLACE FUNCTION public.assign_student_matricule()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
-- `search_path` figé : une fonction SECURITY DEFINER qui le laisse libre est un
-- détournement connu (une table homonyme posée par un client s'y ferait lire).
SET search_path = public, pg_temp
AS $$
DECLARE
    v_yr  TEXT;
    v_seq INTEGER;
BEGIN
    -- Un matricule DÉJÀ fourni (le numéro d'examen d'un 9e, ou celui d'un import)
    -- est respecté : la base ne numérote que ce qui est vide.
    IF NEW.student_id IS NOT NULL AND btrim(NEW.student_id) <> '' THEN
        RETURN NEW;
    END IF;

    v_yr := to_char(coalesce(NEW.enrollment_date, current_date), 'YYYY');

    -- `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` est ATOMIQUE : deux
    -- insertions simultanées ne peuvent pas recevoir le même numéro, là où un
    -- `max() + 1` lu puis écrit le pourrait — et l'index UNIQUE transformerait
    -- cette course en « ajout impossible » côté école.
    INSERT INTO public.student_matricule_counters (yr, last_seq)
    VALUES (v_yr, 1)
    ON CONFLICT (yr) DO UPDATE
        SET last_seq = public.student_matricule_counters.last_seq + 1
    RETURNING last_seq INTO v_seq;

    NEW.student_id := 'MT-' || v_yr || '-' || lpad(v_seq::text, 3, '0');
    RETURN NEW;
END;
$$;

-- INSERT **ou** UPDATE : l'invariant (« tout élève porte un matricule ») vaut
-- pour TOUT écrivain — l'application, un script, une main dans le SQL. Une mise
-- à jour ordinaire ne le déclenche pas (la valeur est déjà non vide) ; seule une
-- remise à vide en reçoit un nouveau, ce qui est préférable à un élève sans
-- matricule.
DROP TRIGGER IF EXISTS students_assign_matricule ON public.students;
CREATE TRIGGER students_assign_matricule
    BEFORE INSERT OR UPDATE ON public.students
    FOR EACH ROW
    EXECUTE FUNCTION public.assign_student_matricule();

-- ============================================================================
-- MIGRATION : 20261011000000_payments_months.sql
-- ============================================================================

-- Migration: quels MOIS un paiement couvre.
--
-- Un paiement porte une `date` — le jour où l'argent est entré. Elle ne dit pas
-- quels mois de scolarité cet argent règle. Au guichet, une famille qui solde
-- septembre, octobre et décembre le même matin reçoit UN reçu : la seule date y
-- fait lire « Décembre », et les deux autres mois disparaissent du papier que la
-- famille garde — puis de toute réimpression tirée de l'historique.
--
-- Le choix des mois est donc une COLONNE, écrite par le geste qui l'a saisi et
-- relue à chaque réimpression.
--
-- Forme stockée : `YYYY-MM` (`2026-09`, `2027-01`), jamais un libellé. Un
-- « Septembre » gravé ici serait faux dans un reçu anglais, et un « sep » ne
-- dirait pas de quelle année. L'ordre est celui du calendrier, mais aucune
-- contrainte ne l'impose : l'affichage trie (src/lib/paymentMonths.ts), donc une
-- ligne écrite dans le désordre ne casse rien.
--
-- Le CHECK tient la forme sans fonction ni sous-requête : la représentation
-- texte d'un tableau est `{}`, `{2026-09}` ou `{2026-09,2026-10}`, et
-- l'expression ci-dessous n'accepte QUE ces trois formes-là. Une chaîne qui
-- n'est pas un mois est refusée par la base, pas seulement par l'écran.
--
-- Aucune politique RLS à ajouter : celles de `payments` sont au niveau TABLE
-- (« Authenticated read payments », « Authenticated insert payments », …), et
-- une colonne de plus ne change ni qui lit, ni qui écrit.
--
-- Les lignes existantes prennent `{}` — « mois non renseigné » — et le reçu
-- retombe alors sur le mois de sa date, exactement comme avant. Un reçu déjà
-- imprimé ne change donc pas de contenu.

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS months TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.payments
    DROP CONSTRAINT IF EXISTS payments_months_shape_check;

ALTER TABLE public.payments
    ADD CONSTRAINT payments_months_shape_check
    CHECK (months::text ~ '^\{(\d{4}-(0[1-9]|1[0-2]))?(,\d{4}-(0[1-9]|1[0-2]))*\}$');

-- ============================================================================
-- MIGRATION : 20261011000001_drop_students_dupe_backup.sql
-- ============================================================================

-- 20261011000001_drop_students_dupe_backup.sql
--
-- POURQUOI CE FICHIER EXISTE
-- ==========================
-- La migration `20261005000001_dedupe_students.sql` a créé
-- `public.students_dupe_backup_20261005` par un `CREATE TABLE … AS` pour rendre le
-- dédoublonnage réversible, et laissait sa suppression EN COMMENTAIRE : « une fois
-- le nettoyage confirmé ». Ce nettoyage n'a jamais été confirmé, et la table est
-- restée six jours en production.
--
-- Or un `CREATE TABLE … AS` n'active PAS la sécurité par ligne, et les privilèges
-- par défaut de Supabase ouvrent `SELECT` au rôle `anon`. Mesuré depuis
-- l'extérieur, avec la clé publique livrée dans le bundle (`App-*.js`, présent
-- dans `dist/` comme dans `electron-ui-dist/`, donc sur chaque poste) :
-- HTTP 200, 14 lignes, dont nom d'élève, téléphone d'un parent et notes médicales.
-- Le même relevé sur les autres tables (`students`, `payments`, `parents`,
-- `audit_logs`…) rend 0 ligne : la RLS tient partout ailleurs. Le trou était
-- exactement cet artefact.
--
-- CE QUE CE FICHIER FAIT, ET CE QU'IL NE FAIT PAS
-- ===============================================
-- Il RETIRE la table, et rien d'autre : rien n'y est recopié, rien n'est recréé,
-- aucune donnée n'est déplacée d'une table à l'autre. Les 14 lignes sont
-- archivées HORS du dépôt, avec l'empreinte SHA-256 de leur contenu
-- (`archives/2026-10-11-retrait-fuite/`, à côté du dépôt — des données
-- personnelles n'ont rien à faire dans l'histoire Git).
--
-- POURQUOI `IF EXISTS`
-- ====================
-- Ce n'est pas une précaution de confort. `npm run db:apply` prouve un retrait par
-- « présent AVANT, absent APRÈS » : rejouer ce fichier sur une base où la table est
-- déjà partie est un REFUS explicite, pas un succès silencieux. L'`IF EXISTS` évite
-- seulement qu'un `DROP` nu fasse échouer la transaction là où l'intention, elle,
-- est déjà satisfaite.
--
-- APRÈS L'APPLICATION
-- ===================
--   npm run db:snapshot        # le script complet se régénère (FULL_SETUP_MIGRATION.sql)
--   npm run db:snapshot:check  # et il est en phase avec les migrations
--   npm run check:hosted-schema
-- puis le relevé à la clé publique : la table doit répondre 404 (PGRST205), et
-- surtout ne plus rendre une seule ligne.
DROP TABLE IF EXISTS public.students_dupe_backup_20261005;

-- ============================================================================
-- MIGRATION : 20261013000000_econome_payment_months.sql
-- ============================================================================

-- Migration: l'économe peut RENSEIGNER les mois d'un reçu — et RIEN d'autre.
--
-- ─── Le défaut, mesuré le 2026-10-13 ────────────────────────────────────────
-- La fiche de l'élève offre « Renseigner les mois » sur un reçu muet, mais
-- seulement là où la base l'autorise : l'écriture de `payments.months` passait
-- par la policy « Admin update payments » (`public.is_admin()` = admin, dev —
-- 20260809000000_auth_and_rls.sql). Or c'est l'économe qui tient la caisse,
-- repartage les reçus et sait ce qu'un reçu ANTÉRIEUR à la colonne
-- (20261011000000_payments_months.sql) couvrait. Il SUPPRIME déjà un reçu fautif
-- (`public.is_payment_deleter()` = admin, dev, econome) mais ne pouvait pas en
-- renseigner les mois : refuser le second tout en accordant le premier laissait
-- l'école devant un reçu qui ne nomme qu'un mois, indéfiniment — et le seul
-- recours était de le SUPPRIMER pour le ressaisir, ce qui change son numéro, sa
-- date et son auteur au journal.
--
-- ─── La décision (propriétaire, 2026-10-13) ─────────────────────────────────
-- L'économe RENSEIGNE les mois — c'est ce que son guichet voit — mais il ne
-- réécrit pas l'ARGENT : ni `amount`, ni `date`, ni `receipt_number`, ni
-- `student_id`.
--
-- Pourquoi une FONCTION, et pas une policy élargie. Une policy RLS est au niveau
-- de la LIGNE : `FOR UPDATE USING (public.is_payment_month_editor())` laisserait
-- le rôle `authenticated` — que TOUS les postes partagent — réécrire n'importe
-- quelle colonne d'un reçu autorisé, montant compris. Les privilèges de colonne
-- (`GRANT UPDATE (months) …`) ne répondent pas non plus : ils sont portés par le
-- rôle de BASE, pas par le rôle métier, donc ils s'appliqueraient aussi à `admin`,
-- et le seul AUTRE UPDATE de `payments` de l'application — `student_id`, la
-- ré-attribution d'un reçu lors d'une fusion d'élèves
-- (src/lib/dataOps/students.ts) — devrait être ouvert avec, ce qui donnerait à
-- l'économe le pouvoir de DÉPLACER de l'argent d'un élève à un autre. Le rôle
-- d'écriture est donc borné par CONSTRUCTION : `public.set_payment_months()` est
-- le seul chemin, et la seule colonne nommée dans sa requête est `months`.
--
-- Ce qui n'est PAS borné, volontairement : réécrire des mois DÉJÀ déclarés. La
-- borne « seulement si le reçu ne déclare rien » serait un théâtre : l'économe
-- détient la suppression, donc il peut retirer le reçu et le ressaisir avec les
-- mois de son choix. Une borne plus faible que celle déjà accordée ne protège
-- rien ; elle ferait seulement croire que la caisse est plus contrainte qu'elle
-- ne l'est. L'écran, lui, n'offre le geste que sur un reçu muet.
--
-- ─── Ce que la fonction REFUSE, et ce qu'elle rend ──────────────────────────
--   • un appelant qui n'est ni `admin`, ni `dev`, ni `econome` → `42501` (le code
--     que l'école a déjà vu dans la file de rejeu) ;
--   • un identifiant de reçu absent → `23514`, plutôt qu'un UPDATE qui ne touche
--     rien et rendrait « 0 » sans dire pourquoi ;
--   • un tableau de mois VIDE → `23514` : écrire `{}` ne déclare rien de plus que
--     le silence d'avant, en donnant l'impression d'une fiche complétée ;
--   • un mois qui n'est pas `AAAA-MM` (ou `NULL`) → `23514`, la même forme que le
--     CHECK `payments_months_shape_check`, refusée ici avec un message qui dit
--     quoi écrire.
--
-- Elle rend le NOMBRE de lignes écrites. Zéro n'est pas un succès : l'application
-- le DIT, comme pour la suppression — une cible absente rend un succès HTTP sans
-- avoir rien écrit, et un « 0 » avalé ferait annoncer « mois renseignés » sur rien.
--
-- ─── L'EXECUTE, nommément (leçon du 2026-09-06) ─────────────────────────────
-- `ALTER DEFAULT PRIVILEGES` de Supabase donne à `anon` un droit d'exécution
-- DIRECT sur toute fonction créée — un `REVOKE … FROM public` ne le retire pas
-- (20260906000000_anon_cannot_execute_admin_set_user_password.sql). On retire
-- donc explicitement `anon` ET `public`, et on n'accorde qu'à `authenticated`.
-- La garde de rôle dans le corps reste la barrière : `anon` n'a pas de session,
-- donc `auth.uid()` est NULL et `is_payment_month_editor()` est faux.
--
-- `public.is_payment_month_editor()` n'est pas restreinte, comme `is_admin()`,
-- `is_payment_deleter()` et `is_payroll_writer()` : elle ne lit que le rôle de
-- l'appelant et ne rend vrai que pour lui.

-- ─── Helper: qui peut RENSEIGNER les mois d'un reçu ─────────────────────────
CREATE OR REPLACE FUNCTION public.is_payment_month_editor()
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

-- ─── L'écriture bornée : les mois d'un reçu, et rien d'autre ────────────────
CREATE OR REPLACE FUNCTION public.set_payment_months(
    p_payment_id UUID,
    p_months TEXT[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_months TEXT[];
  v_rows INTEGER;
BEGIN
  IF NOT public.is_payment_month_editor() THEN
    RAISE EXCEPTION 'renseigner les mois d’un reçu demande le rôle admin, dev ou econome'
      USING ERRCODE = '42501';
  END IF;

  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'le reçu à renseigner doit être nommé (identifiant manquant)'
      USING ERRCODE = '23514';
  END IF;

  IF p_months IS NULL OR cardinality(p_months) = 0 THEN
    RAISE EXCEPTION 'au moins un mois est requis : un tableau vide ne déclare rien'
      USING ERRCODE = '23514';
  END IF;

  -- `m IS NULL` est nommé : `NULL !~ '…'` vaut NULL, donc un élément NULL
  -- traverserait le EXISTS sans être refusé, et n'irait buter que sur le CHECK.
  IF EXISTS (
    SELECT 1 FROM unnest(p_months) AS m
    WHERE m IS NULL OR m !~ '^\d{4}-(0[1-9]|1[0-2])$'
  ) THEN
    RAISE EXCEPTION 'un mois s’écrit AAAA-MM (par exemple 2026-09)'
      USING ERRCODE = '23514';
  END IF;

  -- Canonique : dédoublonné et rangé. L'application trie déjà avant d'appeler
  -- (src/lib/paymentMonths.ts) ; le refaire ici ferme la question pour TOUT
  -- appelant, y compris un appel direct à la RPC.
  SELECT array_agg(DISTINCT m ORDER BY m) INTO v_months FROM unnest(p_months) AS m;

  -- UNE seule colonne. Ni `amount`, ni `date`, ni `receipt_number`, ni
  -- `student_id` : ce n'est pas une convention, c'est la requête.
  UPDATE public.payments SET months = v_months WHERE id = p_payment_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_payment_months(uuid, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_payment_months(uuid, text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.set_payment_months(uuid, text[]) TO authenticated;

-- ─── PostgREST schema cache reload ──────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- MIGRATION : 20261013000001_payments_write_lock.sql
-- ============================================================================

-- Migration: refermer l'écriture d'un reçu — l'argent ne se réécrit plus par un
-- UPDATE de table, et la seule ré-attribution utile passe par une FONCTION bornée.
--
-- ─── Le défaut, mesuré le 2026-10-13 sur la base de l'ÉCOLE ─────────────────
-- `20261013000000_econome_payment_months.sql` promet une borne : l'économe
-- renseigne les MOIS d'un reçu, et l'argent lui reste fermé (`Admin update
-- payments` = `public.is_admin()`). La promesse était vraie dans les migrations et
-- FAUSSE dans la base : celle-ci portait encore les trois politiques de sa mise en
-- place manuelle — « Authenticated users can read / insert / update payments »,
-- cette dernière avec `USING (true)` — ANTÉRIEURES aux politiques du dépôt
-- (xid 1282 contre 1505-1507), et `20260809000000_auth_and_rls.sql` ne les avait
-- jamais retirées : il retirait les « Allow anonymous … », un autre jeu de noms.
--
-- Or les politiques PERMISSIVE s'ADDITIONNENT : `USING (true)` rendait la garde
-- `is_admin()` inopérante. Mesuré, transaction annulée, sur un reçu réel de la
-- base partagée : `general_manager` — `is_admin()` faux, `is_payment_deleter()`
-- faux, `is_payment_month_editor()` faux — modifiait `amount` (1 ligne). Tout
-- compte connecté le pouvait, et `payments` est la table de l'argent.
--
-- ─── Ce que ces trois `DROP` changent, et ce qu'ils ne changent pas ─────────
--   • `… can update payments` (`USING true`) : LE trou. Sans elle, la seule
--     écriture directe de `payments` redevient « Admin update payments »
--     (`public.is_admin()` : admin, dev) — ce que le dépôt déclare depuis le
--     2026-08-09, et que `tests/payment-rights.test.ts` verrouille.
--   • `… can insert payments` (`WITH CHECK (true)`) et `… can read payments`
--     (`USING true`) : des DOUBLONS. La base porte déjà « Authenticated insert
--     payments » (`auth.role() = 'authenticated'`) et « Authenticated read
--     payments » (même condition) — MÊME portée, même effet pour un compte
--     connecté. Les retirer ne change donc rien pour personne : c'est la même
--     paire, écrite une fois, dans le seul jeu que le dépôt lit. Ce qui change,
--     c'est qu'il n'y a plus DEUX endroits qui décident, dont un que le dépôt ne
--     lit pas. `anon`, lui, était déjà refusé (ses « Allow anonymous … » sont
--     parties le 2026-08-09) : mesuré, 0 ligne.
--
-- Insérer un reçu reste ouvert à tout compte connecté, et ce n'est pas un oubli :
-- c'est le geste du GUICHET — la caisse saisit un reçu, et plusieurs rôles le
-- font. Le retirer demanderait de nommer qui encaisse : une autre décision. Ce que
-- ce fichier ferme, c'est l'écriture d'un reçu DÉJÀ enregistré, celle qui touche
-- l'argent et ne laisse aucune trace du geste.
--
-- ─── La seule ré-attribution utile, ouverte NOMMÉMENT ──────────────────────
-- Le dépôt a UN autre UPDATE de `payments` : la fusion de deux fiches d'élève
-- déplace leurs reçus (`src/lib/dataOps/students.ts`). Une policy borne des
-- LIGNES, pas des colonnes — la rouvrir pour ça rouvrirait le MONTANT avec, et
-- fermer sans rien ouvrir casserait la fusion. Le geste devient donc une FONCTION
-- bornée, comme les mois :
--
--   `public.reassign_payment_student(p_payment_id, p_from_student_id, p_to_student_id)`
--     • gardée par `public.is_admin()` — le rôle que l'écran offre DÉJÀ pour
--       fusionner ou supprimer une fiche (`src/lib/deleteRights.ts`, `ADMIN_ROLES`) ;
--     • un seul SET : `student_id` ;
--     • la fiche d'ORIGINE est EXIGÉE : un reçu qui n'est plus sur la fiche
--       attendue rend 0. C'est le `WHERE student_id = …` que le filtre du client
--       portait ; sans lui, la fusion pourrait déplacer un reçu que quelqu'un vient
--       de rattacher ailleurs — et c'est ce compte, ligne par ligne, qui arrête le
--       geste AVANT que la fiche soit supprimée (la cascade emporterait les reçus
--       restés derrière : c'est l'accident que ce contrôle existe pour empêcher) ;
--     • elle rend le NOMBRE de lignes écrites : zéro n'est pas un succès, et
--       l'application le DIT.
--
-- ORDRE DE DÉPLOIEMENT : l'application doit être livrée avec ce fichier. Un poste
-- qui fusionnerait encore par UPDATE direct sera refusé (« Reçus non rattachés —
-- droits insuffisants, ou les reçus ont changé. Rien n'a été fusionné. »), et la
-- fusion s'arrête AVANT toute suppression : un refus, jamais un demi-geste.
--
-- ─── L'EXECUTE, nommément (leçon du 2026-09-06) ─────────────────────────────
-- `ALTER DEFAULT PRIVILEGES` de Supabase donne à `anon` un droit d'exécution
-- DIRECT sur toute fonction créée — un `REVOKE … FROM public` ne le retire pas
-- (`20260906000000_anon_cannot_execute_admin_set_user_password.sql`). On retire
-- donc explicitement `anon` ET `public`, et on n'accorde qu'à `authenticated` :
-- la garde de rôle du corps reste la barrière, et `anon` n'a pas de session.

-- ─── 1. Fermer l'écriture ouverte à tout compte connecté ────────────────────
DROP POLICY IF EXISTS "Authenticated users can update payments" ON public.payments;
DROP POLICY IF EXISTS "Authenticated users can insert payments" ON public.payments;
DROP POLICY IF EXISTS "Authenticated users can read payments" ON public.payments;

-- ─── 2. Rouvrir le SEUL chemin nommé : la ré-attribution d'un reçu ──────────
CREATE OR REPLACE FUNCTION public.reassign_payment_student(
    p_payment_id UUID,
    p_from_student_id UUID,
    p_to_student_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'déplacer un reçu d’une fiche à une autre demande le rôle admin ou dev'
      USING ERRCODE = '42501';
  END IF;

  IF p_payment_id IS NULL OR p_from_student_id IS NULL OR p_to_student_id IS NULL THEN
    RAISE EXCEPTION 'le reçu, sa fiche d’origine et sa fiche d’arrivée doivent être nommés'
      USING ERRCODE = '23514';
  END IF;

  -- Déplacer un reçu vers la fiche où il est déjà ne déplace rien : l'annoncer
  -- comme un succès ferait croire à une fusion qui n'a pas eu lieu.
  IF p_from_student_id = p_to_student_id THEN
    RAISE EXCEPTION 'un reçu ne se déplace pas vers la fiche où il est déjà (rien à faire)'
      USING ERRCODE = '23514';
  END IF;

  -- UNE seule colonne, et la fiche d'origine dans le filtre : ce n'est pas une
  -- convention, c'est la requête. Ni `amount`, ni `date`, ni `receipt_number`.
  UPDATE public.payments
     SET student_id = p_to_student_id
   WHERE id = p_payment_id AND student_id = p_from_student_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reassign_payment_student(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reassign_payment_student(uuid, uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reassign_payment_student(uuid, uuid, uuid) TO authenticated;

-- ─── PostgREST schema cache reload ──────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- MIGRATION : 20261014000000_finance_writer_staff_vendor.sql
-- ============================================================================

-- Migration: l'économe (Accountant) peut AJOUTER un membre du personnel et une
--            dépense fournisseur — « il a accès à tout sauf les paramètres du
--            système » (propriétaire, 2026-10-13).
--
-- ─── Le défaut, mesuré le 2026-10-13 sur la base de l'école ─────────────────
-- Sur le poste connecté `econome` (aggeediarra@mamathera.org), deux écrans
-- n'offraient AUCUNE action, et deux autres l'offraient pour être refusés :
--
--   • « Pai/Salaires » → Répertoire du personnel : « Ajouter un employé »,
--     « Ajouter un membre de l'administration », « Ajouter un membre T et P »
--     n'apparaissaient pas — `canManageStaff` ne citait que `is_finance_admin()`.
--     Mesuré en base : insertion `staff` en `econome` → 42501 :
--       [INSERT] « Admin can insert staff »        CHECK is_admin()
--       [INSERT] « Finance admins insert staff »   CHECK is_finance_admin()
--
--   • « Dépenses » → Dépenses générales : l'icône ✚ « Ajouter une dépense »
--     n'apparaissait pas non plus (la porte de l'écran citait le même
--     `isPromoter || isGeneralManager`). Là, la base ACCEPTAIT déjà l'économe
--     (`Authenticated insert expenses` → insertion mesurée : 1) : c'est
--     l'INTERFACE qui fermait, pas la policy. Ces deux portes passent par la
--     droit nommé ci-dessous, qui dit qui écrit sans dépendre d'un booléen
--     d'écran.
--
--   • « Dépenses » → Fournisseurs & Services : insertion `vendor_expenses` en
--     `econome` ET en `general_manager` → 42501. La seule policy d'insertion en
--     base est encore « Promoter insert vendor_expenses » CHECK is_admin(),
--     c'est-à-dire la version d'AVANT `20260906000002_vendor_expense_gm_policies.sql`
--     — laquelle n'a jamais été appliquée ici : le Gestionnaire Principal voit
--     le bouton « Ajouter une dépense fournisseur » depuis son poste et la base
--     refuse chacune de ses écritures. Ce n'est pas la demande, c'est le même
--     défaut dans la même table : le corriger est le seul moyen de nommer la
--     règle d'écriture des dépenses fournisseur une fois pour tout le monde.
--
-- ─── La décision ────────────────────────────────────────────────────────────
-- Un droit NOMMÉ, `public.is_finance_writer()` = `is_finance_admin()`
-- (admin, dev, general_manager) **plus `econome`** — la même forme que
-- `public.is_payroll_writer()` (20261005000000). Les policies d'ÉCRITURE du
-- personnel et d'INSERTION des dépenses fournisseur passent par lui ; l'écran
-- lit la même liste (`src/lib/financeRights.ts`), donc un rôle ajouté d'un seul
-- côté fait rougir `tests/finance-rights.test.ts` au lieu de rouvrir une action
-- que la base refuse (42501) ou d'en cacher une qu'elle accepte.
--
-- CE QUI NE BOUGE PAS, et pourquoi :
--   • la SUPPRESSION d'un membre du personnel reste `is_finance_admin()` —
--     recruter et licencier ne sont pas le même droit. L'économe enregistre le
--     personnel et la paie ; il ne supprime ni l'un ni l'autre.
--   • la SUPPRESSION d'une dépense (générale ou fournisseur) reste `is_admin()`
--     (`Admin can delete expenses`, `Promoter delete vendor_expenses`) : mesuré,
--     l'économe y reçoit 0 ligne touchée. L'écran ne lui montre donc pas de
--     corbeille (`canDelete`, `src/lib/deleteRights.ts`).
--   • les policies d'écriture de `expenses` sont laissées INTACTES : elles
--     acceptent déjà l'économe (et tout compte authentifié — la saisie
--     quotidienne des dépenses fait partie du rôle `staff`, décision de
--     20260902000000). Resserrer ici retirerait un droit que des comptes
--     exercent déjà : cette migration ne fait qu'OUVRIR ce qui est fermé.
--   • la modification d'une dépense fournisseur existante : la policy large et le
--     trigger `protect_vendor_expense_financial_fields` gardent `vendor_name` et
--     `amount` au promoteur (20260828000000) — inchangé.

-- ─── Helper: qui ÉCRIT le personnel et les dépenses fournisseur ─────────────
CREATE OR REPLACE FUNCTION public.is_finance_writer()
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

-- ─── staff : insertion et correction ouvertes à l'économe ────────────────────
-- Deux noms hérités se succèdent sur cette table (« Admin can … » puis
-- « Finance admins … ») : les deux partent. Les policies permissives se
-- cumulent par OR, donc en laisser une n'aurait pas changé le RÉSULTAT — mais
-- elle laisserait croire que `is_admin()` ou `is_finance_admin()` est encore la
-- règle de l'écriture du personnel. Rejouable : on retire AUSSI les noms que
-- cette migration crée, avant de les recréer (une migration appliquée deux fois
-- échouait sur « policy already exists » et annulait tout son bloc).
DROP POLICY IF EXISTS "Admin can insert staff" ON public.staff;
DROP POLICY IF EXISTS "Finance admins insert staff" ON public.staff;
DROP POLICY IF EXISTS "Finance writers insert staff" ON public.staff;
CREATE POLICY "Finance writers insert staff" ON public.staff
    FOR INSERT WITH CHECK (public.is_finance_writer());

DROP POLICY IF EXISTS "Admin can update staff" ON public.staff;
DROP POLICY IF EXISTS "Finance admins update staff" ON public.staff;
DROP POLICY IF EXISTS "Finance writers update staff" ON public.staff;
CREATE POLICY "Finance writers update staff" ON public.staff
    FOR UPDATE USING (public.is_finance_writer());

-- ─── vendor_expenses : insertion ouverte à l'économe (et au gestionnaire) ───
-- Cette policy répare au passage la dérive mesurée sur la base de l'école : le
-- Gestionnaire Principal, promis « full FINANCIAL administration » depuis
-- 20260902000000, était refusé à l'insertion.
DROP POLICY IF EXISTS "Promoter insert vendor_expenses" ON public.vendor_expenses;
DROP POLICY IF EXISTS "Finance admins insert vendor_expenses" ON public.vendor_expenses;
DROP POLICY IF EXISTS "Finance writers insert vendor_expenses" ON public.vendor_expenses;
CREATE POLICY "Finance writers insert vendor_expenses" ON public.vendor_expenses
    FOR INSERT WITH CHECK (public.is_finance_writer());

-- ─── PostgREST schema cache reload ──────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- MIGRATION : 20261015000000_inherited_policy_closure.sql
-- ============================================================================

-- Migration: retirer les POLITIQUES HÉRITÉES de cinq tables — students, parents,
--            staff, salary_payments, expenses — celles de la mise en place
--            MANUELLE de la base, antérieures aux politiques du dépôt.
--
-- ─── Le défaut, mesuré le 2026-10-13 sur la base de l'ÉCOLE ─────────────────
-- `20261013000001_payments_write_lock.sql` a fermé les trois politiques héritées
-- de `payments` — celles que `20260809000000_auth_and_rls.sql` n'avait jamais
-- retirées parce qu'elles portaient d'AUTRES noms que les « Allow anonymous … »
-- qu'il retirait. Cinq autres tables portaient la même génération de politiques :
-- quinze noms que le dépôt ne déclare ni ne retire, sur des tables du registre
-- scolaire et de l'argent. `npm run check:rls-policies` les nomme « en base,
-- déclarée par AUCUNE migration » — et ils y restaient parce que le défaut de
-- `payments` avait été traité seul.
--
-- ─── CE QUI EST MESURÉ AVANT D'ÉCRIRE, et pourquoi c'est nécessaire ─────────
-- Les politiques PERMISSIVES s'ADDITIONNENT : lire le texte d'une policy ne dit
-- pas qui passe, c'est l'UNION de toutes celles de la table. Avant de retirer
-- quoi que ce soit, la carte des écritures a donc été MESURÉE sur la base réelle,
-- rôle par rôle, dans une transaction annulée (`SET LOCAL ROLE authenticated` et
-- les deux claims JWT, exactement ce que PostgREST pose) :
--
--   table             lire   insérer                    corriger   corriger$   supprimer
--   students          tous   tous                       tous       tous ⚠️     admin, dev
--   parents           tous   tous                       tous       —           admin, dev
--   staff             tous   admin, dev, GM, économe    idem       idem        admin, dev, GM
--   salary_payments   tous   admin, dev, GM, économe    idem       idem        admin, dev, GM
--   expenses          tous   tous                       tous       tous ⚠️     admin, dev
--
--   « tous » = tout compte connecté ; « corriger$ » = la colonne de l'ARGENT
--   (`students.amount_paid`, `expenses.amount`, `staff.salary`,
--   `salary_payments.amount`) ; `anon` est refusé partout (0 ligne).
--
-- ─── CE QUE CETTE MIGRATION FAIT, ET CE QU'ELLE NE FAIT PAS ─────────────────
-- Elle retire les quinze noms hérités, et RIEN d'autre. Chacun a, sur la même
-- table et pour la même commande, un homologue DÉCLARÉ par le dépôt dont l'effet
-- le COUVRE :
--
--   students         « Authenticated users can read / insert / update students »
--                    → « Authenticated read / insert / update students »
--                      (`auth.role() = 'authenticated'`, 20260809000000)
--                    « Admin can delete students » → « Admin delete students »
--                      (`public.is_admin()`)
--   parents          les quatre mêmes paires, sur `parents`
--   expenses         les quatre mêmes paires, sur `expenses`
--   staff            « Authenticated users can read staff » → « Authenticated
--                      read staff »
--                    « Admin can delete staff » → « Finance admins delete staff »
--                      (`public.is_finance_admin()`, 20260902000000) : un
--                      SUR-ENSEMBLE — `is_admin()` ⊂ `is_finance_admin()`
--   salary_payments  « Authenticated users can read salary_payments »
--                    → « Authenticated read salary_payments »
--
-- Donc AUCUN droit ne change : c'est une déduplication, pas un resserrement. Ce
-- qu'elle retire, c'est le SECOND endroit qui décidait — celui que le dépôt ne
-- lit pas, et dans lequel une relecture de la sécurité voit une règle
-- `USING (true)` que rien ne rattache au code.
--
-- ⚠️ CE QUI RESTE OUVERT est un CHOIX, pas un oubli, et il est nommé ici parce
-- qu'une fermeture qui se tait sur ce qu'elle laisse ouverte se lit comme un
-- quitus. Sur `students`, `parents` et `expenses`, la règle DÉCLARÉE est
-- elle-même large (`auth.role() = 'authenticated'`) : la saisie quotidienne du
-- guichet — fiches, reçus, dépenses — est le métier du rôle `staff`
-- (20260902000000_general_manager_role.sql : « staff → daily entries (students,
-- payments, receipts, expenses) »). En particulier `students.amount_paid` est
-- réécrit par l'APPLICATION à chaque geste d'argent (`addPayment`,
-- `deletePayment`, `restorePayment`, `src/lib/dataOps`) : le fermer aux comptes
-- du guichet demanderait de faire passer ces gestes par une FONCTION bornée,
-- comme les mois d'un reçu — c'est une décision, et une autre migration.
--
-- ─── ORDRE, ET REJOUABILITÉ ────────────────────────────────────────────────
-- Ce fichier s'applique APRÈS `20261014000000_finance_writer_staff_vendor.sql` :
-- celui-ci remplace « Admin insert staff » et « Admin update staff » par
-- « Finance writers insert / update staff », et n'a AUCUN nom en commun avec les
-- quinze ci-dessous. Un `DROP POLICY IF EXISTS` ne dépend donc pas de l'ordre —
-- mais l'écrire ici évite qu'un rejeu chronologique laisse croire le contraire.
-- Rejouable : `IF EXISTS` partout, aucun `CREATE` à heurter.

-- ─── 1. students ────────────────────────────────────────────────────────────
-- Restent : « Authenticated read students », « Authenticated insert students »,
-- « Authenticated update students » (authenticated) et « Admin delete students »
-- (`is_admin()`).
DROP POLICY IF EXISTS "Authenticated users can read students" ON public.students;
DROP POLICY IF EXISTS "Authenticated users can insert students" ON public.students;
DROP POLICY IF EXISTS "Authenticated users can update students" ON public.students;
DROP POLICY IF EXISTS "Admin can delete students" ON public.students;

-- ─── 2. parents ─────────────────────────────────────────────────────────────
-- Restent : les trois « Authenticated … parents » et « Admin delete parents ».
DROP POLICY IF EXISTS "Authenticated users can read parents" ON public.parents;
DROP POLICY IF EXISTS "Authenticated users can insert parents" ON public.parents;
DROP POLICY IF EXISTS "Authenticated users can update parents" ON public.parents;
DROP POLICY IF EXISTS "Admin can delete parents" ON public.parents;

-- ─── 3. expenses ────────────────────────────────────────────────────────────
-- Restent : les trois « Authenticated … expenses » et « Admin delete expenses ».
DROP POLICY IF EXISTS "Authenticated users can read expenses" ON public.expenses;
DROP POLICY IF EXISTS "Authenticated users can insert expenses" ON public.expenses;
DROP POLICY IF EXISTS "Authenticated users can update expenses" ON public.expenses;
DROP POLICY IF EXISTS "Admin can delete expenses" ON public.expenses;

-- ─── 4. staff ───────────────────────────────────────────────────────────────
-- Restent : « Authenticated read staff », « Finance writers insert / update
-- staff » (`is_finance_writer()`) et « Finance admins delete staff »
-- (`is_finance_admin()`).
DROP POLICY IF EXISTS "Authenticated users can read staff" ON public.staff;
DROP POLICY IF EXISTS "Admin can delete staff" ON public.staff;

-- ─── 5. salary_payments ─────────────────────────────────────────────────────
-- Restent : « Authenticated read salary_payments », « Payroll writers insert /
-- update salary_payments » (`is_payroll_writer()`) et « Finance admins delete
-- salary_payments » (`is_finance_admin()`).
DROP POLICY IF EXISTS "Authenticated users can read salary_payments" ON public.salary_payments;

-- ─── PostgREST schema cache reload ──────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- MIGRATION : 20261016000000_payments_motif.sql
-- ============================================================================

-- Migration: À QUOI correspond un paiement — scolarité ou inscription.
--
-- Le reçu officiel (`public/templates/recu-parent.pdf`) porte une ligne
-- « Motif » sous « Classe ». Jusqu'ici le générateur y imprimait TOUJOURS le
-- même mot (« Frais de scolarité »), parce que la base ne savait pas dire
-- l'autre : une famille qui venait payer le DROIT D'INSCRIPTION recevait un
-- reçu qui parlait de scolarité. Le geste était enregistré, le papier était
-- faux — et une réimpression tirée de l'historique l'aurait été aussi.
--
-- Le motif est donc une COLONNE, écrite par le geste qui l'a choisi et relue à
-- chaque réimpression, comme `months` avant elle.
--
-- Forme stockée : une clé courte et stable — `scolarite` / `inscription` —
-- jamais un libellé. « Frais de scolarité » gravé ici serait faux dans un reçu
-- anglais, et un libellé ne se traduit pas ; c'est `src/lib/paymentMotifs.ts`
-- qui rend le mot, dans la langue du reçu.
--
-- Le CHECK tient la forme : `motif IS NULL` (les lignes d'avant la colonne, et
-- tout import qui n'en déclare pas) OU l'une des deux clés connues. Une chaîne
-- inventée est refusée par la base, pas seulement par l'écran.
--
-- Les lignes existantes gardent `NULL` — « motif non renseigné » — et le reçu
-- retombe alors sur « Frais de scolarité », exactement comme avant : un reçu
-- déjà imprimé ne change pas d'un caractère.
--
-- Aucune politique RLS à ajouter : celles de `payments` sont au niveau TABLE
-- (« Authenticated read payments », « Authenticated insert payments », …), et
-- une colonne de plus ne change ni qui lit, ni qui écrit.

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS motif TEXT;

ALTER TABLE public.payments
    DROP CONSTRAINT IF EXISTS payments_motif_shape_check;

ALTER TABLE public.payments
    ADD CONSTRAINT payments_motif_shape_check
    CHECK (motif IS NULL OR motif IN ('scolarite', 'inscription'));

-- ============================================================================
-- MIGRATION : 20261017000000_rls_declared_alignment.sql
-- ============================================================================

-- Migration: aligner la base sur ce que le dépôt DÉCLARE — trois tables, cinq
--            politiques héritées retirées et deux politiques déclarées posées.
--            Aucun droit ne change : c'est un RENOMMAGE et une DÉDUPLICATION,
--            mesurés avant et après, commande par commande.
--
-- ─── Le défaut, mesuré le 2026-10-13 sur la base de l'école ─────────────────
-- `npm run check:rls-policies` nommait NEUF écarts entre les politiques que les
-- migrations déclarent et celles que `pg_policies` porte. Quatre étaient des
-- MANQUES, cinq des politiques qu'AUCUNE migration ne déclare ni ne retire :
--
--   academic_years   « Allow authenticated read access on academic_years »
--                    (SELECT) et « Allow admin write access on academic_years »
--                    (ALL) — déclarées par 20260820000000, ABSENTES en base ;
--   academic_years   « Authenticated read academic_years » (SELECT,
--                    `authenticated`, `true`) et « Admin manage academic_years »
--                    (ALL, `authenticated`, `USING is_admin()` /
--                    `WITH CHECK is_admin()`) — EN BASE, déclarées par rien ;
--   user_profiles    « Users can read own profile or admin reads all » (SELECT,
--                    `(id = auth.uid()) OR is_admin()`) et « Admin can update
--                    profiles » (UPDATE, `authenticated`, `is_admin()`) —
--                    EN BASE, déclarées par rien ;
--   todos            « Authenticated users can manage todos » (ALL,
--                    `authenticated`, `USING true` / `WITH CHECK true`) —
--                    EN BASE, déclarée par rien ;
--   custom_grades    « Authenticated read custom grades » (SELECT) et
--                    « Authenticated insert custom grades » (INSERT) —
--                    déclarées par 20260828000002/3.
--
-- ─── CE QUE CETTE MIGRATION NE RÉPARE PAS, ET POURQUOI ─────────────────────
-- Les deux « manques » de `custom_grades` ne sont PAS des droits à écrire : la
-- table est RETIRÉE par `20260828000004_custom_classes.sql` (bloc `DO $$ … $$`
-- conditionnel : ses lignes sont migrées vers `custom_classes`, puis
-- `DROP TABLE public.custom_grades`). Le dépôt ne peut donc pas vouloir ces deux
-- politiques — elles étaient le fait d'avant le retrait de la table, et le
-- contrôle qui les réclamait ne regardait pas les `DROP TABLE` de son propre
-- corpus. C'est LUI qui a été corrigé (`scripts/lib/rls-policies.mjs` : une table
-- retirée par une migration ne réclame plus les politiques qu'elle déclarait
-- avant), ses cas sont dans `tests/rls-policies.test.ts` et les deux noms sont
-- figés dans `tests/rls-declared-alignment.test.ts`. Recréer la table pour y
-- poser deux politiques que le dépôt a lui-même retirées aurait été le contraire
-- d'une réparation.
--
-- ─── CE QUI EST MESURÉ AVANT D'ÉCRIRE ──────────────────────────────────────
-- Une politique PERMISSIVE ne dit pas qui passe : c'est l'UNION de toutes celles
-- de la table. La carte des ÉCRITURES a donc été mesurée sur la base réelle,
-- rôle par rôle, dans des transactions ANNULÉES (`SET LOCAL ROLE authenticated`
-- + les deux claims JWT, ce que PostgREST pose) — AVANT cette migration, puis
-- APRÈS son application : les deux cartes sont IDENTIQUES (voir
-- `DEVELOPMENT_HISTORY.md` pour le relevé). Les cinq retraits sont des
-- DÉDUPLICATIONS :
--
--   academic_years   « Authenticated read academic_years »   ≡ « Allow
--                      authenticated read access on academic_years »
--                      (`authenticated`, SELECT, `USING true`) : même règle,
--                      même commande, mêmes rôles — un renommage, pas un droit ;
--                    « Admin manage academic_years »         ≡ « Allow admin
--                      write access on academic_years »
--                      (`authenticated`, ALL, `USING is_admin()` /
--                      `WITH CHECK is_admin()`) : idem. L'écran qui entretient
--                      l'année courante (`src/lib/dataOps/academicYears.ts`) ne
--                      l'essaie déjà que pour `admin` / `dev` : inchangé.
--   user_profiles    « Users can read own profile or admin reads all »
--                    ≡ « Users can view own profile » (`USING (auth.uid() = id)
--                    OR is_admin()`), DÉCLARÉE et portée par la base depuis
--                    20260809000000 : le retrait ne ferme rien, l'homologue
--                    déclaré est de la MÊME règle et d'une audience PLUS LARGE
--                    (`public`, la condition gardant le seuil).
--                    « Admin can update profiles » ≡ « Admins can update
--                    profiles » (`USING is_admin()`) : idem — et sur un UPDATE
--                    sans `WITH CHECK`, la condition de lecture s'applique aussi
--                    à la ligne écrite, exactement comme le double `is_admin()`
--                    de la version héritée.
--   todos            « Authenticated users can manage todos » (`ALL`,
--                    `authenticated`, `true`) est couverte commande par
--                    commande par les QUATRE politiques déclarées de
--                    20260809000000 — « Authenticated read / insert / update /
--                    delete todos » (`auth.role() = 'authenticated'`) : `SELECT`,
--                    `INSERT`, `UPDATE` et `DELETE` y ont chacun leur règle, donc
--                    le `ALL … true` n'ajoutait rien à un compte connecté.
--
-- ⚠️ Ce qui RESTE ouvert sur ces tables est un CHOIX, et il est nommé : `todos`
-- reste lisible et écrit par tout compte connecté (le carnet de tâches est
-- partagé par le secrétariat), et `user_profiles` reste lisible par son
-- propriétaire ou par un administrateur. Rien n'est resserré ici : les deux
-- politiques posées ci-dessous sont copiées MOT POUR MOT de
-- 20260820000000_academic_year_promotions.sql, ce que la suite vérifie champ par
-- champ (commande, rôles, `USING`, `WITH CHECK`).
--
-- ─── REJOUABILITÉ ───────────────────────────────────────────────────────────
-- Les deux noms que cette migration POSE sont retirés avant d'être posés, comme
-- les hérités : un fichier appliqué deux fois ne s'interrompt pas sur un
-- « policy already exists », et un rejeu laisse l'état décrit ci-dessus.

-- ─── 1. academic_years : les deux noms hérités → les deux noms DÉCLARÉS ─────
DROP POLICY IF EXISTS "Authenticated read academic_years" ON public.academic_years;
DROP POLICY IF EXISTS "Admin manage academic_years" ON public.academic_years;

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

-- ─── 2. user_profiles : deux doublons hérités des politiques déclarées ──────
-- Restent : « Users can view own profile » (SELECT), « Admins can insert /
-- update / delete profiles » (`is_admin()`) — les quatre que 20260809000000
-- déclare, et que la base porte déjà.
DROP POLICY IF EXISTS "Users can read own profile or admin reads all" ON public.user_profiles;
DROP POLICY IF EXISTS "Admin can update profiles" ON public.user_profiles;

-- ─── 3. todos : le `ALL … true` hérité, couvert par les quatre déclarées ────
-- Restent : « Authenticated read / insert / update / delete todos ».
DROP POLICY IF EXISTS "Authenticated users can manage todos" ON public.todos;

-- ─── PostgREST schema cache reload ──────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- MIGRATION : 20261018000000_station_versions.sql
-- ============================================================================

-- ============================================================================
-- MAMA THERA Finance Suite — LE BATTEMENT DE VERSION DU PARC
-- ============================================================================
-- Spécification : docs/CANAL_MISE_A_JOUR.md §7 (« Battement de version »).
--
-- La section 6 de cette spécification ne peut pas se vérifier toute seule : pour
-- savoir si le parc est passé à la version de bascule, il faut un RELEVÉ par
-- poste. Sans lui, « toutes les stations sont passées » se prouve poste par
-- poste — c'est-à-dire ne se prouve pas. Cette table est ce relevé : une ligne
-- par poste, écrite par le poste lui-même, et lue par `npm run fleet:versions`.
--
-- ─── Ce qu'un battement porte, et ce qu'il ne porte JAMAIS ─────────────────
-- Quatre faits, aucun d'identité : `station_id` est un identifiant ALÉATOIRE
-- rangé sur le poste (aucun nom de machine, aucun nom d'école, aucun compte),
-- la version installée, le majeur de Windows, et l'état du dernier contrôle de
-- mise à jour (avec la version proposée). C'est un recensement de parc, pas une
-- télémétrie d'usage : rien ici ne dit qui s'est servi de l'application, ni
-- combien.
--
-- ─── Pourquoi une FONCTION, et pas l'`upsert` que la spécification décrivait ─
-- La spécification demandait deux choses incompatibles telles quelles : un
-- `upsert` (une ligne par poste, `seen_at` rafraîchi à chaque battement) ET
-- « aucune politique de DELETE/UPDATE ». Un `upsert` PostgREST est un
-- `INSERT … ON CONFLICT DO UPDATE` : il exige le privilège UPDATE **et** une
-- politique UPDATE — les deux que la spécification refuse. Arbitré avec le
-- propriétaire le 2026-10-14 : l'écriture passe par cette fonction nommée
-- (`SECURITY DEFINER`, `EXECUTE` accordée au seul rôle `anon`), et la TABLE
-- n'ouvre plus rien du tout. Conséquence, et c'est un gain : `anon` ne peut ni
-- lire, ni écrire, ni supprimer directement — il ne peut qu'appeler ce geste,
-- dont les champs sont validés ici, avant que la moindre ligne soit touchée.
--
-- ─── Le point sensible, et il est chiffré ──────────────────────────────────
-- Une clé publique qui peut écrire est une surface : rien n'empêche d'appeler
-- cette fonction avec des `station_id` inventés, et la table grossirait alors
-- sans fin. Trois garde-fous, tous NOMMÉS :
--   • `npm run fleet:versions` refuse un relevé au-delà d'un seuil de lignes
--     (`--max-rows`, 200 par défaut — le parc réel est de l'ordre de la dizaine) ;
--   • le battement se DÉSACTIVE sur un poste (`STATION_HEARTBEAT=off`) sans
--     toucher au canal : une écriture refusée ici n'a aucun effet sur les mises
--     à jour, qui ne dépendent ni de cette table ni de la clé anon ;
--   • les bornes ci-dessous refusent une ligne qui ne dit rien d'exploitable.
--
-- ─── Ordre imposé par la spécification ─────────────────────────────────────
-- « jamais activé avant que le contrôle anon ne prouve l'insertion sans
-- lecture ». C'est pourquoi `scripts/verify-anon-rls.mjs` sonde les DEUX
-- directions dans cette même migration : l'appel de la fonction PASSE, et la
-- lecture de la table rend 0 ligne. La seule surface d'écriture anonyme de
-- l'application ne peut pas précéder sa preuve.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.station_versions (
    station_id TEXT PRIMARY KEY,
    app_version TEXT NOT NULL,
    os_version TEXT,
    last_check TEXT NOT NULL,
    last_check_version TEXT,
    seen_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT station_versions_station_id_bounds CHECK (char_length(station_id) BETWEEN 8 AND 64),
    CONSTRAINT station_versions_app_version_bounds CHECK (char_length(app_version) BETWEEN 1 AND 32),
    CONSTRAINT station_versions_os_version_bounds CHECK (
        os_version IS NULL OR char_length(os_version) BETWEEN 1 AND 32
    ),
    -- Les quatre états du contrôle, nommés : un état libre serait un journal
    -- qu'on ne peut plus agréger (et « ok » se lirait comme « à jour » alors que
    -- `feed-absent` dit le contraire).
    CONSTRAINT station_versions_last_check_enum CHECK (
        last_check IN ('ok', 'feed-absent', 'html', 'unreachable')
    ),
    CONSTRAINT station_versions_last_check_version_bounds CHECK (
        last_check_version IS NULL OR char_length(last_check_version) BETWEEN 1 AND 32
    )
);

COMMENT ON TABLE public.station_versions IS
    'Relevé du parc (§7 de docs/CANAL_MISE_A_JOUR.md) : une ligne par poste, écrite par le poste via public.record_station_beat(). Aucun nom, aucune identité — un station_id aléatoire. Inscriptible par anon, ILLISIBLE par anon.';

ALTER TABLE public.station_versions ENABLE ROW LEVEL SECURITY;

-- ─── La table n'ouvre RIEN à personne par le canal REST ────────────────────
-- Le verrou est la RLS SANS AUCUNE POLITIQUE, et c'est le précédent du dépôt
-- pour une table qu'une fonction `security definer` atteint seule :
-- `student_matricule_counters`, mesurée le 2026-10-18 (RLS activée, zéro
-- politique, privilèges REST par défaut de Supabase laissés en place). Avec
-- zéro politique : zéro ligne lisible, et toute écriture refusée (403) pour
-- `anon` comme pour `authenticated` — le seul chemin d'écriture est la fonction
-- ci-dessous, qui est `SECURITY DEFINER` et tourne donc avec les droits de son
-- propriétaire, pas avec ceux de l'appelant.
--
-- ─── Pourquoi les privilèges REST ne sont PAS révoqués ─────────────────────
-- Parce qu'ils ne sont pas ce qui protège ici, et que les révoquer coûterait un
-- angle mort. `check:hosted-schema` sonde la base de production par le canal de
-- l'application (la clé `anon`) pour vérifier que les colonnes déclarées
-- EXISTENT, et un 401 « permission denied » y est un « pas de verdict possible »
-- (sortie 2) : une table qu'aucune sonde ne peut atteindre est une table que
-- personne ne surveille. Ce qui garde celle-ci, c'est l'ABSENCE de politique,
-- et elle est surveillée deux fois : `check:public-rls` la nomme « scellée »
-- (RLS activée, 0 politique, aucun rôle client ne lit), et
-- `scripts/verify-anon-rls.mjs` éprouve à chaque exécution que la lecture anon
-- rend 0 ligne et que l'écriture anon est refusée. La conséquence est DITE, pas
-- cachée : ajouter un jour une politique permissive sur cette table l'ouvrirait
-- d'un coup — c'est exactement le geste que ces deux contrôles attrapent.

-- ─── Le geste, et lui seul ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_station_beat(
    p_station_id TEXT,
    p_app_version TEXT,
    p_os_version TEXT DEFAULT NULL,
    p_last_check TEXT DEFAULT 'ok',
    p_last_check_version TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_station_id TEXT := btrim(coalesce(p_station_id, ''));
    v_app_version TEXT := btrim(coalesce(p_app_version, ''));
    v_os_version TEXT := nullif(btrim(coalesce(p_os_version, '')), '');
    v_last_check TEXT := btrim(coalesce(p_last_check, 'ok'));
    v_last_check_version TEXT := nullif(btrim(coalesce(p_last_check_version, '')), '');
BEGIN
    -- Le refus est BRUYANT et nommé : une écriture silencieusement tronquée
    -- ferait croire à un battement reçu alors que la base porte autre chose.
    IF char_length(v_station_id) < 8 OR char_length(v_station_id) > 64 THEN
        RAISE EXCEPTION 'station_id invalide : longueur % hors bornes (8..64)', char_length(v_station_id)
            USING ERRCODE = 'check_violation';
    END IF;
    IF char_length(v_app_version) < 1 OR char_length(v_app_version) > 32 THEN
        RAISE EXCEPTION 'app_version invalide : longueur % hors bornes (1..32)', char_length(v_app_version)
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_os_version IS NOT NULL AND char_length(v_os_version) > 32 THEN
        RAISE EXCEPTION 'os_version invalide : longueur % hors bornes (0..32)', char_length(v_os_version)
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_last_check NOT IN ('ok', 'feed-absent', 'html', 'unreachable') THEN
        RAISE EXCEPTION 'last_check invalide : « % » n''est pas un état connu', v_last_check
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_last_check_version IS NOT NULL AND char_length(v_last_check_version) > 32 THEN
        RAISE EXCEPTION 'last_check_version invalide : longueur % hors bornes (0..32)', char_length(v_last_check_version)
            USING ERRCODE = 'check_violation';
    END IF;

    -- Une ligne par poste, et le battement REMPLACE : `seen_at` avance à chaque
    -- appel (c'est lui qui décide du silence dans le relevé), et l'historique
    -- n'est pas conservé — ce relevé dit l'état du parc AUJOURD'HUI, pas son
    -- passé.
    INSERT INTO public.station_versions (
        station_id, app_version, os_version, last_check, last_check_version, seen_at
    )
    VALUES (
        v_station_id, v_app_version, v_os_version, v_last_check, v_last_check_version,
        timezone('utc'::text, now())
    )
    ON CONFLICT (station_id) DO UPDATE SET
        app_version = excluded.app_version,
        os_version = excluded.os_version,
        last_check = excluded.last_check,
        last_check_version = excluded.last_check_version,
        seen_at = excluded.seen_at;
END;
$$;

COMMENT ON FUNCTION public.record_station_beat(TEXT, TEXT, TEXT, TEXT, TEXT) IS
    'Le battement d''un poste (§7 du canal) : le seul chemin d''écriture de station_versions, ouvert à `anon` et à lui seul. Le privilège UPDATE sur la table n''existe pour personne : c''est cette fonction qui remplace la ligne du poste.';

-- Supabase accorde EXECUTE à `anon` ET `public` par défaut sur une fonction
-- neuve : on retire les deux, puis on rend le geste au SEUL `anon` — c'est la
-- même discipline que les migrations de 2026-09 et 2026-10 ont posée dans
-- l'autre sens (retirer `anon` d'un RPC d'administration).
REVOKE ALL ON FUNCTION public.record_station_beat(TEXT, TEXT, TEXT, TEXT, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.record_station_beat(TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_station_beat(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon;

-- ============================================================================
-- MIGRATION : 20261019000000_display_preferences.sql
-- ============================================================================

-- ============================================================================
-- MAMA THERA Finance Suite — Les préférences d'affichage voyagent en base
-- ============================================================================
-- Le thème, la densité des tableaux, le verre des icônes et la langue vivaient
-- dans le `localStorage` du poste, et NULLE PART ailleurs. Conséquence mesurée
-- le 2026-10-14 : un poste réinstallé — Windows refait, navigateur vidé, machine
-- neuve — repartait aux défauts, alors que la sauvegarde de la base, elle, se
-- restaure. Les quatre réglages deviennent donc des LIGNES d'`app_settings` :
-- cette table est déjà sauvée et déjà restaurée (`scripts/lib/db-tables.mjs`,
-- `npm run backup:db` / `restore:db`), donc rien de neuf n'a à voyager — les
-- préférences voyagent parce qu'elles sont des données comme les autres.
--
-- POURQUOI DES POLITIQUES EN PLUS, jamais une politique élargie :
-- `app_settings_write` / `app_settings_update` réservent l'écriture à
-- `is_admin()`, et c'est juste — `app_settings` est le magasin des réglages
-- d'ÉQUIPE. Élargir CES politiques ouvrirait la table entière : n'importe quel
-- compte écrirait n'importe quelle clé, y compris celles qui n'existent pas
-- encore. En RLS, deux politiques permissives de même (table, commande)
-- s'ADDITIONNENT : les deux politiques ci-dessous n'ouvrent donc QUE les quatre
-- clés de préférences, et l'administration reste seule au-dessus.
--
-- QUI écrit, et pourquoi ce n'est pas un droit d'administration : ces quatre
-- réglages sont ceux d'un ÉCRAN (densité pour une tablette de classe, verre pour
-- un vidéoprojecteur, langue pour le poste du guichet), pas d'une décision
-- comptable. La personne devant le poste est celle qui sait. Elle peut donc les
-- enregistrer, avec ou sans le rôle d'administration — et le journal d'audit
-- garde qui l'a fait.
--
-- POURQUOI AUCUN ENSEMENCEMENT : les quatre clés n'existent qu'à partir du
-- moment où l'école a réellement changé quelque chose. Ensemencer des valeurs
-- recopierait en SQL les constantes du code (`DEFAULT_THEME`, `DEFAULT_DENSITY`,
-- `DEFAULT_ICON_GLASS`, « fr ») — deux vérités à tenir d'accord, ce que ce dépôt
-- refuse partout ailleurs. Une clé ABSENTE veut donc dire « personne n'a jamais
-- choisi », et le poste garde ses défauts compilés : c'est exactement l'état
-- d'une école qui n'a rien réglé.
--
-- CE QUE LA RESTAURATION EN FAIT, et le piège qu'elle évite : `updated_by` reste
-- NUL pour ces lignes. La colonne existe, mais `restorableRows` (une seule
-- écriture de la règle, `scripts/lib/db-tables.mjs`) écarte toute ligne dont le
-- compte n'existe pas dans la cible — car les empreintes de `auth.users` ne
-- voyagent pas. Nommer un compte ici rendrait donc les préférences NON
-- RESTAURABLES dans une cible fraîche, c'est-à-dire exactement le jour où on en
-- a besoin. L'attribution vit dans `audit_logs`, qui, lui, est restaurable.
-- ============================================================================

-- ─── 1. Les quatre clés : une forme tenue par la base, pas par la politesse ──
-- Une préférence est une CHAÎNE (« animated », « compact », « fr ») : la
-- contrainte le dit une fois pour toutes, et la lecture côté app peut alors
-- valider une valeur au lieu de deviner ce que le JSONB contenait.

ALTER TABLE public.app_settings
    DROP CONSTRAINT IF EXISTS app_settings_display_keys_check;

ALTER TABLE public.app_settings
    ADD CONSTRAINT app_settings_display_keys_check CHECK (
        key NOT IN ('display.theme', 'display.density', 'display.icon_glass', 'display.language')
        OR jsonb_typeof(value) = 'string'
    );

-- ─── 2. Les privilèges de table ──────────────────────────────────────────────
-- Les politiques ouvrent des LIGNES ; le privilège ouvre la TABLE. Les deux
-- doivent être d'accord (l'écriture d'un réglage passait déjà par une politique
-- d'administration : le privilège existait, il est ici écrit au lieu d'être
-- supposé).

GRANT SELECT, INSERT, UPDATE ON public.app_settings TO authenticated;

-- ─── 3. L'écriture des quatre clés, pour tout compte connecté ────────────────
-- Ces deux politiques n'ajoutent rien aux lignes que la table porte : elles
-- disent QUI peut écrire CES clés-là. Un `key` hors de la liste laisse la
-- demande aux politiques d'administration, qui refusent tout autre compte —
-- la clé est donc bornée deux fois : par le `WITH CHECK` et par le `CHECK` de
-- table ajouté plus haut.

DROP POLICY IF EXISTS "app_settings_display_insert" ON public.app_settings;
CREATE POLICY "app_settings_display_insert"
    ON public.app_settings
    FOR INSERT
    TO authenticated
    WITH CHECK (key IN ('display.theme', 'display.density', 'display.icon_glass', 'display.language'));

DROP POLICY IF EXISTS "app_settings_display_update" ON public.app_settings;
CREATE POLICY "app_settings_display_update"
    ON public.app_settings
    FOR UPDATE
    TO authenticated
    USING (key IN ('display.theme', 'display.density', 'display.icon_glass', 'display.language'))
    WITH CHECK (key IN ('display.theme', 'display.density', 'display.icon_glass', 'display.language'));

-- Lecture : rien à ajouter. `app_settings_read` ouvre déjà `SELECT` à tout
-- compte connecté, et c'est la même lecture qui sert au poste neuf — adopter la
-- préférence d'école demande de la LIRE, pas d'être administrateur.

-- ============================================================================
-- MIGRATION : 20261020000000_econome_payment_history.sql
-- ============================================================================

-- Migration: l'économe LIT l'historique des paiements — et RIEN d'autre du journal.
--
-- ─── Le défaut, mesuré le 2026-10-15 ────────────────────────────────────────
-- Demande du propriétaire : « l'économe doit avoir accès à l'historique des
-- paiements » — constaté par lui : la ligne ne s'affiche pas dans le rail. La
-- cause n'est pas dans le rail : `audit_logs` n'est lisible que par `admin`/`dev`
-- (policy « Admins can view audit logs », 20260814000000), et l'historique des
-- paiements se LIT dans ce journal — c'est le seul endroit du dépôt qui nomme
-- l'encaisseur (`payments` ne porte ni auteur, ni nom : mesuré le 2026-10-06).
-- Ouvrir l'onglet sans la lecture aurait affiché « rien encaissé » sur une caisse
-- pleine — un mensonge, pas un écran vide.
--
-- ─── La décision (propriétaire, 2026-10-15) ─────────────────────────────────
-- L'économe lit les GESTES DE CAISSE et les CORRECTIONS D'ARGENT — exactement ce
-- que l'écran affiche — et rien d'autre du journal : ni les changements de rôle,
-- ni les suppressions d'élèves, ni les réglages. `audit_logs` reste donc fermé à
-- son rôle, et c'est une policy SUPPLÉMENTAIRE, filtrée par ACTION, qui lui ouvre
-- les sept lignes dont cet écran est fait :
--   • les trois gestes de caisse (`PAYMENT_HISTORY_ACTIONS`, src/lib/paymentHistory.ts) ;
--   • les quatre gestes de correction (`CORRECTION_HISTORY_ACTIONS`,
--     src/lib/correctionHistory.ts), qui composent le bloc « gestes de correction »
--     du MÊME écran — un bloc vide se lirait « rien n'a été retiré du registre ».
-- Les deux listes restent écrites dans l'application, à côté de l'écran qui les
-- montre, et `tests/payment-history-rights.test.ts` exige que leur UNION soit la
-- liste de cette policy : l'économe voit les lignes de son écran, pas une de plus.
--
-- ─── Pourquoi une policy filtrée, et pas une vue ni une fonction de lecture ──
-- Parce que les policies permissives s'ADDITIONNENT : la lecture entière des deux
-- autres rôles ne bouge pas d'une ligne, et l'application ne porte AUCUN second
-- chemin de lecture — `fetchAuditLogs` et `fetchAuditJournalRange` continuent de
-- lire la même table, et c'est la base qui rend à l'économe les lignes de son
-- écran. La RLS FILTRE les lignes, elle ne refuse pas la requête : il n'y a donc
-- pas d'erreur à interpréter, ni d'écran vide à expliquer.
--
-- ─── Ce que la fonction laisse passer, comme ses sœurs ──────────────────────
-- `public.is_payment_history_viewer()` n'est pas restreinte, exactement comme
-- `is_admin()`, `is_payment_deleter()`, `is_payment_month_editor()`,
-- `is_finance_writer()` et `is_payroll_writer()` : elle ne lit que le rôle de
-- l'appelant et ne rend vrai que pour lui. Aucun droit d'EXÉCUTION n'est donc à
-- retirer (la leçon du 2026-09-06 — `ALTER DEFAULT PRIVILEGES` donne à `anon` un
-- EXECUTE direct sur toute fonction créée — vaut pour les fonctions qui FONT
-- quelque chose, comme `set_payment_months` ou `admin_set_user_password`).
--
-- ─── Mesuré APRÈS application, sur la base de l'école (2026-10-15) ──────────
-- Sonde `pg` en transactions ANNULÉES, `SET LOCAL ROLE authenticated` **et** les
-- deux claims JWT — l'impersonation se prouve (auth.uid() relu, non nul) : le
-- journal portait 770 entrées, dont 104 gestes de caisse et 666 autres
-- (510 ADD_STUDENT, 124 UPDATE_STUDENT, …). Résultat : `admin`/`dev` lisent les
-- 770 (leur garde d'avant, inchangée), **l'économe en lit 104 — exactement les
-- gestes de caisse (RECORD_PAYMENT 102, DELETE_PAYMENT 2) et RIEN d'autre**,
-- `general_manager` 0, un compte connecté sans profil 0, `anon` 0.
--
-- ─── Ce que la policy ne fait PAS ───────────────────────────────────────────
-- Elle n'ouvre aucune ÉCRITURE : le journal reste en insertion seule pour tout
-- compte connecté (policy d'INSERT d'origine), et la suppression d'un reçu
-- (`is_payment_deleter()`) comme la correction des mois (`set_payment_months()`)
-- sont déjà décidées ailleurs. Lire une ligne du journal n'a jamais été un droit
-- d'écriture.

-- ─── Helper: qui peut LIRE l'historique des paiements ───────────────────────
CREATE OR REPLACE FUNCTION public.is_payment_history_viewer()
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

-- ─── La lecture BORNÉE : les gestes de caisse et les corrections, rien d'autre ─
-- `DROP POLICY IF EXISTS` avant le CREATE : la migration doit pouvoir être rejouée
-- (elle est idempotente comme ses voisines, et `db:apply` refuse un ajout déjà
-- présent plutôt que de le doubler).
--
-- Les sept gestes, dans l'ordre de l'écran — les trois de la caisse
-- (`PAYMENT_HISTORY_ACTIONS`) puis les quatre corrections
-- (`CORRECTION_HISTORY_ACTIONS`). Ce commentaire est HORS de l'expression, et
-- c'est une mesure, pas une coquetterie : `check-rls-policies` compare les JETONS
-- de la condition déclarée à ceux du catalogue, et la prose écrite DANS le
-- `USING (…)` ajoutait ses mots aux jetons — la politique apparaissait alors
-- « CHANGÉE » alors que la base appliquait exactement la règle écrite ici.
DROP POLICY IF EXISTS "Payment history viewers read payment gestures" ON public.audit_logs;
CREATE POLICY "Payment history viewers read payment gestures"
    ON public.audit_logs
    FOR SELECT
    TO authenticated
    USING (
        public.is_payment_history_viewer()
        AND action IN (
            'RECORD_PAYMENT',
            'DELETE_PAYMENT',
            'RESTORE_PAYMENT',
            'DELETE_SALARY_PAYMENT',
            'RESTORE_SALARY_PAYMENT',
            'DELETE_EXPENSE',
            'DELETE_VENDOR_EXPENSE'
        )
    );

-- ─── PostgREST schema cache reload ──────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- MIGRATION : 20261021000000_station_install_mode.sql
-- ============================================================================

-- ============================================================================
-- MAMA THERA Finance Suite — LA TRACE DES CONVERSIONS PORTABLE → INSTALLÉ
-- ============================================================================
-- Spécification : docs/CANAL_MISE_A_JOUR.md §7 (« Battement de version »).
--
-- ─── Pourquoi cette migration existe ───────────────────────────────────────
-- Depuis le 2026-10-16, un poste PORTABLE n'est plus condamné à rester en
-- arrière : il télécharge l'installeur annoncé, l'exécute en silencieux et
-- devient un poste INSTALLÉ, qui se met à jour tout seul ensuite (voir
-- `electron/updater-policy.cjs`, `PORTABLE_INSTALL_ARGS`). Le geste est décidé,
-- testé, justifié — mais RIEN ne disait qu'il avait eu lieu. Le relevé du parc
-- (§7) portait la version et l'état du dernier contrôle, jamais la FORME du
-- poste : une école dont le poste restait portable était indiscernable d'une
-- école dont le poste s'était converti, et « le parc s'est converti » serait
-- resté une espérance — exactement ce que la section 7 a été écrite pour
-- supprimer. C'est la même leçon que la section 6 : un fait qui n'est pas relevé
-- se prouve poste par poste, c'est-à-dire ne se prouve pas.
--
-- ─── Ce que la conversion EST, et ce qu'elle n'est pas ─────────────────────
-- Deux faits DISTINCTS, et ils sont rangés séparément :
--   • `install_mode` — ce que le poste DIT de lui-même à son dernier battement :
--     `portable` ou `installed`, ou NULL quand il ne le MESURE pas (une
--     application non empaquetée n'a pas de forme à déclarer) ;
--   • `converted_at` / `converted_to_version` — la PREMIÈRE conversion
--     portable → installé OBSERVÉE sur cette ligne, horodatée par la BASE et
--     jamais effacée : c'est la trace, et elle survit à une réinstallation comme
--     à un poste qui redémarrerait un jour sous sa forme portable (le fait a eu
--     lieu ; l'effacer serait réécrire l'histoire).
-- Le mode COURANT et la trace ne disent donc pas la même chose, et les confondre
-- — lire « install_mode = portable » comme « ne s'est jamais converti » —
-- perdrait précisément le cas qu'on veut constater.
--
-- ─── La transition est reconnue DANS la fonction, et pourquoi ──────────────
-- Le relevé ne conserve aucune histoire : une ligne par poste, remplacée à
-- chaque battement (migration du 2026-10-18). Une transition ne peut donc être
-- vue qu'au moment où elle arrive, en comparant la ligne EN PLACE à ce qui
-- arrive — le seul instant où l'ancienne et la nouvelle valeur existent
-- ensemble. C'est pourquoi la reconnaissance vit dans l'instruction d'écriture
-- elle-même (`ON CONFLICT … DO UPDATE`, dont les expressions lisent la ligne
-- d'AVANT), et non dans une lecture préalable : aucune course n'est possible
-- entre ce qui serait lu et ce qui serait écrit.
--
-- Le sens compte : `portable` → `installed`, et lui seul. L'inverse (relancer
-- l'exe portable sur une machine installée) n'est pas une conversion mais un
-- retour en arrière ; il ne produit aucune trace, et le mode du jour, lui, dit
-- la vérité.
--
-- ─── La signature change, donc l'ancienne fonction est RETIRÉE ─────────────
-- Postgres identifie une fonction par (nom, liste des types d'arguments) : un
-- `CREATE OR REPLACE` avec un argument de plus ne remplace RIEN, il AJOUTE une
-- surcharge. Deux surcharges rendraient ambigu l'appel d'un poste resté sur la
-- version en service (cinq arguments nommés, que les deux candidates acceptent
-- grâce à leurs défauts) — et un poste qui n'arrive plus à battre est la panne
-- silencieuse même que la section 7 existe pour supprimer. L'ancienne signature
-- est donc retirée explicitement, et la nouvelle porte
-- `p_install_mode TEXT DEFAULT NULL` pour que les postes déjà équipés
-- continuent de battre sans rien changer.
--
-- Les bornes et les GRANT de la version précédente sont repris À L'IDENTIQUE :
-- cette migration change la forme du battement, jamais qui peut battre.
-- ============================================================================

-- ─── Les trois colonnes, et leurs bornes NOMMÉES ───────────────────────────
-- L'énumération est contrainte ici comme `last_check` l'est : un mode libre
-- rendrait la répartition fausse sans que personne ne s'en aperçoive, et c'est
-- exactement la lecture qu'on vient chercher dans ce relevé.
ALTER TABLE public.station_versions
    ADD COLUMN IF NOT EXISTS install_mode TEXT;

ALTER TABLE public.station_versions
    ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;

ALTER TABLE public.station_versions
    ADD COLUMN IF NOT EXISTS converted_to_version TEXT;

ALTER TABLE public.station_versions
    DROP CONSTRAINT IF EXISTS station_versions_install_mode_enum;
ALTER TABLE public.station_versions
    ADD CONSTRAINT station_versions_install_mode_enum
    CHECK (install_mode IS NULL OR install_mode IN ('portable', 'installed'));

-- La version à laquelle la conversion a été observée : bornée comme
-- `app_version`, parce que c'est la même chose vue au moment du basculement.
ALTER TABLE public.station_versions
    DROP CONSTRAINT IF EXISTS station_versions_converted_to_version_bounds;
ALTER TABLE public.station_versions
    ADD CONSTRAINT station_versions_converted_to_version_bounds
    CHECK (converted_to_version IS NULL OR char_length(converted_to_version) BETWEEN 1 AND 32);

COMMENT ON COLUMN public.station_versions.install_mode IS
    'Forme du poste telle qu''il la DÉCLARE (portable / installed). NULL = pas mesurée (application non empaquetée, ou poste pas encore à jour de ce champ) — jamais devinée.';
COMMENT ON COLUMN public.station_versions.converted_at IS
    'Horodatage (posé par la BASE) de la PREMIÈRE conversion portable → installé observée sur ce poste. Jamais effacé : la colonne dit un fait, pas l''état du jour.';
COMMENT ON COLUMN public.station_versions.converted_to_version IS
    'La version que le poste exécutait au battement qui a porté la conversion (celle du passage, pas la version du jour).';

-- ─── Le geste, remplacé — et l'ancienne signature retirée ──────────────────
DROP FUNCTION IF EXISTS public.record_station_beat(TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.record_station_beat(
    p_station_id TEXT,
    p_app_version TEXT,
    p_os_version TEXT DEFAULT NULL,
    p_last_check TEXT DEFAULT 'ok',
    p_last_check_version TEXT DEFAULT NULL,
    p_install_mode TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_station_id TEXT := btrim(coalesce(p_station_id, ''));
    v_app_version TEXT := btrim(coalesce(p_app_version, ''));
    v_os_version TEXT := nullif(btrim(coalesce(p_os_version, '')), '');
    v_last_check TEXT := btrim(coalesce(p_last_check, 'ok'));
    v_last_check_version TEXT := nullif(btrim(coalesce(p_last_check_version, '')), '');
    v_install_mode TEXT := nullif(btrim(coalesce(p_install_mode, '')), '');
BEGIN
    -- Le refus est BRUYANT et nommé : une écriture silencieusement tronquée
    -- ferait croire à un battement reçu alors que la base porte autre chose.
    IF char_length(v_station_id) < 8 OR char_length(v_station_id) > 64 THEN
        RAISE EXCEPTION 'station_id invalide : longueur % hors bornes (8..64)', char_length(v_station_id)
            USING ERRCODE = 'check_violation';
    END IF;
    IF char_length(v_app_version) < 1 OR char_length(v_app_version) > 32 THEN
        RAISE EXCEPTION 'app_version invalide : longueur % hors bornes (1..32)', char_length(v_app_version)
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_os_version IS NOT NULL AND char_length(v_os_version) > 32 THEN
        RAISE EXCEPTION 'os_version invalide : longueur % hors bornes (0..32)', char_length(v_os_version)
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_last_check NOT IN ('ok', 'feed-absent', 'html', 'unreachable') THEN
        RAISE EXCEPTION 'last_check invalide : « % » n''est pas un état connu', v_last_check
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_last_check_version IS NOT NULL AND char_length(v_last_check_version) > 32 THEN
        RAISE EXCEPTION 'last_check_version invalide : longueur % hors bornes (0..32)', char_length(v_last_check_version)
            USING ERRCODE = 'check_violation';
    END IF;
    -- Une forme inventée est refusée par la base, comme les quatre états du
    -- contrôle : `NULL` veut dire « pas mesurée », jamais « autre chose ».
    IF v_install_mode IS NOT NULL AND v_install_mode NOT IN ('portable', 'installed') THEN
        RAISE EXCEPTION 'install_mode invalide : « % » n''est pas une forme connue (portable, installed)', v_install_mode
            USING ERRCODE = 'check_violation';
    END IF;

    -- Une ligne par poste, et le battement REMPLACE : `seen_at` avance à chaque
    -- appel (c'est lui qui décide du silence dans le relevé), et l'historique
    -- n'est pas conservé — sauf la trace de la conversion ci-dessous, qui est le
    -- seul fait de ce relevé qui parle du PASSÉ plutôt que du jour.
    INSERT INTO public.station_versions (
        station_id, app_version, os_version, last_check, last_check_version,
        install_mode, seen_at
    )
    VALUES (
        v_station_id, v_app_version, v_os_version, v_last_check, v_last_check_version,
        v_install_mode, timezone('utc'::text, now())
    )
    ON CONFLICT (station_id) DO UPDATE SET
        app_version = excluded.app_version,
        os_version = excluded.os_version,
        last_check = excluded.last_check,
        last_check_version = excluded.last_check_version,
        -- Un battement qui ne MESURE pas la forme n'efface pas celle mesurée
        -- avant : un poste ne cesse pas d'avoir une forme parce qu'il s'est tu
        -- sur elle (poste resté sur une version qui ne l'envoie pas encore).
        install_mode = COALESCE(excluded.install_mode, station_versions.install_mode),
        -- La PREMIÈRE conversion observée, et elle seule : `COALESCE` garde la
        -- date déjà inscrite, donc une seconde lecture de la même transition
        -- (et la suivante, si le poste repassait par le portable) ne la déplace
        -- pas. `excluded.seen_at` est l'horodatage du battement qui a porté la
        -- transition — posé par la base, jamais par l'horloge du poste.
        converted_at = CASE
            WHEN station_versions.install_mode = 'portable'
             AND excluded.install_mode = 'installed'
                THEN COALESCE(station_versions.converted_at, excluded.seen_at)
            ELSE station_versions.converted_at
        END,
        converted_to_version = CASE
            WHEN station_versions.install_mode = 'portable'
             AND excluded.install_mode = 'installed'
                THEN COALESCE(station_versions.converted_to_version, excluded.app_version)
            ELSE station_versions.converted_to_version
        END,
        seen_at = excluded.seen_at;
END;
$$;

COMMENT ON FUNCTION public.record_station_beat(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
    'Le battement d''un poste (§7 du canal) : le seul chemin d''écriture de station_versions, ouvert à `anon` et à lui seul. Le privilège UPDATE sur la table n''existe pour personne : c''est cette fonction qui remplace la ligne du poste — et qui y inscrit la première conversion portable → installé observée.';

-- Supabase accorde EXECUTE à `anon` ET `public` par défaut sur une fonction
-- neuve : on retire les deux, puis on rend le geste au SEUL `anon`. Le `DROP`
-- ci-dessus a emporté le GRANT de la version précédente avec la fonction, donc
-- ces trois instructions sont la seule raison pour laquelle le parc continue de
-- pouvoir battre : les tenir ici, c'est tenir la seule écriture anonyme de
-- l'application.
REVOKE ALL ON FUNCTION public.record_station_beat(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.record_station_beat(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_station_beat(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon;

-- ============================================================================
-- MIGRATION : 20261022000000_school_name.sql
-- ============================================================================

-- ============================================================================
-- MAMA THERA Finance Suite — LE NOM DE L'ÉCOLE, écrit une fois pour tout le parc
-- ============================================================================
-- Demande du propriétaire (2026-10-16) : « Ajoute un réglage “nom de l'école”
-- (app_settings, écran, droits, RLS) et fais-le porter par les remontées du poste
-- à côté du nom de la machine. »
--
-- ─── Pourquoi une ligne d'`app_settings`, et pas un réglage d'écran ──────────
-- Le nom de l'école n'est PAS une préférence de poste : c'est un fait de
-- l'ÉTABLISSEMENT. La densité d'un tableau se règle devant une tablette de
-- classe, et chaque poste peut vouloir autre chose ; le nom de l'école, non — il
-- est le même partout, y compris sur une remontée qui arrive du poste d'une
-- autre salle. Il vit donc dans `app_settings`, la table que
-- `scripts/lib/db-tables.mjs` sauvegarde et que `npm run restore:db` restaure :
-- il voyage avec la sauvegarde de l'école parce qu'il est une donnée de l'école.
--
-- ─── Pourquoi AUCUNE politique nouvelle n'est ajoutée ───────────────────────
-- `app_settings_write` / `app_settings_update` réservent déjà l'écriture à
-- `public.is_admin()` (`20260902000005_team_inactivity_setting.sql`), et c'est
-- exactement le droit qu'un nom d'école demande : un fait d'établissement se
-- déclare à l'administration. La migration
-- `20261019000000_display_preferences.sql` a ouvert, elle, deux politiques
-- bornées aux quatre clés `display.` — celles-là sont des réglages d'ÉCRAN, la
-- personne devant le poste sait mieux que quiconque, et l'écart est assumé. Les
-- recopier ici aurait ouvert le nom de l'école à tout compte connecté, ce qui
-- n'est pas la décision : l'écran des Paramètres est déjà réservé à
-- l'administration (`SettingsView`), donc la base et l'écran disent la même
-- chose sans qu'une politique soit ajoutée. Ce fichier ne change QUE la FORME de
-- la valeur.
--
-- ─── La forme de la valeur, et pourquoi elle est contrainte ici ─────────────
-- Une CHAÎNE, de 2 à 120 caractères — les bornes du contrat de l'app
-- (`src/lib/schoolName.ts`, qui refuse en plus le séparateur des rapports de
-- poste). La contrainte est posée en base pour la même raison que les quatre
-- clés d'affichage : une écriture peut arriver par un autre chemin que l'écran
-- (un script, un `curl` avec un compte d'administration), et une valeur non
-- textuelle se lirait plus loin comme un nombre ou un objet au lieu d'un nom.
-- L'app est plus STRICTE que la base, jamais plus large : ce qu'elle accepte est
-- toujours accepté ici.
--
-- ─── Pourquoi la borne est écrite ÉCLATÉE, et non en `BETWEEN` ─────────────
-- La forme naturelle serait `char_length(value #>> '{}') BETWEEN 2 AND 120`.
-- Elle a été écrite, appliquée, puis MESURÉE : `npm run check:db-objects` l'a
-- signalée comme une dérive (« la base dit autre chose ») — non parce que la
-- règle différait, mais parce que le catalogue rend l'idiome éclaté avec son
-- opérande RÉPÉTÉ (`(char_length((value #>> '{}'::text[])) >= 2) AND (…) <= 120`),
-- et que la comparaison ne réduit QUE les bornes SIMPLES (littéral, nombre) : une
-- borne composée reste intacte, DÉLIBÉRÉMENT, pour qu'une vraie différence soit
-- signalée plutôt que blanchie (`tests/db-objects.test.ts` verrouille ce refus —
-- « une borne COMPOSÉE n'est pas blanchie »). Ici l'opérande contient `#>> '{}'`,
-- donc composé. Le fichier écrit donc la règle telle que le catalogue la rend :
-- c'est la MÊME règle, dans l'autre écriture, et le contrôle le vérifie sans
-- qu'aucune tolérance soit ajoutée au contrôle — ce qui aurait été une décision
-- sur l'équilibre du contrôle, pas sur le nom de l'école.
--
-- ─── Ce que la restauration en fait ────────────────────────────────────────
-- `updated_by` reste NUL quand l'app écrit cette ligne, même raison que les
-- préférences d'affichage : `restorableRows` (`scripts/lib/db-tables.mjs`) écarte
-- toute ligne dont le compte n'existe pas dans la cible, et les empreintes de
-- `auth.users` ne voyagent pas. Nommer un compte ici rendrait le nom de l'école
-- NON RESTAURABLE dans une cible fraîche — c'est-à-dire exactement le jour où on
-- en a besoin. Qui l'a changé vit dans `audit_logs`, qui, lui, se restaure.
--
-- ─── Ce que cette migration NE fait PAS, et c'est dit ──────────────────────
-- Aucun ensemencement : une école qui n'a jamais écrit son nom n'en a pas de
-- ligne, et l'app le dit (`null` = personne ne l'a déclaré) au lieu d'afficher
-- en dur un nom qui ne serait celui d'aucune école. Inventer un nom par défaut
-- recopierait dans le SQL une constante de l'application — deux vérités à tenir
-- d'accord, ce que ce dépôt refuse partout ailleurs.
-- ============================================================================

ALTER TABLE public.app_settings
    DROP CONSTRAINT IF EXISTS app_settings_school_name_check;

ALTER TABLE public.app_settings
    ADD CONSTRAINT app_settings_school_name_check CHECK (
        key <> 'school.name'
        OR (
            jsonb_typeof(value) = 'string'
            AND char_length(value #>> '{}') >= 2
            AND char_length(value #>> '{}') <= 120
        )
    );

COMMENT ON CONSTRAINT app_settings_school_name_check ON public.app_settings IS
    'Le nom de l''école (clé school.name) est une CHAÎNE de 2 à 120 caractères. Les bornes sont celles du contrat de l''app (src/lib/schoolName.ts) : une écriture qui passerait à côté de l''écran est refusée ici plutôt que de se lire plus loin comme autre chose qu''un nom.';
