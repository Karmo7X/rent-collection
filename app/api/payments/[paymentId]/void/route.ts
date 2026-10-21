import { NextResponse } from 'next/server'
import { getActor } from '@/lib/auth'
import { handle, readJson } from '@/lib/http'
import { voidPayment } from '@/lib/payments'

// POST /api/payments/:paymentId/void (manager)
export async function POST(req: Request, ctx: RouteContext<'/api/payments/[paymentId]/void'>) {
  return handle(async () => {
    const actor = await getActor(req)
    const { paymentId } = await ctx.params
    return NextResponse.json(await voidPayment(actor, paymentId, await readJson(req)))
  })
}
