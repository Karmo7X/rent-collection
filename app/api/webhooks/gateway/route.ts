import { NextResponse } from 'next/server'
import { applyGatewayCallback } from '@/lib/gateway'
import { isValidSignature, parseCallbackBody } from '@/lib/gateway-signature'
import { handle } from '@/lib/http'

// POST /api/webhooks/gateway: called by the payment gateway, not a user.
// Never log the secret key or the payload; only the bill id and the outcome.
export async function POST(req: Request) {
  return handle(async () => {
    const secretKey = process.env.GATEWAY_X_SIGNATURE_KEY
    if (!secretKey) throw new Error('GATEWAY_X_SIGNATURE_KEY is not set')

    // Verify the signature over the raw form fields before touching the database.
    const fields = parseCallbackBody(await req.text())
    if (!fields || !isValidSignature(fields, secretKey)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const outcome = await applyGatewayCallback(fields)
    console.info(`gateway callback: bill=${fields.id} outcome=${outcome}`)
    return NextResponse.json({ ok: true, outcome })
  })
}
