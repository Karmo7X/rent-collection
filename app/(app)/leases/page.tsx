import { ArrowUpRight, CalendarRange } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { AppShell, PageHeader, PageSkeleton } from '@/components/app-shell'
import { ProgressBar } from '@/components/stat-card'
import { getPageActor } from '@/lib/auth'
import { formatDate, formatSen } from '@/lib/format'
import { listLeases } from '@/lib/leases'

export const metadata = { title: 'Leases · Sewa' }

export default function LeasesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Leases />
    </Suspense>
  )
}

async function Leases() {
  const actor = await getPageActor()
  if (actor.kind !== 'member') redirect('/')
  const leases = await listLeases(actor)

  return (
    <AppShell actor={actor}>
      <PageHeader
        eyebrow="Portfolio"
        title="Leases"
        description={`${leases.length} lease${leases.length === 1 ? '' : 's'} in your organization.`}
      />
      {leases.length === 0 ? (
        <div className="grid place-items-center rounded-2xl border border-dashed bg-card py-16 text-center">
          <span className="font-medium">No leases yet</span>
          <span className="text-sm text-muted-foreground">Leases created by a manager will appear here.</span>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {leases.map((lease) => {
            const outstanding = lease.totalSen - lease.paidSen
            return (
              <Link
                key={lease.id}
                href={`/leases/${lease.id}`}
                className="group flex flex-col rounded-2xl border bg-card p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <span className="rounded-lg bg-secondary px-2.5 py-1 font-mono text-sm font-semibold text-secondary-foreground">
                    {lease.unitName}
                  </span>
                  <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </div>
                <div className="mt-4 text-lg font-semibold">{lease.tenantName}</div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarRange className="size-3.5" />
                  {formatDate(lease.startDate)} – {formatDate(lease.endDate)}
                </div>
                <div className="mt-5 space-y-2">
                  <ProgressBar value={lease.paidSen} max={lease.totalSen} />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      Paid <span className="font-medium text-foreground tabular-nums">{formatSen(lease.paidSen)}</span>
                    </span>
                    <span className="tabular-nums">of {formatSen(lease.totalSen)}</span>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t pt-4 text-sm">
                  <span className="text-muted-foreground">{formatSen(lease.monthlyRentSen)} / mo</span>
                  <span className={`font-semibold tabular-nums ${outstanding > 0 ? 'text-foreground' : 'text-emerald-600'}`}>
                    {outstanding > 0 ? `${formatSen(outstanding)} due` : 'Fully paid'}
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </AppShell>
  )
}
