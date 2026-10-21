import { type Actor, type MemberActor, requireRole } from '@/lib/actor'
import { isUuid } from '@/lib/convert'
import { badRequest, conflict, notFound, unprocessable } from '@/lib/errors'
import { allocatePayment, leaseBalances, lockLease, writeAudit } from '@/lib/ledger'
import { findLeaseForActor } from '@/lib/leases'
import { prisma, type Tx } from '@/lib/prisma'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseBody, reasonSchema, recordPaymentSchema } from '@/lib/validation'

export const SLIP_BUCKET = 'payment-slips'

type PaymentStatus = 'pending_verification' | 'approved' | 'rejected' | 'voided'

/**
 * The payment if the actor may see it, else 404: staff/managers see their
 * org's payments, tenants the payments on their own leases.
 */
async function findPaymentForActor(actor: Actor, paymentId: string) {
  if (!isUuid(paymentId) || actor.kind === 'none') throw notFound()
  const payment = await prisma.payments.findFirst({
    where:
      actor.kind === 'member'
        ? { id: paymentId, org_id: actor.orgId }
        : { id: paymentId, leases: { tenant_id: actor.tenantId } },
  })
  if (!payment) throw notFound()
  return payment
}

/** Re-reads the payment after the lease lock is held, so its status is current. */
async function lockedPayment(tx: Tx, paymentId: string) {
  return tx.payments.findUniqueOrThrow({ where: { id: paymentId } })
}

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

/**
 * POST /api/leases/:leaseId/payments (staff, managers).
 * Manager -> approved and allocated at once; staff -> pending_verification.
 * Cap: amount <= remaining balance - pending payments, checked under the lease lock.
 * If anything fails, an uploaded slip is removed so it isn't left behind.
 */
export async function recordPayment(actor: Actor, leaseId: string, body: unknown): Promise<{ id: string; status: PaymentStatus }> {
  try {
    const lease = await findLeaseForActor(prisma, actor, leaseId)
    requireRole(actor, 'manager', 'staff')
    const input = parseBody(recordPaymentSchema, body)

    if (input.method === 'bank_transfer' && !input.slipPath) throw badRequest('slipPath is required for a bank transfer')
    if (input.method === 'cash' && input.slipPath) throw badRequest('slipPath is only for bank transfers')
    if (input.slipPath) await assertSlipUsable(actor, input.slipPath)

    const amountSen = BigInt(input.amountSen)
    const approved = actor.role === 'manager'

    return await prisma.$transaction(async (tx) => {
      await lockLease(tx, lease.id)
      const { totalSen, allocatedSen, pendingSen } = await leaseBalances(tx, lease.id)
      const capSen = totalSen - allocatedSen - pendingSen
      if (amountSen > capSen) throw unprocessable(`Amount is over the cap of ${capSen} sen`)

      const now = new Date()
      const payment = await tx.payments.create({
        data: {
          org_id: lease.org_id,
          lease_id: lease.id,
          amount_sen: amountSen,
          method: input.method,
          status: approved ? 'approved' : 'pending_verification',
          received_at: new Date(input.receivedAt),
          slip_path: input.slipPath ?? null,
          recorded_by: actor.userId,
          decided_by: approved ? actor.userId : null,
          decided_at: approved ? now : null,
        },
      })
      if (approved) {
        await allocatePayment(tx, payment)
        await writeAudit(tx, {
          orgId: lease.org_id,
          actorId: actor.userId,
          action: 'payment.approve',
          entityId: payment.id,
          details: { amountSen: input.amountSen, method: input.method, recordedByManager: true },
        })
      }
      return { id: payment.id, status: payment.status }
    })
  } catch (error) {
    await removeOrphanSlip(actor, body)
    throw error
  }
}

/** The slip must be in the caller's org folder, exist in storage, and not be used by another payment. */
async function assertSlipUsable(actor: MemberActor, slipPath: string): Promise<void> {
  if (!slipPath.startsWith(`${actor.orgId}/`) || slipPath.split('/').some((part) => part === '..' || part === '.')) {
    throw badRequest("slipPath must be a file in your organization's folder")
  }
  const [exists] = await prisma.$queryRaw<Array<{ found: number }>>`
    SELECT 1 AS found FROM storage.objects WHERE bucket_id = ${SLIP_BUCKET} AND name = ${slipPath}`
  if (!exists) throw badRequest('slipPath does not point to an uploaded file')
  if (await prisma.payments.findFirst({ where: { slip_path: slipPath }, select: { id: true } })) {
    throw badRequest('This slip is already attached to another payment')
  }
}

