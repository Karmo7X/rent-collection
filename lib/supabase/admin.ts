import 'server-only'
import { createClient } from '@supabase/supabase-js'

/**
 * Secret-key client. SERVER ONLY (the `server-only` import makes a client
 * bundle that imports this fail to build). Used for: seeding auth users,
 * and deleting a slip left behind by a failed payment. Never for table access.
 */
export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!secretKey) throw new Error('SUPABASE_SECRET_KEY is not set')
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
