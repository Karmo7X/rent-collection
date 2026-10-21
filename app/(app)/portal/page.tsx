import { CalendarRange, Home, Mail } from 'lucide-react'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { AppShell, PageHeader, PageSkeleton } from '@/components/app-shell'
import { InvoiceTable, PaymentTable } from '@/components/lease-tables'
import { ProgressBar } from '@/components/stat-card'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getPageActor } from '@/lib/auth'
import { formatDate, formatSen } from '@/lib/format'
import { getLeasePageData, listLeases } from '@/lib/leases'
import { prisma } from '@/lib/prisma'
import { PayNowButton } from './pay-now-button'
import { PhoneForm } from './phone-form'

export const metadata = { title: 'My lease · Sewa' }

export default function PortalPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Portal />
    </Suspense>
  )
}

async function Portal() {
  const actor = await getPageActor()
  if (actor.kind !== 'tenant') redirect('/')

  const now = new Date()
  const [tenant, summaries] = await Promise.all([
    prisma.tenants.findUniqueOrThrow({ where: { id: actor.tenantId } }),
    listLeases(actor),
  ])
  const leases = await Promise.all(summaries.map((s) => getLeasePageData(actor, s.id, now)))
  const firstName = tenant.full_name.split(' ')[0]

  return (
    <AppShell actor={actor}>
      <PageHeader eyebrow={`Hi, ${firstName}`} title="My lease" description="All dates and times are Malaysia time." />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          {leases.length === 0 && (
            <div className="grid place-items-center rounded-2xl border border-dashed bg-card py-16 text-center">
              <span className="font-medium">No lease yet</span>
              <span className="text-sm text-muted-foreground">Your lease will appear here once your manager sets it up.</span>
            </div>
          )}
          {leases.map((lease) => {
            const totalSen = lease.invoices.reduce((s, i) => s + i.amountSen, 0)
            const paidSen = lease.invoices.reduce((s, i) => s + i.paidSen, 0)
            const overdue = lease.invoices.filter((i) => i.status === 'overdue').length
            return (
              <div key={lease.lease.id} className="space-y-6">
                <section className="brand-gradient relative overflow-hidden rounded-3xl p-6 text-white sm:p-8">
                  <div className="brand-grid absolute inset-0" aria-hidden />
                  <div className="absolute -bottom-20 -right-16 size-72 rounded-full bg-amber-300/20 blur-3xl" aria-hidden />
                  <div className="relative">
                    <div className="flex flex-wrap items-center gap-3 text-sm text-white/80">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 font-mono ring-1 ring-white/20">
                        <Home className="size-3.5" /> Unit {lease.unitName}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarRange className="size-4" /> {formatDate(lease.lease.startDate)} –{' '}
                        {formatDate(lease.lease.endDate)}
                      </span>
                    </div>
                    <div className="mt-8 flex flex-wrap items-end justify-between gap-6">
                      <div>
                        <div className="text-sm text-white/70">Amount due now</div>
                        <div className="mt-1 text-5xl font-semibold tracking-tight tabular-nums">
                          {formatSen(lease.amountDueNowSen)}
                        </div>
                        <div className="mt-2 text-sm text-white/70">
                          {overdue > 0
                            ? `${overdue} invoice${overdue === 1 ? ' is' : 's are'} overdue`
                            : lease.amountDueNowSen > 0
                              ? 'Due today'
                              : 'You’re all paid up. Nice!'}
                        </div>
                      </div>
                      <PayNowButton leaseId={lease.lease.id} amountDueSen={lease.amountDueNowSen} />
                    </div>
                    <div className="mt-8 space-y-2">
                      <ProgressBar value={paidSen} max={totalSen} inverted />
                      <div className="flex justify-between text-xs text-white/70">
                        <span>{formatSen(paidSen)} paid so far</span>
                        <span>Lease total {formatSen(totalSen)}</span>
                      </div>
                    </div>
                  </div>
                </section>
                <Card className="rounded-2xl">
                  <CardHeader>
                    <CardTitle>Invoices</CardTitle>
                    <CardDescription>Rent is due on each period’s first day; the deposit on move-in.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <InvoiceTable invoices={lease.invoices} />
                  </CardContent>
                </Card>
                <Card className="rounded-2xl">
                  <CardHeader>
                    <CardTitle>Payments</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <PaymentTable payments={lease.payments} />
                  </CardContent>
                </Card>
              </div>
            )
          })}
        </div>
        <Card className="h-fit rounded-2xl lg:sticky lg:top-24">
          <CardHeader>
            <div className="mb-2 grid size-12 place-items-center rounded-full bg-secondary text-lg font-semibold text-secondary-foreground">
              {tenant.full_name.charAt(0)}
            </div>
            <CardTitle>{tenant.full_name}</CardTitle>
            <CardDescription className="flex items-center gap-1.5">
              <Mail className="size-3.5" /> {tenant.email}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PhoneForm tenantId={tenant.id} initialPhone={tenant.phone ?? ''} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
