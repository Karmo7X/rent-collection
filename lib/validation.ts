import { z } from 'zod'
import { INVALID_JSON, badRequest } from '@/lib/errors'

/** Validates a request body; anything invalid (including bad JSON) is a 400. */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  if (body === INVALID_JSON) throw badRequest('Request body must be valid JSON')
  const result = schema.safeParse(body)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw badRequest(`${issue.path.join('.') || 'body'}: ${issue.message}`)
  }
  return result.data
}

// .int() in zod 4 also requires a safe integer, so no precision is lost.
const sen = z.number().int()
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')

export const createLeaseSchema = z.object({
  unitId: z.uuid(),
  tenantId: z.uuid(),
  startDate: calendarDate,
  endDate: calendarDate,
  monthlyRentSen: sen.positive(),
  depositSen: sen.nonnegative(),
})

export const recordPaymentSchema = z.object({
  amountSen: sen.positive(),
  method: z.enum(['cash', 'bank_transfer']),
  // Must carry an offset (Z or +08:00): a bare local time is ambiguous.
  receivedAt: z.iso.datetime({ offset: true }),
  slipPath: z.string().min(1).max(500).optional(),
})

export const reasonSchema = z.object({
  reason: z
    .string({ error: 'reason is required' })
    .trim()
    .min(5, 'reason must be at least 5 characters')
    .max(1000),
})
