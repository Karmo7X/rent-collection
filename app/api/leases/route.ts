import { NextResponse } from 'next/server'
import { getActor } from '@/lib/auth'
import { handle, readJson } from '@/lib/http'
import { createLease } from '@/lib/leases'

// POST /api/leases (manager)
export async function POST(req: Request) {
  return handle(async () => {
    const actor = await getActor(req)
    const result = await createLease(actor, await readJson(req))
    return NextResponse.json(result, { status: 201 })
  })
}
