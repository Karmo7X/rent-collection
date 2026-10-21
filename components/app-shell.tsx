import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Actor } from '@/lib/actor'
import { prisma } from '@/lib/prisma'
import { Brand } from '@/components/brand'
import { LogoutButton } from '@/components/logout-button'
import { NavLinks } from '@/components/nav-links'
import { Skeleton } from '@/components/ui/skeleton'

const ROLE_LABEL = { manager: 'Manager', staff: 'Staff', tenant: 'Tenant' } as const

/** Page chrome for a signed-in user. Rendered inside the page's Suspense boundary. */
export async function AppShell({ actor, children }: { actor: Actor; children: ReactNode }) {
  const org = actor.kind === 'none' ? null : await prisma.organizations.findUnique({ where: { id: actor.orgId } })
  const role = actor.kind === 'member' ? actor.role : actor.kind === 'tenant' ? 'tenant' : null
  const links =
    actor.kind === 'member'
      ? [
          { href: '/dashboard', label: 'Dashboard' },
          { href: '/leases', label: 'Leases' },
        ]
      : actor.kind === 'tenant'
        ? [{ href: '/portal', label: 'My lease' }]
        : []

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <Link href="/" aria-label="Home">
            <Brand />
          </Link>
          {links.length > 0 && <NavLinks links={links} />}
          <div className="ml-auto flex items-center gap-3">
            {org && (
              <div className="hidden text-right sm:block">
                <div className="text-sm font-medium leading-tight">{org.name}</div>
                {role && <div className="text-xs text-muted-foreground">{ROLE_LABEL[role]}</div>}
              </div>
            )}
            {org && (
              <span className="grid size-9 place-items-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">
                {org.name.charAt(0)}
              </span>
            )}
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  )
}

/** Page title row: eyebrow, title, optional description and actions. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="mb-1 text-sm font-medium text-primary">{eyebrow}</div>}
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  )
}

/** Loading state shown while a page's data streams in. */
export function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-12 w-full rounded-xl" />
      <Skeleton className="h-9 w-64" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
      <Skeleton className="h-72 w-full rounded-2xl" />
    </div>
  )
}
