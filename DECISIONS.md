# Decisions (Part C)

### 1. The same `paid=true` callback twice, 5 ms apart

Both requests are verified first: the signature is checked before any DB access (`app/api/webhooks/gateway/route.ts:14-15`). Each then reads the bill (`lib/gateway.ts:33`) and checks the amount (`:42`). Both open a transaction and lock the lease row first (`:51`, `lib/ledger.ts:10`), then the bill row (`lib/gateway.ts:52`). The second request waits on that lock. The first marks the bill paid, creates one approved online payment with `received_at = paid_at`, allocates it (`:67-85`), and commits. The second then gets the lock, re-reads the bill, sees `paid` and returns 200 with no effect (`:65`).

The final guarantee is in the database: `unique (org_id, lease_id, gateway_bill_id)` (`supabase/migrations/20261022000001_schema.sql:183`). If a second insert ever got that far, the error would be treated as "already paid" (`lib/gateway.ts:97`). Tested with 8 identical callbacks plus 2 `paid=false` sent at once: exactly one payment (`scripts/webhook-smoke.mjs`).

### 2. RM 800 and RM 700 recorded at once, RM 1,000 remaining

Each request runs in a transaction that starts by locking the lease row: `SELECT … FOR UPDATE` (`lib/payments.ts:59`, `lib/ledger.ts:10`). The second request waits until the first commits. Each request reads the balances only after it holds the lock (`lib/payments.ts:60`), including payments still `pending_verification` (`lib/ledger.ts:25`).

The first payment (either one) passes the cap check (`lib/payments.ts:61-62`) and is stored as pending, so the remaining cap is RM 200 or RM 300. The second then sees that pending amount, fails the cap, and gets 422. Both requests are served correctly; they just can't both pass.

Approvals take the same lock and re-read the payment's status (`:132-139`), so approving twice at once allocates only once (the second gets 409). Tested in `scripts/api-smoke.mjs` ("RM 800 + RM 700", "3 concurrent approvals").

### 3. Every place that works out "today" or converts dates and instants

- **"Today"**:
  - `lib/billing.ts:101-109` gives today's Malaysia date as `floor((ms + 8h) / day)`. It's integer math on the epoch, so the server's timezone can't affect it.
  - It's used by `invoiceStatus` (`:198`), gateway bills (`lib/leases.ts:249`), the amount due now (`:226`), the overdue count (`lib/reports.ts:56`) and the dashboard's last 6 months (`app/(app)/dashboard/page.tsx:27`).
- **Report months**: `lib/reports.ts:34-39` uses `timestamp AT TIME ZONE 'Asia/Kuala_Lumpur'`, which places each month boundary at Malaysia midnight.
- **Date columns**: `lib/convert.ts:11,16` holds `date` values as UTC midnight, with no conversion.
- **Display and input**:
  - `toMalaysiaIso` (`lib/convert.ts:31`) and `formatInstantMyt` (`lib/format.ts:24`) show instants in Malaysia time.
  - The payment form's time is typed in Malaysia time and sent with `+08:00` (`lib/format.ts:36,41`).
  - The API requires an offset on every time it accepts (`lib/validation.ts:32`).
  - The webhook's `paid_at` uses the offset it carries (`lib/gateway.ts:15`).

All of it is UTC+8: the business runs in Malaysia, which has no daylight saving.

### 4. Queries that aren't subject to RLS, and what authorizes them instead

- **Prisma** connects as the DB owner and bypasses RLS. Every handler first resolves the caller with `getUser()` (`lib/auth.ts:16,32,47`). Role and org then come from `memberships` or `tenants.user_id` (`lib/actor.ts:19`), never from the request. Each query is then scoped to that caller:
  - leases: `lib/leases.ts:14-17`
  - payments: `lib/payments.ts:18`
  - lease body ids: `lib/leases.ts:37-38`
  - reports: `lib/reports.ts:36,55`
  - return page: `app/payments/return/page.tsx:43-44`

  Role checks use `requireRole` (`lib/payments.ts:129`). Composite org foreign keys back this up in the database.
- **The secret key** is used only by the seed script (`scripts/seed.mts:22`) and to delete a failed payment's slip (`lib/payments.ts:116`). That deletion is limited to the caller's own org folder and to unreferenced files.
- **SECURITY DEFINER functions**:
  - The RLS helpers (`supabase/migrations/20261022000002_rls.sql:18-58`) only look up `auth.uid()`'s own rows, and they live in a schema PostgREST doesn't expose.
  - `payments_slip_exists` (`…0001_schema.sql:304`) only reads Storage metadata.

### 5. A void reopens invoices while the lease has `unapplied_sen` from an online payment

Nothing is moved automatically. The void deletes only that payment's allocations (`lib/payments.ts:200`). The reopened invoices show as unpaid or overdue again, and the online payment keeps its `unapplied_sen`, which is visible on the lease page.

I chose this because the brief says a void leaves other payments' allocations unchanged, and silently re-spending a customer's credit is a money movement with no record of a decision behind it. A manager can handle it deliberately.

What I'd add next: a manager action "apply unapplied credit". It would move `unapplied_sen` onto open invoices under the same lease lock, using the same allocation order, and write an `audit_log` row.

### 6. Two things the AI assistant got wrong, and how I noticed

1. **It built on a draft instead of the brief.** Before I gave it the official brief, it wrote and tested a full schema from my draft: one organization, cents/USD, stored invoice `status`/`paid_cents`, and a timezone per property. I noticed when I compared it with the requirements, which have multiple organizations, sen/MYR and computed statuses. I had it rewrite the migrations from scratch.
   *ai-logs: search for "rent collection.pdf" and "rewrite from scratch".*
2. **Its test expectations were wrong.** In the first API test run it expected a void to leave `102,0,0,0`. The correct result is `0,0,87,15`: the RM 1.02 payment was allocated after another payment had filled the earlier invoices. It also miscalculated an approve-over-balance case. Rereading the spec rule and checking the arithmetic showed the code was right and the tests were wrong. Approve-over-balance was then tested through the webhook.
   *ai-logs: search for "3 FAILED".*
