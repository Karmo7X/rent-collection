import { AlertTriangle, ArrowUpRight, Banknote, Building2, Hourglass } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { AppShell, PageHeader, PageSkeleton } from '@/components/app-shell'
import { StatCard } from '@/components/stat-card'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getPageActor } from '@/lib/auth'
import { malaysiaToday } from '@/lib/billing'
import { formatInstantMyt, formatMonth, formatSen, lastMonths } from '@/lib/format'
import { listLeases } from '@/lib/leases'
import { collectionsReport, overdueInvoiceCount, pendingPayments } from '@/lib/reports'

export const metadata = { title: 'Dashboard · Sewa' }

export default function DashboardPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Dashboard />
    </Suspense>
  )
}

/** Greeting by the hour in Malaysia. */
function greeting(now: Date): string {
  const hour = (now.getUTCHours() + 8) % 24
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

async function Dashboard() {
  const actor = await getPageActor()
  if (actor.kind !== 'member') redirect('/')

  const now = new Date()
  const { from, to } = lastMonths(malaysiaToday(now), 6)
  const [overdue, report, pending, leases] = await Promise.all([
    overdueInvoiceCount(actor, now),
    collectionsReport(actor, from, to),
    pendingPayments(actor),
    listLeases(actor),
  ])
  const collected = report.reduce((s, r) => s + r.collectedSen, 0)
  const outstanding = leases.reduce((s, l) => s + (l.totalSen - l.paidSen), 0)
  const max = Math.max(...report.map((r) => r.collectedSen), 1)

  return (
    <AppShell actor={actor}>
      <PageHeader
        eyebrow={greeting(now)}
        title="Dashboard"
        description="Your portfolio at a glance. All figures in Malaysia time."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={AlertTriangle}
          tone={overdue > 0 ? 'red' : 'slate'}
          label="Overdue invoices"
          value={overdue}
          hint="Unpaid after their due date"
        />
        <StatCard
          icon={Banknote}
          label="Collected, 6 months"
          value={formatSen(collected)}
          hint={`${formatMonth(from)} – ${formatMonth(to)}`}
        />
        <StatCard
          icon={Hourglass}
          tone="amber"
          label="Waiting for approval"
          value={pending.length}
          hint="Payments recorded by staff"
        />
        <StatCard
          icon={Building2}
          tone="slate"
          label="Outstanding"
          value={formatSen(outstanding)}
          hint={`Across ${leases.length} lease${leases.length === 1 ? '' : 's'}`}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>Collections</CardTitle>
            <CardDescription>Approved payments by the month they were received.</CardDescription>
          </CardHeader>
          <CardContent className="relative">
            {collected === 0 && (
              <div className="absolute inset-x-6 top-12 z-10 text-center text-sm text-muted-foreground">
                Nothing collected in the last 6 months yet.
              </div>
            )}
            <div className="flex h-56 items-end gap-3">
              {report.map((row, i) => {
                const isCurrent = i === report.length - 1
                const height = row.collectedSen === 0 ? 3 : Math.max(8, (row.collectedSen / max) * 100)
                return (
                  <div key={row.month} className="group flex h-full flex-1 flex-col items-center justify-end gap-2">
                    <span className="text-[11px] font-medium tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                      {formatSen(row.collectedSen)}
                    </span>
                    <div
                      className={`w-full rounded-t-lg transition-all ${
                        isCurrent ? 'brand-gradient' : 'bg-primary/25 group-hover:bg-primary/40'
                      }`}
                      style={{ height: `${height}%` }}
                      title={`${formatMonth(row.month)}: ${formatSen(row.collectedSen)}`}
                    />
                    <span className={`text-xs ${isCurrent ? 'font-semibold' : 'text-muted-foreground'}`}>
                      {formatMonth(row.month).slice(0, 3)}
                    </span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>Pending verification</CardTitle>
            <CardDescription>Oldest first.</CardDescription>
          </CardHeader>
          <CardContent>
            {pending.length === 0 ? (
              <div className="grid place-items-center rounded-xl border border-dashed py-10 text-center">
                <span className="text-sm font-medium">All caught up</span>
                <span className="text-xs text-muted-foreground">No payments are waiting for approval.</span>
              </div>
            ) : (
              <ul className="divide-y">
                {pending.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/leases/${p.leaseId}`}
                      className="group flex items-center justify-between gap-3 py-3"
                    >
                      <div>
                        <div className="text-sm font-medium">
                          {p.unitName} · {p.tenantName}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {p.method === 'bank_transfer' ? 'Bank transfer' : 'Cash'} · {formatInstantMyt(p.receivedAt)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold tabular-nums">{formatSen(p.amountSen)}</span>
                        <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
