'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { postJson } from '@/lib/api-client'
import { formatSen } from '@/lib/format'

type Action = 'approve' | 'reject' | 'void'

const COPY: Record<Action, { title: string; description: string; confirm: string; needsReason: boolean }> = {
  approve: {
    title: 'Approve this payment?',
    description: 'It will be allocated to the oldest unpaid invoices.',
    confirm: 'Approve',
    needsReason: false,
  },
  reject: {
    title: 'Reject this payment?',
    description: 'It will not count towards any invoice.',
    confirm: 'Reject',
    needsReason: true,
  },
  void: {
    title: 'Void this payment?',
    description: 'Its allocations are removed and the invoices it paid reopen. This cannot be undone.',
    confirm: 'Void payment',
    needsReason: true,
  },
}

/** Manager-only buttons. The API enforces the role and the state rules; this is just the UI. */
export function PaymentActions({
  paymentId,
  status,
  amountSen,
}: {
  paymentId: string
  status: 'pending_verification' | 'approved' | 'rejected' | 'voided'
  amountSen: number
}) {
  const router = useRouter()
  const [action, setAction] = useState<Action | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const available: Action[] = status === 'pending_verification' ? ['approve', 'reject'] : status === 'approved' ? ['void'] : []
  if (available.length === 0) return <span className="text-sm text-muted-foreground">-</span>

  function open(next: Action) {
    setAction(next)
    setReason('')
    setError(null)
  }

  async function confirm() {
    if (!action) return
    const copy = COPY[action]
    if (copy.needsReason && reason.trim().length < 5) {
      setError('Give a reason of at least 5 characters.')
      return
    }
    setPending(true)
    try {
      await postJson(`/api/payments/${paymentId}/${action}`, copy.needsReason ? { reason: reason.trim() } : undefined)
      toast.success(action === 'approve' ? 'Payment approved' : action === 'reject' ? 'Payment rejected' : 'Payment voided')
      setAction(null)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex justify-end gap-2">
      {available.map((a) => (
        <Button key={a} size="sm" variant={a === 'approve' ? 'default' : 'outline'} onClick={() => open(a)}>
          {COPY[a].confirm}
        </Button>
      ))}
      <Dialog open={action !== null} onOpenChange={(isOpen) => !isOpen && !pending && setAction(null)}>
        <DialogContent>
          {action && (
            <>
              <DialogHeader>
                <DialogTitle>{COPY[action].title}</DialogTitle>
                <DialogDescription>
                  {formatSen(amountSen)}. {COPY[action].description}
                </DialogDescription>
              </DialogHeader>
              {COPY[action].needsReason && (
                <div className="space-y-2">
                  <Label htmlFor={`reason-${paymentId}`}>Reason (at least 5 characters)</Label>
                  <Textarea
                    id={`reason-${paymentId}`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    aria-invalid={Boolean(error)}
                  />
                  {error && <p className="text-sm text-destructive">{error}</p>}
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setAction(null)} disabled={pending}>
                  Cancel
                </Button>
                <Button variant={action === 'approve' ? 'default' : 'destructive'} onClick={confirm} disabled={pending}>
                  {pending ? 'Working…' : COPY[action].confirm}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
