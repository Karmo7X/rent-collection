import 'server-only'
import { NextResponse } from 'next/server'
import { HttpError, INVALID_JSON } from '@/lib/errors'

/** Errors -> `{ error }` JSON. Unknown errors become a bare 500 (no details leak to the client). */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Unhandled API error:', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** The JSON body, or INVALID_JSON if it can't be parsed (rejected later by the service). */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    return INVALID_JSON
  }
}
