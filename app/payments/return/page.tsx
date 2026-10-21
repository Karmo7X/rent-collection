import Link from 'next/link'
import { Suspense } from 'react'
import { AppShell, PageSkeleton } from '@/components/app-shell'
import { StatusBadge } from '@/components/status-badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getPageActor } from '@/lib/auth'
import { formatInstantMyt, formatSen } from '@/lib/format'
import { prisma } from '@/lib/prisma'

export const metadata = { title: 'Payment status · Rent Collection' }

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

const MESSAGES = {
  pending: 'We have not received confirmation from the payment gateway yet. Refresh this page in a moment.',
  paid: 'Your payment has been received and applied to your invoices.',
  failed: 'The payment did not go through. You can try again from your lease page.',
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

  return (
    <AppShell actor={actor}>
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle>Payment status</CardTitle>
          <CardDescription>{bill ? `Bill ${bill.id}` : 'Online payment'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!bill ? (
            <p className="text-sm text-muted-foreground">We couldn&apos;t find this payment.</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-2xl font-semibold tabular-nums">{formatSen(Number(bill.amount_sen))}</span>
                <StatusBadge status={bill.status} />
              </div>
              <p className="text-sm">{MESSAGES[bill.status]}</p>
              {bill.paid_at && <p className="text-sm text-muted-foreground">Paid {formatInstantMyt(bill.paid_at)}</p>}
            </>
          )}
          <div className="flex gap-2">
            {bill?.status === 'pending' && (
              <Link href={`/payments/return?bill_id=${encodeURIComponent(bill.id)}`} className={buttonVariants({ variant: 'outline' })}>
                Refresh
              </Link>
            )}
            <Link href="/" className={buttonVariants({ variant: 'default' })}>
              Back to my lease
            </Link>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  )
}
