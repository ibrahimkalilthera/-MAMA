-- ============================================================================
-- COMPLEXE SCOLAIRE MAMA THERA — COMPLETE SUPABASE DATABASE SETUP SCRIPT
-- ============================================================================
-- Run this script in your Supabase Dashboard -> SQL Editor -> Run
-- It creates all tables, functions, triggers, indexes, and RLS policies.
-- ============================================================================

-- Enable required extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── 1. CORE TABLES ─────────────────────────────────────────────────────────

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

-- Audit Logs Table
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

-- Academic Years Table
CREATE TABLE IF NOT EXISTS public.academic_years (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    year_name TEXT NOT NULL UNIQUE,
    start_date DATE,
    end_date DATE,
    is_current BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- User Profiles Table (Linked to auth.users)
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT NOT NULL DEFAULT 'New User',
    role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff', 'dev')),
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Shared custom classes used by all authenticated school users
CREATE TABLE IF NOT EXISTS public.custom_grades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE UNIQUE INDEX IF NOT EXISTS custom_grades_name_lower_unique
    ON public.custom_grades (lower(name));

-- ─── 2. INDEXES ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_students_academic_year ON public.students(academic_year);
CREATE INDEX IF NOT EXISTS idx_payments_academic_year ON public.payments(academic_year);
CREATE INDEX IF NOT EXISTS idx_expenses_academic_year ON public.expenses(academic_year);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs (created_at DESC);

-- ─── 3. FUNCTIONS & TRIGGERS ────────────────────────────────────────────────

-- Auto-create user profile when a new user registers in Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.user_profiles (id, email, full_name, role)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'), 'staff');
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Is Admin helper function
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.user_profiles 
        WHERE id = auth.uid() AND role IN ('admin', 'dev')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ─── 4. ROW LEVEL SECURITY (RLS) LOCKDOWN ────────────────────────────────────

ALTER TABLE public.parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_grades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read custom grades" ON public.custom_grades;
CREATE POLICY "Authenticated read custom grades" ON public.custom_grades FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated insert custom grades" ON public.custom_grades;
CREATE POLICY "Authenticated insert custom grades" ON public.custom_grades FOR INSERT TO authenticated WITH CHECK (true);

-- Explicit API privileges for the authenticated role.
GRANT SELECT, INSERT ON public.custom_grades TO authenticated;

-- User Profiles Policies
DROP POLICY IF EXISTS "Users can read own profile or admin reads all" ON public.user_profiles;
CREATE POLICY "Users can read own profile or admin reads all" ON public.user_profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Admin can update profiles" ON public.user_profiles;
CREATE POLICY "Admin can update profiles" ON public.user_profiles FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Parents Policies
DROP POLICY IF EXISTS "Authenticated users can read parents" ON public.parents;
CREATE POLICY "Authenticated users can read parents" ON public.parents FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can insert parents" ON public.parents;
CREATE POLICY "Authenticated users can insert parents" ON public.parents FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated users can update parents" ON public.parents;
CREATE POLICY "Authenticated users can update parents" ON public.parents FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Admin can delete parents" ON public.parents;
CREATE POLICY "Admin can delete parents" ON public.parents FOR DELETE TO authenticated USING (public.is_admin());

-- Students Policies
DROP POLICY IF EXISTS "Authenticated users can read students" ON public.students;
CREATE POLICY "Authenticated users can read students" ON public.students FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can insert students" ON public.students;
CREATE POLICY "Authenticated users can insert students" ON public.students FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated users can update students" ON public.students;
CREATE POLICY "Authenticated users can update students" ON public.students FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Admin can delete students" ON public.students;
CREATE POLICY "Admin can delete students" ON public.students FOR DELETE TO authenticated USING (public.is_admin());

-- Payments Policies
DROP POLICY IF EXISTS "Authenticated users can read payments" ON public.payments;
CREATE POLICY "Authenticated users can read payments" ON public.payments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can insert payments" ON public.payments;
CREATE POLICY "Authenticated users can insert payments" ON public.payments FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated users can update payments" ON public.payments;
CREATE POLICY "Authenticated users can update payments" ON public.payments FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Admin can delete payments" ON public.payments;
CREATE POLICY "Admin can delete payments" ON public.payments FOR DELETE TO authenticated USING (public.is_admin());

-- Staff & Salary Policies
DROP POLICY IF EXISTS "Authenticated users can read staff" ON public.staff;
CREATE POLICY "Authenticated users can read staff" ON public.staff FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admin can insert staff" ON public.staff;
CREATE POLICY "Admin can insert staff" ON public.staff FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Admin can update staff" ON public.staff;
CREATE POLICY "Admin can update staff" ON public.staff FOR UPDATE TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS "Admin can delete staff" ON public.staff;
CREATE POLICY "Admin can delete staff" ON public.staff FOR DELETE TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Authenticated users can read salary_payments" ON public.salary_payments;
CREATE POLICY "Authenticated users can read salary_payments" ON public.salary_payments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admin can insert salary_payments" ON public.salary_payments;
CREATE POLICY "Admin can insert salary_payments" ON public.salary_payments FOR INSERT TO authenticated WITH CHECK (public.is_admin());

-- Expenses Policies
DROP POLICY IF EXISTS "Authenticated users can read expenses" ON public.expenses;
CREATE POLICY "Authenticated users can read expenses" ON public.expenses FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can insert expenses" ON public.expenses;
CREATE POLICY "Authenticated users can insert expenses" ON public.expenses FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Authenticated users can update expenses" ON public.expenses;
CREATE POLICY "Authenticated users can update expenses" ON public.expenses FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Admin can delete expenses" ON public.expenses;
CREATE POLICY "Admin can delete expenses" ON public.expenses FOR DELETE TO authenticated USING (public.is_admin());

-- Vendor Expenses Policies
DROP POLICY IF EXISTS "Authenticated users can read vendor_expenses" ON public.vendor_expenses;
CREATE POLICY "Authenticated users can read vendor_expenses" ON public.vendor_expenses FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can insert vendor_expenses" ON public.vendor_expenses;
CREATE POLICY "Promoter can insert vendor_expenses" ON public.vendor_expenses FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Authenticated users can update vendor_expenses" ON public.vendor_expenses;
CREATE POLICY "Authenticated users can update vendor_expenses" ON public.vendor_expenses FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Admin can delete vendor_expenses" ON public.vendor_expenses;
CREATE POLICY "Promoter can delete vendor_expenses" ON public.vendor_expenses FOR DELETE TO authenticated USING (public.is_admin());

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

-- Todos Policies
DROP POLICY IF EXISTS "Authenticated users can manage todos" ON public.todos;
CREATE POLICY "Authenticated users can manage todos" ON public.todos FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Audit Logs Policies
DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON public.audit_logs;
CREATE POLICY "Authenticated users can insert audit logs" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Admins can view audit logs" ON public.audit_logs;
CREATE POLICY "Admins can view audit logs" ON public.audit_logs FOR SELECT TO authenticated USING (public.is_admin());

-- Academic Years Policies
DROP POLICY IF EXISTS "Authenticated read academic_years" ON public.academic_years;
CREATE POLICY "Authenticated read academic_years" ON public.academic_years FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admin manage academic_years" ON public.academic_years;
CREATE POLICY "Admin manage academic_years" ON public.academic_years FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ─── 5. SEED DATA ───────────────────────────────────────────────────────────

INSERT INTO public.academic_years (year_name, is_current)
VALUES 
    ('2024-2025', false),
    ('2025-2026', true),
    ('2026-2027', false),
    ('2027-2028', false)
ON CONFLICT (year_name) DO NOTHING;
