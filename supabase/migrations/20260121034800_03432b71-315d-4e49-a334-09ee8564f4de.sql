-- Tighten RLS policies to authenticated role only (avoid anon access warnings)

-- Helper: recreate "Owner full access" for a table
-- customers
DROP POLICY IF EXISTS "Owner full access" ON public.customers;
CREATE POLICY "Owner full access" ON public.customers
FOR ALL TO authenticated
USING (public.is_owner(auth.uid()))
WITH CHECK (public.is_owner(auth.uid()));

-- invoice_register
DROP POLICY IF EXISTS "Owner full access" ON public.invoice_register;
CREATE POLICY "Owner full access" ON public.invoice_register
FOR ALL TO authenticated
USING (public.is_owner(auth.uid()))
WITH CHECK (public.is_owner(auth.uid()));

-- items_master
DROP POLICY IF EXISTS "Owner full access" ON public.items_master;
CREATE POLICY "Owner full access" ON public.items_master
FOR ALL TO authenticated
USING (public.is_owner(auth.uid()))
WITH CHECK (public.is_owner(auth.uid()));

-- opening_stock
DROP POLICY IF EXISTS "Owner full access" ON public.opening_stock;
CREATE POLICY "Owner full access" ON public.opening_stock
FOR ALL TO authenticated
USING (public.is_owner(auth.uid()))
WITH CHECK (public.is_owner(auth.uid()));

-- suppliers
DROP POLICY IF EXISTS "Owner full access" ON public.suppliers;
CREATE POLICY "Owner full access" ON public.suppliers
FOR ALL TO authenticated
USING (public.is_owner(auth.uid()))
WITH CHECK (public.is_owner(auth.uid()));

-- purchase_headers
DROP POLICY IF EXISTS "Owner full access" ON public.purchase_headers;
CREATE POLICY "Owner full access" ON public.purchase_headers
FOR ALL TO authenticated
USING (public.is_owner(auth.uid()))
WITH CHECK (public.is_owner(auth.uid()));

-- purchase_lines
DROP POLICY IF EXISTS "Owner full access" ON public.purchase_lines;
CREATE POLICY "Owner full access" ON public.purchase_lines
FOR ALL TO authenticated
USING (public.is_owner(auth.uid()))
WITH CHECK (public.is_owner(auth.uid()));

-- purchase_unmatched_lines
DROP POLICY IF EXISTS "Owner full access" ON public.purchase_unmatched_lines;
CREATE POLICY "Owner full access" ON public.purchase_unmatched_lines
FOR ALL TO authenticated
USING (public.is_owner(auth.uid()))
WITH CHECK (public.is_owner(auth.uid()));

-- sales_headers
DROP POLICY IF EXISTS "Owner full access" ON public.sales_headers;
CREATE POLICY "Owner full access" ON public.sales_headers
FOR ALL TO authenticated
USING (public.is_owner(auth.uid()))
WITH CHECK (public.is_owner(auth.uid()));

-- sales_lines
DROP POLICY IF EXISTS "Owner full access" ON public.sales_lines;
CREATE POLICY "Owner full access" ON public.sales_lines
FOR ALL TO authenticated
USING (public.is_owner(auth.uid()))
WITH CHECK (public.is_owner(auth.uid()));

-- payment_ledger
DROP POLICY IF EXISTS "Owner full access" ON public.payment_ledger;
CREATE POLICY "Owner full access" ON public.payment_ledger
FOR ALL TO authenticated
USING (public.is_owner(auth.uid()))
WITH CHECK (public.is_owner(auth.uid()));

-- app_owner
DROP POLICY IF EXISTS "Claim owner (first user only)" ON public.app_owner;
CREATE POLICY "Claim owner (first user only)" ON public.app_owner
FOR INSERT TO authenticated
WITH CHECK (public.owner_is_unset() AND (owner_user_id = auth.uid()) AND (singleton_id = true));

DROP POLICY IF EXISTS "Owner can read owner record" ON public.app_owner;
CREATE POLICY "Owner can read owner record" ON public.app_owner
FOR SELECT TO authenticated
USING (public.is_owner(auth.uid()));

DROP POLICY IF EXISTS "Owner can update owner record" ON public.app_owner;
CREATE POLICY "Owner can update owner record" ON public.app_owner
FOR UPDATE TO authenticated
USING (public.is_owner(auth.uid()))
WITH CHECK ((owner_user_id = auth.uid()) AND (singleton_id = true));