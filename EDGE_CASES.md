# Edge cases

Working list for implementation and tests. Each line is the behavior we will build. Items marked **[choice]** are not fixed by `SPEC.md`; they are my default, open to change. `DECISIONS.md` is reserved for the 6 required Part C answers.

## 1. `generateSchedule`

| Case | Expected |
|---|---|
| Aisyah 2026-01-31 → 2026-07-15, 150000, deposit 300000 | deposit + periods 0–5 exactly as the brief's table; period 5 = 77419 |
| Ben 2026-01-01 → 2026-04-15, 100029, no deposit | periods Jan, Feb, Mar full; Apr 1–15 = 100029 × 15 / 30 = 50014.5 → **50015** (half up) |
| Probe 2026-02-28 → 2027-02-27 | anchors on the 28th; last period 2027-01-28 → 2027-02-27 ends the day before the next anchor → **full** rent, no proration |
| Chen 2026-03-15 → 2027-03-14 | 12 full periods + deposit |
| Start Jan 31 in leap year 2028 | anchor 1 = 2028-02-29 |
| Start Jan 30 | anchors Jan 30, Feb 28, Mar 30 (from start, not from previous anchor) |
| Start Mar 31 | Apr 30, May 31, Jun 30 |
| startDate = endDate | 1 rent period, 1 day used of the full period length, prorated |
| endDate = anchor k exactly | period k exists with 1 day used |
| endDate = anchor(k+1) − 1 | period k full price |
| Year boundary (Dec 31 start) | Jan 31, Feb 28, … correct year rollover |
| depositSen = 0 | no deposit invoice |
| Proration never above rent | used < full always, so amount < rent |
| Throws | `2026-02-30`, `2026-2-3`, `2026-02-03T00:00`, `''`, `20260203`; end < start; rent `0`, `-1`, `1.5`, `NaN`, `Infinity`, unsafe integer; deposit `-1`, `0.5`, `NaN` |
| Machine TZ | identical output under UTC, Asia/Kuala_Lumpur, America/New_York (only `Date.UTC` / `getUTC*`, no `new Date('YYYY-MM-DD')` local parsing) |
| Large values | rent × days computed in BigInt, so no float rounding |

## 2. `invoiceStatus`

| Case | Expected |
|---|---|
| due 2026-03-01, now 2026-03-01T15:59:59.999Z, unpaid | unpaid |
| same, now 2026-03-01T16:00:00.000Z | overdue |
| paid ≥ amount, long overdue | paid (rule 1 first) |
| paid > amount | paid |
| partial and overdue | overdue (overdue beats partially_paid) |
| partial, not overdue | partially_paid |
| now = Invalid Date | throws **[choice]** |

## 3. `parseRinggitToSen`

- Accept: `"1,500.50"` → 150050, `"1.15"` → 115, `"7"` → 700, `"  7  "` → 700, `"1.5"` → 150, `"1,000,000"` → 100000000, `"1000"` → 100000, `"0"` → 0 (a zero amount is rejected later by the payment rules, not by the parser).
- Reject: `""`, `"   "`, `"-5"`, `"+5"`, `"1.234"`, `"1e3"`, `"RM 10"`, `"1,23"`, `"1,5000"`, `",100"`, `"1,"`, `"1."`, `".5"`, `"1 000"`, `"1,000.5.0"`, non-ASCII digits, anything above `Number.MAX_SAFE_INTEGER` sen.
- No float math: integer and fraction parts are converted as strings.

## 4. Access control (server)

Check order in every handler: **401** no or invalid login → **404** record not visible to the caller (other org, other tenant, unknown id, non-UUID id) → **403** visible but the role isn't allowed → **400** invalid body → **409/422** business rule.

| Case | Expected |
|---|---|
| No token, bad token, expired token | 401 |
| `Authorization: Bearer` present and invalid, cookie valid | 401 (Bearer wins) **[choice]** |
| Tenant GET other tenant's lease, same org | 404 |
| Staff/manager GET lease in other org | 404 |
| Tenant POST payment on **own** lease | 403; on someone else's lease → 404 |
| Staff approve/reject/void in own org | 403; other org → 404 |
| Staff or tenant `POST /api/leases` | 403 |
| Manager `POST /api/leases` with other org's (or unknown) unitId/tenantId | 404 **[choice: 404, not 400, so existence isn't revealed]** |
| Staff/manager `POST /gateway-bills` on own-org lease | 403 (only the lease's tenant) |
| Tenant `GET /api/reports/collections` | 403 |
| Logged in, but no membership and no tenant row | 403 on role-gated endpoints, 404 on records |
| Role/org in `user_metadata` | ignored (roles only from `memberships` / `tenants.user_id`) |
| Tenant invalid body on a forbidden action | 403, not 400 (role is checked before validation) |

## 5. Data API & Storage (publishable key + user token)

- anon: every table, every `/rpc/*`, and storage → nothing.
- Tenant: reads own org, own tenant row, units/leases/invoices/payments/allocations/bills of own leases only. `PATCH tenants` changing `phone` on own row works; changing `full_name`/`email`/`user_id`/`org_id`, or another tenant's phone → fails.
- Staff: reads own org; no `audit_log`. Manager: reads own org including `audit_log`.
- Every INSERT/UPDATE/DELETE fails for everyone except the tenant's phone update. No callable `/rpc` functions (helpers live in a schema PostgREST doesn't expose).
- `audit_log`: UPDATE/DELETE/TRUNCATE fail even as `postgres` and `service_role` (trigger + revoked privileges).
- Storage `payment-slips`: staff/manager upload and read only under `<own org_id>/`; other org's folder, tenants, anon → denied (read, list, upload). Bucket is private, ≤ 5 MB, JPEG/PNG/PDF only.

