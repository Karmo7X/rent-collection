import { type Actor, requireRole } from '@/lib/actor'
import { badRequest } from '@/lib/errors'
import { toSen } from '@/lib/convert'
import { prisma } from '@/lib/prisma'

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/
const MAX_MONTHS = 120

function monthIndex(value: string | null, name: string): number {
  const match = value === null ? null : MONTH_PATTERN.exec(value)
  if (!match) throw badRequest(`${name} must be YYYY-MM`)
  return Number(match[1]) * 12 + Number(match[2]) - 1
}

/**
 * GET /api/reports/collections?from=YYYY-MM&to=YYYY-MM (staff, managers).
 * Approved payments per calendar month of received_at in MALAYSIA time,
 * one entry per month in order, including months with nothing collected.
 */
export async function collectionsReport(actor: Actor, from: string | null, to: string | null) {
  requireRole(actor, 'manager', 'staff')
  const fromIndex = monthIndex(from, 'from')
  const toIndex = monthIndex(to, 'to')
  if (fromIndex > toIndex) throw badRequest('from must not be after to')
  if (toIndex - fromIndex + 1 > MAX_MONTHS) throw badRequest(`The range can be at most ${MAX_MONTHS} months`)

  // Month boundaries are Malaysia midnights: `timestamp AT TIME ZONE zone`
  // reads a wall-clock time in that zone and returns the matching instant.
  const rows = await prisma.$queryRaw<Array<{ month: string; collected: bigint }>>`
    SELECT to_char(m.month_start, 'YYYY-MM') AS month,
           coalesce(sum(p.amount_sen), 0)::bigint AS collected
    -- Explicit ::timestamp (no time zone) so the series never depends on the DB session's TimeZone.
    FROM generate_series(${`${from}-01`}::timestamp, ${`${to}-01`}::timestamp, interval '1 month') AS m(month_start)
    LEFT JOIN public.payments p
      ON p.org_id = ${actor.orgId}::uuid
     AND p.status = 'approved'
     AND p.received_at >= (m.month_start AT TIME ZONE 'Asia/Kuala_Lumpur')
     AND p.received_at <  ((m.month_start + interval '1 month') AT TIME ZONE 'Asia/Kuala_Lumpur')
    GROUP BY m.month_start
    ORDER BY m.month_start`

  return rows.map((row) => ({ month: row.month, collectedSen: toSen(row.collected) }))
}
