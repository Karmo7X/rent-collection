'use client'

import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { postJson } from '@/lib/api-client'
import { formatSen } from '@/lib/format'

export function PayNowButton({ leaseId, amountDueSen }: { leaseId: string; amountDueSen: number }) {
  const [bill, setBill] = useState<{ billId: string; amountSen: number } | null>(null)
  const [pending, setPending] = useState(false)

  async function payNow() {
    setPending(true)
    try {
      setBill(await postJson<{ billId: string; amountSen: number }>(`/api/leases/${leaseId}/gateway-bills`))
      toast.success('Payment bill created')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start the payment')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <Button onClick={payNow} disabled={pending || amountDueSen <= 0}>
        {pending ? 'Creating bill…' : amountDueSen > 0 ? 'Pay now' : 'Nothing due'}
      </Button>
      <Dialog open={bill !== null} onOpenChange={(open) => !open && setBill(null)}>
        <DialogContent>
          {bill && (
            <>
              <DialogHeader>
                <DialogTitle>Online payment bill</DialogTitle>
                <DialogDescription>
                  In production you would now be sent to the payment gateway. The payment is only confirmed when the gateway
                  notifies us.
                </DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
                <dt className="text-muted-foreground">Bill ID</dt>
                <dd className="break-all font-mono">{bill.billId}</dd>
                <dt className="text-muted-foreground">Amount</dt>
                <dd className="font-semibold tabular-nums">
                  {formatSen(bill.amountSen)} <span className="font-normal text-muted-foreground">({bill.amountSen} sen)</span>
                </dd>
              </dl>
              <DialogFooter>
                <Link
                  href={`/payments/return?bill_id=${encodeURIComponent(bill.billId)}`}
                  className={buttonVariants({ variant: 'default' })}
                >
                  Check payment status
                </Link>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
