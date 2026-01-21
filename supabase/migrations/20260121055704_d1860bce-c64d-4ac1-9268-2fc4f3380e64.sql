-- 1) Helper to recompute payment status for a given invoice
create or replace function public.recompute_invoice_payment_status(_invoice_type text, _invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _total numeric := 0;
  _paid numeric := 0;
  _status text := 'unpaid';
begin
  if _invoice_id is null then
    return;
  end if;

  -- Total amount from the invoice header
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

  -- Sum of payments for that invoice
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
$$;

-- 2) Trigger on payment_ledger to keep invoice payment_status in sync
create or replace function public.trg_payment_ledger_sync_invoice_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    perform public.recompute_invoice_payment_status(new.invoice_type, new.invoice_id);
    -- If invoice_id changed on update, recompute old invoice too
    if tg_op = 'UPDATE' and old.invoice_id is distinct from new.invoice_id then
      perform public.recompute_invoice_payment_status(old.invoice_type, old.invoice_id);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    perform public.recompute_invoice_payment_status(old.invoice_type, old.invoice_id);
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists payment_ledger_sync_invoice_status on public.payment_ledger;
create trigger payment_ledger_sync_invoice_status
after insert or update or delete on public.payment_ledger
for each row
execute function public.trg_payment_ledger_sync_invoice_status();

-- 3) When invoice totals change (editing invoices), recompute status as well
create or replace function public.trg_invoice_total_sync_status_purchase()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_invoice_payment_status('PURCHASE', new.id);
  return new;
end;
$$;

drop trigger if exists purchase_headers_sync_status on public.purchase_headers;
create trigger purchase_headers_sync_status
after update of total_amount on public.purchase_headers
for each row
execute function public.trg_invoice_total_sync_status_purchase();

create or replace function public.trg_invoice_total_sync_status_sales()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_invoice_payment_status('SALE', new.id);
  return new;
end;
$$;

drop trigger if exists sales_headers_sync_status on public.sales_headers;
create trigger sales_headers_sync_status
after update of total_amount on public.sales_headers
for each row
execute function public.trg_invoice_total_sync_status_sales();
