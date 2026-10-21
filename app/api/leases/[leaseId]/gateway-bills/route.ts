import { NextResponse } from 'next/server'
import { getActor } from '@/lib/auth'
import { handle } from '@/lib/http'
import { createGatewayBill } from '@/lib/leases'

// POST /api/leases/:leaseId/gateway-bills (the lease's tenant)
export async function POST(req: Request, ctx: RouteContext<'/api/leases/[leaseId]/gateway-bills'>) {
  return handle(async () => {
    const actor = await getActor(req)
    const { leaseId } = await ctx.params
    const result = await createGatewayBill(actor, leaseId, new Date())
    return NextResponse.json(result, { status: 201 })
  })
}
