import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Actor } from '@/lib/actor'
import { prisma } from '@/lib/prisma'
import { LogoutButton } from '@/components/logout-button'
import { Skeleton } from '@/components/ui/skeleton'

const ROLE_LABEL = { manager: 'Manager', staff: 'Staff', tenant: 'Tenant' } as const

/** Page chrome for a signed-in user. Rendered inside the page's Suspense boundary. */
export async function AppShell({ actor, children }: { actor: Actor; children: ReactNode }) {
  const org = actor.kind === 'none' ? null : await prisma.organizations.findUnique({ where: { id: actor.orgId } })
  const role = actor.kind === 'member' ? actor.role : actor.kind === 'tenant' ? 'tenant' : null

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <span className="font-semibold">Rent Collection</span>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            {actor.kind === 'member' && (
              <>
                <Link href="/dashboard" className="hover:text-foreground">Dashboard</Link>
                <Link href="/leases" className="hover:text-foreground">Leases</Link>
              </>
            )}
            {actor.kind === 'tenant' && <Link href="/portal" className="hover:text-foreground">My lease</Link>}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {org && <span className="text-muted-foreground">{org.name}</span>}
            {role && <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{ROLE_LABEL[role]}</span>}
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  )
}

/** Loading state shown while a page's data streams in. */
export function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}
