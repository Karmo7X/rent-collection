import { NextResponse } from 'next/server'
import { getActor } from '@/lib/auth'
import { handle, readJson } from '@/lib/http'
import { rejectPayment } from '@/lib/payments'

// POST /api/payments/:paymentId/reject (manager)
export async function POST(req: Request, ctx: RouteContext<'/api/payments/[paymentId]/reject'>) {
  return handle(async () => {
    const actor = await getActor(req)
    const { paymentId } = await ctx.params
    return NextResponse.json(await rejectPayment(actor, paymentId, await readJson(req)))
  })
}
