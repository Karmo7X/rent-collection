import { NextResponse } from 'next/server'
import { getActor } from '@/lib/auth'
import { handle } from '@/lib/http'
import { collectionsReport } from '@/lib/reports'

// GET /api/reports/collections?from=YYYY-MM&to=YYYY-MM (staff, manager)
export async function GET(req: Request) {
  return handle(async () => {
    const actor = await getActor(req)
    const { searchParams } = new URL(req.url)
    return NextResponse.json(await collectionsReport(actor, searchParams.get('from'), searchParams.get('to')))
  })
}
