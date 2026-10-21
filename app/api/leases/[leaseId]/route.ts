import { NextResponse } from 'next/server'
import { getActor } from '@/lib/auth'
import { handle } from '@/lib/http'
import { getLeaseDetail } from '@/lib/leases'

// GET /api/leases/:leaseId (staff, manager, the lease's tenant)
export async function GET(req: Request, ctx: RouteContext<'/api/leases/[leaseId]'>) {
  return handle(async () => {
    const actor = await getActor(req)
    const { leaseId } = await ctx.params
    return NextResponse.json(await getLeaseDetail(actor, leaseId, new Date()))
  })
}
