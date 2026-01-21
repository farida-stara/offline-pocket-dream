-- Table to keep unmatched lines from purchase Excel imports (so invoices can be saved and fixed later)
CREATE TABLE IF NOT EXISTS public.purchase_unmatched_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_header_id uuid NOT NULL REFERENCES public.purchase_headers(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  source_name text,
  item_id uuid NULL REFERENCES public.items_master(id),
  quantity_paid numeric NOT NULL DEFAULT 0,
  quantity_free numeric NOT NULL DEFAULT 0,
  unit_price numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_unmatched_lines_header ON public.purchase_unmatched_lines(purchase_header_id);
CREATE INDEX IF NOT EXISTS idx_purchase_unmatched_lines_item ON public.purchase_unmatched_lines(item_id);

ALTER TABLE public.purchase_unmatched_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner full access" ON public.purchase_unmatched_lines;
CREATE POLICY "Owner full access" ON public.purchase_unmatched_lines
FOR ALL
TO authenticated
USING (public.is_owner(auth.uid()))
WITH CHECK (public.is_owner(auth.uid()));
