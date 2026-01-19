-- Single-user hardening: first authenticated user becomes owner; only owner can access business data

-- 1) Owner singleton table
CREATE TABLE IF NOT EXISTS public.app_owner (
  singleton_id boolean PRIMARY KEY DEFAULT true,
  owner_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_owner_singleton CHECK (singleton_id = true)
);

ALTER TABLE public.app_owner ENABLE ROW LEVEL SECURITY;

-- 2) Helper functions (use SECURITY DEFINER to avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.owner_is_unset()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.app_owner);
$$;

CREATE OR REPLACE FUNCTION public.is_owner(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_owner ao
    WHERE ao.owner_user_id = _user_id
  );
$$;

-- 3) Policies for claiming ownership exactly once
DROP POLICY IF EXISTS "Claim owner (first user only)" ON public.app_owner;
CREATE POLICY "Claim owner (first user only)"
ON public.app_owner
FOR INSERT
TO authenticated
WITH CHECK (
  public.owner_is_unset()
  AND owner_user_id = auth.uid()
  AND singleton_id = true
);

DROP POLICY IF EXISTS "Owner can read owner record" ON public.app_owner;
CREATE POLICY "Owner can read owner record"
ON public.app_owner
FOR SELECT
TO authenticated
USING (public.is_owner(auth.uid()));

DROP POLICY IF EXISTS "Owner can update owner record" ON public.app_owner;
CREATE POLICY "Owner can update owner record"
ON public.app_owner
FOR UPDATE
TO authenticated
USING (public.is_owner(auth.uid()))
WITH CHECK (owner_user_id = auth.uid() AND singleton_id = true);

-- (No DELETE policy) => cannot remove owner record via client.

-- 4) Replace overly-permissive business table policies with owner-only access
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'customers', 'suppliers', 'items_master', 'sales_headers', 'sales_lines',
    'purchase_headers', 'purchase_lines', 'opening_stock', 'invoice_register'
  ]
  LOOP
    -- Drop old permissive policies
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated can read" ON public.%I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated can insert" ON public.%I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated can update" ON public.%I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated can delete" ON public.%I;', t);

    -- Create owner-only policy (covers all operations)
    EXECUTE format('DROP POLICY IF EXISTS "Owner full access" ON public.%I;', t);
    EXECUTE format('
      CREATE POLICY "Owner full access" ON public.%I
      FOR ALL
      TO authenticated
      USING (public.is_owner(auth.uid()))
      WITH CHECK (public.is_owner(auth.uid()));
    ', t);
  END LOOP;
END $$;
