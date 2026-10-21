import { ArrowLeft, CalendarRange, Home, User } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Suspense } from 'react'
import { AppShell, PageSkeleton } from '@/components/app-shell'
import { InvoiceTable, PaymentTable } from '@/components/lease-tables'
import { ProgressBar } from '@/components/stat-card'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getPageActor } from '@/lib/auth'
import { HttpError } from '@/lib/errors'
import { formatDate, formatSen, malaysiaNowLocalInput } from '@/lib/format'
import { getLeasePageData } from '@/lib/leases'
import { SLIP_BUCKET } from '@/lib/payments'
import { createClient } from '@/lib/supabase/server'
import { PaymentActions } from './payment-actions'
import { RecordPaymentForm } from './record-payment-form'

export const metadata = { title: 'Lease · Sewa' }

export default function LeasePage({ params }: PageProps<'/leases/[leaseId]'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Lease params={params} />
    </Suspense>
  )
}

async function Lease({ params }: { params: Promise<{ leaseId: string }> }) {
  const actor = await getPageActor()
  if (actor.kind !== 'member') redirect('/')
  const { leaseId } = await params

  const now = new Date()
  let data
  try {
    data = await getLeasePageData(actor, leaseId, now)
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound()
    throw error
  }

  // Short-lived signed URLs, created with the user's own session: Storage RLS
  // only lets staff/managers of this org read their org's slips.
  const supabase = await createClient()
  const slipUrls: Record<string, string> = {}
  await Promise.all(
    Object.entries(data.paymentExtras)
      .filter(([, extra]) => extra.slipPath)
      .map(async ([paymentId, extra]) => {
        const { data: signed } = await supabase.storage.from(SLIP_BUCKET).createSignedUrl(extra.slipPath!, 300)
        if (signed) slipUrls[paymentId] = signed.signedUrl
      }),
  )
  const reasons = Object.fromEntries(Object.entries(data.paymentExtras).map(([id, extra]) => [id, extra.reason]))
  const isManager = actor.role === 'manager'
  const totalSen = data.invoices.reduce((sum, i) => sum + i.amountSen, 0)
  const paidSen = data.invoices.reduce((sum, i) => sum + i.paidSen, 0)
  const outstanding = totalSen - paidSen
  const overdueCount = data.invoices.filter((i) => i.status === 'overdue').length

  return (
    <AppShell actor={actor}>
      <Link href="/leases" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All leases
      </Link>

      <section className="brand-gradient relative mt-4 overflow-hidden rounded-3xl p-6 text-white sm:p-8">
        <div className="brand-grid absolute inset-0" aria-hidden />
        <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 font-mono text-sm ring-1 ring-white/20">
              <Home className="size-3.5" /> {data.unitName}
            </span>
            <h1 className="mt-4 flex items-center gap-2 text-3xl font-semibold tracking-tight">
              <User className="size-6 opacity-70" /> {data.tenantName}
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/75">
              <span className="inline-flex items-center gap-1.5">
                <CalendarRange className="size-4" /> {formatDate(data.lease.startDate)} – {formatDate(data.lease.endDate)}
              </span>
              <span>Rent {formatSen(data.lease.monthlyRentSen)} / month</span>
              <span>Deposit {data.lease.depositSen > 0 ? formatSen(data.lease.depositSen) : 'none'}</span>
            </p>
            <div className="mt-6 max-w-md space-y-2">
              <ProgressBar value={paidSen} max={totalSen} inverted />
              <div className="flex justify-between text-xs text-white/75">
                <span>{formatSen(paidSen)} paid</span>
                <span>of {formatSen(totalSen)}</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 self-end lg:grid-cols-1">
            {[
              { label: 'Due now', value: formatSen(data.amountDueNowSen), highlight: true },
              { label: 'Outstanding', value: formatSen(outstanding) },
              { label: 'Overdue invoices', value: String(overdueCount) },
            ].map((stat) => (
              <div
                key={stat.label}
                className={`rounded-2xl px-4 py-3 ring-1 ${stat.highlight ? 'bg-white text-foreground ring-white' : 'bg-white/10 ring-white/20'}`}
              >
                <div className={`text-xs ${stat.highlight ? 'text-muted-foreground' : 'text-white/70'}`}>{stat.label}</div>
                <div className="text-lg font-semibold tabular-nums">{stat.value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle>Invoices</CardTitle>
              <CardDescription>In allocation order: due date, deposit first, then period.</CardDescription>
            </CardHeader>
            <CardContent>
              <InvoiceTable invoices={data.invoices} />
            </CardContent>
          </Card>
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle>Payments</CardTitle>
              <CardDescription>Times are Malaysia time.</CardDescription>
            </CardHeader>
            <CardContent>
              <PaymentTable
                payments={data.payments}
                slipUrls={slipUrls}
                reasons={reasons}
                renderActions={
                  isManager
                    ? (payment) => <PaymentActions paymentId={payment.id} status={payment.status} amountSen={payment.amountSen} />
                    : undefined
                }
              />
            </CardContent>
          </Card>
        </div>
        <Card className="h-fit rounded-2xl lg:sticky lg:top-24">
          <CardHeader>
            <CardTitle>Record a payment</CardTitle>
            <CardDescription>
              {isManager ? 'Your payments are approved immediately.' : 'Your payments wait for a manager’s approval.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RecordPaymentForm leaseId={data.lease.id} orgId={actor.orgId} defaultReceivedAt={malaysiaNowLocalInput(now)} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
