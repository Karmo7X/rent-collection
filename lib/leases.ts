import { type Actor, requireRole } from '@/lib/actor'
import { generateSchedule, invoiceStatus, malaysiaToday, type InvoiceStatus } from '@/lib/billing'
import { fromDbDate, isUuid, toDbDate, toMalaysiaIso, toSen } from '@/lib/convert'
import { badRequest, conflict, forbidden, notFound, pgErrorCode, unprocessable } from '@/lib/errors'
import { invoicesInAllocationOrder, writeAudit } from '@/lib/ledger'
import { prisma, type Db } from '@/lib/prisma'
import { createLeaseSchema, parseBody } from '@/lib/validation'

/**
 * The lease if the actor may see it, else 404 (also for ids that don't exist
 * or aren't UUIDs, so the response never reveals another org's records).
 * Staff/managers: leases of their org. Tenants: their own leases.
 */
export async function findLeaseForActor(db: Db, actor: Actor, leaseId: string) {
  if (!isUuid(leaseId) || actor.kind === 'none') throw notFound()
  const lease = await db.leases.findFirst({
    where: actor.kind === 'member' ? { id: leaseId, org_id: actor.orgId } : { id: leaseId, tenant_id: actor.tenantId },
  })
  if (!lease) throw notFound()
  return lease
}

/** POST /api/leases: stores the lease and exactly generateSchedule's invoices, all or nothing. */
export async function createLease(actor: Actor, body: unknown): Promise<{ id: string }> {
  requireRole(actor, 'manager')
  const input = parseBody(createLeaseSchema, body)

  let schedule
  try {
    schedule = generateSchedule(input)
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : 'Invalid lease')
  }

  // Body ids are untrusted: the unit and tenant must be in the manager's own org.
  const [unit, tenant] = await Promise.all([
    prisma.units.findFirst({ where: { id: input.unitId, org_id: actor.orgId } }),
    prisma.tenants.findFirst({ where: { id: input.tenantId, org_id: actor.orgId } }),
  ])
  if (!unit || !tenant) throw notFound()

  try {
    return await prisma.$transaction(async (tx) => {
      const lease = await tx.leases.create({
        data: {
          org_id: actor.orgId,
          unit_id: unit.id,
          tenant_id: tenant.id,
          start_date: toDbDate(input.startDate),
          end_date: toDbDate(input.endDate),
          monthly_rent_sen: BigInt(input.monthlyRentSen),
          deposit_sen: BigInt(input.depositSen),
          created_by: actor.userId,
        },
      })
      await tx.invoices.createMany({
        data: schedule.map((invoice) => ({
          org_id: actor.orgId,
          lease_id: lease.id,
          kind: invoice.kind,
          period_index: invoice.periodIndex,
          period_start: invoice.periodStart === null ? null : toDbDate(invoice.periodStart),
          period_end: invoice.periodEnd === null ? null : toDbDate(invoice.periodEnd),
          due_date: toDbDate(invoice.dueDate),
          amount_sen: BigInt(invoice.amountSen),
        })),
      })
      await writeAudit(tx, {
        orgId: actor.orgId,
        actorId: actor.userId,
        action: 'lease.create',
        entityId: lease.id,
        details: { ...input, invoiceCount: schedule.length },
      })
      return { id: lease.id }
    })
  } catch (error) {
    // The exclusion constraint leases_no_overlap: also catches two concurrent creates.
    if (pgErrorCode(error) === '23P01') throw conflict('The lease overlaps another lease on this unit')
    throw error
  }
}

export interface LeaseDetail {
  lease: {
    id: string
    unitId: string
    tenantId: string
    startDate: string
    endDate: string
    monthlyRentSen: number
    depositSen: number
  }
  invoices: Array<{
    id: string
    kind: 'deposit' | 'rent'
    periodIndex: number | null
    periodStart: string | null
    periodEnd: string | null
    dueDate: string
    amountSen: number
    paidSen: number
    status: InvoiceStatus
  }>
  payments: Array<{
    id: string
    amountSen: number
    unappliedSen: number
    method: 'cash' | 'bank_transfer' | 'online'
    status: 'pending_verification' | 'approved' | 'rejected' | 'voided'
    receivedAt: string
  }>
}

/** GET /api/leases/:leaseId for staff, managers and the lease's tenant. */
export async function getLeaseDetail(actor: Actor, leaseId: string, now: Date): Promise<LeaseDetail> {
  const lease = await findLeaseForActor(prisma, actor, leaseId)

  const [invoices, payments] = await Promise.all([
    invoicesInAllocationOrder(prisma, lease.id),
    prisma.payments.findMany({ where: { lease_id: lease.id }, orderBy: [{ received_at: 'asc' }, { created_at: 'asc' }] }),
  ])

  return {
    lease: {
      id: lease.id,
      unitId: lease.unit_id,
      tenantId: lease.tenant_id,
      startDate: fromDbDate(lease.start_date),
      endDate: fromDbDate(lease.end_date),
      monthlyRentSen: toSen(lease.monthly_rent_sen),
      depositSen: toSen(lease.deposit_sen),
    },
    invoices: invoices.map((invoice) => {
      const dueDate = fromDbDate(invoice.due_date)
      const amountSen = toSen(invoice.amount_sen)
      const paidSen = toSen(invoice.paid_sen)
      return {
        id: invoice.id,
        kind: invoice.kind,
        periodIndex: invoice.period_index,
        periodStart: invoice.period_start && fromDbDate(invoice.period_start),
        periodEnd: invoice.period_end && fromDbDate(invoice.period_end),
        dueDate,
        amountSen,
        paidSen,
        status: invoiceStatus({ dueDate, amountSen, paidSen }, now),
      }
    }),
    payments: payments.map((payment) => ({
      id: payment.id,
      amountSen: toSen(payment.amount_sen),
      unappliedSen: toSen(payment.unapplied_sen),
      method: payment.method,
      status: payment.status,
      receivedAt: toMalaysiaIso(payment.received_at),
    })),
  }
}

