'use client'

import { Check, Copy, CreditCard, Loader2, Receipt, ShieldCheck, Webhook } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { postJson } from '@/lib/api-client'
import { formatSen } from '@/lib/format'

const STEPS = [
  { icon: Receipt, title: 'Bill created', text: 'The amount due now is locked into this bill.', done: true },
  { icon: CreditCard, title: 'Pay at the gateway', text: 'In production you’d be redirected to pay here.', done: false },
  { icon: Webhook, title: 'Gateway confirms', text: 'Your invoices update once the gateway notifies us.', done: false },
]

export function PayNowButton({ leaseId, amountDueSen }: { leaseId: string; amountDueSen: number }) {
  const [bill, setBill] = useState<{ billId: string; amountSen: number } | null>(null)
  const [pending, setPending] = useState(false)
  const [copied, setCopied] = useState(false)

  async function payNow() {
    setPending(true)
    try {
      setBill(await postJson<{ billId: string; amountSen: number }>(`/api/leases/${leaseId}/gateway-bills`))
      setCopied(false)
      toast.success('Payment bill created')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start the payment')
    } finally {
      setPending(false)
    }
  }

  async function copyBillId() {
    if (!bill) return
    try {
      await navigator.clipboard.writeText(bill.billId)
      setCopied(true)
      toast.success('Bill ID copied')
    } catch {
      toast.error('Could not copy. Select the ID and copy it manually.')
    }
  }

  return (
    <>
      <Button
        onClick={payNow}
        disabled={pending || amountDueSen <= 0}
        className="h-12 rounded-xl bg-white px-6 text-[15px] font-semibold text-primary shadow-lg hover:bg-white/90 disabled:bg-white/40 disabled:text-white"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
        {pending ? 'Creating bill…' : amountDueSen > 0 ? 'Pay now' : 'Nothing due'}
      </Button>

      <Dialog open={bill !== null} onOpenChange={(open) => !open && setBill(null)}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-md">
          {bill && (
            <>
              <div className="brand-gradient relative px-6 pb-6 pt-7 text-white">
                <div className="brand-grid absolute inset-0" aria-hidden />
                <DialogHeader className="relative">
                  <DialogTitle className="text-white">Online payment</DialogTitle>
                  <DialogDescription className="text-white/75">Your bill is ready.</DialogDescription>
                </DialogHeader>
                <div className="relative mt-5 text-4xl font-semibold tracking-tight tabular-nums">
                  {formatSen(bill.amountSen)}
                </div>
                <div className="relative text-xs text-white/70">{bill.amountSen.toLocaleString('en-US')} sen</div>
              </div>

              <div className="space-y-5 px-6 pb-6">
                <div>
                  <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Bill ID</div>
                  <div className="flex items-center gap-2 rounded-xl border bg-muted/50 p-1.5 pl-3">
                    <code className="flex-1 break-all text-sm">{bill.billId}</code>
                    <Button size="icon-sm" variant="ghost" onClick={copyBillId} aria-label="Copy bill ID">
                      {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
                    </Button>
                  </div>
                </div>

                <ol className="space-y-3">
                  {STEPS.map(({ icon: Icon, title, text, done }) => (
                    <li key={title} className="flex gap-3">
                      <span
                        className={`grid size-8 shrink-0 place-items-center rounded-full ${done ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span>
                        <span className="block text-sm font-medium">{title}</span>
                        <span className="block text-xs text-muted-foreground">{text}</span>
                      </span>
                    </li>
                  ))}
                </ol>

                <p className="flex items-start gap-2 rounded-xl bg-secondary/60 p-3 text-xs text-secondary-foreground">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                  Only the payment gateway can confirm a payment. Coming back to this site never marks it as paid.
                </p>

                <Link
                  href={`/payments/return?bill_id=${encodeURIComponent(bill.billId)}`}
                  className={buttonVariants({ className: 'h-11 w-full' })}
                >
                  Check payment status
                </Link>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
