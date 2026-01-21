-- Restrict owner policies to authenticated users only (avoid anonymous role access)
DO $$
DECLARE
  t text;
BEGIN
  -- Tables with "Owner full access" policy
  FOREACH t IN ARRAY ARRAY['customers','invoice_register','items_master','opening_stock','purchase_headers','purchase_lines','sales_headers','sales_lines','suppliers']
  LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated;', 'Owner full access', t);
  END LOOP;

  -- app_owner policies
  EXECUTE 'ALTER POLICY "Owner can read owner record" ON public.app_owner TO authenticated;';
  EXECUTE 'ALTER POLICY "Owner can update owner record" ON public.app_owner TO authenticated;';
  EXECUTE 'ALTER POLICY "Claim owner (first user only)" ON public.app_owner TO authenticated;';
END $$;