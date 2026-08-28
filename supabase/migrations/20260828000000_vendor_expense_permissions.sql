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
