-- Rent collection schema (SPEC.md section 8).
--
-- Conventions:
--   * Money is bigint sen. Calendar values are `date`, instants `timestamptz`.
--   * Every table has org_id. Child rows reference parents through composite
--     FKs (org_id, ..., id), so a row can never point at another org's data,
--     whatever ids a request body contains.
--   * Invoice paid amounts and statuses are NOT stored: paid = sum of
--     payment_allocations, status = lib/billing.ts invoiceStatus().
--   * Server code uses Prisma as the DB owner; the Data API gets SELECT only
--     (see the next migration). Functions live in the `private` schema, which
--     PostgREST does not expose, so nothing here is callable via /rpc.

create extension if not exists btree_gist with schema extensions;

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.membership_role as enum ('manager', 'staff');
create type public.invoice_kind as enum ('deposit', 'rent');
create type public.payment_method as enum ('cash', 'bank_transfer', 'online');
create type public.payment_status as enum ('pending_verification', 'approved', 'rejected', 'voided');
create type public.gateway_bill_status as enum ('pending', 'paid', 'failed');

-- ---------------------------------------------------------------------------
-- Organizations, people, units
-- ---------------------------------------------------------------------------

create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

-- Staff and managers. user_id is the primary key: a member belongs to exactly one org.
create table public.memberships (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  org_id     uuid not null references public.organizations (id) on delete restrict,
  role       public.membership_role not null,
  created_at timestamptz not null default now()
);

create index memberships_org_id_idx on public.memberships (org_id);

create table public.units (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete restrict,
  name       text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  constraint units_org_name_key unique (org_id, name),
  constraint units_org_id_key unique (org_id, id)
);

-- A tenant may exist without a login (user_id null); one login is one tenant.
create table public.tenants (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete restrict,
  user_id    uuid unique references auth.users (id) on delete set null,
  full_name  text not null check (length(trim(full_name)) > 0),
  email      text not null,
  -- Tenants edit this themselves through the Data API, so the DB validates it.
  phone      text check (phone is null or phone ~ '^\+?[0-9][0-9 -]{5,19}$'),
  created_at timestamptz not null default now(),
  constraint tenants_org_id_key unique (org_id, id)
);

-- ---------------------------------------------------------------------------
-- Leases and invoices
-- ---------------------------------------------------------------------------

create table public.leases (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations (id) on delete restrict,
  unit_id          uuid not null,
  tenant_id        uuid not null,
  start_date       date not null,
  end_date         date not null, -- inclusive: the tenant's last day
  monthly_rent_sen bigint not null check (monthly_rent_sen > 0),
  deposit_sen      bigint not null check (deposit_sen >= 0),
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),

  constraint leases_dates_chk check (end_date >= start_date),
  constraint leases_org_id_key unique (org_id, id),
  constraint leases_unit_fk foreign key (org_id, unit_id) references public.units (org_id, id) on delete restrict,
  constraint leases_tenant_fk foreign key (org_id, tenant_id) references public.tenants (org_id, id) on delete restrict,
  -- Leases on the same unit never overlap, both ends inclusive. Enforced by an
  -- index, so two concurrent inserts can't both succeed (the loser gets 23P01).
  constraint leases_no_overlap exclude using gist (
    unit_id with =,
    daterange(start_date, end_date, '[]') with &&
  )
);

create index leases_tenant_id_idx on public.leases (tenant_id);

-- Exactly what lib/billing.ts generateSchedule returns, stored at lease creation.
create table public.invoices (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  lease_id     uuid not null,
  kind         public.invoice_kind not null,
  period_index integer,
  period_start date,
  period_end   date,
  due_date     date not null,
  amount_sen   bigint not null check (amount_sen > 0),
  created_at   timestamptz not null default now(),

  constraint invoices_lease_fk foreign key (org_id, lease_id) references public.leases (org_id, id) on delete restrict,
  constraint invoices_lease_id_key unique (org_id, lease_id, id),
  constraint invoices_lease_period_key unique (lease_id, period_index),
  -- Deposit: no period fields. Rent: all period fields.
  constraint invoices_kind_chk check (
    (kind = 'deposit' and period_index is null and period_start is null and period_end is null) or
    (kind = 'rent' and period_index >= 0 and period_start is not null and period_end >= period_start)
  )
);

