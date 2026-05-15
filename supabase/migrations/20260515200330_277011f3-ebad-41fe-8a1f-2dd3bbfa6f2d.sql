
-- 1) Add owner guard inside recompute_invoice_payment_status
CREATE OR REPLACE FUNCTION public.recompute_invoice_payment_status(_invoice_type text, _invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _total numeric := 0;
  _paid numeric := 0;
  _status text := 'unpaid';
begin
  if auth.uid() is null or not public.is_owner(auth.uid()) then
    raise exception 'Access denied';
  end if;

  if _invoice_id is null then
    return;
  end if;

  if upper(_invoice_type) = 'PURCHASE' then
    select coalesce(ph.total_amount, 0) into _total
    from public.purchase_headers ph
    where ph.id = _invoice_id;
  elsif upper(_invoice_type) in ('SALE', 'SALES') then
    select coalesce(sh.total_amount, 0) into _total
    from public.sales_headers sh
    where sh.id = _invoice_id;
  else
    return;
  end if;

  select coalesce(sum(pl.amount), 0) into _paid
  from public.payment_ledger pl
  where pl.invoice_id = _invoice_id
    and upper(pl.invoice_type) = upper(_invoice_type);

  if _paid <= 0 then
    _status := 'unpaid';
  elsif _paid >= _total and _total > 0 then
    _status := 'paid';
  else
    _status := 'partial';
  end if;

  if upper(_invoice_type) = 'PURCHASE' then
    update public.purchase_headers
      set payment_status = _status,
          updated_at = now()
    where id = _invoice_id;
  else
    update public.sales_headers
      set payment_status = _status,
          updated_at = now()
    where id = _invoice_id;
  end if;
end;
$function$;

-- 2) Revoke EXECUTE from anon/authenticated on SECURITY DEFINER helper functions.
-- These are called only from triggers (which use definer's privileges) or from RLS policies (which bypass grants).
REVOKE EXECUTE ON FUNCTION public.recompute_invoice_payment_status(text, uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.trg_invoice_total_sync_status_sales() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.trg_invoice_total_sync_status_purchase() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.trg_payment_ledger_sync_invoice_status() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.prevent_app_owner_delete() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_updated_at() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.is_owner(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.owner_is_unset() FROM anon, public;
