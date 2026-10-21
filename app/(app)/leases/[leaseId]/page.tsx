import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Suspense } from 'react'
import { AppShell, PageSkeleton } from '@/components/app-shell'
import { InvoiceTable, PaymentTable } from '@/components/lease-tables'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getPageActor } from '@/lib/auth'
import { HttpError } from '@/lib/errors'
import { formatDate, formatSen, malaysiaNowLocalInput } from '@/lib/format'
import { getLeasePageData } from '@/lib/leases'
import { SLIP_BUCKET } from '@/lib/payments'
import { createClient } from '@/lib/supabase/server'
import { PaymentActions } from './payment-actions'
import { RecordPaymentForm } from './record-payment-form'

export const metadata = { title: 'Lease · Rent Collection' }

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
  const outstanding = data.invoices.reduce((sum, i) => sum + Math.max(i.amountSen - i.paidSen, 0), 0)

  return (
    <AppShell actor={actor}>
      <Link href="/leases" className="text-sm text-muted-foreground hover:text-foreground">
        ← All leases
      </Link>
      <div className="mb-6 mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {data.unitName} · {data.tenantName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatDate(data.lease.startDate)} – {formatDate(data.lease.endDate)} · Rent {formatSen(data.lease.monthlyRentSen)}{' '}
            / month · Deposit {data.lease.depositSen > 0 ? formatSen(data.lease.depositSen) : 'none'}
          </p>
        </div>
        <div className="text-right text-sm">
          <div>
            Due now: <span className="font-semibold tabular-nums">{formatSen(data.amountDueNowSen)}</span>
          </div>
          <div className="text-muted-foreground">
            Outstanding overall: <span className="tabular-nums">{formatSen(outstanding)}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Invoices</CardTitle>
              <CardDescription>In allocation order: due date, deposit first, then period.</CardDescription>
            </CardHeader>
            <CardContent>
              <InvoiceTable invoices={data.invoices} />
            </CardContent>
          </Card>
          <Card>
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
        <Card className="h-fit">
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