-- At most one deposit per lease. An exclusion constraint rather than a partial
-- unique index, because Prisma reads a unique index on lease_id as a 1:1 relation.
alter table public.invoices
  add constraint invoices_one_deposit_per_lease exclude using gist (lease_id with =) where (kind = 'deposit');

-- ---------------------------------------------------------------------------
-- Online payments
-- ---------------------------------------------------------------------------

create table public.gateway_bills (
  -- 128 random bits: impossible to guess.
  id             text primary key default ('bill_' || encode(extensions.gen_random_bytes(16), 'hex')),
  org_id         uuid not null,
  lease_id       uuid not null,
  amount_sen     bigint not null check (amount_sen > 0),
  status         public.gateway_bill_status not null default 'pending',
  created_by     uuid references auth.users (id) on delete set null,
  transaction_id text,
  paid_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint gateway_bills_id_format check (id ~ '^bill_[0-9a-f]{32}$'),
  constraint gateway_bills_lease_fk foreign key (org_id, lease_id) references public.leases (org_id, id) on delete restrict,
  constraint gateway_bills_lease_id_key unique (org_id, lease_id, id)
);

create index gateway_bills_lease_id_idx on public.gateway_bills (lease_id);

-- ---------------------------------------------------------------------------
-- Payments and allocations
-- ---------------------------------------------------------------------------

create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  lease_id        uuid not null,
  amount_sen      bigint not null check (amount_sen > 0),
  -- Left over once every invoice of the lease is paid (online payments only).
  unapplied_sen   bigint not null default 0,
  method          public.payment_method not null,
  status          public.payment_status not null,
  received_at     timestamptz not null,
  slip_path       text,
  gateway_bill_id text,
  recorded_by     uuid references auth.users (id) on delete set null, -- null: created by the webhook
  decided_by      uuid references auth.users (id) on delete set null, -- manager who approved/rejected/voided
  decided_at      timestamptz,
  reason          text, -- why it was rejected or voided
  created_at      timestamptz not null default now(),

  constraint payments_lease_fk foreign key (org_id, lease_id) references public.leases (org_id, id) on delete restrict,
  constraint payments_lease_id_key unique (org_id, lease_id, id),
  -- The bill must belong to the same lease (and org).
  constraint payments_gateway_bill_fk foreign key (org_id, lease_id, gateway_bill_id)
    references public.gateway_bills (org_id, lease_id, id) on delete restrict,
  -- A bill creates at most one payment, ever. A bill id belongs to exactly one
  -- (org, lease), and the FK above forces the payment's org/lease to match, so
  -- this is the same as unique(gateway_bill_id). The 3-column form is what
  -- Prisma needs to model the relation.
  constraint payments_gateway_bill_key unique (org_id, lease_id, gateway_bill_id),
  constraint payments_unapplied_chk check (
    unapplied_sen >= 0 and unapplied_sen <= amount_sen and (unapplied_sen = 0 or method = 'online')
  ),
  -- Online <=> has a bill. Bank transfer <=> has a slip, in its own org's folder.
  constraint payments_method_chk check (
    (method = 'online'        and gateway_bill_id is not null and slip_path is null) or
    (method = 'bank_transfer' and gateway_bill_id is null     and slip_path is not null) or
    (method = 'cash'          and gateway_bill_id is null     and slip_path is null)
  ),
  constraint payments_slip_path_chk check (
    slip_path is null or (
      split_part(slip_path, '/', 1) = org_id::text
      and slip_path !~ '(^|/)\.\.?(/|$)'
      and length(slip_path) > length(org_id::text) + 1
    )
  ),
  constraint payments_reason_chk check (
    status not in ('rejected', 'voided') or length(trim(reason)) >= 5
  )
);

create unique index payments_slip_path_key on public.payments (slip_path) where slip_path is not null;
create index payments_lease_id_idx on public.payments (lease_id);
create index payments_org_received_idx on public.payments (org_id, received_at) where status = 'approved';