/** After a failed recording: delete the uploaded slip, if it's in the caller's org and unused. */
async function removeOrphanSlip(actor: Actor, body: unknown): Promise<void> {
  const slipPath = typeof body === 'object' && body !== null ? (body as { slipPath?: unknown }).slipPath : undefined
  if (actor.kind !== 'member' || typeof slipPath !== 'string' || !slipPath.startsWith(`${actor.orgId}/`)) return
  try {
    if (await prisma.payments.findFirst({ where: { slip_path: slipPath }, select: { id: true } })) return
    await createAdminClient().storage.from(SLIP_BUCKET).remove([slipPath])
  } catch {
    console.error('Could not remove an orphaned payment slip')
  }
}

// ---------------------------------------------------------------------------
// Approve / reject / void (managers only)
// ---------------------------------------------------------------------------

/** POST /api/payments/:paymentId/approve. Re-checks the remaining balance; refuses (and leaves it pending) if over. */
export async function approvePayment(actor: Actor, paymentId: string): Promise<{ status: PaymentStatus }> {
  const found = await findPaymentForActor(actor, paymentId)
  requireRole(actor, 'manager')

  return prisma.$transaction(async (tx) => {
    await lockLease(tx, found.lease_id)
    // Under the lock: a concurrent approval has either committed (we see
    // 'approved' and stop) or hasn't started, so it's allocated only once.
    const payment = await lockedPayment(tx, found.id)
    if (payment.status !== 'pending_verification') throw conflict('Payment is not pending verification')

    const { totalSen, allocatedSen } = await leaseBalances(tx, payment.lease_id)
    if (payment.amount_sen > totalSen - allocatedSen) {
      throw unprocessable('Payment is more than the remaining balance')
    }

    await tx.payments.update({
      where: { id: payment.id },
      data: { status: 'approved', decided_by: actor.userId, decided_at: new Date() },
    })
    await allocatePayment(tx, payment)
    await writeAudit(tx, {
      orgId: payment.org_id,
      actorId: actor.userId,
      action: 'payment.approve',
      entityId: payment.id,
      details: { amountSen: payment.amount_sen.toString(), method: payment.method },
    })
    return { status: 'approved' as const }
  })
}

/** POST /api/payments/:paymentId/reject, with a reason of at least 5 characters. */
export async function rejectPayment(actor: Actor, paymentId: string, body: unknown): Promise<{ status: PaymentStatus }> {
  const found = await findPaymentForActor(actor, paymentId)
  requireRole(actor, 'manager')
  const { reason } = parseBody(reasonSchema, body)

  return prisma.$transaction(async (tx) => {
    await lockLease(tx, found.lease_id)
    const payment = await lockedPayment(tx, found.id)
    if (payment.status !== 'pending_verification') throw conflict('Payment is not pending verification')

    await tx.payments.update({
      where: { id: payment.id },
      data: { status: 'rejected', reason, decided_by: actor.userId, decided_at: new Date() },
    })
    await writeAudit(tx, {
      orgId: payment.org_id,
      actorId: actor.userId,
      action: 'payment.reject',
      entityId: payment.id,
      details: { reason },
    })
    return { status: 'rejected' as const }
  })
}

/**
 * POST /api/payments/:paymentId/void, with a reason of at least 5 characters.
 * Removes only this payment's allocations; other payments' allocations (and
 * any unapplied_sen they hold) are left exactly as they were.
 */
export async function voidPayment(actor: Actor, paymentId: string, body: unknown): Promise<{ status: PaymentStatus }> {
  const found = await findPaymentForActor(actor, paymentId)
  requireRole(actor, 'manager')
  const { reason } = parseBody(reasonSchema, body)

  return prisma.$transaction(async (tx) => {
    await lockLease(tx, found.lease_id)
    const payment = await lockedPayment(tx, found.id)
    if (payment.status !== 'approved') throw conflict('Only approved payments can be voided')

    const removed = await tx.payment_allocations.deleteMany({ where: { payment_id: payment.id } })
    await tx.payments.update({
      where: { id: payment.id },
      data: { status: 'voided', reason, decided_by: actor.userId, decided_at: new Date() },
    })
    await writeAudit(tx, {
      orgId: payment.org_id,
      actorId: actor.userId,
      action: 'payment.void',
      entityId: payment.id,
      details: { reason, allocationsRemoved: removed.count },
    })
    return { status: 'voided' as const }
  })
}
