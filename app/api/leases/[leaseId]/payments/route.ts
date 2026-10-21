import { NextResponse } from 'next/server'
import { getActor } from '@/lib/auth'
import { handle, readJson } from '@/lib/http'
import { recordPayment } from '@/lib/payments'

// POST /api/leases/:leaseId/payments (staff, manager)
export async function POST(req: Request, ctx: RouteContext<'/api/leases/[leaseId]/payments'>) {
  return handle(async () => {
    const actor = await getActor(req)
    const { leaseId } = await ctx.params
    const result = await recordPayment(actor, leaseId, await readJson(req))
    return NextResponse.json(result, { status: 201 })
  })
}