create table public.payment_allocations (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  lease_id   uuid not null,
  payment_id uuid not null,
  invoice_id uuid not null,
  amount_sen bigint not null check (amount_sen > 0),
  created_at timestamptz not null default now(),

  -- Payment and invoice must both belong to the same lease and org.
  constraint payment_allocations_payment_fk foreign key (org_id, lease_id, payment_id)
    references public.payments (org_id, lease_id, id) on delete restrict,
  constraint payment_allocations_invoice_fk foreign key (org_id, lease_id, invoice_id)
    references public.invoices (org_id, lease_id, id) on delete restrict,
  constraint payment_allocations_payment_invoice_key unique (payment_id, invoice_id)
);

create index payment_allocations_invoice_id_idx on public.payment_allocations (invoice_id);
create index payment_allocations_lease_id_idx on public.payment_allocations (lease_id);

-- ---------------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete restrict,
  actor_id   uuid references auth.users (id) on delete set null, -- null: the payment gateway
  action     text not null,
  entity_id  text not null, -- uuid, or a gateway bill id
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_org_created_idx on public.audit_log (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Guard triggers (second layer behind the app code)
-- ---------------------------------------------------------------------------

-- audit_log can never be changed or removed, by any role (owner included).
create function private.audit_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only' using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function private.audit_log_append_only();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function private.audit_log_append_only();

-- Payments are never deleted, their money facts never change, and status only
-- moves pending_verification -> approved | rejected, approved -> voided.
create function private.payments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'payments are never deleted' using errcode = 'insufficient_privilege';
  end if;

  if (new.org_id, new.lease_id, new.amount_sen, new.method, new.received_at, new.slip_path, new.gateway_bill_id)
     is distinct from
     (old.org_id, old.lease_id, old.amount_sen, old.method, old.received_at, old.slip_path, old.gateway_bill_id) then
    raise exception 'payment % details are immutable', old.id using errcode = 'check_violation';
  end if;

  if new.status is distinct from old.status and not (
    (old.status = 'pending_verification' and new.status in ('approved', 'rejected')) or
    (old.status = 'approved' and new.status = 'voided')
  ) then
    raise exception 'payment % cannot go from % to %', old.id, old.status, new.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger payments_guard
  before update or delete on public.payments
  for each row execute function private.payments_guard();

-- A bank transfer's slip_path must point to an existing file in the bucket.
-- security definer: reads storage.objects regardless of the caller.
create function private.payments_slip_exists()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.slip_path is not null and not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'payment-slips' and o.name = new.slip_path
  ) then
    raise exception 'slip % does not exist', new.slip_path using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

create trigger payments_slip_exists
  before insert on public.payments
  for each row execute function private.payments_slip_exists();

-- Allocations only for approved payments, and never more than an invoice's
-- amount or a payment's amount in total.
create function private.payment_allocations_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
begin
  select * into v_payment from public.payments where id = new.payment_id;
  if v_payment.status <> 'approved' then
    raise exception 'payment % is not approved', new.payment_id using errcode = 'check_violation';
  end if;

  if (select coalesce(sum(a.amount_sen), 0) from public.payment_allocations a where a.invoice_id = new.invoice_id)
     > (select i.amount_sen from public.invoices i where i.id = new.invoice_id) then
    raise exception 'invoice % over-allocated', new.invoice_id using errcode = 'check_violation';
  end if;

  if (select coalesce(sum(a.amount_sen), 0) from public.payment_allocations a where a.payment_id = new.payment_id)
     > v_payment.amount_sen then
    raise exception 'payment % over-allocated', new.payment_id using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

create trigger payment_allocations_guard
  after insert or update on public.payment_allocations
  for each row execute function private.payment_allocations_guard();

-- ---------------------------------------------------------------------------
-- Privileges: nothing for API roles by default. The next migration grants
-- exactly the SELECTs (and the tenant phone UPDATE) the brief allows.
-- service_role is included: the app never uses it for table access (Prisma
-- connects as the owner), so the Data API has no write path for anyone.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;
revoke all on all functions in schema public from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on functions from public, anon, authenticated, service_role;

revoke all on all functions in schema private from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private revoke all on functions from public, anon, authenticated, service_role;

-- audit_log: even the owner loses UPDATE/DELETE/TRUNCATE (the trigger above
-- also blocks them if a privilege is ever granted back).
revoke update, delete, truncate on public.audit_log from postgres;
