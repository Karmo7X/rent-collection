// npm run seed: creates exactly the data in SPEC.md section 2 on a freshly
// reset database, THROUGH THE APP'S OWN SERVICES (createLease, recordPayment,
// approvePayment), so invoices and allocations are the ones the app produces.
//
// Run with `tsx --conditions=react-server` (see package.json) so the
// `server-only` guard in lib/ resolves to its no-op build outside Next.
import { config } from 'dotenv'

config({ path: '.env.local' })

/** Shared password of every seeded account (local test data only). */
const SEED_PASSWORD = 'RentCollect-2026!'

// Imported after dotenv so lib/prisma sees DATABASE_URL.
const { prisma } = await import('../lib/prisma')
const { createAdminClient } = await import('../lib/supabase/admin')
const { loadActor } = await import('../lib/actor')
const { createLease } = await import('../lib/leases')
const { recordPayment, approvePayment, SLIP_BUCKET } = await import('../lib/payments')
const { collectionsReport } = await import('../lib/reports')

const admin = createAdminClient()

/**
 * A minimal but valid one-page PDF with the given lines of text, so the
 * seeded slip opens in a browser. The xref table needs each object's exact
 * byte offset, so the file is assembled piece by piece (ASCII only).
 */
function buildSlipPdf(lines: string[]): string {
  const escape = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`)
  const text = lines
    .map((line, i) => `BT /F1 ${i === 0 ? 16 : 12} Tf 56 ${770 - i * 24} Td (${escape(line)}) Tj ET`)
    .join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefOffset = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return pdf
}

async function createUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({ email, password: SEED_PASSWORD, email_confirm: true })
  if (error || !data.user) throw new Error(`Could not create ${email}: ${error?.message}`)
  return data.user.id
}

async function main() {
  if ((await prisma.organizations.count()) > 0) {
    throw new Error('The database already has data. Run `npx supabase db reset` first.')
  }

  // --- Organizations ------------------------------------------------------
  const northwind = await prisma.organizations.create({ data: { name: 'Northwind Properties' } })
  const beta = await prisma.organizations.create({ data: { name: 'Beta Realty' } })

  // --- Staff and managers -------------------------------------------------
  const members = [
    { email: 'manager@northwind.test', orgId: northwind.id, role: 'manager' as const },
    { email: 'staff@northwind.test', orgId: northwind.id, role: 'staff' as const },
    { email: 'manager@beta.test', orgId: beta.id, role: 'manager' as const },
  ]
  const userIds: Record<string, string> = {}
  for (const m of members) {
    userIds[m.email] = await createUser(m.email)
    await prisma.memberships.create({ data: { user_id: userIds[m.email], org_id: m.orgId, role: m.role } })
  }

  // --- Tenants ------------------------------------------------------------
  const tenantSpecs = [
    { email: 'aisyah@northwind.test', name: 'Aisyah Rahman', orgId: northwind.id },
    { email: 'ben@northwind.test', name: 'Ben Lim', orgId: northwind.id },
    { email: 'probe@northwind.test', name: 'Probe Tenant', orgId: northwind.id },
    { email: 'chen@beta.test', name: 'Chen Wei', orgId: beta.id },
  ]
  const tenantIds: Record<string, string> = {}
  for (const t of tenantSpecs) {
    const userId = await createUser(t.email)
    const tenant = await prisma.tenants.create({
      data: { org_id: t.orgId, user_id: userId, full_name: t.name, email: t.email },
    })
    tenantIds[t.email] = tenant.id
  }

  // --- Units --------------------------------------------------------------
  const unitIds: Record<string, string> = {}
  for (const [orgId, name] of [
    [northwind.id, 'A-12-3'],
    [northwind.id, 'B-05-1'],
    [northwind.id, 'C-01-7'],
    [northwind.id, 'D-03-2'],
    [beta.id, 'KL-1'],
  ]) {
    unitIds[name] = (await prisma.units.create({ data: { org_id: orgId, name } })).id
  }

  // --- Leases (through the lease service, as each org's manager) -----------
  const northwindManager = await loadActor(userIds['manager@northwind.test'])
  const northwindStaff = await loadActor(userIds['staff@northwind.test'])
  const betaManager = await loadActor(userIds['manager@beta.test'])

  const aisyahLease = await createLease(northwindManager, {
    unitId: unitIds['A-12-3'],
    tenantId: tenantIds['aisyah@northwind.test'],
    startDate: '2026-01-31',
    endDate: '2026-07-15',
    monthlyRentSen: 150000,
    depositSen: 300000,
  })
  await createLease(northwindManager, {
    unitId: unitIds['B-05-1'],
    tenantId: tenantIds['ben@northwind.test'],
    startDate: '2026-01-01',
    endDate: '2026-04-15',
    monthlyRentSen: 100029,
    depositSen: 0,
  })
  await createLease(northwindManager, {
    unitId: unitIds['C-01-7'],
    tenantId: tenantIds['probe@northwind.test'],
    startDate: '2026-02-28',
    endDate: '2027-02-27',
    monthlyRentSen: 200000,
    depositSen: 400000,
  })
  await createLease(betaManager, {
    unitId: unitIds['KL-1'],
    tenantId: tenantIds['chen@beta.test'],
    startDate: '2026-03-15',
    endDate: '2027-03-14',
    monthlyRentSen: 220000,
    depositSen: 440000,
  })

  // --- Payments on Aisyah's lease -----------------------------------------
  // 1. Cash RM 3,000.00, 2026-01-31 10:00 Malaysia time, recorded by the manager (approved at once).
  await recordPayment(northwindManager, aisyahLease.id, {
    amountSen: 300000,
    method: 'cash',
    receivedAt: '2026-01-31T10:00:00+08:00',
  })

  // 2. Bank transfer RM 2,000.00, 2026-03-01 00:30 Malaysia time, recorded by
  //    staff with a slip, then approved by the manager.
  const slipPath = `${northwind.id}/seed-aisyah-bank-transfer.pdf`
  const slip = new Blob(
    [
      buildSlipPdf([
        'Online Banking - Fund Transfer Receipt (sample)',
        '',
        'Status: Successful',
        'Date: 01 Mar 2026, 00:30 (MYT)',
        'Reference: SEED-AISYAH-0301',
        'From: AISYAH RAHMAN',
        'To: NORTHWIND PROPERTIES SDN BHD',
        'Amount: RM 2,000.00',
        'Recipient reference: Unit A-12-3 rent',
      ]),
    ],
    { type: 'application/pdf' },
  )
  const upload = await admin.storage.from(SLIP_BUCKET).upload(slipPath, slip, { contentType: 'application/pdf' })
  if (upload.error) throw new Error(`Slip upload failed: ${upload.error.message}`)

  const transfer = await recordPayment(northwindStaff, aisyahLease.id, {
    amountSen: 200000,
    method: 'bank_transfer',
    receivedAt: '2026-03-01T00:30:00+08:00',
    slipPath,
  })
  await approvePayment(northwindManager, transfer.id)

  // --- Check ---------------------------------------------------------------
  const report = await collectionsReport(northwindManager, '2026-01', '2026-03')
  console.log('Seeded. Northwind collections 2026-01..2026-03:', JSON.stringify(report))
  console.log(`All accounts share the password: ${SEED_PASSWORD}`)
}

try {
  await main()
} finally {
  await prisma.$disconnect()
}
