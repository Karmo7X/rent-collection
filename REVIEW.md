# Code review: late fees, gateway webhook, collections (Part B)

Line numbers count from line 1 of each file as shown in the PR. Files: **LF** = `app/api/leases/[leaseId]/late-fees/route.ts`, **WH** = `app/api/webhooks/gateway/route.ts`, **CO** = `app/(staff)/dashboard/actions.ts`.

Ordered from most to least severe.

---

### 1. CO 1, 5–9: the collections Server Action has no authentication and trusts `orgId` from the caller. **Critical**
Every exported function in a `'use server'` file is a public POST endpoint. Anyone (anonymous users too) can call `getCollections('<any org id>', …)` and read any organization's collections. There is no `getUser()`, no membership check, and `orgId` comes from the client.
**Fix:** authenticate with `getUser()`, load the caller's membership, require staff/manager, and use the membership's `org_id`. Drop the `orgId` parameter.

### 2. LF 11–14: the role comes from `user_metadata`. **Critical**
Users can write their own `user_metadata` (`supabase.auth.updateUser({ data: { role: 'manager' } })`). A tenant who does that passes the check and can add fees to any lease. The brief says roles come only from `memberships`.
**Fix:** look up `memberships` by `user.id` and require `role = 'manager'`. Also, a request with no login currently gets 403; it should get 401 (see #15).

### 3. LF 17–21: the lease isn't scoped to the caller's organization. **Critical**
`findUnique({ where: { id: leaseId } })` finds leases in every org. A Beta manager can add late fees to Northwind's leases. The 404/403 difference also reveals which lease ids exist.
**Fix:** `findFirst({ where: { id: leaseId, orgId: membership.orgId } })`, and return 404 when it isn't found.

### 4. WH 20–38: concurrent duplicate callbacks create two payments. **Critical**
The gateway retries, sometimes at the same moment. Two deliveries both read the bill as `pending` (line 20, outside any lock), both pass line 22, and both run the transaction. The result is two approved payments for one bill, allocated twice, so the tenant is credited double. Nothing in the database prevents it.
**Fix:** inside the transaction, lock the bill (`SELECT … FOR UPDATE`) and re-check its status, or use a conditional update (`updateMany({ where: { id, status: { not: 'paid' } } })` and stop if `count === 0`). Add `unique(payments.gateway_bill_id)` as the final guarantee.

### 5. WH 32: `paid_amount` is never compared with the bill's amount. **High**
A correctly signed callback with a different `paid_amount` creates a payment for whatever the gateway says, e.g. 1 sen settles a RM 2,100 bill, or a too-large amount gets allocated across future invoices. The brief requires 422 and no effect. A non-integer `paid_amount` also makes `BigInt()` throw, which gives a 500, so the gateway keeps retrying forever.
**Fix:** check `/^\d+$/` and `BigInt(paid_amount) === bill.amountSen` before doing anything; otherwise return 422. Use `bill.amountSen` for the payment.

### 6. WH 15: logs the whole payload and the expected signature. **High**
The brief forbids logging whole callback payloads. Worse, logging `expected` gives a valid signature for attacker-chosen fields: post forged fields with any signature, read the logs (shared log tooling, support staff), then replay the forged fields with the logged signature. That gets past the HMAC check.
**Fix:** log only the bill id and the outcome.

### 7. LF 26–45: running it twice charges the late fees twice. **High**
There's no record of which invoice already has a late fee. Every call (a double click, a retry, two managers, a cron job running twice) adds another 2% for the same overdue invoice. Concurrent calls do the same.
**Fix:** store the source invoice on the fee (e.g. `late_fee_for_invoice_id`) with a unique constraint, and skip invoices that already have one, inside one transaction.

### 8. LF 40, 49–52: invoice references are duplicated, and the function can crash. **High**
`prisma.invoice.create(...)` returns a lazy query that only runs at `Promise.all` (line 45). So `nextReference` (line 40) is computed for every fee before any fee exists, and all fees in one request get the same `INV-n`. Concurrent requests collide the same way. And if the newest invoice in the org is a rent or deposit invoice with no `reference`, `last.reference.slice` throws, which gives a 500.
**Fix:** use a database sequence (or a per-org counter row updated with `UPDATE … RETURNING`) and a unique constraint on `(org_id, reference)`.

### 9. CO 7, 10: months are bucketed in UTC, not Malaysia time. **High** (timezone rules)
`date_trunc('month', received_at)` and `${from}::date` use the database session's timezone (UTC). A payment at 2026-03-01 00:30 MYT (2026-02-28T16:30Z, the seeded bank transfer) is counted in **February** instead of March. The range boundaries are also 8 hours off.
**Fix:** `to_char(received_at AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM')`, and month boundaries computed as `('2026-01-01'::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')`.

### 10. WH 18: `paid=false` is ignored. **Medium**
A failed payment never moves the bill to `failed`, and the 200 is returned before the bill is even looked up, so an unknown bill with `paid=false` gets 200 instead of 404.
**Fix:** look up the bill first (404 if missing). Then on `paid=false`, set `pending` to `failed` and treat `failed`/`paid` as no-ops (a paid bill never goes back).

### 11. WH 33: `receivedAt: new Date()` instead of `paid_at`. **Medium**
The brief requires `received_at = paid_at`. A retry delivered hours later, or a payment just before midnight on the last day of the month, lands in the wrong day or month in the collections report.
**Fix:** parse `paid_at` (`YYYY-MM-DD HH:MM:SS +0800`) and use it.

### 12. LF 26–45: the fees are inserted without a transaction. **Medium**
`Promise.all` over separate `create` calls isn't atomic. If one insert fails, the earlier ones stay, and the response is a 500, so the caller retries and makes more duplicates (#7).
**Fix:** `prisma.$transaction(async (tx) => …)`, with the lease row locked like other money operations.

### 13. LF 30: a float ratio skips invoices that are still unpaid. **Medium**
`Number(paid) / Number(amount) >= 0.995` treats an invoice with up to 0.5% outstanding as paid. A RM 1,500 invoice with RM 7.40 unpaid gets no fee, although the comment says "still unpaid". It also brings floating point into money logic.
**Fix:** `if (paid >= invoice.amountSen) continue` with bigint values (the same rule as `invoiceStatus`).

### 14. CO 6–13: months with nothing collected are missing. **Medium**
`GROUP BY` only returns months that have payments. The brief requires one entry per month, including zeros: for 2026-01..03 it must return February with `0`.
**Fix:** `generate_series` over the months, with a `LEFT JOIN` on payments.

### 15. LF 12–13: no login returns 403. **Low**
When `user` is null the check returns 403. The brief requires 401 for a request without a valid login.
**Fix:** `if (!user) return 401` before the role check.

### 16. WH 14: the signature is compared with `!==`. **Low**
That isn't constant-time, so in theory response timing leaks how many leading characters match.
**Fix:** check it's 64 hex characters, then `crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given, 'hex'))`.

### 17. LF 37, 40: `kind: 'late_fee'` and `reference` aren't in the schema. **Low** (unless the PR adds a migration)
`invoices.kind` only allows `deposit | rent`, and there's no `reference` column, so the insert fails at runtime. If a migration is added, late-fee invoices also change each lease's remaining balance and the payment cap. The allocation order (due date, deposit before rent, period) has no place for them, so that needs a decision too.

---

## Looks suspicious, but is correct
- **LF 11, `getUser()`**: this is the right call. It verifies the token with the Auth server, unlike `getSession()`. Only the source of the role (#2) is wrong.
- **LF 23–24, 28, 38, today and the cutoff**: `Date.now() + 8h`, then `toISOString().slice(0, 10)`, gives the Malaysia date whatever the server's timezone. `Date.parse('YYYY-MM-DD')` is UTC midnight, and so is Prisma's value for a `date` column, so the comparison is consistent. A fee applies from the 8th day after the due date, which matches "more than 7 days".
- **LF 31, `Math.round` for the fee**: `Math.round` rounds .5 up for positive numbers, and `(n * 2) / 100` is exact for realistic sen amounts. #13 is the real problem on these lines.
- **WH 8–12, the signature string**: it excludes `x_signature`, sorts by key (JS's default sort is by UTF-16 code unit, as the brief says), and joins `key+value` with `|`. That matches the test vector, and new gateway fields are included automatically.
