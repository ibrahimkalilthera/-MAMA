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
    role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
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
        COALESCE(NEW.raw_user_meta_data->>'role', 'staff')
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
        WHERE id = auth.uid() AND role = 'admin'
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
