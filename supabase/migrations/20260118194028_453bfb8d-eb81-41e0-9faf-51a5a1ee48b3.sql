-- Add line numbers to invoice line tables

ALTER TABLE public.purchase_lines
ADD COLUMN IF NOT EXISTS line_no integer;

ALTER TABLE public.sales_lines
ADD COLUMN IF NOT EXISTS line_no integer;

-- Backfill existing data with deterministic ordering (created_at then id)
WITH ranked AS (
  SELECT id, purchase_header_id,
         row_number() OVER (PARTITION BY purchase_header_id ORDER BY created_at NULLS LAST, id) AS rn
  FROM public.purchase_lines
)
UPDATE public.purchase_lines pl
SET line_no = r.rn
FROM ranked r
WHERE pl.id = r.id AND pl.line_no IS NULL;

WITH ranked AS (
  SELECT id, sales_header_id,
         row_number() OVER (PARTITION BY sales_header_id ORDER BY created_at NULLS LAST, id) AS rn
  FROM public.sales_lines
)
UPDATE public.sales_lines sl
SET line_no = r.rn
FROM ranked r
WHERE sl.id = r.id AND sl.line_no IS NULL;

-- Make non-null going forward
ALTER TABLE public.purchase_lines
ALTER COLUMN line_no SET NOT NULL;

ALTER TABLE public.sales_lines
ALTER COLUMN line_no SET NOT NULL;

-- Ensure unique line number per invoice header
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchase_lines_header_line_no_key'
  ) THEN
    ALTER TABLE public.purchase_lines
    ADD CONSTRAINT purchase_lines_header_line_no_key UNIQUE (purchase_header_id, line_no);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_lines_header_line_no_key'
  ) THEN
    ALTER TABLE public.sales_lines
    ADD CONSTRAINT sales_lines_header_line_no_key UNIQUE (sales_header_id, line_no);
  END IF;
END$$;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_purchase_lines_header_line_no ON public.purchase_lines (purchase_header_id, line_no);
CREATE INDEX IF NOT EXISTS idx_sales_lines_header_line_no ON public.sales_lines (sales_header_id, line_no);