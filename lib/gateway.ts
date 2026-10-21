import { badRequest, notFound, pgErrorCode, unprocessable } from '@/lib/errors'
import type { CallbackFields } from '@/lib/gateway-signature'
import { allocatePayment, lockLease, writeAudit } from '@/lib/ledger'
import { prisma } from '@/lib/prisma'

// Applies a gateway callback whose signature has ALREADY been verified
// (app/api/webhooks/gateway/route.ts). This is the only code that settles a bill.

export type CallbackOutcome = 'paid' | 'failed' | 'already_paid' | 'already_failed' | 'ignored_paid'

/** '2026-04-01 00:30:12 +0800' -> the instant it names. */
function parsePaidAt(value: string | undefined): Date {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec(value ?? '')
  if (!match) throw badRequest('paid_at must look like "YYYY-MM-DD HH:MM:SS +0800"')
  const instant = new Date(`${match[1]}T${match[2]}${match[3]}:${match[4]}`)
  if (Number.isNaN(instant.getTime())) throw badRequest('paid_at is not a real date and time')
  return instant
}

/**
 * Behavior table (SPEC section 5):
 *   unknown bill -> 404; paid=true with a different amount -> 422;
 *   paid=true on pending/failed -> bill paid + one approved online payment
 *     (received_at = paid_at), allocated; paid=true on paid -> no-op;
 *   paid=false on pending -> failed; paid=false on failed/paid -> no-op.
 *
 * Concurrency: the lease row is locked first (same order as every other money
 * operation), then the bill row; a duplicate callback waits, then sees the
 * bill already paid. unique(payments.gateway_bill_id) is the last guarantee.
 */
export async function applyGatewayCallback(fields: CallbackFields): Promise<CallbackOutcome> {
  const billId = fields.id
  const bill = billId ? await prisma.gateway_bills.findUnique({ where: { id: billId } }) : null
  if (!bill) throw notFound()

  if (fields.paid !== 'true' && fields.paid !== 'false') throw badRequest('paid must be true or false')
  const paid = fields.paid === 'true'

  let paidAt: Date | null = null
  if (paid) {
    const amount = fields.paid_amount ?? ''
    if (!/^\d{1,18}$/.test(amount) || BigInt(amount) !== bill.amount_sen) {
      throw unprocessable("paid_amount does not match the bill's amount")
    }
    paidAt = parsePaidAt(fields.paid_at)
  }
  const transactionId = fields.transaction_id?.slice(0, 200) || null

  try {
    return await prisma.$transaction(async (tx) => {
      await lockLease(tx, bill.lease_id)
      await tx.$queryRaw`SELECT id FROM public.gateway_bills WHERE id = ${bill.id} FOR UPDATE`
      const current = await tx.gateway_bills.findUniqueOrThrow({ where: { id: bill.id } })

      if (!paid) {
        if (current.status !== 'pending') return current.status === 'paid' ? 'ignored_paid' : 'already_failed'
        await tx.gateway_bills.update({
          where: { id: bill.id },
          data: { status: 'failed', transaction_id: transactionId, updated_at: new Date() },
        })
        return 'failed'
      }

      // A paid bill never changes again, and never makes a second payment.
      if (current.status === 'paid') return 'already_paid'

      await tx.gateway_bills.update({
        where: { id: bill.id },
        data: { status: 'paid', paid_at: paidAt, transaction_id: transactionId, updated_at: new Date() },
      })
      const payment = await tx.payments.create({
        data: {
          org_id: bill.org_id,
          lease_id: bill.lease_id,
          amount_sen: bill.amount_sen,
          method: 'online',
          status: 'approved',
          received_at: paidAt!,
          gateway_bill_id: bill.id,
          decided_at: new Date(),
        },
      })
      // Online payments aren't capped: anything beyond the lease's unpaid
      // invoices ends up in unapplied_sen.
      await allocatePayment(tx, payment)
      await writeAudit(tx, {
        orgId: bill.org_id,
        actorId: null,
        action: 'payment.online',
        entityId: payment.id,
        details: { billId: bill.id, transactionId, amountSen: bill.amount_sen.toString() },
      })
      return 'paid'
    })
  } catch (error) {
    // Backstop: the unique constraint stopped a second payment for this bill.
    if (pgErrorCode(error) === '23505') return 'already_paid'
    throw error
  }
}
