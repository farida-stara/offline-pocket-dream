-- Add margin factor per purchase line so sales can fetch it from last purchase
ALTER TABLE public.purchase_lines
ADD COLUMN IF NOT EXISTS margin_factor numeric NOT NULL DEFAULT 1;

-- Backfill existing rows just in case (defensive)
UPDATE public.purchase_lines
SET margin_factor = 1
WHERE margin_factor IS NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_lines_item_header
ON public.purchase_lines (item_id, purchase_header_id);
