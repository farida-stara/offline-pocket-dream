
-- 1. Prevent deletion of app_owner (defense in depth against ownership takeover)
CREATE OR REPLACE FUNCTION public.prevent_app_owner_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Deleting the app_owner record is not allowed';
END;
$$;

DROP TRIGGER IF EXISTS prevent_app_owner_delete_trg ON public.app_owner;
CREATE TRIGGER prevent_app_owner_delete_trg
BEFORE DELETE ON public.app_owner
FOR EACH ROW EXECUTE FUNCTION public.prevent_app_owner_delete();

-- Restrictive RLS policy: deny DELETE on app_owner for everyone
DROP POLICY IF EXISTS "No one can delete owner record" ON public.app_owner;
CREATE POLICY "No one can delete owner record"
ON public.app_owner
AS RESTRICTIVE
FOR DELETE
TO authenticated, anon
USING (false);

-- 2. Restrict {public} role policies to {authenticated} only
DROP POLICY IF EXISTS "Owner full access" ON public.sales_reps;
CREATE POLICY "Owner full access" ON public.sales_reps
FOR ALL TO authenticated
USING (is_owner(auth.uid()))
WITH CHECK (is_owner(auth.uid()));

DROP POLICY IF EXISTS "Owner full access" ON public.wastage_reasons;
CREATE POLICY "Owner full access" ON public.wastage_reasons
FOR ALL TO authenticated
USING (is_owner(auth.uid()))
WITH CHECK (is_owner(auth.uid()));

DROP POLICY IF EXISTS "Owner full access" ON public.wastage_headers;
CREATE POLICY "Owner full access" ON public.wastage_headers
FOR ALL TO authenticated
USING (is_owner(auth.uid()))
WITH CHECK (is_owner(auth.uid()));

DROP POLICY IF EXISTS "Owner full access" ON public.wastage_lines;
CREATE POLICY "Owner full access" ON public.wastage_lines
FOR ALL TO authenticated
USING (is_owner(auth.uid()))
WITH CHECK (is_owner(auth.uid()));

DROP POLICY IF EXISTS "Owner full access" ON public.computed_snapshots;
CREATE POLICY "Owner full access" ON public.computed_snapshots
FOR ALL TO authenticated
USING (is_owner(auth.uid()))
WITH CHECK (is_owner(auth.uid()));

DROP POLICY IF EXISTS "Owner full access" ON public.rebuild_metadata;
CREATE POLICY "Owner full access" ON public.rebuild_metadata
FOR ALL TO authenticated
USING (is_owner(auth.uid()))
WITH CHECK (is_owner(auth.uid()));
