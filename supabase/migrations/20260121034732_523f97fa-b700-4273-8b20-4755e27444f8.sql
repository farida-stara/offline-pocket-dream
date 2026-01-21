-- Payments ledger (supports sales + purchases, partial payments)
create table if not exists public.payment_ledger (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  invoice_type text not null, -- 'SALE' | 'PURCHASE'
  invoice_id uuid null,
  invoice_no text null,

  party_type text not null, -- 'customer' | 'supplier'
  party_id uuid null,

  amount numeric not null,
  currency text not null default 'KWD',

  payment_method text not null, -- cash | credit | knet | bank_transfer | other
  other_method_name text null,

  paid_at timestamptz not null default now(),
  reference_no text null,
  bank_details text null,
  notes text null,

  created_by uuid null
);

-- Basic constraints (immutable checks only)
alter table public.payment_ledger
  drop constraint if exists payment_ledger_invoice_type_chk;
alter table public.payment_ledger
  add constraint payment_ledger_invoice_type_chk
  check (invoice_type in ('SALE','PURCHASE'));

alter table public.payment_ledger
  drop constraint if exists payment_ledger_party_type_chk;
alter table public.payment_ledger
  add constraint payment_ledger_party_type_chk
  check (party_type in ('customer','supplier'));

alter table public.payment_ledger
  drop constraint if exists payment_ledger_method_chk;
alter table public.payment_ledger
  add constraint payment_ledger_method_chk
  check (payment_method in ('cash','credit','knet','bank_transfer','other'));

alter table public.payment_ledger
  drop constraint if exists payment_ledger_amount_positive_chk;
alter table public.payment_ledger
  add constraint payment_ledger_amount_positive_chk
  check (amount > 0);

-- updated_at trigger
create trigger payment_ledger_set_updated_at
before update on public.payment_ledger
for each row execute function public.handle_updated_at();

-- Indexes
create index if not exists idx_payment_ledger_paid_at on public.payment_ledger (paid_at desc);
create index if not exists idx_payment_ledger_invoice on public.payment_ledger (invoice_type, invoice_no);
create index if not exists idx_payment_ledger_party on public.payment_ledger (party_type, party_id);

-- Enable RLS + owner-only access
alter table public.payment_ledger enable row level security;

do $$ begin
  -- Select
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='payment_ledger' and policyname='Owner full access'
  ) then
    create policy "Owner full access" on public.payment_ledger
    for all
    using (public.is_owner(auth.uid()))
    with check (public.is_owner(auth.uid()));
  end if;
end $$;