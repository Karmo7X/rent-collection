// Webhook checks against a freshly seeded DB (npx supabase db reset && npm run seed).
// Usage: node scripts/webhook-smoke.mjs [baseUrl]. Changes data: reset + reseed afterwards.
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]),
)
const SUPABASE = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const SECRET = env.GATEWAY_X_SIGNATURE_KEY
const PASSWORD = 'RentCollect-2026!'

let failures = 0
function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`)
}

async function token(email) {
  const res = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  return (await res.json()).access_token
}
async function api(tok, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}
async function rest(tok, path) {
  const res = await fetch(`${SUPABASE}/rest/v1/${path}`, { headers: { apikey: KEY, authorization: `Bearer ${tok}` } })
  return res.json()
}

function sign(fields, key = SECRET) {
  const source = Object.keys(fields).sort().map((k) => `${k}${fields[k]}`).join('|')
  return createHmac('sha256', key).update(source).digest('hex')
}
function callbackFields(billId, amountSen, paid = true, extra = {}) {
  return {
    id: billId,
    paid: String(paid),
    paid_amount: paid ? String(amountSen) : '0',
    paid_at: '2026-10-22 09:15:00 +0800',
    transaction_id: `TX-${Math.random().toString(36).slice(2)}`,
    transaction_status: paid ? 'completed' : 'failed',
    ...extra,
  }
}
async function webhook(fields, { signature, rawBody } = {}) {
  const body = rawBody ?? new URLSearchParams({ ...fields, x_signature: signature ?? sign(fields) }).toString()
  const res = await fetch(`${BASE}/api/webhooks/gateway`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  return res.status
}

const T = {
  mgr: await token('manager@northwind.test'),
  staff: await token('staff@northwind.test'),
  aisyah: await token('aisyah@northwind.test'),
  ben: await token('ben@northwind.test'),
  probe: await token('probe@northwind.test'),
}
const leaseOf = async (tok) => (await rest(tok, 'leases?select=id'))[0].id
const L = { aisyah: await leaseOf(T.aisyah), ben: await leaseOf(T.ben), probe: await leaseOf(T.probe) }
const billStatus = async (tok, id) => (await rest(tok, `gateway_bills?select=status&id=eq.${id}`))[0]?.status
const onlinePayments = async (leaseId, billId) =>
  (await rest(T.mgr, `payments?select=id,amount_sen,unapplied_sen,received_at,status&gateway_bill_id=eq.${billId}`)).filter(Boolean)

console.log('\n== signature and lookup (Aisyah, amount due 627419)')
const bill1 = (await api(T.aisyah, 'POST', `/api/leases/${L.aisyah}/gateway-bills`)).json
check('bill amount', bill1.amountSen, 627419)
const good = callbackFields(bill1.billId, bill1.amountSen)
check('missing signature', await webhook(good, { rawBody: new URLSearchParams(good).toString() }), 401)
check('wrong signature', await webhook(good, { signature: sign(good, 'wrong-key') }), 401)
check('signature of other values', await webhook({ ...good, paid_amount: '1' }, { signature: sign(good) }), 401)
check('repeated field name', await webhook(good, { rawBody: `${new URLSearchParams({ ...good, x_signature: sign(good) })}&paid=false` }), 401)
check('empty body', await webhook({}, { rawBody: '' }), 401)
check('unknown bill (valid signature)', await webhook(callbackFields('bill_' + '0'.repeat(32), 1)), 404)
check('garbage bill id (valid signature)', await webhook(callbackFields("'; drop table x;--", 1)), 404)
check('paid=true, wrong amount', await webhook(callbackFields(bill1.billId, bill1.amountSen - 1)), 422)
check('paid=true, amount with decimals', await webhook({ ...good, paid_amount: `${bill1.amountSen}.00` }), 422)
check('bill still pending after rejected callbacks', await billStatus(T.aisyah, bill1.billId), 'pending')
check('no payment yet', (await onlinePayments(L.aisyah, bill1.billId)).length, 0)

console.log('\n== state machine')
check('paid=false on pending', await webhook(callbackFields(bill1.billId, 0, false)), 200)
check('-> failed', await billStatus(T.aisyah, bill1.billId), 'failed')
check('paid=false again (repeat)', await webhook(callbackFields(bill1.billId, 0, false)), 200)
check('paid=true on failed', await webhook(good), 200)
check('-> paid', await billStatus(T.aisyah, bill1.billId), 'paid')
const pay1 = await onlinePayments(L.aisyah, bill1.billId)
check('one online payment', pay1.length, 1)
check('received_at = paid_at (09:15 MYT = 01:15Z)', new Date(pay1[0]?.received_at).toISOString(), '2026-10-22T01:15:00.000Z')
check('repeat paid=true', await webhook(good), 200)
check('paid=false after paid (out of order)', await webhook(callbackFields(bill1.billId, 0, false)), 200)
check('still paid', await billStatus(T.aisyah, bill1.billId), 'paid')
check('still one payment', (await onlinePayments(L.aisyah, bill1.billId)).length, 1)
const aisyahLease = (await api(T.aisyah, 'GET', `/api/leases/${L.aisyah}`)).json
check(
  'allocated to due invoices (all but 5 paid, 5 is 77419 due 2026-06-30 so also due)',
  aisyahLease.invoices.map((i) => i.status).join(','),
  'paid,paid,paid,paid,paid,paid,paid',
)
check('nothing due now -> 422', (await api(T.aisyah, 'POST', `/api/leases/${L.aisyah}/gateway-bills`)).status, 422)

console.log('\n== concurrency: same callback 8x at once, plus paid/false racing')
// Ben: due 350102. Bill, then 8 identical paid callbacks + 2 paid=false at the same moment.
const bill2 = (await api(T.ben, 'POST', `/api/leases/${L.ben}/gateway-bills`)).json
const f2 = callbackFields(bill2.billId, bill2.amountSen)
const results = await Promise.all([
  ...Array.from({ length: 8 }, () => webhook(f2)),
  webhook(callbackFields(bill2.billId, 0, false)),
  webhook(callbackFields(bill2.billId, 0, false)),
])
check('all answered 200', results.every((s) => s === 200), true)
check('exactly one payment for the bill', (await onlinePayments(L.ben, bill2.billId)).length, 1)
check('bill ends paid', await billStatus(T.ben, bill2.billId), 'paid')

console.log('\n== unapplied_sen: lease paid in cash while the bill was open')
// Probe: 2,800,000 total. Bill for what's due now, then the manager pays the
// whole lease in cash (bills don't reserve the cap), then the bill is paid online.
const bill3 = (await api(T.probe, 'POST', `/api/leases/${L.probe}/gateway-bills`)).json
check('probe due now (deposit + periods due by 2026-10-22)', bill3.amountSen, 2000000)
const cash = (amountSen) => ({ amountSen, method: 'cash', receivedAt: '2026-10-22T08:00:00+08:00' })
const staffPending = await api(T.staff, 'POST', `/api/leases/${L.probe}/payments`, cash(900000))
check('staff pending 900000', staffPending.json?.status, 'pending_verification')
check('webhook pays the 2,000,000 bill', await webhook(callbackFields(bill3.billId, bill3.amountSen)), 200)
// Remaining is now 800,000 < 900,000 pending: approval must refuse and keep it pending.
check('approve over remaining balance -> 422', (await api(T.mgr, 'POST', `/api/payments/${staffPending.json.id}/approve`)).status, 422)
const probeLease = (await api(T.mgr, 'GET', `/api/leases/${L.probe}`)).json
check('...stays pending', probeLease.payments.find((p) => p.id === staffPending.json.id).status, 'pending_verification')
check('reject it', (await api(T.mgr, 'POST', `/api/payments/${staffPending.json.id}/reject`, { reason: 'Over the balance' })).status, 200)
// New bill for nothing due -> 422; so pay the rest in cash first, then a bill paid late.
const bill4 = (await api(T.ben, 'POST', `/api/leases/${L.ben}/gateway-bills`)).status
check('ben: nothing due after online payment', bill4, 422)
// Unapplied: Probe tenant opens a bill? nothing due. Use a fresh lease where everything is due.
const units = Object.fromEntries((await rest(T.mgr, 'units?select=id,name')).map((u) => [u.name, u.id]))
const tenants = Object.fromEntries((await rest(T.mgr, 'tenants?select=id,full_name')).map((t) => [t.full_name, t.id]))
const pastLease = await api(T.mgr, 'POST', '/api/leases', {
  unitId: units['D-03-2'],
  tenantId: tenants['Probe Tenant'],
  startDate: '2025-01-01',
  endDate: '2025-01-31',
  monthlyRentSen: 50000,
  depositSen: 0,
})
check('past lease created', pastLease.status, 201)
const bill5 = (await api(T.probe, 'POST', `/api/leases/${pastLease.json.id}/gateway-bills`)).json
check('bill for 50000', bill5.amountSen, 50000)
check('manager pays it in cash meanwhile', (await api(T.mgr, 'POST', `/api/leases/${pastLease.json.id}/payments`, cash(50000))).json?.status, 'approved')
check('gateway then pays the bill', await webhook(callbackFields(bill5.billId, bill5.amountSen)), 200)
const pay5 = (await onlinePayments(pastLease.json.id, bill5.billId))[0]
check('online payment fully unapplied', `${pay5?.amount_sen}/${pay5?.unapplied_sen}`, '50000/50000')
const pastDetail = (await api(T.mgr, 'GET', `/api/leases/${pastLease.json.id}`)).json
check('invoice not over-paid', pastDetail.invoices[0].paidSen, 50000)
check('API reports unappliedSen', pastDetail.payments.find((p) => p.method === 'online').unappliedSen, 50000)

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
