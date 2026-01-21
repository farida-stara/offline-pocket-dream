-- Create sales representatives table
create table if not exists public.sales_reps (
  id uuid primary key default gen_random_uuid(),
  rep_name text not null,
  rep_code text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sales_reps enable row level security;

-- RLS: owner full access
DO $$
begin
  if not exists (
    select 1 from pg_policies 
    where schemaname = 'public' and tablename = 'sales_reps' and policyname = 'Owner full access'
  ) then
    create policy "Owner full access"
    on public.sales_reps
    for all
    using (public.is_owner(auth.uid()))
    with check (public.is_owner(auth.uid()));
  end if;
end $$;

-- updated_at trigger (reuse existing helper)
drop trigger if exists trg_sales_reps_updated_at on public.sales_reps;
create trigger trg_sales_reps_updated_at
before update on public.sales_reps
for each row
execute function public.handle_updated_at();

-- Add sales rep fields to sales headers
alter table public.sales_headers
  add column if not exists sales_rep_id uuid null references public.sales_reps(id) on delete set null,
  add column if not exists rep_collects boolean not null default false;

create index if not exists idx_sales_headers_sales_rep_id on public.sales_headers (sales_rep_id);
create index if not exists idx_sales_headers_rep_collects on public.sales_headers (rep_collects);

-- Extend payment ledger for rep settlement entries
alter table public.payment_ledger
  add column if not exists entry_context text not null default 'invoice',
  add column if not exists rep_id uuid null references public.sales_reps(id) on delete set null;

create index if not exists idx_payment_ledger_entry_context on public.payment_ledger (entry_context);
create index if not exists idx_payment_ledger_rep_id on public.payment_ledger (rep_id);