## 6. Leases

- Overlap on the same unit (inclusive both ends, e.g. new start = existing end) → 409. Two simultaneous creates on the same unit → exactly one 201, one 409 (exclusion constraint, not a read-then-insert check).
- A different unit, or adjacent dates (new start = existing end + 1) → OK.
- Invalid dates or amounts → 400 (`generateSchedule` validation reused).
- Lease + invoices + audit row written in one transaction; invoices are exactly `generateSchedule`'s output.

## 7. Payments

Remaining = Σ invoice amounts − Σ allocations (approved payments only). Cap for a new payment = remaining − Σ pending_verification amounts.

| Case | Expected |
|---|---|
| amountSen 0, negative, float, string, unsafe integer | 400 |
| method `online` via this endpoint | 400 |
| `bank_transfer` without slipPath | 400; `cash` with slipPath → 400 **[choice]** |
| slipPath not under own `org_id/`, or file doesn't exist | 400 |
| receivedAt without offset or not ISO 8601 | 400. A future date is accepted **[choice: the spec doesn't forbid it]** |
| amount = cap exactly | 201; cap + 1 → 422 |
| Seed check (Aisyah, total 1,127,419) | cash 300000 → deposit; bank 200000 → period 0 (150000) + period 1 (50000) |
| Two staff at once, RM 800 + RM 700, RM 1,000 left | one 201 (pending), the other 422: lease row locked, cap re-read inside the lock |
| Manager payment → approved + allocated immediately; staff → pending, no allocations | |
| Approve when another payment has since used the balance | 422, stays pending |
| Approve twice at once | one 200, the other 409 (status re-read under lock) → allocated once |
| Approve/reject an approved/rejected/voided payment | 409; void a non-approved → 409 |
| Reason missing, or < 5 chars after trimming | 400 **[choice: trim first]** |
| Void | status `voided`, deletes only its allocations; other payments untouched; freed balance is not automatically re-allocated (Part C Q5) |
| Void an online payment | allowed; its bill stays `paid` (a paid bill never goes back) |
| Payments never deleted; approve/reject/void/lease-create → `audit_log` | |
| Recording fails after slip upload | uploaded file removed (only if no payment references it) |
| Allocation order | due_date, then deposit before rent, then period_index; fills not-yet-due invoices too |
| unapplied_sen | only online payments can end up > 0 |
| DB backstop | trigger: Σ allocations per invoice ≤ amount_sen |

## 8. Online payments & webhook

- Bill amount = unpaid of invoices with `due_date ≤ today (MYT)`; 0 → 422. Bill id = `bill_` + 32 random hex chars (128 bits).
- Clicking Pay now twice creates two bills **[choice]**; if both get paid, the second payment's excess goes to future invoices, then to `unapplied_sen`.
- Signature: all fields except `x_signature`, sorted by key, `key+value`, joined with `|`, HMAC-SHA256 hex, constant-time compare. Unknown extra fields are included. Must reproduce the brief's test vector exactly.
- Check order: 401 (missing or bad signature, checked before any DB access) → 404 (unknown bill) → 422 (paid=true and paid_amount ≠ bill amount, compared as exact integer strings) → apply.
- Repeated field names in the body → 401 **[choice: can't verify unambiguously]**. Malformed `paid` value or `paid_at` → 400 **[choice]**.
- Behavior table exactly as the brief: pending/failed + paid → paid + one approved online payment (`received_at = paid_at` parsed from `YYYY-MM-DD HH:MM:SS +0800`) + allocation. Repeats → 200 no-op. paid=false on pending → failed. paid=false on failed/paid → 200 no-op.
- 5 identical callbacks at the same moment → one payment: bill row `FOR UPDATE` + lease lock + `unique(payments.gateway_bill_id)`.
- Online amount > remaining (paid in cash meanwhile) → rest stored as `unapplied_sen`.
- Logs: bill id + outcome only, never the payload, signature or key.
- `/payments/return` reads the bill's status from the DB, writes nothing; its query params are ignored except `bill_id`. A bill of another tenant → not shown.

## 9. Time

- "Today" = Malaysia date. Overdue flips at 16:00:00Z.
- Collections: months bucketed by `received_at` in MYT. Seed bank transfer 2026-03-01 00:30 MYT (= 2026-02-28T16:30Z) counts in **March** → Northwind 2026-01..03 = 300000 / 0 / 200000. Months with no payments → 0. Only `approved` (not pending/rejected/voided).
- Report params: `YYYY-MM`, month 01–12, from ≤ to, at most 120 months **[choice]**, otherwise 400.
- UI: datetime inputs are interpreted as MYT (`+08:00`), all display via `Intl` with `timeZone: 'Asia/Kuala_Lumpur'`, same string on server and client → no hydration warnings.
