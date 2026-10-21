import { CheckCircle2, Clock, SearchX, XCircle } from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'
import { AppShell, PageSkeleton } from '@/components/app-shell'
import { StatusBadge } from '@/components/status-badge'
import { buttonVariants } from '@/components/ui/button'
import { getPageActor } from '@/lib/auth'
import { formatInstantMyt, formatSen } from '@/lib/format'
import { prisma } from '@/lib/prisma'

export const metadata = { title: 'Payment status · Sewa' }

/**
 * Where the gateway sends the tenant back. READ-ONLY: it shows the bill's real
 * status from our database and never changes anything. The `paid` query
 * parameter is ignored; only the webhook can settle a bill.
 */
export default function PaymentReturnPage({ searchParams }: PageProps<'/payments/return'>) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PaymentReturn searchParams={searchParams} />
    </Suspense>
  )
}

const VIEW = {
  pending: {
    icon: Clock,
    tone: 'bg-amber-100 text-amber-600',
    title: 'Waiting for confirmation',
    text: 'We haven’t heard from the payment gateway yet. This usually takes a moment, so refresh shortly.',
  },
  paid: {
    icon: CheckCircle2,
    tone: 'bg-emerald-100 text-emerald-600',
    title: 'Payment received',
    text: 'Thank you! Your payment has been applied to your invoices.',
  },
  failed: {
    icon: XCircle,
    tone: 'bg-red-100 text-red-600',
    title: 'Payment didn’t go through',
    text: 'Nothing was charged to your lease. You can try again from your lease page.',
  },
} as const

async function PaymentReturn({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getPageActor()
  const billIdParam = (await searchParams).bill_id
  const billId = typeof billIdParam === 'string' ? billIdParam : null

  // Only a bill the caller may see: the tenant's own lease, or the member's org.
  const bill =
    billId && actor.kind !== 'none'
      ? await prisma.gateway_bills.findFirst({
          where:
            actor.kind === 'tenant'
              ? { id: billId, leases: { tenant_id: actor.tenantId } }
              : { id: billId, org_id: actor.orgId },
        })
      : null
  const view = bill ? VIEW[bill.status] : null
  const Icon = view?.icon ?? SearchX

  return (
    <AppShell actor={actor}>
      <div className="mx-auto max-w-md rounded-3xl border bg-card p-8 text-center shadow-sm">
        <span className={`mx-auto grid size-16 place-items-center rounded-full ${view?.tone ?? 'bg-muted text-muted-foreground'}`}>
          <Icon className="size-8" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">{view?.title ?? 'Payment not found'}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {view?.text ?? 'We couldn’t find this payment. Check the link, or go back to your lease.'}
        </p>

        {bill && (
          <dl className="mt-6 space-y-3 rounded-2xl bg-muted/50 p-4 text-left text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Amount</dt>
              <dd className="font-semibold tabular-nums">{formatSen(Number(bill.amount_sen))}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <StatusBadge status={bill.status} />
              </dd>
            </div>
            {bill.paid_at && (
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Paid</dt>
                <dd>{formatInstantMyt(bill.paid_at)}</dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Bill</dt>
              <dd className="truncate font-mono text-xs">{bill.id}</dd>
            </div>
          </dl>
        )}

        <div className="mt-6 flex justify-center gap-2">
          {bill?.status === 'pending' && (
            <Link href={`/payments/return?bill_id=${encodeURIComponent(bill.id)}`} className={buttonVariants({ variant: 'outline' })}>
              Refresh
            </Link>
          )}
          <Link href="/" className={buttonVariants({ variant: 'default' })}>
            Back to my lease
          </Link>
        </div>
      </div>
    </AppShell>
  )
}
