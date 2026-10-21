# Rent Collection

Part of the rent collection module for Malaysian property management companies: leases and billing, payments with manager approval, an online payment gateway webhook, and per-organization access control. Built with Next.js 16 (App Router), TypeScript, a local Supabase (Postgres, Auth, Storage), Prisma 7 and shadcn/ui. The brief is in [SPEC.md](SPEC.md).

## Run it

```bash
npx supabase start            # local stack from supabase/config.toml (Docker)
npx supabase db reset         # schema, RLS, storage bucket from supabase/migrations/
npm install                   # also runs `prisma generate`
cp .env.example .env.local    # local values; compare with `npx supabase status`
npm run seed                  # the brief's orgs, users, leases, payments, via the app's services
npm run build && npm start    # http://localhost:3000
```

**Seeded accounts** (all share the password `RentCollect-2026!`):

| Account | Role |
|---|---|
| `manager@northwind.test`, `staff@northwind.test` | Northwind manager, staff |
| `aisyah@`, `ben@`, `probe@northwind.test` | Northwind tenants |
| `manager@beta.test`, `chen@beta.test` | Beta Realty manager, tenant |

**Simulate the gateway:** sign in as a tenant, click **Pay now**, then run:

```bash
GATEWAY_X_SIGNATURE_KEY=<value from .env.local> node gateway-sim.mjs <bill_id> <amount_sen> true
```

## Tests

```bash
npm test                                   # unit tests (billing, signature) under TZ=UTC, Asia/Kuala_Lumpur, America/New_York
node scripts/api-smoke.mjs http://localhost:3000      # HTTP API: 401/403/404, cap, approvals, voids, concurrency
node scripts/webhook-smoke.mjs http://localhost:3000  # webhook table, replays, concurrent callbacks, unapplied_sen
```

The two smoke scripts create data. Run them on a fresh `db reset` + `npm run seed`, then reset and reseed again afterwards.

## How it's put together

| Area | Where |
|---|---|
| Billing rules (pure, timezone-independent) | `lib/billing.ts` |
| Auth: Bearer token or cookie, `getUser()`, role from `memberships` / `tenants.user_id` | `lib/auth.ts`, `lib/actor.ts` |
| Leases, payments, allocation, reports | `lib/leases.ts`, `lib/payments.ts`, `lib/ledger.ts`, `lib/reports.ts` |
| Webhook | `app/api/webhooks/gateway/route.ts`, `lib/gateway.ts`, `lib/gateway-signature.ts` |
| Schema, constraints, RLS, storage | `supabase/migrations/` (the source of truth; `prisma/schema.prisma` is generated with `prisma db pull`) |
| Agreed edge-case behavior | `EDGE_CASES.md` |

Key points:
- **Concurrency:** every money operation locks the lease row first (`SELECT … FOR UPDATE`) and re-reads balances under that lock.
- **Integrity in the database:**
  - Composite foreign keys keep every row inside one organization.
  - An exclusion constraint prevents overlapping leases.
  - Triggers stop over-allocation and illegal payment state changes, and make `audit_log` append-only.
- **Data API:** `anon` has no grants at all. Signed-in users get read access through RLS; the only write is a tenant updating their own phone.

## Known issues

- Prisma's schema includes the `auth` schema's models, because `memberships.user_id` and `tenants.user_id` have real foreign keys to `auth.users`. App code never writes to `auth.*` through Prisma.
- `npm run seed` refuses to run if data already exists. Reset first.
- Pressing Pay now twice creates two bills. If both are paid, the extra money goes to future invoices, then to `unapplied_sen`.
- After a void, an online payment's `unapplied_sen` isn't automatically re-applied to reopened invoices (see DECISIONS.md, question 5).

## Skipped / next steps

- **Bonus items not built:**
  - A create-lease form with a schedule preview (the API exists: `POST /api/leases`).
  - Realtime updates on the tenant portal.
  - Search and pagination for the leases list.
- **Next:**
  - A manager action to apply `unapplied_sen` to open invoices.
  - Allocation unit tests that run against the database (currently covered by the HTTP smoke scripts).
  - Moving the smoke scripts into vitest with automatic reset and seed.
