DO $$
DECLARE
  t text;
BEGIN
  -- Ensure all business tables restrict policies to authenticated role only
  FOREACH t IN ARRAY ARRAY[
    'customers','invoice_register','items_master','opening_stock',
    'purchase_headers','purchase_lines','purchase_unmatched_lines',
    'sales_headers','sales_lines','suppliers'
  ]
  LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated;', 'Owner full access', t);
  END LOOP;

  -- app_owner has specific policies; restrict them too
  EXECUTE format('ALTER POLICY %I ON public.app_owner TO authenticated;', 'Claim owner (first user only)');
  EXECUTE format('ALTER POLICY %I ON public.app_owner TO authenticated;', 'Owner can read owner record');
  EXECUTE format('ALTER POLICY %I ON public.app_owner TO authenticated;', 'Owner can update owner record');
END $$;
