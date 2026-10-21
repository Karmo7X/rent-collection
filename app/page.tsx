import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { PageSkeleton } from '@/components/app-shell'
import { getPageActor } from '@/lib/auth'

export default function HomePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RoleRedirect />
    </Suspense>
  )
}

/** Sends each role to its home: staff/managers to the dashboard, tenants to their portal. */
async function RoleRedirect(): Promise<never> {
  const actor = await getPageActor()
  if (actor.kind === 'member') redirect('/dashboard')
  if (actor.kind === 'tenant') redirect('/portal')
  redirect('/login?no_access=1')
}
