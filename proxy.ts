import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Keeps the Supabase session cookie fresh (Next 16 `proxy`, formerly middleware).
// This is NOT an authorization check: every page and route handler checks the
// user and role itself.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value)
          response = NextResponse.next({ request })
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options)
        },
      },
    },
  )
  // Refreshes an expired access token using the refresh token, if needed.
  await supabase.auth.getUser()
  return response
}

export const config = {
  // Skip static files and the API (API callers use Bearer tokens or send the cookie as-is).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
}
