import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { AppShell, PageSkeleton } from '@/components/app-shell'
import { InvoiceTable, PaymentTable } from '@/components/lease-tables'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getPageActor } from '@/lib/auth'
import { formatDate, formatSen } from '@/lib/format'
import { getLeasePageData, listLeases } from '@/lib/leases'
import { prisma } from '@/lib/prisma'
import { PayNowButton } from './pay-now-button'
import { PhoneForm } from './phone-form'

export const metadata = { title: 'My lease · Rent Collection' }

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

  return (
    <AppShell actor={actor}>
      <h1 className="mb-1 text-2xl font-semibold">Hello, {tenant.full_name}</h1>
      <p className="mb-6 text-sm text-muted-foreground">All dates and times are Malaysia time.</p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          {leases.length === 0 && (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">You have no leases yet.</CardContent>
            </Card>
          )}
          {leases.map((lease) => (
            <div key={lease.lease.id} className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Unit {lease.unitName}</CardTitle>
                  <CardDescription>
                    {formatDate(lease.lease.startDate)} – {formatDate(lease.lease.endDate)} · Rent{' '}
                    {formatSen(lease.lease.monthlyRentSen)} / month
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Amount due now</div>
                    <div className="text-3xl font-semibold tabular-nums">{formatSen(lease.amountDueNowSen)}</div>
                  </div>
                  <PayNowButton leaseId={lease.lease.id} amountDueSen={lease.amountDueNowSen} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Invoices</CardTitle>
                </CardHeader>
                <CardContent>
                  <InvoiceTable invoices={lease.invoices} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Payments</CardTitle>
                </CardHeader>
                <CardContent>
                  <PaymentTable payments={lease.payments} />
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>My details</CardTitle>
            <CardDescription>{tenant.email}</CardDescription>
          </CardHeader>
          <CardContent>
            <PhoneForm tenantId={tenant.id} initialPhone={tenant.phone ?? ''} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
