-- Lock down all business tables to authenticated users only

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'customers',
    'suppliers',
    'items_master',
    'sales_headers',
    'sales_lines',
    'purchase_headers',
    'purchase_lines',
    'opening_stock',
    'invoice_register'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);

    -- Drop the auto-generated permissive policies
    EXECUTE format('DROP POLICY IF EXISTS "Enable read access for all users" ON public.%I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Enable insert access for all users" ON public.%I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Enable update access for all users" ON public.%I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Enable delete access for all users" ON public.%I;', t);

    -- Create authenticated-only policies
    EXECUTE format('CREATE POLICY "Authenticated can read" ON public.%I FOR SELECT TO authenticated USING (true);', t);
    EXECUTE format('CREATE POLICY "Authenticated can insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (true);', t);
    EXECUTE format('CREATE POLICY "Authenticated can update" ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true);', t);
    EXECUTE format('CREATE POLICY "Authenticated can delete" ON public.%I FOR DELETE TO authenticated USING (true);', t);
  END LOOP;
END $$;
