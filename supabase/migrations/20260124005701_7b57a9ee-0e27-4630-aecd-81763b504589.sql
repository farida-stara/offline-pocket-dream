-- Damaged/Wastage register (توالف)

-- 1) Reasons master
CREATE TABLE IF NOT EXISTS public.wastage_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reason_code text NOT NULL,
  reason_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reason_code),
  UNIQUE (reason_name)
);

ALTER TABLE public.wastage_reasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner full access" ON public.wastage_reasons
FOR ALL
USING (is_owner(auth.uid()))
WITH CHECK (is_owner(auth.uid()));

-- Seed common reasons (idempotent)
INSERT INTO public.wastage_reasons (reason_code, reason_name)
VALUES
  ('EXP', 'منتهي الصلاحية'),
  ('DMG', 'كسر/تلف'),
  ('SPILL', 'انسكاب/تلوث'),
  ('RET', 'مرتجع تالف'),
  ('STOR', 'سوء تخزين')
ON CONFLICT DO NOTHING;

-- 2) Wastage headers
CREATE TABLE IF NOT EXISTS public.wastage_headers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wastage_no text NOT NULL,
  wastage_date date NOT NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wastage_no)
);

ALTER TABLE public.wastage_headers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner full access" ON public.wastage_headers
FOR ALL
USING (is_owner(auth.uid()))
WITH CHECK (is_owner(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_wastage_headers_date ON public.wastage_headers (wastage_date);

-- 3) Wastage lines
CREATE TABLE IF NOT EXISTS public.wastage_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wastage_header_id uuid NOT NULL REFERENCES public.wastage_headers(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  item_id uuid NOT NULL REFERENCES public.items_master(id),
  quantity numeric NOT NULL DEFAULT 0,
  reason_id uuid NULL REFERENCES public.wastage_reasons(id),
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wastage_header_id, line_no)
);

ALTER TABLE public.wastage_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner full access" ON public.wastage_lines
FOR ALL
USING (is_owner(auth.uid()))
WITH CHECK (is_owner(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_wastage_lines_item ON public.wastage_lines (item_id);
CREATE INDEX IF NOT EXISTS idx_wastage_lines_header ON public.wastage_lines (wastage_header_id);