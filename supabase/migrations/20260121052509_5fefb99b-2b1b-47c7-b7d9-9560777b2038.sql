-- Add per-line discount percent for purchase lines (optional, defaults to 0)
ALTER TABLE public.purchase_lines
ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(6,3) NOT NULL DEFAULT 0;

ALTER TABLE public.purchase_unmatched_lines
ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(6,3) NOT NULL DEFAULT 0;

-- Ensure discount percent stays within 0..100
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_lines_discount_percent_range'
  ) THEN
    ALTER TABLE public.purchase_lines
      ADD CONSTRAINT purchase_lines_discount_percent_range
      CHECK (discount_percent >= 0 AND discount_percent <= 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_unmatched_lines_discount_percent_range'
  ) THEN
    ALTER TABLE public.purchase_unmatched_lines
      ADD CONSTRAINT purchase_unmatched_lines_discount_percent_range
      CHECK (discount_percent >= 0 AND discount_percent <= 100);
  END IF;
END $$;

-- Update generated line_total to account for discount
-- (Drop and recreate generated column)
ALTER TABLE public.purchase_lines
  DROP COLUMN IF EXISTS line_total;

ALTER TABLE public.purchase_lines
  ADD COLUMN line_total NUMERIC(12,3)
  GENERATED ALWAYS AS (
    quantity_paid * unit_price * (1 - (discount_percent / 100))
  ) STORED;