export interface LeaseSummary {
  id: string
  unitName: string
  tenantName: string
  startDate: string
  endDate: string
  monthlyRentSen: number
  totalSen: number
  paidSen: number
}

/** Leases list: staff/managers see their org's, tenants their own. */
export async function listLeases(actor: Actor): Promise<LeaseSummary[]> {
  if (actor.kind === 'none') return []
  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      unit_name: string
      tenant_name: string
      start_date: Date
      end_date: Date
      monthly_rent_sen: bigint
      total: bigint
      paid: bigint
    }>
  >`
    SELECT l.id, u.name AS unit_name, t.full_name AS tenant_name, l.start_date, l.end_date, l.monthly_rent_sen,
           (SELECT coalesce(sum(i.amount_sen), 0) FROM public.invoices i WHERE i.lease_id = l.id)::bigint AS total,
           (SELECT coalesce(sum(a.amount_sen), 0) FROM public.payment_allocations a WHERE a.lease_id = l.id)::bigint AS paid
    FROM public.leases l
    JOIN public.units u ON u.id = l.unit_id
    JOIN public.tenants t ON t.id = l.tenant_id
    WHERE l.org_id = ${actor.orgId}::uuid
      AND (${actor.kind === 'member'} OR l.tenant_id = ${actor.kind === 'tenant' ? actor.tenantId : null}::uuid)
    ORDER BY u.name, l.start_date`
  return rows.map((row) => ({
    id: row.id,
    unitName: row.unit_name,
    tenantName: row.tenant_name,
    startDate: fromDbDate(row.start_date),
    endDate: fromDbDate(row.end_date),
    monthlyRentSen: toSen(row.monthly_rent_sen),
    totalSen: toSen(row.total),
    paidSen: toSen(row.paid),
  }))
}

export interface LeasePageData extends LeaseDetail {
  unitName: string
  tenantName: string
  amountDueNowSen: number
  paymentExtras: Record<string, { slipPath: string | null; reason: string | null; billId: string | null }>
}

/** Everything the lease page shows; visibility is checked by getLeaseDetail. */
export async function getLeasePageData(actor: Actor, leaseId: string, now: Date): Promise<LeasePageData> {
  const detail = await getLeaseDetail(actor, leaseId, now)
  const [unit, tenant, payments] = await Promise.all([
    prisma.units.findUniqueOrThrow({ where: { id: detail.lease.unitId } }),
    prisma.tenants.findUniqueOrThrow({ where: { id: detail.lease.tenantId } }),
    prisma.payments.findMany({
      where: { lease_id: detail.lease.id },
      select: { id: true, slip_path: true, reason: true, gateway_bill_id: true },
    }),
  ])
  const today = malaysiaToday(now)
  return {
    ...detail,
    unitName: unit.name,
    tenantName: tenant.full_name,
    amountDueNowSen: detail.invoices
      .filter((invoice) => invoice.dueDate <= today)
      .reduce((sum, invoice) => sum + Math.max(invoice.amountSen - invoice.paidSen, 0), 0),
    paymentExtras: Object.fromEntries(
      payments.map((p) => [p.id, { slipPath: p.slip_path, reason: p.reason, billId: p.gateway_bill_id }]),
    ),
  }
}

/**
 * POST /api/leases/:leaseId/gateway-bills, for the lease's own tenant.
 * Amount = unpaid part of the invoices due on or before today (Malaysia).
 */
export async function createGatewayBill(actor: Actor, leaseId: string, now: Date) {
  const lease = await findLeaseForActor(prisma, actor, leaseId)
  // Visible to staff/managers too, but only the tenant can pay online.
  if (actor.kind !== 'tenant') throw forbidden()

  const today = malaysiaToday(now)
  const dueSen = (await invoicesInAllocationOrder(prisma, lease.id))
    .filter((invoice) => fromDbDate(invoice.due_date) <= today)
    .reduce((sum, invoice) => sum + (invoice.amount_sen - invoice.paid_sen), 0n)
  if (dueSen <= 0n) throw unprocessable('Nothing is due on this lease')

  const bill = await prisma.gateway_bills.create({
    data: { org_id: lease.org_id, lease_id: lease.id, amount_sen: dueSen, created_by: actor.userId },
  })
  return { billId: bill.id, amountSen: toSen(bill.amount_sen) }
}
