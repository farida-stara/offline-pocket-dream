-- Fix invoice_register uniqueness to allow same invoice_no across types
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname='public'
      AND t.relname='invoice_register'
      AND c.conname='invoice_register_invoice_no_key'
  ) THEN
    ALTER TABLE public.invoice_register DROP CONSTRAINT invoice_register_invoice_no_key;
  END IF;
END $$;

-- Ensure composite uniqueness
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname='public'
      AND t.relname='invoice_register'
      AND c.conname='invoice_register_invoice_no_type_key'
  ) THEN
    ALTER TABLE public.invoice_register
      ADD CONSTRAINT invoice_register_invoice_no_type_key UNIQUE (invoice_no, invoice_type);
  END IF;
END $$;