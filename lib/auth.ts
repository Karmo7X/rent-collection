import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { type Actor, loadActor } from '@/lib/actor'
import { unauthorized } from '@/lib/errors'
import { createClient } from '@/lib/supabase/server'

/**
 * Authenticates the request and returns the Actor. Throws 401 without a valid login.
 *
 * `Authorization: Bearer <access token>` is used if present (it wins over the
 * cookie), otherwise the session cookie. Both are verified against the Auth
 * server with getUser(), never getSession() (which trusts the cookie as-is).
 */
export async function getActor(req: Request): Promise<Actor> {
  const userId = await authenticatedUserId(req)
  if (!userId) throw unauthorized()
  return loadActor(userId)
}

/**
 * For pages (server components): the Actor from the session cookie, or a
 * redirect to /login. Must be called inside a <Suspense> boundary
 * (cacheComponents: reading cookies is request-time work).
 */
export async function getPageActor(): Promise<Actor> {
  // Marks the rest of the render as request-time (cacheComponents): getUser()
  // checks token expiry against the clock, and pages use `new Date()` after this.
  await connection()
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) redirect('/login')
  return loadActor(data.user.id)
}

async function authenticatedUserId(req: Request): Promise<string | null> {
  const header = req.headers.get('authorization')
  if (header) {
    const match = /^Bearer\s+(\S+)$/i.exec(header)
    if (!match) return null
    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
    const { data, error } = await supabase.auth.getUser(match[1])
    return error ? null : (data.user?.id ?? null)
  }
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  return error ? null : (data.user?.id ?? null)
}
