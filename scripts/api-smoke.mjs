// End-to-end API checks against a freshly seeded DB (npx supabase db reset && npm run seed).
// Usage: node scripts/api-smoke.mjs [baseUrl]   (default http://localhost:3000)
// Creates extra leases/payments, so reset + reseed afterwards.
import { readFileSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, '')]
    }),
)
const SUPABASE = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const PASSWORD = 'RentCollect-2026!'

let failures = 0
function check(label, actual, expected) {
  const ok = Array.isArray(expected) ? expected.includes(actual) : actual === expected
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`)
}

async function token(email) {
  const res = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  const json = await res.json()
  if (!json.access_token) throw new Error(`login failed for ${email}`)
  return json.access_token
}

async function call(who, method, path, body, raw) {
  const headers = { 'content-type': 'application/json' }
  if (who) headers.authorization = `Bearer ${who}`
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  })
  let json = null
  try {
    json = await res.json()
  } catch {}
  return { status: res.status, json }
}

const T = {}
for (const [k, email] of Object.entries({
  mgr: 'manager@northwind.test',
  staff: 'staff@northwind.test',
  aisyah: 'aisyah@northwind.test',
  ben: 'ben@northwind.test',
  probe: 'probe@northwind.test',
  betaMgr: 'manager@beta.test',
  chen: 'chen@beta.test',
})) {
  T[k] = await token(email)
}

// Discover ids through the API itself (tenants read their own lease ids via the Data API).
async function ownLeaseId(tok) {
  const res = await fetch(`${SUPABASE}/rest/v1/leases?select=id`, { headers: { apikey: KEY, authorization: `Bearer ${tok}` } })
  return (await res.json())[0].id
}
async function rest(tok, path) {
  const res = await fetch(`${SUPABASE}/rest/v1/${path}`, { headers: { apikey: KEY, authorization: `Bearer ${tok}` } })
  return res.json()
}
const L = { aisyah: await ownLeaseId(T.aisyah), ben: await ownLeaseId(T.ben), probe: await ownLeaseId(T.probe), chen: await ownLeaseId(T.chen) }
const units = Object.fromEntries((await rest(T.mgr, 'units?select=id,name')).map((u) => [u.name, u.id]))
const tenants = Object.fromEntries((await rest(T.mgr, 'tenants?select=id,full_name')).map((t) => [t.full_name, t.id]))
const betaUnit = (await rest(T.betaMgr, 'units?select=id'))[0].id
const randomUuid = '6f1c2b1e-1111-4222-8333-944455556666'
const now = '2026-10-01T09:00:00+08:00'

console.log('\n== GET /api/leases/:id')
check('anon', (await call(null, 'GET', `/api/leases/${L.aisyah}`)).status, 401)
check('garbage token', (await call('not-a-jwt', 'GET', `/api/leases/${L.aisyah}`)).status, 401)
check('manager', (await call(T.mgr, 'GET', `/api/leases/${L.aisyah}`)).status, 200)
check('staff', (await call(T.staff, 'GET', `/api/leases/${L.aisyah}`)).status, 200)
const aisyahDetail = await call(T.aisyah, 'GET', `/api/leases/${L.aisyah}`)
check('own tenant', aisyahDetail.status, 200)
check('other tenant same org', (await call(T.ben, 'GET', `/api/leases/${L.aisyah}`)).status, 404)
check('other org manager', (await call(T.betaMgr, 'GET', `/api/leases/${L.aisyah}`)).status, 404)
check('other org tenant', (await call(T.chen, 'GET', `/api/leases/${L.aisyah}`)).status, 404)
check('non-uuid id', (await call(T.mgr, 'GET', `/api/leases/abc`)).status, 404)
check('unknown uuid', (await call(T.mgr, 'GET', `/api/leases/${randomUuid}`)).status, 404)
const d = aisyahDetail.json
check('invoice count', d.invoices.length, 7)
check('first invoice', [d.invoices[0].kind, d.invoices[0].amountSen, d.invoices[0].paidSen, d.invoices[0].status].join(','), 'deposit,300000,300000,paid')
check('period 1 partially paid, overdue now', [d.invoices[2].paidSen, d.invoices[2].status].join(','), '50000,overdue')
check('last period', [d.invoices[6].periodEnd, d.invoices[6].amountSen].join(','), '2026-07-15,77419')
check('payment receivedAt in MYT', d.payments.map((p) => p.receivedAt).join(' '), '2026-01-31T10:00:00+08:00 2026-03-01T00:30:00+08:00')
check('lease shape', Object.keys(d.lease).sort().join(','), 'depositSen,endDate,id,monthlyRentSen,startDate,tenantId,unitId')

console.log('\n== POST /api/leases')
const newLease = { unitId: units['D-03-2'], tenantId: tenants['Probe Tenant'], startDate: '2026-11-01', endDate: '2026-11-30', monthlyRentSen: 100000, depositSen: 0 }
check('anon', (await call(null, 'POST', '/api/leases', newLease)).status, 401)
check('staff', (await call(T.staff, 'POST', '/api/leases', newLease)).status, 403)
check('tenant', (await call(T.probe, 'POST', '/api/leases', newLease)).status, 403)
check('staff with invalid JSON (403 before 400)', (await call(T.staff, 'POST', '/api/leases', undefined, '{bad')).status, 403)
check('manager invalid JSON', (await call(T.mgr, 'POST', '/api/leases', undefined, '{bad')).status, 400)
check('manager Feb 30', (await call(T.mgr, 'POST', '/api/leases', { ...newLease, startDate: '2026-02-30' })).status, 400)
check('manager end before start', (await call(T.mgr, 'POST', '/api/leases', { ...newLease, endDate: '2026-10-31' })).status, 400)
check('manager float rent', (await call(T.mgr, 'POST', '/api/leases', { ...newLease, monthlyRentSen: 1000.5 })).status, 400)
check('beta manager with northwind unit', (await call(T.betaMgr, 'POST', '/api/leases', { ...newLease, tenantId: tenants['Probe Tenant'] })).status, 404)
check('northwind manager with beta unit', (await call(T.mgr, 'POST', '/api/leases', { ...newLease, unitId: betaUnit })).status, 404)
const created = await call(T.mgr, 'POST', '/api/leases', newLease)
check('manager creates', created.status, 201)
check('overlap same dates', (await call(T.mgr, 'POST', '/api/leases', newLease)).status, 409)
check('overlap touching end date', (await call(T.mgr, 'POST', '/api/leases', { ...newLease, startDate: '2026-11-30', endDate: '2026-12-15' })).status, 409)
const race = await Promise.all([1, 2, 3, 4, 5].map(() => call(T.mgr, 'POST', '/api/leases', { ...newLease, startDate: '2027-01-01', endDate: '2027-01-31' })))
check('5 concurrent identical creates', race.map((r) => r.status).sort().join(','), '201,409,409,409,409')
const testLease = created.json.id // 1 period, total 100000

console.log('\n== POST /api/leases/:id/payments')
const cash = (amountSen) => ({ amountSen, method: 'cash', receivedAt: now })
check('anon', (await call(null, 'POST', `/api/leases/${L.ben}/payments`, cash(100))).status, 401)
check('own tenant', (await call(T.ben, 'POST', `/api/leases/${L.ben}/payments`, cash(100))).status, 403)
check('other tenant', (await call(T.aisyah, 'POST', `/api/leases/${L.ben}/payments`, cash(100))).status, 404)
check('other org manager', (await call(T.betaMgr, 'POST', `/api/leases/${L.ben}/payments`, cash(100))).status, 404)
check('amount 0', (await call(T.staff, 'POST', `/api/leases/${L.ben}/payments`, cash(0))).status, 400)
check('amount float', (await call(T.staff, 'POST', `/api/leases/${L.ben}/payments`, cash(10.5))).status, 400)
check('amount string', (await call(T.staff, 'POST', `/api/leases/${L.ben}/payments`, { ...cash(1), amountSen: '100' })).status, 400)
check('method online', (await call(T.staff, 'POST', `/api/leases/${L.ben}/payments`, { ...cash(100), method: 'online' })).status, 400)
check('receivedAt without offset', (await call(T.staff, 'POST', `/api/leases/${L.ben}/payments`, { ...cash(100), receivedAt: '2026-10-01T09:00:00' })).status, 400)
check('bank transfer without slip', (await call(T.staff, 'POST', `/api/leases/${L.ben}/payments`, { ...cash(100), method: 'bank_transfer' })).status, 400)
check('cash with slip', (await call(T.staff, 'POST', `/api/leases/${L.ben}/payments`, { ...cash(100), slipPath: 'x/y.pdf' })).status, 400)
check('slip in other org folder', (await call(T.staff, 'POST', `/api/leases/${L.ben}/payments`, { ...cash(100), method: 'bank_transfer', slipPath: '00000000-0000-0000-0000-000000000000/x.pdf' })).status, 400)

// Ben: total 350102 (100029 x 3 + 50015), nothing paid.
const p1 = await call(T.staff, 'POST', `/api/leases/${L.ben}/payments`, cash(300000))
check('staff records -> pending', [p1.status, p1.json?.status].join(','), '201,pending_verification')
check('over cap (cap = 350102 - 300000 pending)', (await call(T.staff, 'POST', `/api/leases/${L.ben}/payments`, cash(50103))).status, 422)
const p2 = await call(T.staff, 'POST', `/api/leases/${L.ben}/payments`, cash(50102))
check('exactly the cap', p2.status, 201)

console.log('\n== approve / reject / void')
check('staff approves', (await call(T.staff, 'POST', `/api/payments/${p1.json.id}/approve`)).status, 403)
check('own tenant approves', (await call(T.ben, 'POST', `/api/payments/${p1.json.id}/approve`)).status, 403)
check('other tenant approves', (await call(T.aisyah, 'POST', `/api/payments/${p1.json.id}/approve`)).status, 404)
check('other org manager approves', (await call(T.betaMgr, 'POST', `/api/payments/${p1.json.id}/approve`)).status, 404)
check('non-uuid payment', (await call(T.mgr, 'POST', `/api/payments/nope/approve`)).status, 404)
const approvals = await Promise.all([1, 2, 3].map(() => call(T.mgr, 'POST', `/api/payments/${p1.json.id}/approve`)))
check('3 concurrent approvals of one payment', approvals.map((r) => r.status).sort().join(','), '200,409,409')
const benAfter = (await call(T.mgr, 'GET', `/api/leases/${L.ben}`)).json
check('allocated once: paid per invoice', benAfter.invoices.map((i) => i.paidSen).join(','), '100029,100029,99942,0')
check('reject: missing reason', (await call(T.mgr, 'POST', `/api/payments/${p2.json.id}/reject`, {})).status, 400)
check('reject: 4 chars after trim', (await call(T.mgr, 'POST', `/api/payments/${p2.json.id}/reject`, { reason: '  abcd  ' })).status, 400)
check('reject: staff (403 before 400)', (await call(T.staff, 'POST', `/api/payments/${p2.json.id}/reject`, {})).status, 403)
check('void a pending payment', (await call(T.mgr, 'POST', `/api/payments/${p2.json.id}/void`, { reason: 'wrong one' })).status, 409)
check('reject ok', (await call(T.mgr, 'POST', `/api/payments/${p2.json.id}/reject`, { reason: 'Duplicate entry' })).json?.status, 'rejected')
check('reject again', (await call(T.mgr, 'POST', `/api/payments/${p2.json.id}/reject`, { reason: 'Duplicate entry' })).status, 409)
check('approve a rejected payment', (await call(T.mgr, 'POST', `/api/payments/${p2.json.id}/approve`)).status, 409)

// Approve re-check: staff pending 50000, then manager pays the full remaining 50102.
const p3 = await call(T.staff, 'POST', `/api/leases/${L.ben}/payments`, cash(50000))
check('cap counts pending: manager 50103', (await call(T.mgr, 'POST', `/api/leases/${L.ben}/payments`, cash(50103))).status, 422)
const p4 = await call(T.mgr, 'POST', `/api/leases/${L.ben}/payments`, cash(102))
check('manager payment -> approved', p4.json?.status, 'approved')
// Void p1 (300000) frees balance; then manager pays again so p3 no longer fits.
check('void ok', (await call(T.mgr, 'POST', `/api/payments/${p1.json.id}/void`, { reason: 'Bounced cheque' })).json?.status, 'voided')
check('void again', (await call(T.mgr, 'POST', `/api/payments/${p1.json.id}/void`, { reason: 'Bounced cheque' })).status, 409)
const benVoided = (await call(T.mgr, 'GET', `/api/leases/${L.ben}`)).json
// p4 (102) was allocated after p1 had filled invoices 0-1 and most of 2, so
// it sits on invoice 2 (87) and 3 (15). Voiding p1 must not move it.
check('void removed only its allocations (p4 stays on 87 + 15)', benVoided.invoices.map((i) => i.paidSen).join(','), '0,0,87,15')
// Remaining 350000, pending p3 50000 -> cap 300000.
check('cap after void', (await call(T.mgr, 'POST', `/api/leases/${L.ben}/payments`, cash(300001))).status, 422)
const p5 = await call(T.mgr, 'POST', `/api/leases/${L.ben}/payments`, cash(300000))
check('manager pays exactly the cap', p5.status, 201)
// Remaining is now exactly p3's 50000: approval fits. (Approval over the
// balance needs an uncapped online payment in between: tested with the webhook.)
check('approve pending that exactly fits', (await call(T.mgr, 'POST', `/api/payments/${p3.json.id}/approve`)).status, 200)
const benPaid = (await call(T.mgr, 'GET', `/api/leases/${L.ben}`)).json
check('lease fully paid in allocation order', benPaid.invoices.map((i) => `${i.paidSen}:${i.status}`).join(','), '100029:paid,100029:paid,100029:paid,50015:paid')
check('cap now 0', (await call(T.mgr, 'POST', `/api/leases/${L.ben}/payments`, cash(1))).status, 422)

console.log('\n== concurrency: RM 800 + RM 700 on RM 1,000 remaining')
const both = await Promise.all([
  call(T.staff, 'POST', `/api/leases/${testLease}/payments`, cash(80000)),
  call(T.staff, 'POST', `/api/leases/${testLease}/payments`, cash(70000)),
])
check('one accepted, one over the cap', both.map((r) => r.status).sort().join(','), '201,422')
const ten = await Promise.all(Array.from({ length: 10 }, () => call(T.mgr, 'POST', `/api/leases/${L.probe}/payments`, cash(1000000))))
check('10 concurrent manager payments of 1,000,000 on 2,800,000', ten.filter((r) => r.status === 201).length, 2)
const probeAfter = (await call(T.mgr, 'GET', `/api/leases/${L.probe}`)).json
const probeAllocated = probeAfter.invoices.reduce((s, i) => s + i.paidSen, 0)
check('probe allocated total', probeAllocated, 2000000)

console.log('\n== gateway bills')
check('staff', (await call(T.staff, 'POST', `/api/leases/${L.aisyah}/gateway-bills`)).status, 403)
check('other tenant', (await call(T.ben, 'POST', `/api/leases/${L.aisyah}/gateway-bills`)).status, 404)
const bill = await call(T.aisyah, 'POST', `/api/leases/${L.aisyah}/gateway-bills`)
check('own tenant: amount due now (1127419 - 500000)', [bill.status, bill.json?.amountSen].join(','), '201,627419')
check('bill id is unguessable', /^bill_[0-9a-f]{32}$/.test(bill.json?.billId ?? ''), true)

console.log('\n== reports')
check('tenant', (await call(T.aisyah, 'GET', '/api/reports/collections?from=2026-01&to=2026-03')).status, 403)
check('anon', (await call(null, 'GET', '/api/reports/collections?from=2026-01&to=2026-03')).status, 401)
check('missing params', (await call(T.staff, 'GET', '/api/reports/collections')).status, 400)
check('bad month', (await call(T.staff, 'GET', '/api/reports/collections?from=2026-13&to=2026-14')).status, 400)
check('from after to', (await call(T.staff, 'GET', '/api/reports/collections?from=2026-03&to=2026-01')).status, 400)
check('121 months', (await call(T.staff, 'GET', '/api/reports/collections?from=2016-01&to=2026-01')).status, 400)
check('beta sees nothing of northwind', JSON.stringify((await call(T.betaMgr, 'GET', '/api/reports/collections?from=2026-01&to=2026-03')).json), JSON.stringify([{ month: '2026-01', collectedSen: 0 }, { month: '2026-02', collectedSen: 0 }, { month: '2026-03', collectedSen: 0 }]))
check('spans a year boundary', (await call(T.staff, 'GET', '/api/reports/collections?from=2025-12&to=2026-01')).json?.map((r) => r.month).join(','), '2025-12,2026-01')

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
