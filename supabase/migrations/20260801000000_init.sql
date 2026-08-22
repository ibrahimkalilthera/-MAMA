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
