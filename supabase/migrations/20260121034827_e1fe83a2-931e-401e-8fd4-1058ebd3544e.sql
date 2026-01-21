-- Restrict table privileges so anon cannot access even if policy exists

-- Revoke from anon/public and grant to authenticated for key tables
revoke all on table public.customers from anon, public;
grant all on table public.customers to authenticated;

revoke all on table public.invoice_register from anon, public;
grant all on table public.invoice_register to authenticated;

revoke all on table public.items_master from anon, public;
grant all on table public.items_master to authenticated;

revoke all on table public.opening_stock from anon, public;
grant all on table public.opening_stock to authenticated;

revoke all on table public.suppliers from anon, public;
grant all on table public.suppliers to authenticated;

revoke all on table public.purchase_headers from anon, public;
grant all on table public.purchase_headers to authenticated;

revoke all on table public.purchase_lines from anon, public;
grant all on table public.purchase_lines to authenticated;

revoke all on table public.purchase_unmatched_lines from anon, public;
grant all on table public.purchase_unmatched_lines to authenticated;

revoke all on table public.sales_headers from anon, public;
grant all on table public.sales_headers to authenticated;

revoke all on table public.sales_lines from anon, public;
grant all on table public.sales_lines to authenticated;

revoke all on table public.payment_ledger from anon, public;
grant all on table public.payment_ledger to authenticated;

revoke all on table public.app_owner from anon, public;
grant all on table public.app_owner to authenticated;