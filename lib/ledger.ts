import type { Db, Tx } from '@/lib/prisma'

// Money bookkeeping for one lease. Every function here must run inside a
// transaction that has called lockLease() first: the lease row lock is what
// serializes concurrent payments / approvals / voids / webhooks on a lease, so
// the balances read below can't change until we commit.

/** Locks the lease row until the transaction ends. Always lock the lease FIRST (no deadlocks). */
export async function lockLease(tx: Tx, leaseId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM public.leases WHERE id = ${leaseId}::uuid FOR UPDATE`
}

export interface LeaseBalances {
  totalSen: bigint // sum of all invoices
  allocatedSen: bigint // sum of all allocations (approved payments)
  pendingSen: bigint // sum of payments still pending_verification
}

export async function leaseBalances(tx: Tx, leaseId: string): Promise<LeaseBalances> {
  // ::bigint because sum(bigint) returns numeric.
  const [row] = await tx.$queryRaw<Array<{ total: bigint; allocated: bigint; pending: bigint }>>`
    SELECT
      (SELECT coalesce(sum(amount_sen), 0) FROM public.invoices WHERE lease_id = ${leaseId}::uuid)::bigint AS total,
      (SELECT coalesce(sum(amount_sen), 0) FROM public.payment_allocations WHERE lease_id = ${leaseId}::uuid)::bigint AS allocated,
      (SELECT coalesce(sum(amount_sen), 0) FROM public.payments
        WHERE lease_id = ${leaseId}::uuid AND status = 'pending_verification')::bigint AS pending`
  return { totalSen: row.total, allocatedSen: row.allocated, pendingSen: row.pending }
}

export interface InvoiceWithPaid {
  id: string
  kind: 'deposit' | 'rent'
  period_index: number | null
  period_start: Date | null
  period_end: Date | null
  due_date: Date
  amount_sen: bigint
  paid_sen: bigint
}

/**
 * A lease's invoices with what's been allocated to each, in allocation order:
 * due date, then deposit before rent, then period index (SPEC section 4).
 */
export async function invoicesInAllocationOrder(db: Db, leaseId: string): Promise<InvoiceWithPaid[]> {
  return db.$queryRaw<InvoiceWithPaid[]>`
    SELECT i.id, i.kind::text AS kind, i.period_index, i.period_start, i.period_end, i.due_date, i.amount_sen,
           coalesce(sum(a.amount_sen), 0)::bigint AS paid_sen
    FROM public.invoices i
    LEFT JOIN public.payment_allocations a ON a.invoice_id = i.id
    WHERE i.lease_id = ${leaseId}::uuid
    GROUP BY i.id
    ORDER BY i.due_date, (i.kind = 'rent'), i.period_index NULLS FIRST`
}

/**
 * Allocates an approved payment to the lease's unpaid invoices in allocation
 * order, filling each before the next (not-yet-due ones included). Whatever
 * is left goes to payments.unapplied_sen.
 */
export async function allocatePayment(
  tx: Tx,
  payment: { id: string; org_id: string; lease_id: string; amount_sen: bigint },
): Promise<void> {
  let remaining = payment.amount_sen
  const allocations: Array<{ invoice_id: string; amount_sen: bigint }> = []

  for (const invoice of await invoicesInAllocationOrder(tx, payment.lease_id)) {
    if (remaining === 0n) break
    const unpaid = invoice.amount_sen - invoice.paid_sen
    if (unpaid <= 0n) continue
    const take = unpaid < remaining ? unpaid : remaining
    allocations.push({ invoice_id: invoice.id, amount_sen: take })
    remaining -= take
  }

  if (allocations.length > 0) {
    await tx.payment_allocations.createMany({
      data: allocations.map((a) => ({
        org_id: payment.org_id,
        lease_id: payment.lease_id,
        payment_id: payment.id,
        invoice_id: a.invoice_id,
        amount_sen: a.amount_sen,
      })),
    })
  }
  await tx.payments.update({ where: { id: payment.id }, data: { unapplied_sen: remaining } })
}

export async function writeAudit(
  tx: Tx,
  entry: { orgId: string; actorId: string | null; action: string; entityId: string; details?: Record<string, unknown> },
): Promise<void> {
  await tx.audit_log.create({
    data: {
      org_id: entry.orgId,
      actor_id: entry.actorId,
      action: entry.action,
      entity_id: entry.entityId,
      details: (entry.details ?? {}) as object,
    },
  })
}
