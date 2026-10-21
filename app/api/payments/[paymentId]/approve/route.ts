import { NextResponse } from 'next/server'
import { getActor } from '@/lib/auth'
import { handle } from '@/lib/http'
import { approvePayment } from '@/lib/payments'

// POST /api/payments/:paymentId/approve (manager)
export async function POST(req: Request, ctx: RouteContext<'/api/payments/[paymentId]/approve'>) {
  return handle(async () => {
    const actor = await getActor(req)
    const { paymentId } = await ctx.params
    return NextResponse.json(await approvePayment(actor, paymentId))
  })
}
