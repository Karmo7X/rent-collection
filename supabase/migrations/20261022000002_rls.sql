-- Data API access (SPEC.md section 6, "Data API" table).
--
-- anon: nothing (no grants at all).
-- authenticated: SELECT on the tables below, filtered by RLS; plus UPDATE of
--   tenants.phone on the caller's own tenant row. No other write anywhere.
-- Prisma (DB owner) bypasses RLS; server code does its own authorization.
--
-- Helpers are SECURITY DEFINER in `private` (not exposed by PostgREST): they
-- read memberships/tenants/leases without re-entering RLS, which avoids policy
-- recursion and keeps policies cheap. Wrapped in (select ...) so Postgres runs
-- them once per query, not once per row.

-- ---------------------------------------------------------------------------
-- Helpers: who is the caller?
-- ---------------------------------------------------------------------------

-- The org of the calling staff member / manager, or null.
create function private.member_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id from public.memberships m where m.user_id = auth.uid();
$$;

-- The role of the calling staff member / manager, or null.
create function private.member_role()
returns public.membership_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.memberships m where m.user_id = auth.uid();
$$;

-- The calling tenant's own leases (empty for non-tenants).
create function private.tenant_lease_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.id
  from public.leases l
  join public.tenants t on t.id = l.tenant_id and t.org_id = l.org_id
  where t.user_id = auth.uid();
$$;

-- The calling tenant's org (null for non-tenants).
create function private.tenant_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.org_id from public.tenants t where t.user_id = auth.uid();
$$;

grant usage on schema private to authenticated;
grant execute on function
  private.member_org_id(), private.member_role(), private.tenant_lease_ids(), private.tenant_org_id()
  to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------

alter table public.organizations       enable row level security;
alter table public.memberships         enable row level security;
alter table public.units               enable row level security;
alter table public.tenants             enable row level security;
alter table public.leases              enable row level security;
alter table public.invoices            enable row level security;
alter table public.payments            enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.gateway_bills       enable row level security;
alter table public.audit_log           enable row level security;

-- ---------------------------------------------------------------------------
-- Grants (authenticated only; anon gets nothing)
-- ---------------------------------------------------------------------------

grant select on
  public.organizations, public.memberships, public.units, public.tenants,
  public.leases, public.invoices, public.payments, public.payment_allocations,
  public.gateway_bills, public.audit_log
  to authenticated;

-- Column-level: the only column anyone can update through the Data API.
grant update (phone) on public.tenants to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- organizations: own org (members and tenants)
create policy organizations_select on public.organizations
  for select to authenticated
  using (id = (select private.member_org_id()) or id = (select private.tenant_org_id()));

-- memberships: staff/manager of the org; tenants none
create policy memberships_select on public.memberships
  for select to authenticated
  using (org_id = (select private.member_org_id()));

-- units: staff/manager of the org; tenant only the units of own leases
create policy units_select on public.units
  for select to authenticated
  using (
    org_id = (select private.member_org_id())
    or id in (select l.unit_id from public.leases l where l.id in (select private.tenant_lease_ids()))
  );

-- tenants: staff/manager of the org; tenant own row
create policy tenants_select on public.tenants
  for select to authenticated
  using (org_id = (select private.member_org_id()) or user_id = (select auth.uid()));

-- tenant updates own row; the column grant limits it to phone
create policy tenants_update_own_phone on public.tenants
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- leases: staff/manager of the org; tenant own leases
create policy leases_select on public.leases
  for select to authenticated
  using (org_id = (select private.member_org_id()) or id in (select private.tenant_lease_ids()));

-- invoices, payments, allocations, bills: same rule through lease_id
create policy invoices_select on public.invoices
  for select to authenticated
  using (org_id = (select private.member_org_id()) or lease_id in (select private.tenant_lease_ids()));

create policy payments_select on public.payments
  for select to authenticated
  using (org_id = (select private.member_org_id()) or lease_id in (select private.tenant_lease_ids()));

create policy payment_allocations_select on public.payment_allocations
  for select to authenticated
  using (org_id = (select private.member_org_id()) or lease_id in (select private.tenant_lease_ids()));

create policy gateway_bills_select on public.gateway_bills
  for select to authenticated
  using (org_id = (select private.member_org_id()) or lease_id in (select private.tenant_lease_ids()));

-- audit_log: managers of the org only
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (org_id = (select private.member_org_id()) and (select private.member_role()) = 'manager');
